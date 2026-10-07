import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, READY_TICKS, BID_TICKS, REVEAL_TICKS, LOTS, PHASE, REPEAT_TICKS } from "../public/game.js";
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
function live(n) {
  const game = build(n, {}, seededRng(5));
  game.startRound();
  run(game, READY_TICKS);
  return game;
}
function submit(game, bids) {
  bids.forEach((bid, i) => { game.p[i].choice = bid; });
  return game.step(Object.freeze(bids.map(() => Object.freeze({ bid: 0, seal: 1 }))));
}

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

// Engine checks.
test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaOf(2) }), true);
});
test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = live(MAX_PLAYERS_PER_ROOM);
  submit(game, Array(MAX_PLAYERS_PER_ROOM).fill(7));
  const snap = run(game, BID_TICKS - 1);
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM);
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
  const snap = run(game, READY_TICKS + 10);
  assert.equal(game.tick, READY_TICKS + 10);
  assert.equal(game.p[0].locked, false);
  assert.ok(schema.encode(snap, 1).byteLength <= SNAPSHOT_BUDGET_BYTES);
});

// Rule scenarios.
test("countdown accepts no bids, beeps three times, and opens exactly at tick 60", () => {
  const game = build(2, {}, seededRng(5));
  game.startRound();
  const beeps = [];
  for (let i = 0; i < READY_TICKS; i++) {
    const snap = game.step(Object.freeze([Object.freeze({ bid: 1, seal: 1 }), 0]));
    if (snap.beep) beeps.push(snap.k);
  }
  assert.deepEqual(beeps, [1, 21, 41]);
  assert.equal(game.phase, PHASE.BID);
  assert.equal(game.t, BID_TICKS);
  assert.equal(game.p[0].purse, 8);
  assert.equal(game.p[0].locked, false);
  assert.deepEqual(game.step([{ seal: 1 }, 0]).sealed, [], "holding through ready cannot seal");
});
test("top ties cancel and the next highest unique bid steals the bloom; all pay", () => {
  const game = live(3);
  game.values[0] = 7;
  const snap = submit(game, [7, 7, 4]);
  assert.deepEqual(snap.purse, [1, 1, 4]);
  const reveal = run(game, BID_TICKS - 1);
  assert.equal(reveal.k, READY_TICKS + BID_TICKS);
  assert.deepEqual(reveal.cancelled, [0, 1]);
  assert.deepEqual(reveal.awarded, [2]);
  assert.deepEqual(reveal.result, [2, 2, 3]);
  assert.equal(reveal.last, 2);
  assert.deepEqual(game.scores, [0, 0, 7]);
});
test("a unique high bid wins and the losing unique bid is not refunded", () => {
  const game = live(2);
  game.values[0] = 5;
  submit(game, [3, 6]);
  const snap = run(game, BID_TICKS - 1);
  assert.deepEqual(snap.result, [1, 3]);
  assert.deepEqual(snap.purse, [5, 2]);
  assert.deepEqual(game.scores, [0, 5]);
});
test("all ties and all passes award nobody", () => {
  for (const offers of [[5, 5], [0, 0]]) {
    const game = live(2);
    submit(game, offers);
    const snap = run(game, BID_TICKS - 1);
    assert.equal(snap.last, -1);
    assert.deepEqual(game.scores, [0, 0]);
  }
});
test("unsealed choices never compete; a last-tick seal does", () => {
  const game = live(2);
  game.p[0].choice = 8;
  game.p[1].choice = 2;
  run(game, BID_TICKS - 1);
  const snap = game.step([0, { seal: 1 }]);
  assert.equal(snap.last, 1);
  assert.deepEqual(snap.purse, [8, 6]);
  assert.deepEqual(snap.sealed, [1]);
});
test("bid adjustment repeats every six ticks, reverses immediately and respects the purse", () => {
  const game = live(1);
  const held = Object.freeze([Object.freeze({ bid: 1 })]);
  assert.equal(game.step(held).choice[0], 1);
  assert.equal(run(game, REPEAT_TICKS - 1, held).choice[0], 1);
  assert.equal(game.step(held).choice[0], 2);
  assert.equal(game.step([{ bid: -1 }]).choice[0], 1);
  run(game, 55, held);
  assert.equal(game.p[0].choice, 8);
  submit(game, [8]);
  assert.equal(game.step([{ bid: -1, seal: 1 }]).choice[0], 8, "sealed means immutable");
  assert.equal(game.p[0].purse, 0);
});
test("the next lot restores allowance, but a held seal never resubmits", () => {
  const game = live(1);
  submit(game, [8]);
  run(game, BID_TICKS - 1 + REVEAL_TICKS, [{ seal: 1 }]);
  assert.equal(game.lot, 1);
  assert.equal(game.p[0].purse, 3);
  assert.equal(game.p[0].choice, 0);
  assert.deepEqual(game.step([{ seal: 1 }]).sealed, []);
  game.step([0]);
  assert.deepEqual(game.step([{ seal: 1 }]).sealed, [0]);
});
test("eight lots close exactly at tick 1260, and post-round steps cannot award twice", () => {
  const game = live(1);
  submit(game, [1]);
  const total = READY_TICKS + LOTS * (BID_TICKS + REVEAL_TICKS);
  const snap = run(game, total - game.tick);
  assert.equal(snap.k, 1260);
  assert.equal(snap.finished, true);
  assert.equal(snap.over, true);
  const scores = [...game.scores];
  const after = game.step([{ seal: 1 }]);
  assert.equal(after.k, 1261);
  assert.equal(after.finished, false);
  assert.deepEqual(after.awarded, []);
  assert.deepEqual(game.scores, scores);
});
test("disconnect withdraws unresolved bids, excludes winners and persists across rounds", () => {
  const game = live(2);
  submit(game, [6, 6]);
  game.disconnect(1);
  assert.equal(run(game, BID_TICKS - 1).last, 0);
  game.scores = [24, 99];
  assert.equal(game.winner(24), 0);
  game.startRound();
  const snap = game.step([0, { bid: 1, seal: 1 }]);
  assert.deepEqual(snap.active, [true, false]);
  assert.equal(snap.purse[1], 0);
  game.disconnect(0);
  assert.equal(game.step([0, 0]).over, true);
  assert.equal(game.winner(1), -1);
});
test("trailing bidders receive two opening coins and purse rollover caps at fifteen", () => {
  const game = build(2, {}, seededRng(5));
  game.scores = [10, 4];
  game.startRound();
  assert.deepEqual(game.p.map((p) => p.purse), [8, 10]);
  run(game, READY_TICKS + 3 * (BID_TICKS + REVEAL_TICKS));
  assert.deepEqual(game.p.map((p) => p.purse), [15, 15]);
});
test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [24, 24];
  assert.equal(game.winner(24), -1);
  game.scores = [25, 24];
  assert.equal(game.winner(24), 0);
});
test("every complete snapshot fits and round-trips at every supported player count", () => {
  for (let n = 1; n <= MAX_PLAYERS_PER_ROOM; n++) {
    const game = build(n, {}, seededRng(n));
    game.startRound();
    while (!game.roundOver) {
      const snap = game.step(Object.freeze(Array.from({ length: n }, (_, i) => Object.freeze({ bid: game.tick % 13 < 8 ? 1 : -1, seal: game.tick % (19 + i) === 0 ? 1 : 0 }))));
      const bytes = schema.encode(snap, n);
      assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * n);
      assert.deepEqual(schema.decode(bytes, n), snap);
    }
  }
});
test("the intent declares only the two auction controls", () => {
  assert.deepEqual(Object.keys(INTENT), ["bid", "seal"]);
});
