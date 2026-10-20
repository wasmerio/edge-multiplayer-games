export const ARENA = { w: 640, h: 480 };
export const TARGET = 12;
export const READY_TICKS = 45;
export const AIM_TICKS = 105;
export const SLIDE_TICKS = 90;
export const REST_TICKS = 15;
export const MAX_CHARGE = 60;
export const FRICTION = 0.12;
export const RADIUS = 16;
export const AIM_SPEED = 0.8;
export const PHASE = { READY: 0, AIM: 1, SLIDE: 2, REST: 3, DONE: 4 };
export const speedFor = (charge) => 4 + charge * 0.16;
export const launchAt = (arena) => ({ x: arena.w * 0.1, y: arena.h / 2 });
export const round10 = (n) => Math.round(n * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function travelFor(charge) {
  const v = speedFor(charge);
  const ticks = Math.min(SLIDE_TICKS, Math.ceil(v / FRICTION));
  return ticks * v - FRICTION * ticks * (ticks - 1) / 2;
}

export function awardsFor(snap) {
  const distance = snap.x.map((x, i) => snap.active[i] && snap.state[i] === 1
    ? round10(Math.hypot(x - snap.tx, snap.y[i] - snap.ty)) : Infinity);
  const nearest = Math.min(...distance);
  return distance.map((d) => d > 100 ? 0 : (d <= 30 ? 3 : d <= 60 ? 2 : 1) + (d === nearest ? 2 : 0));
}

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.arena = opts.arena;
    this.rng = rng;
    this.scores = Array(playerCount).fill(0);
    this.active = Array(playerCount).fill(true);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.phase = PHASE.DONE;
    this.t = this.tMax = 0;
    this.turn = this.moving = -1;
    this.charge = 0;
    this.charging = false;
    this.tx = this.arena.w * 0.72;
    this.ty = this.arena.h / 2;
    this.p = Array.from({ length: playerCount }, () => ({ ...launchAt(this.arena), angle: 0, state: 0, held: false, direction: 0 }));
    this.rank = Array(playerCount).fill(255);
    this.award = Array(playerCount).fill(0);
    this.order = [];
    this.cursor = -1;
    this.vx = this.vy = 0;
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.setPhase(PHASE.READY, READY_TICKS);
    this.turn = this.moving = -1;
    this.charge = 0;
    this.charging = false;
    this.vx = this.vy = 0;
    this.tx = round10(this.arena.w * this.rng.range(0.68, 0.76));
    this.ty = round10(this.arena.h * this.rng.range(0.39, 0.61));
    const launch = launchAt(this.arena);
    const angle = round10(Math.atan2(this.ty - launch.y, this.tx - launch.x) * 180 / Math.PI);
    this.p = this.p.map(() => ({ ...launch, angle, state: 0, held: false, direction: 0 }));
    this.award.fill(0);
    this.rank.fill(255);
    const first = this.rng.int(0, this.n - 1);
    this.order = this.active.flatMap((active, i) => active ? [i] : []);
    this.order.sort((a, b) => this.scores[b] - this.scores[a] || (a - first + this.n) % this.n - (b - first + this.n) % this.n);
    this.order.forEach((seat, rank) => { this.rank[seat] = rank; });
    this.cursor = -1;
  }

  setPhase(phase, ticks) { this.phase = phase; this.t = this.tMax = ticks; }

  disconnect(index) {
    this.active[index] = false;
    this.p[index].state = 2;
    if (this.moving === index) { this.moving = -1; this.vx = this.vy = 0; }
  }

  nextTurn(events) {
    do { this.cursor++; } while (this.cursor < this.order.length && !this.active[this.order[this.cursor]]);
    if (this.cursor >= this.order.length) { this.finish(events); return; }
    this.turn = this.order[this.cursor];
    this.charge = 0;
    this.charging = false;
    Object.assign(this.p[this.turn], launchAt(this.arena));
    this.setPhase(PHASE.AIM, AIM_TICKS);
    events.opened = true;
  }

  launch(events) {
    const p = this.p[this.turn];
    const angle = p.angle * Math.PI / 180;
    this.vx = Math.cos(angle) * speedFor(this.charge);
    this.vy = Math.sin(angle) * speedFor(this.charge);
    p.state = 1;
    this.moving = this.turn;
    this.charging = false;
    this.setPhase(PHASE.SLIDE, SLIDE_TICKS);
    events.sent.push(this.turn);
  }

  rest() {
    this.moving = -1;
    this.vx = this.vy = 0;
    this.charging = false;
    this.setPhase(PHASE.REST, REST_TICKS);
  }

  moveStone(events) {
    if (this.moving < 0) { this.rest(); return; }
    const p = this.p[this.moving];
    p.x += this.vx;
    p.y += this.vy;
    if (p.x < 24 + RADIUS || p.x > this.arena.w - 24 - RADIUS || p.y < 32 + RADIUS || p.y > this.arena.h - 32 - RADIUS) {
      p.x = clamp(p.x, 24 + RADIUS, this.arena.w - 24 - RADIUS);
      p.y = clamp(p.y, 32 + RADIUS, this.arena.h - 32 - RADIUS);
      p.state = 2;
      events.out.push(this.moving);
      this.rest();
      return;
    }
    for (let i = 0; i < this.n; i++) {
      if (i === this.moving || !this.active[i] || this.p[i].state !== 1) continue;
      const q = this.p[i];
      const dx = q.x - p.x, dy = q.y - p.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= RADIUS * 2) continue;
      const nx = distance > 0 ? dx / distance : 1;
      const ny = distance > 0 ? dy / distance : 0;
      const impact = this.vx * nx + this.vy * ny;
      if (impact <= 0) continue;
      p.x = q.x - nx * (RADIUS * 2 + 0.1);
      p.y = q.y - ny * (RADIUS * 2 + 0.1);
      events.hit.push(this.moving, i);
      this.moving = i;
      this.vx = nx * impact * 0.9;
      this.vy = ny * impact * 0.9;
      break;
    }
    const speed = Math.hypot(this.vx, this.vy);
    const next = Math.max(0, speed - FRICTION);
    if (next < FRICTION || --this.t <= 0) { this.rest(); return; }
    this.vx *= next / speed;
    this.vy *= next / speed;
  }

  finish(events) {
    this.award = awardsFor(this.snapshot(events));
    this.award.forEach((points, i) => {
      if (points) { this.scores[i] += points; events.scored.push(i); }
    });
    this.roundOver = true;
    this.turn = this.moving = -1;
    this.charging = false;
    this.setPhase(PHASE.DONE, 0);
    events.finished = true;
  }

  step(intents) {
    this.tick++;
    const events = { aimed: [], wound: [], sent: [], hit: [], out: [], missed: [], scored: [], beep: false, opened: false, finished: false };
    if (!this.roundOver) {
      if (!this.active.some(Boolean)) this.finish(events);
      else {
        const phase = this.phase;
        for (let i = 0; i < this.n; i++) {
          const p = this.p[i];
          const held = (intents[i]?.slide || 0) > 0;
          const direction = Math.sign(intents[i]?.aim || 0);
          if (this.active[i] && p.state === 0) {
            p.angle = round10(clamp(p.angle + direction * AIM_SPEED, -55, 55));
            if (direction && direction !== p.direction) events.aimed.push(i);
            if (phase === PHASE.AIM && i === this.turn) {
              if (held && !p.held) { this.charging = true; events.wound.push(i); }
              if (this.charging && held) this.charge = Math.min(MAX_CHARGE, this.charge + 1);
              if (this.charging && !held) this.launch(events);
            }
          }
          p.held = held;
          p.direction = direction;
        }
        if (phase === PHASE.READY) {
          events.beep = this.t % 15 === 0;
          if (--this.t === 0) this.nextTurn(events);
        } else if (phase === PHASE.AIM && this.phase === phase) {
          if (!this.active[this.turn]) this.rest();
          else if (--this.t === 0) {
            if (this.charging) this.launch(events);
            else { this.p[this.turn].state = 3; events.missed.push(this.turn); this.rest(); }
          }
        } else if (phase === PHASE.SLIDE) this.moveStone(events);
        else if (phase === PHASE.REST && --this.t === 0) this.nextTurn(events);
      }
    }
    return this.snapshot(events);
  }

  snapshot(events) {
    return {
      k: this.tick, over: this.roundOver, phase: this.phase, t: this.t, tMax: this.tMax,
      turn: this.turn, moving: this.moving, charge: this.charge, charging: this.charging,
      tx: this.tx, ty: this.ty,
      x: this.p.map((p) => round10(p.x)), y: this.p.map((p) => round10(p.y)),
      angle: this.p.map((p) => p.angle), state: this.p.map((p) => p.state),
      active: [...this.active], rank: [...this.rank], award: [...this.award], ...events,
    };
  }

  winner(target) {
    const eligible = this.scores.map((score, i) => this.active[i] ? score : -1);
    const best = Math.max(...eligible);
    return best >= target && eligible.filter((s) => s === best).length === 1 ? eligible.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x", "y", "angle"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    phase: { type: "uint", bits: 8 },
    t: { type: "uint", bits: 8 },
    tMax: { type: "uint", bits: 8 },
    turn: { type: "int", bits: 8 },
    moving: { type: "int", bits: 8 },
    charge: { type: "uint", bits: 8 },
    charging: { type: "bool" },
    tx: { type: "fixed", scale: 10, bits: 16 },
    ty: { type: "fixed", scale: 10, bits: 16 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    angle: { type: "fixed", scale: 10, bits: 16, per: "player" },
    state: { type: "uint", bits: 8, per: "player" },
    active: { type: "bool", per: "player" },
    rank: { type: "uint", bits: 8, per: "player" },
    award: { type: "uint", bits: 8, per: "player" },
    aimed: { type: "players" }, wound: { type: "players" }, sent: { type: "players" },
    hit: { type: "players" }, out: { type: "players" }, missed: { type: "players" }, scored: { type: "players" },
    beep: { type: "bool" }, opened: { type: "bool" }, finished: { type: "bool" },
  },
};

export const INTENT = {
  aim: { values: [-1, 0, 1], neutral: 0 },
  slide: { values: [0, 1], neutral: 0 },
};
