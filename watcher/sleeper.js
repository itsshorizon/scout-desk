'use strict';
/* Sleeper trending adds and drops: the market moving before values do.
 * Sleeper ids are mapped to ESPN ids through Sleeper's player database, which is
 * about 5 MB, so the id map is cached in state/ and refreshed weekly. */
const fs = require('fs');
const path = require('path');
const { fetchJSON } = require('./http');

const BASE = 'https://api.sleeper.app/v1/players/nfl';
const MAP_MAX_AGE = 7 * 24 * 3600e3;

async function idMap(stateDir, now = Date.now()) {
  const file = path.join(stateDir, 'sleeper-espn-map.json');
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (now - Date.parse(cached.at) < MAP_MAX_AGE) return cached.map;
  } catch (e) { /* rebuild */ }
  const db = await fetchJSON(BASE);
  const map = buildMap(db);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ at: new Date(now).toISOString(), map }));
  return map;
}

function buildMap(db) {
  const map = {};
  for (const [sid, p] of Object.entries(db || {})) {
    if (p && p.espn_id && ['QB', 'RB', 'WR', 'TE'].includes(p.position)) map[sid] = String(p.espn_id);
  }
  return map;
}

/* { espnId: { add, drop } } over the last 24 hours. */
async function trending(stateDir) {
  const [map, adds, drops] = await Promise.all([
    idMap(stateDir),
    fetchJSON(`${BASE}/trending/add?lookback_hours=24&limit=50`),
    fetchJSON(`${BASE}/trending/drop?lookback_hours=24&limit=50`),
  ]);
  return mergeTrending(map, adds, drops);
}

function mergeTrending(map, adds, drops) {
  const out = {};
  for (const [list, key] of [[adds, 'add'], [drops, 'drop']]) {
    for (const r of list || []) {
      const espn = map[r.player_id];
      if (!espn) continue;
      (out[espn] = out[espn] || { add: 0, drop: 0 })[key] = r.count || 0;
    }
  }
  return out;
}

module.exports = { trending, buildMap, mergeTrending };
