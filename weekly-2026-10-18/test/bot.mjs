// Each seat has a different placement tolerance; guests lead their delayed image.
export default function bot(snap, info) {
  const i = info.seat;
  if (i < 0 || snap.ready || snap.over || !snap.active[i] || snap.cd[i]) return { Space: false };
  const speed = info.game.speedFor(snap.height[i]);
  const predicted = snap.bx[i] + snap.dir[i] * speed * (info.isHost ? 0 : 3);
  const bias = i * 3;
  return { Space: Math.abs(predicted - snap.x0[i] - bias) <= 6 };
}
