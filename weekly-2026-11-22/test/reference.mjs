// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 1429802564;
export const PLAYERS = 4;
// The board the host builds: the game's exported ARENA (a size, or a function of the player count), else the engine's default.
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

// Script all three fields; seats have different reaction and click tempos.
function bot(game, seat, tick) {
  if (game.phase !== rules.PHASE.ROUTE || game.done[seat]) return 0;
  const route = rules.planRoute(game.tiles, game.rot[seat], game.inlet, game.outlet);
  const next = route?.find((p) => p.turns > 0);
  if (!next || tick % (seat + 2) !== 0) return 0;
  const at = game.cursor[seat];
  const dy = Math.sign(Math.floor(next.cell / 3) - Math.floor(at / 3));
  const dx = dy ? 0 : Math.sign(next.cell % 3 - at % 3);
  return { mx: dx, my: dy, turn: !dx && !dy ? 1 : 0 };
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
