import { test } from "node:test";
import assert from "node:assert/strict";
import { defineSnapshot } from "../schema.js";
import { hostGame } from "../host.js";
import { joinGame } from "../guest.js";
import { createLoopback } from "./fake-transport.mjs";
import { unframe, FULL, DELTA, frame } from "../frames.js";
import { seededRng } from "../rng.js";
import { PROTOCOL_VERSION } from "../params.js";

const schema = defineSnapshot({
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    alive: { type: "bool", per: "player" },
    d: { type: "players" },
  },
});

class Slide {
  constructor(n, opts, rng) {
    this.n = n; this.rng = rng;
    this.round = 0; this.tick = 0; this.roundOver = true;
    this.scores = new Array(n).fill(0);
    this.x = new Array(n).fill(0);
  }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; this.x = this.x.map(() => this.rng.int(0, 5)); }
  step(inputs) {
    this.tick += 1;
    const deaths = [];
    for (let i = 0; i < this.n; i++) this.x[i] += inputs[i];
    if (this.tick >= 4) { this.roundOver = true; deaths.push(0); this.scores[0] += 1; }
    return { k: this.tick, over: this.roundOver, x: [...this.x], alive: this.x.map(() => true), d: deaths };
  }
  winner(target) { return this.scores[0] >= target ? 0 : -1; }
}

const build = (playerCount = 2) => {
  const net = createLoopback();
  const sim = new Slide(playerCount, {}, seededRng(3));
  const players = Array.from({ length: playerCount }, (_, i) => ({ pid: i, owner: i === 0 ? "host" : `g${i}`, name: `p${i}` }));
  const clock = { v: 0 };
  const loopDeps = { now: () => clock.v, setInterval: () => 0, clearInterval: () => {} };
  const host = hostGame({ sim, schema, players, transport: net.hostTransport, tickHz: 30, target: 2, loopDeps });
  return { net, sim, host, clock, players };
};

test("the host broadcasts a lobby then a full snapshot on a round", () => {
  const { net, host } = build();
  const guest = net.addGuest("g1");
  const seen = [];
  guest.transport.onMessage((_id, data) => seen.push(typeof data === "string" ? JSON.parse(data) : unframe(data)));
  host.start();
  assert.equal(seen[0].t, "lobby");
  assert.equal(seen[0].schema, schema.hash);
  assert.equal(seen[1].t, "round");
  assert.equal(seen[2].kind, FULL);
  host.stop();
});

test("a guest reconstructs the host's stream through deltas", () => {
  const { net, host, clock } = build();
  const guest = net.addGuest("g1");
  const client = joinGame({ schema, transport: guest.transport }).attach();
  const loop = host.start();
  for (let i = 0; i < 3; i++) { clock.v += 1000 / 30; loop.pump(); }
  const sample = client.sample();
  assert.ok(sample, "guest has a sample");
  assert.equal(typeof sample.k, "number");
  assert.equal(client.stats().pushed >= 2, true);
  host.stop();
});

test("ticks after the first are deltas, not full encodings", () => {
  const { net, host, clock } = build();
  const guest = net.addGuest("g1");
  const kinds = [];
  guest.transport.onMessage((_id, data) => { if (typeof data !== "string") kinds.push(unframe(data).kind); });
  const loop = host.start();
  clock.v += 1000 / 30; loop.pump();
  assert.equal(kinds[0], FULL);
  assert.equal(kinds[1], DELTA);
  host.stop();
});

test("a guest asks for a full snapshot when a delta arrives first", () => {
  const { net } = build();
  const guest = net.addGuest("g1");
  const asks = [];
  net.hostTransport.onMessage((_id, data) => asks.push(JSON.parse(data)));
  const client = joinGame({ schema, transport: guest.transport }).attach();
  guest.deliver(JSON.stringify({ t: "lobby", v: PROTOCOL_VERSION, schema: schema.hash, players: [{}, {}], target: 2, tickHz: 30, opts: {} }));
  guest.deliver(frame(DELTA, new ArrayBuffer(4)));
  assert.deepEqual(asks, [{ t: "need-full" }]);
  assert.equal(client.sample(), null);
});

