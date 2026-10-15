export const ARENA = { w: 640, h: 480 };
export const READY_TICKS = 60;
export const SHIFT_TICKS = 1080;
export const SETTLE_TICKS = 18;
export const REBUILD_TICKS = 30;
export const FLOORS = 8;
export const TARGET = 60;
export const unpackFloor = (packed) => ({ left: Math.floor(packed / 128), width: packed % 128 });
const pack = (left, width) => Math.round(left / 10) * 128 + Math.round(width / 10);

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
    this.speed = 8;
    this.side = 1;
    this.p = Array.from({ length: playerCount }, () => this.fresh(2));
  }

  fresh(tolerance) {
    return { x: this.side > 0 ? 0 : 400, base: 200, width: 600, height: 0,
      dir: this.side, cd: 0, result: 0, gain: 0, tolerance, held: false, floors: Array(FLOORS).fill(0) };
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = SHIFT_TICKS;
    this.side = this.rng.pick([-1, 1]);
    this.speed = this.rng.int(7, 10);
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.p = this.p.map((_, i) => this.fresh(!this.gone[i] && this.scores[i] < best ? 4 : 2));
  }

  disconnect(index) { this.gone[index] = true; }

  nextBeam(p) {
    if (p.result === 3 || p.result === 4) {
      p.base = 200;
      p.width = 600;
      p.height = 0;
      p.floors.fill(0);
    }
    p.dir *= -1;
    p.x = p.dir > 0 ? 0 : 1000 - p.width;
    p.result = 0;
    p.gain = 0;
  }

  step(intents) {
    this.tick += 1;
    const events = { dropped: [], landed: [], perfect: [], missed: [], built: [], denied: [], beep: false, go: false, finished: false };
    if (!this.roundOver && this.gone.every(Boolean)) {
      this.roundOver = true;
      events.finished = true;
    }
    if (!this.roundOver) {
      const waiting = this.ready > 0;
      for (let i = 0; i < this.n; i++) {
        if (this.gone[i]) continue;
        const p = this.p[i];
        const held = (intents[i]?.drop || 0) > 0;
        const press = held && !p.held;
        p.held = held;
        if (waiting) continue;
        if (p.cd > 0) {
          p.cd -= 1;
          if (p.cd === 0) this.nextBeam(p);
        }
        if (p.cd > 0) {
          if (press) events.denied.push(i);
          continue;
        }
        if (press) {
          events.dropped.push(i);
          const aligned = Math.abs(p.x - p.base) <= p.tolerance * 10;
          const left = aligned ? p.base : Math.max(p.x, p.base);
          const width = aligned ? p.width : Math.min(p.x + p.width, p.base + p.width) - left;
          const before = this.scores[i];
          if (width < 60) {
            p.result = 3;
            p.cd = REBUILD_TICKS;
            this.scores[i] = Math.max(0, before - 2);
            events.missed.push(i);
          } else {
            p.base = left;
            p.width = width;
            p.x = left;
            p.floors[p.height] = pack(left, width);
            p.height += 1;
            p.result = aligned ? 2 : 1;
            p.cd = SETTLE_TICKS;
            this.scores[i] += aligned ? 2 : 1;
            events.landed.push(i);
            if (aligned) events.perfect.push(i);
            if (p.height === FLOORS) {
              p.result = 4;
              p.cd = REBUILD_TICKS;
              this.scores[i] += 4;
              events.built.push(i);
            }
          }
          p.gain = this.scores[i] - before;
        } else {
          p.x += p.dir * (this.speed + p.height * 2);
          const max = 1000 - p.width;
          if (p.x < 0) { p.x = -p.x; p.dir = 1; }
          if (p.x > max) { p.x = 2 * max - p.x; p.dir = -1; }
        }
      }
      if (waiting) {
        events.beep = this.ready % 20 === 0;
        this.ready -= 1;
        events.go = this.ready === 0;
      } else {
        this.left -= 1;
        if (this.left === 0) { this.roundOver = true; events.finished = true; }
      }
    }
    const snap = {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      x: this.p.map((p) => p.x / 10), base: this.p.map((p) => p.base / 10), width: this.p.map((p) => p.width / 10),
      height: this.p.map((p) => p.height), cd: this.p.map((p) => p.cd), result: this.p.map((p) => p.result),
      gain: this.p.map((p) => p.gain), tolerance: this.p.map((p) => p.tolerance), active: this.gone.map((g) => !g), ...events,
    };
    for (let f = 0; f < FLOORS; f++) snap[`f${f}`] = this.p.map((p) => p.floors[f]);
    return snap;
  }

  winner(target) {
    let best = target - 1, winner = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; winner = i; }
      else if (this.scores[i] === best) winner = -1;
    }
    return winner;
  }
}

const per = (type, bits) => ({ type, bits, per: "player" });
export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 16 }, left: { type: "uint", bits: 16 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    base: { type: "fixed", scale: 10, bits: 16, per: "player" },
    width: { type: "fixed", scale: 10, bits: 16, per: "player" },
    height: per("uint", 8), cd: per("uint", 8), result: per("uint", 8), gain: per("int", 8), tolerance: per("uint", 8),
    active: { type: "bool", per: "player" },
    ...Object.fromEntries(Array.from({ length: FLOORS }, (_, f) => [`f${f}`, per("uint", 16)])),
    dropped: { type: "players" }, landed: { type: "players" }, perfect: { type: "players" },
    missed: { type: "players" }, built: { type: "players" }, denied: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = { drop: { values: [0, 1], neutral: 0 } };
