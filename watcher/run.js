'use strict';
/* The watcher. Runs on a GitHub Actions schedule (no AI involved):
 *   1. Pulls the league from ESPN, game times and Vegas totals, and Sleeper trends.
 *   2. Reads the app's public data and engines from ./app.
 *   3. Logs what changed since the last run (state/events.json).
 *   4. Writes one small digest per scout (state/digest/*.json).
 * Run:  node watcher/run.js
 * Test: SCOUT_FIXTURES=test/fixtures APP_DIR=<app checkout> node watcher/run.js */
const fs = require('fs');
const path = require('path');
const espn = require('./espn');
const sleeper = require('./sleeper');
const app = require('./app');
const { adjustedValues, valueMoves } = require('./values');
const { detect } = require('./events');
const { lineupDigest, waiverDigest } = require('./digests');

const ROOT = path.join(__dirname, '..');
const STATE = process.env.STATE_DIR || path.join(ROOT, 'state');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

const readState = (f, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(STATE, f), 'utf8')); } catch (e) { return fallback; } };
// Digests are written compact: whitespace costs the scouts tokens and nobody reads them by hand.
const writeState = (f, data) => {
  const file = path.join(STATE, f);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (f.startsWith('digest/') ? JSON.stringify(data) : JSON.stringify(data, null, 1)) + '\n');
};

/* Live sources, or files from SCOUT_FIXTURES for tests. */
function sources() {
  const fx = process.env.SCOUT_FIXTURES;
  if (!fx) {
    return {
      league: () => espn.leagueState(cfg),
      txns: (week) => espn.transactions(cfg, week),
      games: (week) => espn.nflGames(cfg, week),
      trending: () => sleeper.trending(STATE),
    };
  }
  const load = (f) => JSON.parse(fs.readFileSync(path.join(fx, f), 'utf8'));
  return {
    league: async () => espn.parseLeague(load('espn-league.json'), cfg.season),
    txns: async () => load('espn-transactions.json').transactions || [],
    games: async () => espn.parseScoreboard(load('nfl-scoreboard.json')),
    trending: async () => sleeper.mergeTrending(load('sleeper-map.json'), load('sleeper-add.json'), load('sleeper-drop.json')),
  };
}

function resolveMyTeam(teams) {
  const want = String(cfg.myTeamName || '').toLowerCase().trim();
  const hit = Object.values(teams).find((t) => t.name.toLowerCase().trim() === want);
  return hit ? hit.id : cfg.myTeamId;
}

async function main() {
  const now = Number(process.env.SCOUT_NOW) || Date.now();
  const src = sources();
  const errors = [];
  const soft = async (label, fn, fallback) => {
    try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return fallback; }
  };

  const lg = await src.league(); // required: no league, no run
  const [txRaw, txPrev, games, trending] = await Promise.all([
    soft('transactions', () => src.txns(lg.week), []),
    soft('transactions (last week)', () => (lg.week > 1 ? src.txns(lg.week - 1) : []), []),
    soft('NFL scoreboard', () => src.games(lg.week), {}),
    soft('Sleeper trending', () => src.trending(), {}),
  ]);

  const data = app.loadData();
  const eng = app.engines();
  const vals = adjustedValues(data.values, cfg);
  const moves = valueMoves(data.trend);
  const names = Object.fromEntries(Object.entries(vals).map(([id, v]) => [id, v.n]));
  const myTeamId = resolveMyTeam(lg.teams);

  const prev = readState('snapshot.json', null);
  const snap = { at: new Date(now).toISOString(), myTeamId, ...lg, games };

  const seenList = readState('seen.json', []);
  const seen = new Set(seenList);
  const txns = eng.activity.parseTransactions([...txRaw, ...txPrev]);
  let fresh = detect({ prev, snap, cfg, myTeamId, txns, news: data.news, moves, trending, names, seen, now });
  if (!prev) fresh = []; // first run only records a baseline

  const keepMs = cfg.thresholds.eventsKeepDays * 24 * 3600e3;
  const events = [...readState('events.json', []), ...fresh].filter((e) => now - Date.parse(e.at) <= keepMs);

  const ctx = { snap, myTeamId, cfg, eng, vals, advanced: data.advanced, waivers: data.waivers, games, trending, events, now };
  writeState('digest/lineup.json', lineupDigest(ctx));
  writeState('digest/waivers.json', waiverDigest(ctx, 'waivers'));
  writeState('digest/freeagents.json', waiverDigest(ctx, 'freeagents'));
  writeState('snapshot.json', snap);
  writeState('events.json', events);
  writeState('seen.json', [...seen].slice(-4000));
  writeState('status.json', {
    lastRun: snap.at, week: snap.week, myTeam: lg.teams[myTeamId]?.name || null, myTeamId,
    newEvents: fresh.length, appDataBuilt: data.values.generatedAt || null, errors,
  });
  console.log(`Week ${snap.week}. ${fresh.length} new events. ${errors.length ? 'Warnings: ' + errors.join('; ') : 'All sources OK.'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
