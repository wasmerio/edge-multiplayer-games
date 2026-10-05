// A snapshot is declared once and the codec is derived from the declaration,
// so a game never hand-rolls a wire format and never drifts from its guests.
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "./params.js";

const WIDTHS = { 8: 1, 16: 2, 32: 4 };

const INT_RANGE = (bits, signed) =>
  signed ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1];

function normalise(name, field) {
  const shaped = shapeOf(name, field);
  if (field.count === undefined) return shaped;
  // A fixed-length list whose size does not follow the player count.
  if (!Number.isInteger(field.count) || field.count < 1 || field.count > 255) {
    throw new Error(`schema: field ${name} needs a count between 1 and 255`);
  }
  if (shaped.per === "player" || shaped.kind === "players") {
    throw new Error(`schema: field ${name} cannot combine count with a per-player shape`);
  }
  return { ...shaped, per: "count", count: field.count };
}

function shapeOf(name, field) {
  const per = field.per === "player" ? "player" : "scalar";
  switch (field.type) {
    case "uint":
    case "int": {
      const bits = field.bits ?? 32;
      if (!WIDTHS[bits]) throw new Error(`schema: field ${name} has unsupported width ${bits}`);
      return { name, kind: field.type, per, bits, signed: field.type === "int", scale: 1 };
    }
    case "fixed": {
      const bits = field.bits ?? 16;
      if (!WIDTHS[bits]) throw new Error(`schema: field ${name} has unsupported width ${bits}`);
      if (!Number.isFinite(field.scale) || field.scale <= 0) {
        throw new Error(`schema: field ${name} needs a positive scale`);
      }
      return { name, kind: "fixed", per, bits, signed: field.signed !== false, scale: field.scale };
    }
    case "bool":
      return { name, kind: "bool", per, bits: 8, signed: false, scale: 1 };
    case "players":
      if (per === "player") throw new Error(`schema: field ${name} cannot be per player`);
      return { name, kind: "players", per: "scalar", bits: 8, signed: false, scale: 1 };
    default:
      throw new Error(`schema: field ${name} has unknown type ${JSON.stringify(field.type)}`);
  }
}

const fnv1a = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

