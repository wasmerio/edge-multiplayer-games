// Cloud Mason: each placement becomes the geometry of the next target.
export const ARENA = { w: 640, h: 520 };
export const READY_TICKS = 60;
export const BUILD_TICKS = 1080;
export const SET_TICKS = 12;
export const REBUILD_TICKS = 24;
export const MAX_WIDTH = 160;
export const MIN_WIDTH = 24;
export const PERFECT = 8;
export const REPAIR = 12;
export const TARGET = 70;
export const speedFor = (height) => 4 + Math.min(2, height * 0.12);
const q = (v) => Math.round(v * 10) / 10;

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.rng = rng;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.ready = 0;
    this.left = 0;
    this.p = Array.from({ length: playerCount }, () => this.mason(136, 1));
  }

  mason(width, dir) {
    const x = q((this.w - width) / 2);
    return {
      x: Array(5).fill(x), widths: [width, 0, 0, 0, 0],
      bx: dir > 0 ? q(this.w * 0.08) : q(this.w * 0.92 - width), dir,
      height: 0, earned: 0, cd: 0, flash: 0, mark: 0, held: false,
    };
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = BUILD_TICKS;
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    const dir = this.rng.int(0, 1) ? 1 : -1;
    this.p = this.p.map((_, i) => this.mason(136 + Math.min(24, Math.max(0, best - this.scores[i]) * 2), dir));
  }

  disconnect(index) { this.gone[index] = true; }

  launch(p) {
    p.dir *= -1;
    p.bx = p.dir > 0 ? q(this.w * 0.08) : q(this.w * 0.92 - p.widths[0]);
  }

  step(intents) {
    this.tick += 1;
    const events = { tapped: [], placed: [], perfect: [], missed: [], denied: [], bonus: [], beep: false, go: false, finished: false };
    if (!this.roundOver) {
      if (this.gone.every(Boolean)) {
        this.roundOver = true;
        events.finished = true;
      } else {
        const waiting = this.ready > 0;
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const p = this.p[i];
          const down = (intents[i]?.place || 0) > 0;
          const press = down && !p.held;
          p.held = down;
          if (p.flash > 0) p.flash -= 1;
          if (press) events.tapped.push(i);
          if (waiting) continue;
          if (p.cd > 0) {
            p.cd -= 1;
            if (press) { events.denied.push(i); p.mark = 4; p.flash = 12; }
            continue;
          }
          if (press) {
            const width = p.widths[0];
            const left = Math.max(p.bx, p.x[0]);
            const overlap = q(Math.min(p.bx + width, p.x[0] + width) - left);
            const perfect = Math.abs(p.bx - p.x[0]) <= PERFECT;
            if (overlap < MIN_WIDTH) {
              const loss = Math.min(2, p.earned);
              this.scores[i] -= loss;
              p.earned -= loss;
              p.height = 0;
              p.x.fill(q((this.w - MAX_WIDTH) / 2));
              p.widths = [MAX_WIDTH, 0, 0, 0, 0];
              p.cd = REBUILD_TICKS;
              p.mark = 3;
              events.missed.push(i);
            } else {
              const nextWidth = perfect ? Math.min(MAX_WIDTH, width + REPAIR) : overlap;
              const nextX = perfect ? q(p.x[0] - (nextWidth - width) / 2) : q(left);
              p.x = [nextX, ...p.x.slice(0, 4)];
              p.widths = [nextWidth, ...p.widths.slice(0, 4)];
              p.height += 1;
              const points = perfect ? 3 : 2;
              this.scores[i] += points;
              p.earned += points;
              p.cd = SET_TICKS;
              p.mark = perfect ? 2 : 1;
              events.placed.push(i);
              if (perfect) events.perfect.push(i);
            }
            p.flash = 24;
            this.launch(p);
          } else {
            const lo = q(this.w * 0.08);
            const hi = q(this.w * 0.92 - p.widths[0]);
            p.bx = q(p.bx + p.dir * speedFor(p.height));
            if (p.bx < lo) { p.bx = q(lo + (lo - p.bx)); p.dir = 1; }
            if (p.bx > hi) { p.bx = q(hi - (p.bx - hi)); p.dir = -1; }
          }
        }
        if (waiting) {
          events.beep = this.ready % 20 === 0;
          this.ready -= 1;
          events.go = this.ready === 0;
        } else {
          this.left -= 1;
          if (this.left === 0) {
            const best = Math.max(0, ...this.p.map((p, i) => this.gone[i] ? 0 : p.height));
            for (let i = 0; i < this.n; i++) {
              if (!this.gone[i] && best > 0 && this.p[i].height === best) {
                this.scores[i] += 5;
                this.p[i].earned += 5;
                events.bonus.push(i);
              }
            }
            this.roundOver = true;
            events.finished = true;
          }
        }
      }
    }
    const snap = {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      bx: this.p.map((p) => q(p.bx)), dir: this.p.map((p) => p.dir),
      height: this.p.map((p) => p.height), earned: this.p.map((p) => p.earned),
      cd: this.p.map((p) => p.cd), flash: this.p.map((p) => p.flash), mark: this.p.map((p) => p.mark),
      active: this.gone.map((gone) => !gone), ...events,
    };
    for (let j = 0; j < 5; j++) {
      snap[`x${j}`] = this.p.map((p) => q(p.x[j]));
      snap[`w${j}`] = this.p.map((p) => q(p.widths[j]));
    }
    return snap;
  }

  winner(target) {
    let seat = -1;
    let best = -1;
    let tied = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; tied = false; }
      else if (this.scores[i] === best) tied = true;
    }
    return best >= target && !tied ? seat : -1;
  }
}

const position = { type: "fixed", scale: 10, bits: 16, per: "player" };
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["bx"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    bx: { ...position }, dir: { type: "int", bits: 8, per: "player" },
    x0: { ...position }, x1: { ...position }, x2: { ...position }, x3: { ...position }, x4: { ...position },
    w0: { ...position }, w1: { ...position }, w2: { ...position }, w3: { ...position }, w4: { ...position },
    height: { type: "uint", bits: 16, per: "player" }, earned: { type: "uint", bits: 16, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" }, flash: { type: "uint", bits: 8, per: "player" },
    mark: { type: "uint", bits: 8, per: "player" }, active: { type: "bool", per: "player" },
    tapped: { type: "players" }, placed: { type: "players" }, perfect: { type: "players" },
    missed: { type: "players" }, denied: { type: "players" }, bonus: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = { place: { values: [0, 1], neutral: 0 } };
