// Short Fuse: hot-potato tag. Touch someone to hand over the bomb before it blows.
// No DOM, no network, no timers: it runs headless in Node.
export const TICK_HZ = 30;
export const R = 20;
export const SPEED = 7.2;
export const HOLDER_BOOST = 1.14;
export const ACCEL = 0.34;
export const DASH_V = 19;
export const DASH_TICKS = 6;
export const DASH_CD = 45;
export const STUN_TICKS = 14;
export const SAFE_TICKS = 30;
export const ARM_TICKS = 45;
export const BLAST_TICKS = 42;
export const BLAST_R = 150;
export const GHOST_SPEED = 6;
export const BOO_R = 110;
export const BOO_V = 15;
export const BOO_CD = 120;
export const OVERTIME_MAX = 75;
export const PHASE = { ARM: 0, LIVE: 1, OVERTIME: 2, BLAST: 3, DONE: 4 };

export const ARENA = (players) => (players > 4 ? { w: 1120, h: 700 } : { w: 960, h: 600 });
export const TARGET = (players) => 5 * Math.max(2, players);

// Static cover, derived from the arena so every peer agrees without a snapshot field.
export function pillars({ w, h }) {
  const out = [
    { x: w * 0.27, y: h * 0.3, r: 34 }, { x: w * 0.73, y: h * 0.3, r: 34 },
    { x: w * 0.27, y: h * 0.7, r: 34 }, { x: w * 0.73, y: h * 0.7, r: 34 },
  ];
  if (w > 1000) out.push({ x: w * 0.5, y: h * 0.5, r: 44 });
  return out;
}

