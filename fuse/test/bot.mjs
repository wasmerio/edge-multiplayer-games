// The bot `node scripts/play.mjs fuse` plays with: it returns the keys to hold now.
// One self-contained module, no imports; info.game holds the exports of public/game.js.
export default function bot(snap, info) {
  const me = info.seat;
  const x = snap.x[me];
  const y = snap.y[me];
  const living = snap.x
    .map((ox, i) => ({ i, x: ox, y: snap.y[i], far: Math.hypot(ox - x, snap.y[i] - y) }))
    .filter((other) => other.i !== me && snap.alive[other.i])
    .sort((a, b) => a.far - b.far);
  // The dash acts on the press, so the key is let go between two of them.
  const press = info.step % 6 < 2;
  let tx = x;
  let ty = y;
  let dash = false;
  if (!snap.alive[me]) {
    // A ghost follows the nearest runner and shoves when it is close.
    if (living[0]) { tx = living[0].x; ty = living[0].y; dash = living[0].far < info.game.BOO_R * 0.7 && snap.cd[me] === 0 && press; }
  } else if (snap.holder === me) {
    // The holder hunts the nearest runner it may pass to, and lunges at the end.
    const prey = living.find((other) => !snap.safe[other.i]) ?? living[0];
    if (prey) { tx = prey.x; ty = prey.y; dash = prey.far < 150 && prey.far > 50 && snap.cd[me] === 0 && press; }
  } else if (snap.holder >= 0) {
    // A runner flees once the holder is near; a seat with a higher number notices later.
    const hx = snap.x[snap.holder];
    const hy = snap.y[snap.holder];
    const far = Math.max(1, Math.hypot(x - hx, y - hy));
    const { w, h } = info.game.ARENA(snap.x.length);
    if (far < 380 - me * 35) {
      // Away from the bomb, with a pull to the middle so a corner is not a trap.
      tx = x + ((x - hx) / far + ((w / 2 - x) / w) * 1.8) * 100;
      ty = y + ((y - hy) / far + ((h / 2 - y) / h) * 1.8) * 100;
      dash = far < 95 && snap.cd[me] === 0 && press;
    }
  }
  const dx = tx - x;
  const dy = ty - y;
  return { ArrowLeft: dx < -10, ArrowRight: dx > 10, ArrowUp: dy < -10, ArrowDown: dy > 10, Space: dash };
}
