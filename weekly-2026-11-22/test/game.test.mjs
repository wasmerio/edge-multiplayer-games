import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, ROUTE_TICKS, REVEAL_TICKS, PUZZLES, PHASE, trace, rotate, planRoute } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
function live(n) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let t = 0; t < READY_TICKS; t++) game.step(neutral(n));
  return game;
}
function almost(game) {
  game.inlet = 1; game.outlet = 1;
  game.tiles = Array(9).fill(5);
  game.rot = Array.from({ length: game.n }, () => [0, 0, 0, 1, 0, 1, 0, 0, 0]);
  game.cursor.fill(4);
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = live(MAX_PLAYERS_PER_ROOM);
  const snap = game.step(neutral(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM);
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3);
});
test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  for (let t = 0; t < READY_TICKS + 10; t++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
  assert.deepEqual(game.scores, [0]);
});

// Rule scenarios.
test("countdown advances the stream, emits two beats and blocks held turns", () => {
  const game = build(2, {}, seededRng(5)); game.startRound();
  const initial = [...game.rot[0]], beeps = [];
  let snap;
  for (let t = 0; t < READY_TICKS; t++) {
    snap = game.step(Object.freeze([Object.freeze({ turn: 1 }), 0]));
    if (snap.beep) beeps.push(snap.k);
  }
  assert.deepEqual(beeps, [1, 31]);
  assert.equal(snap.opened, true);
  assert.equal(snap.t, ROUTE_TICKS);
  assert.deepEqual(game.rot[0], initial);
  assert.deepEqual(game.step([{ turn: 1 }, 0]).turned, []);
  game.step(neutral(2));
  assert.deepEqual(game.step([{ turn: 1 }, 0]).turned, [0]);
});
test("straight route requires reciprocal ports, not adjacent paint", () => {
  const game = live(1); almost(game);
  assert.deepEqual(trace(game.tiles, game.rot[0], 1, 1).cells, [3]);
  assert.equal(trace(game.tiles, game.rot[0], 1, 1).solved, false);
  const snap = game.step([{ turn: 1 }]);
  assert.deepEqual(snap.solved, [0]);
  assert.equal(snap.k, READY_TICKS + 1);
  assert.equal(snap.award[0], 7);
  assert.equal(game.scores[0], 7);
  for (let t = 0; t < 10; t++) game.step([{ turn: t % 2 }]);
  assert.equal(game.scores[0], 7, "completion locks the board");
});
test("simultaneous first finishes share bonus, later finishes receive four", () => {
  const game = live(3); almost(game);
  assert.deepEqual(game.step([{ turn: 1 }, { turn: 1 }, 0]).solved, [0, 1]);
  game.step([0, 0, { turn: 1 }]);
  assert.deepEqual(game.scores, [7, 7, 4]);
});
test("finale doubles both base and first-flow points", () => {
  const game = live(2); almost(game); game.puzzle = 3;
  game.step([{ turn: 1 }, 0]);
  game.step([0, { turn: 1 }]);
  assert.deepEqual(game.scores, [14, 8]);
});
test("last routing tick accepts a solve before the reveal", () => {
  const game = live(1); almost(game); game.t = 1;
  const snap = game.step([{ turn: 1 }]);
  assert.equal(snap.phase, PHASE.REVEAL);
  assert.equal(snap.revealed, true);
  assert.equal(snap.done[0], true);
  assert.equal(game.scores[0], 7);
});
test("cursor repeats at six ticks, stops at borders and zero is neutral", () => {
  const game = live(1); game.cursor[0] = 3;
  assert.equal(game.step([{ mx: 1 }]).cursor[0], 4);
  for (let t = 0; t < 5; t++) assert.equal(game.step([{ mx: 1 }]).cursor[0], 4);
  assert.equal(game.step([{ mx: 1 }]).cursor[0], 5);
  for (let t = 0; t < 8; t++) game.step([{ mx: 1 }]);
  assert.equal(game.cursor[0], 5);
  assert.equal(game.step([0]).cursor[0], 5);
  assert.equal(game.step([{ my: -1 }]).cursor[0], 2);
});
test("held turn cannot spill across a puzzle boundary", () => {
  const game = live(1); game.phase = PHASE.REVEAL; game.t = 1;
  game.step([{ turn: 1 }]);
  const initial = [...game.rot[0]];
  assert.deepEqual(game.step([{ turn: 1 }]).turned, []);
  assert.deepEqual(game.rot[0], initial);
});
test("round always ends at tick 1260; post-round steps cannot score", () => {
  const game = build(1, {}, seededRng(9)); game.startRound();
  const duration = READY_TICKS + PUZZLES * (ROUTE_TICKS + REVEAL_TICKS);
  for (let t = 1; t <= duration; t++) {
    const snap = game.step(neutral(1));
    assert.equal(snap.over, t === duration);
    assert.equal(snap.finished, t === duration);
  }
  assert.equal(duration, 1260);
  const snap = game.step([{ turn: 1 }]);
  assert.equal(snap.k, 1261);
  assert.equal(snap.finished, false);
  assert.deepEqual(snap.solved, []);
});
test("disconnected players cannot rotate, score or win, including next round", () => {
  const game = live(2); almost(game); game.disconnect(1);
  const before = [...game.rot[1]];
  const snap = game.step([{ turn: 1 }, { turn: 1 }]);
  assert.deepEqual(snap.active, [true, false]);
  assert.deepEqual(game.rot[1], before);
  assert.deepEqual(game.scores, [7, 0]);
  game.scores = [3, 100]; assert.equal(game.winner(3), 0);
  game.startRound(); assert.equal(game.step(neutral(2)).active[1], false);
  game.disconnect(0); assert.equal(game.step(neutral(2)).finished, true);
  assert.equal(game.winner(1), -1);
});
test("winner requires a target and a unique connected leader", () => {
  const game = build(2, {}, seededRng(4));
  game.scores = [70, 70]; assert.equal(game.winner(70), -1);
  game.scores = [69, 60]; assert.equal(game.winner(70), -1);
  game.scores = [71, 70]; assert.equal(game.winner(70), 0);
});
test("seeded boards are scrambled, solvable and identical for every seat", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const game = live(8);
    game.rng = seededRng(seed); game.makePuzzle();
    assert.deepEqual(game.rot[0], game.rot[7]);
    assert.equal(trace(game.tiles, game.rot[0], game.inlet, game.outlet).solved, false);
    const plan = planRoute(game.tiles, game.rot[0], game.inlet, game.outlet);
    assert.ok(plan);
    for (const p of plan) game.rot[0][p.cell] = (game.rot[0][p.cell] + p.turns) % 4;
    assert.equal(trace(game.tiles, game.rot[0], game.inlet, game.outlet).solved, true);
  }
  assert.equal(rotate(3, 1), 6);
});
test("every one-to-eight-player round fits the budget on every tick", () => {
  for (let n = 1; n <= 8; n++) {
    const game = build(n, {}, seededRng(11)); game.startRound();
    while (!game.roundOver) {
      const snap = game.step(neutral(n));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("intent is only cursor movement and a quarter turn", () => {
  assert.deepEqual(Object.keys(INTENT), ["mx", "my", "turn"]);
});
