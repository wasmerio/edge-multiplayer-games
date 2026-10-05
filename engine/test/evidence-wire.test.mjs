// Phase 4 evidence: codec properties, the host/guest stream, and the reference fixture on the wire.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { defineSnapshot } from "../schema.js";
import { hostGame } from "../host.js";
import { joinGame } from "../guest.js";
import { DELTA, FULL, frame, unframe } from "../frames.js";
import { parseFixture } from "../replay.js";
import { seededRng } from "../rng.js";
import { arenaFor } from "../render2d.js";
import { MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, SNAPSHOT_BUDGET_BYTES } from "../params.js";
import { createLoopback } from "./fake-transport.mjs";
import { Game, SNAPSHOT } from "../../achtung/public/game.js";

const CAP = MAX_PLAYERS_PER_ROOM;
const RUNS = 200;
const rangeOf = (bits, signed) => (signed ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1]);

// One schema per case: the tick, the field as a scalar, per player, and as a fixed-count list.
const caseSchema = (field) => defineSnapshot({
  budgetBytes: 4096,
  fields: { k: { type: "uint", bits: 8 }, one: field, each: { ...field, per: "player" }, some: { ...field, count: 3 } },
});
const roundTrip = (schema, draw, players) => {
  const snap = { k: 1, one: draw(), each: Array.from({ length: players }, draw), some: [draw(), draw(), draw()] };
  return { snap, back: schema.decode(schema.encode(snap, players), players) };
};

for (const type of ["uint", "int"]) {
  for (const bits of [8, 16, 32]) {
    test(`property: ${type}${bits} round-trips exactly across its whole range`, () => {
      const rng = seededRng(bits + type.length);
      const [lo, hi] = rangeOf(bits, type === "int");
      const schema = caseSchema({ type, bits });
      const edges = [lo, hi, 0];
      for (let i = 0; i < RUNS; i++) {
        const players = rng.int(1, CAP);
        const draw = () => (i < edges.length ? edges[i] : lo + Math.floor(rng.next() * (hi - lo + 1)));
        const { snap, back } = roundTrip(schema, draw, players);
        assert.deepEqual(back, snap);
      }
    });
  }
}

for (const bits of [8, 16, 32]) {
  for (const signed of [true, false]) {
    for (const scale of [1, 10, 100, 1000]) {
      test(`property: fixed${bits} ${signed ? "signed" : "unsigned"} at scale ${scale} round-trips within half a step`, () => {
        const rng = seededRng(bits * scale + (signed ? 1 : 0));
        const [lo, hi] = rangeOf(bits, signed);
        const schema = caseSchema({ type: "fixed", bits, scale, signed });
        const step = 1 / scale;
        const near = (a, b) => assert.ok(Math.abs(a - b) <= step / 2 + 1e-9, `${b} came back as ${a}`);
        for (let i = 0; i < RUNS; i++) {
          const players = rng.int(1, CAP);
          const draw = () => rng.range(lo / scale, hi / scale);
          const { snap, back } = roundTrip(schema, draw, players);
          near(back.one, snap.one);
          back.each.forEach((value, at) => near(value, snap.each[at]));
          back.some.forEach((value, at) => near(value, snap.some[at]));
          // A value already on the grid survives untouched.
          assert.deepEqual(schema.decode(schema.encode(back, players), players), back);
        }
      });
    }
  }
}

test("property: bool round-trips as a scalar, per player and as a fixed-count list", () => {
  const rng = seededRng(2);
  const schema = caseSchema({ type: "bool" });
  for (let i = 0; i < RUNS; i++) {
    const players = rng.int(1, CAP);
    const { snap, back } = roundTrip(schema, () => rng.next() < 0.5, players);
    assert.deepEqual(back, snap);
  }
});

test("property: a player-index list round-trips at every length up to the cap", () => {
  const rng = seededRng(3);
  const schema = defineSnapshot({ fields: { k: { type: "uint", bits: 8 }, d: { type: "players" } } });
  for (let i = 0; i < RUNS; i++) {
    const d = Array.from({ length: i <= CAP ? i : rng.int(0, CAP) }, () => rng.int(0, CAP - 1));
    assert.deepEqual(schema.decode(schema.encode({ k: 1, d }, CAP), CAP), { k: 1, d });
  }
});

test("a fixed-point value that would lose more than its scale is refused, never saturated", () => {
  for (const bits of [8, 16, 32]) {
    for (const signed of [true, false]) {
      const scale = 10;
      const [lo, hi] = rangeOf(bits, signed);
      const schema = defineSnapshot({ fields: { k: { type: "fixed", bits, scale, signed } } });
      assert.equal(schema.decode(schema.encode({ k: hi / scale }, 1), 1).k, hi / scale);
      assert.equal(schema.decode(schema.encode({ k: lo / scale }, 1), 1).k, lo / scale);
      for (const lossy of [(hi + 1) / scale, (lo - 1) / scale, hi, Infinity, Number.NaN]) {
        assert.throws(() => schema.encode({ k: lossy }, 1), /schema: field k (value|got)/, `${bits}-bit ${lossy}`);
      }
    }
  }
});

