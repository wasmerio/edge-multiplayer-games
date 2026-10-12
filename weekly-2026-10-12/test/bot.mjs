// Remember only the displayed cue, never the hidden answer during weaving.
let identity = "";
let memory = [];
let selected = 0;
let previousPhase = -1;
let calls = 0;

export default function bot(snap, info) {
  const id = `${info.round}:${snap.panel}`;
  if (id !== identity || snap.k < 3) { identity = id; memory = []; selected = 0; }
  if (snap.phase === info.game.PHASE.WATCH && snap.cursor >= 0) memory[snap.cursor] = snap.pattern[snap.cursor];
  if (previousPhase !== snap.phase) { calls = 0; selected = 0; previousPhase = snap.phase; }
  const me = info.seat;
  const cycle = 8 + me;
  if (snap.phase === info.game.PHASE.WEAVE && snap.active[me] && snap.progress[me] < snap.length && snap.cd[me] === 0) {
    if (calls % cycle === 0) selected = memory[snap.progress[me]] || 0;
    if (calls % cycle >= 2) selected = 0;
  } else selected = 0;
  calls += 1;
  return { KeyA: selected === 1, KeyS: selected === 2, KeyD: selected === 3 };
}
