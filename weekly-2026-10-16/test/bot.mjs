let held = false;

export default function bot(snap, info) {
  const i = info.seat;
  if (snap.ready || snap.cd[i] || snap.over) { held = false; return {}; }
  // Allow a little travel for the guest buffer; seats favour different tolerances.
  const ahead = info.isHost ? 1 : 4;
  const predicted = snap.x[i] + snap.dir[i] * info.game.speedFor(snap.height[i]) * ahead;
  const error = Math.abs(predicted - snap.centre[i]);
  const press = !held && error < 4 + i * 1.5;
  held = press;
  return { Space: press };
}
