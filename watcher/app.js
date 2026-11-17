'use strict';
/* Reads the Dynasty Companion app's public data and engines from a local checkout
 * (the workflow checks the app repo out into ./app). Nothing here writes to the app. */
const fs = require('fs');
const path = require('path');

function appDir() {
  return process.env.APP_DIR || path.join(__dirname, '..', 'app');
}

function readJSON(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(appDir(), rel), 'utf8')); } catch (e) { return fallback; }
}

function loadData() {
  return {
    values: readJSON('data/values.json', { players: {}, format: {} }),
    advanced: readJSON('data/advanced.json', { players: {}, defense: {}, defenseAvg: {} }),
    waivers: readJSON('data/waivers.json', { players: {} }),
    news: readJSON('data/news.json', { players: {} }),
    trend: readJSON('data/trend.json', { days: [], p: {} }),
  };
}

function engines() {
  const req = (f) => require(path.join(appDir(), f));
  return {
    leverage: req('edge-leverage.js'),
    risers: req('edge-risers.js'),
    activity: req('activity-engine.js'),
    push: req('push-engine.js'),
  };
}

module.exports = { loadData, engines, appDir };
