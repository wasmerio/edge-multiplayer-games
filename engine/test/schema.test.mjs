import { test } from "node:test";
import assert from "node:assert/strict";
import { defineSnapshot } from "../schema.js";
import { MAX_PLAYERS_PER_ROOM } from "../params.js";

const spec = {
  interpolate: ["x", "y"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    alive: { type: "bool", per: "player" },
    heat: { type: "int", bits: 8, per: "player" },
    d: { type: "players" },
  },
};
const schema = defineSnapshot(spec);
const sample = (k = 1) => ({
  k, over: false,
  x: [12.3, 400.1], y: [5.5, 6.2],
  alive: [true, false], heat: [-5, 20], d: [1],
});

test("every field type round-trips inside its declared quantisation", () => {
  const snap = sample(7);
  const back = schema.decode(schema.encode(snap, 2), 2);
  assert.equal(back.k, 7);
  assert.equal(back.over, false);
  assert.deepEqual(back.alive, [true, false]);
  assert.deepEqual(back.heat, [-5, 20]);
  assert.deepEqual(back.d, [1]);
  for (const field of ["x", "y"]) {
    back[field].forEach((value, i) => assert.ok(Math.abs(value - snap[field][i]) <= 1 / 20));
  }
});

test("a full snapshot stays inside its budget at the player cap", () => {
  const players = MAX_PLAYERS_PER_ROOM;
  const snap = {
    k: 1, over: true,
    x: new Array(players).fill(100.5), y: new Array(players).fill(200.25),
    alive: new Array(players).fill(true), heat: new Array(players).fill(1),
    d: [0, 1],
  };
  const bytes = schema.encode(snap, players).byteLength;
  assert.ok(bytes <= schema.budgetBytes * players, `${bytes} bytes`);
});

test("a delta of an unchanged scene is smaller than the full encoding", () => {
  const previous = sample(1);
  const next = { ...previous, k: 2 };
  const result = schema.delta(previous, next, 2);
  assert.equal(result.full, false);
  assert.ok(result.buffer.byteLength < schema.byteLength(2));
});

test("a delta applied to its previous snapshot reconstructs the next one", () => {
  const previous = schema.decode(schema.encode(sample(1), 2), 2);
  const next = { ...previous, k: 2, x: [12.4, 400.1] };
  const result = schema.delta(previous, next, 2);
  assert.deepEqual(schema.apply(previous, result.buffer, 2), next);
});

test("a change to every field falls back to a full encoding", () => {
  const previous = sample(1);
  const next = { k: 9, over: true, x: [1, 2], y: [3, 4], alive: [false, true], heat: [0, 0], d: [] };
  assert.equal(schema.delta(previous, next, 2).full, true);
});

test("no previous snapshot yields a full encoding", () => {
  assert.equal(schema.delta(null, sample(1), 2).full, true);
});

test("the schema hash is stable and sensitive to its shape", () => {
  assert.equal(defineSnapshot(spec).hash, schema.hash);
  const changed = defineSnapshot({ ...spec, fields: { ...spec.fields, k: { type: "uint", bits: 16 } } });
  assert.notEqual(changed.hash, schema.hash);
});

test("encoding is byte-stable across runs", () => {
  const a = new Uint8Array(schema.encode(sample(3), 2));
  const b = new Uint8Array(schema.encode(sample(3), 2));
  assert.deepEqual([...a], [...b]);
});

test("an unknown field type is rejected by name", () => {
  assert.throws(() => defineSnapshot({ fields: { q: { type: "blob" } } }), /field q has unknown type/);
});

test("an unsupported width is rejected by name", () => {
  assert.throws(() => defineSnapshot({ fields: { q: { type: "uint", bits: 24 } } }), /field q has unsupported width/);
});

test("a fixed field without a positive scale is rejected", () => {
  assert.throws(() => defineSnapshot({ fields: { q: { type: "fixed", scale: 0 } } }), /field q needs a positive scale/);
});

test("an empty field set is rejected", () => {
  assert.throws(() => defineSnapshot({ fields: {} }), /at least one field/);
});

