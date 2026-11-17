'use strict';
/* Compares the new snapshot with the last one and logs what changed.
 * Each event has a stable key, so the same change is never logged twice. */

const OUTISH = new Set(['OUT', 'DOUBTFUL', 'INJURY_RESERVE', 'SUSPENSION', 'QUESTIONABLE']);

function rosterIndex(snap) {
  const idx = {};
  for (const [teamId, list] of Object.entries(snap?.rosters || {})) {
    for (const p of list) idx[p.id] = { ...p, teamId: Number(teamId) };
  }
  return idx;
}

function detect({ prev, snap, cfg, myTeamId, txns, news, moves, trending, names, seen, now }) {
  const out = [];
  const add = (key, ev) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, at: new Date(now).toISOString(), ...ev });
  };
  const nowIdx = rosterIndex(snap);
  const prevIdx = rosterIndex(prev);
  const nm = (id) => names[id] || nowIdx[id]?.name || prevIdx[id]?.name || `Player ${id}`;

  // 1. Injury status changes on any rostered player. Skipped on the very first run.
  if (prev) {
    for (const [id, p] of Object.entries(nowIdx)) {
      const before = prevIdx[id]?.inj;
      if (before && before !== p.inj && (OUTISH.has(p.inj) || OUTISH.has(before))) {
        add(`inj:${id}:${snap.week}:${before}>${p.inj}`, {
          type: 'injury', id, name: p.name, pos: p.pos, teamId: p.teamId,
          mine: p.teamId === myTeamId, starter: !['BE', 'IR'].includes(p.slot), from: before, to: p.inj,
        });
      }
    }
  }

  // 2. League transactions (adds, drops, trades), newest first.
  for (const mv of txns || []) {
    const ids = [...mv.adds.map((a) => a.playerId), ...mv.drops.map((d) => d.playerId), ...mv.trades.map((t) => t.playerId)].map(String);
    const teams = new Set([mv.teamId, ...mv.trades.flatMap((t) => [t.fromTeamId, t.toTeamId])].filter((x) => x != null));
    add(`txn:${mv.id}`, {
      type: mv.kind === 'trade' ? 'trade' : 'move', teamId: mv.teamId ?? null,
      mine: teams.has(myTeamId), bid: mv.bid || null,
      adds: mv.adds.map((a) => ({ id: String(a.playerId), name: nm(String(a.playerId)), teamId: a.teamId })),
      drops: mv.drops.map((d) => ({ id: String(d.playerId), name: nm(String(d.playerId)), teamId: d.teamId })),
      trades: mv.trades.map((t) => ({ id: String(t.playerId), name: nm(String(t.playerId)), from: t.fromTeamId, to: t.toTeamId })),
      touchesMyPlayer: ids.some((id) => prevIdx[id]?.teamId === myTeamId || nowIdx[id]?.teamId === myTeamId),
    });
  }

  // 3. Fresh headlines for my players (app news file, refreshed 3x a day).
  for (const [id, p] of Object.entries(nowIdx)) {
    if (p.teamId !== myTeamId) continue;
    const latest = (news?.players?.[id] || [])[0];
    if (!latest || !latest.t || now - Date.parse(latest.t) > 48 * 3600e3) continue;
    add(`news:${id}:${latest.t}`, { type: 'news', id, name: p.name, mine: true, headline: latest.h, when: latest.t });
  }

  // 4. Value moves on my players, once per data day.
  const th = cfg.thresholds;
  for (const [id, p] of Object.entries(nowIdx)) {
    if (p.teamId !== myTeamId) continue;
    const m = moves[id];
    if (!m || m.pct1 == null || Math.abs(m.pct1) < th.valueMovePct) continue;
    add(`value:${id}:${m.day}`, { type: 'value', id, name: p.name, mine: true, pct1: round3(m.pct1), pct7: round3(m.pct7) });
  }

  // 5. Unrostered players the wider market is grabbing (Sleeper adds in 24h).
  for (const [id, t] of Object.entries(trending || {})) {
    if (nowIdx[id] || (t.add || 0) < th.trendingAdds) continue;
    const day = new Date(now).toISOString().slice(0, 10);
    add(`trend:${id}:${day}`, { type: 'trending', id, name: nm(id), mine: false, adds24h: t.add });
  }
  return out;
}

const round3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

module.exports = { detect, rosterIndex };
