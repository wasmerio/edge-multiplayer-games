// Engine 1.0.2: what a game needs for feel. Crisp canvas, text and gradients, one-shot
// events, a live scoreboard, snapshot-aware labels, a thumb stick and richer sound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSurface, TEXT_FAMILY } from "../render2d.js";
import { createMixer } from "../audio.js";
import { inputSource } from "../input.js";
import { mountUi } from "../ui.js";
import { defineSnapshot } from "../schema.js";
import { joinGame } from "../guest.js";
import { startGame } from "../engine.js";
import { FULL, frame } from "../frames.js";
import { SOUND_NAMES } from "../assets.js";
import { EVENT_BACKLOG_TICKS, MAX_PIXEL_RATIO, NEXT_ROUND_GUARD_MS, PROTOCOL_VERSION } from "../params.js";
import { fakeDocument, find } from "./fake-dom.mjs";

// ---- surface ----------------------------------------------------------------

function recordingSurface(options = {}) {
  const log = [];
  const gradient = (kind, args) => ({ kind, args, stops: [], addColorStop(at, colour) { this.stops.push([at, colour]); } });
  const methods = {
    createLinearGradient: (...args) => gradient("linear", args),
    createRadialGradient: (...args) => gradient("radial", args),
    measureText: (text) => ({ width: text.length * 10 }),
  };
  const context = new Proxy({}, {
    get: (_t, name) => methods[name] ?? ((...args) => { log.push([name, ...args]); }),
    set: (_t, name, value) => { log.push([`=${name}`, value]); return true; },
  });
  const canvases = [];
  const saved = globalThis.document;
  globalThis.document = { createElement: () => { const c = { dataset: {}, style: {}, getContext: () => context }; canvases.push(c); return c; } };
  const container = { appendChild() {}, style: {} };
  const surface = createSurface({ container, layers: ["world", "actors"], ...options });
  globalThis.document = saved;
  surface.setArena({ w: 100, h: 50 });
  log.length = 0;
  return { surface, log, canvases, container };
}
const calls = (log, name) => log.filter(([n]) => n === name);

test("the backing store follows the pixel ratio while drawing stays in arena units", () => {
  const { surface, canvases, container, log } = recordingSurface({ pixelRatio: 2 });
  assert.deepEqual(canvases.map((c) => [c.width, c.height]), [[200, 100], [200, 100]]);
  assert.equal(surface.pixelRatio(), 2);
  assert.deepEqual(surface.arena(), { w: 100, h: 50 });
  assert.equal(container.style.width, "min(100px, 100%)", "the element is sized in arena units, not device pixels");
  surface.setArena({ w: 100, h: 50 });
  assert.deepEqual(calls(log, "setTransform")[0], ["setTransform", 2, 0, 0, 2, 0, 0]);
  surface.clear("world");
  assert.deepEqual(calls(log, "clearRect").at(-1), ["clearRect", 0, 0, 100, 50]);
});

test("the surface reports how far the page has shrunk the board, and tells the stylesheet its size", () => {
  const { surface, container } = recordingSurface({ pixelRatio: 1 });
  assert.equal(surface.scale(), 1, "unknown layout counts as full size");
  container.clientWidth = 40;
  assert.equal(surface.scale(), 0.4);
  const vars = {};
  container.style.setProperty = (name, value) => { vars[name] = value; };
  surface.setArena({ w: 200, h: 80 });
  assert.deepEqual(vars, { "--arena-w": "200", "--arena-h": "80" });
});

test("the pixel ratio is capped, and a ratio of one leaves the canvas as it was", () => {
  assert.equal(recordingSurface({ pixelRatio: 5 }).surface.pixelRatio(), MAX_PIXEL_RATIO);
  const plain = recordingSurface({ pixelRatio: 1 });
  assert.deepEqual(plain.canvases.map((c) => c.width), [100, 100]);
  plain.surface.setArena({ w: 100, h: 50 });
  assert.equal(calls(plain.log, "setTransform").length, 0);
  assert.equal(recordingSurface({ pixelRatio: Number.NaN }).surface.pixelRatio(), 1);
});

test("text keeps its old defaults and takes a family, a baseline, italics and an outline", () => {
  const { surface, log } = recordingSurface({ pixelRatio: 1 });
  surface.text("actors", { x: 1, y: 2, value: "hi" });
  assert.deepEqual(calls(log, "=font"), [["=font", `16px ${TEXT_FAMILY}`]]);
  assert.deepEqual(calls(log, "=textBaseline"), [["=textBaseline", "alphabetic"]]);
  assert.deepEqual(calls(log, "fillText"), [["fillText", "hi", 1, 2]]);
  assert.equal(calls(log, "strokeText").length, 0);
  log.length = 0;
  surface.text("actors", {
    x: 5, y: 6, value: 7, size: 30, weight: 900, italic: true, family: "Impact, sans-serif", baseline: "middle", align: "center",
    outline: { colour: "#000", width: 4 }, maxWidth: 80,
  });
  assert.deepEqual(calls(log, "=font"), [["=font", "italic 900 30px Impact, sans-serif"]]);
  assert.deepEqual(calls(log, "=textBaseline"), [["=textBaseline", "middle"]]);
  assert.deepEqual(calls(log, "strokeText"), [["strokeText", "7", 5, 6, 80]]);
  assert.deepEqual(calls(log, "=lineWidth"), [["=lineWidth", 4]]);
  const order = log.map(([n]) => n).filter((n) => n === "strokeText" || n === "fillText");
  assert.deepEqual(order, ["strokeText", "fillText"], "the outline sits under the fill");
});

