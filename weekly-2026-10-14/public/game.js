export const ARENA = { w: 640, h: 480 };
export const READY_TICKS = 60;
export const BUILD_TICKS = 900;
export const DROP_PAUSE = 18;
export const REPAIR_TICKS = 36;
export const HISTORY = 6;
export const TARGET = 45;
const q = (v) => Math.round(v * 10) / 10;
export const slabSpeed = (height, scale = 1) => (3 + height * 0.28) * scale;

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.rng = rng;
    this.bay = opts.arena.w / 2;
    this.scale = this.bay / 320;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.ready = 0;
    this.left = 0;
    this.p = Array.from({ length: playerCount }, () => this.newTower(140 * this.scale, 1));
  }

  newTower(base, dir) {
    return { base: q(base), width: q(base), x: q(dir > 0 ? base / 2 : this.bay - base / 2), dir,
      height: 0, best: 0, cd: 0, flash: 0, result: 0, award: 0, held: false,
      cx: Array(HISTORY).fill(0), cw: Array(HISTORY).fill(0) };
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = BUILD_TICKS;
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    const dir = this.rng.pick([-1, 1]);
    this.p = this.p.map((_, i) => this.newTower((140 + Math.min(30, Math.max(0, best - this.scores[i]) * 2)) * this.scale, dir));
  }

  disconnect(index) { this.gone[index] = true; }

  step(intents) {
    this.tick += 1;
    const ev = { dropped: [], landed: [], perfect: [], fell: [], awarded: [], beep: false, go: false, finished: false };
    if (!this.roundOver) {
      const waiting = this.ready > 0;
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i];
        if (this.gone[i]) continue;
        const pressed = intents[i]?.drop === 1;
        const edge = pressed && !p.held;
        p.held = pressed;
        if (p.flash > 0) p.flash -= 1;
        if (waiting) continue;
        if (p.cd > 0) { p.cd -= 1; continue; }
        if (edge) {
          ev.dropped.push(i);
          const top = p.height ? p.cx[(p.height - 1) % HISTORY] : this.bay / 2;
          const near = Math.abs(p.x - top) <= 7 * this.scale;
          const lo = Math.max(top - p.width / 2, p.x - p.width / 2);
          const hi = Math.min(top + p.width / 2, p.x + p.width / 2);
          if (!near && hi - lo < 16 * this.scale) {
            p.height = 0;
            p.width = p.base;
            p.cx.fill(0);
            p.cw.fill(0);
            p.cd = REPAIR_TICKS;
            p.result = 3;
            ev.fell.push(i);
          } else {
            const slot = p.height % HISTORY;
            p.width = q(near ? Math.min(p.base, p.width + 8 * this.scale) : hi - lo);
            p.cx[slot] = q(near ? top : (lo + hi) / 2);
            p.cw[slot] = p.width;
            p.height += 1;
            p.best = Math.max(p.best, p.height);
            p.cd = DROP_PAUSE;
            p.result = near ? 2 : 1;
            ev.landed.push(i);
            if (near) ev.perfect.push(i);
          }
          p.flash = 24;
          p.dir *= -1;
          p.x = q(p.dir > 0 ? p.width / 2 : this.bay - p.width / 2);
        } else {
          p.x = q(p.x + p.dir * slabSpeed(p.height, this.scale));
          const lo = p.width / 2, hi = this.bay - p.width / 2;
          if (p.x < lo) { p.x = q(lo + (lo - p.x)); p.dir = 1; }
          if (p.x > hi) { p.x = q(hi - (p.x - hi)); p.dir = -1; }
        }
      }
      if (waiting) {
        ev.beep = this.ready % 30 === 0;
        this.ready -= 1;
        ev.go = this.ready === 0;
      } else this.left -= 1;
      if (this.left === 0 || this.gone.every(Boolean)) {
        this.roundOver = true;
        ev.finished = true;
        const best = Math.max(0, ...this.p.map((p, i) => this.gone[i] ? 0 : p.best));
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const p = this.p[i];
          p.award = p.best + (p.best > 0 && p.best === best ? 3 : 0);
          this.scores[i] += p.award;
          if (p.award > 0) ev.awarded.push(i);
        }
      }
    }
    const snap = { k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      active: this.gone.map((g) => !g), ...ev };
    for (const key of ["x", "width", "base", "dir", "height", "best", "cd", "flash", "result", "award"]) snap[key] = this.p.map((p) => p[key]);
    for (let j = 0; j < HISTORY; j++) {
      snap[`cx${j}`] = this.p.map((p) => p.cx[j]);
      snap[`cw${j}`] = this.p.map((p) => p.cw[j]);
    }
    return snap;
  }

  winner(target) {
    const eligible = this.scores.map((s, i) => this.gone[i] ? -1 : s);
    const best = Math.max(...eligible);
    return best >= target && eligible.filter((s) => s === best).length === 1 ? eligible.indexOf(best) : -1;
  }
}

const fixedPlayer = { type: "fixed", scale: 10, bits: 16, per: "player" };
const bytePlayer = { type: "uint", bits: 8, per: "player" };
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" }, ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    x: fixedPlayer, width: fixedPlayer, base: fixedPlayer,
    dir: { type: "int", bits: 8, per: "player" },
    height: bytePlayer, best: bytePlayer, cd: bytePlayer, flash: bytePlayer, result: bytePlayer, award: bytePlayer,
    active: { type: "bool", per: "player" },
    ...Object.fromEntries(Array.from({ length: HISTORY }, (_, j) => [[`cx${j}`, fixedPlayer], [`cw${j}`, fixedPlayer]]).flat()),
    dropped: { type: "players" }, landed: { type: "players" }, perfect: { type: "players" }, fell: { type: "players" }, awarded: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = { drop: { values: [0, 1], neutral: 0 } };
