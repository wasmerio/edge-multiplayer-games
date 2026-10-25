// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 4516428;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// All intent values are used; seats differ in their thinking cadence.
function bot(game, seat, tick) {
  const p = game.p[seat];
  const neutral = { select: 0, rotate: 0 };
  if (game.ready || p.flash || p.stage >= rules.CIRCUITS || tick % (4 + seat * 2)) return neutral;
  const types = game.types[p.stage], answer = rules.solution(types, p.board);
  const wrong = (tile) => rules.ports(types, p.board, tile) !== rules.ports(types, answer, tile);
  if (wrong(p.cursor)) return { select: 0, rotate: 1 };
  for (let distance = 1; distance <= 4; distance++) {
    if (wrong((p.cursor + distance) % 9)) return { select: 1, rotate: 0 };
    if (wrong((p.cursor - distance + 9) % 9)) return { select: -1, rotate: 0 };
  }
  return neutral;
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
