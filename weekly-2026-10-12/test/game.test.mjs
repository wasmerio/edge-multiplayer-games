import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, PHASE, READY_TICKS, STITCH_TICKS, WEAVE_TICKS, REVEAL_TICKS, ERROR_TICKS,
} from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(new Array(n).fill(0));
const keys = (...values) => Object.freeze(values.map((stitch) => Object.freeze({ stitch })));
const run = (game, ticks, intents = neutral(game.n)) => {
  let snap;
  for (let i = 0; i < ticks; i++) snap = game.step(intents);
  return snap;
};
function live(n = 2) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  run(game, READY_TICKS + 3 * STITCH_TICKS);
  game.pattern = [1, 2, 3, 0, 0, 0];
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
  const snap = run(game, 100);
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM);
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3);
  assert.equal(reached.tick, 1512);
  assert.equal(reached.roundOver, true);
});
test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  run(game, READY_TICKS + 10);
  assert.equal(game.tick, READY_TICKS + 10);
});

test("countdown inputs do not weave, held keys do not cross into recall", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  const beeps = [], cues = [];
  for (let k = 1; k <= READY_TICKS + STITCH_TICKS * 3; k++) {
    const snap = game.step(keys(1));
    if (snap.beep) beeps.push(k);
    if (snap.cue) cues.push(k);
    assert.equal(snap.progress[0], 0);
  }
  assert.deepEqual(beeps, [1, 31]);
  assert.deepEqual(cues, [60, 84, 108]);
  assert.equal(game.phase, PHASE.WEAVE);
  assert.equal(game.t, WEAVE_TICKS);
  game.pattern[0] = 1;
  assert.equal(game.step(keys(1)).progress[0], 0);
  game.step(neutral(1));
  assert.equal(game.step(keys(1)).progress[0], 1);
});

test("first complete prefix scores five; later complete prefix scores three only once", () => {
  const game = live();
  game.step(keys(1, 0));
  game.step(keys(2, 0));
  const finish = game.step(keys(3, 0));
  assert.equal(finish.k, READY_TICKS + STITCH_TICKS * 3 + 3);
  assert.deepEqual(finish.completed, [0]);
  assert.deepEqual(game.scores, [5, 0]);
  game.step(keys(3, 1));
  game.step(keys(3, 2));
  assert.deepEqual(game.step(keys(3, 3)).award, [5, 3]);
  run(game, 20, keys(3, 3));
  assert.deepEqual(game.scores, [5, 3]);
});

test("simultaneous first completions share the bonus, including double patterns", () => {
  const game = live();
  game.panel = 2;
  game.step(keys(1, 1));
  game.step(keys(2, 2));
  const snap = game.step(keys(3, 3));
  assert.deepEqual(snap.completed, [0, 1]);
  assert.deepEqual(game.scores, [10, 10]);
});

test("a wrong stitch unravels progress and locks exactly twelve subsequent ticks", () => {
  const game = live(1);
  game.step(keys(1));
  const bad = game.step(keys(3));
  assert.deepEqual(bad.wrong, [0]);
  assert.equal(bad.progress[0], 0);
  assert.equal(bad.cd[0], ERROR_TICKS);
  for (let i = 0; i < ERROR_TICKS; i++) {
    const snap = game.step(keys(i % 2 === 0 ? 1 : 0));
    assert.equal(snap.progress[0], 0);
    assert.equal(snap.cd[0], ERROR_TICKS - i - 1);
  }
  assert.equal(game.step(keys(1)).progress[0], 1);
  assert.deepEqual(game.scores, [0]);
});

test("a repeated symbol requires release and numeric zero is neutral", () => {
  const game = live(1);
  game.pattern = [1, 1, 1, 0, 0, 0];
  run(game, 5, keys(1));
  assert.equal(game.p[0].progress, 1);
  game.step(neutral(1));
  game.step(keys(1));
  game.step([{}]);
  assert.deepEqual(game.step(keys(1)).completed, [0]);
});

test("the final weaving tick accepts a correct stitch before revealing", () => {
  const game = live(1);
  game.p[0].progress = 2;
  game.t = 1;
  const snap = game.step(keys(3));
  assert.equal(snap.phase, PHASE.REVEAL);
  assert.equal(snap.revealed, true);
  assert.deepEqual(game.scores, [5]);
  assert.equal(snap.t, REVEAL_TICKS);
});

test("all four complete cycles end at tick 1512 and post-round steps cannot rescore", () => {
  const game = build(2, {}, seededRng(12));
  game.startRound();
  const before = run(game, 1511);
  assert.equal(before.over, false);
  assert.equal(before.panel, 3);
  const end = game.step(neutral(2));
  assert.equal(end.over, true);
  assert.equal(end.finished, true);
  const after = game.step(keys(1, 2));
  assert.equal(after.k, 1513);
  assert.equal(after.finished, false);
  assert.deepEqual(after.tapped, []);
  assert.deepEqual(game.scores, [0, 0]);
});

test("new patterns clear progress, not held inputs, scores or round totals", () => {
  const game = live(1);
  game.step(keys(1)); game.step(keys(2)); game.step(keys(3));
  run(game, game.t + REVEAL_TICKS, keys(3));
  assert.equal(game.panel, 1);
  assert.equal(game.length, 4);
  assert.equal(game.p[0].progress, 0);
  assert.equal(game.p[0].held, 3);
  assert.equal(game.p[0].woven, 5);
  game.startRound();
  assert.equal(game.round, 2);
  assert.equal(game.p[0].woven, 0);
  assert.equal(game.p[0].held, 0);
  assert.deepEqual(game.scores, [5]);
});

test("disconnected seats cannot input, score, win or reappear next round", () => {
  const game = live();
  game.disconnect(1);
  game.scores = [50, 100];
  for (const key of [1, 2, 3]) game.step(keys(0, key));
  assert.deepEqual(game.scores, [50, 100]);
  assert.equal(game.winner(50), 0);
  game.startRound();
  assert.deepEqual(game.step(neutral(2)).active, [true, false]);
  game.disconnect(0);
  assert.equal(game.step(neutral(2)).over, true);
  assert.equal(game.winner(50), -1);
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [49, 10]; assert.equal(game.winner(50), -1);
  game.scores = [50, 50]; assert.equal(game.winner(50), -1);
  game.scores = [51, 50]; assert.equal(game.winner(50), 0);
});

test("every phase and player count round-trips within the unchanged budget", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(n));
    game.startRound();
    for (let k = 0; k < 1512; k++) {
      const intents = Object.freeze(Array.from({ length: n }, (_, i) => Object.freeze({ stitch: (k + i) % 4 })));
      const snap = game.step(intents);
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});

test("the intent declares only the stitch field", () => {
  assert.deepEqual(Object.keys(INTENT), ["stitch"]);
  assert.deepEqual(INTENT.stitch.values, [0, 1, 2, 3]);
});
