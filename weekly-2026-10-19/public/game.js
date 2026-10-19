export const ARENA = { w: 560, h: 440 };
export const READY_TICKS = 60;
export const MOVE_TICKS = 90;
export const INSPECT_TICKS = 30;
export const FLOORS = 8;
export const MIN_WIDTH = 72;
export const TARGET = 60;
export const PHASE = { READY: 0, MOVE: 1, INSPECT: 2, DONE: 3 };
const MARGIN = 24;
const tenth = (v) => Math.round(v * 10) / 10;

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
    this.phase = PHASE.DONE;
    this.floor = 0;
    this.t = 0;
    this.speed = 0;
    this.p = Array.from({ length: playerCount }, () => this.player(180));
  }

  player(width) {
    return { base: (this.w - width) / 2, width, carry: width, x: MARGIN, dir: 1,
      held: false, locked: false, quality: 0, award: 0, built: 0, age: 255,
      sx: Array(FLOORS).fill(0), sw: Array(FLOORS).fill(0) };
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.phase = PHASE.READY;
    this.t = READY_TICKS;
    this.floor = 0;
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.p = this.p.map((_, i) => this.player(this.scores[i] < best ? 200 : 180));
    this.prepareLift();
  }

  prepareLift() {
    this.speed = (32 + this.floor * 4 + this.rng.int(0, 6)) / 10;
    const dir = this.rng.pick([-1, 1]);
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      const p = this.p[i];
      const width = Math.max(MIN_WIDTH, p.width);
      p.base = tenth(Math.max(MARGIN, Math.min(this.w - MARGIN - width, p.base + (p.width - width) / 2)));
      p.width = width;
      p.carry = width;
      p.x = dir > 0 ? MARGIN : this.w - MARGIN - width;
      p.dir = dir;
      p.locked = false;
      p.quality = 0;
      p.award = 0;
      p.age = 255;
    }
  }

  multiplier() { return this.floor >= FLOORS - 2 ? 2 : 1; }

  place(i, events) {
    const p = this.p[i];
    p.locked = true;
    p.age = 0;
    events.dropped.push(i);
    const left = Math.max(p.x, p.base);
    const right = Math.min(p.x + p.carry, p.base + p.width);
    const overlap = tenth(Math.max(0, right - left));
    p.quality = Math.round(100 * overlap / p.carry);
    if (overlap <= 0) { events.missed.push(i); return; }
    p.award = (p.quality >= 95 ? 3 : p.quality >= 80 ? 2 : 1) * this.multiplier();
    if (p.quality < 95) { p.base = tenth(left); p.width = overlap; }
    p.sx[this.floor] = p.base;
    p.sw[this.floor] = p.width;
    p.built += p.award;
    this.scores[i] += p.award;
    events.scored.push(i);
  }

  settle(events) {
    let best = 0, seat = -1, ties = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      const p = this.p[i];
      if (!p.locked) { p.locked = true; p.age = 0; events.missed.push(i); }
      if (p.quality > best) { best = p.quality; seat = i; ties = 1; }
      else if (p.quality === best) ties += 1;
    }
    if (best > 0 && ties === 1) {
      const points = this.multiplier();
      this.p[seat].award += points;
      this.p[seat].built += points;
      this.scores[seat] += points;
      events.bonus.push(seat);
    }
    this.phase = PHASE.INSPECT;
    this.t = INSPECT_TICKS;
    events.settled = true;
  }

  disconnect(index) { this.gone[index] = true; }

  step(intents) {
    this.tick += 1;
    const e = { dropped: [], missed: [], scored: [], bonus: [], beep: false, opened: false, settled: false, finished: false };
    if (!this.roundOver) {
      if (this.gone.every(Boolean)) {
        this.roundOver = true;
        this.phase = PHASE.DONE;
        e.finished = true;
      } else {
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const p = this.p[i];
          const pressed = (intents[i]?.drop || 0) > 0;
          const edge = pressed && !p.held;
          p.held = pressed;
          p.age = Math.min(255, p.age + 1);
          if (this.phase === PHASE.MOVE && !p.locked) {
            if (edge) this.place(i, e);
            else {
              p.x = tenth(p.x + p.dir * this.speed);
              const max = this.w - MARGIN - p.carry;
              if (p.x < MARGIN) { p.x = tenth(2 * MARGIN - p.x); p.dir = 1; }
              if (p.x > max) { p.x = tenth(2 * max - p.x); p.dir = -1; }
            }
          }
        }
        if (this.phase === PHASE.READY && this.t % 20 === 0) e.beep = true;
        this.t -= 1;
        if (this.t === 0) {
          if (this.phase === PHASE.READY) {
            this.phase = PHASE.MOVE;
            this.t = MOVE_TICKS;
            e.opened = true;
          } else if (this.phase === PHASE.MOVE) this.settle(e);
          else if (this.floor === FLOORS - 1) {
            this.roundOver = true;
            this.phase = PHASE.DONE;
            e.finished = true;
          } else {
            this.floor += 1;
            this.prepareLift();
            this.phase = PHASE.MOVE;
            this.t = MOVE_TICKS;
            e.opened = true;
          }
        }
      }
    }
    const s = { k: this.tick, over: this.roundOver, phase: this.phase, t: this.t, floor: this.floor, speed: this.speed, ...e };
    for (const key of ["x", "carry", "base", "width", "dir", "locked", "quality", "award", "built", "age"]) s[key] = this.p.map((p) => p[key]);
    s.active = this.gone.map((gone) => !gone);
    for (let f = 0; f < FLOORS; f++) {
      s[`sx${f}`] = this.p.map((p) => p.sx[f]);
      s[`sw${f}`] = this.p.map((p) => p.sw[f]);
    }
    return s;
  }

  winner(target) {
    let best = -1, seat = -1, ties = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; ties = 1; }
      else if (this.scores[i] === best) ties += 1;
    }
    return best >= target && ties === 1 ? seat : -1;
  }
}

const fixedPlayer = { type: "fixed", scale: 10, bits: 16, per: "player" };
const bytePlayer = { type: "uint", bits: 8, per: "player" };
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    phase: { type: "uint", bits: 8 }, t: { type: "uint", bits: 16 }, floor: { type: "uint", bits: 8 },
    speed: { type: "fixed", scale: 10, bits: 16 },
    x: fixedPlayer, carry: fixedPlayer, base: fixedPlayer, width: fixedPlayer,
    dir: { type: "int", bits: 8, per: "player" },
    active: { type: "bool", per: "player" }, locked: { type: "bool", per: "player" },
    quality: bytePlayer, award: bytePlayer, built: bytePlayer, age: bytePlayer,
    ...Object.fromEntries(Array.from({ length: FLOORS }, (_, f) => [[`sx${f}`, fixedPlayer], [`sw${f}`, fixedPlayer]]).flat()),
    dropped: { type: "players" }, missed: { type: "players" }, scored: { type: "players" }, bonus: { type: "players" },
    beep: { type: "bool" }, opened: { type: "bool" }, settled: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = { drop: { values: [0, 1], neutral: 0 } };