test("interpolating a discrete field is rejected", () => {
  assert.throws(
    () => defineSnapshot({ fields: { ok: { type: "bool" } }, interpolate: ["ok"] }),
    /field ok is discrete/,
  );
  assert.throws(
    () => defineSnapshot({ fields: { ok: { type: "bool" } }, interpolate: ["nope"] }),
    /unknown field nope/,
  );
});

test("a value outside its range names the field and the value", () => {
  assert.throws(() => schema.encode({ ...sample(1), x: [9999, 0] }, 2), /field x value 9999 is outside its 16-bit range/);
  assert.throws(() => schema.encode({ ...sample(1), heat: [999, 0] }, 2), /field heat value 999/);
});

test("a non-finite value is rejected by field name", () => {
  assert.throws(() => schema.encode({ ...sample(1), x: [Number.NaN, 0] }, 2), /field x got NaN/);
});

test("an event list above the player cap is rejected", () => {
  const tooMany = new Array(MAX_PLAYERS_PER_ROOM + 1).fill(0);
  assert.throws(() => schema.encode({ ...sample(1), d: tooMany }, 2), /above the player cap/);
});

test("a truncated buffer is rejected rather than partly decoded", () => {
  const buffer = schema.encode(sample(1), 2);
  assert.throws(() => schema.decode(buffer.slice(0, buffer.byteLength - 2), 2), /expected/);
});

test("a delta applied to a mismatched previous snapshot is rejected", () => {
  const previous = sample(1);
  const result = schema.delta(previous, { ...previous, k: 2 }, 2);
  assert.throws(() => schema.apply(previous, result.buffer, MAX_PLAYERS_PER_ROOM), /does not match/);
});

test("apply without a previous snapshot is rejected", () => {
  const result = schema.delta(sample(1), sample(2), 2);
  assert.throws(() => schema.apply(null, result.buffer, 2), /needs a previous snapshot/);
});

test("a per-player event list field is rejected", () => {
  assert.throws(
    () => defineSnapshot({ fields: { d: { type: "players", per: "player" } } }),
    /cannot be per player/,
  );
});

test("a fixed-count field round-trips at any player count", () => {
  const slots = defineSnapshot({
    interpolate: ["y"],
    fields: {
      k: { type: "uint", bits: 16 },
      y: { type: "fixed", scale: 1000, bits: 16, signed: false, count: 3 },
      kind: { type: "int", bits: 8, count: 3 },
      live: { type: "bool", count: 3 },
      x: { type: "uint", bits: 8, per: "player" },
    },
  });
  for (const players of [1, MAX_PLAYERS_PER_ROOM]) {
    const snap = { k: 9, y: [0.012, 0.5, 1.04], kind: [1, -1, 0], live: [true, false, true], x: new Array(players).fill(7) };
    assert.equal(slots.byteLength(players), 2 + 6 + 3 + 1 + players);
    assert.deepEqual(slots.decode(slots.encode(snap, players), players), snap);
    const next = { ...snap, k: 10, kind: [1, 1, 0] };
    const delta = slots.delta(snap, next, players);
    assert.equal(delta.full, false);
    assert.deepEqual(slots.apply(snap, delta.buffer, players), next);
  }
});

test("a count changes the schema hash", () => {
  const plain = { k: { type: "uint", bits: 16 }, y: { type: "uint", bits: 8 } };
  const counted = { ...plain, y: { ...plain.y, count: 2 } };
  assert.notEqual(defineSnapshot({ fields: counted }).hash, defineSnapshot({ fields: plain }).hash);
});

test("a count that is not a small positive integer, or is per player, is rejected", () => {
  assert.throws(() => defineSnapshot({ fields: { y: { type: "uint", bits: 8, count: 0 } } }), /count between/);
  assert.throws(() => defineSnapshot({ fields: { y: { type: "uint", bits: 8, count: 1.5 } } }), /count between/);
  assert.throws(() => defineSnapshot({ fields: { y: { type: "uint", bits: 8, count: 2, per: "player" } } }), /cannot combine count/);
  assert.throws(() => defineSnapshot({ fields: { y: { type: "players", count: 2 } } }), /cannot combine count/);
});
