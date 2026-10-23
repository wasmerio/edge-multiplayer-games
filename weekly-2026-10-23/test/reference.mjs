// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 105182142;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Different tolerances make each builder leave a different skyline.
function bot(game, seat, tick) {
  const p = game.p[seat];
  const predicted = p.x + p.dir * rules.sweepSpeed(p.height);
  const near = Math.abs(predicted - p.base) < 6 + seat * 6;
  const reckless = seat === 3 && tick % 97 === 0;
  return { drop: !p.held && p.cd === 0 && (near || reckless) ? 1 : 0 };
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