const clampAxis = (v) => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);
const r1 = (v) => Math.round(v * 10) / 10;

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts.arena;
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    this.pillars = pillars(opts.arena);
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.gone = new Array(playerCount).fill(false);
    this.p = Array.from({ length: playerCount }, () => this.blank(w / 2, h / 2));
    this.phase = PHASE.DONE;
    this.timer = 0;
    this.holder = -1;
    this.fuse = 0;
    this.fuseMax = 1;
    this.beat = 0;
    this.blast = { x: 0, y: 0, age: 255 };
    this.passAge = 255;
  }

  blank(x, y) {
    return { x, y, vx: 0, vy: 0, kx: 0, ky: 0, fx: 1, fy: 0, alive: false, stun: 0, safe: 0, cd: 0, dash: 0, dx: 0, dy: 0, held: 0 };
  }

  aliveList() {
    const out = [];
    for (let i = 0; i < this.n; i++) if (this.p[i].alive) out.push(i);
    return out;
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    const offset = this.rng.range(0, Math.PI * 2);
    const ring = Math.min(this.w, this.h) * 0.4;
    for (let i = 0; i < this.n; i++) {
      const a = offset + (i / this.n) * Math.PI * 2;
      const q = this.blank(this.w / 2 + Math.cos(a) * ring * (this.w / this.h) * 0.8, this.h / 2 + Math.sin(a) * ring);
      q.alive = !this.gone[i];
      q.fx = -Math.cos(a);
      q.fy = -Math.sin(a);
      this.p[i] = q;
    }
    this.blast = { x: 0, y: 0, age: 255 };
    this.passAge = 255;
    this.holder = -1;
    this.arm();
  }

  arm() {
    const alive = this.aliveList();
    if (alive.length < 2) {
      // Nobody to pass to: the survivor takes the round.
      if (alive.length === 1 && this.n > 1) this.scores[alive[0]] += 1;
      this.holder = alive.length === 1 && this.n === 1 ? alive[0] : -1;
      if (this.n === 1 && alive.length === 1) { this.lightFuse(1); return; }
      this.phase = PHASE.BLAST;
      this.timer = BLAST_TICKS;
      return;
    }
    this.holder = this.rng.pick(alive);
    this.lightFuse(alive.length);
  }

  lightFuse(aliveCount) {
    const lo = 150 + 30 * Math.min(aliveCount, 5);
    this.fuseMax = this.rng.int(lo, lo + 105);
    this.fuse = this.fuseMax;
    this.overtime = this.rng.int(0, OVERTIME_MAX);
    this.phase = PHASE.ARM;
    this.timer = ARM_TICKS;
    this.beat = 0;
    this.armed = true;
  }

  // A player who leaves for good is out of this round and every later one.
  disconnect(index) {
    if (index < 0 || index >= this.n || this.gone[index]) return;
    this.gone[index] = true;
    const q = this.p[index];
    if (!q.alive) return;
    q.alive = false;
    if (this.roundOver || this.phase === PHASE.BLAST) return;
    const alive = this.aliveList();
    if (this.holder === index || alive.length < 2) this.arm();
  }

  move(i, intent, events) {
    const q = this.p[i];
    let mx = clampAxis(intent?.mx || 0);
    let my = clampAxis(intent?.my || 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    if (mx || my) { const m = Math.hypot(mx, my); q.fx = mx / m; q.fy = my / m; }
    const press = (intent?.dash || 0) > 0 ? 1 : 0;
    const edge = press && !q.held;
    q.held = press;

    if (!q.alive) {
      q.vx += (mx * GHOST_SPEED - q.vx) * ACCEL;
      q.vy += (my * GHOST_SPEED - q.vy) * ACCEL;
      q.x = Math.max(R, Math.min(this.w - R, q.x + q.vx));
      q.y = Math.max(R, Math.min(this.h - R, q.y + q.vy));
      if (edge && q.cd === 0 && !this.gone[i]) {
        q.cd = BOO_CD;
        events.boo.push(i);
        for (let j = 0; j < this.n; j++) {
          const o = this.p[j];
          if (!o.alive) continue;
          const dx = o.x - q.x, dy = o.y - q.y, dist = Math.hypot(dx, dy);
          if (dist >= BOO_R) continue;
          const ux = dist > 0.01 ? dx / dist : q.fx, uy = dist > 0.01 ? dy / dist : q.fy;
          const push = BOO_V * (1 - 0.5 * (dist / BOO_R));
          o.kx += ux * push;
          o.ky += uy * push;
        }
      }
      if (q.cd > 0 && !edge) q.cd -= 1;
      return;
    }

    if (q.stun > 0) { q.stun -= 1; mx = 0; my = 0; }
    const live = this.phase === PHASE.LIVE || this.phase === PHASE.OVERTIME;
    const top = SPEED * (i === this.holder && live ? HOLDER_BOOST : 1);
    q.vx += (mx * top - q.vx) * ACCEL;
    q.vy += (my * top - q.vy) * ACCEL;
    if (edge && q.cd === 0 && q.stun === 0) {
      q.cd = DASH_CD + 1;
      q.dash = DASH_TICKS;
      q.dx = q.fx;
      q.dy = q.fy;
      events.dash.push(i);
    }
    let sx = q.vx + q.kx, sy = q.vy + q.ky;
    if (q.dash > 0) {
      const v = DASH_V * (q.dash / DASH_TICKS);
      sx += q.dx * v;
      sy += q.dy * v;
      q.dash -= 1;
    }
    q.kx *= 0.78;
    q.ky *= 0.78;
    if (Math.abs(q.kx) < 0.05) q.kx = 0;
    if (Math.abs(q.ky) < 0.05) q.ky = 0;
    q.x += sx;
    q.y += sy;
    if (q.cd > 0) q.cd -= 1;
    if (q.safe > 0) q.safe -= 1;
    this.collide(q);
  }

  collide(q) {
    for (const c of this.pillars) {
      const dx = q.x - c.x, dy = q.y - c.y, dist = Math.hypot(dx, dy), min = c.r + R;
      if (dist >= min) continue;
      if (dist < 0.01) { q.x = c.x + min; continue; }
      q.x = c.x + (dx / dist) * min;
      q.y = c.y + (dy / dist) * min;
    }
    q.x = Math.max(R, Math.min(this.w - R, q.x));
    q.y = Math.max(R, Math.min(this.h - R, q.y));
  }

  tryPass(events) {
    const h = this.holder;
    if (h < 0) return;
    const a = this.p[h];
    if (a.stun > 0) return;
    let best = -1, bestDist = 2 * R + 2;
    for (let j = 0; j < this.n; j++) {
      const b = this.p[j];
      if (j === h || !b.alive || b.safe > 0) continue;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < bestDist) { best = j; bestDist = dist; }
    }
    if (best < 0) return;
    const b = this.p[best];
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
    const ux = dist > 0.01 ? dx / dist : a.fx, uy = dist > 0.01 ? dy / dist : a.fy;
    a.kx -= ux * 7; a.ky -= uy * 7;
    b.kx += ux * 5; b.ky += uy * 5;
    b.stun = STUN_TICKS;
    b.dash = 0;
    a.safe = SAFE_TICKS;
    this.holder = best;
    this.passAge = 0;
    events.pass.push(best);
  }

  separate() {
    for (let i = 0; i < this.n; i++) {
      const a = this.p[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = this.p[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
        if (dist >= 2 * R || dist < 0.01) continue;
        const push = (2 * R - dist) / 2;
        a.x -= (dx / dist) * push; a.y -= (dy / dist) * push;
        b.x += (dx / dist) * push; b.y += (dy / dist) * push;
        this.collide(a);
        this.collide(b);
      }
    }
  }

  explode(events) {
    const h = this.holder;
    const a = this.p[h];
    a.alive = false;
    a.cd = 0;
    a.vx = a.vy = a.kx = a.ky = 0;
    this.blast = { x: a.x, y: a.y, age: 0 };
    events.d.push(h);
    this.holder = -1;
    const alive = this.aliveList();
    for (const j of alive) {
      this.scores[j] += 1;
      const b = this.p[j];
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
      if (dist < BLAST_R && dist > 0.01) {
        const push = 16 * (1 - dist / BLAST_R);
        b.kx += (dx / dist) * push;
        b.ky += (dy / dist) * push;
      }
    }
    if (alive.length === 1) this.scores[alive[0]] += 1;
    this.phase = PHASE.BLAST;
    this.timer = BLAST_TICKS;
  }

  step(intents) {
    const events = { d: [], pass: [], dash: [], boo: [], tk: [], hot: [], arm: [] };
    if (!this.roundOver) {
      this.tick += 1;
      if (this.armed) { this.armed = false; if (this.holder >= 0) events.arm.push(this.holder); }
      if (this.blast.age < 255) this.blast.age += 1;
      if (this.passAge < 255) this.passAge += 1;
      for (let i = 0; i < this.n; i++) this.move(i, intents[i], events);

      if (this.phase === PHASE.ARM) {
        this.timer -= 1;
        if (this.timer <= 0) this.phase = PHASE.LIVE;
      } else if (this.phase === PHASE.LIVE) {
        this.tryPass(events);
        this.fuse -= 1;
        this.beat -= 1;
        if (this.beat <= 0) {
          this.beat = Math.round(4 + 24 * (this.fuse / this.fuseMax));
          events.tk.push(this.holder);
        }
        if (this.fuse <= 0) {
          this.fuse = 0;
          this.phase = PHASE.OVERTIME;
          this.timer = this.overtime;
        }
      } else if (this.phase === PHASE.OVERTIME) {
        this.tryPass(events);
        if (this.timer % 3 === 0) events.hot.push(this.holder);
        this.timer -= 1;
        if (this.timer < 0) this.explode(events);
      } else if (this.phase === PHASE.BLAST) {
        this.timer -= 1;
        if (this.timer <= 0) {
          if (this.aliveList().length >= 2) this.arm();
          else { this.phase = PHASE.DONE; this.roundOver = true; }
        }
      }
      this.separate();
    }
    const p = this.p;
    return {
      k: this.tick,
      over: this.roundOver,
      ph: this.phase,
      t: Math.max(0, Math.min(255, this.timer)),
      holder: this.holder,
      fuse: this.fuse,
      fuseMax: this.fuseMax,
      x: p.map((q) => r1(q.x)),
      y: p.map((q) => r1(q.y)),
      alive: p.map((q) => q.alive),
      stun: p.map((q) => q.stun > 0),
      safe: p.map((q) => q.safe > 0),
      dashing: p.map((q) => q.dash > 0),
      cd: p.map((q) => Math.min(255, q.cd)),
      bx: Math.round(this.blast.x),
      by: Math.round(this.blast.y),
      bAge: this.blast.age,
      pAge: this.passAge,
      d: events.d,
      pass: events.pass,
      dash: events.dash,
      boo: events.boo,
      tk: events.tk,
      hot: events.hot,
      arm: events.arm,
    };
  }

  winner(target) {
    const best = Math.max(...this.scores);
    if (best < target) return -1;
    return this.scores.filter((score) => score === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x", "y"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    ph: { type: "uint", bits: 8 },
    t: { type: "uint", bits: 8 },
    holder: { type: "int", bits: 8 },
    fuse: { type: "uint", bits: 16 },
    fuseMax: { type: "uint", bits: 16 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    alive: { type: "bool", per: "player" },
    stun: { type: "bool", per: "player" },
    safe: { type: "bool", per: "player" },
    dashing: { type: "bool", per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    bx: { type: "uint", bits: 16 },
    by: { type: "uint", bits: 16 },
    bAge: { type: "uint", bits: 8 },
    pAge: { type: "uint", bits: 8 },
    d: { type: "players" },
    pass: { type: "players" },
    dash: { type: "players" },
    boo: { type: "players" },
    tk: { type: "players" },
    hot: { type: "players" },
    arm: { type: "players" },
  },
};

export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 },
  my: { min: -1, max: 1, neutral: 0 },
  dash: { values: [0, 1], neutral: 0 },
};
