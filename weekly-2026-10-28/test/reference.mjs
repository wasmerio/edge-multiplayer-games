import * as rules from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = 1920628333;
export const PLAYERS = 4;
export const arenaOf = (n) => (typeof rules.ARENA === "function" ? rules.ARENA(n) : rules.ARENA ?? arenaFor(n));
export const build = (n, opts, rng) => new rules.Game(n, opts?.arena ? opts : { arena: arenaOf(n) }, rng);

export function scripted(game, seat) {
  const p = game.p[seat];
  const error = [0, 14, -24, 36][seat % 4];
  const near = Math.abs(p.x + p.dir * rules.speedFor(game.course) - p.baseX - error) < 4;
  return { press: !game.ready && !p.locked && (near || game.t === 2) ? 1 : 0 };
}

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 3; round++) {
    rec.round();
    game.startRound();
    while (!game.roundOver) {
      const intents = Array.from({ length: PLAYERS }, (_, i) => scripted(game, i));
      rec.tick(intents);
      game.step(intents);
    }
  }
  return rec.finish(game);
}
