// Hooks a game with its own renderer or its own control messages relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStage } from "../stage.js";
import { defineSnapshot } from "../schema.js";
import { hostGame } from "../host.js";
import { joinGame } from "../guest.js";
import { inputSource } from "../input.js";
import { createLoopback } from "./fake-transport.mjs";
import { seededRng } from "../rng.js";

const schema = defineSnapshot({
  fields: { k: { type: "uint", bits: 32 }, x: { type: "fixed", scale: 10, per: "player" } },
});

class Walk {
  constructor(n, opts, rng) { this.n = n; this.rng = rng; this.round = 0; this.tick = 0; this.roundOver = true; this.scores = new Array(n).fill(0); this.bought = []; }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; }
  step() { this.tick += 1; return { k: this.tick, x: new Array(this.n).fill(this.tick) }; }
  winner() { return -1; }
}

const session = (onCommand) => {
  const net = createLoopback();
  const sim = new Walk(2, {}, seededRng(1));
  const players = [{ pid: 0, owner: "host", name: "a" }, { pid: 1, owner: "g1", name: "b" }];
  const loopDeps = { now: () => 0, setInterval: () => 0, clearInterval: () => {} };
  const host = hostGame({ sim, schema, players, transport: net.hostTransport, onCommand: onCommand && ((i, d) => onCommand(sim, i, d)), loopDeps });
  return { net, sim, host };
};

test("a custom renderer is mounted into the arena and receives every hook", () => {
  const seen = [];
  const arena = { id: "arena" };
  const context = { id: "ctx" };
  const stage = createStage({
    arena, context, makeSurface: () => { throw new Error("no surface for a custom renderer"); },
    mount: (el, ctx) => {
      seen.push(["mount", el, ctx]);
      return {
        draw: (snap, c) => seen.push(["draw", snap, c]),
        lobby: (msg) => seen.push(["lobby", msg]),
        snapshot: (snap) => seen.push(["snapshot", snap]),
      };
    },
  });
  assert.equal(stage.custom, true);
  assert.equal(stage.surface, null);
  stage.lobby({ t: "lobby" });
  stage.round({ n: 1 });
  stage.over({ winner: -1 });
  stage.reply({ ok: true });
  stage.snapshot({ k: 1 });
  stage.draw({ k: 1 });
  assert.deepEqual(seen.map((row) => row[0]), ["mount", "lobby", "snapshot", "draw"]);
  assert.equal(seen[0][1], arena);
  assert.equal(seen[3][2], context);
});

test("a mount that returns no draw is refused", () => {
  assert.throws(() => createStage({ mount: () => ({}), arena: {}, context: {} }), /mount must return/);
});

test("without a mount the stage draws through the 2D surface as before", () => {
  const calls = [];
  const surface = { setArena: (a) => calls.push(["arena", a]), clearAll: () => calls.push(["clear"]) };
  const stage = createStage({ draw: (s, snap) => calls.push(["draw", s === surface, snap.k]), arena: {}, context: {}, makeSurface: () => surface });
  stage.lobby({ opts: { arena: { w: 4, h: 4 } } });
  stage.round({ n: 1 });
  stage.over({});
  stage.snapshot({});
  stage.draw({ k: 7 });
  assert.deepEqual(calls, [["arena", { w: 4, h: 4 }], ["clear"], ["draw", true, 7]]);
  assert.throws(() => createStage({ arena: {}, context: {}, makeSurface: () => surface }), /draw must be a function/);
});

test("a guest command reaches the host handler and only the sender hears the reply", () => {
  const { net, host, sim } = session((game, index, data) => { game.bought.push([index, data.item]); return { ok: true, item: data.item }; });
  const guest = net.addGuest("g1");
  const other = net.addGuest("g2");
  const heard = { g1: [], g2: [] };
  guest.transport.onMessage((_id, data) => { if (typeof data === "string") heard.g1.push(JSON.parse(data)); });
  other.transport.onMessage((_id, data) => { if (typeof data === "string") heard.g2.push(JSON.parse(data)); });
  host.start();
  guest.transport.sendToHost(JSON.stringify({ t: "c", d: { item: "kit" } }));
  other.transport.sendToHost(JSON.stringify({ t: "c", d: { item: "forged" } }));
  assert.deepEqual(sim.bought, [[1, "kit"]], "a peer without a seat cannot issue commands");
  assert.deepEqual(heard.g1.filter((m) => m.t === "c"), [{ t: "c", d: { ok: true, item: "kit" } }]);
  assert.equal(heard.g2.filter((m) => m.t === "c").length, 0);
  assert.deepEqual(host.command(0, { item: "armor" }), { ok: true, item: "armor" });
});

test("a command without a handler is ignored", () => {
  const { net, host } = session(null);
  const guest = net.addGuest("g1");
  host.start();
  assert.doesNotThrow(() => guest.transport.sendToHost(JSON.stringify({ t: "c", d: {} })));
  assert.equal(host.command(0, {}), undefined);
});

test("a guest hears every decoded snapshot once, ahead of interpolation", () => {
  const { net, host } = session(null);
  const guest = net.addGuest("g1");
  const ticks = [];
  joinGame({ schema, transport: guest.transport, onSnapshot: (snap) => ticks.push(snap.k) }).attach();
  host.start();
  assert.deepEqual(ticks, [1]);
});

test("a key typed into a form field is not game input", () => {
  const listeners = {};
  const target = { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: () => {} };
  const emitted = [];
  inputSource({
    intent: { x: { min: -1, max: 1, neutral: 0 } }, bindings: { x: { keys: { KeyA: -1 } } },
    onChange: (value) => emitted.push(value), deps: { target, now: () => 0, gamepads: () => [], hasTouch: () => false },
  });
  let prevented = false;
  listeners.keydown({ code: "KeyA", target: { tagName: "INPUT" }, preventDefault: () => { prevented = true; } });
  assert.equal(emitted.length, 0);
  assert.equal(prevented, false);
  listeners.keydown({ code: "KeyA", target: { tagName: "CANVAS" }, preventDefault: () => {} });
  assert.deepEqual(emitted.at(-1), { x: -1 });
});

test("an analogue field set through touch keeps its value unclamped to a sign", () => {
  const emitted = [];
  const source = inputSource({
    intent: { aim: { min: 0, max: 360, neutral: 0 } }, bindings: { aim: { discrete: false } },
    onChange: (value) => emitted.push(value), deps: { target: null, now: () => 0, gamepads: () => [], hasTouch: () => false },
  });
  source.touch("aim", 194.5);
  assert.deepEqual(emitted.at(-1), { aim: 194.5 });
});
