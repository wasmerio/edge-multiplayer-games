// Pure host simulation; coordinates are fractions of the course.
export const COLORS = ["#ffcf67", "#7ee7db", "#ff8fa3", "#9eafff", "#c5ee82", "#f4a7ee", "#83caff", "#ffac78"];
export const TICK_HZ = 30;
export const ARENA = { w: 960, h: 680 };
export const TARGET = 9;
export const GATE_RADIUS = 0.075;
export const LAP_GATES = 12;
export const GATES = [[0.82, 0.78], [0.84, 0.32], [0.52, 0.17], [0.18, 0.28], [0.17, 0.72], [0.5, 0.82]];
export const REEFS = [[0.65, 0.57, 0.075], [0.40, 0.38, 0.08], [0.31, 0.60, 0.05]];
const TAU = Math.PI * 2;
const round = (n) => Math.round(n * 10000) / 10000;

export class Game {
  constructor(playerCount, opts, rng) {
    const arena = opts?.arena ?? ARENA;
    this.n = playerCount;
    this.rng = rng;
    this.w = arena.w;
    this.h = arena.h;
    this.round = 0;
    this.tick = 0;
    this.seq = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.disconnected = new Set();
    this.boats = [];
    this.gates = GATES.map((g) => [...g]);
    this.reefs = REEFS.map((r) => [...r]);
  }

  startRound() {
    this.round++;
    this.roundOver = false;
    this.tick = 0;
    this.seq = 0;
    this.freeze = 60;
    this.deadline = 1800;
    this.current = [0, 0];
    this.boats = Array.from({ length: this.n }, (_, i) => ({
      x: 0.5, y: 0.82 + (i - (this.n - 1) / 2) * 0.012,
      a: 0, speed: 0, checkpoint: 0, finish: 0, stun: 0,
      active: !this.disconnected.has(i),
    }));
  }

  disconnect(i) {
    this.disconnected.add(i);
    if (this.boats[i]) this.boats[i].active = false;
  }

  step(inputs = []) {
    const events = { gate: [], hit: [], done: [], award: [] };
    if (!this.roundOver) this.seq++;
    if (!this.roundOver && this.freeze > 0) this.freeze--;
    else if (!this.roundOver) {
      this.tick++;
      const phase = Math.floor((this.tick - 1) / 240) + this.round - 1;
      this.current = [Math.cos(phase * 1.7) * 0.00045, Math.sin(phase * 1.7) * 0.00045];
      for (let i = 0; i < this.n; i++) {
        const b = this.boats[i];
        if (!b.active || b.finish) continue;
        const raw = inputs[i]?.turn ?? inputs[i];
        const turn = raw === -1 ? -1 : raw === 1 ? 1 : 0;
        b.a = (b.a + turn * 0.072 + TAU) % TAU;
        if (b.stun) b.stun--;
        const desired = b.stun ? 0.0009 : turn ? 0.0026 : 0.0036;
        b.speed += (desired - b.speed) * 0.12;
        b.x += Math.cos(b.a) * b.speed + this.current[0];
        b.y += Math.sin(b.a) * b.speed + this.current[1];
        let hit = false;
        for (const [x, y, r] of this.reefs) {
          const dx = b.x - x, dy = b.y - y;
          const distance = Math.hypot(dx, dy);
          if (distance < r + 0.012) {
            b.a = Math.atan2(dy, dx);
            b.x = x + Math.cos(b.a) * (r + 0.013);
            b.y = y + Math.sin(b.a) * (r + 0.013);
            hit = true;
          }
        }
        if (b.x < 0.025 || b.x > 0.975) {
          b.x = Math.max(0.025, Math.min(0.975, b.x));
          b.a = Math.PI - b.a;
          hit = true;
        }
        if (b.y < 0.035 || b.y > 0.965) {
          b.y = Math.max(0.035, Math.min(0.965, b.y));
          b.a = -b.a;
          hit = true;
        }
        if (hit) {
          b.stun = 24;
          b.speed = 0.0009;
          events.hit.push(i);
        }
        const [gx, gy] = this.gates[b.checkpoint % 6];
        if (Math.hypot(b.x - gx, b.y - gy) <= GATE_RADIUS) {
          b.checkpoint++;
          events.gate.push(i);
          if (b.checkpoint === LAP_GATES) {
            b.finish = this.tick;
            this.deadline = Math.min(this.deadline, this.tick + 240);
            events.done.push(i);
          }
        }
      }
      if (this.tick >= this.deadline || this.boats.every((b) => !b.active || b.finish)) {
        this.finishRound(events);
      }
    }
    return this.snapshot(events);
  }

  finishRound(events) {
    this.roundOver = true;
    const progress = this.boats.map((b) => {
      if (!b.active || !b.checkpoint) return -Infinity;
      if (b.finish) return 10000 - b.finish;
      const [x, y] = this.gates[b.checkpoint % 6];
      return b.checkpoint - Math.hypot(b.x - x, b.y - y);
    });
    const best = Math.max(...progress);
    this.boats.forEach((b, i) => {
      const award = best !== -Infinity && Math.abs(progress[i] - best) < 0.000001 ? 3 : b.active && b.finish ? 1 : 0;
      this.scores[i] += award;
      if (award) events.award.push(i);
    });
  }

  snapshot(events = {}) {
    const col = (read) => this.boats.map(read);
    return {
      n: this.seq, k: this.tick, f: this.freeze, left: Math.max(0, this.deadline - this.tick),
      cx: round(this.current[0]), cy: round(this.current[1]), over: this.roundOver,
      x: col((b) => round(b.x)), y: col((b) => round(b.y)), a: col((b) => round(b.a)),
      cp: col((b) => b.checkpoint), fin: col((b) => b.finish), stun: col((b) => b.stun),
      on: col((b) => b.active), scores: [...this.scores],
      gate: events.gate ?? [], hit: events.hit ?? [], done: events.done ?? [], award: events.award ?? [],
    };
  }

  winner(target) {
    const best = Math.max(...this.scores);
    return best >= target && this.scores.filter((s) => s === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}

// `n` counts every step of the round, countdown included, so guests can order
// frames while `k` (race ticks) stands still. Headings wrap, so they never blend.
export const SNAPSHOT = {
  tickField: "n",
  interpolate: ["x", "y", "a"],
  fields: {
    n: { type: "uint", bits: 16 },
    k: { type: "uint", bits: 16 },
    f: { type: "uint", bits: 8 },
    left: { type: "uint", bits: 16 },
    cx: { type: "fixed", scale: 10000, bits: 8 },
    cy: { type: "fixed", scale: 10000, bits: 8 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10000, bits: 16, signed: false, per: "player" },
    y: { type: "fixed", scale: 10000, bits: 16, signed: false, per: "player" },
    a: { type: "fixed", scale: 5000, bits: 16, per: "player", wrap: 2 * Math.PI },
    cp: { type: "uint", bits: 8, per: "player" },
    fin: { type: "uint", bits: 16, per: "player" },
    stun: { type: "uint", bits: 8, per: "player" },
    on: { type: "bool", per: "player" },
    scores: { type: "uint", bits: 16, per: "player" },
    gate: { type: "players" },
    hit: { type: "players" },
    done: { type: "players" },
    award: { type: "players" },
  },
};

export const INTENT = { turn: { min: -1, max: 1, neutral: 0 } };
