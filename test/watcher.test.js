'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { build } = require('./make-fixtures');
const espn = require('../watcher/espn');
const { adjustedValues } = require('../watcher/values');

const APP = process.env.APP_DIR || path.join(__dirname, '..', 'app');
const ROOT = path.join(__dirname, '..');

test('implied totals from the home line and from the details string', () => {
  assert.deepStrictEqual(espn.impliedTotals({ overUnder: 45.5, spread: -3.5 }, 'BUF', 'MIA'), { home: 24.5, away: 21 });
  assert.deepStrictEqual(espn.impliedTotals({ overUnder: 45.5, details: 'MIA -3.5' }, 'BUF', 'MIA'), { home: 21, away: 24.5 });
  assert.strictEqual(espn.impliedTotals({ details: 'BUF -3.5' }, 'BUF', 'MIA'), null);
});

test('tight ends get the desk multiplier, everyone else keeps the app value', () => {
  const v = { format: { multipliers: { TE: { applied: 1.2 } } }, players: { 1: { n: 'A', p: 'TE', dv: 1200, wn: 600 }, 2: { n: 'B', p: 'WR', dv: 1200, wn: 600 } } };
  const out = adjustedValues(v, { teMultiplier: 1.5 });
  assert.strictEqual(out[1].dv, 1500);
  assert.strictEqual(out[1].wn, 750);
  assert.strictEqual(out[2].dv, 1200);
});

test('two watcher runs: baseline, then an injury and a waiver move become events and digests', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-'));
  const state = path.join(tmp, 'state');
  const run = (fx) => execFileSync('node', [path.join(ROOT, 'watcher/run.js')], {
    env: { ...process.env, SCOUT_FIXTURES: fx, APP_DIR: APP, STATE_DIR: state, SCOUT_NOW: String(Date.parse('2026-11-22T16:45:00Z')) },
  }).toString();

  build(APP, path.join(tmp, 'fx1'), 1);
  const { myStarterWr } = build(APP, path.join(tmp, 'fx2'), 2);
  run(path.join(tmp, 'fx1'));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(state, 'events.json'))), [], 'first run is a baseline');

  run(path.join(tmp, 'fx2'));
  const events = JSON.parse(fs.readFileSync(path.join(state, 'events.json')));
  const inj = events.find((e) => e.type === 'injury' && e.mine);
  assert.ok(inj, 'my starter going OUT is logged');
  assert.strictEqual(inj.name, myStarterWr);
  assert.ok(events.find((e) => e.type === 'move' && e.teamId === 3), 'rival waiver move is logged');
  assert.ok(events.find((e) => e.type === 'trending'), 'Sleeper trending add is logged');

  const status = JSON.parse(fs.readFileSync(path.join(state, 'status.json')));
  assert.strictEqual(status.myTeam, 'Toe Guano');
  assert.deepStrictEqual(status.errors, []);

  const lineup = JSON.parse(fs.readFileSync(path.join(state, 'digest/lineup.json')));
  assert.strictEqual(lineup.quiet, false);
  assert.ok(lineup.issues.some((i) => i.name === myStarterWr && i.why === 'out'));
  assert.ok(lineup.swaps && lineup.swaps.benchThese.some((p) => p.name === myStarterWr), 'suggests benching the OUT starter');
  assert.ok(lineup.matchup && lineup.matchup.winProb > 0 && lineup.matchup.winProb < 1);

  for (const f of ['lineup', 'waivers', 'freeagents']) {
    const bytes = fs.statSync(path.join(state, `digest/${f}.json`)).size;
    assert.ok(bytes < 12000, `${f} digest stays small (${bytes} bytes)`);
  }
  const wv = JSON.parse(fs.readFileSync(path.join(state, 'digest/waivers.json')));
  assert.strictEqual(wv.me.faabLeft, 80);
  assert.strictEqual(wv.needs.length, 4);
});
