'use strict';
/* Builds fake ESPN, scoreboard and Sleeper payloads from the app's real player data,
 * in the same shapes the live APIs return. Used by the tests only. */
const fs = require('fs');
const path = require('path');

const PRO = { ATL: 1, BUF: 2, CHI: 3, CIN: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GB: 9, TEN: 10, IND: 11, KC: 12, LV: 13, LAR: 14, MIA: 15, MIN: 16,
  NE: 17, NO: 18, NYG: 19, NYJ: 20, PHI: 21, ARI: 22, PIT: 23, LAC: 24, SF: 25, SEA: 26, TB: 27, WSH: 28, CAR: 29, JAX: 30, BAL: 33, HOU: 34 };
const POS_ID = { QB: 1, RB: 2, WR: 3, TE: 4 };
const SLOT_ID = { QB: 0, RB: 2, WR: 4, TE: 6, FLEX: 23, BE: 20, IR: 21 };
const WEEK = 11;

function build(appDir, outDir, variant = 1) {
  const values = JSON.parse(fs.readFileSync(path.join(appDir, 'data/values.json'), 'utf8')).players;
  const waivers = JSON.parse(fs.readFileSync(path.join(appDir, 'data/waivers.json'), 'utf8')).players;
  const adv = JSON.parse(fs.readFileSync(path.join(appDir, 'data/advanced.json'), 'utf8')).players;
  const pool = Object.entries(values)
    .filter(([id, p]) => POS_ID[p.p] && !waivers[id] && PRO[p.t] && adv[id]?.ros)
    .sort((a, b) => b[1].dv - a[1].dv);

  // Snake-ish deal: 12 teams, 18 players each. Team 1 is "Toe Guano".
  const teams = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, players: [] }));
  pool.slice(0, 12 * 18).forEach(([id, p], i) => {
    const round = Math.floor(i / 12), k = i % 12;
    teams[round % 2 ? 11 - k : k].players.push([id, p]);
  });

  const espnTeams = teams.map((t) => {
    const need = { QB: 1, RB: 2, WR: 2, TE: 1 };
    let flex = 3;
    const entries = t.players.map(([id, p], idx) => {
      let slot = 'BE';
      if (need[p.p] > 0) { slot = p.p; need[p.p]--; } else if (p.p !== 'QB' && flex > 0) { slot = 'FLEX'; flex--; }
      const proj = adv[id].ros.ppg;
      let inj = 'ACTIVE';
      if (t.id === 1 && variant === 2 && slot === 'WR') inj = 'OUT'; // first WR starter ruled out in run 2
      return {
        lineupSlotId: SLOT_ID[slot],
        playerPoolEntry: { player: {
          id: Number(id), fullName: p.n, defaultPositionId: POS_ID[p.p], proTeamId: PRO[p.t], injuryStatus: inj,
          stats: [{ statSourceId: 1, scoringPeriodId: WEEK, appliedTotal: proj }],
        } },
      };
    });
    return {
      id: t.id, location: t.id === 1 ? 'Toe' : 'Team', nickname: t.id === 1 ? 'Guano' : String(t.id), abbrev: `T${t.id}`,
      owners: [`m${t.id}`], record: { overall: { wins: 6, losses: 4, ties: 0, pointsFor: 1234.5 } },
      waiverRank: t.id, transactionCounter: { acquisitionBudgetSpent: 20 },
      roster: { entries },
    };
  });
  const schedule = Array.from({ length: 6 }, (_, i) => ({ matchupPeriodId: WEEK, home: { teamId: i * 2 + 1 }, away: { teamId: i * 2 + 2 } }));
  const league = {
    scoringPeriodId: WEEK, members: teams.map((t) => ({ id: `m${t.id}`, displayName: `Manager ${t.id}` })),
    settings: { rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 3, 20: 7, 21: 2 } },
      acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 } },
    teams: espnTeams, schedule,
  };

  // Every team plays Sunday 1 PM ET except KC (bye) so byes get tested.
  const abbrs = Object.keys(PRO).filter((a) => a !== 'KC');
  const events = [];
  for (let i = 0; i + 1 < abbrs.length; i += 2) {
    events.push({ date: '2026-11-22T18:00Z', competitions: [{
      status: { type: { state: 'pre' } },
      competitors: [
        { homeAway: 'home', team: { id: String(PRO[abbrs[i]]), abbreviation: abbrs[i] } },
        { homeAway: 'away', team: { id: String(PRO[abbrs[i + 1]]), abbreviation: abbrs[i + 1] } },
      ],
      odds: [{ overUnder: 45.5, spread: -3.5, details: `${abbrs[i]} -3.5` }],
    }] });
  }

  const tx = variant === 2 ? [{ id: 'tx-1', type: 'WAIVER', status: 'EXECUTED', teamId: 3, bidAmount: 7, proposedDate: Date.now(), scoringPeriodId: WEEK,
    items: [{ type: 'ADD', playerId: Number(Object.keys(waivers)[0]), toTeamId: 3 }, { type: 'DROP', playerId: Number(teams[2].players[17][0]), fromTeamId: 3 }] }] : [];

  const faIds = Object.keys(waivers).filter((id) => adv[id]?.ros).slice(variant === 2 ? 3 : 0, variant === 2 ? 6 : 3);
  const map = Object.fromEntries(faIds.map((id, i) => [`s${i}`, id]));
  fs.mkdirSync(outDir, { recursive: true });
  const w = (f, d) => fs.writeFileSync(path.join(outDir, f), JSON.stringify(d));
  w('espn-league.json', league);
  w('espn-transactions.json', { transactions: tx });
  w('nfl-scoreboard.json', { events });
  w('sleeper-map.json', map);
  w('sleeper-add.json', faIds.map((id, i) => ({ player_id: `s${i}`, count: 900 - i * 300 })));
  w('sleeper-drop.json', []);
  return { myStarterWr: espnTeams[0].roster.entries.find((e) => e.lineupSlotId === 4)?.playerPoolEntry.player.fullName };
}

module.exports = { build };
