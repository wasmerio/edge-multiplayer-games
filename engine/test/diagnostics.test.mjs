// Phase 10: the collector's series, its counters, the probe, the meter and the worker clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollector, meterTransport, sparkline, COUNTER_SCOPE, SERIES } from "../diagnostics.js";
import { createBuffer } from "../interp.js";
import { defineSnapshot } from "../schema.js";
import { hostGame } from "../host.js";
import { joinGame } from "../guest.js";
import { workerTimers } from "../clock.js";
import { fixedTick } from "../loop.js";
import { seededRng } from "../rng.js";
import { createLoopback } from "./fake-transport.mjs";
import { DIAG_SAMPLE_INTERVAL_MS, DIAG_WINDOW_SAMPLES, SNAPSHOT_BUDGET_BYTES } from "../params.js";

const schema = defineSnapshot({ fields: { k: { type: "uint", bits: 32 }, x: { type: "fixed", scale: 10, per: "player" }, d: { type: "players" } } });
const clocked = (options = {}) => {
  const clock = { v: 0 };
  const collector = createCollector({ now: () => clock.v, enabled: true, ...options });
  const advance = (ms = DIAG_SAMPLE_INTERVAL_MS) => { clock.v += ms; return collector.sample(); };
  return { clock, collector, advance };
};
// Raises every counter through the collector's own feeds.
const exercise = (collector) => {
  collector.configure({ budgetBytes: 10 });
  collector.tick(); collector.dropped(2); collector.transfer(30, 40); collector.snapshot(11, 5);
  collector.buffer({ depth: 2, starved: 3, stale: 1, duplicate: 1, dropped: 4 });
};

test("every counter is declared either cumulative or reset at the round boundary", () => {
  const { collector } = clocked();
  assert.deepEqual(Object.keys(COUNTER_SCOPE).sort(), Object.keys(collector.current()).filter((k) => k in COUNTER_SCOPE).sort());
  for (const scope of Object.values(COUNTER_SCOPE)) assert.ok(scope === "cumulative" || scope === "round");
});

for (const [name, scope] of Object.entries(COUNTER_SCOPE)) {
  test(`counter ${name} is ${scope === "round" ? "reset by a round boundary" : "cumulative across a round boundary"}`, () => {
    const { collector } = clocked();
    exercise(collector);
    const before = collector.current()[name];
    assert.ok(before > 0, `${name} was raised`);
    collector.round();
    assert.equal(collector.current()[name], scope === "round" ? 0 : before);
    collector.buffer({ depth: 2, starved: 5, stale: 2, duplicate: 1, dropped: 6 });
    if (scope === "round") assert.ok(collector.current()[name] > 0 && collector.current()[name] < before + 3, "it counts the new round only");
  });
}

test("a new interpolation buffer restarts the round-scoped counters from zero", () => {
  const { collector } = clocked();
  collector.buffer({ starved: 9 });
  collector.round();
  collector.buffer({ starved: 2 });
  assert.equal(collector.current().starved, 2);
});

test("a sample is taken only at the interval, from the injected clock", () => {
  const { collector, clock } = clocked();
  clock.v += DIAG_SAMPLE_INTERVAL_MS - 1;
  assert.equal(collector.sample(), null);
  assert.equal(collector.samples().length, 0);
  clock.v += 1;
  const row = collector.sample();
  assert.equal(row.at, DIAG_SAMPLE_INTERVAL_MS);
  assert.equal(collector.sample(), row, "no second sample inside the interval");
  assert.equal(collector.samples().length, 1);
});

test("every named series populates", () => {
  const { collector, advance } = clocked();
  collector.configure({ tickHz: 30, budgetBytes: 200 });
  for (let i = 0; i < 30; i++) { collector.tick(); collector.snapshot(64, i); }
  collector.transfer(1200, 300);
  collector.rtt(18);
  collector.buffer({ depth: 4, starved: 1, stale: 2, duplicate: 1, dropped: 2 });
  const row = advance();
  assert.deepEqual(
    Object.fromEntries(SERIES.map((name) => [name, row[name]])),
    { tickHz: 30, rtt: 18, outPerSec: 1200, inPerSec: 300, snapshotBytes: 64, bufferDepth: 4, starved: 1, staleSnapshots: 3 },
  );
  assert.equal(row.targetHz, 30, "the achieved rate sits beside the configured one");
  for (const name of SERIES) assert.equal(collector.series(name).length, 1);
  const rows = collector.overlayRows();
  assert.deepEqual(rows.map((r) => r.name), SERIES);
  assert.ok(rows.every((r) => r.spark.length === 1 && r.value !== "–"));
});

test("an unanswered round-trip probe is a gap in the series, not the last value again", () => {
  const { collector, advance } = clocked();
  collector.rtt(20);
  assert.equal(advance().rtt, 20);
  assert.equal(advance().rtt, null);
  collector.rtt(25);
  assert.equal(advance().rtt, 25);
  assert.deepEqual(collector.series("rtt"), [20, null, 25]);
  assert.equal(sparkline(collector.series("rtt")), "▁·█");
  assert.equal(collector.overlayRows().find((r) => r.name === "rtt").spark, "▁·█");
});

