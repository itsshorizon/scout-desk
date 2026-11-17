'use strict';
/* ESPN league and NFL scoreboard reads. Parsing mirrors the app's functions/espn.js
 * so the desk sees the league the same way the app does.
 * Private-league cookies are optional: set ESPN_S2 and SWID as repo secrets if
 * the league is ever made private. */
const { fetchJSON } = require('./http');

const POSITION_MAP = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const SLOT_MAP = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 17: 'K', 16: 'DST', 23: 'FLEX', 20: 'BE', 21: 'IR', 7: 'OP' };
const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const NFL_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

function cookieHeader() {
  const s2 = process.env.ESPN_S2, swid = process.env.SWID;
  return s2 && swid ? { Cookie: `espn_s2=${s2}; SWID=${swid}` } : {};
}

function leagueUrl(cfg, views, extra = {}) {
  const params = new URLSearchParams();
  views.forEach((v) => params.append('view', v));
  Object.entries(extra).forEach(([k, v]) => params.append(k, v));
  return `${ESPN_BASE}/seasons/${cfg.season}/segments/0/leagues/${cfg.leagueId}?${params}`;
}

const league = (cfg, views, extra) => fetchJSON(leagueUrl(cfg, views, extra), { headers: cookieHeader() });

const weekRow = (stats, week, source, season) => (stats || []).find((s) =>
  s && s.statSourceId === source && s.scoringPeriodId === week && (source !== 0 || s.seasonId === season)) || null;

/* Teams, settings, and every roster with this week's projections.
 * Returns { week, slots, faab, teams: { id: {...} }, rosters: { teamId: [player] }, matchups: [...] } */
function parseLeague(raw, season) {
  const week = raw.scoringPeriodId || raw.status?.currentMatchupPeriod || 1;
  const members = {};
  (raw.members || []).forEach((m) => {
    members[m.id] = ((m.firstName || '') + ' ' + (m.lastName || '')).trim() || m.displayName || '';
  });
  const counts = raw.settings?.rosterSettings?.lineupSlotCounts || null;
  let slots = null;
  if (counts) {
    slots = { QB: counts['0'] || 0, RB: counts['2'] || 0, WR: counts['4'] || 0, TE: counts['6'] || 0, FLEX: counts['23'] || 0 };
  }
  const acq = raw.settings?.acquisitionSettings || {};
  const faab = acq.isUsingAcquisitionBudget ? (acq.acquisitionBudget || 0) : null;

  const teams = {};
  const rosters = {};
  (raw.teams || []).forEach((t) => {
    const name = ((t.location ? t.location + ' ' : '') + (t.nickname || '')).trim() || t.name || `Team ${t.id}`;
    const rec = t.record?.overall || {};
    teams[t.id] = {
      id: t.id, name, abbrev: t.abbrev || '',
      owner: (t.owners || []).map((id) => members[id]).filter(Boolean).join(', '),
      w: rec.wins ?? null, l: rec.losses ?? null, t: rec.ties ?? null,
      pf: rec.pointsFor != null ? Math.round(rec.pointsFor) : null,
      waiverRank: t.waiverRank ?? null,
      faabLeft: faab != null ? faab - (t.transactionCounter?.acquisitionBudgetSpent || 0) : null,
    };
    rosters[t.id] = ((t.roster && t.roster.entries) || []).map((e) => {
      const p = e.playerPoolEntry?.player || {};
      return {
        id: String(p.id),
        name: p.fullName || 'Unknown',
        pos: POSITION_MAP[p.defaultPositionId] || '?',
        slot: SLOT_MAP[e.lineupSlotId] || 'BE',
        pro: p.proTeamId ?? null,
        inj: p.injuryStatus || (p.injured ? 'INJURED' : 'ACTIVE'),
        proj: round1(weekRow(p.stats, week, 1, season)?.appliedTotal),
      };
    });
  });

  const matchups = (raw.schedule || []).filter((m) => m.matchupPeriodId === week && m.home?.teamId != null && m.away?.teamId != null)
    .map((m) => ({ home: m.home.teamId, away: m.away.teamId }));
  return { week, slots, faab, teams, rosters, matchups };
}

async function leagueState(cfg) {
  const meta = await league(cfg, ['mStatus']);
  const week = meta.scoringPeriodId || meta.status?.currentMatchupPeriod || 1;
  const raw = await league(cfg, ['mTeam', 'mRoster', 'mSettings', 'mMatchup'], { scoringPeriodId: week });
  return parseLeague({ ...raw, scoringPeriodId: raw.scoringPeriodId || week }, cfg.season);
}

/* Executed adds, drops and trades. Shape matches the app's ActivityEngine.parseTransactions input. */
async function transactions(cfg, week) {
  const raw = await league(cfg, ['mTransactions2'], { scoringPeriodId: week });
  return raw.transactions || [];
}

/* NFL games for the week, keyed by ESPN pro team id, with Vegas implied team totals when posted. */
function parseScoreboard(raw) {
  const games = {};
  (raw.events || []).forEach((ev) => {
    const c = ev.competitions?.[0];
    if (!c) return;
    const st = c.status || ev.status || {};
    const home = (c.competitors || []).find((t) => t.homeAway === 'home');
    const away = (c.competitors || []).find((t) => t.homeAway === 'away');
    const totals = impliedTotals(c.odds?.[0], home?.team?.abbreviation, away?.team?.abbreviation);
    for (const [me, them, side] of [[home, away, 'home'], [away, home, 'away']]) {
      if (!me?.team?.id) continue;
      games[String(me.team.id)] = {
        date: ev.date, state: st.type?.state || 'pre',
        abbr: me.team.abbreviation || null, opp: them?.team?.abbreviation || null, home: side === 'home',
        implied: totals ? totals[side] : null,
      };
    }
  });
  return games;
}

/* Over/under plus the home line gives each side's expected points.
 * ESPN gives `spread` as the home line (negative = home favored); older payloads only have
 * `details` like "KC -3.5", naming the favorite. */
function impliedTotals(odds, homeAbbr, awayAbbr) {
  if (!odds || !Number.isFinite(Number(odds.overUnder))) return null;
  const ou = Number(odds.overUnder);
  let homeLine = Number.isFinite(Number(odds.spread)) ? Number(odds.spread) : null;
  if (homeLine == null && typeof odds.details === 'string') {
    const m = odds.details.match(/^([A-Z]{2,4})\s+(-?\d+(\.\d+)?)$/);
    if (m) {
      const fav = m[1], line = -Math.abs(Number(m[2]));
      if (fav === homeAbbr) homeLine = line;
      else if (fav === awayAbbr) homeLine = -line;
    } else if (/^EVEN$/i.test(odds.details.trim())) homeLine = 0;
  }
  if (homeLine == null) return null;
  return { home: round1(ou / 2 - homeLine / 2), away: round1(ou / 2 + homeLine / 2) };
}

async function nflGames(cfg, week) {
  const raw = await fetchJSON(`${NFL_SCOREBOARD}?seasontype=2&week=${week}&dates=${cfg.season}`);
  return parseScoreboard(raw);
}

function round1(v) { return v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10; }

module.exports = { leagueState, transactions, nflGames, parseLeague, parseScoreboard, impliedTotals, POSITION_MAP, SLOT_MAP };
