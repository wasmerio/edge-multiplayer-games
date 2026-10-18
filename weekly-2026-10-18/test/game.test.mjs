import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, BUILD_TICKS, SET_TICKS, REBUILD_TICKS, MAX_WIDTH, speedFor } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const press = (n) => Object.freeze(Array.from({ length: n }, () => Object.freeze({ place: 1 })));
function live(n = 1) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(n));
  return game;
}
function tower(game, i = 0, x = 200, width = 100, bx = 230) {
  Object.assign(game.p[i], { x: [x, x, x, x, x], widths: [width, 0, 0, 0, 0], bx, cd: 0, held: false });
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks retained from the scaffold.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = live(MAX_PLAYERS_PER_ROOM);
  const snap = game.step(press(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM, bytes.byteLength + " bytes");
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
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  for (let i = 0; i < READY_TICKS + 10; i++) game.step(neutral(1));
  assert.equal(game.tick, READY_TICKS + 10);
  assert.equal(game.scores[0], 0);
});

test("placement keeps exactly the overlap and scores before this tick's movement", () => {
  const game = live();
  tower(game);
  const snap = game.step(press(1));
  assert.equal(snap.k, READY_TICKS + 1);
  assert.equal(snap.x0[0], 230);
  assert.equal(snap.w0[0], 70);
  assert.equal(snap.x1[0], 200);
  assert.equal(snap.w1[0], 100);
  assert.equal(snap.height[0], 1);
  assert.deepEqual(game.scores, [2]);
  assert.deepEqual(snap.placed, [0]);
  assert.deepEqual(snap.perfect, []);
});
test("perfect boundary snaps, repairs symmetrically and caps width", () => {
  const game = live();
  tower(game, 0, 200, 100, 208);
  let snap = game.step(press(1));
  assert.equal(snap.x0[0], 194);
  assert.equal(snap.w0[0], 112);
  assert.equal(game.scores[0], 3);
  assert.deepEqual(snap.perfect, [0]);
  tower(game, 0, 200, 158, 192);
  snap = game.step(press(1));
  assert.equal(snap.x0[0], 199);
  assert.equal(snap.w0[0], MAX_WIDTH);
});
test("24 units survives but 23.9 collapses, loses only this round's points", () => {
  const game = live();
  game.scores[0] = 20;
  tower(game, 0, 200, 100, 276);
  let snap = game.step(press(1));
  assert.equal(snap.w0[0], 24);
  assert.equal(game.scores[0], 22);
  tower(game, 0, 200, 100, 276.1);
  snap = game.step(press(1));
  assert.deepEqual(snap.missed, [0]);
  assert.equal(snap.w0[0], MAX_WIDTH);
  assert.equal(snap.height[0], 0);
  assert.equal(snap.earned[0], 0);
  assert.equal(snap.cd[0], REBUILD_TICKS);
  assert.equal(game.scores[0], 20);
  tower(game, 0, 200, 100, 400);
  game.step(press(1));
  assert.equal(game.scores[0], 20);
});
test("countdown is exactly sixty ticks; a held countdown press cannot place", () => {
  const game = build(2, {}, seededRng(5));
  game.startRound();
  const start = game.p[0].bx;
  const beeps = [];
  let snap;
  for (let i = 0; i < READY_TICKS; i++) {
    snap = game.step(press(2));
    if (snap.beep) beeps.push(snap.k);
  }
  assert.equal(snap.bx[0], start);
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.go, true);
  assert.equal(snap.left, BUILD_TICKS);
  snap = game.step(press(2));
  assert.deepEqual(snap.tapped, []);
  assert.equal(snap.height[0], 0);
  assert.notEqual(snap.bx[0], start);
});
test("setting consumes twelve full ticks; busy input is not queued", () => {
  const game = live();
  tower(game, 0, 200, 100, 200);
  game.step(press(1));
  const before = game.p[0].bx;
  for (let i = 0; i < SET_TICKS; i++) {
    const snap = game.step(i === 0 ? neutral(1) : press(1));
    assert.deepEqual(snap.placed, []);
    assert.equal(snap.bx[0], before);
  }
  assert.equal(game.p[0].cd, 0);
  assert.deepEqual(game.step(press(1)).placed, []);
  assert.notEqual(game.p[0].bx, before);
  game.step(neutral(1));
  game.p[0].bx = game.p[0].x[0];
  assert.deepEqual(game.step(press(1)).perfect, [0]);
});
test("simultaneous equal placements and skyline ties are awarded equally", () => {
  const game = live(2);
  tower(game, 0, 200, 100, 200);
  tower(game, 1, 200, 100, 200);
  game.left = 1;
  const snap = game.step(press(2));
  assert.deepEqual(snap.perfect, [0, 1]);
  assert.deepEqual(snap.bonus, [0, 1]);
  assert.deepEqual(game.scores, [8, 8]);
  assert.equal(snap.finished, true);
  assert.equal(game.roundOver, true);
  assert.equal(game.winner(8), -1);
});
test("exact deadline and inert post-round scoring with an advancing tick", () => {
  const game = live();
  let snap;
  for (let i = 0; i < BUILD_TICKS; i++) snap = game.step(neutral(1));
  assert.equal(snap.k, 1140);
  assert.equal(snap.over, true);
  assert.deepEqual(snap.bonus, []);
  const after = game.step(press(1));
  assert.equal(after.k, 1141);
  assert.deepEqual(after.tapped, []);
  assert.equal(after.finished, false);
  assert.deepEqual(game.scores, [0]);
});
test("trailing seats receive wider foundations and every seat shares the seeded direction", () => {
  const game = build(3, {}, seededRng(1));
  game.scores = [30, 26, 0];
  game.startRound();
  assert.deepEqual(game.p.map((p) => p.widths[0]), [136, 144, 160]);
  assert.equal(new Set(game.p.map((p) => p.dir)).size, 1);
});
test("a disconnected leader cannot move, win, earn bonuses or return next round", () => {
  const game = live(2);
  game.scores = [70, 90];
  game.p[1].height = 100;
  game.disconnect(1);
  const before = game.p[1].bx;
  const snap = game.step(press(2));
  assert.equal(snap.bx[1], before);
  assert.equal(snap.active[1], false);
  assert.equal(game.winner(70), 0);
  game.startRound();
  assert.equal(game.step(press(2)).active[1], false);
  game.disconnect(0);
  assert.equal(game.step(neutral(2)).over, true);
  assert.equal(game.winner(0), -1);
});
test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3];
  assert.equal(game.winner(3), -1);
  game.scores = [4, 3];
  assert.equal(game.winner(3), 0);
});
test("every frame of full builds at 1 to 8 players is quantised and budgeted", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = live(n);
    while (!game.roundOver) {
      const inputs = game.p.map((p, i) => Object.freeze({ place: !p.held && !p.cd && (Math.abs(p.bx - p.x[0]) < 5 + i * 3 || game.tick % 149 === 0) ? 1 : 0 }));
      const snap = game.step(Object.freeze(inputs));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
      for (let i = 0; i < n; i++) {
        assert.ok(snap.w0[i] >= 24 && snap.w0[i] <= 160);
        assert.ok(snap.bx[i] >= 0 && snap.bx[i] + snap.w0[i] <= arenaOf(n).w);
        assert.ok(speedFor(snap.height[i]) <= 6);
      }
    }
  }
});
test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["place"]);
});