test("a colour may be a linear or a radial gradient in arena units", () => {
  const { surface, log } = recordingSurface({ pixelRatio: 1 });
  surface.box("world", { x: 0, y: 0, w: 100, h: 50, colour: { linear: [0, 0, 0, 50], stops: [[0, "#111"], [1, "#333"]] } });
  const fill = calls(log, "=fillStyle")[0][1];
  assert.equal(fill.kind, "linear");
  assert.deepEqual(fill.args, [0, 0, 0, 50]);
  assert.deepEqual(fill.stops, [[0, "#111"], [1, "#333"]]);
  surface.disc("actors", { x: 5, y: 5, r: 9, colour: { radial: [5, 5, 0, 5, 5, 9], stops: [[0, "#fff"], [1, "rgba(255,255,255,0)"]] } });
  assert.equal(calls(log, "=fillStyle")[1][1].kind, "radial");
  assert.throws(() => surface.disc("actors", { x: 0, y: 0, r: 1, colour: { linear: [0, 0], stops: [] } }), /gradient needs linear/);
});

test("alpha and glow apply to one call and are undone after it", () => {
  const { surface, log } = recordingSurface({ pixelRatio: 2 });
  surface.disc("actors", { x: 1, y: 1, r: 2, colour: "#f00" });
  assert.equal(calls(log, "save").length, 0, "a plain call touches no state");
  surface.disc("actors", { x: 1, y: 1, r: 2, colour: "#f00", alpha: 0.4, glow: { colour: "#ff0", blur: 10 } });
  assert.deepEqual(calls(log, "=globalAlpha"), [["=globalAlpha", 0.4]]);
  assert.deepEqual(calls(log, "=shadowColor"), [["=shadowColor", "#ff0"]]);
  assert.deepEqual(calls(log, "=shadowBlur"), [["=shadowBlur", 20]], "the blur is in arena units, so it scales with the backing store");
  assert.equal(calls(log, "save").length, 1);
  assert.equal(calls(log, "restore").length, 1);
  surface.arc("actors", { x: 0, y: 0, r: 5, from: 0, to: 1, colour: "#fff", alpha: 2 });
  assert.equal(calls(log, "=globalAlpha").at(-1)[1], 1, "alpha is clamped");
});

test("a disc can be stroked, and shake moves every layer without a redraw", () => {
  const { surface, log, canvases } = recordingSurface({ pixelRatio: 1 });
  surface.disc("actors", { x: 1, y: 1, r: 4, colour: "#0f0", stroke: 3 });
  assert.equal(calls(log, "stroke").length, 1);
  assert.equal(calls(log, "fill").length, 0);
  log.length = 0;
  surface.shake(10, -5);
  assert.deepEqual(canvases.map((c) => c.style.transform), ["translate(10%, -10%)", "translate(10%, -10%)"]);
  surface.shake();
  assert.deepEqual(canvases.map((c) => c.style.transform), ["", ""]);
  assert.equal(log.length, 0);
});

// ---- audio ------------------------------------------------------------------

function mixerFor(map) {
  const played = [];
  const context = { play: (voice) => { played.push(voice); return { stop() {} }; } };
  const assets = Object.fromEntries(SOUND_NAMES.map((name) => [name, { name }]));
  const mixer = createMixer({ assets, names: SOUND_NAMES, map, context, storage: null });
  mixer.unlock();
  return { mixer, played };
}

test("a pitch or a gain may be computed from the snapshot and the event's player", () => {
  const { mixer, played } = mixerFor({
    tk: { sound: "tick", pitch: (snap) => 1 + snap.heat, gain: (snap, player) => (player === 1 ? 0.25 : 1) },
    low: { sound: "boom", pitch: () => 0.01 },
    flat: { sound: "beep", pitch: 1.5 },
  });
  mixer.onSnapshot({ tk: [0, 1], low: [], flat: [], heat: 0.5 });
  assert.deepEqual(played.map((v) => [v.sound.name, v.pitch, v.gain]), [["tick", 1.5, 1], ["tick", 1.5, 0.25]]);
  mixer.onSnapshot({ tk: [], low: [0], flat: [2], heat: 0 });
  assert.equal(played[2].pitch, 0.25, "a computed rate is clamped to a playable range");
  assert.equal(played[3].pitch, 1.5, "a number is a fixed rate");
  assert.throws(() => createMixer({ names: SOUND_NAMES, map: { x: { sound: "tick", pitch: "high" } } }), /pitch must be/);
});

