// Only the host simulates. All positions are normalized within a delivery bay.
// No DOM, no network, no timers, no global randomness: it runs headless in Node.
export const TICK_HZ = 30;
export const TARGET = 20;
export const ROUND_TICKS = 900;
export const FREEZE_TICKS = 45;
export const SLOTS = 3;
export const MAP = { baseW: 960, baseH: 640 };
export function mapSize(players, scale = 1) {
  const f = Math.sqrt(scale);
  return { w: Math.round(Math.max(720, players * 150) * f), h: Math.round(MAP.baseH * f) };
}
export const LANES = [0.18, 0.5, 0.82];
const rounded = (v) => Math.round(v * 1000) / 1000;

// The engine hands over intent objects; a bare number is the neutral seat.
const intentOf = (raw) => {
  const value = raw !== null && typeof raw === "object" ? raw.move : raw;
  return value === -1 ? -1 : value === 1 ? 1 : 0;
};

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts?.arena ?? mapSize(playerCount);
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    this.round = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.disconnected = new Set();
    this.carts = [];
    this.parcels = [];
    this.tick = 0;
    this.freeze = 0;
  }

  startRound() {
    this.round++;
    this.roundOver = false;
    this.tick = 0;
    this.freeze = FREEZE_TICKS;
    this.nextId = 0;
    this.parcels = [];
    this.carts = Array.from({ length: this.n }, (_, i) => ({ x: 0.5, active: !this.disconnected.has(i), flash: 0 }));
  }

  disconnect(pid) {
    this.disconnected.add(pid);
    if (this.carts[pid]) this.carts[pid].active = false;
  }

  step(inputs = []) {
    const changed = new Set();
    if (!this.roundOver) {
      if (this.freeze > 0) this.freeze--;
      else {
        this.tick++;
        for (let i = 0; i < this.n; i++) {
          const c = this.carts[i];
          if (!c.active) continue;
          const d = intentOf(inputs[i]);
          c.x = Math.max(0.12, Math.min(0.88, c.x + d * 0.025));
          c.flash -= Math.sign(c.flash);
        }
        // Stop spawning early enough for the last delivery to reach the carts.
        if (this.tick % 30 === 1 && this.tick < 810) {
          const id = this.nextId++;
          this.parcels.push({ id, lane: this.rng.int(0, 2), y: 0, type: id % 4 === 3 ? -1 : 1, mask: 0 });
        }
        for (const b of this.parcels) {
          b.y += 0.012;
          if (b.y < 0.88) continue;
          for (let i = 0; i < this.n; i++) {
            const bit = 1 << i;
            if (b.mask & bit) continue;
            b.mask |= bit;
            const c = this.carts[i];
            if (!c.active || Math.abs(c.x - LANES[b.lane]) > 0.13) continue;
            const old = this.scores[i];
            this.scores[i] = Math.max(0, old + (b.type === 1 ? 1 : -2));
            c.flash = b.type * 12;
            if (old !== this.scores[i]) changed.add(i);
          }
        }
        this.parcels = this.parcels.filter((b) => b.y < 1.04);
        if (this.tick >= ROUND_TICKS || this.carts.every((c) => !c.active)) this.roundOver = true;
      }
    }
    // A parcel keeps the slot id % SLOTS for its whole fall; at most SLOTS are live.
    const bl = Array(SLOTS).fill(0);
    const by = Array(SLOTS).fill(0);
    const bt = Array(SLOTS).fill(0);
    const bm = Array(SLOTS).fill(0);
    for (const b of this.parcels) {
      const slot = b.id % SLOTS;
      bl[slot] = b.lane;
      by[slot] = rounded(b.y);
      bt[slot] = b.type;
      bm[slot] = b.mask;
    }
    return {
      k: FREEZE_TICKS - this.freeze + this.tick,
      f: this.freeze,
      left: Math.max(0, ROUND_TICKS - this.tick),
      over: this.roundOver,
      x: this.carts.map((c) => rounded(c.x)),
      score: [...this.scores],
      active: this.carts.map((c) => c.active),
      flash: this.carts.map((c) => c.flash),
      bl, by, bt, bm,
      d: [...changed],
    };
  }

  winner(target) {
    const eligible = this.scores.map((s, i) => this.disconnected.has(i) ? -1 : s);
    const best = Math.max(...eligible);
    return best >= target && eligible.filter((s) => s === best).length === 1 ? eligible.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x", "by"],
  fields: {
    k: { type: "uint", bits: 16 },
    f: { type: "uint", bits: 8 },
    left: { type: "uint", bits: 16 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 1000, bits: 16, signed: false, per: "player" },
    score: { type: "uint", bits: 16, per: "player" },
    active: { type: "bool", per: "player" },
    flash: { type: "int", bits: 8, per: "player" },
    bl: { type: "uint", bits: 8, count: SLOTS },
    by: { type: "fixed", scale: 1000, bits: 16, signed: false, count: SLOTS },
    bt: { type: "int", bits: 8, count: SLOTS },
    bm: { type: "uint", bits: 8, count: SLOTS },
    d: { type: "players" },
  },
};

export const INTENT = { move: { min: -1, max: 1, neutral: 0 } };
