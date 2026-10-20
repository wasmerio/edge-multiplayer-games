import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, READY_TICKS, AIM_TICKS, REST_TICKS, MAX_CHARGE, PHASE, FRICTION, speedFor, awardsFor,
} from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const run = (game, ticks, intents = neutral(game.n)) => {
  let snap;
  for (let i = 0; i < ticks; i++) snap = game.step(intents);
  return snap;
};
function live(players = 2) {
  const game = build(players, {}, seededRng(5));
  game.startRound();
  run(game, READY_TICKS);
  return game;
}
const controls = (game, value) => Object.freeze(game.p.map((_, i) => i === game.turn ? Object.freeze(value) : 0));

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
  run(game, AIM_TICKS + REST_TICKS);
  assert.equal(game.roundOver, true);
  assert.deepEqual(game.scores, [0]);
});

test("countdown opens exactly on tick 45 with three beats", () => {
  const game = build(2, {}, seededRng(5));
  game.startRound();
  const beats = [];
  let snap;
  for (let k = 1; k <= READY_TICKS; k++) {
    snap = game.step(neutral(2));
    if (snap.beep) beats.push(k);
  }
  assert.deepEqual(beats, [1, 16, 31]);
  assert.equal(snap.k, 45);
  assert.equal(snap.phase, PHASE.AIM);
  assert.equal(snap.t, AIM_TICKS);
  assert.equal(snap.opened, true);
});

test("holding charges; release launches exactly once and friction slows it", () => {
  const game = live(1);
  game.p[0].angle = 0;
  const held = controls(game, { slide: 1 });
  assert.deepEqual(game.step(held).wound, [0]);
  run(game, 29, held);
  assert.equal(game.charge, 30);
  const x = game.p[0].x;
  const snap = game.step(neutral(1));
  assert.deepEqual(snap.sent, [0]);
  assert.equal(snap.k, READY_TICKS + 31);
  assert.equal(snap.x[0], x);
  assert.equal(game.vx, speedFor(30));
  assert.deepEqual(game.step(neutral(1)).sent, []);
  assert.equal(game.p[0].x, x + speedFor(30));
  assert.ok(Math.abs(game.vx - (speedFor(30) - FRICTION)) < 1e-9);
});

test("a key held before a turn must be released before it charges", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  const held = Object.freeze([Object.freeze({ slide: 1 })]);
  run(game, READY_TICKS + 5, held);
  assert.equal(game.charging, false);
  assert.equal(game.charge, 0);
  game.step(neutral(1));
  assert.deepEqual(game.step(held).wound, [0]);
});

test("the clock skips a neutral player or releases a maximum held charge", () => {
  const game = live(1);
  const snap = run(game, AIM_TICKS);
  assert.deepEqual(snap.missed, [0]);
  assert.equal(snap.phase, PHASE.REST);
  assert.equal(game.p[0].state, 3);
  const other = live(1);
  const sent = run(other, AIM_TICKS, controls(other, { slide: 1 }));
  assert.equal(sent.charge, MAX_CHARGE);
  assert.deepEqual(sent.sent, [0]);
  assert.equal(sent.phase, PHASE.SLIDE);
});

test("contact stops the striker and transfers forward momentum", () => {
  const game = live(2);
  game.setPhase(PHASE.SLIDE, 90);
  Object.assign(game.p[0], { x: 200, y: 240, state: 1 });
  Object.assign(game.p[1], { x: 239, y: 240, state: 1 });
  game.moving = 0;
  game.vx = 10;
  game.vy = 0;
  const snap = game.step(neutral(2));
  assert.deepEqual(snap.hit, [0, 1]);
  assert.equal(snap.moving, 1);
  assert.equal(snap.x[0], 206.9);
  assert.equal(game.p[1].x, 239);
  assert.equal(game.vx, 9 - FRICTION);
  const old = game.p[0].x;
  game.step(neutral(2));
  assert.equal(game.p[0].x, old);
  assert.equal(game.p[1].x, 239 + 9 - FRICTION);
});

test("ice edges remove a moving stone and start the rest clock", () => {
  const game = live(1);
  game.setPhase(PHASE.SLIDE, 90);
  game.moving = 0;
  Object.assign(game.p[0], { x: arenaOf(1).w - 42, y: 240, state: 1 });
  game.vx = 8;
  const snap = game.step(neutral(1));
  assert.deepEqual(snap.out, [0]);
  assert.equal(snap.state[0], 2);
  assert.equal(snap.moving, -1);
  assert.equal(snap.phase, PHASE.REST);
  assert.equal(snap.t, REST_TICKS);
});

test("the last rest scores house rings and nearest bonus exactly once", () => {
  const game = live(4);
  game.tx = 460;
  game.ty = 240;
  [0, 50, 90, 101].forEach((d, i) => Object.assign(game.p[i], { x: 460 + d, y: 240, state: 1 }));
  game.cursor = game.order.length - 1;
  game.setPhase(PHASE.REST, 1);
  const snap = game.step(neutral(4));
  assert.deepEqual(snap.award, [5, 2, 1, 0]);
  assert.deepEqual(snap.scored, [0, 1, 2]);
  assert.equal(snap.finished, true);
  assert.equal(snap.over, true);
  const after = game.step(neutral(4));
  assert.equal(after.k, snap.k + 1);
  assert.deepEqual(after.scored, []);
  assert.deepEqual(game.scores, [5, 2, 1, 0]);
});

test("tied nearest stones share the bonus and disconnected stones cannot score", () => {
  assert.deepEqual(awardsFor({ x: [440, 480, 460], y: [240, 240, 240], tx: 460, ty: 240, state: [1, 1, 1], active: [true, true, false] }), [5, 5, 0]);
});

test("leaders throw first; gone seats stay absent in later rounds", () => {
  const game = live(4);
  game.scores = [3, 9, 0, 5];
  game.disconnect(3);
  game.startRound();
  assert.deepEqual(game.order, [1, 0, 2]);
  assert.deepEqual(game.rank, [1, 0, 2, 255]);
  run(game, READY_TICKS);
  assert.equal(game.turn, 1);
  game.disconnect(1);
  game.step(neutral(4));
  assert.equal(game.phase, PHASE.REST);
  run(game, REST_TICKS);
  assert.equal(game.turn, 0);
  assert.equal(game.p.length, 4);
});

test("disconnecting the moving stone stops it; all gone ends safely", () => {
  const game = live(1);
  game.step(controls(game, { slide: 1 }));
  game.step(neutral(1));
  game.disconnect(0);
  assert.equal(game.moving, -1);
  const snap = game.step(neutral(1));
  assert.equal(snap.over, true);
  assert.deepEqual(game.scores, [0]);
});

test("a winner needs a target and unique connected lead", () => {
  const game = live(3);
  game.scores = [12, 12, 20];
  game.disconnect(2);
  assert.equal(game.winner(12), -1);
  game.scores[0]++;
  assert.equal(game.winner(12), 0);
  assert.equal(game.winner(15), -1);
});

test("complete rounds at every player count stay finite, quantised and within budget", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(83));
    game.startRound();
    for (let k = 0; k < 2000 && !game.roundOver; k++) {
      const intents = Object.freeze(game.p.map((_, i) => Object.freeze({ aim: k % 60 < 20 ? -1 : k % 60 < 40 ? 1 : 0, slide: game.turn === i && game.charge < 40 ? 1 : 0 })));
      const snap = game.step(intents);
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
    assert.equal(game.roundOver, true);
  }
});

test("the intent declares exactly the game controls", () => {
  assert.deepEqual(Object.keys(INTENT), ["aim", "slide"]);
});
