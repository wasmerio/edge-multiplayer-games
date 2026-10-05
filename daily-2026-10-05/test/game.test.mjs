import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, ARENA, TARGET, TICK_HZ, PULSE_TICKS, PULSES } from "../public/game.js";
import { scenarios } from "./scenarios.js";
import { validateSimulation, simulationUsesInjectedRng } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { record, replay } from "../../engine/replay.js";
import { MAX_TICK_HZ } from "../../engine/params.js";

const schema = defineSnapshot(SNAPSHOT);
const build = (n, opts, rng) => new Game(n, opts.arena ? opts : { arena: ARENA }, rng);
const ROUND_STEPS = TICK_HZ + PULSE_TICKS * PULSES;
// Chase the gold window; a wider dead band makes a sloppier pilot.
const chase = (game, band) => game.players.map((p, i) => {
  const error = ((game.aim - p.angle + 540) % 360) - 180;
  return { turn: Math.abs(error) < band * (i + 1) ? 0 : Math.sign(error) };
});

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: ARENA }), true);
  assert.ok(TICK_HZ > 0 && TICK_HZ <= MAX_TICK_HZ);
  assert.ok(TARGET > 0);
});

test("the interface survives two rounds", () => {
  const game = build(2, {}, seededRng(1));
  assert.equal(game.round, 0);
  assert.ok(Array.isArray(game.scores));
  game.startRound();
  assert.equal(game.round, 1);
  assert.equal(game.roundOver, false);
  for (let tick = 0; tick < 120; tick++) {
    const snapshot = game.step([{ turn: (tick % 3) - 1 }, { turn: 0 }]);
    assert.equal(typeof snapshot.over, "boolean");
    schema.encode(snapshot, 2);
  }
  assert.equal(typeof game.winner(TARGET), "number");
  game.startRound();
  assert.equal(game.round, 2);
});

test("the scenario list is well formed", () => {
  assert.ok(scenarios.length >= 2 && scenarios.length <= 8);
  assert.equal(new Set(scenarios.map((s) => s.name)).size, scenarios.length);
});

for (const scenario of scenarios) {
  test(`scenario: ${scenario.name}`, async () => {
    let assertions = 0;
    await scenario.run(Game, (condition, message) => {
      assertions += 1;
      assert.ok(condition, message || scenario.name);
    });
    assert.ok(assertions > 0, "the scenario asserts something");
  });
}

test("intent objects and bare numbers steer alike", () => {
  const a = build(2, {}, seededRng(1));
  const b = build(2, {}, seededRng(1));
  a.startRound(); b.startRound();
  for (let i = 0; i < 100; i++) { a.step([{ turn: 1 }, { turn: -1 }]); b.step([1, -1]); }
  assert.deepEqual(a.players, b.players);
  assert.notEqual(a.players[0].angle, 270);
});

test("the frame counter advances through the countdown while the round tick waits", () => {
  const game = build(2, {}, seededRng(1));
  game.startRound();
  const first = game.step([]);
  const second = game.step([]);
  assert.equal(first.k, 0);
  assert.equal(second.k, 0);
  assert.equal(second.n, first.n + 1);
  assert.equal(schema.tickField, "n");
});

test("a snapshot fits well inside its budget at the player cap for a whole round", () => {
  const game = build(8, {}, seededRng(4));
  game.startRound();
  let worst = 0;
  for (let i = 0; i < ROUND_STEPS; i++) {
    const snap = game.step(chase(game, 2));
    worst = Math.max(worst, schema.encode(snap, 8).byteLength);
  }
  assert.equal(game.roundOver, true);
  assert.ok(worst <= schema.budgetBytes * 8, `${worst} bytes`);
  assert.ok(worst <= 12 * 8, `${worst} bytes is above 12 per player`);
});

test("a snapshot round-trips through the codec exactly", () => {
  const game = build(4, {}, seededRng(2));
  game.startRound();
  for (let i = 0; i < ROUND_STEPS; i++) {
    const snap = game.step(chase(game, 3));
    assert.deepEqual(schema.decode(schema.encode(snap, 4), 4), snap);
  }
});

test("the committed fixture replays to its recorded state", () => {
  const fixture = fs.readFileSync(new URL("./replay.ndjson", import.meta.url), "utf8");
  assert.ok(fixture.length > 0);
  const reached = replay(fixture, build);
  assert.ok(reached.round >= 3, `played ${reached.round} rounds`);
  assert.ok(reached.scores.some((score) => score > 0));
});

test("two runs from one seed reach the same state", () => {
  const play = () => {
    const game = build(4, {}, seededRng(77));
    const rec = record({ seed: 77, tickHz: TICK_HZ, players: 4 });
    for (let round = 0; round < 2; round++) {
      rec.round();
      game.startRound();
      for (let i = 0; i < 300; i++) {
        const intents = [{ turn: 1 }, { turn: 0 }, { turn: -1 }, { turn: i % 40 < 6 ? 1 : 0 }];
        rec.tick(intents);
        game.step(intents);
      }
    }
    return rec.finish(game);
  };
  assert.equal(play(), play());
});

test("the rules draw nothing from a generator", () => {
  assert.equal(simulationUsesInjectedRng(Game, 2, { arena: ARENA }), false);
  assert.ok(!/Math\.random/.test(fs.readFileSync(new URL("../public/game.js", import.meta.url), "utf8")));
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["turn"]);
});
