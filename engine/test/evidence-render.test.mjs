// Phase 6 evidence: the guest buffer, the surface, and the render path of a whole game.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineSnapshot } from "../schema.js";
import { createBuffer } from "../interp.js";
import { createSurface } from "../render2d.js";
import { createStage } from "../stage.js";
import { createCollector } from "../diagnostics.js";
import { startGame } from "../engine.js";
import { FULL, frame } from "../frames.js";
import { INTERP_BUFFER_TICKS, PROTOCOL_VERSION } from "../params.js";
import { fakeDocument } from "./fake-dom.mjs";

// One interpolated field and one field of every kind a game may leave discrete.
const schema = defineSnapshot({
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 },
    x: { type: "fixed", scale: 10, per: "player" },
    count: { type: "uint", bits: 8 },
    signed: { type: "int", bits: 8, per: "player" },
    cell: { type: "fixed", scale: 10, per: "player" },
    flag: { type: "bool" },
    alive: { type: "bool", per: "player" },
    slots: { type: "uint", bits: 8, count: 2 },
    d: { type: "players" },
  },
});
const older = { k: 1, x: [10, 100], count: 3, signed: [-4, 4], cell: [1.5, 2.5], flag: false, alive: [true, false], slots: [1, 2], d: [0] };
const newer = { k: 2, x: [20, 200], count: 9, signed: [8, -8], cell: [7.5, 8.5], flag: true, alive: [false, true], slots: [5, 6], d: [1] };
const midway = () => {
  const clock = { t: 0 };
  const buffer = createBuffer({ schema, depth: 1, tickHz: 10, now: () => clock.t });
  buffer.push(older);
  buffer.push(newer);
  clock.t = 50;
  return buffer;
};

test("between two brackets an interpolated field lies between them and never past the newer one", () => {
  const clock = { t: 0 };
  const buffer = createBuffer({ schema, depth: 1, tickHz: 10, now: () => clock.t });
  buffer.push(older);
  buffer.push(newer);
  for (const [at, expected] of [[0, [10, 100]], [25, [12.5, 125]], [50, [15, 150]], [99, [19.9, 199]], [100, [20, 200]], [60_000, [20, 200]]]) {
    clock.t = at;
    const got = buffer.sample().x;
    got.forEach((value, i) => {
      assert.ok(Math.abs(value - expected[i]) < 1e-9, `x[${i}] at ${at}ms is ${value}`);
      assert.ok(value >= older.x[i] && value <= newer.x[i], "inside the bracket, no extrapolation");
    });
  }
});

for (const name of ["count", "signed", "cell", "flag", "alive", "slots", "d"]) {
  const field = schema.fields.find((f) => f.name === name);
  test(`a discrete ${field.kind} field (${field.per}) is taken from the older bracket, never blended`, () => {
    const sample = midway().sample();
    assert.deepEqual(sample.x, [15, 150], "the bracket is being blended");
    assert.deepEqual(sample[name], older[name]);
    assert.notDeepEqual(sample[name], newer[name]);
    assert.equal(schema.isInterpolated(name), false);
  });
}

test("the tick itself is discrete: a blended frame carries the older bracket's tick", () => {
  assert.equal(midway().sample().k, 1);
});

test("a starved buffer holds the last known snapshot unblended and diagnostics records each starved frame", () => {
  const collector = createCollector({ now: () => 0, enabled: true });
  const buffer = createBuffer({ schema });
  assert.equal(buffer.sample(), null, "nothing to hold before the first arrival");
  buffer.push(older);
  for (let frames = 1; frames <= 3; frames++) {
    assert.equal(buffer.sample(), older, "the very snapshot that arrived, not a blend");
    collector.buffer(buffer.stats());
    assert.equal(collector.current().starved, frames);
  }
  assert.equal(collector.current().bufferDepth, 1);
});

