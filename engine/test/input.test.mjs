import { test } from "node:test";
import assert from "node:assert/strict";
import { inputSource } from "../input.js";
import { arenaFor } from "../render2d.js";
import { INPUT_RESEND_INTERVAL_MS } from "../params.js";

const intent = { turn: { min: -1, max: 1, neutral: 0 }, boost: { values: [0, 1], neutral: 0 } };
const bindings = {
  turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 },
  boost: { keys: { Space: 1 }, buttons: { 0: 1 } },
};

const harness = (extra = {}) => {
  const emitted = [];
  const clock = { v: 0 };
  const listeners = new Map();
  const target = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const source = inputSource({
    intent, bindings, onChange: (value) => emitted.push(value),
    deps: { now: () => clock.v, target, gamepads: () => [], hasTouch: () => false, ...extra },
  });
  return { source, emitted, clock, fire: (type, event) => listeners.get(type)?.(event) };
};

test("a key press and release emit twice, the second neutral", () => {
  const { emitted, fire } = harness();
  fire("keydown", { code: "ArrowLeft", preventDefault() {} });
  fire("keyup", { code: "ArrowLeft" });
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].turn, -1);
  assert.equal(emitted[1].turn, 0);
});

test("a held key emits once", () => {
  const { emitted, fire } = harness();
  for (let i = 0; i < 5; i++) fire("keydown", { code: "ArrowRight", repeat: i > 0, preventDefault() {} });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].turn, 1);
});

test("an unheld intent is re-sent once the resend interval elapses", () => {
  const { emitted, clock, source, fire } = harness();
  fire("keydown", { code: "ArrowLeft", preventDefault() {} });
  assert.equal(emitted.length, 1);
  source.poll();
  assert.equal(emitted.length, 1);
  clock.v += INPUT_RESEND_INTERVAL_MS;
  source.poll();
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted[1], emitted[0]);
});

test("blur releases everything and emits a neutral intent", () => {
  const { emitted, fire } = harness();
  fire("keydown", { code: "ArrowLeft", preventDefault() {} });
  fire("blur", {});
  assert.deepEqual(emitted.at(-1), { turn: 0, boost: 0 });
});

test("a touch control contributes and releases", () => {
  const { emitted, source } = harness();
  source.touch("turn", 1);
  assert.equal(emitted.at(-1).turn, 1);
  source.touch("turn", 0);
  assert.equal(emitted.at(-1).turn, 0);
});

test("a gamepad axis past the dead zone contributes, inside it does not", () => {
  let axis = 0.1;
  const { emitted, source } = harness({ gamepads: () => [{ axes: [axis], buttons: [] }] });
  source.poll();
  assert.equal(emitted.length, 0);
  axis = 0.9;
  source.poll();
  assert.equal(emitted.at(-1).turn, 1);
});

test("a gamepad button contributes", () => {
  const { emitted, source } = harness({ gamepads: () => [{ axes: [0], buttons: [{ pressed: true }] }] });
  source.poll();
  assert.equal(emitted.at(-1).boost, 1);
});

test("a gamepad that disappears falls back to the remaining sources", () => {
  let pads = [{ axes: [0.9], buttons: [] }];
  const { emitted, source } = harness({ gamepads: () => pads });
  source.poll();
  assert.equal(emitted.at(-1).turn, 1);
  pads = [];
  source.poll();
  assert.equal(emitted.at(-1).turn, 0);
});

test("a binding for an unknown field is refused by name", () => {
  assert.throws(
    () => inputSource({ intent, bindings: { nope: { keys: {} } }, deps: { target: null } }),
    /unknown intent field nope/,
  );
});

test("two bindings claiming one key are refused by name", () => {
  assert.throws(
    () => inputSource({
      intent, bindings: { turn: { keys: { KeyA: 1 } }, boost: { keys: { KeyA: 1 } } },
      deps: { target: null },
    }),
    /key KeyA is claimed/,
  );
});

test("a touch for an unknown field is refused by name", () => {
  const { source } = harness();
  assert.throws(() => source.touch("nope", 1), /unknown intent field nope/);
});

test("the source reports whether a device wants touch controls", () => {
  assert.equal(harness({ hasTouch: () => true }).source.wantsTouchControls(), true);
  assert.equal(harness({ hasTouch: () => false }).source.wantsTouchControls(), false);
});

test("the arena grows with the player count and snaps to a grid", () => {
  const two = arenaFor(2);
  const eight = arenaFor(8);
  assert.ok(eight.w > two.w && eight.h > two.h);
  for (const value of [two.w, two.h, eight.w, eight.h]) assert.equal(value % 4, 0);
});
