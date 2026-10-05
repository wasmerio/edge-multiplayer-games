import { test } from "node:test";
import assert from "node:assert/strict";
import { defineSnapshot } from "../schema.js";
import { createBuffer } from "../interp.js";
import { hostGame } from "../host.js";
import { joinGame } from "../guest.js";
import { createLoopback } from "./fake-transport.mjs";
import { seededRng } from "../rng.js";

const schema = defineSnapshot({
  tickField: "k",
  interpolate: ["x", "a"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    a: { type: "fixed", scale: 10, bits: 16, per: "player", wrap: 360 },
  },
});

class Walk {
  constructor(n, opts, rng) {
    this.n = n; this.rng = rng; this.round = 0; this.tick = 0; this.roundOver = true;
    this.scores = new Array(n).fill(0);
  }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; }
  step() {
    this.tick += 1;
    if (this.tick >= 3) { this.roundOver = true; this.scores[0] += 1; }
    return { k: this.tick, over: this.roundOver, x: this.scores.map(() => this.tick), a: this.scores.map(() => 0) };
  }
  winner(target) { return this.scores[0] >= target ? 0 : -1; }
}

const snap = (k, x, a = 0) => ({ k, over: false, x: [x], a: [a] });

test("with a clock the presentation tick advances between arrivals and blends", () => {
  const clock = { t: 0 };
  const buffer = createBuffer({ schema, depth: 1, tickHz: 10, now: () => clock.t });
  buffer.push(snap(1, 10));
  buffer.push(snap(2, 20));
  assert.equal(buffer.sample().x[0], 10);
  clock.t = 50;
  assert.equal(buffer.sample().x[0], 15);
  clock.t = 5000;
  assert.equal(buffer.sample().x[0], 20, "never past one tick after the last arrival");
});

test("an exact hit on a buffered tick is not a starved frame", () => {
  const buffer = createBuffer({ schema, depth: 1 });
  buffer.push(snap(1, 10));
  buffer.push(snap(2, 20));
  buffer.sample();
  assert.equal(buffer.stats().starved, 0);
});

test("a wrapped field interpolates the short way round", () => {
  const clock = { t: 0 };
  const buffer = createBuffer({ schema, depth: 1, tickHz: 10, now: () => clock.t });
  buffer.push(snap(1, 0, 350));
  buffer.push(snap(2, 0, 10));
  clock.t = 50;
  assert.equal(Math.round(buffer.sample().a[0]), 0);
  clock.t = 25;
  assert.equal(Math.round(buffer.sample().a[0]), 355);
});

const build = () => {
  const net = createLoopback();
  const players = [{ pid: 0, owner: "host", name: "h" }, { pid: 1, owner: "g1", name: "g" }];
  const sim = new Walk(2, {}, seededRng(1));
  const timers = { fn: null, setInterval: (fn) => { timers.fn = fn; return 1; }, clearInterval: () => { timers.fn = null; } };
  const host = hostGame({ sim, schema, players, transport: net.hostTransport, target: 2, loopDeps: timers, now: () => 0 });
  return { net, sim, host };
};

test("a peer welcomed mid-game receives the lobby, the round and a full snapshot", () => {
  const { net, host, sim } = build();
  host.start();
  const late = net.addGuest("late");
  const seen = { lobby: null, round: null, errors: [] };
  const client = joinGame({
    schema, transport: late.transport, now: () => 0,
    onLobby: (msg) => { seen.lobby = msg; }, onRound: (msg) => { seen.round = msg; },
    onError: (error) => seen.errors.push(error),
  }).attach();
  host.welcome("late");
  assert.equal(seen.lobby.players.length, 2);
  assert.equal(seen.round.n, sim.round);
  assert.deepEqual(seen.errors, []);
  assert.equal(client.sample().k, 1);
});

test("a guest that asks for a full snapshot gets one, alone", () => {
  const { net, host } = build();
  const guest = net.addGuest("g1");
  const other = net.addGuest("g2");
  let otherFrames = 0;
  other.transport.onMessage((_id, data) => { if (typeof data !== "string") otherFrames += 1; });
  host.start();
  const before = otherFrames;
  let frames = 0;
  guest.transport.onMessage((_id, data) => { if (typeof data !== "string") frames += 1; });
  guest.transport.sendToHost(JSON.stringify({ t: "need-full" }));
  assert.equal(frames, 1);
  assert.equal(otherFrames, before);
});

test("the host reports a finished match only once a winner exists", () => {
  const { host, sim } = build();
  host.start();
  assert.equal(host.matchOver(), false);
  sim.roundOver = true; sim.scores[0] = 2;
  assert.equal(host.matchOver(), true);
});
