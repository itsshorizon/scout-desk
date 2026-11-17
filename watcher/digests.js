'use strict';
/* Builds the small summaries each scout reads. All the math happens here, in code,
 * using the app's own engines. A scout only reads its digest (a few KB) and writes advice. */

const POS = ['QB', 'RB', 'WR', 'TE'];
const ZERO = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION']);
const WEEKLY_SD = 25; // per-team weekly spread, same as the app's ResearchEngine.WEEKLY_SD
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

function etTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function normCdf(z) {
  // Abramowitz-Stegun approximation, plenty for a win probability.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/* Expected points this week for lineup math: ESPN projection, cut for injury status. */
function weekPts(p) {
  if (ZERO.has(p.inj)) return 0;
  const base = p.proj != null ? p.proj : (p.ros?.ppg ?? null);
  if (base == null) return null;
  return p.inj === 'DOUBTFUL' ? base * 0.3 : base;
}

function enrich(p, ctx) {
  const adv = ctx.advanced.players?.[p.id];
  const v = ctx.vals[p.id];
  const g = p.pro != null ? ctx.games[String(p.pro)] : null;
  return {
    ...p,
    dv: v?.dv ?? null, wn: v?.wn ?? null, age: v?.a ?? null,
    ros: adv?.ros ? { ppg: adv.ros.ppg, floor: adv.ros.floor, ceil: adv.ros.ceil, sos: adv.ros.sosLabel } : null,
    xfp: adv?.s?.xfp ?? null, xfpTrend: adv?.tr?.xfp ?? null, snap: adv?.s?.snap ?? null,
    game: g ? { kick: etTime(g.date), state: g.state, opp: g.opp, home: g.home, implied: g.implied } : null,
    oppDef: g && g.opp && ctx.advanced.defense?.[g.opp]?.[p.pos] ? ctx.advanced.defense[g.opp][p.pos][1] : null,
  };
}

/* ---------------- Lineup (Sunday news and lineup scout) ---------------- */

function lineupDigest(ctx) {
  const { snap, myTeamId, cfg, events, eng } = ctx;
  const slots = snap.slots || cfg.defaultSlots;
  const mine = (snap.rosters[myTeamId] || []).map((p) => enrich(p, ctx));
  const starters = mine.filter((p) => !['BE', 'IR'].includes(p.slot));

  // Problems with current starters (out, doubtful, questionable, bye, projected for zero).
  const issues = [];
  for (const p of starters) {
    if (!p.game) issues.push({ id: p.id, name: p.name, why: 'bye or no game' });
    else if (p.game.state !== 'pre') continue;
    else if (ZERO.has(p.inj) || p.inj === 'DOUBTFUL') issues.push({ id: p.id, name: p.name, why: p.inj.toLowerCase().replace('_', ' ') });
    else if (p.inj === 'QUESTIONABLE') issues.push({ id: p.id, name: p.name, why: 'questionable', kick: p.game.kick });
    else if (p.proj != null && p.proj < 0.5) issues.push({ id: p.id, name: p.name, why: 'projected for 0' });
  }

  // Best lineup among players whose games have not started. Locked starters stay put.
  const locked = starters.filter((p) => p.game && p.game.state !== 'pre');
  const openSlots = { ...slots };
  for (const p of locked) {
    if (openSlots[p.slot] > 0) openSlots[p.slot] -= 1;
  }
  const lockedIds = new Set(locked.map((p) => p.id));
  const pool = mine.filter((p) => p.slot !== 'IR' && !lockedIds.has(p.id) && (!p.game || p.game.state === 'pre'))
    .map((p) => ({ id: p.id, pos: p.pos, pts: weekPts(p) ?? 0 }));
  const best = eng.leverage.bestLineup(pool, openSlots);
  const curOpen = starters.filter((p) => !lockedIds.has(p.id));
  const curTotal = curOpen.reduce((s, p) => s + (weekPts(p) ?? 0), 0);
  const gain = best.total - curTotal;
  const byId = Object.fromEntries(mine.map((p) => [p.id, p]));
  const swaps = gain >= cfg.thresholds.swapGainPts ? {
    gain: r1(gain),
    benchThese: curOpen.filter((p) => !best.ids.has(p.id)).map((p) => ({ name: p.name, pts: r1(weekPts(p)) })),
    startThese: [...best.ids].filter((id) => !curOpen.some((p) => p.id === id)).map((id) => ({ name: byId[id].name, pts: r1(weekPts(byId[id])) })),
  } : null;

  // Matchup and win probability from ESPN projections.
  const m = (snap.matchups || []).find((x) => x.home === myTeamId || x.away === myTeamId);
  let matchup = null;
  if (m) {
    const oppId = m.home === myTeamId ? m.away : m.home;
    const opp = snap.rosters[oppId] || [];
    const proj = (list) => list.filter((p) => !['BE', 'IR'].includes(p.slot)).reduce((s, p) => s + (weekPts(p) ?? 0), 0);
    const me = proj(snap.rosters[myTeamId] || []) + (swaps ? swaps.gain : 0), them = proj(opp);
    matchup = {
      opponent: snap.teams[oppId]?.name || `Team ${oppId}`,
      myProj: r1(me), oppProj: r1(them),
      winProb: Math.round(normCdf((me - them) / (WEEKLY_SD * Math.SQRT2)) * 100) / 100,
    };
  }

  const recent = recentEvents(events, ctx.now, 24, (e) => e.mine || (e.type === 'injury' && e.starter));
  return {
    scout: 'lineup', builtAt: new Date(ctx.now).toISOString(), week: snap.week,
    quiet: issues.length === 0 && !swaps && !recent.some((e) => e.mine),
    matchup, issues, swaps,
    starters: starters.map(brief),
    bench: mine.filter((p) => p.slot === 'BE').map(brief),
    events: recent.slice(0, cfg.limits.eventsPerDigest),
  };
}

function brief(p) {
  return {
    name: p.name, pos: p.pos, slot: p.slot, inj: p.inj === 'ACTIVE' ? undefined : p.inj,
    proj: p.proj, ros: p.ros ? [p.ros.floor, p.ros.ppg, p.ros.ceil] : undefined,
    game: p.game ? `${p.game.home ? 'vs' : '@'} ${p.game.opp} ${p.game.kick}${p.game.implied != null ? ` (team total ${p.game.implied})` : ''}${p.game.state !== 'pre' ? ` [${p.game.state}]` : ''}` : 'BYE',
    oppDefRank: p.oppDef ?? undefined,
  };
}

/* ---------------- Waivers and free agents ---------------- */

function waiverDigest(ctx, mode) {
  const { snap, myTeamId, cfg, eng, trending } = ctx;
  const slots = snap.slots || cfg.defaultSlots;
  const lim = cfg.limits;
  const rostered = new Set(Object.values(snap.rosters).flat().map((p) => p.id));

  // League-wide starter bars, then what each position upgrade is worth to my lineup.
  const rosPts = (p) => ({ id: p.id, pos: p.pos, pts: ctx.advanced.players?.[p.id]?.ros?.ppg ?? 0 });
  const teams = Object.entries(snap.rosters).map(([id, list]) => ({ id, players: list.filter((p) => p.slot !== 'IR').map(rosPts) }));
  const myRoster = (snap.rosters[myTeamId] || []).filter((p) => p.slot !== 'IR').map(rosPts);
  const leaguePool = eng.leverage.leaguePool(teams, slots);
  const needs = eng.leverage.slotLeverage({ roster: myRoster, slots, pool: leaguePool })
    .map((x) => ({ pos: x.pos, gainIfMedianStarter: r1(x.gainP50), gainIfTopStarter: r1(x.gainP80) }));

  // Usage diamonds league-wide, from the app's engine.
  const diamondRows = Object.entries(ctx.advanced.players || {})
    .filter(([, a]) => Array.isArray(a.w))
    .map(([id, a]) => ({ id, pos: a.pos, weeks: a.w.map((r) => ({ wk: r[0], snap: r[2], tgtSh: r[3], rushSh: r[4], xfp: r[6], fp: r[7], td: r[8], xtd: r[9] })) }));
  const dia = eng.risers.diamonds(diamondRows);
  const tag = {};
  for (const k of ['rising', 'unlucky', 'hot']) dia[k].forEach((d) => { tag[d.id] = tag[d.id] || k; });

  // Candidates: the app's unrostered list, minus anyone rostered since it was built.
  const weeksLeft = Math.max(0, (cfg.regularSeasonWeeks || 14) - snap.week + 1);
  const cands = Object.entries(ctx.waivers.players || {})
    .filter(([id, w]) => !rostered.has(id) && POS.includes(w.p))
    .filter(([, w]) => mode !== 'freeagents' || w.st !== 'WA' || isPastClear(w.wd, ctx.now))
    .map(([id, w]) => {
      const adv = ctx.advanced.players?.[id];
      const ppg = adv?.ros?.ppg ?? 0;
      // A player who is out or on IR helps nobody this week.
      const g = eng.leverage.addGain(myRoster, slots, w.p, ZERO.has(w.inj) ? 0 : ppg);
      const disp = g.displaced ? myRoster.find((p) => p.id === g.displaced) : null;
      return {
        id, name: w.n, pos: w.p, rosteredPctEspn: w.own, status: w.st, inj: w.inj || undefined,
        ros: adv?.ros ? [adv.ros.floor, adv.ros.ppg, adv.ros.ceil] : null,
        xfp: adv?.s?.xfp ?? null, xfpTrend: adv?.tr?.xfp ?? null, snap: adv?.s?.snap ?? null,
        usage: tag[id] || undefined, sleeperAdds24h: trending?.[id]?.add || undefined,
        dv: ctx.vals[id]?.dv ?? null, age: ctx.vals[id]?.a ?? null,
        addGainPpg: r1(g.gain), replaces: disp ? (snap.rosters[myTeamId] || []).find((p) => p.id === disp.id)?.name : undefined,
        playoffs: adv?.ros?.playoffs?.map((x) => `${x[1]} ${x[2]}`) || undefined,
      };
    });

  const helpNow = cands.filter((c) => c.addGainPpg >= cfg.thresholds.addGainPpg)
    .sort((a, b) => b.addGainPpg - a.addGainPpg).slice(0, lim.waiverCandidates);
  const helpIds = new Set(helpNow.map((c) => c.id));
  const stash = cands.filter((c) => !helpIds.has(c.id) && ((c.dv || 0) >= cfg.thresholds.stashDv || c.usage === 'rising'))
    .sort((a, b) => (b.dv || 0) - (a.dv || 0)).slice(0, lim.stashCandidates);

  // Drop candidates: my bench players who don't make the best lineup, lowest value first.
  const best = eng.leverage.bestLineup(myRoster, slots);
  const drops = (snap.rosters[myTeamId] || []).filter((p) => p.slot === 'BE' && !best.ids.has(p.id))
    .map((p) => ({ name: p.name, pos: p.pos, dv: ctx.vals[p.id]?.dv ?? 0, rosPpg: ctx.advanced.players?.[p.id]?.ros?.ppg ?? null, inj: p.inj === 'ACTIVE' ? undefined : p.inj }))
    .sort((a, b) => a.dv - b.dv).slice(0, lim.dropCandidates);

  const me = snap.teams[myTeamId] || {};
  const recent = recentEvents(ctx.events, ctx.now, mode === 'freeagents' ? 30 : 72,
    (e) => e.type === 'trending' || (e.type === 'move' && e.drops?.length) || e.mine);
  return {
    scout: mode, builtAt: new Date(ctx.now).toISOString(), week: snap.week, weeksLeftRegular: weeksLeft,
    quiet: helpNow.length === 0 && stash.length === 0,
    me: { record: `${me.w ?? '?'}-${me.l ?? '?'}${me.t ? `-${me.t}` : ''}`, waiverRank: me.waiverRank, faabLeft: me.faabLeft },
    waiversClear: etTime(firstClear(ctx.waivers)),
    needs, helpNow, stash, drops,
    events: recent.slice(0, cfg.limits.eventsPerDigest),
  };
}

function firstClear(waivers) {
  const ts = Object.values(waivers.players || {}).map((w) => w.wd).filter(Boolean);
  return ts.length ? new Date(Math.min(...ts)).toISOString() : null;
}
const isPastClear = (wd, now) => !wd || wd <= now;

function recentEvents(events, now, hours, keep) {
  return (events || []).filter((e) => now - Date.parse(e.at) <= hours * 3600e3 && keep(e))
    .slice().reverse()
    .map(({ key, ...e }) => e);
}

module.exports = { lineupDigest, waiverDigest, weekPts, normCdf, enrich, etTime };