test("the budget is injectable, measured at the player cap, and an overrun names the parameter", () => {
  const fields = { k: { type: "uint", bits: 32 }, x: { type: "fixed", scale: 10, per: "player" }, d: { type: "players" } };
  const snap = { k: 1, x: new Array(CAP).fill(1.5), d: [0] };

  const standard = defineSnapshot({ fields });
  assert.equal(standard.budgetBytes, SNAPSHOT_BUDGET_BYTES);
  const measured = standard.encode(snap, CAP).byteLength;
  assert.equal(measured, 4 + 2 * CAP + 1 + CAP);
  assert.ok(measured <= standard.budgetBytes * CAP);

  const exact = defineSnapshot({ fields, budgetBytes: measured / CAP });
  assert.equal(exact.encode(snap, CAP).byteLength, measured);
  const tight = defineSnapshot({ fields, budgetBytes: measured / CAP - 0.125 });
  assert.throws(() => tight.encode(snap, CAP), new RegExp(`encoded ${measured} bytes for ${CAP} players, above SNAPSHOT_BUDGET_BYTES`));
  assert.throws(() => tight.delta(null, snap, CAP), /above SNAPSHOT_BUDGET_BYTES/);
});

const schema = defineSnapshot({
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    d: { type: "players" },
  },
});

// Stands still unless a player pushes: the scene is unchanged from tick to tick.
class Still {
  constructor(n, opts, rng) {
    this.n = n; this.rng = rng; this.round = 0; this.tick = 0; this.roundOver = true;
    this.scores = new Array(n).fill(0); this.x = new Array(n).fill(0); this.length = opts.length ?? 50;
  }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; this.x = this.x.map(() => this.round * 100); }
  step(inputs) {
    this.tick += 1;
    for (let i = 0; i < this.n; i++) this.x[i] += inputs[i] || 0;
    if (this.tick >= this.length) this.roundOver = true;
    return { k: this.tick, over: this.roundOver, x: [...this.x], d: [] };
  }
  winner() { return -1; }
}

const build = ({ Sim = Still, length } = {}) => {
  const net = createLoopback();
  const sim = new Sim(2, { length }, seededRng(3));
  const players = [{ pid: 0, owner: "host", name: "h" }, { pid: 1, owner: "g1", name: "g" }];
  const clock = { v: 0 };
  const loopDeps = { now: () => clock.v, setInterval: () => 0, clearInterval: () => {} };
  const host = hostGame({ sim, schema, players, transport: net.hostTransport, tickHz: 30, loopDeps });
  // Exactly one step per pump: the clock is set from a counter so rounding never skips a tick.
  let pumps = 0;
  const tick = (loop, times = 1) => { for (let i = 0; i < times; i++) { pumps += 1; clock.v = pumps * (1000 / 30) + 0.01; loop.pump(); } };
  return { net, sim, host, tick };
};
const tap = (guest) => {
  const seen = [];
  guest.transport.onMessage((_id, data) => seen.push(typeof data === "string" ? JSON.parse(data) : { bin: unframe(data), bytes: data.byteLength }));
  return seen;
};

test("every binary message the host puts on the wire is a schema frame that decodes or applies", () => {
  const { net, host, tick } = build();
  const seen = tap(net.addGuest("g1"));
  tick(host.start(), 6);
  const frames = seen.filter((m) => m.bin);
  assert.equal(frames.length, 7);
  let previous = null;
  for (const { bin } of frames) {
    previous = bin.kind === FULL ? schema.decode(bin.buffer, 2) : schema.apply(previous, bin.buffer, 2);
  }
  assert.deepEqual(previous, { k: 7, over: false, x: [100, 100], d: [] });
  const snapshotShaped = seen.filter((m) => !m.bin && ("k" in m || "x" in m));
  assert.deepEqual(snapshotShaped, [], "no snapshot travels as JSON");
});

