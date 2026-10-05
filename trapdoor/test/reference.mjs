// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import { Game, ARENA, TILE, TOP, ALIVE, FALLEN } from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { record } from "../../engine/replay.js";

export const SEED = 222412863;
export const PLAYERS = 4;
export const build = (n, opts, rng) => new Game(n, opts?.arena ? opts : { arena: ARENA(n) }, rng);

// A scripted player: walk to the nearest called tile, dash now and then, doze now and then.
// A fallen one flies to a called tile and cracks it. Every intent value is used.
function bot(game, seat, tick) {
  const me = game.p[seat];
  let best = null;
  for (let i = 0; i < game.tiles; i++) {
    if (game.lay[i] !== game.sym || game.cracked(i)) continue;
    const x = (i % game.cols + 0.5) * TILE;
    const y = TOP + (Math.floor(i / game.cols) + 0.5) * TILE;
    const far = Math.hypot(x - me.x, y - me.y) + ((i * 37 + seat * 91) % 50);
    if (!best || far < best.far) best = { x, y, far };
  }
  const dozing = (tick + seat * 53) % 200 < 26 + seat * 18;
  const dx = best && !dozing ? best.x - me.x : 0;
  const dy = best && !dozing ? best.y - me.y : 0;
  const press = me.st === FALLEN ? (tick + seat * 5) % 20 < 2 : me.st === ALIVE && (tick + seat * 11) % 70 < 3;
  return { mx: Math.sign(Math.round(dx / 12)), my: Math.sign(Math.round(dy / 12)), act: press ? 1 : 0 };
}

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 4; round++) {
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
