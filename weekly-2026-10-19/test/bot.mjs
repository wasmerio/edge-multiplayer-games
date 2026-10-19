// Anticipate the guest buffer, then aim at a seat-specific offset.
export default function bot(snap, info) {
  const i = info.seat;
  if (snap.phase !== info.game.PHASE.MOVE || snap.locked[i]) return { Space: false };
  const delay = info.isHost ? 1 : 4;
  const predicted = snap.x[i] + snap.dir[i] * snap.speed * delay;
  const tolerance = 4 + i * 3;
  const error = snap.base[i] - predicted;
  return { Space: Math.abs(error) < tolerance + snap.speed || snap.t < 5 };
}
