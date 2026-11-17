'use strict';
/* The app's values, with the desk's own tight end premium.
 * The app multiplies each position by a league-format bump capped at 1.2x.
 * The desk swaps the TE bump for config.teMultiplier (1.5x). Nothing else changes. */

function teFactor(values, cfg) {
  const applied = Number(values?.format?.multipliers?.TE?.applied) || 1.2;
  return (Number(cfg.teMultiplier) || applied) / applied;
}

/* id -> { n, p, t, a, dv, wn, w } with TE values rescaled. */
function adjustedValues(values, cfg) {
  const f = teFactor(values, cfg);
  const out = {};
  for (const [id, p] of Object.entries(values?.players || {})) {
    const k = p.p === 'TE' ? f : 1;
    out[id] = {
      n: p.n, p: p.p, t: p.t, a: p.a, w: p.w,
      dv: p.dv != null ? Math.round(p.dv * k) : null,
      wn: p.wn != null ? Math.round(p.wn * k) : null,
    };
  }
  return out;
}

/* Value change over the last 1 and 7 data days, from the app's trend file.
 * Percent moves are the same whatever the TE bump, so raw app values are used. */
function valueMoves(trend) {
  const out = {};
  const n = (trend?.days || []).length;
  if (n < 2) return out;
  for (const [id, series] of Object.entries(trend.p || {})) {
    if (!Array.isArray(series) || series.length < 2) continue;
    const now = series[series.length - 1];
    const d1 = series[series.length - 2];
    const d7 = series[Math.max(0, series.length - 8)];
    out[id] = {
      day: trend.days[n - 1],
      pct1: d1 ? (now - d1) / d1 : null,
      pct7: d7 ? (now - d7) / d7 : null,
    };
  }
  return out;
}

module.exports = { teFactor, adjustedValues, valueMoves };
