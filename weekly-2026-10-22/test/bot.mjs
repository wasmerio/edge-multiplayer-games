// Aim a little ahead on a guest; each builder accepts a different amount of overhang.
export default function bot(snap, info) {
  const i = info.seat;
  if (snap.ready || snap.cd[i] || !snap.active[i]) return { Space: false };
  const speed = 5 + snap.level[i] * 0.35;
  const ahead = info.isHost ? 0 : 3;
  const x = snap.x[i] + snap.dir[i] * speed * ahead;
  const error = Math.abs(x - snap.base[i]);
  return { Space: error <= speed * 1.3 + i * 1.2 };
}
