import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, INTENT, MAP, SNAPSHOT, TARGET, TICK_HZ, mapSize } from "../public/game.js";
import { scenarios } from "./scenarios.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { record, replay } from "../../engine/replay.js";

const schema = defineSnapshot(SNAPSHOT);
const build = (n, opts, rng) => new Game(n, opts.arena ? opts : { arena: mapSize(n) }, rng);
// Seat i drills and banks on its own cadence, so every event kind occurs.
const cadence = (k, n) => Array.from({ length: n }, (_, i) => ({ act: (k + i * 9) % (70 + i * 20) < 40 + i * 10 ? 1 : -1 }));

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: mapSize(2) }), true);
  assert.doesNotMatch(fs.readFileSync(new URL("../public/game.js", import.meta.url), "utf8"), /Math\.random/);
});

test("the game interface holds through a round", () => {
  assert.ok(TICK_HZ > 0 && TICK_HZ <= 60);
  assert.ok(MAP && typeof mapSize === "function" && TARGET === 60);
  const game = build(2, {}, seededRng(1));
  assert.ok(game.round === 0 && Array.isArray(game.scores));
  game.startRound();
  assert.ok(game.round === 1 && !game.roundOver);
  for (let tick = 0; tick < 120; tick++) {
    const snapshot = game.step([tick % 3 - 1, 0]);
    assert.equal(typeof snapshot.over, "boolean");
  }
  assert.equal(typeof game.winner(10), "number");
  game.startRound();
  assert.equal(game.round, 2);
});

assert.ok(scenarios.length >= 2 && new Set(scenarios.map((s) => s.name)).size === scenarios.length);
for (const scenario of scenarios) {
  test(scenario.name, async () => {
    let assertions = 0;
    await scenario.run(Game, (condition, message) => { assertions += 1; assert.ok(condition, message || scenario.name); });
    assert.ok(assertions > 0, "the scenario asserts something");
  });
}

test("intent objects and bare numbers drive the rig alike", () => {
  const a = build(2, {}, seededRng(1));
  const b = build(2, {}, seededRng(1));
  a.startRound(); b.startRound();
  for (let k = 0; k < 200; k++) {
    const act = k % 60 < 30 ? 1 : -1;
    assert.deepEqual(a.step([{ act }, { act: 0 }]), b.step([act, 0]));
  }
});

test("a snapshot fits well inside its budget at the player cap", () => {
  const game = build(8, {}, seededRng(4));
  game.startRound();
  let largest = 0;
  for (let k = 0; k < 900; k++) largest = Math.max(largest, schema.encode(game.step(cadence(k, 8)), 8).byteLength);
  assert.ok(largest <= schema.budgetBytes * 8, `${largest} bytes`);
  assert.ok(largest <= 16 * 8, `${largest} bytes is no longer a small snapshot`);
});

test("a snapshot round-trips through the codec exactly", () => {
  const game = build(4, {}, seededRng(2));
  game.startRound();
  for (let k = 0; k < 900; k++) {
    const snap = game.step(cadence(k, 4));
    assert.deepEqual(schema.decode(schema.encode(snap, 4), 4), snap);
  }
});

test("the committed fixture replays to its recorded state", () => {
  const fixture = fs.readFileSync(new URL("./replay.ndjson", import.meta.url), "utf8");
  assert.ok(fixture.length > 0);
  const reached = replay(fixture, build);
  assert.ok(reached.round >= 3, `played ${reached.round} rounds`);
  assert.ok(reached.scores.some((score) => score > 0), "somebody banked");
});

test("two runs from one seed reach the same state", () => {
  const play = () => {
    const game = build(4, {}, seededRng(77));
    const rec = record({ seed: 77, tickHz: TICK_HZ, players: 4 });
    for (let round = 0; round < 2; round++) {
      rec.round();
      game.startRound();
      for (let k = 0; k < 300; k++) {
        const intents = cadence(k, 4);
        rec.tick(intents);
        game.step(intents);
      }
    }
    return rec.finish(game);
  };
  assert.equal(play(), play());
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["act"]);
});
