import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, SHIFT_TICKS, HOLD_TICKS, REPAIRS, tileAt, setTile, rotate, trace, plan } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const live = (n = 2) => { const g = build(n, {}, seededRng(5)); g.startRound(); for (let t = 0; t < READY_TICKS; t++) g.step(neutral(n)); return g; };
function almost(g, seat = 0) {
  let board = 0;
  board = setTile(board, 3, 1);
  board = setTile(board, 5, 1);
  Object.assign(g.p[seat], { board, cursor: 4, inlet: 1, outlet: 1, pause: 0 });
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks retained from the scaffold, updated for this schema.
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
  assert.equal(reached.tick, READY_TICKS + SHIFT_TICKS);
  assert.ok(reached.scores.some((score) => score > 0));
});
test("two runs from one seed reach the same state", () => assert.equal(playReference(), playReference()));
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = live(1);
  for (let i = 0; i < SHIFT_TICKS; i++) game.step(neutral(1));
  assert.equal(game.tick, READY_TICKS + SHIFT_TICKS);
  assert.equal(game.roundOver, true);
  assert.deepEqual(game.scores, [0]);
});

test("a quarter-turn connects three pipes at exactly tick 61 and scores once", () => {
  const g = live(); almost(g);
  const snap = g.step(Object.freeze([Object.freeze({ turn: 1 }), 0]));
  assert.equal(snap.k, 61);
  assert.equal(snap.wet[0], (1 << 3) | (1 << 4) | (1 << 5));
  assert.deepEqual(snap.repaired, [0]);
  assert.deepEqual(g.scores, [4, 0]);
  assert.equal(snap.pause[0], HOLD_TICKS);
  for (let t = 0; t < HOLD_TICKS; t++) g.step([{ turn: 1 }, 0]);
  assert.equal(g.p[0].board, g.queue[1].board);
  assert.equal(g.p[0].pause, 0);
  assert.deepEqual(g.step([{ turn: 1 }, 0]).turned, []);
  assert.deepEqual(g.scores, [4, 0]);
});
test("water stops at an unmatched joint or the wrong outlet", () => {
  const g = live(1); almost(g);
  assert.deepEqual(trace(g.p[0].board, 1, 1), { wet: 1 << 3, complete: false });
  const solved = setTile(g.p[0].board, 4, 1);
  assert.equal(trace(solved, 1, 0).complete, false);
  assert.equal(trace(solved, 1, 1).complete, true);
});
test("selection wraps, repeats every nine ticks and precedes rotation", () => {
  const g = live(1);
  const before = tileAt(g.p[0].board, 8);
  const first = g.step([{ select: -1, turn: 1 }]);
  assert.equal(first.cursor[0], 8);
  assert.equal(tileAt(first.board[0], 8), rotate(before));
  for (let t = 0; t < 8; t++) assert.equal(g.step([{ select: -1, turn: 1 }]).cursor[0], 8);
  assert.equal(g.step([{ select: -1, turn: 1 }]).cursor[0], 7);
});
test("inspection beeps three times and never consumes a rotation", () => {
  const g = build(2, {}, seededRng(9)); g.startRound();
  const board = g.p[0].board, beeps = [];
  let snap;
  for (let t = 0; t < READY_TICKS; t++) { snap = g.step([{ turn: 1 }, 0]); if (snap.beep) beeps.push(snap.k); }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.go, true);
  assert.equal(g.p[0].board, board);
  assert.deepEqual(g.step([{ turn: 1 }, 0]).turned, []);
  g.step(neutral(2));
  assert.deepEqual(g.step([{ turn: 1 }, 0]).turned, [0]);
});
test("assistance is set at shift start and simultaneous repairs both score", () => {
  const g = build(2, {}, seededRng(3)); g.scores = [10, 4]; g.startRound(); g.ready = 0;
  almost(g, 0); almost(g, 1);
  const s = g.step([{ turn: 1 }, { turn: 1 }]);
  assert.deepEqual(s.assist, [false, true]);
  assert.deepEqual(s.repaired, [0, 1]);
  assert.deepEqual(g.scores, [14, 9]);
});
test("the final active tick accepts a repair; post-round steps are inert", () => {
  const g = live(1); almost(g); g.left = 1;
  const s = g.step([{ turn: 1 }]);
  assert.equal(s.over, true); assert.equal(s.finished, true); assert.deepEqual(g.scores, [4]);
  const next = g.step([{ turn: 1 }]);
  assert.equal(next.k, s.k + 1); assert.equal(next.finished, false); assert.deepEqual(next.repaired, []);
});
test("the eighth repair stays visible without reading beyond the queue", () => {
  const g = live(1); almost(g); g.p[0].done = REPAIRS - 1;
  g.step([{ turn: 1 }]);
  const board = g.p[0].board;
  for (let t = 0; t < 60; t++) g.step([{ select: 1, turn: t % 2 }]);
  assert.equal(g.p[0].board, board); assert.equal(g.p[0].done, REPAIRS); assert.deepEqual(g.scores, [4]);
});
test("disconnected seats persist but cannot rotate, score, or win later rounds", () => {
  const g = live(); almost(g, 1); g.disconnect(1); g.scores = [30, 100];
  const before = g.p[1].board;
  assert.deepEqual(g.step([0, { turn: 1 }]).active, [true, false]);
  assert.equal(g.p[1].board, before); assert.equal(g.winner(30), 0);
  g.startRound(); g.ready = 0;
  assert.deepEqual(g.step([0, { turn: 1 }]).turned, []);
  g.disconnect(0); assert.equal(g.step(neutral(2)).over, true); assert.equal(g.winner(1), -1);
});
test("a winner needs the target and a clear connected lead", () => {
  const g = live(); g.scores = [30, 30]; assert.equal(g.winner(30), -1);
  g.scores = [31, 30]; assert.equal(g.winner(30), 0);
});
test("every generated board is unsolved, solvable and shared across seats", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const g = build(8, {}, seededRng(seed)); g.startRound();
    assert.ok(g.p.every((p) => p.board === g.p[0].board));
    for (const q of g.queue) {
      assert.equal(trace(q.board, q.inlet, q.outlet).complete, false);
      const solution = plan(q.board, q.inlet, q.outlet);
      assert.ok(solution.length >= 3);
      let board = q.board;
      for (const tile of solution) board = setTile(board, tile.cell, tile.code);
      assert.equal(trace(board, q.inlet, q.outlet).complete, true);
    }
  }
});
test("complete 1–8-seat shifts stay within budget with exact codec round-trips", () => {
  for (let n = 1; n <= 8; n++) {
    const g = build(n, {}, seededRng(n)); g.startRound();
    while (!g.roundOver) {
      const snap = g.step(Array.from({ length: n }, (_, i) => ({ select: (g.tick + i) % 3 - 1, turn: g.tick % 2 })));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= n * SNAPSHOT_BUDGET_BYTES);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the intent declares only what the game reads", () => assert.deepEqual(Object.keys(INTENT), ["select", "turn"]));
