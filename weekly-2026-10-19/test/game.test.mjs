import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, MOVE_TICKS, INSPECT_TICKS, FLOORS, MIN_WIDTH, PHASE } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const run = (g, ticks, inputs = neutral(g.n)) => { let s; for (let t = 0; t < ticks; t++) s = g.step(inputs); return s; };
function live(n = 2) {
  const g = build(n, {}, seededRng(5));
  g.startRound();
  run(g, READY_TICKS);
  return g;
}
const drop = (n) => Object.freeze(Array.from({ length: n }, () => Object.freeze({ drop: 1 })));

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  game.startRound();
  const snap = run(game, 100);
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM);
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3);
  assert.equal(reached.roundOver, true);
  assert.equal(reached.tick, READY_TICKS + FLOORS * (MOVE_TICKS + INSPECT_TICKS));
});
test("two runs from one seed reach the same state", () => assert.equal(playReference(), playReference()));
test("one player and zero intent are safe, and the stream tick always advances", () => {
  const g = build(1, {}, seededRng(2));
  g.startRound();
  run(g, 1025);
  assert.equal(g.tick, 1025);
  assert.equal(g.roundOver, true);
  assert.deepEqual(g.scores, [0]);
});

// Rules.
test("countdown has three beats, and a held countdown press cannot drop", () => {
  const g = build(2, {}, seededRng(5));
  g.startRound();
  const x = g.p[0].x;
  const beats = [];
  let s;
  for (let t = 0; t < READY_TICKS; t++) { s = g.step(drop(2)); if (s.beep) beats.push(s.k); }
  assert.deepEqual(beats, [1, 21, 41]);
  assert.equal(s.opened, true);
  assert.equal(s.phase, PHASE.MOVE);
  assert.equal(s.x[0], x);
  assert.deepEqual(g.step(drop(2)).dropped, []);
  g.step(neutral(2));
  assert.deepEqual(g.step(drop(2)).dropped, [0, 1]);
});
test("a half-overlap cuts exactly 90 units and earns one point", () => {
  const g = live(1);
  g.p[0].x = g.p[0].base + 90;
  const s = g.step(drop(1));
  assert.equal(s.k, READY_TICKS + 1);
  assert.equal(s.width[0], 90);
  assert.equal(s.base[0], (arenaOf(1).w - 180) / 2 + 90);
  assert.equal(s.sw0[0], 90);
  assert.equal(s.quality[0], 50);
  assert.deepEqual(s.scored, [0]);
  assert.deepEqual(g.scores, [1]);
  assert.deepEqual(g.step(drop(1)).dropped, []);
});
test("95 percent snaps flush, and a unique cleanest drop gets the bonus only at settlement", () => {
  const g = live();
  const base = g.p[0].base;
  g.p[0].x = base + 9;
  g.p[1].x = base + 36;
  const s = g.step(drop(2));
  assert.equal(s.quality[0], 95);
  assert.equal(s.base[0], base);
  assert.equal(s.width[0], 180);
  assert.deepEqual(g.scores, [3, 2]);
  const end = run(g, MOVE_TICKS - 1);
  assert.equal(end.k, READY_TICKS + MOVE_TICKS);
  assert.deepEqual(end.bonus, [0]);
  assert.deepEqual(g.scores, [4, 2]);
});
test("equal cleanest percentages cancel the bonus without seat priority", () => {
  const g = live();
  g.p.forEach((p) => { p.x = p.base; });
  g.step(drop(2));
  const s = run(g, MOVE_TICKS - 1);
  assert.deepEqual(s.bonus, []);
  assert.deepEqual(g.scores, [3, 3]);
});
test("a miss retains support; timeout scores nothing; both can try the next lift", () => {
  const g = live();
  g.p[0].x = 0;
  const base = g.p[0].base;
  const s = g.step([{ drop: 1 }, 0]);
  assert.deepEqual(s.missed, [0]);
  assert.equal(s.width[0], 180);
  assert.equal(s.base[0], base);
  assert.equal(s.sw0[0], 0);
  assert.deepEqual(run(g, MOVE_TICKS - 1).missed, [1]);
  run(g, INSPECT_TICKS);
  assert.equal(g.floor, 1);
  assert.deepEqual(g.p.map((p) => p.locked), [false, false]);
  assert.deepEqual(g.scores, [0, 0]);
});
test("a held drop across lifts cannot place again, and safety restores thin supports", () => {
  const g = live(1);
  g.p[0].x = g.p[0].base + 150;
  g.step(drop(1));
  assert.equal(g.p[0].width, 30);
  run(g, MOVE_TICKS - 1 + INSPECT_TICKS, drop(1));
  assert.equal(g.p[0].width, MIN_WIDTH);
  assert.equal(g.p[0].sw[0], 30);
  assert.deepEqual(g.step(drop(1)).dropped, []);
  g.step(neutral(1));
  assert.deepEqual(g.step(drop(1)).dropped, [0]);
});
test("the final input tick counts and late floors double points and bonus", () => {
  const g = live(1);
  g.floor = 6;
  g.t = 1;
  g.p[0].x = g.p[0].base;
  const s = g.step(drop(1));
  assert.equal(s.phase, PHASE.INSPECT);
  assert.equal(s.sw6[0], 180);
  assert.deepEqual(s.scored, [0]);
  assert.deepEqual(s.bonus, [0]);
  assert.deepEqual(g.scores, [8]);
});
test("disconnect excludes bonus and match victory and persists into later rounds", () => {
  const g = live();
  g.p.forEach((p) => { p.x = p.base; });
  g.step(drop(2));
  g.disconnect(0);
  const x = g.p[0].x;
  const s = run(g, MOVE_TICKS - 1);
  assert.deepEqual(s.bonus, [1]);
  assert.equal(s.x[0], x);
  g.scores = [100, 60];
  assert.equal(g.winner(60), 1);
  g.startRound();
  run(g, READY_TICKS);
  assert.deepEqual(g.step(drop(2)).dropped, [1]);
  g.disconnect(1);
  assert.equal(g.step(neutral(2)).over, true);
});
test("a unique connected leader at target wins; trailing players start wider", () => {
  const g = build(2, {}, seededRng(3));
  g.scores = [60, 60];
  assert.equal(g.winner(60), -1);
  g.scores = [61, 60];
  assert.equal(g.winner(60), 0);
  g.startRound();
  assert.deepEqual(g.p.map((p) => p.width), [180, 200]);
});
test("every tick round-trips at one through eight players including full floor histories", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const g = build(n, {}, seededRng(50 + n));
    g.startRound();
    while (!g.roundOver) {
      const intents = g.p.map((p, i) => ({ drop: g.phase === PHASE.MOVE && !p.locked && Math.abs(p.x - p.base) < 8 + i * 5 ? 1 : 0 }));
      const s = g.step(Object.freeze(intents));
      const bytes = schema.encode(s, n);
      assert.ok(bytes.byteLength <= n * SNAPSHOT_BUDGET_BYTES);
      assert.deepEqual(schema.decode(bytes, n), s);
    }
    assert.equal(g.tick, 1020);
    assert.ok(g.p.some((p) => p.sw.filter((v) => v > 0).length >= 6));
  }
});
test("the intent declares only the drop action", () => assert.deepEqual(Object.keys(INTENT), ["drop"]));
