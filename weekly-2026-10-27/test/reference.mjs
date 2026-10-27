// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 38071666;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Solve only visible pipe geometry, with different reaction cadences per seat.
function bot(game, seat, tick) {
  const p = game.p[seat];
  if (game.ready || p.pause || p.done === rules.REPAIRS || tick % (4 + seat * 2)) return { select: 0, turn: 0 };
  const target = rules.plan(p.board, p.inlet, p.outlet).find(({ cell, code }) => rules.tileAt(p.board, cell) !== code);
  if (!target) return { select: 0, turn: 0 };
  const forward = (target.cell - p.cursor + 9) % 9;
  return { select: forward === 0 ? 0 : forward <= 4 ? 1 : -1, turn: forward === 0 ? 1 : 0 };
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
