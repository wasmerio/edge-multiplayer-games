let last = null;
export default function bot(snap, info) {
  const i = info.seat;
  const x = snap.x[i];
  let dir = x < (info.game.BED - snap.width[i]) / 2 ? 1 : -1;
  if (last && last.course === snap.course && last.round === info.round) {
    dir = x === last.x ? last.dir : Math.sign(x - last.x);
  }
  last = { x, dir, course: snap.course, round: info.round };
  const lead = info.isHost ? 1 : 4;
  const predicted = x + dir * info.game.speedFor(snap.course) * lead;
  const offset = [0, 9, -16, 23, -8, 32, -24, 12][i % 8];
  const aligned = Math.abs(predicted - snap.baseX[i] - offset) < 6;
  return { Space: !snap.ready && !snap.locked[i] && (aligned || snap.t < 5) };
}
