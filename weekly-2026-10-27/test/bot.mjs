// Solves visible geometry only; slower seats leave room for a competitive spread.
export default function bot(snap, info) {
  const i = info.seat, g = info.game;
  if (i < 0 || snap.ready || snap.over || !snap.active[i] || snap.pause[i] || snap.done[i] >= g.REPAIRS) return {};
  if (info.step % (4 + i) !== 0) return {};
  const target = g.plan(snap.board[i], snap.inlet[i], snap.outlet[i]).find(({ cell, code }) => g.tileAt(snap.board[i], cell) !== code);
  if (!target) return {};
  const forward = (target.cell - snap.cursor[i] + 9) % 9;
  return { ArrowLeft: forward > 4, ArrowRight: forward > 0 && forward <= 4, Space: forward === 0 };
}
