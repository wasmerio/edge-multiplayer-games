export default function bot(snap, info) {
  const i = info.seat;
  const height = snap.height[i];
  const top = height ? snap[`cx${(height - 1) % info.game.HISTORY}`][i] : 160;
  const speed = info.game.slabSpeed(height);
  const lead = info.isHost ? 0 : 4;
  const nextX = snap.x[i] + snap.dir[i] * speed * lead;
  const tolerance = 6 + i * 1.7;
  return { Space: !snap.ready && !snap.cd[i] && Math.abs(nextX - top) <= tolerance };
}
