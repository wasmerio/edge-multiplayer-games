import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, BID_TICKS, REVEAL_TICKS, LOTS, PHASE } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const run = (g, ticks, intents = neutral(g.n)) => { let snap; for (let i = 0; i < ticks; i++) snap = g.step(intents); return snap; };
function live(n) {
  const g = build(n, {}, seededRng(5));
  g.startRound();
  run(g, READY_TICKS);
  return g;
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const g = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  g.startRound();
  const snap = run(g, 100);
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM);
  assert.deepEqual(schema.decode(bytes, MAX_PLAYERS_PER_ROOM), snap);
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3);
});
test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});
test("one player, and a seat that has sent no input, are both fine", () => {
  const g = build(1, {}, seededRng(2));
  g.startRound();
  run(g, READY_TICKS + 10);
  assert.equal(g.tick, READY_TICKS + 10);
  assert.deepEqual(g.bid, [0]);
});

// Rule scenarios.
test("matching high bids cancel; the next unique bid wins and only it pays", () => {
  const g = live(4);
  g.bid = [9, 9, 5, 3];
  g.locked.fill(true);
  g.t = 1;
  g.values[0] = 7;
  const s = g.step(neutral(4));
  assert.equal(s.k, READY_TICKS + 1);
  assert.equal(s.last, 2);
  assert.deepEqual(s.sold, [2]);
  assert.deepEqual(g.scores, [0, 0, 7, 0]);
  assert.deepEqual(s.wallet, [24, 24, 19, 24]);
  assert.equal(s.phase, PHASE.REVEAL);
  assert.equal(s.revealed, true);
  assert.deepEqual(g.step(neutral(4)).sold, []);
});
test("all tied, zero and unsealed offers never score", () => {
  const g = live(4);
  g.bid = [5, 5, 0, 9];
  g.locked = [true, true, true, false];
  g.t = 1;
  const s = g.step(neutral(4));
  assert.equal(s.last, -1);
  assert.deepEqual(g.scores, [0, 0, 0, 0]);
  assert.deepEqual(g.wallet, [24, 24, 24, 24]);
});
test("adjust repeats on tick nine, clamps to purse, and sealing is final", () => {
  const g = live(1);
  const up = Object.freeze([Object.freeze({ adjust: 1, seal: 0 })]);
  assert.equal(g.step(up).bid[0], 1);
  run(g, 7, up);
  assert.equal(g.bid[0], 1);
  assert.equal(g.step(up).bid[0], 2);
  g.wallet[0] = 3;
  run(g, 40, up);
  assert.equal(g.bid[0], 3);
  assert.deepEqual(g.step([{ seal: 1 }]).sealed, [0]);
  assert.equal(g.step([{ adjust: -1 }]).bid[0], 3);
});
test("countdown and complete neutral round have exact duration and no phantom awards", () => {
  const g = build(2, {}, seededRng(8));
  g.startRound();
  const beeps = [];
  let s;
  for (let i = 0; i < READY_TICKS; i++) {
    s = g.step([{ adjust: 1, seal: 1 }, 0]);
    if (s.beep) beeps.push(s.k);
  }
  assert.deepEqual(beeps, [1, 31]);
  assert.equal(s.go, true);
  assert.deepEqual(g.bid, [0, 0]);
  s = run(g, LOTS * (BID_TICKS + REVEAL_TICKS) - 1);
  assert.equal(s.over, false);
  s = g.step(neutral(2));
  assert.equal(s.k, READY_TICKS + LOTS * (BID_TICKS + REVEAL_TICKS));
  assert.equal(s.ended, true);
  assert.equal(s.over, true);
  assert.deepEqual(g.scores, [0, 0]);
  assert.equal(g.step(neutral(2)).ended, false);
});
test("the deadline includes its last tick and the next lot clears offers", () => {
  const g = live(2);
  g.bid = [4, 0];
  g.t = 1;
  const s = g.step([{ seal: 1 }, 0]);
  assert.equal(s.last, 0);
  run(g, REVEAL_TICKS);
  assert.equal(g.lot, 1);
  assert.equal(g.phase, PHASE.BID);
  assert.deepEqual(g.bid, [0, 0]);
  assert.deepEqual(g.locked, [false, false]);
});
test("disconnect cancels a sealed bid and persists across rounds", () => {
  const g = live(2);
  g.bid = [4, 8];
  g.locked.fill(true);
  g.disconnect(1);
  g.t = 1;
  assert.equal(g.step(neutral(2)).last, 0);
  g.scores[1] = 100;
  assert.equal(g.winner(35), -1);
  g.startRound();
  assert.deepEqual(g.wallet, [24, 0]);
  assert.deepEqual(g.gone, [false, true]);
});
test("trailing players receive capped comeback purses; match needs a unique leader", () => {
  const g = build(3, {}, seededRng(4));
  g.scores = [35, 35, 31];
  assert.equal(g.winner(35), -1);
  g.scores = [38, 35, 20];
  assert.equal(g.winner(35), 0);
  g.startRound();
  assert.deepEqual(g.wallet, [24, 27, 30]);
  assert.deepEqual([...g.values].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7]);
});
test("every snapshot encodes at one through eight seats throughout a round", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const g = live(n);
    while (!g.roundOver) {
      const intents = Object.freeze(Array.from({ length: n }, (_, i) => Object.freeze({ adjust: (g.tick + i) % 3 - 1, seal: g.t < 15 ? 1 : 0 })));
      const s = g.step(intents);
      const bytes = schema.encode(s, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), s);
    }
  }
});
test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["adjust", "seal"]);
});
