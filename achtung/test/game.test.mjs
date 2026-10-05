import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record, replay } from "../../engine/replay.js";

const schema = defineSnapshot(SNAPSHOT);
const build = (n, opts, rng) => new Game(n, opts.arena ? opts : { arena: arenaFor(n) }, rng);
const neutral = (n) => Array.from({ length: n }, () => ({ turn: 0 }));
const run = (game, intents, ticks) => { let snap; for (let i = 0; i < ticks; i++) snap = game.step(intents); return snap; };

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaFor(2) }), true);
});

test("a straight run dies against the wall at a predictable tick", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  game.curves[0] = { x: 10, y: 300, a: Math.PI, alive: true, gap: false, gapTimer: 0, nextGap: 10_000 };
  game.freeze = 0;
  const deaths = [];
  for (let i = 0; i < 10; i++) {
    const snap = game.step(neutral(1));
    if (snap.d.length) deaths.push(snap.k);
  }
  // Two pixels a tick from x=10, with probes five pixels ahead.
  assert.deepEqual(deaths, [3]);
  assert.equal(game.curves[0].alive, false);
  assert.equal(game.roundOver, true);
});

test("a turning curve survives until it meets its own trail", () => {
  const game = build(1, { arena: { w: 400, h: 400 } }, seededRng(5));
  game.startRound();
  game.curves[0] = { x: 200, y: 200, a: 0, alive: true, gap: false, gapTimer: 0, nextGap: 10_000 };
  game.freeze = 0;
  const snap = run(game, [{ turn: 1 }], 200);
  assert.equal(snap.alive[0], false, "the curve closed a loop onto itself");
  assert.ok(snap.k > 20, `survived ${snap.k} ticks before closing the loop`);
});

test("survivors score once per death", () => {
  const game = build(3, {}, seededRng(9));
  game.startRound();
  game.freeze = 0;
  game.curves[0] = { x: 2, y: 2, a: Math.PI, alive: true, gap: false, gapTimer: 0, nextGap: 10_000 };
  run(game, neutral(3), 5);
  assert.equal(game.scores[0], 0);
  assert.equal(game.scores[1], 1);
  assert.equal(game.scores[2], 1);
});

test("the round freezes before play and the tick stays at zero", () => {
  const game = build(2, {}, seededRng(3));
  game.startRound();
  const snap = game.step(neutral(2));
  assert.equal(snap.k, 0);
  assert.equal(snap.over, false);
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3];
  assert.equal(game.winner(3), -1);
  game.scores = [4, 3];
  assert.equal(game.winner(3), 0);
});

test("the arena grows with the player count", () => {
  assert.ok(build(8, {}, seededRng(1)).w > build(2, {}, seededRng(1)).w);
});

test("a snapshot fits well inside its budget at the player cap", () => {
  const game = build(8, {}, seededRng(4));
  game.startRound();
  const snap = run(game, neutral(8), 100);
  const bytes = schema.encode(snap, 8).byteLength;
  assert.ok(bytes <= schema.budgetBytes * 8, `${bytes} bytes`);
});

test("a snapshot round-trips through the codec", () => {
  const game = build(4, {}, seededRng(2));
  game.startRound();
  const snap = run(game, neutral(4), 100);
  const back = schema.decode(schema.encode(snap, 4), 4);
  assert.deepEqual(back.alive, snap.alive);
  assert.deepEqual(back.gap, snap.gap);
  assert.deepEqual(back.d, snap.d);
  back.x.forEach((value, i) => assert.ok(Math.abs(value - snap.x[i]) <= 1 / 20));
});

test("the committed fixture replays to its recorded state", () => {
  const fixture = fs.readFileSync(new URL("./replay.ndjson", import.meta.url), "utf8");
  assert.ok(fixture.length > 0);
  const reached = replay(fixture, build);
  assert.ok(reached.round >= 3, `played ${reached.round} rounds`);
});

test("two runs from one seed reach the same state", () => {
  const play = () => {
    const game = build(4, {}, seededRng(77));
    const rec = record({ seed: 77, tickHz: 60, players: 4 });
    for (let round = 0; round < 2; round++) {
      rec.round();
      game.startRound();
      for (let i = 0; i < 150; i++) {
        const intents = [{ turn: 1 }, { turn: 0 }, { turn: -1 }, { turn: 1 }];
        rec.tick(intents);
        game.step(intents);
      }
    }
    return rec.finish(game);
  };
  assert.equal(play(), play());
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["turn"]);
});
