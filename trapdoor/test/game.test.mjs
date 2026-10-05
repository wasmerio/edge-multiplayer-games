import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, ARENA, TARGET, TILE, TOP, RADIUS, SPEED, DASH_SPEED, DASH_TICKS, DASH_COOLDOWN, READY_TICKS,
  DROP_TICKS, LOCK_TICKS, BONUS, NONE, PHASE, ALIVE, FALLEN, GONE, callTicks, symbolsAt, safeCount, layout, gridFor,
} from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Array.from({ length: n }, () => ({ mx: 0, my: 0, act: 0 }));
const centre = (game, index) => ({ x: (index % game.cols + 0.5) * TILE, y: TOP + (Math.floor(index / game.cols) + 0.5) * TILE });
const tileOf = (game, wanted) => game.lay.findIndex((sym, i) => (sym === game.sym) === wanted && !game.cracked(i));
const put = (game, seat, index) => Object.assign(game.p[seat], centre(game, index));

// A round in its first call, one tick after the countdown.
function live(players) {
  const game = build(players, {}, seededRng(5));
  game.startRound();
  for (let i = 0; i < READY_TICKS; i++) game.step(neutral(players));
  assert.equal(game.phase, PHASE.CALL);
  return game;
}

// Step until the trapdoors open; returns the snapshot of that tick.
function untilOpen(game, intents) {
  for (let i = 0; i < 200; i++) {
    const snap = game.step(intents);
    if (snap.open) return snap;
  }
  throw new Error("the floor never opened");
}

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// ---- engine checks ----------------------------------------------------------

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: ARENA(2) }), true);
});

test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  game.startRound();
  let snap;
  for (let i = 0; i < 100; i++) snap = game.step(neutral(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM, bytes.byteLength + " bytes");
  assert.ok(schema.encode(build(1, {}, seededRng(4)).step([0]), 1).byteLength <= SNAPSHOT_BUDGET_BYTES);
  const back = schema.decode(bytes, MAX_PLAYERS_PER_ROOM);
  assert.equal(back.seed, snap.seed);
  assert.equal(back.last, -1);
  assert.deepEqual(back.crack, snap.crack);
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
  put(game, 0, tileOf(game, false));
  const snap = untilOpen(game, Object.freeze([0]));
  assert.deepEqual(snap.fell, [0]);
  assert.deepEqual(snap.won, [], "nobody to outlast, so no bonus");
  for (let i = 0; i < DROP_TICKS; i++) game.step(Object.freeze([0]));
  assert.equal(game.roundOver, true);
  assert.equal(game.scores[0], 0);
  assert.equal(game.winner(TARGET(1)), -1);
});

// ---- rule scenarios ---------------------------------------------------------

test("the countdown beeps three times, then the first call starts", () => {
  const game = build(2, {}, seededRng(5));
  game.startRound();
  const beeps = [];
  let snap;
  for (let i = 0; i < READY_TICKS; i++) {
    snap = game.step(neutral(2));
    if (snap.beep) beeps.push(snap.k);
  }
  assert.deepEqual(beeps, [1, 26, 51]);
  assert.equal(snap.go, true);
  assert.equal(snap.call, true);
  assert.equal(snap.phase, PHASE.CALL);
  assert.equal(snap.t, callTicks(0));
  assert.equal(snap.safe, safeCount(0, 24, 2));
  assert.equal([...game.lay].filter((sym) => sym === game.sym).length, snap.safe);
});

test("the floor opens at a known tick; the one on the wrong shape falls and the other scores", () => {
  const game = live(2);
  put(game, 0, tileOf(game, true));
  put(game, 1, tileOf(game, false));
  const snap = untilOpen(game, neutral(2));
  assert.equal(snap.k, READY_TICKS + callTicks(0));
  assert.deepEqual(snap.fell, [1]);
  assert.deepEqual(snap.pt, [0]);
  assert.deepEqual(snap.won, [0]);
  assert.equal(snap.last, 0);
  assert.deepEqual(game.scores, [1 + BONUS, 0]);
  assert.deepEqual(snap.st, [ALIVE, FALLEN]);
  // The pit stays open for the rest of the drop, then the round is over.
  for (let i = 0; i < DROP_TICKS - 1; i++) assert.equal(game.step(neutral(2)).over, false);
  const end = game.step(neutral(2));
  assert.equal(end.over, true);
  assert.equal(end.k, READY_TICKS + callTicks(0) + DROP_TICKS);
});

