import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, SPEED, BOOST_SPEED, BOOST_TICKS, BOOST_COOLDOWN, READY_TICKS, PELLETS_PER_ROUND,
} from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Array.from({ length: n }, () => ({ mx: 0, my: 0, boost: 0 }));

// A round past its countdown, with player 0 at a known place.
function live(players, at = { x: 100, y: 100 }) {
  const game = build(players, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(players));
  Object.assign(game.p[0], at);
  game.pellet = { x: 700, y: 500 };
  return game;
}

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// ---- engine checks: keep these ----------------------------------------------

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
  const back = schema.decode(bytes, MAX_PLAYERS_PER_ROOM);
  assert.equal(back.px, snap.px);
  assert.deepEqual(back.took, snap.took);
  back.x.forEach((value, i) => assert.ok(Math.abs(value - snap.x[i]) <= 1 / 20));
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

// ---- rule scenarios: replace these with your own ----------------------------

test("nobody moves during the countdown, and it beeps three times before go", () => {
  const game = build(2, {}, seededRng(5));
  game.startRound();
  const start = game.p[0].x;
  const right = [{ mx: 1, my: 0, boost: 0 }, { mx: 0, my: 0, boost: 0 }];
  const beeps = [];
  let snap;
  for (let i = 0; i < READY_TICKS; i++) {
    snap = game.step(right);
    if (snap.beep) beeps.push(snap.k);
  }
  assert.equal(game.p[0].x, start);
  assert.deepEqual(beeps, [1, 16, 31]);
  assert.equal(snap.go, true);
  assert.equal(snap.ready, 0);
  assert.equal(game.step(right).x[0], Math.round((start + SPEED) * 10) / 10);
});

test("a straight run reaches the pellet at a predictable tick and scores", () => {
  const game = live(1);
  game.pellet = { x: 160, y: 100 };
  const taken = [];
  for (let i = 0; i < 30 && !taken.length; i++) {
    const snap = game.step([{ mx: 1, my: 0, boost: 0 }]);
    if (snap.took.length) taken.push(snap.k - READY_TICKS);
  }
  // Four units a tick from x=100; the pellet at x=160 is in reach inside 20 units.
  assert.deepEqual(taken, [11]);
  assert.equal(game.scores[0], 1);
});

test("a boost is one burst per press, then a cooldown", () => {
  const game = live(1);
  const held = [{ mx: 1, my: 0, boost: 1 }];
  const first = game.step(held);
  assert.deepEqual(first.boosted, [0]);
  assert.equal(first.x[0], 100 + BOOST_SPEED);
  for (let i = 1; i < BOOST_TICKS; i++) game.step(held);
  assert.equal(game.p[0].x, 100 + BOOST_SPEED * BOOST_TICKS);
  const after = game.step(held);
  assert.deepEqual(after.boosted, [], "a held button does not boost again");
  assert.equal(game.p[0].x, 100 + BOOST_SPEED * BOOST_TICKS + SPEED);
  game.step(neutral(1));
  assert.deepEqual(game.step(held).boosted, [], "a new press inside the cooldown is refused");
  for (let i = 0; i < BOOST_COOLDOWN; i++) game.step(neutral(1));
  assert.deepEqual(game.step(held).boosted, [0]);
});

test("a diagonal is no faster than a straight line", () => {
  const game = live(1);
  game.step([{ mx: 1, my: 1, boost: 0 }]);
  assert.ok(Math.abs(Math.hypot(game.p[0].x - 100, game.p[0].y - 100) - SPEED) < 1e-9);
});

test("a round ends after its pellets are taken", () => {
  const game = live(1);
  for (let taken = 0; taken < PELLETS_PER_ROUND; taken++) {
    assert.equal(game.roundOver, false);
    Object.assign(game.p[0], { x: game.pellet.x - 3, y: game.pellet.y });
    game.step(neutral(1));
  }
  assert.equal(game.roundOver, true);
  assert.equal(game.scores[0], PELLETS_PER_ROUND);
});

test("a player who left stays in the arrays and out of the game", () => {
  const game = live(2);
  game.disconnect(1);
  const before = { ...game.p[1] };
  const snap = game.step([{ mx: 0, my: 0, boost: 0 }, { mx: 1, my: 1, boost: 1 }]);
  assert.equal(snap.x.length, 2);
  assert.equal(game.p[1].x, before.x);
  assert.deepEqual(snap.boosted, []);
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3];
  assert.equal(game.winner(3), -1);
  game.scores = [4, 3];
  assert.equal(game.winner(3), 0);
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["mx", "my", "boost"]);
});