export function defineSnapshot(spec) {
  const entries = Object.entries(spec.fields || {});
  if (entries.length === 0) throw new Error("schema: declare at least one field");
  const fields = entries.map(([name, field]) => normalise(name, field));
  const budgetBytes = spec.budgetBytes ?? SNAPSHOT_BUDGET_BYTES;
  const interpolate = new Set(spec.interpolate || []);
  for (const name of interpolate) {
    const field = fields.find((f) => f.name === name);
    if (!field) throw new Error(`schema: interpolate names unknown field ${name}`);
    if (field.kind === "bool" || field.kind === "players") {
      throw new Error(`schema: field ${name} is discrete and cannot interpolate`);
    }
  }
  const tickField = spec.tickField ?? "k";
  if (!fields.some((f) => f.name === tickField)) {
    throw new Error(`schema: tickField ${tickField} is not a declared field`);
  }
  const hash = fnv1a(JSON.stringify(fields.map((f) => [f.name, f.kind, f.per, f.bits, f.signed, f.scale, ...(f.count ? [f.count] : [])])));
  const maskBytes = Math.ceil(fields.length / 8);

  const lengthOf = (field, players) => (field.per === "player" ? players : field.per === "count" ? field.count : 1);
  const sizeOf = (field, players) => {
    if (field.kind === "players") return 1 + MAX_PLAYERS_PER_ROOM;
    if (field.kind === "bool") return field.per === "scalar" ? 1 : Math.ceil(lengthOf(field, players) / 8);
    return WIDTHS[field.bits] * lengthOf(field, players);
  };
  const byteLength = (players) => fields.reduce((sum, f) => sum + sizeOf(f, players), 0);

  const writeNumber = (view, offset, field, value) => {
    if (!Number.isFinite(value)) throw new Error(`schema: field ${field.name} got ${value}`);
    const raw = Math.round(value * field.scale);
    const [lo, hi] = INT_RANGE(field.bits, field.signed);
    if (raw < lo || raw > hi) {
      throw new Error(`schema: field ${field.name} value ${value} is outside its ${field.bits}-bit range`);
    }
    if (field.bits === 8) field.signed ? view.setInt8(offset, raw) : view.setUint8(offset, raw);
    else if (field.bits === 16) field.signed ? view.setInt16(offset, raw, true) : view.setUint16(offset, raw, true);
    else field.signed ? view.setInt32(offset, raw, true) : view.setUint32(offset, raw, true);
    return WIDTHS[field.bits];
  };

  const readNumber = (view, offset, field) => {
    let raw;
    if (field.bits === 8) raw = field.signed ? view.getInt8(offset) : view.getUint8(offset);
    else if (field.bits === 16) raw = field.signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
    else raw = field.signed ? view.getInt32(offset, true) : view.getUint32(offset, true);
    return field.scale === 1 ? raw : raw / field.scale;
  };

  const writeField = (view, offset, field, value, players) => {
    if (field.kind === "players") {
      const list = value || [];
      if (list.length > MAX_PLAYERS_PER_ROOM) {
        throw new Error(`schema: field ${field.name} holds ${list.length} entries, above the player cap`);
      }
      view.setUint8(offset, list.length);
      for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) view.setUint8(offset + 1 + i, i < list.length ? list[i] : 0);
      return 1 + MAX_PLAYERS_PER_ROOM;
    }
    if (field.kind === "bool") {
      if (field.per === "scalar") { view.setUint8(offset, value ? 1 : 0); return 1; }
      const length = lengthOf(field, players);
      const bytes = Math.ceil(length / 8);
      for (let b = 0; b < bytes; b++) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit++) {
          const index = b * 8 + bit;
          if (index < length && value[index]) packed |= 1 << bit;
        }
        view.setUint8(offset + b, packed);
      }
      return bytes;
    }
    if (field.per === "scalar") return writeNumber(view, offset, field, value);
    let written = 0;
    const length = lengthOf(field, players);
    for (let i = 0; i < length; i++) written += writeNumber(view, offset + written, field, value[i]);
    return written;
  };

  const readField = (view, offset, field, players) => {
    if (field.kind === "players") {
      const count = view.getUint8(offset);
      const list = [];
      for (let i = 0; i < count; i++) list.push(view.getUint8(offset + 1 + i));
      return [list, 1 + MAX_PLAYERS_PER_ROOM];
    }
    if (field.kind === "bool") {
      if (field.per === "scalar") return [view.getUint8(offset) === 1, 1];
      const length = lengthOf(field, players);
      const bytes = Math.ceil(length / 8);
      const list = [];
      for (let i = 0; i < length; i++) {
        list.push(((view.getUint8(offset + (i >> 3)) >> (i & 7)) & 1) === 1);
      }
      return [list, bytes];
    }
    if (field.per === "scalar") return [readNumber(view, offset, field), WIDTHS[field.bits]];
    const list = [];
    const length = lengthOf(field, players);
    for (let i = 0; i < length; i++) list.push(readNumber(view, offset + i * WIDTHS[field.bits], field));
    return [list, WIDTHS[field.bits] * length];
  };

  const checkBudget = (bytes, players) => {
    const allowance = budgetBytes * Math.max(1, players);
    if (bytes > allowance) {
      throw new Error(`schema: encoded ${bytes} bytes for ${players} players, above SNAPSHOT_BUDGET_BYTES`);
    }
  };

  const encode = (snapshot, players) => {
    const buffer = new ArrayBuffer(byteLength(players));
    const view = new DataView(buffer);
    let offset = 0;
    for (const field of fields) offset += writeField(view, offset, field, snapshot[field.name], players);
    checkBudget(buffer.byteLength, players);
    return buffer;
  };

  const decode = (buffer, players) => {
    const expected = byteLength(players);
    if (buffer.byteLength !== expected) {
      throw new Error(`schema: decode got ${buffer.byteLength} bytes, expected ${expected}`);
    }
    const view = new DataView(buffer);
    const out = {};
    let offset = 0;
    for (const field of fields) {
      const [value, used] = readField(view, offset, field, players);
      out[field.name] = value;
      offset += used;
    }
    return out;
  };

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const delta = (previous, next, players) => {
    if (!previous) return { full: true, buffer: encode(next, players) };
    const changed = fields.map((field) => !same(previous[field.name], next[field.name]));
    // One leading byte carries the player count, so a delta applied against a
    // snapshot of a different width is rejected instead of silently misread.
    const size = 1 + maskBytes + fields.reduce((sum, f, i) => sum + (changed[i] ? sizeOf(f, players) : 0), 0);
    if (size >= byteLength(players)) return { full: true, buffer: encode(next, players) };
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    view.setUint8(0, players);
    for (let i = 0; i < fields.length; i++) {
      if (changed[i]) {
        const byte = view.getUint8(1 + (i >> 3));
        view.setUint8(1 + (i >> 3), byte | (1 << (i & 7)));
      }
    }
    let offset = 1 + maskBytes;
    for (let i = 0; i < fields.length; i++) {
      if (changed[i]) offset += writeField(view, offset, fields[i], next[fields[i].name], players);
    }
    return { full: false, buffer };
  };

  const apply = (previous, buffer, players) => {
    if (!previous) throw new Error("schema: apply needs a previous snapshot");
    const view = new DataView(buffer);
    const declared = view.getUint8(0);
    if (declared !== players) {
      throw new Error(`schema: apply got a delta for ${declared} players, asked for ${players}; previous snapshot does not match`);
    }
    const out = { ...previous };
    let offset = 1 + maskBytes;
    for (let i = 0; i < fields.length; i++) {
      const present = ((view.getUint8(1 + (i >> 3)) >> (i & 7)) & 1) === 1;
      if (!present) continue;
      const [value, used] = readField(view, offset, fields[i], players);
      out[fields[i].name] = value;
      offset += used;
    }
    if (offset !== buffer.byteLength) {
      throw new Error(`schema: apply consumed ${offset} of ${buffer.byteLength} bytes; previous snapshot does not match`);
    }
    return out;
  };

  return {
    hash, fields, budgetBytes, byteLength, encode, decode, delta, apply, tickField,
    isInterpolated: (name) => interpolate.has(name),
    interpolatedFields: () => fields.filter((f) => interpolate.has(f.name)).map((f) => f.name),
    // `wrap: 360` on a field makes interpolation take the short way round.
    wrapOf: (name) => spec.fields[name]?.wrap ?? null,
  };
}
