// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 1383330404;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Three solvers and one wandering apprentice exercise all intent values.
function bot(game, seat, tick, solution) {
  if (seat === 3) return { mx: Math.floor(tick / 17) % 3 - 1, my: Math.floor(tick / 23) % 3 - 1, turn: tick % 11 === 0 ? 1 : 0 };
  const p = game.p[seat];
  if (game.ready || p.done || tick % (5 + seat * 4)) return { mx: 0, my: 0, turn: 0 };
  const target = game.tiles.findIndex((_, i) => rules.tileAt(game.tiles, p.rot, i) !== rules.tileAt(game.tiles, solution, i));
  if (target < 0) return 0;
  const dx = Math.sign(target % 3 - p.cursor % 3);
  const dy = Math.sign(Math.floor(target / 3) - Math.floor(p.cursor / 3));
  return { mx: dx, my: dx ? 0 : dy, turn: target === p.cursor ? 1 : 0 };
}

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 3; round++) {
    rec.round();
    game.startRound();
    const solution = rules.solveBoard(game.tiles);
    for (let tick = 0; tick < 1500 && !game.roundOver; tick++) {
      const intents = Array.from({ length: PLAYERS }, (_, seat) => bot(game, seat, tick, solution));
      rec.tick(intents);
      game.step(intents);
    }
  }
  return rec.finish(game);
}
