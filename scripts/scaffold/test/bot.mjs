// The bot `node scripts/play.mjs` plays this game with: it reads the snapshot on screen and
// returns the keys to hold now. One self-contained module: no imports. info.game holds the
// exports of public/game.js. Rewrite it with your rules, so rounds 2 and later can be seen.
export default function bot(snap, info) {
  const me = info.seat;
  const dx = snap.px - snap.x[me];
  const dy = snap.py - snap.y[me];
  // Each seat rests at its own moments, so the players do not move as one.
  const rests = (info.step + me * 7) % 40 < 4 + me * 2;
  return {
    ArrowLeft: !rests && dx < -6,
    ArrowRight: !rests && dx > 6,
    ArrowUp: !rests && dy < -6,
    ArrowDown: !rests && dy > 6,
    // A boost acts on the press, so the key is let go between two of them.
    Space: snap.cd[me] === 0 && Math.hypot(dx, dy) > info.game.BOOST_SPEED * 12 && info.step % 4 < 2,
  };
}
