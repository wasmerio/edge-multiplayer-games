import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, WORK_TICKS, REVIEW_TICKS, JOBS, PHASE, flow, ports, orientation, setOrientation, solutionFor } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";
import bot from "./bot.mjs";
import * as rules from "../public/game.js";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = n => Object.freeze(Array(n).fill(0));
const run = (g, ticks, intents = neutral(g.n)) => { let s; for (let i = 0; i < ticks; i++) s = g.step(intents); return s; };
function live(n) {
  const g = build(n, {}, seededRng(5));
  g.startRound();
  run(g, READY_TICKS);
  return g;
}
function solve(g, i) { g.p[i].rot = solutionFor(g.types).rot; }
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
  const g = build(1, {}, seededRng(2));
  g.startRound();
  run(g, READY_TICKS + 10);
  assert.equal(g.tick, READY_TICKS + 10);
});

test("countdown advances, beeps three times, and never turns a pipe", () => {
  const g = build(2, {}, seededRng(5));
  g.startRound();
  const before = g.p[0].rot, beeps = [];
  const intent = Object.freeze([Object.freeze({ select: 1, rotate: 1 }), 0]);
  let snap;
  for (let i = 0; i < READY_TICKS; i++) { snap = g.step(intent); if (snap.beep) beeps.push(snap.k); }
  assert.deepEqual(beeps, [1, 16, 31]);
  assert.equal(g.p[0].rot, before);
  assert.equal(snap.opened, true);
  assert.equal(snap.phase, PHASE.WORK);
  assert.deepEqual(g.step(intent).turned, [], "held briefing key is not a fresh turn");
});
test("a rotation acts once per press and affects only the selected tile", () => {
  const g = live(1), before = g.p[0].rot;
  const held = Object.freeze([Object.freeze({ rotate: 1 })]);
  const snap = g.step(held);
  assert.deepEqual(snap.turned, [0]);
  assert.equal(orientation(snap.rot[0], 3), (orientation(before, 3) + 1) % 4);
  assert.equal(snap.rot[0] & ~(3 << 6), before & ~(3 << 6));
  assert.deepEqual(g.step(held).turned, []);
  g.step(neutral(1));
  assert.deepEqual(g.step(held).turned, [0]);
});
test("selection wraps, changes direction immediately and repeats on the eighth tick", () => {
  const g = live(1);
  g.p[0].cursor = 0;
  assert.equal(g.step([{ select: -1 }]).cursor[0], 8);
  run(g, 7, [{ select: -1 }]);
  assert.equal(g.p[0].cursor, 8);
  assert.equal(g.step([{ select: -1 }]).cursor[0], 7);
  assert.equal(g.step([{ select: 1 }]).cursor[0], 8);
});
test("water requires reciprocal openings and the outlet, not merely reaching its tile", () => {
  let rot = 0;
  for (const c of [3, 4, 5]) rot = setOrientation(rot, c, 1);
  assert.deepEqual(flow(0, rot), { wet: (1 << 3) | (1 << 4) | (1 << 5), solved: true });
  rot = setOrientation(rot, 4, 0);
  assert.deepEqual(flow(0, rot), { wet: 1 << 3, solved: false });
  rot = setOrientation(rot, 4, 1);
  // An elbow accepting from the west but pointing north does not open the outlet.
  rot = setOrientation(rot, 5, 3);
  assert.equal(ports(1 << 5, rot, 5), 9);
  assert.equal(flow(1 << 5, rot).solved, false);
});
test("simultaneous first connections share five, later connections receive three only once", () => {
  const g = live(3);
  solve(g, 0); solve(g, 1);
  const snap = g.step(neutral(3));
  assert.equal(snap.k, READY_TICKS + 1);
  assert.deepEqual(snap.completed, [0, 1]);
  assert.deepEqual(g.scores, [5, 5, 0]);
  solve(g, 2);
  assert.deepEqual(g.step(neutral(3)).completed, [2]);
  run(g, 10);
  assert.deepEqual(g.scores, [5, 5, 3]);
});
test("the last work tick counts, the final order pays double, and solved boards lock", () => {
  const g = live(2);
  g.job = JOBS - 1;
  g.t = 1;
  solve(g, 0);
  const snap = g.step(neutral(2));
  assert.equal(snap.phase, PHASE.REVIEW);
  assert.equal(snap.reviewed, true);
  assert.deepEqual(g.scores, [10, 0]);
  const rot = g.p[0].rot;
  g.step([{ rotate: 1 }, 0]);
  assert.equal(g.p[0].rot, rot);
});
test("exact round deadline, no neutral scoring, and post-round calls are inert except the tick", () => {
  const g = build(2, {}, seededRng(8));
  g.startRound();
  const duration = READY_TICKS + JOBS * (WORK_TICKS + REVIEW_TICKS);
  run(g, duration - 1);
  assert.equal(g.roundOver, false);
  const last = g.step(neutral(2));
  assert.equal(last.k, 1485);
  assert.equal(last.over, true);
  assert.equal(last.finished, true);
  assert.deepEqual(g.scores, [0, 0]);
  const after = g.step([{ rotate: 1 }, { select: 1 }]);
  assert.equal(after.k, last.k + 1);
  assert.equal(after.finished, false);
  assert.deepEqual(after.turned, []);
  assert.deepEqual(after.rot, last.rot);
});
test("generated plans are unsolved at spawn and solvable over many seeds", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const g = build(1, {}, seededRng(seed));
    g.startRound();
    assert.equal(flow(g.types, g.p[0].rot).solved, false);
    const solution = solutionFor(g.types);
    assert.ok(solution);
    assert.equal(flow(g.types, solution.rot).solved, true);
    assert.ok(schema.encode(g.step(neutral(1)), 1).byteLength <= SNAPSHOT_BUDGET_BYTES);
  }
});
test("disconnects cannot turn, score, win, or return in the next round", () => {
  const g = live(2);
  g.disconnect(0);
  solve(g, 0);
  const rot = g.p[0].rot;
  const snap = g.step([{ rotate: 1 }, 0]);
  assert.equal(snap.rot[0], rot);
  assert.deepEqual(g.scores, [0, 0]);
  assert.equal(snap.active.length, 2);
  g.scores = [100, 31];
  assert.equal(g.winner(30), 1);
  g.startRound();
  assert.deepEqual(g.step(neutral(2)).active, [false, true]);
  g.disconnect(1);
  assert.equal(g.step(neutral(2)).over, true);
});
test("a winner needs the target and a clear connected lead", () => {
  const g = build(2, {}, seededRng(3));
  g.scores = [30, 30]; assert.equal(g.winner(30), -1);
  g.scores = [31, 30]; assert.equal(g.winner(30), 0);
});
test("the browser bot can connect all three plans with distinct crew rhythms", () => {
  const g = build(8, {}, seededRng(34));
  g.startRound();
  let snap = g.step(neutral(8));
  let intents = neutral(8), step = 0;
  for (let tick = 1; tick < 1485; tick++) {
    if (tick % 2 === 0) {
      step++;
      intents = Array.from({ length: 8 }, (_, seat) => {
        const keys = bot(snap, { seat, game: rules, step });
        return { select: keys.ArrowRight ? 1 : keys.ArrowLeft ? -1 : 0, rotate: keys.Space ? 1 : 0 };
      });
    }
    snap = g.step(Object.freeze(intents));
  }
  assert.equal(snap.over, true);
  assert.ok(g.scores.every(score => score >= 12), JSON.stringify(g.scores));
});
test("the intent declares only the two pipe controls", () => {
  assert.deepEqual(Object.keys(INTENT), ["select", "rotate"]);
});
