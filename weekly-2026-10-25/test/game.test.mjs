import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, LIVE_TICKS, REPAIR_TICKS, CIRCUITS, ports, powered, connected, turnTile, solution } from "../public/game.js";
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
  for (let k = 0; k < READY_TICKS; k++) game.step(neutral(n));
  return game;
}
function almost(game, seat, stage = 0) {
  const p = game.p[seat], types = game.types[stage];
  p.stage = stage;
  p.board = solution(types);
  p.cursor = 0;
  for (let k = 0; k < 3; k++) p.board = turnTile(p.board, 0);
  p.power = powered(types, p.board);
  p.flash = 0;
  p.held = false;
  assert.equal(connected(types, p.board), false);
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks retained from the scaffold.
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
test("two runs from one seed reach the same state", () => assert.equal(playReference(), playReference()));
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = live(1);
  for (let i = 0; i < 10; i++) game.step(neutral(1));
  assert.equal(game.tick, READY_TICKS + 10);
});

test("inspection lasts exactly 60 ticks and held rotation cannot cross it", () => {
  const game = build(2, {}, seededRng(7));
  game.startRound();
  const original = game.p[0].board, beeps = [];
  const held = Object.freeze([Object.freeze({ rotate: 1 }), 0]);
  let snap;
  for (let k = 0; k < READY_TICKS; k++) {
    snap = game.step(held);
    if (snap.beep) beeps.push(snap.k);
  }
  assert.deepEqual(beeps, [1, 31]);
  assert.equal(snap.go, true);
  assert.equal(snap.left, LIVE_TICKS);
  assert.equal(game.step(held).board[0], original);
  game.step(neutral(2));
  assert.equal(game.step(held).board[0], turnTile(original, 0));
});
test("selection wraps and rotation acts once per press on the selected tile", () => {
  const game = live(1), original = game.p[0].board;
  let snap = game.step([{ select: -1, rotate: 1 }]);
  assert.equal(snap.cursor[0], 8);
  assert.equal(snap.board[0], turnTile(original, 8));
  snap = game.step([{ rotate: 1 }]);
  assert.deepEqual(snap.turned, []);
  snap = game.step([{ select: 1 }]);
  assert.equal(snap.cursor[0], 0);
});
test("held selection repeats after its delay, then release stops it", () => {
  const game = live(1);
  assert.equal(game.step([{ select: 1 }]).cursor[0], 1);
  for (let i = 0; i < 11; i++) assert.equal(game.step([{ select: 1 }]).cursor[0], 1);
  assert.equal(game.step([{ select: 1 }]).cursor[0], 2);
  for (let i = 0; i < 20; i++) assert.equal(game.step(neutral(1)).cursor[0], 2);
});
test("simultaneous repairs share the first bonus; later repair receives base", () => {
  const game = live(3);
  for (let i = 0; i < 3; i++) almost(game, i);
  let snap = game.step([{ rotate: 1 }, { rotate: 1 }, 0]);
  assert.deepEqual(snap.repaired, [0, 1]);
  assert.deepEqual(game.scores, [7, 7, 0]);
  assert.equal(snap.k, READY_TICKS + 1);
  snap = game.step([0, 0, { rotate: 1 }]);
  assert.deepEqual(game.scores, [7, 7, 5]);
  assert.deepEqual(snap.repaired, [2]);
});
test("repair glow locks for exactly 18 ticks and loads the next circuit", () => {
  const game = live(1);
  almost(game, 0);
  game.step([{ rotate: 1 }]);
  for (let i = 1; i < REPAIR_TICKS; i++) {
    const snap = game.step([{ select: 1, rotate: 1 }]);
    assert.equal(snap.stage[0], 0);
    assert.equal(snap.flash[0], REPAIR_TICKS - i);
  }
  const snap = game.step([{ rotate: 1 }]);
  assert.equal(snap.stage[0], 1);
  assert.equal(snap.board[0], snap.starts[1]);
  assert.deepEqual(game.step([{ rotate: 1 }]).turned, []);
});
test("late circuits pay double base and finishing every seat ends after glow", () => {
  const game = live(2);
  almost(game, 0, 3); almost(game, 1, 3);
  game.step([{ rotate: 1 }, { rotate: 1 }]);
  assert.deepEqual(game.scores, [12, 12]);
  for (let i = 0; i < REPAIR_TICKS - 1; i++) assert.equal(game.step(neutral(2)).over, false);
  const snap = game.step(neutral(2));
  assert.equal(snap.over, true);
  assert.deepEqual(snap.stage, [CIRCUITS, CIRCUITS]);
  assert.equal(snap.ended, true);
});
test("last live tick accepts repair; post-round cannot score twice", () => {
  const game = live(1);
  almost(game, 0);
  game.left = 1;
  const snap = game.step([{ rotate: 1 }]);
  assert.equal(snap.over, true);
  assert.deepEqual(game.scores, [7]);
  assert.equal(game.step(neutral(1)).k, snap.k + 1);
  assert.deepEqual(game.step([{ rotate: 1 }]).repaired, []);
  assert.deepEqual(game.scores, [7]);
});
test("neutral rounds expire at the exact deadline", () => {
  const game = live(1);
  for (let i = 0; i < LIVE_TICKS - 1; i++) assert.equal(game.step(neutral(1)).over, false);
  const snap = game.step(neutral(1));
  assert.equal(snap.k, READY_TICKS + LIVE_TICKS);
  assert.equal(snap.left, 0);
  assert.equal(snap.over, true);
});
test("every generated circuit is solvable, unsolved and identical across seats", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const game = build(8, {}, seededRng(seed));
    game.startRound();
    for (let c = 0; c < CIRCUITS; c++) {
      assert.equal(connected(game.types[c], game.starts[c]), false);
      const answer = solution(game.types[c]);
      assert.notEqual(answer, -1);
      assert.equal(connected(game.types[c], answer), true);
    }
    assert.ok(game.p.every((p) => p.board === game.starts[0]));
  }
});
test("power only crosses reciprocal track ends", () => {
  assert.equal(ports(511, 0, 0), 5);
  assert.equal(powered(511, 0), 0, "vertical inlet cannot receive power from west");
  assert.equal(powered(511, 1), 1, "horizontal inlet stops before vertical neighbour");
});
test("disconnected seats remain out across rounds and cannot win", () => {
  const game = live(2);
  almost(game, 1);
  game.disconnect(1);
  assert.deepEqual(game.step([0, { rotate: 1 }]).repaired, []);
  game.scores = [60, 100];
  assert.equal(game.winner(60), 0);
  game.startRound();
  assert.deepEqual(game.step(neutral(2)).active, [true, false]);
  game.disconnect(0);
  assert.equal(game.step(neutral(2)).over, true);
  assert.equal(game.winner(60), -1);
});
test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [60, 60]; assert.equal(game.winner(60), -1);
  game.scores = [61, 60]; assert.equal(game.winner(60), 0);
});
test("codec budget holds for complete neutral rounds at every player count", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(n)); game.startRound();
    for (let t = 0; t < READY_TICKS + LIVE_TICKS; t++) {
      const snap = game.step(neutral(n)), bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["select", "rotate"]);
});
