import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, READY_TICKS, LIVE_TICKS, SETTLE_TICKS, REBUILD_TICKS, TARGET,
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
const drop = Object.freeze([Object.freeze({ drop: 1 })]);
function live(n = 1) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(n));
  return game;
}

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});

test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  game.startRound();
  let snap;
  for (let i = 0; i < 100; i++) snap = game.step(neutral(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM, bytes.byteLength + " bytes");
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});

test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3, "played " + reached.round + " rounds");
});

test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});

test("one player, and a seat that has sent no input, are both fine", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  for (let i = 0; i < READY_TICKS + 10; i++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
});

// Rule scenarios.
test("countdown beeps at exact ticks and a held countdown press cannot place", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  const start = game.p[0].x;
  const beeps = [];
  let snap;
  for (let i = 0; i < READY_TICKS; i++) {
    snap = game.step(drop);
    if (snap.beep) beeps.push(snap.k);
    assert.equal(snap.x[0], start);
  }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.go, true);
  game.p[0].x = 120;
  assert.deepEqual(game.step(drop).perfect, []);
  assert.equal(game.scores[0], 0);
});

test("an offset slab is trimmed to the exact intersection and scores at tick 61", () => {
  const game = live();
  Object.assign(game.p[0], { x: 145, centre: 120, width: 100 });
  const snap = game.step(drop);
  assert.equal(snap.k, 61);
  assert.deepEqual(snap.placed, [0]);
  assert.equal(snap.width[0], 75);
  assert.equal(snap.centre[0], 132.5);
  assert.equal(snap.c5[0], 132.5);
  assert.equal(snap.w5[0], 75);
  assert.equal(snap.height[0], 1);
  assert.equal(game.scores[0], 1);
  assert.equal(snap.cd[0], SETTLE_TICKS);
});

test("perfect includes the boundary, restores width, snaps centre and awards two", () => {
  const game = live();
  Object.assign(game.p[0], { x: 126, centre: 120, width: 90 });
  const snap = game.step(drop);
  assert.deepEqual(snap.perfect, [0]);
  assert.equal(snap.width[0], 98);
  assert.equal(snap.centre[0], 120);
  assert.equal(game.scores[0], 2);
  for (let k = 0; k < SETTLE_TICKS; k++) game.step(neutral(1));
  game.p[0].x = 120;
  game.p[0].width = 109;
  assert.equal(game.step(drop).width[0], 110);
});

test("a miss rebuilds without losing points and its lock lasts exactly 30 ticks", () => {
  const game = live();
  game.scores[0] = 7;
  Object.assign(game.p[0], { x: 210, centre: 120, width: 40, height: 8, points: 7 });
  const snap = game.step(drop);
  assert.deepEqual(snap.missed, [0]);
  assert.equal(snap.width[0], 110);
  assert.equal(snap.height[0], 0);
  assert.equal(snap.points[0], 7);
  assert.equal(snap.cd[0], REBUILD_TICKS);
  assert.equal(game.scores[0], 7);
  for (let k = 0; k < REBUILD_TICKS; k++) game.step(neutral(1));
  assert.equal(game.p[0].cd, 0);
  game.p[0].x = 120;
  assert.deepEqual(game.step(drop).perfect, [0]);
  assert.equal(game.scores[0], 9);
});

test("the minimum overlap is accepted but anything smaller is a miss", () => {
  const yes = live(), no = live();
  Object.assign(yes.p[0], { x: 148, centre: 120, width: 40 });
  Object.assign(no.p[0], { x: 148.1, centre: 120, width: 40 });
  assert.equal(yes.step(drop).width[0], 12);
  assert.deepEqual(no.step(drop).missed, [0]);
});

test("holding drop through cooldown does not repeat or queue", () => {
  const game = live();
  game.p[0].x = 120;
  game.step(drop);
  for (let i = 0; i < 50; i++) assert.deepEqual(game.step(drop).perfect, []);
  assert.equal(game.scores[0], 2);
  game.step(neutral(1));
  game.p[0].x = 120;
  assert.deepEqual(game.step(drop).perfect, [0]);
});

test("equal placements on the same tick are independent of seat order", () => {
  const game = live(2);
  for (const p of game.p) p.x = 120;
  assert.deepEqual(game.step(Object.freeze([{ drop: 1 }, { drop: 1 }])).perfect, [0, 1]);
  assert.deepEqual(game.scores, [2, 2]);
});

test("round ends at exactly 1140 and its last live tick accepts a drop", () => {
  const game = live();
  for (let i = 0; i < LIVE_TICKS - 1; i++) game.step(neutral(1));
  assert.equal(game.roundOver, false);
  game.p[0].x = 120;
  const last = game.step(drop);
  assert.equal(last.k, READY_TICKS + LIVE_TICKS);
  assert.equal(last.finished, true);
  assert.equal(last.over, true);
  assert.equal(game.scores[0], 2);
  const after = game.step(neutral(1));
  assert.equal(after.k, last.k + 1);
  assert.equal(after.finished, false);
  assert.deepEqual(after.perfect, []);
  assert.equal(game.scores[0], 2);
});

test("trailing builders get a wider next-round foundation; scores persist", () => {
  const game = live(3);
  game.scores = [12, 4, 12];
  game.startRound();
  assert.deepEqual(game.p.map((p) => p.width), [110, 140, 110]);
  assert.deepEqual(game.scores, [12, 4, 12]);
  assert.ok(game.p.every((p) => p.points === 0 && p.height === 0));
});

test("disconnected seats cannot place, win, or receive a new round input", () => {
  const game = live(2);
  game.scores = [TARGET, TARGET + 20];
  game.disconnect(1);
  assert.equal(game.winner(TARGET), 0);
  game.startRound();
  game.ready = 0;
  game.p[1].x = 120;
  const before = game.p[1].x;
  const snap = game.step([0, { drop: 1 }]);
  assert.deepEqual(snap.active, [true, false]);
  assert.equal(snap.x[1], before);
  assert.deepEqual(snap.perfect, []);
  game.disconnect(0);
  assert.equal(game.step(neutral(2)).finished, true);
});

test("a winner needs the target and a clear connected lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3];
  assert.equal(game.winner(3), -1);
  game.scores = [4, 3];
  assert.equal(game.winner(3), 0);
  assert.equal(game.winner(5), -1);
});

test("complete 1–8 seat rounds round-trip and remain within budget", () => {
  for (let n = 1; n <= 8; n++) {
    const game = build(n, {}, seededRng(n));
    game.startRound();
    while (!game.roundOver) {
      const intents = Object.freeze(game.p.map((p, i) => Object.freeze({
        drop: !p.held && !p.cd && Math.abs(p.x - p.centre) < 4 + i * 3 ? 1 : 0,
      })));
      const snap = game.step(intents);
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
      assert.ok(snap.width.every((w) => w >= 12 && w <= 140));
      assert.ok(snap.x.every((x) => x >= 0 && x <= 240));
    }
  }
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["drop"]);
});
