export const ARENA = { w: 640, h: 480 };
export const READY_TICKS = 60;
export const ROUND_TICKS = 900;
export const FLOORS = 6;
export const LAND_PAUSE = 12;
export const RESET_PAUSE = 30;
export const PERFECT = 6;
export const MIN_SUPPORT = 12;
export const TARGET = 60;
const q = (v) => Math.round(v * 10) / 10;

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
    this.ready = 0;
    this.left = 0;
    this.p = Array.from({ length: playerCount }, () => this.emptySite());
  }

  emptySite() {
    const width = q(this.w * 0.32);
    return { x: 0, width, base: q((this.w - width) / 2), dir: 1, level: 0, cd: 0, result: 0, held: false,
      bx: Array(FLOORS).fill(0), bw: Array(FLOORS).fill(0) };
  }

  launch(p) {
    p.dir = this.rng.pick([-1, 1]);
    p.x = p.dir === 1 ? 0 : q(this.w - p.width);
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.ready = READY_TICKS;
    this.left = ROUND_TICKS;
    this.roundOver = false;
    this.p = this.p.map((_, i) => {
      const p = this.emptySite();
      if (!this.gone[i]) this.launch(p);
      return p;
    });
  }

  disconnect(index) { this.gone[index] = true; }

  step(intents) {
    this.tick += 1;
    const landed = [], perfect = [], missed = [], built = [];
    let beep = false, go = false, finished = false;
    const live = !this.roundOver && this.ready === 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      const down = (intents[i]?.drop || 0) > 0;
      const press = down && !p.held;
      p.held = down;
      if (!live || this.gone[i]) continue;
      if (p.cd > 0) {
        p.cd -= 1;
        if (p.cd === 0) {
          if (p.result === 3 || p.result === 4) {
            const held = p.held;
            Object.assign(p, this.emptySite(), { held });
          }
          this.launch(p);
        }
        continue;
      }
      if (press) {
        const flush = Math.abs(p.x - p.base) <= PERFECT;
        const left = flush ? p.base : Math.max(p.x, p.base);
        const right = flush ? p.base + p.width : Math.min(p.x + p.width, p.base + p.width);
        if (right - left < MIN_SUPPORT) {
          p.result = 3;
          p.cd = RESET_PAUSE;
          this.scores[i] = Math.max(0, this.scores[i] - 2);
          missed.push(i);
        } else {
          p.base = q(left);
          p.width = q(right - left);
          p.x = p.base;
          p.bx[p.level] = p.base;
          p.bw[p.level] = p.width;
          p.level += 1;
          p.result = flush ? 2 : 1;
          p.cd = LAND_PAUSE;
          this.scores[i] += flush ? 2 : 1;
          landed.push(i);
          if (flush) perfect.push(i);
          if (p.level === FLOORS) {
            p.result = 4;
            p.cd = RESET_PAUSE;
            this.scores[i] += 4;
            built.push(i);
          }
        }
      } else {
        const end = this.w - p.width;
        p.x += p.dir * (5 + p.level * 0.35);
        if (p.x > end) { p.x = 2 * end - p.x; p.dir = -1; }
        if (p.x < 0) { p.x = -p.x; p.dir = 1; }
        p.x = q(p.x);
      }
    }
    if (!this.roundOver) {
      if (this.ready > 0) {
        beep = this.ready % 30 === 0;
        this.ready -= 1;
        go = this.ready === 0;
      } else this.left -= 1;
      if (this.left === 0 || this.gone.every(Boolean)) {
        this.roundOver = true;
        finished = true;
      }
    }
    const snap = {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      x: this.p.map((p) => p.x), width: this.p.map((p) => p.width), base: this.p.map((p) => p.base),
      dir: this.p.map((p) => p.dir), level: this.p.map((p) => p.level), cd: this.p.map((p) => p.cd),
      result: this.p.map((p) => p.result), active: this.gone.map((gone) => !gone),
      landed, perfect, missed, built, beep, go, finished,
    };
    for (let j = 0; j < FLOORS; j++) {
      snap[`bx${j}`] = this.p.map((p) => p.bx[j]);
      snap[`bw${j}`] = this.p.map((p) => p.bw[j]);
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

const position = () => ({ type: "fixed", scale: 10, bits: 16, per: "player" });
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    x: position(), width: position(), base: position(),
    dir: { type: "int", bits: 8, per: "player" },
    level: { type: "uint", bits: 8, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    result: { type: "uint", bits: 8, per: "player" },
    active: { type: "bool", per: "player" },
    ...Object.fromEntries(Array.from({ length: FLOORS }, (_, j) => [[`bx${j}`, position()], [`bw${j}`, position()]]).flat()),
    landed: { type: "players" }, perfect: { type: "players" },
    missed: { type: "players" }, built: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};

export const INTENT = { drop: { values: [0, 1], neutral: 0 } };