test("everyone on the called shape survives, and the next call is shorter", () => {
  const game = live(3);
  const safe = tileOf(game, true);
  for (let i = 0; i < 3; i++) put(game, i, safe);
  const snap = untilOpen(game, neutral(3));
  assert.deepEqual(snap.fell, []);
  let next;
  for (let i = 0; i < DROP_TICKS; i++) next = game.step(neutral(3));
  assert.equal(next.call, true);
  assert.equal(next.drop, 1);
  assert.equal(next.t, callTicks(1));
  assert.ok(callTicks(1) < callTicks(0));
  assert.notEqual(next.sym, snap.sym);
  assert.deepEqual(game.scores, [0, 0, 0]);
});

test("a dash is one burst per press, and a dash that lands shoves", () => {
  const game = live(2);
  Object.assign(game.p[0], { x: 200, y: 400, dx: 1, dy: 0 });
  Object.assign(game.p[1], { x: 200 + RADIUS * 2 + DASH_SPEED * 2, y: 400 });
  const held = [{ mx: 1, my: 0, act: 1 }, { mx: 0, my: 0, act: 0 }];
  const first = game.step(held);
  assert.deepEqual(first.dashed, [0]);
  assert.equal(first.x[0], 200 + DASH_SPEED);
  assert.deepEqual(first.shoved, []);
  const second = game.step(held);
  assert.deepEqual(second.shoved, [], "touching is not overlapping");
  const third = game.step(held);
  assert.deepEqual(third.shoved, [1]);
  assert.equal(third.ha[1], 0);
  const before = game.p[1].x;
  for (let i = 0; i < 12; i++) game.step(neutral(2));
  assert.ok(game.p[1].x - before > TILE * 0.6, "the shove carries most of a tile: " + (game.p[1].x - before));
  assert.deepEqual(game.step(held).dashed, [], "a new press inside the cooldown is refused");
  for (let i = 0; i < DASH_COOLDOWN; i++) game.step(neutral(2));
  assert.deepEqual(game.step(held).dashed, [0]);
  assert.equal(DASH_TICKS * DASH_SPEED > TILE, true);
});

test("a shove into the open pit is a fall", () => {
  const game = live(2);
  const safe = tileOf(game, true);
  put(game, 0, safe);
  put(game, 1, safe);
  game.p[0].x -= 35;
  game.p[1].x += 35;
  untilOpen(game, neutral(2));
  assert.deepEqual(game.p.map((me) => me.st), [ALIVE, ALIVE]);
  const fell = [];
  for (let i = 0; i < 10; i++) fell.push(...game.step([{ mx: 1, my: 0, act: 1 }, { mx: 0, my: 0, act: 0 }]).fell);
  assert.deepEqual(fell, [1]);
  assert.equal(game.last, 0);
});

test("a fallen player cracks one called tile per call, never the last one, never in the last second", () => {
  const game = live(3);
  const safe = tileOf(game, true);
  put(game, 0, safe);
  put(game, 1, safe);
  put(game, 2, tileOf(game, false));
  untilOpen(game, neutral(3));
  for (let i = 0; i < DROP_TICKS; i++) game.step(neutral(3));
  assert.equal(game.p[2].st, FALLEN);
  assert.equal(game.phase, PHASE.CALL);
  const press = [{ mx: 0, my: 0, act: 0 }, { mx: 0, my: 0, act: 0 }, { mx: 0, my: 0, act: 1 }];
  // Not on a called tile: refused.
  put(game, 2, tileOf(game, false));
  assert.deepEqual(game.step(press).denied, [2]);
  game.step(neutral(3));
  const target = tileOf(game, true);
  put(game, 0, target);
  put(game, 1, game.lay.findLastIndex((sym) => sym === game.sym));
  put(game, 2, target);
  const snap = game.step(press);
  assert.deepEqual(snap.cracked, [2]);
  assert.equal(snap.crack[2], target);
  game.step(neutral(3));
  put(game, 2, tileOf(game, true));
  assert.deepEqual(game.step(press).denied, [2], "one crack per call");
  const open = untilOpen(game, neutral(3));
  assert.deepEqual(open.fell, [0], "the cracked tile opened under seat 0");
  assert.equal(game.last, 1);
  assert.deepEqual(game.scores, [1, 2 + BONUS, 0]);
});

