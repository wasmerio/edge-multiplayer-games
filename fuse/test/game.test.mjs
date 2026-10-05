import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Game, SNAPSHOT, INTENT, ARENA, TARGET, PHASE, R, ARM_TICKS, BLAST_TICKS, STUN_TICKS, SAFE_TICKS, DASH_CD, BOO_CD,
} from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { bot, build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Array.from({ length: n }, () => ({ mx: 0, my: 0, dash: 0 }));
const stepN = (game, n, intents) => { let snap; for (let i = 0; i < n; i++) snap = game.step(intents); return snap; };

// A live round with the bomb on seat `holder` and a known fuse.
function live(players, holder, fuse = 300, overtime = 0) {
  const game = build(players, {}, seededRng(9));
  game.startRound();
  game.step(neutral(players));
  game.holder = holder;
  game.phase = PHASE.LIVE;
  game.fuse = fuse;
  game.fuseMax = fuse;
  game.overtime = overtime;
  return game;
}

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: ARENA(2) }), true);
});

test("the bomb cannot change hands while it is arming", () => {
  const game = build(2, {}, seededRng(1));
  game.startRound();
  const holder = game.holder;
  game.p[0].x = 300; game.p[0].y = 300;
  game.p[1].x = 300 + 2 * R; game.p[1].y = 300;
  const snap = stepN(game, ARM_TICKS - 1, neutral(2));
  assert.equal(snap.ph, PHASE.ARM);
  assert.equal(snap.holder, holder);
  assert.equal(game.step(neutral(2)).ph, PHASE.LIVE);
});

test("a touch passes the bomb, stuns the receiver and shields the passer", () => {
  const game = live(3, 0);
  game.p[0].x = 300; game.p[0].y = 300;
  game.p[1].x = 300 + 2 * R + 1; game.p[1].y = 300;
  game.p[2].x = 700; game.p[2].y = 300;
  const snap = game.step(neutral(3));
  assert.equal(snap.holder, 1);
  assert.deepEqual(snap.pass, [1]);
  assert.equal(snap.stun[1], true);
  assert.equal(snap.safe[0], true);
  // No tag-back: the stunned receiver cannot return it, and the passer is shielded after that.
  game.p[0].x = game.p[1].x - 2 * R; game.p[0].y = game.p[1].y;
  game.p[0].kx = game.p[1].kx = 0;
  assert.equal(stepN(game, STUN_TICKS, neutral(3)).holder, 1);
  assert.ok(SAFE_TICKS > STUN_TICKS);
});

test("the fuse blows on its exact tick, pays the survivors and ends a duel", () => {
  const game = live(2, 1, 10, 3);
  game.p[0].x = 200; game.p[1].x = 700;
  const before = game.tick;
  let boom = -1;
  for (let i = 0; i < 40 && boom < 0; i++) {
    const snap = game.step(neutral(2));
    if (snap.d.length) { boom = snap.k; assert.deepEqual(snap.d, [1]); }
  }
  // 10 fuse ticks, then overtime counts 3, 2, 1, 0.
  assert.equal(boom, before + 10 + 4);
  assert.deepEqual(game.scores, [2, 0]);
  assert.equal(game.roundOver, false);
  stepN(game, BLAST_TICKS, neutral(2));
  assert.equal(game.roundOver, true);
});

test("with three alive a blast pays one point each and re-arms the bomb", () => {
  const game = live(3, 2, 1, 0);
  for (const [i, x] of [[0, 200], [1, 480], [2, 760]]) { game.p[i].x = x; game.p[i].y = 300; }
  stepN(game, 2, neutral(3));
  assert.deepEqual(game.scores, [1, 1, 0]);
  const snap = stepN(game, BLAST_TICKS, neutral(3));
  assert.equal(snap.ph, PHASE.ARM);
  assert.ok(snap.holder === 0 || snap.holder === 1);
  assert.equal(snap.alive[2], false);
});

test("a dash covers ground once and then cools down", () => {
  const game = live(2, 0);
  game.p[0].x = 200; game.p[0].y = 300; game.p[1].x = 800; game.p[1].y = 500;
  const go = [{ mx: 0, my: 0, dash: 0 }, { mx: 1, my: 0, dash: 1 }];
  const first = game.step(go);
  assert.deepEqual(first.dash, [1]);
  const x0 = 800;
  const after = stepN(game, 10, go);
  assert.deepEqual(after.dash, []);
  assert.ok(after.x[1] > x0 + 60 || after.x[1] === game.w - R, "dashed to " + after.x[1]);
  assert.ok(after.cd[1] > 0 && after.cd[1] <= DASH_CD);
});

test("a ghost's boo shoves the living and has a long cooldown", () => {
  const game = live(3, 0);
  game.p[2].alive = false;
  game.p[2].x = 400; game.p[2].y = 300;
  game.p[1].x = 450; game.p[1].y = 300;
  game.p[0].x = 800; game.p[0].y = 500;
  const boo = [{ mx: 0, my: 0, dash: 0 }, { mx: 0, my: 0, dash: 0 }, { mx: 0, my: 0, dash: 1 }];
  const snap = game.step(boo);
  assert.deepEqual(snap.boo, [2]);
  const pushed = stepN(game, 8, neutral(3));
  assert.ok(pushed.x[1] > 480, "shoved to " + pushed.x[1]);
  assert.ok(pushed.cd[2] > BOO_CD - 12);
});

test("a player who leaves hands the bomb on and stays out", () => {
  const game = live(3, 0);
  game.disconnect(0);
  assert.equal(game.p[0].alive, false);
  assert.ok(game.holder === 1 || game.holder === 2);
  assert.equal(game.phase, PHASE.ARM);
  game.startRound();
  assert.equal(game.p[0].alive, false);
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  assert.equal(TARGET(2), 10);
  game.scores = [10, 10];
  assert.equal(game.winner(10), -1);
  game.scores = [11, 10];
  assert.equal(game.winner(10), 0);
});

test("scripted players pass the bomb and finish rounds", () => {
  const game = build(4, {}, seededRng(77));
  let passes = 0;
  for (let round = 0; round < 3; round++) {
    game.startRound();
    for (let tick = 0; tick < 3000 && !game.roundOver; tick++) {
      passes += game.step(Array.from({ length: 4 }, (_, seat) => bot(game, seat, tick))).pass.length;
    }
    assert.equal(game.roundOver, true);
  }
  assert.ok(passes >= 6, passes + " passes");
});

test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  game.startRound();
  let snap;
  for (let i = 0; i < 100; i++) snap = game.step(neutral(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM, bytes.byteLength + " bytes");
  const back = schema.decode(bytes, MAX_PLAYERS_PER_ROOM);
  assert.equal(back.holder, snap.holder);
  assert.equal(back.fuse, snap.fuse);
  assert.deepEqual(back.alive, snap.alive);
  back.x.forEach((value, i) => assert.ok(Math.abs(value - snap.x[i]) <= 1 / 20));
});

test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3, "played " + reached.round + " rounds");
});

test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["mx", "my", "dash"]);
});
