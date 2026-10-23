export const ARENA = { w: 640, h: 480 };
export const READY_TICKS = 60;
export const BUILD_TICKS = 1080;
export const START_WIDTH = 184;
export const LEADER_WIDTH = 152;
export const MIN_OVERLAP = 24;
export const PERFECT = 8;
export const PLACE_PAUSE = 12;
export const COLLAPSE_PAUSE = 30;
export const TARGET = 9;
export const workspace = (arena) => arena.w * 0.5625;
export const sweepSpeed = (height) => Math.min(8, 4 + height * 0.22);
const tenth = (x) => Math.round(x * 10) / 10;

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.rng = rng;
    this.span = workspace(opts.arena);
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.ready = 0;
    this.left = 0;
    this.lead = -1;
    this.p = Array.from({ length: playerCount }, () => this.fresh(1, START_WIDTH));
  }

  fresh(dir, width) {
    return { x: dir > 0 ? 0 : this.span - width, base: (this.span - width) / 2,
      width, dir, height: 0, cd: 0, flash: 0, mark: 0, award: 0, held: false };
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = BUILD_TICKS;
    this.lead = this.winner(1);
    const dir = this.rng.pick([-1, 1]);
    this.p = this.p.map((_, i) => this.fresh(dir, i === this.lead ? LEADER_WIDTH : START_WIDTH));
  }

  disconnect(index) { this.gone[index] = true; }

  settle(awarded) {
    const best = Math.max(0, ...this.p.map((p, i) => this.gone[i] ? 0 : p.height));
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      const p = this.p[i];
      p.award = best > 0 && p.height === best ? 3 : p.height >= 4 ? 1 : 0;
      this.scores[i] += p.award;
      if (p.award) awarded.push(i);
    }
    this.roundOver = true;
  }

  step(intents) {
    this.tick += 1;
    const placed = [], perfect = [], collapsed = [], awarded = [];
    let beep = false, go = false, finished = false;
    if (!this.roundOver) {
      if (this.gone.every(Boolean)) {
        this.roundOver = true;
        finished = true;
      } else {
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const p = this.p[i];
          const down = (intents[i]?.drop || 0) > 0;
          const press = down && !p.held;
          p.held = down;
          if (p.flash > 0) p.flash -= 1;
          if (this.ready > 0) continue;
          if (p.cd > 0) { p.cd -= 1; continue; }
          p.x += p.dir * sweepSpeed(p.height);
          const end = this.span - p.width;
          if (p.x > end) { p.x = 2 * end - p.x; p.dir = -1; }
          if (p.x < 0) { p.x = -p.x; p.dir = 1; }
          if (!press) continue;
          const overlap = Math.min(p.x + p.width, p.base + p.width) - Math.max(p.x, p.base);
          if (Math.abs(p.x - p.base) <= PERFECT) {
            const wide = Math.min(START_WIDTH, p.width + 8);
            p.base = Math.max(0, Math.min(this.span - wide, p.base - (wide - p.width) / 2));
            p.width = wide;
            p.height += 1;
            p.mark = 2;
            perfect.push(i);
            placed.push(i);
          } else if (overlap >= MIN_OVERLAP) {
            p.base = Math.max(p.x, p.base);
            p.width = overlap;
            p.height += 1;
            p.mark = 1;
            placed.push(i);
          } else {
            p.width = START_WIDTH;
            p.base = (this.span - p.width) / 2;
            p.height = 0;
            p.mark = 3;
            collapsed.push(i);
          }
          p.cd = p.mark === 3 ? COLLAPSE_PAUSE : PLACE_PAUSE;
          p.flash = p.mark === 3 ? 40 : 20;
          p.dir *= -1;
          p.x = p.dir > 0 ? 0 : this.span - p.width;
        }
        if (this.ready > 0) {
          beep = this.ready % 20 === 0;
          this.ready -= 1;
          go = this.ready === 0;
        } else {
          this.left -= 1;
          if (this.left === 0) { this.settle(awarded); finished = true; }
        }
      }
    }
    return {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left, lead: this.lead,
      x: this.p.map((p) => tenth(p.x)), base: this.p.map((p) => tenth(p.base)),
      width: this.p.map((p) => tenth(p.width)), dir: this.p.map((p) => p.dir),
      height: this.p.map((p) => p.height), cd: this.p.map((p) => p.cd),
      flash: this.p.map((p) => p.flash), mark: this.p.map((p) => p.mark),
      award: this.p.map((p) => p.award), active: this.gone.map((g) => !g),
      placed, perfect, collapsed, awarded, beep, go, finished,
    };
  }

  winner(target) {
    let best = -1, seat = -1, tied = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; tied = false; }
      else if (this.scores[i] === best) tied = true;
    }
    return !tied && best >= target ? seat : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    ready: { type: "uint", bits: 8 },
    left: { type: "uint", bits: 16 },
    lead: { type: "int", bits: 8 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    base: { type: "fixed", scale: 10, bits: 16, per: "player" },
    width: { type: "fixed", scale: 10, bits: 16, per: "player" },
    dir: { type: "int", bits: 8, per: "player" },
    height: { type: "uint", bits: 8, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    flash: { type: "uint", bits: 8, per: "player" },
    mark: { type: "uint", bits: 8, per: "player" },
    award: { type: "uint", bits: 8, per: "player" },
    active: { type: "bool", per: "player" },
    placed: { type: "players" },
    perfect: { type: "players" },
    collapsed: { type: "players" },
    awarded: { type: "players" },
    beep: { type: "bool" },
    go: { type: "bool" },
    finished: { type: "bool" },
  },
};

export const INTENT = { drop: { values: [0, 1], neutral: 0 } };
