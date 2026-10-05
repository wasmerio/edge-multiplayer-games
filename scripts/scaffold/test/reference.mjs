// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = {{seed}};
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// A scripted player: head for the pellet, boost now and then. Every intent value is used.
function bot(game, seat, tick) {
  const me = game.p[seat];
  const dx = game.pellet.x - me.x;
  const dy = game.pellet.y - me.y;
  const lazy = (tick + seat * 7) % 40 < 6;
  return {
    mx: lazy ? 0 : Math.sign(Math.round(dx / 8)),
    my: lazy ? 0 : Math.sign(Math.round(dy / 8)),
    boost: (tick + seat * 11) % 50 < 3 ? 1 : 0,
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
