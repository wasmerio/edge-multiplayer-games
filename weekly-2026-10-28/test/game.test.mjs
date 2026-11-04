import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, COURSE_TICKS, COURSES, speedFor } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference, scripted } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
function live(n = 2) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let t = 0; t < READY_TICKS; t++) game.step(neutral(n));
  return game;
}
function aim(game, i, x) {
  game.p[i].dir = 1;
  game.p[i].x = x - speedFor(game.course);
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
test("two runs from one seed reach the same state", () => assert.equal(playReference(), playReference()));
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = live(1);
  for (let i = 0; i < 10; i++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
});

// Rule scenarios.
test("countdown tracks held presses but cannot drop; ticks and beeps advance", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  const initial = game.p[0].x;
  const beeps = [];
  for (let t = 0; t < READY_TICKS; t++) {
    const snap = game.step(Object.freeze([Object.freeze({ press: 1 })]));
    if (snap.beep) beeps.push(snap.k);
    assert.deepEqual(snap.pressed, []);
  }
  assert.equal(game.p[0].x, initial);
  assert.deepEqual(beeps, [1, 31]);
  assert.deepEqual(game.step([{ press: 1 }]).pressed, []);
  game.step([0]);
  assert.deepEqual(game.step([{ press: 1 }]).pressed, [0]);
});
test("overhang is cut to the exact overlap and becomes the next support", () => {
  const game = live();
  aim(game, 0, 78);
  const snap = game.step([{ press: 1 }, 0]);
  assert.equal(snap.k, 61);
  assert.equal(snap.hx0[0], 78);
  assert.equal(snap.hw0[0], 130);
  assert.equal(snap.baseW[0], 130);
  assert.equal(snap.result[0], 1);
  assert.deepEqual(game.scores, [1, 0]);
});
test("perfect alignment restores eight units and awards three points to simultaneous presses", () => {
  const game = live();
  aim(game, 0, 48); aim(game, 1, 48);
  const snap = game.step([{ press: 1 }, { press: 1 }]);
  assert.deepEqual(snap.scored, [0, 1]);
  assert.deepEqual(snap.baseW, [168, 168]);
  assert.deepEqual(snap.baseX, [44, 44]);
  assert.deepEqual(game.scores, [3, 3]);
});
test("an overlap below sixteen misses and restores width without fabricating a layer", () => {
  const game = live(1);
  Object.assign(game.p[0], { baseX: 100, baseW: 24, width: 24 });
  aim(game, 0, 115);
  const snap = game.step([{ press: 1 }]);
  assert.deepEqual(snap.missed, [0]);
  assert.equal(snap.result[0], 3);
  assert.equal(snap.hw0[0], 0);
  assert.equal(snap.baseW[0], 56);
  assert.equal(game.scores[0], 0);
});
test("sixteen units of overlap survives", () => {
  const game = live(1);
  Object.assign(game.p[0], { baseX: 100, baseW: 24, width: 24 });
  aim(game, 0, 108);
  assert.equal(game.step([{ press: 1 }]).hw0[0], 16);
  assert.equal(game.scores[0], 1);
});
test("held input cannot repeat through a course boundary", () => {
  const game = live(1);
  aim(game, 0, 48);
  game.step([{ press: 1 }]);
  for (let t = 0; t < COURSE_TICKS; t++) game.step([{ press: 1 }]);
  assert.equal(game.course, 1);
  assert.equal(game.p[0].locked, false);
  assert.deepEqual(game.scores, [3]);
});
test("the last live tick accepts a press before timeout and the run ends at tick 1020", () => {
  const game = live(1);
  for (let t = 0; t < COURSE_TICKS - 1; t++) game.step([0]);
  aim(game, 0, 48);
  const snap = game.step([{ press: 1 }]);
  assert.equal(snap.t, 0);
  assert.equal(snap.result[0], 2);
  while (!game.roundOver) game.step([0]);
  assert.equal(game.tick, READY_TICKS + COURSE_TICKS * COURSES);
  assert.equal(game.p[0].result, 4);
  const scores = [...game.scores];
  assert.equal(game.step([{ press: 1 }]).k, 1021);
  assert.deepEqual(game.scores, scores);
});
test("final two courses pay double", () => {
  const game = live(1);
  game.course = 6;
  aim(game, 0, 48);
  assert.equal(game.step([{ press: 1 }]).award[0], 6);
});
test("trailing seats receive wider starting stock; disconnects persist and cannot win", () => {
  const game = live(3);
  game.scores = [50, 10, 0];
  game.disconnect(0);
  game.startRound();
  assert.equal(game.p[1].baseW, 160);
  assert.equal(game.p[2].baseW, 180);
  assert.equal(game.winner(10), 1);
  const before = game.p[0].x;
  for (let t = 0; t < 100; t++) game.step([{ press: t % 2 }, 0, 0]);
  assert.equal(game.p[0].x, before);
  assert.equal(game.scores[0], 50);
  game.disconnect(1); game.disconnect(2);
  assert.equal(game.step([0, 0, 0]).over, true);
  assert.equal(game.winner(1), -1);
});
test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3]; assert.equal(game.winner(3), -1);
  game.scores = [4, 3]; assert.equal(game.winner(3), 0);
});
test("complete 1–8 player runs keep every field in range and within budget", () => {
  for (let n = 1; n <= 8; n++) {
    const game = live(n);
    while (!game.roundOver) {
      const snap = game.step(Object.freeze(Array.from({ length: n }, (_, i) => Object.freeze(scripted(game, i)))));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= n * SNAPSHOT_BUDGET_BYTES);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the intent declares only what the game reads", () => assert.deepEqual(Object.keys(INTENT), ["press"]));
