import { test } from "node:test";
import assert from "node:assert/strict";
import { seededRng } from "../rng.js";
import { fixedTick } from "../loop.js";
import { validateSimulation, simulationUsesInjectedRng } from "../sim.js";
import { record, replay, parseFixture } from "../replay.js";
import { MAX_CATCHUP_TICKS, MAX_TICK_HZ } from "../params.js";

class Counter {
  constructor(n, opts, rng) {
    this.n = n; this.rng = rng;
    this.round = 0; this.tick = 0; this.roundOver = true;
    this.scores = new Array(n).fill(0);
  }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; this.spawn = this.rng.int(0, 9); }
  step(inputs) { this.tick += 1; for (let i = 0; i < this.n; i++) this.scores[i] += inputs[i]; if (this.tick >= 3) this.roundOver = true; return { k: this.tick }; }
  winner(target) { const best = Math.max(...this.scores); return best >= target ? this.scores.indexOf(best) : -1; }
}
const build = (n, opts, rng) => new Counter(n, opts, rng);

test("rng is reproducible from a seed", () => {
  const a = seededRng(1234), b = seededRng(1234);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("rng is resumable from saved state", () => {
  const r = seededRng(9);
  r.next();
  const saved = r.state();
  const expected = [r.next(), r.next()];
  r.restore(saved);
  assert.deepEqual([r.next(), r.next()], expected);
});

test("rng rejects a non-finite seed", () => {
  assert.throws(() => seededRng(undefined), /finite number/);
  assert.throws(() => seededRng(Number.NaN), /finite number/);
  assert.throws(() => seededRng(Infinity), /finite number/);
});

test("rng pick rejects an empty array", () => {
  assert.throws(() => seededRng(1).pick([]), /non-empty array/);
});

test("rng int stays inside its bounds", () => {
  const r = seededRng(3);
  for (let i = 0; i < 500; i++) {
    const v = r.int(2, 5);
    assert.ok(v >= 2 && v <= 5, `got ${v}`);
  }
});

test("loop caps catch-up work after a long pause", () => {
  let ticks = 0;
  const clock = { v: 0 };
  const loop = fixedTick(30, () => { ticks += 1; }, {
    now: () => clock.v, setInterval: () => 0, clearInterval: () => {},
  });
  clock.v = 60_000;
  loop.pump();
  assert.equal(ticks, MAX_CATCHUP_TICKS);
  assert.ok(loop.stats().dropped > 0);
});

test("loop runs one tick per elapsed step", () => {
  let ticks = 0;
  const clock = { v: 0 };
  const loop = fixedTick(10, () => { ticks += 1; }, {
    now: () => clock.v, setInterval: () => 0, clearInterval: () => {},
  });
  clock.v = 300;
  loop.pump();
  assert.equal(ticks, 3);
});

test("loop rejects a tick rate above the maximum", () => {
  assert.throws(() => fixedTick(MAX_TICK_HZ + 1, () => {}), /MAX_TICK_HZ/);
});

test("loop rejects a non-positive rate and a missing callback", () => {
  assert.throws(() => fixedTick(0, () => {}), /positive/);
  assert.throws(() => fixedTick(30, null), /function/);
});

test("simulation validation accepts the reference shape", () => {
  assert.equal(validateSimulation(Counter), true);
  assert.equal(simulationUsesInjectedRng(Counter), true);
});

test("simulation validation names every missing part", () => {
  class Broken { constructor(n) { this.n = n; } step() {} }
  assert.throws(() => validateSimulation(Broken), (err) => {
    assert.match(err.message, /playerCount, opts, rng/);
    assert.match(err.message, /startRound/);
    assert.match(err.message, /winner/);
    return true;
  });
});

test("simulation validation rejects a missing field", () => {
  class NoScores {
    constructor(n, opts, rng) { this.n = n; this.rng = rng; this.round = 0; this.tick = 0; this.roundOver = true; }
    startRound() {} step() {} winner() { return -1; }
  }
  assert.throws(() => validateSimulation(NoScores), /missing field scores/);
});

test("simulation validation rejects a non-class", () => {
  assert.throws(() => validateSimulation({}), /expected a simulation class/);
});

const fixtureOf = (seed, rounds) => {
  const sim = build(2, {}, seededRng(seed));
  const rec = record({ seed, tickHz: 30, players: 2 });
  for (let r = 0; r < rounds; r++) {
    rec.round(); sim.startRound();
    for (const inputs of [[1, 0], [0, 1], [1, 1]]) { rec.tick(inputs); sim.step(inputs); }
  }
  return rec.finish(sim);
};

test("replay reaches the recorded final state", () => {
  const fixture = fixtureOf(5, 3);
  const reached = replay(fixture, build);
  assert.deepEqual(reached, { round: 3, tick: 3, roundOver: true, scores: [6, 6] });
});

test("replay is stable across runs", () => {
  const fixture = fixtureOf(11, 2);
  assert.deepEqual(replay(fixture, build), replay(fixture, build));
});

test("replay detects a simulation that writes to its inputs", () => {
  class Mutator extends Counter { step(inputs) { inputs[0] = 9; return super.step(inputs); } }
  assert.throws(() => replay(fixtureOf(5, 1), (n, o, r) => new Mutator(n, o, r)), TypeError);
});

test("replay detects divergence from the recorded state", () => {
  class Drifted extends Counter { step(inputs) { const s = super.step(inputs); this.scores[0] += 1; return s; } }
  assert.throws(() => replay(fixtureOf(5, 1), (n, o, r) => new Drifted(n, o, r)), /diverged/);
});

test("fixture parsing rejects a header and event count mismatch", () => {
  const fixture = fixtureOf(5, 1);
  const lines = fixture.trimEnd().split("\n");
  assert.throws(() => parseFixture([lines[0], ...lines.slice(1, -1)].join("\n")), /header declares/);
});

test("replay rejects an input row of the wrong width", () => {
  const lines = fixtureOf(5, 1).trimEnd().split("\n");
  const header = JSON.parse(lines[0]);
  const bad = [JSON.stringify(header), ...lines.slice(1, -1), JSON.stringify({ e: "t", i: [1] })].join("\n");
  assert.throws(() => replay(bad, build), /inputs for 2 players/);
});

test("replay rejects an unknown event kind", () => {
  const bad = [JSON.stringify({ seed: 1, tickHz: 30, players: 2, events: 1 }), JSON.stringify({ e: "x" })].join("\n");
  assert.throws(() => replay(bad, build), /unknown kind/);
});

test("fixture parsing rejects empty input", () => {
  assert.throws(() => parseFixture(""), /empty fixture/);
});

test("the headless engine modules touch no browser global", async () => {
  const fs = await import("node:fs");
  const headless = ["params.js", "rng.js", "loop.js", "sim.js", "replay.js"];
  const banned = /\b(document|window|navigator|localStorage|WebSocket|RTCPeerConnection|fetch)\b/;
  for (const name of headless) {
    const source = fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const offending = source.split("\n").filter((line) => banned.test(line) && !line.trimStart().startsWith("//"));
    assert.deepEqual(offending, [], `${name} reaches for a browser global`);
  }
});

test("params is the only module stating a tunable", async () => {
  const fs = await import("node:fs");
  const sources = ["rng.js", "loop.js", "sim.js", "replay.js"];
  for (const name of sources) {
    const source = fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    // A tunable is a named module-scope constant holding a decimal literal.
    // A hexadecimal literal is a type width, which belongs with its algorithm.
    const lines = source.split("\n").filter((line) => /^const [A-Z][A-Z0-9_]* *= *[0-9]/.test(line) && !/0x/.test(line));
    assert.deepEqual(lines, [], `${name} states a tunable that belongs in params.js`);
  }
});
