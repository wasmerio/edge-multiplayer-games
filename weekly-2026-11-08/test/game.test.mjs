import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, PLAY_TICKS, ALL, rotate, light, solveBoard, tileAt } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const snake = [10, 10, 12, 6, 10, 9, 3, 10, 8];
function live(n = 2) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let k = 0; k < READY_TICKS; k++) game.step(neutral(n));
  return game;
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  game.startRound();
  let snap;
  for (let i = 0; i < 100; i++) snap = game.step(neutral(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM);
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3);
});
test("two runs from one seed reach the same state", () => assert.equal(playReference(), playReference()));
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  for (let i = 0; i < READY_TICKS + 10; i++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
});
test("countdown freezes edits and held turn does not leak into play", () => {
  const game = build(2, {}, seededRng(9)); game.startRound();
  const beeps = [], intents = Object.freeze([Object.freeze({ mx: 1, turn: 1 }), 0]);
  let snap;
  for (let k = 0; k < READY_TICKS; k++) { snap = game.step(intents); if (snap.beep) beeps.push(snap.k); }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.go, true);
  assert.deepEqual(snap.rot, [0, 0]);
  assert.equal(game.step(intents).rot[0], 0);
  game.step(neutral(2));
  assert.deepEqual(game.step([{ turn: 1 }, 0]).turned, [0]);
});
test("pipes carry power only through reciprocal connected ends", () => {
  assert.equal(light(snake, 0), ALL);
  assert.equal(light(snake, 1), 0, "rotating the inlet disconnects power");
  assert.equal(light(snake, 1 << 2), 1, "a gap after tile zero stops power");
  assert.equal(rotate(8), 1);
  assert.equal(rotate(7, 4), 7);
});
test("one clockwise press completes the circuit and awards seven exactly once", () => {
  const game = live(1);
  game.tiles = [...snake]; game.tiles[0] = rotate(snake[0], 3);
  const snap = game.step(Object.freeze([Object.freeze({ turn: 1 })]));
  assert.equal(snap.k, READY_TICKS + 1);
  assert.equal(snap.lit[0], ALL);
  assert.deepEqual(snap.solved, [0]); assert.deepEqual(snap.scored, [0]);
  assert.equal(game.scores[0], 7);
  for (let i = 0; i < 20; i++) game.step([{ turn: i % 2 }]);
  assert.equal(game.scores[0], 7); assert.equal(game.p[0].rot, 1);
});
test("simultaneous completions share the first bonus; a later solver earns five", () => {
  const game = live(3); game.tiles = [...snake]; game.tiles[0] = rotate(snake[0], 3);
  game.step([{ turn: 1 }, { turn: 1 }, 0]);
  assert.deepEqual(game.scores, [7, 7, 0]);
  game.step([0, 0, { turn: 1 }]);
  assert.deepEqual(game.scores, [7, 7, 5]);
});
test("cursor navigation clamps, prefers horizontal and repeats after seven ticks", () => {
  const game = live();
  let snap = game.step([{ mx: 1, my: 1 }, 0]); assert.equal(snap.cursor[0], 1);
  for (let i = 0; i < 6; i++) snap = game.step([{ mx: 1, my: 1 }, 0]);
  assert.equal(snap.cursor[0], 1);
  snap = game.step([{ mx: 1, my: 1 }, 0]); assert.equal(snap.cursor[0], 2);
  snap = game.step([{ my: 1 }, 0]); assert.equal(snap.cursor[0], 5);
  for (let i = 0; i < 40; i++) snap = game.step([{ mx: 1 }, 0]);
  assert.equal(snap.cursor[0], 5);
});
test("deadline pays partial lighting once and ends at tick 960", () => {
  const game = live(1); game.tiles = [...snake];
  game.p[0].rot = 1 << (2 * 2);
  assert.equal(light(game.tiles, game.p[0].rot), 7, "first three tiles are lit");
  let snap;
  for (let i = 0; i < PLAY_TICKS; i++) snap = game.step(neutral(1));
  assert.equal(snap.k, 960); assert.equal(snap.over, true);
  assert.deepEqual(game.scores, [1]); assert.equal(snap.finished, true);
  snap = game.step(neutral(1));
  assert.equal(snap.k, 961); assert.equal(snap.finished, false); assert.deepEqual(snap.scored, []);
});
test("last active tick accepts a completion before partial settlement", () => {
  const game = live(1); game.tiles = [...snake]; game.tiles[0] = rotate(snake[0], 3); game.left = 1;
  const snap = game.step([{ turn: 1 }]);
  assert.equal(snap.over, true); assert.deepEqual(snap.award, [7]); assert.deepEqual(game.scores, [7]);
});
test("disconnected seats cannot act, score, return next round or win", () => {
  const game = live(2); game.disconnect(0); game.tiles = [...snake];
  const snap = game.step([{ turn: 1, mx: 1 }, 0]);
  assert.equal(snap.rot.length, 2); assert.equal(snap.rot[0], 0); assert.equal(game.scores[0], 0);
  game.scores = [100, 20]; assert.equal(game.winner(20), 1);
  game.startRound(); assert.deepEqual(game.step(neutral(2)).active, [false, true]);
  game.disconnect(1); assert.equal(game.step(neutral(2)).over, true);
});
test("trailing seats receive the correctly oriented centre tile", () => {
  const game = build(3, {}, seededRng(12)); game.scores = [7, 5, 7]; game.startRound();
  const solution = solveBoard(game.tiles);
  assert.deepEqual(game.p.map((p) => p.assist), [false, true, false]);
  assert.equal(tileAt(game.tiles, game.p[1].rot, 4), tileAt(game.tiles, solution, 4));
});
test("seeded boards are solvable and snapshots fit for every player count", () => {
  for (let n = 1; n <= 8; n++) {
    const game = build(n, {}, seededRng(n));
    for (let round = 0; round < 30; round++) {
      game.startRound();
      const solution = solveBoard(game.tiles); assert.ok(solution >= 0);
      assert.equal(light(game.tiles, solution), ALL); assert.notEqual(light(game.tiles, 0), ALL);
      const snap = game.step(neutral(n));
      const bytes = schema.encode(snap, n); assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("a winner needs the target and a clear connected lead", () => {
  const game = build(2, {}, seededRng(3)); game.scores = [20, 20]; assert.equal(game.winner(20), -1);
  game.scores = [21, 20]; assert.equal(game.winner(20), 0);
});
test("the intent declares only the circuit controls", () => assert.deepEqual(Object.keys(INTENT), ["mx", "my", "turn"]));
