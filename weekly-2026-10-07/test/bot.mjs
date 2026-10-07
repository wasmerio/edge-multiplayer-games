// Distinct private valuations; no peeking at other seats' sealed offers.
export default function bot(snap, info) {
  const i = info.seat;
  if (i < 0 || !snap.active[i] || snap.phase !== info.game.PHASE.BID || snap.locked[i]) return {};
  const appetite = 1 + ((snap.lot * 5 + i * 3 + info.round) % 7);
  const goal = Math.min(snap.purse[i], appetite + (snap.value >= 7 ? 1 : 0));
  const delta = goal - snap.choice[i];
  return {
    ArrowLeft: delta < 0,
    ArrowRight: delta > 0,
    Space: delta === 0 && snap.t < 80 - i * 5,
  };
}