test("a binding can be limited to the local player's events, or to everyone else's", () => {
  const { mixer, played } = mixerFor({
    mine: { sound: "pickup", field: "took", only: "me" },
    theirs: { sound: "blip", field: "took", only: "others" },
  });
  mixer.onSnapshot({ took: [0, 2] }, { seat: 2 });
  assert.deepEqual(played.map((v) => v.sound.name), ["pickup", "blip"]);
  played.length = 0;
  mixer.onSnapshot({ took: [0, 2] });
  assert.deepEqual(played.map((v) => v.sound.name), ["blip", "blip"], "a spectator has no seat, so every event is someone else's");
  assert.throws(() => createMixer({ names: SOUND_NAMES, map: { x: { sound: "tick", only: "host" } } }), /only must be/);
});

test("every shared sound name is accepted, and an unknown one is refused at construction", () => {
  for (const name of SOUND_NAMES) createMixer({ names: SOUND_NAMES, map: { d: name } });
  assert.ok(SOUND_NAMES.length >= 15);
  assert.throws(() => createMixer({ names: SOUND_NAMES, map: { d: "kaboom" } }), /missing sound kaboom/);
});

// ---- input ------------------------------------------------------------------

test("a field without a binding still takes touch and stick values, clamped to its range", () => {
  const emitted = [];
  const source = inputSource({
    intent: { mx: { min: -1, max: 1, neutral: 0 }, aim: { min: -4, max: 4, neutral: 0 } },
    bindings: { mx: { keys: { KeyA: -1 } } },
    onChange: (value) => emitted.push(value),
    deps: { now: () => 0, target: null, gamepads: () => [], hasTouch: () => false },
  });
  source.touch("aim", 0.5);
  assert.equal(emitted.at(-1).aim, 0.5, "a fraction survives");
  source.touch("mx", 0.375);
  assert.equal(emitted.at(-1).mx, 0.375);
  source.touch("aim", 3);
  assert.equal(emitted.at(-1).aim, 3, "a touch value is taken as given");
  source.touch("aim", 9);
  assert.equal(emitted.at(-1).aim, 4, "and clamped to the field's range");
});

test("an analog axis keeps the stick's deflection", () => {
  const emitted = [];
  const pads = [{ axes: [0.6], buttons: [] }];
  const source = inputSource({
    intent: { mx: { min: -1, max: 1, neutral: 0 } }, bindings: { mx: { axis: 0, analog: true, deadZone: 0.2 } },
    onChange: (value) => emitted.push(value), deps: { now: () => 0, target: null, gamepads: () => pads, hasTouch: () => false },
  });
  source.poll();
  assert.equal(emitted.at(-1).mx, 0.6);
});

// ---- page controls ----------------------------------------------------------

const ROLES = { arena: "div", name: "input", create: "button", code: "input", join: "button", start: "button", scores: "ol", banner: "div" };

function ownedPage({ touch = [], sticks = [] } = {}) {
  const doc = fakeDocument();
  const nodes = {};
  for (const [role, tag] of Object.entries(ROLES)) {
    const node = doc.createElement(tag);
    node.setAttribute("data-engine", role);
    nodes[role] = doc.body.appendChild(node);
  }
  const buttons = touch.map((value) => {
    const button = doc.createElement("button");
    button.setAttribute("data-engine-touch", value);
    return nodes.arena.appendChild(button);
  });
  const pads = sticks.map((attributes) => {
    const stick = doc.createElement("div");
    for (const [key, value] of Object.entries(attributes)) stick.setAttribute(key, value);
    stick.getBoundingClientRect = () => ({ left: 100, top: 200, width: 100, height: 100 });
    return nodes.arena.appendChild(stick);
  });
  return { doc, nodes, buttons, pads };
}

function mountOwned(shape, intent) {
  const made = ownedPage(shape);
  const touched = [];
  const ui = mountUi({
    container: made.doc.body, doc: made.doc, intent, storage: null,
    where: { origin: "https://game.example", search: "" },
    onTouch: (field, value) => touched.push([field, value]),
  });
  return { ...made, ui, touched };
}

test("a finger that slides from one touch button to the next moves the hold with it", () => {
  const { buttons, touched, doc } = mountOwned({ touch: ["turn=-1", "turn=1", "fire=1"] }, { turn: {}, fire: {} });
  const [left, right, fire] = buttons;
  left.dispatch("pointerdown", { pointerId: 1 });
  assert.equal("data-pressed" in left.attributes, true);
  left.dispatch("pointerleave", { pointerId: 1 });
  right.dispatch("pointerenter", { pointerId: 1 });
  assert.equal("data-pressed" in left.attributes, false);
  assert.equal("data-pressed" in right.attributes, true);
  doc.dispatch("pointerup", { pointerId: 1 });
  assert.deepEqual(touched, [["turn", -1], ["turn", 0], ["turn", 1], ["turn", 0]]);
  touched.length = 0;
  fire.dispatch("pointerenter", { pointerId: 9 });
  assert.deepEqual(touched, [], "a pointer that did not start on a control presses nothing by hovering");
});

test("two fingers on two buttons of one field: the survivor keeps its value", () => {
  const { buttons, touched } = mountOwned({ touch: ["turn=-1", "turn=1"] }, { turn: {} });
  buttons[0].dispatch("pointerdown", { pointerId: 1 });
  buttons[1].dispatch("pointerdown", { pointerId: 2 });
  buttons[1].dispatch("pointerup", { pointerId: 2 });
  assert.deepEqual(touched, [["turn", -1], ["turn", 1], ["turn", -1]]);
  buttons[0].dispatch("pointerup", { pointerId: 1 });
  assert.deepEqual(touched.at(-1), ["turn", 0]);
});

