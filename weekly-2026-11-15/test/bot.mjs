// Solve from visible fitting types, then work on the nearest misaligned tile.
export default function bot(snap, info) {
  const me = info.seat, g = info.game;
  if (me < 0 || !snap.active[me] || snap.ready || snap.flush[me] || snap.over) return {};
  const answer = g.solution(snap.shape[me]);
  const cursor = snap.cursor[me];
  let target = -1, distance = Infinity;
  for (let t = 0; t < 9; t++) {
    if (g.ports(snap.shape[me], snap.pipes[me], t) === g.ports(snap.shape[me], answer, t)) continue;
    const d = Math.abs(t % 3 - cursor % 3) + Math.abs(Math.floor(t / 3) - Math.floor(cursor / 3));
    if (d < distance) { target = t; distance = d; }
  }
  if (target < 0) return {};
  const dx = target % 3 - cursor % 3, dy = Math.floor(target / 3) - Math.floor(cursor / 3);
  // Seats take different thinking pauses, and always release the turn button.
  const cycle = 4 + me % 4;
  const thinking = info.step % (18 + me * 3) < me;
  return {
    ArrowLeft: !thinking && dx < 0, ArrowRight: !thinking && dx > 0,
    ArrowUp: !thinking && dx === 0 && dy < 0, ArrowDown: !thinking && dx === 0 && dy > 0,
    Space: !thinking && distance === 0 && info.step % cycle < 2,
  };
}
