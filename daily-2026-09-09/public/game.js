// Host-only, fixed-tick push-your-luck simulation. No DOM, no network, no
// timers, no global randomness: it runs headless in Node.
export const TICK_HZ = 30;
export const TARGET = 60;
export const ROUND_TICKS = 900;
export const HEAT_MAX = 90;
export const BANK_TICKS = 24;
export const MAP = { baseW: 900, baseH: 500 };
export function mapSize(players, scale = 1) {
  return { w: Math.round(900 * Math.sqrt(scale)), h: Math.round((140 + Math.max(2, players) * 100) * Math.sqrt(scale)) };
}
export const EVENT = { none: 0, bank: 1, meltdown: 2, closing: 3 };

// The engine hands over intent objects; a bare number is the neutral seat.
const intentOf = (raw) => {
  const value = raw !== null && typeof raw === "object" ? raw.act : raw;
  return value === 1 ? 1 : value === -1 ? -1 : 0;
};

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts?.arena ?? mapSize(playerCount);
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.active = Array(playerCount).fill(true);
    this.rigs = [];
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.rigs = Array.from({ length: this.n }, () => ({ heat: 0, haul: 0, bank: 0, lock: 0, work: 0, mode: 0 }));
  }

  disconnect(pid) {
    this.active[pid] = false;
    const p = this.rigs[pid];
    if (p) { p.haul = 0; p.bank = 0; p.work = 0; p.mode = 0; }
  }

  step(inputs = []) {
    const ev = Array(this.n).fill(EVENT.none);
    const amt = Array(this.n).fill(0);
    if (!this.roundOver) {
      const rich = this.tick % 180 >= 120;
      for (let i = 0; i < this.n; i++) {
        const p = this.rigs[i];
        if (!this.active[i]) continue;
        const intent = intentOf(inputs[i]);
        p.mode = intent;
        if (p.lock > 0) {
          p.lock--;
          p.heat = Math.max(0, p.heat - 2);
          p.mode = 0;
          continue;
        }
        if (intent === 1) {
          p.bank = 0;
          p.heat += rich ? 2 : 1;
          if (p.heat >= HEAT_MAX) {
            ev[i] = EVENT.meltdown;
            amt[i] = p.haul;
            p.heat = HEAT_MAX;
            p.haul = p.work = 0;
            p.lock = 45;
            p.mode = 0;
          } else if (++p.work === 10) {
            p.haul += rich ? 3 : 1;
            p.work = 0;
          }
        } else {
          p.work = 0;
          p.heat = Math.max(0, p.heat - (intent === -1 ? 1 : 2));
          if (intent === -1 && p.haul > 0) {
            if (++p.bank === BANK_TICKS) {
              this.scores[i] += p.haul;
              ev[i] = EVENT.bank;
              amt[i] = p.haul;
              p.haul = p.bank = 0;
            }
          } else p.bank = 0;
        }
      }
      this.tick++;
      if (this.tick === ROUND_TICKS) {
        this.roundOver = true;
        this.rigs.forEach((p, i) => {
          if (p.haul) { ev[i] = EVENT.closing; amt[i] = p.haul; }
          p.haul = p.bank = p.work = 0;
          p.mode = 0;
        });
      }
    }
    const phase = this.tick % 180;
    return {
      k: this.tick,
      over: this.roundOver,
      rich: phase >= 120,
      vein: phase < 120 ? 120 - phase : 180 - phase,
      heat: this.rigs.map((p) => p.heat),
      haul: this.rigs.map((p) => p.haul),
      bank: this.rigs.map((p) => p.bank),
      lock: this.rigs.map((p) => p.lock),
      mode: this.rigs.map((p) => p.mode),
      active: this.rigs.map((_, i) => this.active[i]),
      score: [...this.scores],
      ev,
      amt,
    };
  }

  winner(target) {
    const best = Math.max(...this.scores.filter((_, i) => this.active[i]));
    if (best < target) return -1;
    const leaders = this.scores.map((s, i) => this.active[i] && s === best ? i : -1).filter(i => i >= 0);
    return leaders.length === 1 ? leaders[0] : -1;
  }
}

// One event per rig per tick at most, so events ride as two per-player fields.
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["heat"],
  fields: {
    k: { type: "uint", bits: 16 },
    over: { type: "bool" },
    rich: { type: "bool" },
    vein: { type: "uint", bits: 8 },
    heat: { type: "uint", bits: 8, per: "player" },
    haul: { type: "uint", bits: 16, per: "player" },
    bank: { type: "uint", bits: 8, per: "player" },
    lock: { type: "uint", bits: 8, per: "player" },
    mode: { type: "int", bits: 8, per: "player" },
    active: { type: "bool", per: "player" },
    score: { type: "uint", bits: 16, per: "player" },
    ev: { type: "uint", bits: 8, per: "player" },
    amt: { type: "uint", bits: 16, per: "player" },
  },
};

export const INTENT = { act: { min: -1, max: 1, neutral: 0 } };
