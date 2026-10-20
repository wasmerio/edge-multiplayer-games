export default function bot(snap, info) {
  const g = info.game;
  const me = info.seat;
  if (snap.state[me] !== 0 || !snap.active[me]) return {};
  const launch = g.launchAt(g.ARENA);
  const dx = snap.tx - launch.x;
  const dy = snap.ty + (me % 3 - 1) * 17 - launch.y;
  const desired = Math.atan2(dy, dx) * 180 / Math.PI;
  const error = desired - snap.angle[me];
  let weight = 0;
  while (weight < g.MAX_CHARGE && g.travelFor(weight) < Math.hypot(dx, dy)) weight++;
  const ready = snap.phase === g.PHASE.AIM && snap.turn === me && Math.abs(error) < 1.6;
  return {
    ArrowLeft: error < -0.7,
    ArrowRight: error > 0.7,
    Space: ready && snap.charge < weight - (info.isHost ? 0 : 3) + (me % 2),
  };
}