test("a stick turns one drag into two intent fields, eight ways, with a dead zone", () => {
  const intent = { mx: { min: -1, max: 1, neutral: 0 }, my: { min: -1, max: 1, neutral: 0 } };
  const { pads, touched, ui } = mountOwned({ sticks: [{ "data-engine-stick": "mx,my" }] }, intent);
  const [stick] = pads;
  assert.equal(ui.hasTouch, true, "a stick counts as a touch control");
  const at = (x, y) => ({ pointerId: 4, clientX: 150 + x, clientY: 250 + y });
  stick.dispatch("pointerdown", at(5, 0));
  assert.deepEqual(touched, [], "inside the dead zone nothing is sent");
  assert.equal("data-active" in stick.attributes, true);
  stick.dispatch("pointermove", at(40, 0));
  assert.deepEqual(touched, [["mx", 1]]);
  assert.equal(stick.style["--stick-x"], "0.800");
  stick.dispatch("pointermove", at(30, 30));
  assert.deepEqual(touched.at(-1), ["my", 1], "a diagonal sets both");
  stick.dispatch("pointermove", at(0, -45));
  assert.deepEqual(touched.slice(-2), [["mx", 0], ["my", -1]]);
  stick.dispatch("pointermove", { pointerId: 99, clientX: 0, clientY: 0 });
  assert.equal(touched.length, 4, "another pointer does not steer the stick");
  stick.dispatch("pointerup", at(0, -45));
  assert.deepEqual(touched.at(-1), ["my", 0]);
  assert.equal("data-active" in stick.attributes, false);
  assert.equal(stick.style["--stick-y"], "0");
});

test("an analog stick scales to each field's own range in eighths", () => {
  const intent = { ax: { min: -2, max: 2, neutral: 0 }, ay: { min: -1, max: 1, neutral: 0 } };
  const shape = { sticks: [{ "data-engine-stick": "ax,ay", "data-stick-mode": "analog", "data-stick-dead": "0" }] };
  const { pads, touched } = mountOwned(shape, intent);
  pads[0].dispatch("pointerdown", { pointerId: 1, clientX: 175, clientY: 250 });
  assert.deepEqual(touched, [["ax", 1]], "half deflection of a field that reaches 2");
  pads[0].dispatch("pointermove", { pointerId: 1, clientX: 50, clientY: 250 });
  assert.deepEqual(touched.at(-1), ["ax", -2], "past the rim is full deflection");
});

test("a stick that names an unknown field, one field or a bad mode is refused by name", () => {
  const intent = { mx: {}, my: {} };
  assert.throws(() => mountOwned({ sticks: [{ "data-engine-stick": "mx,up" }] }, intent), /stick names unknown intent field up/);
  assert.throws(() => mountOwned({ sticks: [{ "data-engine-stick": "mx" }] }, intent), /needs two intent fields/);
  assert.throws(() => mountOwned({ sticks: [{ "data-engine-stick": "mx,my", "data-stick-mode": "round" }] }, intent), /8way or analog/);
});

test("score rows mark the local player, the host, a state and a note, and rebuild only on change", () => {
  const { ui, nodes } = mountOwned();
  const rows = [
    { name: "ann", score: 3, you: true, host: true, state: "holder", note: "BOMB" },
    { name: "bob", score: 1, alive: false },
  ];
  assert.equal(ui.renderScores(rows), true);
  const [ann, bob] = nodes.scores.children;
  assert.equal(ann.className, "you host");
  assert.equal(ann.attributes["data-state"], "holder");
  assert.deepEqual(ann.children.map((n) => [n.tag, n.className, n.textContent]).slice(1), [["span", "name", "ann"], ["strong", "score", "3"], ["span", "note", "BOMB"]]);
  assert.equal(bob.className, "dead");
  assert.equal(bob.children.length, 3, "no note element without a note");
  assert.equal(ui.renderScores(rows.map((row) => ({ ...row }))), false, "the same rows leave the list alone");
  assert.equal(nodes.scores.children[0], ann);
  assert.equal(ui.renderScores([{ ...rows[0], note: "" }, rows[1]]), true);
  assert.notEqual(nodes.scores.children[0], ann);
});

test("the banner says what kind it is, for the stylesheet", () => {
  const { ui, nodes } = mountOwned();
  ui.banner("Round 2", 0, "round");
  assert.equal(nodes.banner.attributes["data-kind"], "round");
  ui.banner("hello");
  assert.equal(nodes.banner.attributes["data-kind"], "note");
});

// ---- guest event log --------------------------------------------------------

