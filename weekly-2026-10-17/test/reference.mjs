// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 node test/game.test.mjs
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 1917606279;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Solve the visible geometry; different work rhythms exercise both directions and press edges.
function bot(game, seat, tick) {
  if (game.phase !== rules.PHASE.WORK || game.p[seat].solved || tick % (3 + seat) !== 0) return { select: 0, rotate: 0 };
  const plan = rules.solutionFor(game.types), me = game.p[seat];
  const needs = plan.route.filter(c => rules.ports(game.types, me.rot, c) !== rules.ports(game.types, plan.rot, c));
  if (!needs.length) return { select: 0, rotate: 0 };
  if (needs.includes(me.cursor)) return { select: 0, rotate: 1 };
  const next = needs[0];
  return { select: (next - me.cursor + 9) % 9 <= 4 ? 1 : -1, rotate: 0 };
}

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 3; round++) {
    rec.round();
    game.startRound();
    for (let tick = 0; tick < 1500 && !game.roundOver; tick++) {
      const intents = Array.from({ length: PLAYERS }, (_, seat) => bot(game, seat, tick));
      rec.tick(intents);
      game.step(intents);
    }
  }
  return rec.finish(game);
}
