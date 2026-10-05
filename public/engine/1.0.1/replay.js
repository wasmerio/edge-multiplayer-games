// A fixture is newline-delimited JSON: one header line, then one line per
// recorded event. Replaying it must reach the recorded final state exactly.
import { seededRng } from "./rng.js";

export function record({ seed, tickHz, players }) {
  const lines = [];
  return {
    round: () => lines.push(JSON.stringify({ e: "r" })),
    tick: (inputs) => lines.push(JSON.stringify({ e: "t", i: [...inputs] })),
    finish: (sim) => {
      const header = {
        seed, tickHz, players,
        events: lines.length,
        final: finalState(sim),
      };
      return [JSON.stringify(header), ...lines].join("\n") + "\n";
    },
  };
}

export function finalState(sim) {
  return { round: sim.round, tick: sim.tick, roundOver: sim.roundOver, scores: [...sim.scores] };
}

export function parseFixture(text) {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("parseFixture: empty fixture");
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line) => JSON.parse(line));
  if (header.events !== events.length) {
    throw new Error(`parseFixture: header declares ${header.events} events, found ${events.length}`);
  }
  return { header, events };
}

export function replay(text, simFactory) {
  const { header, events } = parseFixture(text);
  const sim = simFactory(header.players, {}, seededRng(header.seed));
  for (const [index, event] of events.entries()) {
    if (event.e === "r") {
      sim.startRound();
    } else if (event.e === "t") {
      if (event.i.length !== header.players) {
        throw new Error(`replay: event ${index} holds ${event.i.length} inputs for ${header.players} players`);
      }
      // Frozen so a simulation that writes to its inputs fails here, where the
      // divergence is cheap to find, rather than on a remote guest.
      sim.step(Object.freeze([...event.i]));
    } else {
      throw new Error(`replay: event ${index} has unknown kind ${JSON.stringify(event.e)}`);
    }
  }
  const reached = finalState(sim);
  if (header.final && JSON.stringify(reached) !== JSON.stringify(header.final)) {
    throw new Error(`replay: diverged\n  recorded ${JSON.stringify(header.final)}\n  reached  ${JSON.stringify(reached)}`);
  }
  return reached;
}