const eventSchema = defineSnapshot({
  interpolate: ["x"],
  fields: { k: { type: "uint", bits: 32 }, x: { type: "fixed", scale: 10, per: "player" }, d: { type: "players" }, on: { type: "bool" } },
});
const lobbyMessage = (players = 2) => JSON.stringify({
  t: "lobby", v: PROTOCOL_VERSION, schema: eventSchema.hash, target: 5, tickHz: 30,
  players: Array.from({ length: players }, (_, i) => ({ pid: i, owner: String(i + 1), name: `p${i}`, colour: "#fff" })), opts: { arena: { w: 400, h: 200 } },
});
const full = (k, d = []) => frame(FULL, eventSchema.encode({ k, x: [k, k], d, on: false }, 2));

test("a guest hands every frame over once, even after the buffer has dropped it", () => {
  let deliver = null;
  const transport = { onMessage: (fn) => { deliver = fn; }, sendToHost() {} };
  const client = joinGame({ schema: eventSchema, transport, now: () => 0 }).attach();
  deliver("h", lobbyMessage());
  deliver("h", JSON.stringify({ t: "round", n: 1 }));
  for (let k = 1; k <= 12; k++) deliver("h", full(k, k === 2 ? [1] : []));
  assert.ok(client.buffer().between(0, 99).every((f) => f.k > 2), "the buffer no longer holds tick 2");
  const first = client.presented(-Infinity, 9);
  assert.deepEqual(first.map((f) => f.k), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(first[1].d, [1]);
  assert.deepEqual(client.presented(-Infinity, 9), [], "never twice");
  assert.deepEqual(client.presented(9, 12).map((f) => f.k), [10, 11, 12]);
  for (let k = 13; k < 13 + EVENT_BACKLOG_TICKS + 5; k++) deliver("h", full(k));
  assert.equal(client.presented(12, 9999).length, EVENT_BACKLOG_TICKS, "a long stall replays a bounded backlog");
  deliver("h", JSON.stringify({ t: "round", n: 2 }));
  deliver("h", full(1));
  assert.deepEqual(client.presented(-Infinity, 5).map((f) => f.k), [1], "a new round starts a new log");
  assert.equal(client.latest().k, 1);
});

test("a box takes rounded corners, clamped to half its shorter side", () => {
  const { surface, log } = recordingSurface();
  surface.box("world", { x: 10, y: 20, w: 40, h: 20, colour: "#123", radius: 6 });
  assert.deepEqual(calls(log, "moveTo"), [["moveTo", 16, 20]]);
  assert.deepEqual(calls(log, "arcTo")[0], ["arcTo", 50, 20, 50, 40, 6]);
  assert.equal(calls(log, "arcTo").length, 4);
  assert.equal(calls(log, "fill").length, 1);
  assert.equal(calls(log, "fillRect").length, 0);
  surface.box("world", { x: 0, y: 0, w: 40, h: 20, colour: "#123", radius: 99, stroke: 2 });
  assert.equal(calls(log, "arcTo").at(-1)[5], 10);
  assert.equal(calls(log, "stroke").length, 1);
  surface.box("world", { x: 0, y: 0, w: 4, h: 4, colour: "#123" });
  assert.equal(calls(log, "fillRect").length, 1, "without a radius it is the plain rectangle");
});

test("rotate turns one call about the shape's centre and is undone after it", () => {
  const { surface, log } = recordingSurface();
  surface.box("world", { x: 10, y: 20, w: 40, h: 20, colour: "#123", rotate: 0.5 });
  assert.deepEqual(log.slice(0, 4), [["save"], ["translate", 30, 30], ["rotate", 0.5], ["translate", -30, -30]]);
  assert.deepEqual(log.at(-1), ["restore"]);
  log.length = 0;
  surface.ellipse("world", { x: 5, y: 6, rx: 3, ry: 2, colour: "#123", rotate: 1 });
  assert.deepEqual(calls(log, "translate")[0], ["translate", 5, 6]);
  log.length = 0;
  surface.poly("world", { points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }], colour: "#123", rotate: 2 });
  assert.deepEqual(calls(log, "translate")[0], ["translate", 4, 2], "a polygon turns about its bounding box");
  log.length = 0;
  surface.text("world", { x: 7, y: 9, value: "a", rotate: -1 });
  assert.deepEqual([calls(log, "translate")[0], calls(log, "rotate")[0]], [["translate", 7, 9], ["rotate", -1]]);
  log.length = 0;
  surface.box("world", { x: 0, y: 0, w: 4, h: 4, colour: "#123", rotate: 0 });
  assert.equal(calls(log, "save").length, 0, "no rotation, no saved state");
});

test("text spacing lays the characters out one by one from the aligned start", () => {
  const { surface, log } = recordingSurface();
  surface.text("world", { x: 100, y: 5, value: "GO!", spacing: 4, align: "center", outline: { width: 2 } });
  // Three characters of 10 units and two gaps of 4: 38 wide, so it starts at 81.
  assert.deepEqual(calls(log, "fillText"), [["fillText", "G", 81, 5], ["fillText", "O", 95, 5], ["fillText", "!", 109, 5]]);
  assert.equal(calls(log, "strokeText").length, 3);
  assert.deepEqual(calls(log, "=textAlign").at(-1), ["=textAlign", "left"]);
  log.length = 0;
  surface.text("world", { x: 100, y: 5, value: "AB", spacing: 4, align: "right" });
  assert.deepEqual(calls(log, "fillText").map((call) => call[2]), [76, 90]);
});

