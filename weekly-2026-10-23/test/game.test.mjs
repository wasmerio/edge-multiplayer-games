import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, READY_TICKS, BUILD_TICKS, START_WIDTH, LEADER_WIDTH,
  PLACE_PAUSE, COLLAPSE_PAUSE, workspace,
} from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const press = Object.freeze([Object.freeze({ drop: 1 }), 0]);
function live(n = 2) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(n));
  Object.assign(game.p[0], { x: 96, base: 100, width: 100, dir: 1 });
  return game;
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks retained from the scaffold.
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
  assert.equal(reached.tick, READY_TICKS + BUILD_TICKS);
});
test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});
test("one player and a seat that has sent no input are both fine", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  for (let i = 0; i < READY_TICKS + 10; i++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
  assert.equal(game.p[0].height, 0);
});

test("perfect placement on tick 61 grows the floor and repairs width", () => {
  const game = live();
  const snap = game.step(press);
  assert.equal(snap.k, 61);
  assert.deepEqual(snap.perfect, [0]);
  assert.deepEqual(snap.placed, [0]);
  assert.equal(snap.height[0], 1);
  assert.equal(snap.width[0], 108);
  assert.equal(snap.base[0], 96);
  assert.equal(snap.cd[0], PLACE_PAUSE);
  assert.equal(game.scores[0], 0, "only the bell awards match points");
});
test("a thirty-unit overhang is cut to exactly seventy", () => {
  const game = live();
  game.p[0].x = 126;
  const snap = game.step(press);
  assert.equal(snap.base[0], 130);
  assert.equal(snap.width[0], 70);
  assert.equal(snap.height[0], 1);
  assert.equal(snap.mark[0], 1);
  assert.deepEqual(snap.perfect, []);
});
test("24 overlap survives, less than 24 collapses and restores the foundation", () => {
  const game = live();
  game.p[0].x = 172;
  assert.equal(game.step(press).width[0], 24);
  const other = live();
  other.p[0].x = 172.1;
  const snap = other.step(press);
  assert.deepEqual(snap.collapsed, [0]);
  assert.equal(snap.height[0], 0);
  assert.equal(snap.width[0], START_WIDTH);
  assert.equal(snap.cd[0], COLLAPSE_PAUSE);
  assert.equal(snap.base[0], (workspace(arenaOf(2)) - START_WIDTH) / 2);
});
test("countdown beeps on exact ticks and holding through it cannot drop", () => {
  const game = build(2, {}, seededRng(3));
  game.startRound();
  const initial = game.p[0].x;
  const beeps = [];
  let snap;
  for (let i = 0; i < READY_TICKS; i++) {
    snap = game.step(press);
    if (snap.beep) beeps.push(snap.k);
    assert.equal(snap.x[0], initial);
  }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.go, true);
  assert.deepEqual(game.step(press).placed, []);
  assert.equal(game.left, BUILD_TICKS - 1);
});
test("held presses and presses during the pause cannot auto-repeat", () => {
  const game = live();
  game.step(press);
  for (let i = 0; i < PLACE_PAUSE + 3; i++) assert.deepEqual(game.step(press).placed, []);
  assert.equal(game.p[0].height, 1);
  game.step(neutral(2));
  Object.assign(game.p[0], { x: 95.78, base: 100 });
  assert.deepEqual(game.step(press).placed, [0]);
});
test("the floor reflects off the edge without losing overshoot", () => {
  const game = live();
  const edge = workspace(arenaOf(2)) - game.p[0].width;
  game.p[0].x = edge - 1;
  const snap = game.step(neutral(2));
  assert.equal(snap.x[0], edge - 3);
  assert.equal(snap.dir[0], -1);
});
test("the bell accepts a final placement, awards once, and post-round steps are inert", () => {
  const game = live();
  game.left = 1;
  game.p[0].height = 4;
  game.p[1].height = 4;
  const snap = game.step(press);
  assert.equal(snap.height[0], 5);
  assert.deepEqual(snap.award, [3, 1]);
  assert.deepEqual(game.scores, [3, 1]);
  assert.equal(snap.over, true);
  assert.equal(snap.finished, true);
  const after = game.step(press);
  assert.equal(after.k, snap.k + 1);
  assert.deepEqual(after.awarded, []);
  assert.equal(after.finished, false);
  assert.deepEqual(game.scores, [3, 1]);
});
test("tied positive towers share the award; empty towers get nothing", () => {
  const game = live();
  game.left = 1;
  game.p.forEach((p) => { p.height = 2; });
  assert.deepEqual(game.step(neutral(2)).award, [3, 3]);
  const empty = live();
  empty.left = 1;
  assert.deepEqual(empty.step(neutral(2)).award, [0, 0]);
});
test("round length is exactly 1140 ticks and the next round resets all construction", () => {
  const game = build(1, {}, seededRng(8));
  game.startRound();
  for (let i = 1; i < READY_TICKS + BUILD_TICKS; i++) assert.equal(game.step([0]).over, false);
  assert.equal(game.step([0]).over, true);
  game.startRound();
  assert.equal(game.round, 2);
  assert.equal(game.tick, 0);
  assert.equal(game.ready, READY_TICKS);
  assert.equal(game.left, BUILD_TICKS);
  assert.equal(game.p[0].height, 0);
});
test("the unique match leader starts narrower, and disconnected seats cannot win", () => {
  const game = live();
  game.scores = [9, 6];
  assert.equal(game.winner(9), 0);
  game.startRound();
  assert.equal(game.lead, 0);
  assert.equal(game.p[0].width, LEADER_WIDTH);
  assert.equal(game.p[1].width, START_WIDTH);
  game.disconnect(0);
  assert.equal(game.winner(9), -1);
  game.scores[1] = 9;
  assert.equal(game.winner(9), 1);
  game.startRound();
  assert.equal(game.step(press).active[0], false);
});
test("departed players stay out of placement and settlement in later rounds", () => {
  const game = live();
  game.p[0].height = 20;
  game.disconnect(0);
  game.left = 1;
  const snap = game.step(press);
  assert.deepEqual(snap.placed, []);
  assert.deepEqual(snap.awarded, []);
  game.startRound();
  for (let i = 0; i <= READY_TICKS; i++) game.step(press);
  assert.equal(game.p[0].height, 0);
  game.disconnect(1);
  assert.equal(game.step([0, 0]).over, true);
});
test("a match winner needs both the target and a clear lead", () => {
  const game = live();
  game.scores = [9, 9];
  assert.equal(game.winner(9), -1);
  game.scores = [8, 7];
  assert.equal(game.winner(9), -1);
});
test("whole sessions at one through eight players encode exactly inside the budget", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(45 + n));
    game.startRound();
    for (let t = 0; !game.roundOver; t++) {
      const intents = Object.freeze(Array.from({ length: n }, (_, i) => Object.freeze({ drop: (t + i * 3) % (17 + i) === 0 ? 1 : 0 })));
      const snap = game.step(intents);
      const encoded = schema.encode(snap, n);
      assert.ok(encoded.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(encoded, n), snap);
      assert.ok(snap.width.every((w) => w >= 24 && w <= START_WIDTH));
    }
  }
});
test("the intent declares only the drop action", () => {
  assert.deepEqual(Object.keys(INTENT), ["drop"]);
});