test("a sparkline scales to its own range and stays flat for a constant series", () => {
  assert.equal(sparkline([0, 50, 100]), "▁▅█");
  assert.equal(sparkline([7, 7, 7]), "▁▁▁");
  assert.equal(sparkline([]), "");
  assert.equal(sparkline([null]), "·");
});

test("overlay reads are passive", () => {
  const { collector, advance } = clocked();
  exercise(collector);
  advance();
  const before = JSON.stringify([collector.current(), collector.samples(), collector.worst(), collector.breaches()]);
  collector.current().ticks = 999;
  collector.samples()[0].tickHz = 999;
  collector.series("tickHz").push(1);
  collector.overlayRows();
  collector.worst().bytes = 999;
  collector.breaches().push({});
  collector.last();
  assert.equal(JSON.stringify([collector.current(), collector.samples(), collector.worst(), collector.breaches()]), before);
});

test("a snapshot over its budget is counted and named by tick and size", () => {
  const { collector } = clocked();
  collector.configure({ budgetBytes: SNAPSHOT_BUDGET_BYTES * 2 });
  collector.snapshot(SNAPSHOT_BUDGET_BYTES * 2, 7);
  assert.equal(collector.current().overBudget, 0, "exactly at the budget is inside it");
  collector.snapshot(SNAPSHOT_BUDGET_BYTES * 2 + 1, 8);
  assert.equal(collector.current().overBudget, 1);
  assert.deepEqual(collector.breaches(), [{ tick: 8, bytes: SNAPSHOT_BUDGET_BYTES * 2 + 1, budget: SNAPSHOT_BUDGET_BYTES * 2 }]);
  assert.deepEqual(collector.worst(), { bytes: SNAPSHOT_BUDGET_BYTES * 2 + 1, tick: 8 });
});

test("nothing is collected through any feed while the overlay is off", () => {
  const collector = createCollector({ now: () => 0 });
  exercise(collector);
  collector.rtt(5);
  assert.ok(Object.keys(COUNTER_SCOPE).every((name) => collector.current()[name] === 0));
  assert.equal(collector.current().rtt, null);
  assert.equal(collector.sample(), null);
  assert.deepEqual(collector.worst(), { bytes: 0, tick: null });
});

test("enabling the overlay later starts the first interval then", () => {
  const clock = { v: 0 };
  const collector = createCollector({ now: () => clock.v });
  clock.v = 60_000;
  collector.enable(true);
  for (let i = 0; i < 30; i++) collector.tick();
  clock.v += DIAG_SAMPLE_INTERVAL_MS;
  assert.equal(collector.sample().tickHz, 30);
});

test("the sample ring holds the declared window", () => {
  const { collector, advance } = clocked();
  for (let i = 0; i < DIAG_WINDOW_SAMPLES + 5; i++) advance();
  assert.equal(collector.samples().length, DIAG_WINDOW_SAMPLES);
});

test("a collector with no transport reports zeroes and does not throw", () => {
  const { collector, advance } = clocked();
  assert.equal(meterTransport(null, collector), null);
  assert.equal(meterTransport(undefined, collector), null);
  const row = advance();
  assert.deepEqual([row.tickHz, row.outPerSec, row.inPerSec, row.bytesOut, row.bytesIn, row.rtt], [0, 0, 0, 0, 0, null]);
});

test("a metered transport counts every byte out, per peer, and every byte in", () => {
  const net = createLoopback();
  const { collector } = clocked();
  const guests = [net.addGuest("g1"), net.addGuest("g2")];
  const host = meterTransport(net.hostTransport, collector);
  const received = [];
  host.onMessage((peer, data) => received.push([peer, data]));
  host.broadcast("abcd");
  host.broadcast(new ArrayBuffer(10));
  host.sendTo("g1", "xy");
  host.sendTo("nobody", "lost");
  guests[0].transport.sendToHost("hello");
  assert.equal(collector.current().bytesOut, 4 * 2 + 10 * 2 + 2);
  assert.equal(collector.current().bytesIn, 5);
  assert.deepEqual(received, [["g1", "hello"]]);
  assert.deepEqual(host.peers(), ["g1", "g2"]);
});

class Walk {
  constructor(n) { this.n = n; this.round = 0; this.tick = 0; this.roundOver = true; this.scores = new Array(n).fill(0); }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; }
  step() { this.tick += 1; return { k: this.tick, x: new Array(this.n).fill(this.tick), d: [] }; }
  winner() { return -1; }
}

function session() {
  const net = createLoopback();
  const clock = { v: 1000 };
  const now = () => clock.v;
  const frames = { host: [], guest: [] };
  const rtts = { host: [], guest: [] };
  const players = [{ pid: 0, owner: "host", name: "a" }, { pid: 1, owner: "g1", name: "b" }];
  const guestEnd = net.addGuest("g1");
  const client = joinGame({ schema, transport: guestEnd.transport, now, onFrame: (f) => frames.guest.push(f), onRtt: (ms) => rtts.guest.push(ms) }).attach();
  const host = hostGame({
    sim: new Walk(2), schema, players, transport: net.hostTransport, now,
    loopDeps: { now: () => 0, setInterval: () => 0, clearInterval: () => {} },
    onFrame: (f) => frames.host.push(f), onRtt: (ms, peer) => rtts.host.push([ms, peer]),
  });
  const loop = host.start();
  return { net, clock, host, client, loop, frames, rtts, guestEnd };
}