// ---- a whole game in Node ---------------------------------------------------

class Pop {
  constructor(n, opts, rng) { this.n = n; this.rng = rng; this.round = 0; this.tick = 0; this.roundOver = true; this.scores = new Array(n).fill(0); }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; }
  step() {
    this.tick += 1;
    const d = this.tick === 3 ? [0] : this.tick === 4 ? [0, 0] : [];
    if (this.tick === 6) { this.roundOver = true; this.scores[0] += 1; }
    return { k: this.tick, x: new Array(this.n).fill(this.tick), d, on: this.tick > 4 };
  }
  winner(target) { return this.scores[0] >= target ? 0 : -1; }
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

function launch(extra = {}) {
  const doc = fakeDocument();
  const create = doc.createElement;
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  doc.createElement = (tag) => { const node = create(tag); if (tag === "canvas") node.getContext = () => context; return node; };
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const sockets = [];
  const connections = [];
  const raf = [];
  const loop = { pump: null, clock: 0 };
  const wall = { t: 1000 };
  class Socket { constructor() { this.readyState = 1; this.sent = []; sockets.push(this); } send(data) { this.sent.push(JSON.parse(data)); } close() {} }
  class Connection {
    constructor() { this.connectionState = "connected"; connections.push(this); }
    createDataChannel() { this.channel = { readyState: "open", sent: [], send(data) { this.sent.push(data); }, close() {} }; return this.channel; }
    async createOffer() { return {}; }
    async setLocalDescription() {}
    async setRemoteDescription() {} async addIceCandidate() {} close() {}
  }
  const globals = { document: doc, WebSocket: Socket, RTCPeerConnection: Connection, requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; }, __engine: undefined };
  const handle = {};
  const game = withGlobals(globals, () => {
    const made = startGame({
      title: "Pop", Simulation: Pop, schema: eventSchema, intent: { turn: { min: -1, max: 1, neutral: 0 } }, bindings: {},
      draw: () => {}, target: () => 2,
      container, doc, where: { origin: "http://game.test", search: "", protocol: "http:", host: "game.test" }, history: { replaceState() {} },
      arena: () => ({ w: 400, h: 200 }), now: () => wall.t,
      loopDeps: { now: () => loop.clock, setInterval: (fn) => { loop.pump = fn; return 1; }, clearInterval: () => {} },
      ...extra,
    });
    handle.engine = globalThis.__engine;
    return made;
  });
  const signal = (msg) => withGlobals(globals, () => sockets[0].onmessage({ data: JSON.stringify(msg) }));
  return {
    game, doc, container, wall, engine: handle.engine, connections,
    signal,
    paint: () => withGlobals(globals, () => raf.at(-1)()),
    step: () => { loop.clock += 1000 / 30 + 0.01; loop.pump(); },
    key: (code, more = {}) => { let prevented = false; withGlobals(globals, () => doc.dispatch("keydown", { code, preventDefault() { prevented = true; }, ...more })); return prevented; },
    host() {
      signal({ t: "ready", id: "1" });
      signal({ t: "created", room: "ABCD", id: "1", token: "t", state: "open" });
      signal({ t: "started", state: "playing" });
    },
    guest() {
      signal({ t: "ready", id: "2" });
      signal({
        t: "joined", room: "ABCD", id: "2", host: "1", token: "t", spectator: false, state: "playing",
        peers: [{ id: "1", name: "host", spectator: false, connected: true }, { id: "2", name: "guest", spectator: false, connected: true }],
      });
      signal({ t: "signal", from: "1", data: { candidate: {} } });
      const channel = { readyState: "open", sent: [], send(data) { this.sent.push(data); } };
      connections[0].ondatachannel({ channel });
      return (data) => withGlobals(globals, () => channel.onmessage({ data }));
    },
  };
}

test("on the host, draw sees each event exactly once, even when a frame spans several ticks", () => {
  const seen = [];
  const { game, paint, step, host } = launch({ draw: (surface, snap, ctx) => { seen.push(ctx.events("d").map((e) => [e.player, e.tick])); } });
  host();
  paint();
  step(); step();
  paint();
  paint();
  step();
  paint();
  assert.deepEqual(seen, [[], [[0, 3]], [], [[0, 4], [0, 4]]], "tick 3 is seen once although ticks 2 and 3 shared one frame");
  assert.throws(() => game.ctx.events("x"), /x is not a players list or a bool flag/);
  assert.throws(() => game.ctx.events("nope"), /nope is not a players list or a bool flag/);
  game.state.host.stop();
});

test("a bool flag is an event for nobody in particular: once per tick it is true", () => {
  const seen = [];
  const { paint, step, host, game } = launch({ draw: (surface, snap, ctx) => { seen.push(...ctx.events("on").map((e) => [e.player, e.tick])); } });
  host();
  for (let i = 0; i < 5; i++) step();
  paint();
  paint();
  assert.deepEqual(seen, [[-1, 5], [-1, 6]]);
  game.state.host.stop();
});