test("a raw snapshot object is rejected by the transport on both ends", () => {
  const raw = { k: 1, over: false, x: [1, 2], d: [] };

  // Guest: a raw object is not a frame, and a JSON one is never treated as a snapshot.
  const { net } = build();
  const guest = net.addGuest("g1");
  const rendered = [];
  const client = joinGame({ schema, transport: guest.transport, onSnapshot: (snap) => rendered.push(snap) }).attach();
  guest.deliver(JSON.stringify({ t: "lobby", v: PROTOCOL_VERSION, schema: schema.hash, players: [{}, {}], tickHz: 30, opts: {} }));
  assert.throws(() => guest.deliver(raw), /frames: empty frame/);
  guest.deliver(JSON.stringify(raw));
  guest.deliver(JSON.stringify({ t: "snapshot", ...raw }));
  assert.deepEqual(rendered, []);
  assert.equal(client.sample(), null);

  // Host: a simulation whose snapshot does not fit the schema cannot be broadcast.
  class Loose extends Still { step() { return { state: super.step([0, 0]) }; } }
  const loose = build({ Sim: Loose });
  const seen = tap(loose.net.addGuest("g1"));
  assert.throws(() => loose.host.start(), /schema: field k got undefined/);
  assert.equal(seen.filter((m) => m.bin).length, 0);
});

test("with the state unchanged every tick sends a delta smaller than the full encoding, never a full one", () => {
  const { net, host, tick } = build();
  const seen = tap(net.addGuest("g1"));
  tick(host.start(), 20);
  const frames = seen.filter((m) => m.bin);
  const full = schema.byteLength(2) + 1;
  assert.equal(frames[0].bin.kind, FULL);
  assert.equal(frames[0].bytes, full);
  assert.equal(frames.length, 21);
  for (const sent of frames.slice(1)) {
    assert.equal(sent.bin.kind, DELTA, "no full snapshot off a round boundary");
    assert.ok(sent.bytes < full, `${sent.bytes} < ${full}`);
  }
});

test("every round boundary sends the round message then a full snapshot, with no delta in between", () => {
  const { net, host, tick } = build({ length: 3 });
  const guest = net.addGuest("g1");
  const order = [];
  // A relay, so the test sees each message in the order the guest does.
  const relay = {
    ...guest.transport,
    onMessage: (handler) => guest.transport.onMessage((id, data) => {
      order.push(typeof data === "string" ? JSON.parse(data).t : (unframe(data).kind === FULL ? "FULL" : "DELTA"));
      handler(id, data);
    }),
  };
  const viewer = joinGame({ schema, transport: relay, now: () => 0 }).attach();

  const loop = host.start();
  for (let round = 1; round <= 3; round++) {
    tick(loop, 4);
    assert.ok(viewer.stats().depth > 1, "the round filled the buffer");
    assert.equal(host.nextRound(), true);
    const at = order.lastIndexOf("round");
    assert.deepEqual(order.slice(at, at + 2), ["round", "FULL"], `round ${round + 1}`);
    assert.equal(order.length, at + 2);
    assert.equal(viewer.stats().depth, 1, "guest buffer cleared: the full snapshot is the only bracket");
    assert.deepEqual(viewer.sample(), { k: 1, over: false, x: [(round + 1) * 100, (round + 1) * 100], d: [] });
  }
  assert.equal(order.filter((kind) => kind === "round").length, 4);
  for (const [at, kind] of order.entries()) if (kind === "round") assert.equal(order[at + 1], "FULL");
});

test("a guest that lost every message before a round renders from the round's first frame alone", () => {
  const { net, host, tick } = build({ length: 3 });
  const guest = net.addGuest("g1");
  const gate = { open: false, handler: null, dropped: 0 };
  const lossy = { ...guest.transport, onMessage: (handler) => { gate.handler = handler; } };
  guest.transport.onMessage((id, data) => { if (gate.open) gate.handler(id, data); else gate.dropped += 1; });
  const errors = [];
  const client = joinGame({ schema, transport: lossy, now: () => 0, onError: (e) => errors.push(e) }).attach();

  // The handshake is all the guest keeps; the whole first round is lost.
  gate.handler(null, JSON.stringify(host.lobby));
  const loop = host.start();
  tick(loop, 4);
  assert.ok(gate.dropped >= 5);
  assert.equal(client.sample(), null);

  gate.open = true;
  host.nextRound();
  assert.deepEqual(errors, []);
  assert.deepEqual(client.sample(), { k: 1, over: false, x: [200, 200], d: [] });
  tick(loop, 1);
  assert.equal(client.stats().pushed, 2, "the deltas that follow apply cleanly");
});

