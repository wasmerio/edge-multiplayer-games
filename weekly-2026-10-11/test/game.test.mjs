import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, BEAT_TICKS, RECALL_TICKS, REVIEW_TICKS, LOCK_TICKS, PHASE } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const keys = (...values) => Object.freeze(values.map((stitch) => Object.freeze({ stitch })));
function live(n = 2) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let j = 0; j < READY_TICKS + 3 * BEAT_TICKS; j++) game.step(neutral(n));
  game.pattern = [1, 2, 3, 0, 0, 0, 0];
  return game;
}
function press(game, ...values) { game.step(neutral(game.n)); return game.step(keys(...values)); }
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

test("countdown ignores presses, then demonstrates the first cue at tick 60", () => {
  const game = build(2, {}, seededRng(1));
  game.startRound();
  const beeps = [];
  let snap;
  for (let i = 0; i < READY_TICKS; i++) {
    snap = game.step(keys(1, 2));
    if (snap.beep) beeps.push(snap.k);
  }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(snap.phase, PHASE.SHOW);
  assert.equal(snap.shown, snap.pattern[0]);
  assert.equal(snap.cue, true);
  assert.deepEqual(snap.progress, [0, 0]);
  for (let i = 0; i < 15; i++) snap = game.step(neutral(2));
  assert.equal(snap.shown, 0, "six-tick gap separates stitches");
  for (let i = 0; i < 6; i++) snap = game.step(neutral(2));
  assert.equal(snap.shown, snap.pattern[1]);
  assert.equal(snap.cue, true);
});
test("a correct sequence scores only on completion, simultaneous firsts share bonus", () => {
  const game = live();
  const one = game.step(keys(1, 1));
  assert.equal(one.k, 124);
  assert.deepEqual(one.correct, [0, 1]);
  assert.deepEqual(game.scores, [0, 0]);
  press(game, 2, 2);
  const final = press(game, 3, 3);
  assert.equal(final.k, 128);
  assert.deepEqual(final.finished, [0, 1]);
  assert.deepEqual(final.award, [7, 7]);
  assert.deepEqual(game.scores, [7, 7]);
  assert.deepEqual(press(game, 1, 1).finished, []);
  assert.deepEqual(game.scores, [7, 7]);
});
test("later finishers get base points rather than the first bonus", () => {
  const game = live();
  for (const symbol of [1, 2, 3]) press(game, symbol, 0);
  for (const symbol of [1, 2, 3]) press(game, 0, symbol);
  assert.deepEqual(game.scores, [7, 5]);
  assert.equal(game.first, 0);
});
test("wrong stitch unweaves one step and locks for twelve ticks", () => {
  const game = live(1);
  game.step(keys(1));
  const wrong = press(game, 3);
  assert.deepEqual(wrong.wrong, [0]);
  assert.equal(wrong.progress[0], 0);
  assert.equal(wrong.lock[0], LOCK_TICKS);
  assert.equal(press(game, 1).progress[0], 0);
  for (let i = 0; i < LOCK_TICKS; i++) game.step(neutral(1));
  assert.equal(game.step(keys(1)).progress[0], 1);
  assert.equal(game.scores[0], 0);
});
test("a trailing player's mend protects exactly one mistake per pattern", () => {
  const game = live();
  game.scores = [9, 0];
  game.startRound();
  assert.equal(game.p[1].mend, 1);
  assert.equal(game.p[0].mend, 0);
  game.phase = PHASE.RECALL; game.t = RECALL_TICKS;
  game.pattern = [1, 2, 3, 0, 0, 0, 0];
  game.step(keys(1, 1));
  const wrong = press(game, 3, 3);
  assert.deepEqual(wrong.progress, [0, 1]);
  assert.deepEqual(wrong.mended, [1]);
  assert.deepEqual(wrong.mend, [0, 0]);
  for (let i = 0; i < LOCK_TICKS; i++) game.step(neutral(2));
  assert.equal(game.step(keys(0, 3)).progress[1], 0);
});
test("holding and switching keys without release cannot stitch twice", () => {
  const game = live(1);
  game.step(keys(1));
  for (let i = 0; i < 4; i++) game.step(keys(1));
  assert.deepEqual(game.step(keys(2)).pressed, []);
  assert.equal(game.p[0].progress, 1);
  assert.equal(press(game, 2).progress[0], 2);
});
test("holding a demonstration key into recall needs a release", () => {
  const game = build(1, {}, seededRng(2)); game.startRound();
  const first = game.pattern[0];
  for (let i = 0; i < READY_TICKS + 3 * BEAT_TICKS + 2; i++) game.step(keys(first));
  assert.equal(game.p[0].progress, 0);
  assert.equal(press(game, first).progress[0], 1);
});
test("the final recall tick accepts a completion before the review", () => {
  const game = live(1);
  game.p[0].progress = 2; game.t = 1;
  const snap = game.step(keys(3));
  assert.deepEqual(snap.finished, [0]);
  assert.equal(snap.phase, PHASE.REVIEW);
  assert.equal(snap.t, REVIEW_TICKS);
  assert.equal(snap.review, true);
  assert.equal(game.scores[0], 7);
});
test("five patterns end exactly at tick 1755 and never score after over", () => {
  const game = build(1, {}, seededRng(3)); game.startRound();
  let snap;
  for (let i = 0; i < 1754; i++) snap = game.step(neutral(1));
  assert.equal(snap.over, false);
  snap = game.step(neutral(1));
  assert.equal(snap.over, true); assert.equal(snap.ended, true); assert.equal(snap.k, 1755);
  assert.equal(snap.phrase, 4); assert.equal(snap.phase, PHASE.DONE);
  snap = game.step(keys(1));
  assert.equal(snap.k, 1756); assert.equal(snap.ended, false);
  assert.deepEqual(snap.pressed, []); assert.deepEqual(game.scores, [0]);
});
test("disconnect persists across rounds and excludes scoring and winning", () => {
  const game = live(); game.disconnect(1);
  for (const symbol of [1, 2, 3]) press(game, symbol, symbol);
  assert.deepEqual(game.scores, [7, 0]);
  game.scores[1] = 100;
  assert.equal(game.winner(7), 0);
  game.startRound();
  assert.equal(game.step(neutral(2)).active[1], false);
  game.disconnect(0);
  assert.equal(game.step(neutral(2)).over, true);
  assert.equal(game.winner(0), -1);
});
test("a winner needs the target and a unique connected lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3]; assert.equal(game.winner(3), -1);
  game.scores = [4, 3]; assert.equal(game.winner(5), -1); assert.equal(game.winner(3), 0);
});
test("every 1–8 player snapshot fits and round-trips throughout a full round", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(n)); game.startRound();
    while (!game.roundOver) {
      const values = game.p.map((p, i) => game.tick % (4 + i) === 0 ? game.pattern[p.progress] || 0 : 0);
      const snap = game.step(keys(...values));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("seeded patterns have no adjacent repeats, unused symbols are zero", () => {
  const game = live();
  for (let i = 0; i < 10; i++) {
    game.startRound();
    assert.ok(game.pattern.slice(0, 3).every((s, j) => s >= 1 && s <= 3 && s !== game.pattern[j - 1]));
    assert.deepEqual(game.pattern.slice(3), [0, 0, 0, 0]);
  }
});
test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["stitch"]);
  assert.deepEqual(INTENT.stitch.values, [0, 1, 2, 3]);
});