test("on a guest, draw sees each event once when the screen reaches its tick, with the exact snapshot", async () => {
  const seen = [];
  const { paint, guest, wall } = launch({ draw: (surface, snap, ctx) => { for (const e of ctx.events("d")) seen.push([e.player, e.tick, e.snapshot.x[0], snap.k]); } });
  const arrive = guest();
  arrive(lobbyMessage());
  arrive(JSON.stringify({ t: "round", n: 1 }));
  for (let k = 1; k <= 3; k++) arrive(full(k, k === 2 ? [1] : []));
  paint();
  assert.deepEqual(seen, [], "tick 2 has arrived but the screen is still behind it");
  for (let k = 4; k <= 9; k++) arrive(full(k));
  wall.t += 16;
  paint();
  paint();
  assert.equal(seen.length, 1, "seen on the frame that passes tick 2, and never again");
  assert.deepEqual(seen[0].slice(0, 3), [1, 2, 2], "the entry carries the snapshot of its own tick");
  assert.ok(seen[0][3] >= 2);
  await Promise.resolve();
});

test("the draw context has a round number, an over flag, a clock and a frame time", () => {
  const frames = [];
  const { paint, step, host, wall, game } = launch({ draw: (surface, snap, ctx) => frames.push([ctx.round(), ctx.over(), ctx.time(), ctx.dt()]) });
  host();
  paint();
  wall.t += 50;
  step();
  paint();
  assert.deepEqual(frames[0], [1, false, 1, 0]);
  assert.deepEqual(frames[1], [1, false, 1.05, 0.05]);
  wall.t += 5000;
  paint();
  assert.equal(frames[2][3], 0.1, "a long pause is one capped step, not a jump");
  for (let i = 0; i < 6; i++) step();
  paint();
  assert.deepEqual(frames.at(-1).slice(0, 2), [1, true], "draw keeps running after the round is over");
  assert.equal(game.ctx.winner(), -1);
  assert.deepEqual(game.ctx.scores(), [1]);
  game.state.host.stop();
});

test("labels and hooks receive the players, the scores and the snapshot", () => {
  const heard = [];
  const { step, host, game, container } = launch({
    labels: {
      round: (n, info) => { heard.push(["round", n, info.round, info.players.length, info.snapshot]); return `Go ${n}`; },
      over: (name, info) => { heard.push(["over", name, info.winner, info.scores, info.snapshot.k, info.target]); return null; },
      next: (matchOver, info) => `${matchOver ? "again" : "next"} ${info.scores[0]}`,
    },
    onReady: (ctx) => heard.push(["ready", typeof ctx.intent]),
    onRound: (n, ctx) => heard.push(["onRound", n, ctx.round()]),
    onOver: (winner, ctx) => heard.push(["onOver", winner, ctx.over()]),
  });
  assert.deepEqual(heard, [["ready", "function"]]);
  host();
  for (let i = 0; i < 6; i++) step();
  assert.deepEqual(heard.slice(1), [
    ["round", 1, 1, 1, null], ["onRound", 1, 1],
    ["over", null, -1, [1], 6, 2], ["onOver", -1, true],
  ]);
  const banner = find(container, (n) => n.attributes["data-engine"] === "banner");
  assert.equal(banner.classList.contains("engine-hidden"), true, "a label that returns nothing shows no banner");
  assert.equal(find(container, (n) => n.attributes["data-engine"] === "next").textContent, "next 1");
  game.state.host.stop();
});

test("the scoreboard hook sees the snapshot on screen and its rows follow it", () => {
  const calls = [];
  const { paint, step, host, game, container } = launch({
    scoreboard: (players, scores, snapshot) => {
      calls.push([players.map((p) => [p.you, p.host]), [...scores], snapshot?.k ?? null]);
      return players.map((p) => ({ ...p, note: snapshot?.on ? "hot" : "" }));
    },
  });
  host();
  assert.deepEqual(calls[0], [[[true, true]], [], null], "before the first frame there is no snapshot");
  const list = find(container, (n) => n.attributes["data-engine"] === "scores");
  paint();
  const row = list.children[0];
  step(); paint(); paint();
  assert.equal(list.children[0], row, "rows that do not change are not rebuilt");
  const perTick = calls.length;
  paint();
  assert.equal(calls.length, perTick, "the hook runs once per tick on screen, not once per frame");
  for (let i = 0; i < 4; i++) step();
  paint();
  assert.equal(calls.at(-1)[2], 6);
  assert.notEqual(list.children[0], row, "a row whose note changed is rebuilt");
  assert.match(list.children[0].children[1].textContent, /hot/);
  game.state.host.stop();
});

test("the next-round key waits out a guard, ignores key repeat, and can be changed or switched off", () => {
  const space = launch();
  space.host();
  for (let i = 0; i < 6; i++) space.step();
  assert.equal(space.game.state.sim.roundOver, true);
  assert.equal(space.key("Space"), false, "a press right at the end of a round does not skip the result");
  space.wall.t += NEXT_ROUND_GUARD_MS + 1;
  assert.equal(space.key("Space", { repeat: true }), false);
  assert.equal(space.key("Enter"), false);
  assert.equal(space.key("Space"), true);
  assert.equal(space.game.state.sim.round, 2);
  space.game.state.host.stop();

  const enter = launch({ nextKey: "Enter" });
  enter.host();
  for (let i = 0; i < 6; i++) enter.step();
  enter.wall.t += NEXT_ROUND_GUARD_MS + 1;
  assert.equal(enter.key("Space"), false);
  assert.equal(enter.key("Enter"), true);
  enter.game.state.host.stop();

  const none = launch({ nextKey: null });
  none.host();
  for (let i = 0; i < 6; i++) none.step();
  none.wall.t += NEXT_ROUND_GUARD_MS + 1;
  assert.equal(none.key("Space"), false);
  assert.equal(none.game.state.sim.round, 1);
  none.game.state.host.stop();
});

