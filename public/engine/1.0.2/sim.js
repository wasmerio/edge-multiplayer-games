// The shape every game's simulation satisfies. Validated before a generated
// game is written, so an autonomous author fails loudly rather than silently.
import { seededRng } from "./rng.js";

const METHODS = ["startRound", "step", "winner"];
const FIELDS = ["round", "tick", "roundOver", "scores"];

export function validateSimulation(SimulationClass, probeOpts = {}) {
  const problems = [];
  if (typeof SimulationClass !== "function") {
    throw new Error("validateSimulation: expected a simulation class");
  }
  if (SimulationClass.length < 3) {
    problems.push("constructor must accept (playerCount, opts, rng)");
  }
  for (const name of METHODS) {
    if (typeof SimulationClass.prototype?.[name] !== "function") {
      problems.push(`missing method ${name}()`);
    }
  }
  if (problems.length) throw new Error(`invalid simulation: ${problems.join("; ")}`);

  // Probe with the options a game will really receive; an empty object would
  // only prove that the constructor tolerates being starved.
  const probe = new SimulationClass(2, probeOpts, seededRng(1));
  for (const field of FIELDS) {
    if (probe[field] === undefined) problems.push(`missing field ${field}`);
  }
  if (!Array.isArray(probe.scores)) problems.push("scores must be an array");
  else if (probe.scores.length !== 2) problems.push("scores must hold one entry per player");
  if (problems.length) throw new Error(`invalid simulation: ${problems.join("; ")}`);
  return true;
}

export function simulationUsesInjectedRng(SimulationClass, playerCount = 2, probeOpts = {}) {
  const seen = { calls: 0 };
  const rng = seededRng(99);
  const spy = { ...rng, next: () => { seen.calls += 1; return rng.next(); } };
  spy.range = (lo, hi) => lo + spy.next() * (hi - lo);
  spy.int = (lo, hi) => lo + Math.floor(spy.next() * (hi - lo + 1));
  const sim = new SimulationClass(playerCount, probeOpts, spy);
  sim.startRound();
  return seen.calls > 0;
}
