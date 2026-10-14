import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, BUILD_TICKS, DROP_PAUSE, REPAIR_TICKS, HISTORY } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const press = Object.freeze([Object.freeze({ drop: 1 })]);
function live(n = 1) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(n));
  return game;
}
function alignedDrop(game, seat = 0) {
  const p = game.p[seat];
  p.x = p.height ? p.cx[(p.height - 1) % HISTORY] : game.bay / 2;
  p.cd = 0;
  p.held = false;
  return game.step(Object.freeze(Array.from({ length: game.n }, (_, i) => Object.freeze({ drop: i === seat ? 1 : 0 }))));
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
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM, bytes.byteLength + " bytes");
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3, "played " + reached.round + " rounds");
  assert.equal(reached.tick, READY_TICKS + BUILD_TICKS);
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

// Stackworks rule scenarios.
test("countdown advances ticks, beeps twice and consumes held presses", () => {
  const game = build(1, {}, seededRng(4));
  game.startRound();
  const start = game.p[0].x;
  const beeps = [];
  let snap;
  for (let k = 0; k < READY_TICKS; k++) {
    snap = game.step(press);
    if (snap.beep) beeps.push(snap.k);
  }
  assert.deepEqual(beeps, [1, 31]);
  assert.equal(snap.go, true);
  assert.equal(snap.left, BUILD_TICKS);
  assert.equal(snap.x[0], start);
  assert.deepEqual(game.step(press).dropped, []);
  assert.equal(game.p[0].height, 0);
});
test("a thirty-unit offset trims exactly thirty units and shifts the joint", () => {
  const game = live();
  game.p[0].x = game.bay / 2 + 30;
  const snap = game.step(press);
  assert.equal(snap.k, 61);
  assert.equal(snap.width[0], 110);
  assert.equal(snap.cx0[0], 175);
  assert.equal(snap.cw0[0], 110);
  assert.equal(snap.height[0], 1);
  assert.equal(snap.best[0], 1);
  assert.deepEqual(snap.landed, [0]);
  assert.deepEqual(snap.perfect, []);
  assert.equal(game.scores[0], 0, "heights are paid at closing, not at each drop");
});
test("a perfect joint restores eight units, capped at the foundation width", () => {
  const game = live();
  game.p[0].x = 190;
  game.step(press);
  const snap = alignedDrop(game);
  assert.equal(snap.width[0], 118);
  assert.equal(snap.cx1[0], 175);
  assert.deepEqual(snap.perfect, [0]);
  for (let i = 0; i < 8; i++) alignedDrop(game);
  assert.equal(game.p[0].width, 140);
});
test("a collapse resets the current tower but preserves its best", () => {
  const game = live();
  alignedDrop(game);
  alignedDrop(game);
  const p = game.p[0];
  p.width = 20; p.cw[1] = 20; p.x = 20; p.cd = 0; p.held = false;
  const snap = game.step(press);
  assert.deepEqual(snap.fell, [0]);
  assert.equal(snap.height[0], 0);
  assert.equal(snap.best[0], 2);
  assert.equal(snap.width[0], 140);
  assert.equal(snap.cd[0], REPAIR_TICKS);
  for (let i = 0; i < HISTORY; i++) assert.equal(snap[`cw${i}`][0], 0);
});
test("sixteen units of overlap is legal but fifteen is a collapse", () => {
  for (const overlap of [15, 16]) {
    const game = live();
    const p = game.p[0];
    p.width = 40; p.x = 160 + 40 - overlap;
    const snap = game.step(press);
    assert.equal(snap.height[0], overlap === 16 ? 1 : 0);
    assert.equal(snap.result[0], overlap === 16 ? 1 : 3);
  }
});
test("the perfect boundary is inclusive and uses the position before movement", () => {
  const game = live();
  game.p[0].x = 167;
  game.p[0].dir = 1;
  assert.deepEqual(game.step(press).perfect, [0]);
  assert.equal(game.p[0].cx[0], 160);
});
test("a cooldown lasts eighteen complete ticks and never queues a held drop", () => {
  const game = live();
  alignedDrop(game);
  const x = game.p[0].x;
  for (let i = 0; i < DROP_PAUSE; i++) {
    const snap = game.step(press);
    assert.deepEqual(snap.dropped, []);
    assert.equal(snap.x[0], x);
  }
  assert.equal(game.p[0].cd, 0);
  assert.deepEqual(game.step(press).dropped, []);
  assert.notEqual(game.p[0].x, x);
  game.step(neutral(1));
  game.p[0].x = 160;
  assert.deepEqual(game.step(press).landed, [0]);
});
test("the floor ring keeps the most recent six joints without changing the height", () => {
  const game = live();
  for (let i = 0; i < 12; i++) alignedDrop(game);
  assert.equal(game.p[0].height, 12);
  assert.equal(game.p[0].best, 12);
  assert.deepEqual(game.p[0].cw, Array(HISTORY).fill(140));
});
test("the final tick accepts a drop and tied tallest builders share the bonus", () => {
  const game = live(3);
  game.left = 1;
  game.p[0].x = 160; game.p[1].x = 160;
  const snap = game.step(Object.freeze([{ drop: 1 }, { drop: 1 }, 0]));
  assert.equal(snap.over, true);
  assert.equal(snap.finished, true);
  assert.deepEqual(snap.award, [4, 4, 0]);
  assert.deepEqual(game.scores, [4, 4, 0]);
  const after = game.step(press);
  assert.equal(after.k, snap.k + 1);
  assert.equal(after.finished, false);
  assert.deepEqual(after.awarded, []);
  assert.deepEqual(game.scores, [4, 4, 0]);
});
test("a neutral round ends on tick 960 with no bonus for zero height", () => {
  const game = live(2);
  let snap;
  for (let i = 0; i < BUILD_TICKS - 1; i++) snap = game.step(neutral(2));
  assert.equal(snap.over, false);
  snap = game.step(neutral(2));
  assert.equal(snap.k, READY_TICKS + BUILD_TICKS);
  assert.equal(snap.over, true);
  assert.deepEqual(game.scores, [0, 0]);
});
test("trailing players get a wider next foundation, capped at 170", () => {
  const game = build(3, {}, seededRng(1));
  game.scores = [20, 15, 0];
  game.startRound();
  assert.deepEqual(game.p.map((p) => p.base), [140, 150, 170]);
  assert.deepEqual(game.p.map((p) => p.best), [0, 0, 0]);
  assert.deepEqual(game.scores, [20, 15, 0]);
});
test("disconnected seats keep their array slots but cannot act, score or win", () => {
  const game = live(2);
  game.p[1].best = 50;
  game.disconnect(1);
  const before = { ...game.p[1] };
  game.left = 1;
  const snap = game.step(Object.freeze([0, { drop: 1 }]));
  assert.equal(snap.x.length, 2);
  assert.equal(snap.active[1], false);
  assert.deepEqual(game.p[1], before);
  assert.equal(game.scores[1], 0);
  game.scores = [45, 99];
  assert.equal(game.winner(45), 0);
  game.startRound();
  assert.equal(game.step(neutral(2)).active[1], false);
  game.disconnect(0);
  assert.equal(game.step(neutral(2)).over, true);
});
test("a winner needs the target and a clear connected lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [45, 45];
  assert.equal(game.winner(45), -1);
  game.scores = [46, 45];
  assert.equal(game.winner(45), 0);
  assert.equal(game.winner(50), -1);
});
test("every tick encodes for one through eight players, including all events", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(111));
    game.startRound();
    while (!game.roundOver) {
      const intents = Object.freeze(game.p.map((p, i) => {
        const top = p.height ? p.cx[(p.height - 1) % HISTORY] : game.bay / 2;
        return Object.freeze({ drop: !game.ready && !p.cd && !p.held && (Math.abs(p.x - top) < 8 + i * 6 || (game.tick + i) % 131 === 0) ? 1 : 0 });
      }));
      const snap = game.step(intents);
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the intent declares only the drop field", () => {
  assert.deepEqual(Object.keys(INTENT), ["drop"]);
});
