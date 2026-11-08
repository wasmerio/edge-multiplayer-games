let boardKey = "", solution = -1;
export default function bot(snap, info) {
  const me = info.seat, game = info.game;
  if (me < 0 || snap.over || snap.ready || !snap.active[me] || snap.done[me]) return {};
  const key = snap.tiles.join(",");
  if (key !== boardKey) { boardKey = key; solution = game.solveBoard(snap.tiles); }
  if (solution < 0) return {};
  // Deliberate taps leave time for a guest's echoed cursor to arrive.
  if (info.step % (6 + me * 2) !== 0) return {};
  let target = -1;
  for (let i = 0; i < 9; i++) {
    if (game.tileAt(snap.tiles, snap.rot[me], i) !== game.tileAt(snap.tiles, solution, i)) { target = i; break; }
  }
  if (target < 0) return {};
  const cursor = snap.cursor[me];
  const dx = target % 3 - cursor % 3;
  const dy = Math.floor(target / 3) - Math.floor(cursor / 3);
  return { ArrowLeft: dx < 0, ArrowRight: dx > 0, ArrowUp: dx === 0 && dy < 0, ArrowDown: dx === 0 && dy > 0, Space: cursor === target };
}
