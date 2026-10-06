// Seat-specific valuations use only public lot, purse, and this seat's own offer.
export default function bot(snap, info) {
  const me = info.seat;
  if (snap.phase !== info.game.PHASE.BID || snap.locked[me] || snap.gone[me]) return {};
  const lotsLeft = info.game.LOTS - snap.lot;
  const reserve = Math.max(0, lotsLeft - 2);
  const taste = ((me + 3) * 17 + snap.lot * (me + 1) * 11 + info.round * 7) % 9 - 4;
  const offer = Math.max(0, Math.min(9, snap.wallet[me] - reserve, snap.values[snap.lot] + taste));
  return {
    ArrowLeft: snap.bid[me] > offer,
    ArrowRight: snap.bid[me] < offer,
    Space: snap.bid[me] === offer && snap.t < 70 - me * 3 && info.step % 6 < 3,
  };
}
