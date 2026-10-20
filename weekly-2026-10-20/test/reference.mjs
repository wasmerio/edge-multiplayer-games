// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 54849285;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Aim at different parts of the house; later stones sometimes attack the button.
function bot(game, seat, tick) {
  const launch = rules.launchAt(game.arena);
  const dy = game.ty + (seat - 1.5) * 13 - launch.y;
  const dx = game.tx - launch.x;
  const desired = Math.atan2(dy, dx) * 180 / Math.PI;
  const error = desired - game.p[seat].angle;
  const distance = Math.hypot(dx, dy);
  let weight = 0;
  while (weight < rules.MAX_CHARGE && rules.travelFor(weight) < distance) weight++;
  return {
    aim: Math.abs(error) > 0.5 ? Math.sign(error) : 0,
    slide: game.phase === rules.PHASE.AIM && game.turn === seat && Math.abs(error) < 1 && game.charge < weight + (seat % 2) ? 1 : 0,
  };
}

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 3; round++) {
    rec.round();
    game.startRound();
    for (let tick = 0; tick < 2500 && !game.roundOver; tick++) {
      const intents = Array.from({ length: PLAYERS }, (_, seat) => bot(game, seat, tick));
      rec.tick(intents);
      game.step(intents);
    }
  }
  return rec.finish(game);
}
