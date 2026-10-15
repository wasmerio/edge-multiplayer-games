let last = null;
export default function bot(snap, info) {
  const i = info.seat;
  const x = snap.x[i];
  let velocity = 0;
  if (last && last.round === info.round && snap.k > last.k && last.cd === 0 && snap.cd[i] === 0) {
    velocity = (x - last.x) / (snap.k - last.k);
  }
  last = { x, k: snap.k, cd: snap.cd[i], round: info.round };
  if (snap.ready || snap.cd[i] || snap.over) return { Space: false };
  // Anticipate the guest interpolation buffer; seats have distinct alignment habits.
  const projected = x + velocity * (info.isHost ? 1 : 4);
  const aim = snap.base[i] + i * 0.45;
  return { Space: Math.abs(projected - aim) < 1.25 + (i % 3) * 0.15 };
}