test("a stream that stops is held at its newest snapshot and never run ahead of it", () => {
  const clock = { t: 0 };
  const buffer = createBuffer({ schema, depth: 1, tickHz: 10, now: () => clock.t });
  buffer.push(older);
  buffer.push(newer);
  for (const late of [100, 1_000, 3_600_000]) {
    clock.t = late;
    assert.equal(buffer.sample(), newer);
    assert.ok(buffer.presentationTick() <= newer.k);
  }
});

test("a round boundary leaves the full snapshot as the only bracket and nothing blends across it", () => {
  const buffer = midway();
  assert.deepEqual(buffer.sample().x, [15, 150]);
  buffer.clear();
  assert.equal(buffer.depth(), 0);
  const first = { ...older, k: 1, x: [900, 900] };
  buffer.push(first);
  assert.equal(buffer.depth(), 1);
  assert.equal(buffer.sample(), first, "exactly the boundary snapshot");
  assert.equal(buffer.push({ ...newer, k: 2, x: [910, 910] }), true, "the new round's ticks restart and are accepted");
});

test("a snapshot older than what the buffer already presents is dropped and counted", () => {
  const collector = createCollector({ now: () => 0, enabled: true });
  const buffer = createBuffer({ schema, depth: 1 });
  for (const k of [4, 5, 6]) buffer.push({ ...older, k });
  assert.equal(buffer.presentationTick(), 5);
  assert.equal(buffer.push({ ...newer, k: 3 }), false);
  assert.equal(buffer.push({ ...newer, k: 2 }), false);
  assert.deepEqual(buffer.between(0, 99).map((f) => f.k), [4, 5, 6]);
  assert.equal(buffer.stats().stale, 2);
  collector.buffer(buffer.stats());
  assert.equal(collector.current().staleSnapshots, 2, "diagnostics counts it");
});

test("a snapshot with a tick the buffer already holds is ignored", () => {
  const buffer = createBuffer({ schema, depth: 1 });
  buffer.push(older);
  buffer.push(newer);
  assert.equal(buffer.push({ ...newer, x: [-1, -1] }), false, "the newest tick again");
  assert.equal(buffer.push({ ...older, x: [-1, -1] }), false, "an earlier tick again");
  assert.deepEqual(buffer.between(0, 99), [older, newer]);
  assert.deepEqual([buffer.stats().duplicate, buffer.stats().pushed, buffer.stats().stale], [2, 2, 0]);
});

test("a buffer past its depth drops the oldest entries and keeps the newest", () => {
  const depth = 3;
  const buffer = createBuffer({ schema, depth });
  for (let k = 1; k <= 20; k++) buffer.push({ ...older, k });
  const held = buffer.between(0, 99).map((f) => f.k);
  assert.deepEqual(held, [16, 17, 18, 19, 20]);
  assert.equal(buffer.depth(), depth + 2);
  assert.equal(buffer.stats().dropped, 15);
  assert.equal(createBuffer({ schema }).presentationTick(), null);
  const standard = createBuffer({ schema });
  for (let k = 1; k <= 20; k++) standard.push({ ...older, k });
  assert.equal(standard.depth(), INTERP_BUFFER_TICKS + 2);
  assert.equal(standard.presentationTick(), 20 - INTERP_BUFFER_TICKS);
});

test("an interpolated field holding a non-number throws naming the field", () => {
  const clock = { t: 0 };
  const perPlayer = createBuffer({ schema, depth: 1, tickHz: 10, now: () => clock.t });
  perPlayer.push(older);
  perPlayer.push({ ...newer, x: [20, "far"] });
  clock.t = 50;
  assert.throws(() => perPlayer.sample(), /interp: field x is marked interpolated but holds a non-number/);

  const scalar = defineSnapshot({ interpolate: ["y"], fields: { k: { type: "uint", bits: 8 }, y: { type: "fixed", scale: 10 } } });
  const buffer = createBuffer({ schema: scalar, depth: 1, tickHz: 10, now: () => clock.t });
  clock.t = 0;
  buffer.push({ k: 1, y: null });
  buffer.push({ k: 2, y: 4 });
  clock.t = 50;
  assert.throws(() => buffer.sample(), /field y is marked interpolated/);
});

