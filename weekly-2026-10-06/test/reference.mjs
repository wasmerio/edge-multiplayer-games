// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 1900681565;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Overshoot early, then settle and seal; exercises both adjustment directions.
function bot(game, seat, tick) {
  const offer = Math.min(game.wallet[seat], 9, Math.max(1, game.values[game.lot] + ((seat + game.lot + game.round) % 5) - 2));
  const aim = game.t > 100 ? Math.min(9, offer + 2) : offer;
  return {
    adjust: Math.sign(aim - game.bid[seat]),
    seal: game.phase === rules.PHASE.BID && game.t < 40 - seat * 3 && tick % 4 < 2 ? 1 : 0,
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
