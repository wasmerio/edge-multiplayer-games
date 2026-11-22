// Finds a low-click connection from visible pipe shapes; no hidden answer is read.
export default function bot(snap, info) {
  const i = info.seat, g = info.game;
  if (i < 0 || snap.phase !== g.PHASE.ROUTE || snap.done[i] || !snap.active[i]) return {};
  if (g.ROUTE_TICKS - snap.t < 4 + i * 3) return {};
  const route = g.planRoute(snap.tiles, g.rotationsOf(snap, i), snap.inlet, snap.outlet);
  const pending = (route || []).filter((p) => p.turns > 0);
  const at = snap.cursor[i];
  pending.sort((a, b) => {
    const distance = (c) => Math.abs(c % 3 - at % 3) + Math.abs(Math.floor(c / 3) - Math.floor(at / 3));
    return distance(a.cell) - distance(b.cell);
  });
  if (!pending.length) return {};
  const target = pending[0].cell;
  const dx = target % 3 - at % 3, dy = Math.floor(target / 3) - Math.floor(at / 3);
  return {
    ArrowLeft: !dy && dx < 0, ArrowRight: !dy && dx > 0,
    ArrowUp: dy < 0, ArrowDown: dy > 0,
    Space: !dx && !dy && info.step % (4 + i % 3) === 0,
  };
}
