import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, ROUND_TICKS, FLUSH_TICKS, REPEAT_TICKS, BOARDS, flow, setRotation, rotation, ports, solution } from "../public/game.js";
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
function oneTurn(game, i) {
  const p = game.p[i], board = BOARDS[0];
  Object.assign(p, board, { cursor: 0, held: false, flush: 0 });
  p.pipes = setRotation(p.pipes, 0, rotation(p.pipes, 0) + 3);
  p.wet = flow(p.shape, p.pipes).wet;
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

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
  const game = build(1, {}, seededRng(2));
  game.startRound();
  for (let i = 0; i < READY_TICKS + 10; i++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
  assert.equal(game.scores[0], 0);
});
test("countdown advances k, blocks input, and held turn does not leak through", () => {
  const game = build(2, {}, seededRng(3)); game.startRound();
  const before = game.p[0].pipes, beats = [];
  let snap;
  for (let k = 0; k < READY_TICKS; k++) {
    snap = game.step([{ mx: 1, turn: 1 }, 0]);
    if (snap.beep) beats.push(snap.k);
  }
  assert.deepEqual(beats, [1, 21, 41]);
  assert.equal(snap.go, true); assert.equal(snap.ready, 0);
  assert.equal(snap.cursor[0], 0); assert.equal(snap.pipes[0], before);
  assert.deepEqual(game.step([{ turn: 1 }, 0]).turned, []);
});
test("all route templates connect every tile and are reconstructible", () => {
  assert.ok(BOARDS.length >= 2);
  for (const board of BOARDS) {
    assert.equal(flow(board.shape, board.pipes).complete, true);
    assert.equal(flow(board.shape, solution(board.shape)).wet, 511);
  }
});
test("a broken inlet does not wet any tile", () => {
  const b = BOARDS[0];
  let packed = b.pipes;
  while (ports(b.shape, packed, 0) & 8) packed = setRotation(packed, 0, rotation(packed, 0) + 1);
  assert.equal(flow(b.shape, packed).wet, 0);
  assert.equal(flow(b.shape, packed).complete, false);
});
test("same-tick first repairs share the bonus and cannot score twice", () => {
  const game = live(2); oneTurn(game, 0); oneTurn(game, 1);
  const snap = game.step(Object.freeze([Object.freeze({ turn: 1 }), Object.freeze({ turn: 1 })]));
  assert.deepEqual(snap.repaired, [0, 1]);
  assert.deepEqual(game.scores, [4, 4]);
  assert.deepEqual(snap.flush, [FLUSH_TICKS, FLUSH_TICKS]);
  for (let k = 0; k < FLUSH_TICKS; k++) game.step([{ turn: 1 }, { turn: 1 }]);
  assert.deepEqual(game.scores, [4, 4]);
  assert.deepEqual(game.p.map((p) => p.level), [1, 1]);
  assert.deepEqual(game.step([{ turn: 1 }, { turn: 1 }]).turned, []);
});
test("later repair earns three, and trailing repair earns catch-up point", () => {
  const game = live(2); game.claims[0] = true; game.scores = [12, 5];
  oneTurn(game, 0); oneTurn(game, 1);
  const snap = game.step([{ turn: 1 }, { turn: 1 }]);
  assert.deepEqual(snap.award, [3, 4]);
  assert.deepEqual(game.scores, [15, 9]);
});
test("cursor repeats at seven ticks, clamps, and turn acts once per press", () => {
  const game = live(1);
  assert.equal(game.step([{ mx: 1 }]).cursor[0], 1);
  for (let k = 1; k < REPEAT_TICKS; k++) assert.equal(game.step([{ mx: 1 }]).cursor[0], 1);
  assert.equal(game.step([{ mx: 1 }]).cursor[0], 2);
  for (let k = 0; k < 20; k++) game.step([{ mx: 1 }]);
  assert.equal(game.p[0].cursor, 2);
  const before = rotation(game.p[0].pipes, 2);
  assert.deepEqual(game.step([{ turn: 1 }]).turned, [0]);
  assert.deepEqual(game.step([{ turn: 1 }]).turned, []);
  assert.equal(rotation(game.p[0].pipes, 2), (before + 1) % 4);
});
test("final tick accepts repair before ending, post-round remains inert", () => {
  const game = live(1); game.left = 1; oneTurn(game, 0);
  const snap = game.step([{ turn: 1 }]);
  assert.equal(snap.over, true); assert.equal(snap.finished, true);
  assert.equal(game.scores[0], 4);
  const after = game.step([0]);
  assert.equal(after.k, snap.k + 1); assert.equal(after.finished, false);
  assert.deepEqual(after.repaired, []); assert.equal(game.scores[0], 4);
});
test("a neutral sprint ends at tick 1260 with no phantom points", () => {
  const game = live(2); let snap;
  for (let k = 0; k < ROUND_TICKS; k++) snap = game.step(neutral(2));
  assert.equal(snap.k, 1260); assert.equal(snap.over, true); assert.equal(snap.last, -1);
  assert.deepEqual(game.scores, [0, 0]);
});
test("disconnected seats cannot act, score, win, or respawn", () => {
  const game = live(2); oneTurn(game, 1); game.scores = [32, 99]; game.disconnect(1);
  const before = game.p[1].pipes;
  const snap = game.step([0, { mx: 1, my: 1, turn: 1 }]);
  assert.equal(snap.pipes.length, 2); assert.equal(snap.pipes[1], before);
  assert.deepEqual(snap.active, [true, false]); assert.deepEqual(snap.repaired, []);
  assert.equal(game.winner(32), 0);
  game.startRound(); assert.equal(game.step([0, { turn: 1 }]).active[1], false);
  game.disconnect(0); assert.equal(game.step(neutral(2)).over, true);
});
test("a winner needs the target and a clear connected lead", () => {
  const game = build(2, {}, seededRng(3)); game.scores = [32, 32];
  assert.equal(game.winner(32), -1); game.scores[1] = 33; assert.equal(game.winner(32), 1);
});
test("full rounds round-trip within budget for every seat count", () => {
  for (let n = 1; n <= 8; n++) {
    const game = live(n);
    for (let k = 0; k < ROUND_TICKS; k++) {
      const snap = game.step(Array.from({ length: n }, (_, i) => ({ mx: (k + i) % 3 - 1, my: (k + i) % 5 - 2, turn: k % 2 })));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= n * SNAPSHOT_BUDGET_BYTES);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the intent declares only the three controls", () => assert.deepEqual(Object.keys(INTENT), ["mx", "my", "turn"]));
