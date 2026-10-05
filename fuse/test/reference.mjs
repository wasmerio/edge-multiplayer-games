// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import { Game, ARENA } from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { record } from "../../engine/replay.js";

export const SEED = 171135249;
export const PLAYERS = 4;
export const build = (n, opts, rng) => new Game(n, opts?.arena ? opts : { arena: ARENA(n) }, rng);

const sign = (v) => (v > 12 ? 1 : v < -12 ? -1 : 0);

// Scripted players: the holder hunts the nearest runner, runners flee, ghosts haunt.
export function bot(game, seat, tick) {
  const me = game.p[seat];
  const pulse = (tick + seat * 7) % 40 === 0 ? 1 : 0;
  if (!me.alive) {
    const prey = game.aliveList()[0];
    if (prey === undefined) return { mx: 0, my: 0, dash: 0 };
    return { mx: sign(game.p[prey].x - me.x), my: sign(game.p[prey].y - me.y), dash: pulse };
  }
  if (seat === game.holder) {
    let best = -1, bestDist = Infinity;
    for (const j of game.aliveList()) {
      if (j === seat) continue;
      const dist = Math.hypot(game.p[j].x - me.x, game.p[j].y - me.y);
      if (dist < bestDist) { best = j; bestDist = dist; }
    }
    if (best < 0) return { mx: 0, my: 0, dash: 0 };
    return { mx: sign(game.p[best].x - me.x), my: sign(game.p[best].y - me.y), dash: bestDist < 110 ? 1 - (tick % 2) : 0 };
  }
  if (game.holder < 0) return { mx: ((Math.floor(tick / 15) + seat) % 3) - 1, my: ((Math.floor(tick / 25) + seat) % 3) - 1, dash: 0 };
  const foe = game.p[game.holder];
  let mx = sign(me.x - foe.x), my = sign(me.y - foe.y);
  // Slide along a wall instead of sitting in a corner.
  if (me.x < 60 || me.x > game.w - 60) my = my || (seat % 2 ? 1 : -1);
  if (me.y < 60 || me.y > game.h - 60) mx = mx || (seat % 2 ? -1 : 1);
  return { mx, my, dash: pulse };
}

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 3; round++) {
    rec.round();
    game.startRound();
    for (let tick = 0; tick < 3000 && !game.roundOver; tick++) {
      const intents = Array.from({ length: PLAYERS }, (_, seat) => bot(game, seat, tick));
      rec.tick(intents);
      game.step(intents);
    }
  }
  return rec.finish(game);
}
