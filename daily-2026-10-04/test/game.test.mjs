import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, ARENA, TARGET, TICK_HZ } from "../public/game.js";
import { scenarios } from "./scenarios.js";
import { validateSimulation, simulationUsesInjectedRng } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { record, replay } from "../../engine/replay.js";
import { MAX_TICK_HZ } from "../../engine/params.js";

const schema = defineSnapshot(SNAPSHOT);
const build = (n, opts, rng) => new Game(n, opts.arena ? opts : { arena: ARENA }, rng);
const steer = (game, slack) => game.boats.map((b) => {
  const [x, y] = game.gates[b.checkpoint % 6];
  const d = Math.atan2(y - b.y, x - b.x) - b.a;
  const error = Math.atan2(Math.sin(d), Math.cos(d));
  return { turn: Math.abs(error) < slack ? 0 : Math.sign(error) };
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
  const a = build(1, {}, seededRng(1));
  const b = build(1, {}, seededRng(1));
  a.startRound(); b.startRound();
  for (let i = 0; i < 100; i++) { a.step([{ turn: 1 }]); b.step([1]); }
  assert.deepEqual(a.boats, b.boats);
  assert.notEqual(a.boats[0].a, 0);
});

test("the frame counter advances through the countdown while the race tick waits", () => {
  const game = build(2, {}, seededRng(1));
  game.startRound();
  const first = game.step([]);
  const second = game.step([]);
  assert.equal(first.k, 0);
  assert.equal(second.k, 0);
  assert.equal(second.n, first.n + 1);
  assert.equal(schema.tickField, "n");
});

test("a snapshot fits well inside its budget at the player cap", () => {
  const game = build(8, {}, seededRng(4));
  game.startRound();
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const snap = game.step(steer(game, 0.05));
    worst = Math.max(worst, schema.encode(snap, 8).byteLength);
  }
  assert.ok(worst <= schema.budgetBytes * 8, `${worst} bytes`);
  assert.ok(worst <= 25 * 8, `${worst} bytes is above 25 per player`);
});

test("a snapshot round-trips through the codec", () => {
  const game = build(4, {}, seededRng(2));
  game.startRound();
  let snap;
  for (let i = 0; i < 300; i++) snap = game.step(steer(game, 0.2));
  const back = schema.decode(schema.encode(snap, 4), 4);
  for (const name of ["n", "k", "f", "left", "over", "cp", "fin", "stun", "on", "scores", "gate", "hit", "done", "award"]) {
    assert.deepEqual(back[name], snap[name], name);
  }
  back.x.forEach((value, i) => assert.ok(Math.abs(value - snap.x[i]) <= 1 / 20000));
  back.y.forEach((value, i) => assert.ok(Math.abs(value - snap.y[i]) <= 1 / 20000));
  back.a.forEach((value, i) => assert.ok(Math.abs(value - snap.a[i]) <= 1 / 10000 + 1e-9));
});

test("every heading the rules can produce fits the wire range", () => {
  const game = build(1, {}, seededRng(2));
  game.startRound();
  game.freeze = 0;
  const b = game.boats[0];
  // Both shores in one tick: the widest swing the rules allow.
  for (const [x, y, a] of [[0.974, 0.964, 0.4], [0.026, 0.036, 3.6], [0.974, 0.036, 5.9], [0.026, 0.964, 2.2]]) {
    Object.assign(b, { x, y, a, speed: 0.0036 });
    schema.encode(game.step([{ turn: 1 }]), 1);
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