test("a guest that missed the boundary itself asks for a full snapshot and recovers without rendering a partial one", () => {
  const { net, host, tick } = build();
  const guest = net.addGuest("g1");
  const gate = { open: false, handler: null };
  // The guest's requests travel on a queue, as they do on a real channel, not re-entrantly.
  const outbox = [];
  const lossy = {
    ...guest.transport,
    onMessage: (handler) => { gate.handler = handler; },
    sendToHost: (data) => outbox.push(data),
  };
  guest.transport.onMessage((id, data) => { if (gate.open) gate.handler(id, data); });
  const rendered = [];
  const client = joinGame({ schema, transport: lossy, now: () => 0, onSnapshot: (snap) => rendered.push(snap.k) }).attach();
  const loop = host.start();
  gate.handler(null, JSON.stringify(host.lobby));

  gate.open = true;
  tick(loop, 1);
  assert.deepEqual(outbox.map((data) => JSON.parse(data)), [{ t: "need-full" }]);
  assert.deepEqual(rendered, [], "the delta alone renders nothing");
  assert.equal(client.sample(), null);

  guest.transport.sendToHost(outbox.pop());
  assert.deepEqual(rendered, [2], "only the whole snapshot the host answered with");
  assert.deepEqual(client.sample(), { k: 2, over: false, x: [100, 100], d: [] });
  tick(loop, 1);
  assert.deepEqual(rendered, [2, 3]);
  assert.deepEqual(outbox, []);
});

test("a peer without a seat receives the stream and its input never reaches the simulation", () => {
  const { net, host, sim, tick } = build();
  net.addGuest("g1");
  const loop = host.start();
  const watcher = net.addGuest("watcher");
  const client = joinGame({ schema, transport: watcher.transport, now: () => 0 }).attach();
  host.welcome("watcher");
  assert.deepEqual(client.sample(), { k: 1, over: false, x: [100, 100], d: [] });

  watcher.transport.sendToHost(JSON.stringify({ t: "i", d: 7 }));
  tick(loop, 3);
  assert.deepEqual(sim.x, [100, 100], "a spectator's input is dropped by the host");
  assert.equal(client.stats().pushed, 4, "and it keeps receiving snapshots");

  net.guests.get("g1").transport.sendToHost(JSON.stringify({ t: "i", d: 7 }));
  tick(loop, 1);
  assert.deepEqual(sim.x, [100, 107], "while a seated player's input is applied");
});

// The reference fixture, replayed with the real simulation and pushed through the real codec.
const fixture = fs.readFileSync(new URL("../../achtung/test/replay.ndjson", import.meta.url), "utf8");
const achtungSchema = defineSnapshot(SNAPSHOT);
function recordedStream() {
  const { header, events } = parseFixture(fixture);
  const sim = new Game(header.players, { arena: arenaFor(header.players) }, seededRng(header.seed));
  const stream = [];
  for (const event of events) {
    if (event.e === "r") { sim.startRound(); stream.push({ round: true }); } else stream.push({ snap: sim.step(Object.freeze([...event.i])) });
  }
  return { players: header.players, stream };
}

test("the replayed reference fixture, encoded and decoded as the host and guest do, equals the recorded stream", () => {
  const { players, stream } = recordedStream();
  let hostPrevious = null;
  let guestPrevious = null;
  let ticks = 0;
  let deltas = 0;
  for (const entry of stream) {
    if (entry.round) { hostPrevious = null; guestPrevious = null; continue; }
    const { snap } = entry;
    const sent = hostPrevious ? achtungSchema.delta(hostPrevious, snap, players) : { full: true, buffer: achtungSchema.encode(snap, players) };
    hostPrevious = achtungSchema.decode(achtungSchema.encode(snap, players), players);
    const { kind, buffer } = unframe(frame(sent.full ? FULL : DELTA, sent.buffer));
    guestPrevious = kind === FULL ? achtungSchema.decode(buffer, players) : achtungSchema.apply(guestPrevious, buffer, players);
    ticks += 1;
    if (!sent.full) deltas += 1;

    for (const field of achtungSchema.fields) {
      const got = guestPrevious[field.name];
      const want = snap[field.name];
      if (field.kind === "fixed") got.forEach((value, i) => assert.ok(Math.abs(value - want[i]) <= 0.5 / field.scale + 1e-9, `${field.name}[${i}] at tick ${ticks}`));
      else assert.deepEqual(got, want, `${field.name} at tick ${ticks}`);
    }
    assert.ok(achtungSchema.encode(snap, players).byteLength <= achtungSchema.budgetBytes * players);
  }
  assert.equal(ticks, 1200);
  assert.ok(deltas > ticks / 2, `${deltas} of ${ticks} ticks travelled as deltas`);
});

test("the reference fixture encodes to the same bytes twice", () => {
  const digest = () => {
    const { players, stream } = recordedStream();
    const hash = createHash("sha256");
    let previous = null;
    for (const entry of stream) {
      if (entry.round) { previous = null; continue; }
      hash.update(new Uint8Array(achtungSchema.encode(entry.snap, players)));
      hash.update(new Uint8Array(achtungSchema.delta(previous, entry.snap, players).buffer));
      previous = entry.snap;
    }
    return hash.digest("hex");
  };
  const first = digest();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(digest(), first);
});
