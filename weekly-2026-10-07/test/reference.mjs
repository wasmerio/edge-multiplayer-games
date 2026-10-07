// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 1917459184;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Revise an opening bid downward, then seal; every intent value is used.
function bot(game, seat) {
  const p = game.p[seat];
  if (game.phase !== rules.PHASE.BID || p.locked) return { bid: 0, seal: 0 };
  const goal = Math.min(p.purse, 1 + ((game.lot * 3 + seat * 2) % 7) + (game.t > 65 ? 1 : 0));
  return {
    bid: Math.sign(goal - p.choice),
    seal: game.t < 40 - seat * 3 && p.choice === goal ? 1 : 0,
  };
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