// A document whose canvases record their size, standing in for the page.
function page() {
  const doc = fakeDocument();
  const create = doc.createElement;
  const canvases = [];
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  doc.createElement = (tag) => {
    const node = create(tag);
    if (tag === "canvas") { node.width = 300; node.height = 150; node.getContext = () => context; canvases.push(node); }
    return node;
  };
  return { doc, canvases };
}
function withGlobals(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try { return run(); } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

test("every canvas and the container's aspect ratio follow the lobby's arena, and follow it again when it changes", () => {
  const { doc, canvases } = page();
  const container = doc.createElement("div");
  const stage = withGlobals({ document: doc }, () => createStage({
    draw: () => {}, arena: container, context: {},
    makeSurface: () => createSurface({ container, layers: ["world", "actors", "hud"] }),
  }));
  assert.equal(canvases.length, 3);
  assert.deepEqual(container.children, canvases);

  stage.lobby({ t: "lobby", opts: { arena: { w: 800, h: 600 } } });
  assert.deepEqual(canvases.map((c) => [c.width, c.height]), [[800, 600], [800, 600], [800, 600]]);
  assert.equal(container.style.aspectRatio, "800 / 600");
  assert.deepEqual(stage.surface.arena(), { w: 800, h: 600 });

  stage.lobby({ t: "lobby", opts: { arena: { w: 1264, h: 948 } } });
  assert.deepEqual(canvases.map((c) => [c.width, c.height]), [[1264, 948], [1264, 948], [1264, 948]], "no stale dimensions");
  assert.equal(container.style.aspectRatio, "1264 / 948");
  assert.equal(container.style.width, "min(1264px, 100%)");
  assert.deepEqual(stage.surface.arena(), { w: 1264, h: 948 });
});

test("a surface without its container element throws naming it, and an arena without a size is refused", () => {
  assert.throws(() => createSurface({}), /createSurface: container is required/);
  assert.throws(() => createSurface({ container: null, layers: ["world"] }), /container is required/);
  const { doc } = page();
  const surface = withGlobals({ document: doc }, () => createSurface({ container: doc.createElement("div") }));
  assert.throws(() => surface.setArena({ w: 0, h: 600 }), /surface: arena must be positive, got 0x600/);
  assert.throws(() => surface.setArena({}), /arena must be positive/);
});

// A whole game in Node: the real startGame over a stand-in page, socket and peer connection.
class Walk {
  constructor(n, opts, rng) { this.n = n; this.rng = rng; this.round = 0; this.tick = 0; this.roundOver = true; this.scores = new Array(n).fill(0); }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; }
  step() { this.tick += 1; return { k: this.tick, x: new Array(this.n).fill(this.tick * 10) }; }
  winner() { return -1; }
}
const walkSchema = defineSnapshot({
  interpolate: ["x"],
  fields: { k: { type: "uint", bits: 32 }, x: { type: "fixed", scale: 10, per: "player" } },
});

function launch() {
  const { doc, canvases } = page();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const sockets = [];
  const connections = [];
  const raf = [];
  const drawn = [];
  const loop = { pump: null, clock: 0 };
  class Socket { constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); } send(data) { this.sent.push(JSON.parse(data)); } close() {} }
  class Connection {
    constructor() { this.connectionState = "connected"; connections.push(this); }
    async setRemoteDescription() {} async addIceCandidate() {} close() {}
  }
  const globals = {
    document: doc, WebSocket: Socket, RTCPeerConnection: Connection,
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; }, __engine: undefined,
  };
  const game = withGlobals(globals, () => startGame({
    title: "Walk", Simulation: Walk, schema: walkSchema,
    intent: { turn: { min: -1, max: 1, neutral: 0 } }, bindings: { turn: { keys: { KeyA: -1, KeyD: 1 } } },
    draw: (surface, snapshot) => drawn.push(snapshot),
    container, doc, where: { origin: "http://game.test", search: "", protocol: "http:", host: "game.test" }, history: { replaceState() {} },
    arena: () => ({ w: 400, h: 200 }),
    loopDeps: { now: () => loop.clock, setInterval: (fn) => { loop.pump = fn; return 1; }, clearInterval: () => {} },
  }));
  return {
    game, canvases, connections, drawn, loop,
    signal: (msg) => withGlobals(globals, () => sockets[0].onmessage({ data: JSON.stringify(msg) })),
    // One animation frame: the engine's own render function, as the browser would call it.
    paint: () => withGlobals(globals, () => raf.at(-1)()),
    step: () => { loop.clock += 1000 / 30 + 0.01; loop.pump(); },
  };
}

