// The bot `node scripts/play.mjs trapdoor` plays with: it returns the keys to hold now.
// One self-contained module, no imports; info.game holds the exports of public/game.js.
// Ticks a seat takes to notice a new call: slow seats are the ones the short clocks catch.
const NOTICE = [3, 8, 26, 12, 18, 5, 22, 14];

export default function bot(snap, info) {
  const game = info.game;
  const me = info.seat;
  const x = snap.x[me];
  const y = snap.y[me];
  const { cols, rows } = game.gridFor(snap.x.length);
  const fallen = snap.st[me] === game.FALLEN;
  // The button acts on the press, so the key is let go between two of them.
  const press = info.step % 6 < 2;
  let tx = x;
  let ty = y;
  let act = false;
  if (snap.phase === game.PHASE.CALL || snap.phase === game.PHASE.DROP) {
    // The floor is rebuilt from the snapshot, exactly as draw does it.
    const floor = game.layout(snap.seed, cols * rows, snap.nsym, snap.sym, snap.safe);
    const standing = snap.x.map((ox, i) => ({ i, x: ox, y: snap.y[i] })).filter((other) => other.i !== me && snap.st[other.i] === game.ALIVE);
    let best = Infinity;
    for (let i = 0; i < floor.length; i++) {
      if (floor[i] !== snap.sym || snap.crack.includes(i)) continue;
      const px = (i % cols + 0.5) * game.TILE;
      const py = game.TOP + (Math.floor(i / cols) + 0.5) * game.TILE;
      // Standing: the nearest called plate, with a taste per seat so the crowd spreads out.
      let far = Math.hypot(px - x, py - y) + ((i * 31 + me * 77) % 90);
      // Fallen: the called plate a rival is nearest to, to crack it under them.
      if (fallen) far = Math.min(Infinity, ...standing.map((other) => Math.hypot(px - other.x, py - other.y)));
      if (far < best) { best = far; tx = px; ty = py; }
    }
    const calling = snap.phase === game.PHASE.CALL;
    if (fallen) {
      act = calling && Math.hypot(tx - x, ty - y) < 50 && snap.t > game.LOCK_TICKS + 2 && snap.crack[me] === game.NONE && press;
    } else {
      if (calling && snap.tMax - snap.t < NOTICE[me % NOTICE.length]) { tx = x; ty = y; }
      // Late in the call an even seat turns on a rival in reach and dashes into them.
      const rival = standing.find((other) => Math.hypot(other.x - x, other.y - y) < 120);
      if (rival && calling && snap.t < 18 && snap.cd[me] === 0 && me % 2 === 0) { tx = rival.x; ty = rival.y; act = press; }
    }
  } else {
    // The countdown: mill about, so the first call finds everyone somewhere else.
    const { w, h } = game.ARENA(snap.x.length);
    tx = w / 2 + Math.sin(info.step / 9 + me) * w * 0.3;
    ty = game.TOP + (h - game.TOP) / 2 + Math.cos(info.step / 7 + me * 2) * (h - game.TOP) * 0.3;
  }
  const dx = tx - x;
  const dy = ty - y;
  return { ArrowLeft: dx < -14, ArrowRight: dx > 14, ArrowUp: dy < -14, ArrowDown: dy > 14, Space: act };
}
