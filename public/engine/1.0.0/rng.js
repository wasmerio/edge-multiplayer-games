// Deterministic, serialisable generator. A simulation receives one and never
// reads the global source, so a seed plus an input log replays exactly.
const UINT32 = 0x100000000;

export function seededRng(seed) {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new Error("seededRng: seed must be a finite number");
  }
  let s = Math.abs(Math.trunc(seed)) % UINT32;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (array) => {
      if (!Array.isArray(array) || array.length === 0) {
        throw new Error("seededRng.pick: expected a non-empty array");
      }
      return array[Math.floor(next() * array.length)];
    },
    state: () => s,
    restore: (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("seededRng.restore: state must be a finite number");
      }
      s = value >>> 0;
    },
  };
}
