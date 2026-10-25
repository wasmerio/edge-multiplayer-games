// Solve visible topology, then fix the nearest mismatched tile. No hidden answer.
export default function bot(snap, info) {
  const i = info.seat, g = info.game;
  if (snap.ready || snap.over || snap.flash[i] || snap.stage[i] >= g.CIRCUITS || !snap.active[i]) return {};
  const types = snap.types[snap.stage[i]], board = snap.board[i];
  const answer = g.solution(types, board);
  if (answer < 0) return {};
  const cursor = snap.cursor[i];
  const wrong = (tile) => g.ports(types, board, tile) !== g.ports(types, answer, tile);
  const period = 4 + i % 3;
  if (info.step % period !== 0) return {};
  if (wrong(cursor)) return { Space: true };
  for (let distance = 1; distance <= 4; distance++) {
    if (wrong((cursor + distance) % 9)) return { ArrowRight: true };
    if (wrong((cursor - distance + 9) % 9)) return { ArrowLeft: true };
  }
  return {};
}
