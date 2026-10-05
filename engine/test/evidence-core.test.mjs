// Phase 1 evidence: rows of the engine-core contract that had no test of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seededRng } from "../rng.js";
import { validateSimulation, simulationUsesInjectedRng } from "../sim.js";
import { replay, parseFixture } from "../replay.js";
import { arenaFor } from "../render2d.js";
import { Game } from "../../achtung/public/game.js";

const fixture = fs.readFileSync(new URL("../../achtung/test/replay.ndjson", import.meta.url), "utf8");
const achtung = (n, opts, rng) => new Game(n, { arena: arenaFor(n) }, rng);

const shape = (omit) => {
  class Sim {
    constructor(n, opts, rng) {
      this.rng = rng;
      const fields = { round: 0, tick: 0, roundOver: true, scores: new Array(n).fill(0) };
      for (const [name, value] of Object.entries(fields)) if (name !== omit) this[name] = value;
    }
  }
  for (const name of ["startRound", "step", "winner"]) if (name !== omit) Sim.prototype[name] = () => -1;
  return Sim;
};

test("the complete shape is accepted, so each rejection below is caused by its one omission", () => {
  assert.equal(validateSimulation(shape(null)), true);
});

for (const method of ["startRound", "step", "winner"]) {
  test(`a simulation without ${method}() is rejected naming it`, () => {
    assert.throws(() => validateSimulation(shape(method)), new RegExp(`missing method ${method}\\(\\)`));
  });
}

for (const field of ["round", "tick", "roundOver", "scores"]) {
  test(`a simulation without the field ${field} is rejected naming it`, () => {
    assert.throws(() => validateSimulation(shape(field)), new RegExp(`missing field ${field}\\b`));
  });
}

test("a constructor that drops its generator argument is rejected", () => {
  class NoRng extends shape(null) { constructor(n, opts) { super(n, opts, null); } }
  assert.throws(() => validateSimulation(NoRng), /constructor must accept \(playerCount, opts, rng\)/);
});

test("a simulation that takes the generator but never draws from it is detected", () => {
  class Ignores extends shape(null) {
    constructor(n, opts, rng) { super(n, opts, rng); }
    startRound() { this.spawn = 4; }
  }
  class Draws extends shape(null) {
    constructor(n, opts, rng) { super(n, opts, rng); }
    startRound() { this.spawn = this.rng.int(0, 9); }
  }
  assert.equal(simulationUsesInjectedRng(Ignores), false);
  assert.equal(simulationUsesInjectedRng(Draws), true);
});

test("a missing seed throws and the global random source is never consulted", () => {
  const original = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; return original(); };
  try {
    for (const seed of [undefined, null, "7", Number.NaN, -Infinity]) {
      assert.throws(() => seededRng(seed), /seed must be a finite number/);
    }
    const rng = seededRng(5);
    rng.next(); rng.range(0, 1); rng.int(0, 9); rng.pick([1, 2, 3]);
  } finally {
    Math.random = original;
  }
  assert.equal(calls, 0);
});

test("a generator resumed mid-stream matches an uninterrupted one", () => {
  const straight = seededRng(42);
  const all = Array.from({ length: 50 }, () => straight.next());
  const first = seededRng(42);
  for (let i = 0; i < 20; i++) first.next();
  const resumed = seededRng(1);
  resumed.restore(first.state());
  assert.deepEqual(Array.from({ length: 30 }, () => resumed.next()), all.slice(20));
});

test("replay itself refuses a fixture whose header and event count disagree, naming both", () => {
  const lines = fixture.trimEnd().split("\n");
  const short = lines.slice(0, -1).join("\n");
  assert.throws(() => replay(short, achtung), /header declares 1203 events, found 1202/);
});

test("the reference fixture is the four-player, three-round match and replays to its header", () => {
  const { header } = parseFixture(fixture);
  assert.equal(header.players, 4);
  const reached = replay(fixture, achtung);
  assert.deepEqual(reached.scores, header.final.scores);
  assert.equal(reached.round, header.final.round);
  assert.ok(reached.round >= 3);
});

test("replaying the reference fixture reads no clock, no global randomness and writes no file", () => {
  const saved = { now: Date.now, perf: performance.now, random: Math.random };
  const writes = ["writeFileSync", "appendFileSync", "writeFile", "appendFile", "mkdirSync", "rmSync"];
  const savedFs = Object.fromEntries(writes.map((name) => [name, fs[name]]));
  const touched = [];
  Date.now = () => { touched.push("Date.now"); return 0; };
  performance.now = () => { touched.push("performance.now"); return 0; };
  Math.random = () => { touched.push("Math.random"); return 0; };
  for (const name of writes) fs[name] = () => { touched.push(`fs.${name}`); };
  let reached;
  try {
    reached = replay(fixture, achtung);
  } finally {
    Date.now = saved.now; performance.now = saved.perf; Math.random = saved.random;
    Object.assign(fs, savedFs);
  }
  assert.deepEqual(touched, []);
  assert.deepEqual(reached, parseFixture(fixture).header.final);
  // The headless core cannot write a file: none of it imports a filesystem or network module.
  for (const name of ["params.js", "rng.js", "loop.js", "sim.js", "replay.js"]) {
    const source = fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(imports.filter((from) => !from.startsWith("./")), [], `${name} imports beyond the engine`);
  }
});

test("the engine holds one accumulator and the host loop is built on it", () => {
  const dir = new URL("../", import.meta.url);
  const sources = fs.readdirSync(dir).filter((name) => name.endsWith(".js"))
    .map((name) => [name, fs.readFileSync(new URL(name, dir), "utf8")]);
  const accumulating = sources.filter(([, source]) => /\bacc\s*[-+]=|accumulator\s*[-+]=/.test(source)).map(([name]) => name);
  assert.deepEqual(accumulating, ["loop.js"]);
  const host = sources.find(([name]) => name === "host.js")[1];
  assert.match(host, /import \{ fixedTick \} from "\.\/loop\.js"/);
  assert.doesNotMatch(host.replace(/\/\/.*$/gm, ""), /setInterval|setTimeout|requestAnimationFrame/);
});
