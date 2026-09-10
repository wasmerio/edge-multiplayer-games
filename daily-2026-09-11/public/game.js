// Only the host simulates. All positions are normalized within a delivery bay.
export const TICK_HZ = 30;
export const COLORS = ["#6cf2bc", "#8fb6ff", "#ffcf70", "#ed9bff", "#6ce3ee", "#ff9f9f", "#c3ed77", "#bca6ff"];
export const MAP = { baseW: 960, baseH: 640 };
export function mapSize(players, scale = 1) {
  const f = Math.sqrt(scale);
  return { w: Math.round(Math.max(720, players * 150) * f), h: Math.round(MAP.baseH * f) };
}
export const LANES = [0.18, 0.5, 0.82];
const rounded = (v) => Math.round(v * 1000) / 1000;

export class Game {
  constructor(playerCount, opts = mapSize(playerCount)) {
    this.n = playerCount;
    this.w = opts.w;
    this.h = opts.h;
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
    this.freeze = 45;
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
          const d = inputs[i] === -1 ? -1 : inputs[i] === 1 ? 1 : 0;
          c.x = Math.max(0.12, Math.min(0.88, c.x + d * 0.025));
          c.flash -= Math.sign(c.flash);
        }
        // Stop spawning early enough for the last delivery to reach the carts.
        if (this.tick % 30 === 1 && this.tick < 810) {
          const id = this.nextId++;
          this.parcels.push({ id, lane: Math.floor(Math.random() * 3), y: 0, type: id % 4 === 3 ? -1 : 1, mask: 0 });
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
        if (this.tick >= 900 || this.carts.every((c) => !c.active)) this.roundOver = true;
      }
    }
    return {
      t: "s", k: this.tick, f: this.freeze, left: Math.max(0, 900 - this.tick),
      p: this.carts.map((c, i) => [rounded(c.x), this.scores[i], c.active ? 1 : 0, c.flash]),
      b: this.parcels.map((b) => [b.id, b.lane, rounded(b.y), b.type, b.mask]),
      d: [...changed], over: this.roundOver,
    };
  }

  winner(target) {
    const eligible = this.scores.map((s, i) => this.disconnected.has(i) ? -1 : s);
    const best = Math.max(...eligible);
    return best >= target && eligible.filter((s) => s === best).length === 1 ? eligible.indexOf(best) : -1;
  }
}