test("the host draws its own newest state every frame: no buffer and zero added delay", () => {
  const { game, drawn, signal, paint, step } = launch();
  signal({ t: "ready", id: "1" });
  signal({ t: "created", room: "ABCD", id: "1", token: "t", state: "open" });
  signal({ t: "started", state: "playing" });
  const sim = game.state.sim;
  assert.equal(game.state.client, null, "a host has no interpolation buffer at all");

  paint();
  assert.equal(drawn.at(-1).k, sim.tick);
  for (let i = 0; i < 6; i++) {
    step();
    paint();
    assert.equal(drawn.at(-1).k, sim.tick, "the frame shows the tick the simulation just produced");
    assert.equal(drawn.at(-1), game.state.snapshot, "the authoritative snapshot itself, not a copy from a buffer");
  }
  assert.equal(sim.tick, 7);
  game.state.host.stop();
});

test("a guest draws only what the buffer offers: an arrival is never drawn directly", async () => {
  const { game, canvases, connections, drawn, signal, paint } = launch();
  signal({ t: "ready", id: "2" });
  signal({
    t: "joined", room: "ABCD", id: "2", host: "1", token: "t", spectator: false, state: "playing",
    peers: [{ id: "1", name: "host", spectator: false, connected: true }, { id: "2", name: "guest", spectator: false, connected: true }],
  });
  signal({ t: "signal", from: "1", data: { candidate: {} } });
  const channel = { readyState: "open", sent: [], send(data) { this.sent.push(data); } };
  connections[0].ondatachannel({ channel });
  const arrive = (data) => channel.onmessage({ data });

  const lobby = (arena) => arrive(JSON.stringify({
    t: "lobby", v: PROTOCOL_VERSION, schema: walkSchema.hash, target: 5, tickHz: 30,
    players: [{ pid: 0, owner: "1", name: "host" }, { pid: 1, owner: "2", name: "guest" }], opts: { arena },
  }));
  lobby({ w: 640, h: 480 });
  assert.deepEqual(canvases.map((c) => [c.width, c.height]), [[640, 480], [640, 480]], "canvases sized from the lobby message");

  arrive(JSON.stringify({ t: "round", n: 1 }));
  const newest = 8;
  for (let k = 1; k <= newest; k++) arrive(frame(FULL, walkSchema.encode({ k, x: [k * 10, k * 10] }, 2)));
  assert.equal(game.state.client.stats().pushed, newest);
  assert.deepEqual(drawn, [], "eight arrivals, nothing drawn: drawing happens only on a frame");

  paint();
  assert.equal(drawn.length, 1);
  const shown = drawn[0];
  const presentation = newest - INTERP_BUFFER_TICKS;
  assert.ok(shown.k === presentation || shown.k === presentation + 1, `drew tick ${shown.k}, the presentation tick is ${presentation}`);
  assert.ok(shown.k < newest, "never the raw newest arrival");
  assert.ok(shown.x[0] >= presentation * 10 && shown.x[0] <= (presentation + 1) * 10, "blended inside the bracket");

  // A second lobby with another arena resizes every canvas.
  lobby({ w: 900, h: 300 });
  assert.deepEqual(canvases.map((c) => [c.width, c.height]), [[900, 300], [900, 300]]);
  assert.equal(game.ui.arena.style.aspectRatio, "900 / 300");
  await Promise.resolve();
});
