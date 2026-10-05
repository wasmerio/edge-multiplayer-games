import { test } from "node:test";
import assert from "node:assert/strict";
import { createSurface } from "../render2d.js";

// A recording 2D context: every call and every property write lands in `log`.
function fakeSurface() {
  const log = [];
  const context = new Proxy({}, {
    get: (_t, name) => (...args) => { log.push([name, ...args]); },
    set: (_t, name, value) => { log.push([`=${name}`, value]); return true; },
  });
  const saved = globalThis.document;
  globalThis.document = {
    createElement: () => ({ dataset: {}, getContext: () => context }),
  };
  const container = { appendChild() {}, style: {} };
  const surface = createSurface({ container, layers: ["world"] });
  globalThis.document = saved;
  surface.setArena({ w: 100, h: 50 });
  return { surface, log };
}
const calls = (log, name) => log.filter(([n]) => n === name);

test("poly fills a closed shape by default", () => {
  const { surface, log } = fakeSurface();
  surface.poly("world", { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], colour: "#123" });
  assert.deepEqual(calls(log, "moveTo"), [["moveTo", 0, 0]]);
  assert.equal(calls(log, "lineTo").length, 2);
  assert.equal(calls(log, "closePath").length, 1);
  assert.equal(calls(log, "fill").length, 1);
  assert.equal(calls(log, "stroke").length, 0);
  assert.deepEqual(calls(log, "=fillStyle"), [["=fillStyle", "#123"]]);
});

test("poly strokes an open dashed polyline and resets the dash", () => {
  const { surface, log } = fakeSurface();
  surface.poly("world", { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], colour: "#123", stroke: 2, closed: false, dash: [4, 12] });
  assert.equal(calls(log, "closePath").length, 0);
  assert.equal(calls(log, "stroke").length, 1);
  assert.deepEqual(calls(log, "setLineDash"), [["setLineDash", [4, 12]], ["setLineDash", []]]);
  assert.deepEqual(calls(log, "=lineWidth"), [["=lineWidth", 2]]);
});

test("poly rejects fewer than two points", () => {
  const { surface } = fakeSurface();
  assert.throws(() => surface.poly("world", { points: [{ x: 0, y: 0 }], colour: "#123" }), /at least two points/);
});

test("ellipse fills, or strokes when given a width", () => {
  const { surface, log } = fakeSurface();
  surface.ellipse("world", { x: 5, y: 6, rx: 3, ry: 2, colour: "#abc" });
  surface.ellipse("world", { x: 5, y: 6, rx: 3, ry: 2, colour: "#abc", stroke: 4 });
  assert.deepEqual(calls(log, "ellipse")[0], ["ellipse", 5, 6, 3, 2, 0, 0, Math.PI * 2]);
  assert.equal(calls(log, "fill").length, 1);
  assert.equal(calls(log, "stroke").length, 1);
});

test("arc strokes the given span with a butt cap", () => {
  const { surface, log } = fakeSurface();
  surface.arc("world", { x: 1, y: 2, r: 9, from: 0, to: 1, colour: "#abc", width: 5 });
  assert.deepEqual(calls(log, "arc"), [["arc", 1, 2, 9, 0, 1]]);
  assert.deepEqual(calls(log, "=lineCap"), [["=lineCap", "butt"]]);
  assert.deepEqual(calls(log, "=lineWidth"), [["=lineWidth", 5]]);
  assert.equal(calls(log, "stroke").length, 1);
});

test("text keeps its default font and takes an optional weight and width cap", () => {
  const { surface, log } = fakeSurface();
  surface.text("world", { x: 1, y: 2, value: "a" });
  surface.text("world", { x: 1, y: 2, value: "b", weight: 600, maxWidth: 40, size: 12 });
  assert.deepEqual(calls(log, "=font"), [["=font", "16px system-ui, sans-serif"], ["=font", "600 12px system-ui, sans-serif"]]);
  assert.deepEqual(calls(log, "fillText"), [["fillText", "a", 1, 2], ["fillText", "b", 1, 2, 40]]);
});

test("an unknown layer is rejected by the new primitives", () => {
  const { surface } = fakeSurface();
  assert.throws(() => surface.arc("nope", { x: 0, y: 0, r: 1, from: 0, to: 1, colour: "#fff" }), /unknown layer/);
});
