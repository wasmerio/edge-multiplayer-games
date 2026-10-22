import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, ROUND_TICKS, FLOORS, LAND_PAUSE, RESET_PAUSE } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { arenaOf, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Object.freeze(Array(n).fill(0));
const press = Object.freeze([Object.freeze({ drop: 1 })]);
function live(n = 1) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  for (let t = 0; t < READY_TICKS; t++) game.step(neutral(n));
  return game;
}
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks retained from the scaffold.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = live(n);
    for (let t = 0; t < ROUND_TICKS; t++) {
      const intents = game.p.map((p, i) => Object.freeze({ drop: !p.held && !p.cd && Math.abs(p.x - p.base - i * 4) < 6 ? 1 : 0 }));
      const snap = game.step(Object.freeze(intents));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n, bytes.byteLength + " bytes");
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3);
});
test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});
test("one player, and a seat that has sent no input, are both fine", () => {
  const game = live();
  for (let i = 0; i < 10; i++) game.step(Object.freeze([0]));
  assert.equal(game.tick, READY_TICKS + 10);
});

test("countdown tracks held input without dropping; ticks and two beeps advance", () => {
  const game = build(1, {}, seededRng(1));
  game.startRound();
  const x = game.p[0].x;
  const beeps = [];
  let snap;
  for (let t = 0; t < READY_TICKS; t++) {
    snap = game.step(press);
    if (snap.beep) beeps.push(snap.k);
    assert.equal(snap.x[0], x);
  }
  assert.deepEqual(beeps, [1, 31]);
  assert.equal(snap.go, true);
  assert.deepEqual(game.step(press).missed, []);
  assert.equal(game.p[0].level, 0);
});
test("offset landing trims exactly to the overlap, with one point", () => {
  const game = live();
  Object.assign(game.p[0], { base: 200, width: 160, x: 230 });
  const snap = game.step(press);
  assert.equal(snap.base[0], 230);
  assert.equal(snap.width[0], 130);
  assert.equal(snap.bx0[0], 230);
  assert.equal(snap.bw0[0], 130);
  assert.deepEqual(snap.landed, [0]);
  assert.deepEqual(snap.perfect, []);
  assert.equal(game.scores[0], 1);
});
test("a flush landing at the tolerance boundary preserves width and earns two", () => {
  const game = live();
  Object.assign(game.p[0], { base: 200, width: 160, x: 206 });
  const snap = game.step(press);
  assert.equal(snap.x[0], 200);
  assert.equal(snap.width[0], 160);
  assert.deepEqual(snap.perfect, [0]);
  assert.equal(game.scores[0], 2);
});
test("too little support costs two, then repairs exactly after thirty pause ticks", () => {
  const game = live();
  game.scores[0] = 5;
  Object.assign(game.p[0], { base: 200, width: 100, x: 289 });
  assert.deepEqual(game.step(press).missed, [0]);
  assert.equal(game.scores[0], 3);
  for (let t = 0; t < RESET_PAUSE - 1; t++) game.step(press);
  assert.equal(game.p[0].width, 100);
  game.step(press);
  assert.equal(game.p[0].width, arenaOf(1).w * 0.32);
  assert.equal(game.p[0].level, 0);
  assert.deepEqual(game.step(press).missed, [], "held drop is not queued by repair");
});
test("twelve units of support is valid and missing cannot create negative scores", () => {
  const game = live();
  Object.assign(game.p[0], { base: 200, width: 100, x: 288 });
  assert.deepEqual(game.step(press).landed, [0]);
  const other = live();
  Object.assign(other.p[0], { base: 200, width: 100, x: 0 });
  other.step(press);
  assert.equal(other.scores[0], 0);
});
test("six flush floors commission a tower for sixteen points then reopen a wide site", () => {
  const game = live();
  let snap;
  for (let floor = 0; floor < FLOORS; floor++) {
    game.p[0].x = game.p[0].base;
    snap = game.step(press);
    if (floor < FLOORS - 1) for (let t = 0; t < LAND_PAUSE; t++) game.step(neutral(1));
  }
  assert.equal(game.scores[0], 16);
  assert.equal(snap.level[0], 6);
  assert.deepEqual(snap.built, [0]);
  for (let t = 0; t < RESET_PAUSE; t++) game.step(neutral(1));
  assert.equal(game.p[0].level, 0);
  assert.ok(game.p[0].bw.every((width) => width === 0));
});
test("a press during cooldown is consumed, not queued", () => {
  const game = live();
  game.p[0].x = game.p[0].base;
  game.step(press);
  game.step(neutral(1));
  for (let t = 1; t < LAND_PAUSE; t++) game.step(press);
  assert.deepEqual(game.step(press).landed, []);
  assert.equal(game.scores[0], 2);
});
test("the last active tick scores, ends at 960, and cannot score twice", () => {
  const game = live();
  for (let t = 0; t < ROUND_TICKS - 1; t++) game.step(neutral(1));
  game.p[0].x = game.p[0].base;
  const snap = game.step(press);
  assert.equal(snap.k, READY_TICKS + ROUND_TICKS);
  assert.equal(snap.finished, true);
  assert.equal(snap.over, true);
  assert.equal(game.scores[0], 2);
  const after = game.step(neutral(1));
  assert.equal(after.k, 961);
  assert.equal(after.finished, false);
  assert.deepEqual(after.landed, []);
  assert.equal(game.scores[0], 2);
});
test("a disconnected seat stays in arrays but out of later rounds and winner checks", () => {
  const game = live(2);
  game.disconnect(0);
  game.scores = [100, 60];
  const x = game.p[0].x;
  const snap = game.step(press);
  assert.equal(snap.x.length, 2);
  assert.equal(snap.x[0], x);
  assert.equal(game.winner(60), 1);
  game.startRound();
  assert.equal(game.step(neutral(2)).active[0], false);
  game.disconnect(1);
  assert.equal(game.step(neutral(2)).over, true);
  assert.equal(game.winner(1), -1);
});
test("a winner needs the target and a unique lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [60, 60];
  assert.equal(game.winner(60), -1);
  game.scores = [61, 60];
  assert.equal(game.winner(60), 0);
  assert.equal(game.winner(62), -1);
});
test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["drop"]);
});
