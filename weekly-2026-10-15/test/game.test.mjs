import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, SHIFT_TICKS, FLOORS, SETTLE_TICKS, REBUILD_TICKS, unpackFloor } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
function live(n = 2) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(n));
  return game;
}
const press = (game) => game.step(Object.freeze(Array.from({ length: game.n }, (_, i) => Object.freeze({ drop: i === 0 ? 1 : 0 }))));
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks retained from the scaffold.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = live(MAX_PLAYERS_PER_ROOM);
  game.p[0].x = 200;
  const snap = press(game);
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

test("countdown freezes beams, tracks held input and beeps on exact ticks", () => {
  const game = build(2, {}, seededRng(5)); game.startRound();
  const x = game.p[0].x, beeps = [];
  let snap;
  for (let t = 0; t < READY_TICKS; t++) { snap = press(game); if (snap.beep) beeps.push(snap.k); }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.go, true);
  assert.equal(game.p[0].x, x);
  assert.deepEqual(press(game).dropped, []);
  assert.equal(game.scores[0], 0);
});
test("overhang is cut to the exact overlap and scores one", () => {
  const game = live(); game.p[0].x = 300;
  const snap = press(game);
  assert.equal(snap.k, READY_TICKS + 1);
  assert.equal(snap.base[0], 30);
  assert.equal(snap.width[0], 50);
  assert.deepEqual(unpackFloor(snap.f0[0]), { left: 30, width: 50 });
  assert.deepEqual(snap.landed, [0]);
  assert.equal(snap.result[0], 1);
  assert.equal(game.scores[0], 1);
});
test("perfect allowance is inclusive and preserves the whole width", () => {
  const game = live(); game.p[0].x = 220;
  const snap = press(game);
  assert.equal(snap.width[0], 60);
  assert.equal(snap.base[0], 20);
  assert.equal(game.scores[0], 2);
  assert.deepEqual(snap.perfect, [0]);
});
test("eight aligned floors award exactly twenty points, then rebuild", () => {
  const game = live();
  for (let f = 0; f < FLOORS; f++) {
    game.p[0].x = game.p[0].base;
    const snap = press(game);
    assert.equal(snap.height[0], f + 1);
    assert.equal(game.scores[0], (f + 1) * 2 + (f === 7 ? 4 : 0));
    if (f < 7) for (let i = 0; i < SETTLE_TICKS; i++) game.step(neutral(2));
    else assert.deepEqual(snap.built, [0]);
  }
  for (let t = 0; t < REBUILD_TICKS - 1; t++) game.step(neutral(2));
  assert.equal(game.p[0].height, 8);
  const snap = game.step(neutral(2));
  assert.equal(snap.height[0], 0);
  assert.equal(snap.f7[0], 0);
  assert.equal(snap.width[0], 60);
});
test("a miss costs two without eliminating, and cannot subtract below zero", () => {
  const game = live();
  Object.assign(game.p[0], { base: 450, width: 100, x: 0 }); game.scores[0] = 1;
  const snap = press(game);
  assert.equal(game.scores[0], 0);
  assert.equal(snap.gain[0], -1);
  assert.deepEqual(snap.missed, [0]);
  assert.equal(snap.active[0], true);
  for (let t = 0; t < REBUILD_TICKS; t++) game.step(neutral(2));
  assert.equal(game.p[0].width, 600);
  assert.equal(game.p[0].base, 200);
});
test("six-unit overlap lands; anything less misses", () => {
  for (const [x, result] of [[240, 1], [241, 3]]) {
    const game = live(); Object.assign(game.p[0], { base: 200, width: 100, x });
    assert.equal(press(game).result[0], result);
  }
});
test("held drop cannot repeat, including through settling", () => {
  const game = live(); game.p[0].x = 200;
  press(game);
  for (let t = 0; t < 80; t++) assert.deepEqual(press(game).dropped, []);
  assert.equal(game.p[0].height, 1);
  game.step(neutral(2));
  assert.deepEqual(press(game).dropped, [0]);
});
test("fresh presses while settling are refused without resetting the timer", () => {
  const game = live(); game.p[0].x = 200; press(game);
  game.step(neutral(2));
  const snap = press(game);
  assert.deepEqual(snap.denied, [0]);
  assert.equal(snap.cd[0], SETTLE_TICKS - 2);
  assert.equal(game.scores[0], 2);
});
test("last tick accepts a drop, then results stay inert and ticks advance", () => {
  const game = live();
  for (let t = 0; t < SHIFT_TICKS - 1; t++) game.step(neutral(2));
  game.p[0].x = game.p[0].base;
  const snap = press(game);
  assert.equal(snap.k, READY_TICKS + SHIFT_TICKS);
  assert.equal(snap.finished, true); assert.equal(snap.over, true);
  assert.equal(game.scores[0], 2);
  const after = game.step(neutral(2));
  assert.equal(after.k, snap.k + 1); assert.equal(after.finished, false);
  assert.deepEqual(after.landed, []); assert.equal(game.scores[0], 2);
});
test("trailing seats get a wider allowance next shift; scores persist", () => {
  const game = live(); game.scores = [9, 3]; game.startRound();
  assert.deepEqual(game.p.map((p) => p.tolerance), [2, 4]);
  assert.deepEqual(game.scores, [9, 3]); assert.equal(game.round, 2);
});
test("disconnected seats cannot move, score, win or return next round", () => {
  const game = live(); game.scores = [80, 70]; game.disconnect(0);
  const x = game.p[0].x;
  assert.equal(press(game).x[0], x / 10);
  assert.equal(game.winner(60), 1);
  game.startRound(); assert.equal(press(game).active[0], false);
  assert.equal(game.p[1].tolerance, 2);
  game.disconnect(1); assert.equal(game.step(neutral(2)).over, true);
});
test("winner requires the target and unique connected lead", () => {
  const game = live(); game.scores = [59, 58]; assert.equal(game.winner(60), -1);
  game.scores = [60, 60]; assert.equal(game.winner(60), -1);
  game.scores = [60, 61]; assert.equal(game.winner(60), 1);
});
test("all player counts round-trip a complete active shift within budget", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(30)); game.startRound();
    while (!game.roundOver) {
      const intents = Object.freeze(game.p.map((p, i) => Object.freeze({ drop: p.cd === 0 && Math.abs(p.x - p.base) < 10 + i * 10 ? 1 : 0 })));
      const snap = game.step(intents);
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
      snap.x.forEach((x, i) => assert.ok(x >= 0 && x <= 100 - snap.width[i]));
    }
  }
});
test("intent declares only drop", () => assert.deepEqual(Object.keys(INTENT), ["drop"]));
