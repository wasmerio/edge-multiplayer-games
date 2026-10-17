let plan = null;
let types = -1;
export default function bot(snap, info) {
  const me = info.seat, g = info.game;
  if (snap.phase !== g.PHASE.WORK || snap.solved[me]) return {};
  if (types !== snap.types) { types = snap.types; plan = g.solutionFor(types); }
  if (!plan || info.step % (3 + me % 3) !== 0) return {};
  const cursor = snap.cursor[me];
  const needs = plan.route.filter(cell => g.ports(types, snap.rot[me], cell) !== g.ports(types, plan.rot, cell));
  if (!needs.length) return {};
  if (needs.includes(cursor)) return { Space: true };
  const target = needs.reduce((best, c) => Math.min((c - cursor + 9) % 9, (cursor - c + 9) % 9) < Math.min((best - cursor + 9) % 9, (cursor - best + 9) % 9) ? c : best);
  const right = (target - cursor + 9) % 9 <= 4;
  return { ArrowRight: right, ArrowLeft: !right };
}
