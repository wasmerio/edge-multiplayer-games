export const ARENA = { w: 640, h: 480 };
export const BAY = 240;
export const READY_TICKS = 60;
export const LIVE_TICKS = 1080;
export const SETTLE_TICKS = 10;
export const REBUILD_TICKS = 30;
export const PERFECT = 6;
export const MIN_OVERLAP = 12;
export const TARGET = 60;
export const speedFor = (height) => 3 + Math.min(20, height) * 0.16;
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
    this.p = [];
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = LIVE_TICKS;
    this.side = this.rng.pick([-1, 1]);
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.p = Array.from({ length: this.n }, (_, i) => {
      const cap = this.scores[i] < best ? 140 : 110;
      const p = { x: 0, centre: BAY / 2, width: cap, cap, dir: this.side, height: 0, points: 0, cd: 0, flash: 0, result: 0, held: false, floors: [] };
      this.foundation(p);
      return p;
    });
  }

  foundation(p) {
    p.centre = BAY / 2;
    p.width = p.cap;
    p.height = 0;
    p.floors = Array.from({ length: 6 }, (_, i) => ({ c: BAY / 2, w: i === 5 ? p.cap : 0 }));
    this.spawn(p);
  }

  spawn(p) {
    p.dir = this.side * (p.height % 2 === 0 ? 1 : -1);
    p.x = q(p.dir === 1 ? p.width / 2 : BAY - p.width / 2);
  }

  disconnect(index) { this.gone[index] = true; }

  step(intents) {
    this.tick++;
    const tapped = [], placed = [], perfect = [], missed = [];
    let beep = false, go = false, finished = false;
    if (!this.roundOver) {
      const counting = this.ready > 0;
      for (let i = 0; i < this.n; i++) {
        if (this.gone[i]) continue;
        const p = this.p[i];
        const pressed = (intents[i]?.drop || 0) > 0;
        const edge = pressed && !p.held;
        p.held = pressed;
        if (p.flash > 0) p.flash--;
        if (edge) tapped.push(i);
        if (counting || p.cd > 0) {
          if (p.cd > 0) p.cd--;
          if (edge) { p.result = 4; p.flash = 8; }
          continue;
        }
        if (edge) {
          const error = Math.abs(p.x - p.centre);
          const lo = Math.max(p.x - p.width / 2, p.centre - p.width / 2);
          const hi = Math.min(p.x + p.width / 2, p.centre + p.width / 2);
          if (error <= PERFECT) {
            p.width = Math.min(p.cap, p.width + 8);
            p.centre = q(Math.max(p.width / 2, Math.min(BAY - p.width / 2, p.centre)));
            p.result = 2;
            perfect.push(i);
          } else if (hi - lo >= MIN_OVERLAP) {
            p.centre = q((lo + hi) / 2);
            p.width = q(hi - lo);
            p.result = 1;
            placed.push(i);
          } else {
            this.foundation(p);
            p.cd = REBUILD_TICKS;
            p.result = 3;
            missed.push(i);
          }
          if (p.result !== 3) {
            const award = p.result === 2 ? 2 : 1;
            this.scores[i] += award;
            p.points += award;
            p.height++;
            p.floors.shift();
            p.floors.push({ c: p.centre, w: p.width });
            p.cd = SETTLE_TICKS;
            this.spawn(p);
          }
          p.flash = 24;
          continue;
        }
        p.x = q(p.x + p.dir * speedFor(p.height));
        const lo = p.width / 2, hi = BAY - p.width / 2;
        if (p.x < lo) { p.x = q(lo + (lo - p.x)); p.dir = 1; }
        if (p.x > hi) { p.x = q(hi - (p.x - hi)); p.dir = -1; }
      }
      if (counting) {
        beep = this.ready % 20 === 0;
        this.ready--;
        go = this.ready === 0;
      } else this.left--;
      if (this.left === 0 || this.gone.every(Boolean)) { this.roundOver = true; finished = true; }
    }
    const snap = {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      tapped, placed, perfect, missed, beep, go, finished,
      active: this.gone.map((gone) => !gone),
    };
    for (const name of ["x", "centre", "width", "cap", "dir", "height", "points", "cd", "flash", "result"]) {
      snap[name] = this.p.map((p) => p[name]);
    }
    for (let j = 0; j < 6; j++) {
      snap[`c${j}`] = this.p.map((p) => q(p.floors[j].c));
      snap[`w${j}`] = this.p.map((p) => q(p.floors[j].w));
    }
    return snap;
  }

  winner(target) {
    let best = -1, seat = -1, tied = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; tied = false; }
      else if (this.scores[i] === best) tied = true;
    }
    return best >= target && !tied ? seat : -1;
  }
}

const position = { type: "fixed", scale: 10, bits: 16, per: "player" };
const byte = { type: "uint", bits: 8, per: "player" };
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    x: position, centre: position, width: position, cap: byte,
    dir: { type: "int", bits: 8, per: "player" },
    height: { type: "uint", bits: 16, per: "player" },
    points: { type: "uint", bits: 16, per: "player" },
    cd: byte, flash: byte, result: byte,
    active: { type: "bool", per: "player" },
    c0: position, c1: position, c2: position, c3: position, c4: position, c5: position,
    w0: position, w1: position, w2: position, w3: position, w4: position, w5: position,
    tapped: { type: "players" }, placed: { type: "players" }, perfect: { type: "players" }, missed: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};

export const INTENT = { drop: { values: [0, 1], neutral: 0 } };
