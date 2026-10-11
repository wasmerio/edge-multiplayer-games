let phraseKey = "";
let memory = [];
let slipped = false;

export default function bot(snap, info) {
  const key = `${info.round}:${snap.phrase}`;
  if (phraseKey !== key) { phraseKey = key; memory = []; slipped = false; }
  const g = info.game;
  const seat = info.seat;
  if (snap.phase === g.PHASE.SHOW && snap.shown > 0) {
    const index = Math.floor((snap.length * g.BEAT_TICKS - snap.t) / g.BEAT_TICKS);
    memory[index] = snap.shown;
  }
  if (snap.phase !== g.PHASE.RECALL || snap.done[seat] || snap.lock[seat]) return {};
  const elapsed = g.RECALL_TICKS - snap.t;
  const pace = 5 + seat % 4;
  if (elapsed < 8 + seat * 3 || info.step % pace !== 0) return {};
  let symbol = memory[snap.progress[seat]] || 0;
  if (symbol && !slipped && seat % 3 === 2 && snap.progress[seat] === 2) {
    symbol = symbol % 3 + 1;
    slipped = true;
  }
  return { ArrowLeft: symbol === 1, ArrowDown: symbol === 2, ArrowRight: symbol === 3 };
}
