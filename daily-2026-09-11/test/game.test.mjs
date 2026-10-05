import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, INTENT, MAP, SNAPSHOT, TARGET, TICK_HZ, mapSize } from "../public/game.js";
import { scenarios } from "./scenarios.js";
import { validateSimulation, simulationUsesInjectedRng } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { record, replay } from "../../engine/replay.js";

const schema = defineSnapshot(SNAPSHOT);
const build = (n, opts, rng) => new Game(n, opts.arena ? opts : { arena: mapSize(n) }, rng);
// The scenarios predate the injected generator and construct with a count only.
class Seeded extends Game {
  constructor(playerCount, opts, rng = seededRng(11)) { super(playerCount, opts, rng); }
}
const sweep = (k, n) => Array.from({ length: n }, (_, i) => ({ move: Math.floor((k + i * 13) / (20 + i * 5)) % 3 - 1 }));

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: mapSize(2) }), true);
  assert.doesNotMatch(fs.readFileSync(new URL("../public/game.js", import.meta.url), "utf8"), /Math\.random/);
});

test("delivery lanes come from the injected generator", () => {
  const lanes = (seed) => {
    const game = build(2, {}, seededRng(seed));
    game.startRound();
    const seen = [];
    for (let k = 0; k < 400; k++) { const snap = game.step([0, 0]); if (snap.by.includes(0.012)) seen.push(snap.bl[snap.by.indexOf(0.012)]); }
    return seen.join("");
  };
  assert.equal(lanes(5), lanes(5));
  assert.notEqual(lanes(5), lanes(6));
  assert.equal(simulationUsesInjectedRng(Game, 2, { arena: mapSize(2) }), false, "a round start draws nothing");
});

test("the game interface holds through a round", () => {
  assert.ok(TICK_HZ > 0 && TICK_HZ <= 60);
  assert.ok(MAP && typeof mapSize === "function" && TARGET === 20);
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
    await scenario.run(Seeded, (condition, message) => { assertions += 1; assert.ok(condition, message || scenario.name); });
    assert.ok(assertions > 0, "the scenario asserts something");
  });
}

test("the snapshot tick advances every step, countdown included", () => {
  const game = build(2, {}, seededRng(3));
  game.startRound();
  let last = 0;
  for (let k = 0; k < 945; k++) {
    const snap = game.step([0, 0]);
    assert.equal(snap.k, last + 1);
    last = snap.k;
  }
  assert.equal(game.roundOver, true);
  assert.equal(game.step([1, 1]).k, last, "a finished round stops the tick");
});

test("intent objects and bare numbers drive the cart alike", () => {
  const a = build(2, {}, seededRng(1));
  const b = build(2, {}, seededRng(1));
  a.startRound(); b.startRound();
  for (let k = 0; k < 200; k++) {
    const move = k % 60 < 30 ? 1 : -1;
    assert.deepEqual(a.step([{ move }, { move: 0 }]), b.step([move, 0]));
  }
});

test("a snapshot fits well inside its budget at the player cap", () => {
  const game = build(8, {}, seededRng(4));
  game.startRound();
  let largest = 0;
  for (let k = 0; k < 945; k++) largest = Math.max(largest, schema.encode(game.step(sweep(k, 8)), 8).byteLength);
  assert.ok(largest <= schema.budgetBytes * 8, `${largest} bytes`);
  assert.ok(largest <= 16 * 8, `${largest} bytes is no longer a small snapshot`);
});

test("a snapshot round-trips through the codec exactly", () => {
  const game = build(4, {}, seededRng(2));
  game.startRound();
  for (let k = 0; k < 945; k++) {
    const snap = game.step(sweep(k, 4));
    assert.deepEqual(schema.decode(schema.encode(snap, 4), 4), snap);
  }
});

test("the committed fixture replays to its recorded state", () => {
  const fixture = fs.readFileSync(new URL("./replay.ndjson", import.meta.url), "utf8");
  assert.ok(fixture.length > 0);
  const reached = replay(fixture, build);
  assert.ok(reached.round >= 3, `played ${reached.round} rounds`);
  assert.ok(reached.scores.some((score) => score > 0), "somebody caught a parcel");
});

test("two runs from one seed reach the same state", () => {
  const play = () => {
    const game = build(4, {}, seededRng(77));
    const rec = record({ seed: 77, tickHz: TICK_HZ, players: 4 });
    for (let round = 0; round < 2; round++) {
      rec.round();
      game.startRound();
      for (let k = 0; k < 400; k++) {
        const intents = sweep(k, 4);
        rec.tick(intents);
        game.step(intents);
      }
    }
    return rec.finish(game);
  };
  assert.equal(play(), play());
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["move"]);
});
