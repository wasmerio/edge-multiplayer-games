export default function bot(snap, info) {
  const me = info.seat;
  if (snap.ready || snap.over || snap.cd[me] || !snap.active[me]) return { Space: false };
  const speed = info.game.sweepSpeed(snap.height[me]);
  const ahead = info.isHost ? 1 : 4;
  const projected = snap.x[me] + snap.dir[me] * speed * ahead;
  const tolerance = 7 + (me % 4) * 2;
  const hesitating = (info.step + me * 3) % (13 + me * 2) < 1 + me % 3;
  return { Space: !hesitating && Math.abs(projected - snap.base[me]) < tolerance };
}