test("the debug handle reports the snapshot on screen, and startGame returns the context and an intent setter", () => {
  const { paint, step, host, game, engine } = launch();
  assert.equal(engine.snapshot(), null);
  host();
  step();
  paint();
  assert.equal(engine.snapshot(), game.state.snapshot);
  assert.equal(engine.snapshot().k, 2);
  const state = engine.state();
  assert.deepEqual([state.round, state.seat, state.target, state.scores, state.winner, state.over], [1, 0, 2, [], null, false]);
  assert.deepEqual(engine.players().map((p) => p.pid), [0]);
  game.intent("turn", 1);
  assert.equal(game.input.current().turn, 1);
  game.ctx.intent("turn", 0);
  assert.equal(game.input.current().turn, 0);
  game.state.host.stop();
});

test("a peer that joined during a match watches it and is seated when the next match starts", async () => {
  const { signal, step, host, game, key, wall, connections, engine } = launch({ target: () => 1 });
  host();
  assert.equal(engine.state().players, 1);
  signal({ t: "peer", id: "7", name: "late", spectator: true });
  await Promise.resolve();
  const channel = connections[0].channel;
  channel.onopen();
  const heard = () => channel.sent.filter((data) => typeof data === "string").map((data) => JSON.parse(data));
  assert.equal(heard().find((msg) => msg.t === "lobby").players.length, 1, "the match in progress keeps its seats");
  assert.equal(game.state.roster.find((peer) => peer.id === "7").spectator, true);
  for (let i = 0; i < 6; i++) step();
  assert.equal(game.state.host.matchOver(), true);
  wall.t += NEXT_ROUND_GUARD_MS + 1;
  assert.equal(key("Space"), true);
  const lobbies = heard().filter((msg) => msg.t === "lobby");
  assert.deepEqual(lobbies.at(-1).players.map((p) => [p.owner, p.name]), [["1", lobbies.at(-1).players[0].name], ["7", "late"]]);
  assert.equal(game.state.roster.find((peer) => peer.id === "7").spectator, false);
  assert.equal(engine.state().players, 2);
  game.state.host.stop();
});

test("a guest follows the seat table: seated by a new lobby, it stops being a spectator", async () => {
  const { guest, game, engine } = launch();
  const arrive = guest();
  game.state.spectator = true;
  arrive(lobbyMessage());
  assert.equal(engine.state().spectator, false);
  assert.equal(engine.state().seat, 1);
  arrive(JSON.stringify({ ...JSON.parse(lobbyMessage()), players: [{ pid: 0, owner: "1", name: "host" }] }));
  assert.equal(engine.state().spectator, true);
  assert.equal(engine.state().seat, -1);
  await Promise.resolve();
});

test("the tick fraction runs from the host's last step towards the next, and stops with the round", () => {
  const seen = [];
  const { paint, step, host, wall, game } = launch({ draw: (surface, snap, ctx) => seen.push(ctx.tickFraction()) });
  host();
  paint();
  assert.equal(seen[0], 0);
  wall.t += 10;
  paint();
  assert.ok(Math.abs(seen[1] - 0.3) < 1e-9, "10 ms of a 33 ms tick");
  wall.t += 500;
  paint();
  assert.equal(seen[2], 1, "never past one tick");
  step();
  paint();
  assert.equal(seen[3], 0, "a new step starts a new fraction");
  for (let i = 0; i < 6; i++) step();
  wall.t += 10;
  paint();
  assert.equal(seen.at(-1), 0, "nothing moves after the round is over");
  game.state.host.stop();
});

test("on a guest the tick fraction is the blend between the two snapshots on screen", async () => {
  const seen = [];
  const { paint, guest } = launch({ draw: (surface, snap, ctx) => seen.push([snap.k, snap.x[0], ctx.tickFraction()]) });
  const arrive = guest();
  arrive(lobbyMessage());
  arrive(JSON.stringify({ t: "round", n: 1 }));
  for (let k = 1; k <= 6; k++) arrive(full(k));
  await new Promise((resolve) => setTimeout(resolve, 12));
  paint();
  const [tick, x, fraction] = seen[0];
  assert.equal(tick, 3, "discrete fields stay on the older snapshot");
  assert.ok(fraction > 0.2 && fraction < 1, `a part of one tick, got ${fraction}`);
  assert.ok(Math.abs(x - (3 + fraction)) < 1e-9, "the interpolated field moved by the same fraction");
  arrive(JSON.stringify({ t: "over", winner: -1, scores: [0, 0] }));
  paint();
  assert.deepEqual(seen[1], [6, 6, 0], "a settled stream shows its last snapshot exactly");
});