test("the last intact called tile cannot be cracked, and the last second is locked", () => {
  const game = live(2);
  game.p[1].st = FALLEN;
  game.ending = true;
  // Leave one called tile.
  game.lay = game.lay.map((sym, i) => (i === 0 ? game.sym : (game.sym + 1) % game.nsym));
  put(game, 1, 0);
  const press = [{ mx: 0, my: 0, act: 0 }, { mx: 0, my: 0, act: 1 }];
  game.ending = false;
  game.last = -1;
  game.p[0].st = ALIVE;
  assert.equal(game.intactSafe(), 1);
  const snap = game.step(press);
  assert.deepEqual(snap.denied, [1]);
  assert.equal(snap.crack[1], NONE);
  const late = live(2);
  late.p[1].st = FALLEN;
  late.ending = true;
  late.t = LOCK_TICKS;
  put(late, 1, tileOf(late, true));
  late.ending = false;
  // t drops below the lock on this tick.
  assert.deepEqual(late.step(press).denied, [1]);
});

test("the leader starts the round marked and slower", () => {
  const game = build(2, {}, seededRng(5));
  game.scores = [4, 2];
  game.startRound();
  assert.equal(game.lead, 0);
  Object.assign(game.p[0], { x: 300, y: 300 });
  Object.assign(game.p[1], { x: 300, y: 600 });
  const snap = game.step([{ mx: 1, my: 0, act: 0 }, { mx: 1, my: 0, act: 0 }]);
  assert.ok(snap.x[0] < snap.x[1]);
  assert.equal(snap.x[1], 300 + SPEED);
  assert.equal(snap.lead, 0);
});

test("a diagonal is no faster than a straight line", () => {
  const game = live(1);
  Object.assign(game.p[0], { x: 300, y: 300 });
  game.step([{ mx: 1, my: 1, act: 0 }]);
  assert.ok(Math.abs(Math.hypot(game.p[0].x - 300, game.p[0].y - 300) - SPEED) < 1e-9);
});

test("a player who left stays in the arrays, out of the game and out of the next round", () => {
  const game = live(3);
  game.disconnect(1);
  const snap = game.step([{ mx: 0, my: 0, act: 0 }, { mx: 1, my: 1, act: 1 }, { mx: 0, my: 0, act: 0 }]);
  assert.equal(snap.x.length, 3);
  assert.equal(snap.st[1], GONE);
  assert.deepEqual(snap.dashed, []);
  assert.equal(game.roundOver, false, "two are still standing");
  game.disconnect(2);
  game.step(neutral(3));
  assert.deepEqual(game.step(neutral(3)).won.length + game.scores[0], BONUS, "the one left is the last one standing");
  assert.equal(game.roundOver, true);
  game.startRound();
  assert.deepEqual(game.p.map((me) => me.st), [ALIVE, GONE, GONE]);
});

test("the floor is the same on every peer, and it gets meaner", () => {
  const a = layout(123456, 48, 5, 2, 9);
  assert.deepEqual([...a], [...layout(123456, 48, 5, 2, 9)]);
  assert.notDeepEqual([...a], [...layout(123457, 48, 5, 2, 9)]);
  assert.equal([...a].filter((sym) => sym === 2).length, 9);
  assert.ok([...a].every((sym) => sym < 5));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((drop) => safeCount(drop, 24, 2)), [8, 7, 5, 4, 3, 2, 2, 1, 1]);
  assert.equal(safeCount(12, 48, 8), 3, "never fewer than one tile per three players");
  assert.deepEqual([0, 2, 4].map(symbolsAt), [4, 5, 6]);
  assert.deepEqual([1, 4, 8].map(gridFor), [{ cols: 6, rows: 4 }, { cols: 7, rows: 5 }, { cols: 8, rows: 6 }]);
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [9, 9];
  assert.equal(game.winner(TARGET(2)), -1);
  game.scores = [10, 9];
  assert.equal(game.winner(TARGET(2)), 0);
  assert.equal(TARGET(2), 9);
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["mx", "my", "act"]);
});
