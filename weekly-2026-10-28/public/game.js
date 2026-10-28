export const ARENA = (players) => ({ w: 640, h: 100 + 160 * Math.ceil(players / 2) });
export const READY_TICKS = 60;
export const COURSE_TICKS = 120;
export const COURSES = 8;
export const BED = 256;
export const TARGET = 45;
export const PERFECT = 6;
const MAX_WIDTH = 192;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const speedFor = (course) => 3 + course * 0.4;
export const multiplier = (course) => course >= 6 ? 2 : 1;

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.rng = rng;
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.p = [];
    this.ready = 0;
    this.course = 0;
    this.t = 0;
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.course = 0;
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.p = this.scores.map((score) => {
      const width = 160 + Math.min(32, Math.max(0, best - score) * 2);
      return { x: 0, width, baseX: (BED - width) / 2, baseW: width, dir: 1,
        locked: false, held: false, result: 0, award: 0, total: 0,
        hx: Array(COURSES).fill(0), hw: Array(COURSES).fill(0) };
    });
    this.beginCourse();
  }

  beginCourse() {
    this.t = COURSE_TICKS;
    const dir = this.rng.pick([-1, 1]);
    for (const p of this.p) {
      p.width = p.baseW;
      p.x = dir === 1 ? 0 : BED - p.width;
      p.dir = dir;
      p.locked = false;
      p.result = 0;
      p.award = 0;
    }
  }

  widen(p, amount) {
    const width = Math.min(MAX_WIDTH, p.baseW + amount);
    p.baseX = clamp(Math.round(p.baseX - (width - p.baseW) / 2), 0, BED - width);
    p.baseW = width;
  }

  drop(i, scored, missed) {
    const p = this.p[i];
    p.locked = true;
    const x = Math.round(p.x);
    const left = Math.max(x, p.baseX);
    const right = Math.min(x + p.width, p.baseX + p.baseW);
    if (right - left < 16) {
      p.result = 3;
      this.widen(p, 32);
      missed.push(i);
      return;
    }
    const perfect = Math.abs(x - p.baseX) <= PERFECT;
    p.baseX = left;
    p.baseW = right - left;
    if (perfect) this.widen(p, 8);
    p.hx[this.course] = p.baseX;
    p.hw[this.course] = p.baseW;
    p.result = perfect ? 2 : 1;
    p.award = (perfect ? 3 : 1) * multiplier(this.course);
    p.total += p.award;
    this.scores[i] += p.award;
    scored.push(i);
  }

  disconnect(index) { this.gone[index] = true; }

  step(intents) {
    this.tick++;
    const pressed = [], scored = [], missed = [];
    let beep = false, opened = false, finished = false;
    if (!this.roundOver && this.gone.every(Boolean)) { this.roundOver = true; finished = true; }
    if (!this.roundOver) {
      if (!this.ready && this.t === 0) {
        this.course++;
        this.beginCourse();
        opened = true;
      }
      const waiting = this.ready > 0;
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i];
        const held = (intents[i]?.press || 0) > 0;
        const edge = held && !p.held;
        p.held = held;
        if (this.gone[i] || waiting || p.locked) continue;
        p.x += p.dir * speedFor(this.course);
        const end = BED - p.width;
        if (p.x > end) { p.x = 2 * end - p.x; p.dir = -1; }
        if (p.x < 0) { p.x = -p.x; p.dir = 1; }
        if (edge) { pressed.push(i); this.drop(i, scored, missed); }
      }
      if (waiting) {
        beep = this.ready % 30 === 0;
        this.ready--;
        opened = this.ready === 0;
      } else {
        this.t--;
        if (this.t === 0) {
          for (let i = 0; i < this.n; i++) {
            const p = this.p[i];
            if (this.gone[i] || p.locked) continue;
            p.locked = true;
            p.result = 4;
            this.widen(p, 32);
            missed.push(i);
          }
          if (this.course === COURSES - 1) { this.roundOver = true; finished = true; }
        }
      }
    }
    const snap = {
      k: this.tick, over: this.roundOver, ready: this.ready, course: this.course, t: this.t,
      x: this.p.map((p) => Math.round(p.x * 10) / 10),
      width: this.p.map((p) => p.width), baseX: this.p.map((p) => p.baseX), baseW: this.p.map((p) => p.baseW),
      locked: this.p.map((p) => p.locked), active: this.gone.map((g) => !g),
      result: this.p.map((p) => p.result), award: this.p.map((p) => p.award), total: this.p.map((p) => p.total),
      pressed, scored, missed, beep, opened, finished,
    };
    for (let j = 0; j < COURSES; j++) {
      snap[`hx${j}`] = this.p.map((p) => p.hx[j]);
      snap[`hw${j}`] = this.p.map((p) => p.hw[j]);
    }
    return snap;
  }

  winner(target) {
    let winner = -1, best = -1, tied = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; winner = i; tied = false; }
      else if (this.scores[i] === best) tied = true;
    }
    return best >= target && !tied ? winner : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k", interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, course: { type: "uint", bits: 8 }, t: { type: "uint", bits: 8 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    width: { type: "uint", bits: 8, per: "player" },
    baseX: { type: "uint", bits: 8, per: "player" }, baseW: { type: "uint", bits: 8, per: "player" },
    locked: { type: "bool", per: "player" }, active: { type: "bool", per: "player" },
    result: { type: "uint", bits: 8, per: "player" }, award: { type: "uint", bits: 8, per: "player" },
    total: { type: "uint", bits: 8, per: "player" },
    ...Object.fromEntries(Array.from({ length: COURSES }, (_, j) => [
      [`hx${j}`, { type: "fixed", scale: 1, bits: 8, signed: false, per: "player" }],
      [`hw${j}`, { type: "fixed", scale: 1, bits: 8, signed: false, per: "player" }],
    ]).flat()),
    pressed: { type: "players" }, scored: { type: "players" }, missed: { type: "players" },
    beep: { type: "bool" }, opened: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = { press: { values: [0, 1], neutral: 0 } };
