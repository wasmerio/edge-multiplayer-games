export const COLORS = ["#6ef5cf", "#ff8ca8", "#85baff", "#ffdc79", "#cc9cff", "#ffae70", "#7ce3ff", "#e6ee96"];
export const TICK_HZ = 30;
export const ARENA = { w: 960, h: 720 };
export const TARGET = 60;
export const PULSE_TICKS = 75;
export const PULSES = 10;
const wrap = (a) => ((a % 360) + 360) % 360;
const distance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const target = (round, pulse) => wrap(35 + round * 47 + pulse * 113 + (pulse % 3) * 29);

export class Game {
  constructor(playerCount, opts, rng) {
    const arena = opts?.arena ?? ARENA;
    this.n = playerCount;
    this.rng = rng;
    this.w = arena.w;
    this.h = arena.h;
    this.scores = new Array(playerCount).fill(0);
    this.active = new Array(playerCount).fill(true);
    this.players = [];
    this.round = 0;
    this.tick = 0;
    this.seq = 0;
    this.freeze = 0;
    this.broadcasts = 0;
    this.roundOver = true;
    this.aim = 0;
    this.nextAim = 0;
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.seq = 0;
    this.freeze = TICK_HZ;
    this.broadcasts = 0;
    this.roundOver = false;
    this.aim = target(this.round, 0);
    this.nextAim = target(this.round, 1);
    this.players = Array.from({ length: this.n }, () => ({ angle: 270, velocity: 0, points: 0, award: -1 }));
  }

  disconnect(pid) {
    if (pid >= 0 && pid < this.n) this.active[pid] = false;
  }

  step(inputs = []) {
    const events = [];
    if (!this.roundOver) {
      this.seq++;
      if (this.freeze > 0) {
        this.freeze--;
      } else {
        if (this.tick > 0 && this.tick % PULSE_TICKS === 0) {
          this.aim = this.nextAim;
          this.nextAim = target(this.round, this.broadcasts + 1);
        }
        this.tick++;
        for (let i = 0; i < this.n; i++) {
          if (!this.active[i]) continue;
          const p = this.players[i];
          const raw = inputs[i]?.turn ?? inputs[i];
          const intent = raw === -1 ? -1 : raw === 1 ? 1 : 0;
          p.velocity = intent ? Math.max(-5, Math.min(5, p.velocity + intent * 0.6)) : p.velocity * 0.65;
          if (Math.abs(p.velocity) < 0.02) p.velocity = 0;
          p.angle = wrap(p.angle + p.velocity);
          if (this.tick % PULSE_TICKS === 0) {
            const error = distance(p.angle, this.aim);
            p.award = error <= 8 ? 3 : error <= 22 ? 1 : 0;
            p.points += p.award;
            this.scores[i] += p.award;
            events.push(i);
          }
        }
        if (this.tick % PULSE_TICKS === 0) this.broadcasts++;
        if (this.broadcasts === PULSES || !this.active.some(Boolean)) this.roundOver = true;
      }
    }
    const col = (read) => this.players.map(read);
    return {
      n: this.seq, k: this.tick, f: this.freeze, b: this.broadcasts,
      aim: this.aim, next: this.nextAim, over: this.roundOver,
      ang: col((p) => Math.round(p.angle * 10) / 10), vel: col((p) => Math.round(p.velocity * 100) / 100),
      pts: col((p) => p.points), on: col((_, i) => this.active[i]), last: col((p) => p.award),
      q: [...this.scores], d: events,
    };
  }

  winner(goal) {
    let best = goal - 1;
    let winner = -1;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; winner = i; }
      else if (this.scores[i] === best) winner = -1;
    }
    return winner;
  }
}

// `n` counts every step of the round, countdown included, so guests can order
// frames while `k` stands still. Angles wrap at 360, so nothing here blends.
export const SNAPSHOT = {
  tickField: "n",
  interpolate: ["ang"],
  fields: {
    n: { type: "uint", bits: 16 },
    k: { type: "uint", bits: 16 },
    f: { type: "uint", bits: 8 },
    b: { type: "uint", bits: 8 },
    aim: { type: "uint", bits: 16 },
    next: { type: "uint", bits: 16 },
    over: { type: "bool" },
    ang: { type: "fixed", scale: 10, bits: 16, signed: false, per: "player", wrap: 360 },
    vel: { type: "fixed", scale: 100, bits: 16, per: "player" },
    pts: { type: "uint", bits: 8, per: "player" },
    on: { type: "bool", per: "player" },
    last: { type: "int", bits: 8, per: "player" },
    q: { type: "uint", bits: 16, per: "player" },
    d: { type: "players" },
  },
};

export const INTENT = { turn: { min: -1, max: 1, neutral: 0 } };