test("a guest refuses a mismatched protocol version", () => {
  const { net } = build();
  const guest = net.addGuest("g1");
  const errors = [];
  joinGame({ schema, transport: guest.transport, onError: (e) => errors.push(e) }).attach();
  guest.deliver(JSON.stringify({ t: "lobby", v: PROTOCOL_VERSION + 1, schema: schema.hash, players: [{}] }));
  assert.equal(errors[0].code, "protocol_mismatch");
});

test("a guest refuses a mismatched schema hash", () => {
  const { net } = build();
  const guest = net.addGuest("g1");
  const errors = [];
  joinGame({ schema, transport: guest.transport, onError: (e) => errors.push(e) }).attach();
  guest.deliver(JSON.stringify({ t: "lobby", v: PROTOCOL_VERSION, schema: "deadbeef", players: [{}] }));
  assert.equal(errors[0].code, "schema_mismatch");
});

test("a snapshot before the lobby is refused by name", () => {
  const { net } = build();
  const guest = net.addGuest("g1");
  const errors = [];
  joinGame({ schema, transport: guest.transport, onError: (e) => errors.push(e) }).attach();
  guest.deliver(frame(FULL, new ArrayBuffer(4)));
  assert.equal(errors[0].code, "snapshot_before_lobby");
});

test("guest input reaches the host's input array", () => {
  const { net, host, sim, clock } = build();
  const guest = net.addGuest("g1");
  joinGame({ schema, transport: guest.transport }).attach();
  const loop = host.start();
  guest.transport.sendToHost(JSON.stringify({ t: "i", d: 3 }));
  clock.v += 1000 / 30; loop.pump();
  assert.equal(sim.x[1], sim.x[1]);
  assert.ok(sim.x[1] >= 3, `guest input applied, x=${sim.x[1]}`);
  host.stop();
});

test("a round boundary clears the guest buffer", () => {
  const { net, host, clock } = build();
  const guest = net.addGuest("g1");
  const client = joinGame({ schema, transport: guest.transport }).attach();
  const loop = host.start();
  for (let i = 0; i < 4; i++) { clock.v += 1000 / 30; loop.pump(); }
  const before = client.stats().depth;
  host.nextRound();
  assert.ok(before > 0);
  assert.equal(client.stats().depth, 1, "buffer holds only the new round's full snapshot");
  host.stop();
});

test("a guest presents the final frame once the round is over", () => {
  const { net, host, clock } = build();
  const guest = net.addGuest("g1");
  const client = joinGame({ schema, transport: guest.transport }).attach();
  const loop = host.start();
  for (let i = 0; i < 2; i++) { clock.v += 1000 / 30; loop.pump(); }
  assert.ok(client.sample().k < 3, "mid-round the guest trails the newest frame");
  for (let i = 0; i < 3; i++) { clock.v += 1000 / 30; loop.pump(); }
  assert.equal(client.sample().k, 4);
  assert.equal(client.sample().over, true);
  host.nextRound();
  assert.equal(client.sample().over, false, "the next round resumes the buffered view");
  host.stop();
});

test("the host announces a winner once the target is reached", () => {
  const { net, host, clock } = build();
  const guest = net.addGuest("g1");
  const control = [];
  guest.transport.onMessage((_id, data) => { if (typeof data === "string") control.push(JSON.parse(data)); });
  const loop = host.start();
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 5; i++) { clock.v += 1000 / 30; loop.pump(); }
    host.nextRound();
  }
  assert.ok(control.some((m) => m.t === "over" && m.winner === 0), JSON.stringify(control.map((m) => m.t)));
  host.stop();
});

test("the host refuses to run without its collaborators", () => {
  assert.throws(() => hostGame({}), /sim, schema and transport are required/);
  assert.throws(
    () => hostGame({ sim: {}, schema, transport: {}, players: [] }),
    /players must be a non-empty array/,
  );
});

test("a frame with an unknown kind is rejected", () => {
  const bad = new Uint8Array([9, 0, 0]).buffer;
  assert.throws(() => unframe(bad), /unknown frame kind/);
  assert.throws(() => unframe(new ArrayBuffer(0)), /empty frame/);
});