test("host and guest both report each frame's encoded size and tick", () => {
  const { frames } = session();
  assert.equal(frames.host.length, 1);
  assert.deepEqual(frames.host[0], { bytes: schema.byteLength(2), full: true, tick: 1 });
  assert.deepEqual(frames.guest[0], frames.host[0]);
});

test("a guest's probe is answered by the host and measured on the guest's clock", () => {
  const { client, clock, rtts, net, guestEnd } = session();
  const original = net.hostTransport.sendTo;
  net.hostTransport.sendTo = (id, data) => { clock.v += 35; original(id, data); };
  client.probe();
  assert.deepEqual(rtts.guest, [35]);
  assert.deepEqual(rtts.host, []);
  assert.ok(guestEnd);
});

test("a host's probe is answered by each guest", () => {
  const { host, clock, rtts, guestEnd } = session();
  const deliver = guestEnd.deliver;
  guestEnd.deliver = (data) => { clock.v += 12; deliver(data); };
  host.probe();
  assert.deepEqual(rtts.host, [[12, "g1"]]);
});

test("a guest that starves its buffer has the starved frames counted and still renders", () => {
  const { collector } = clocked();
  const buffer = createBuffer({ schema });
  buffer.push({ k: 1, x: [0, 0], d: [] });
  assert.deepEqual(buffer.sample().x, [0, 0]);
  buffer.sample();
  collector.buffer(buffer.stats());
  assert.equal(collector.current().starved, 2);
  assert.equal(collector.current().bufferDepth, 1);
});

// A worker whose timer the test fires by hand.
function fakeWorkerWorld({ throwOnConstruct = false } = {}) {
  const world = { workers: [], blobs: [], native: [], cleared: [] };
  world.Worker = class {
    constructor(url) {
      if (throwOnConstruct) throw new Error("refused");
      this.url = url; this.posted = []; world.workers.push(this);
    }
    postMessage(message) { this.posted.push(message); }
    fire(id) { this.onmessage({ data: id }); }
  };
  world.Blob = class { constructor(parts, options) { world.blobs.push({ parts, options }); } };
  world.URL = { createObjectURL: () => "blob:fake" };
  world.setInterval = (fn, ms) => { world.native.push({ fn, ms }); return world.native.length; };
  world.clearInterval = (handle) => world.cleared.push(handle);
  return world;
}

test("the host loop is driven by a worker's timer, which a hidden tab does not throttle", () => {
  const world = fakeWorkerWorld();
  const timers = workerTimers(world);
  const clock = { v: 0 };
  let ticks = 0;
  const loop = fixedTick(30, () => { ticks += 1; }, { now: () => clock.v, ...timers });
  const worker = world.workers[0];
  assert.equal(world.native.length, 0, "the page's own timer is not used");
  assert.deepEqual(worker.posted[0].slice(0, 2), [1, 1]);
  assert.match(world.blobs[0].parts[0], /setInterval/);
  for (let i = 0; i < 30; i++) { clock.v += 1000 / 30; worker.fire(1); }
  assert.equal(ticks, 30);
  loop.stop();
  assert.deepEqual(worker.posted.at(-1), [0, 1]);
  clock.v += 1000; worker.fire(1);
  assert.equal(ticks, 30, "a cancelled timer no longer ticks");
  assert.equal(timers.usesWorker(), true);
});

test("without workers the loop keeps the page's timers", () => {
  assert.equal(workerTimers({ Worker: null, Blob: null, URL: null }), null);
  assert.equal(workerTimers(fakeWorkerWorld({ throwOnConstruct: true })), null);
  const loop = fixedTick(30, () => {}, { now: () => 0, ...(workerTimers({ Worker: null }) ?? {}), setInterval: () => 7, clearInterval: () => {} });
  assert.deepEqual(loop.stats(), { ticks: 0, dropped: 0 });
});

test("a worker refused after construction hands its timers back to the page", () => {
  const world = fakeWorkerWorld();
  const timers = workerTimers(world);
  let calls = 0;
  const id = timers.setInterval(() => { calls += 1; }, 16);
  world.workers[0].onerror(new Error("blocked"));
  assert.equal(world.native.length, 1);
  assert.equal(world.native[0].ms, 16);
  world.native[0].fn();
  assert.equal(calls, 1);
  assert.equal(timers.usesWorker(), false);
  timers.clearInterval(id);
  assert.deepEqual(world.cleared, [1]);
  timers.setInterval(() => {}, 20);
  assert.equal(world.native.length, 2, "later timers go straight to the page");
});

test("the seeded generator the audio uses is separate from the simulation's", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../engine.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /mixer\.onSnapshot\([^)]*state\.rng/, "sound must not draw from the simulation's generator");
  assert.ok(seededRng(1).next() === seededRng(1).next());
});
