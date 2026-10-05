// Achtung, die Kurve! Host-authoritative simulation. No DOM, no network, no
// timers: it runs headless in Node so every rule is unit-testable.
const SPEED = 2;
const TURN = 0.055;
const RADIUS = 3;
const FREEZE_TICKS = 90;
const GAP_LEN = 11;
const MARGIN = 60;

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts.arena;
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    this.grid = new Uint8Array(w * h);
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.curves = [];
  }

  startRound() {
    this.grid.fill(0);
    this.round += 1;
    this.tick = 0;
    this.freeze = FREEZE_TICKS;
    this.roundOver = false;
    this.curves = [];
    const spacing = Math.min(150, this.w / 4);
    for (let i = 0; i < this.n; i++) {
      let x;
      let y;
      let tries = 0;
      do {
        x = this.rng.range(MARGIN, this.w - MARGIN);
        y = this.rng.range(MARGIN, this.h - MARGIN);
        tries += 1;
      } while (tries < 50 && this.curves.some((c) => Math.hypot(c.x - x, c.y - y) < spacing));
      this.curves.push({
        x, y,
        a: Math.atan2(this.h / 2 - y, this.w / 2 - x) + this.rng.range(-0.7, 0.7),
        alive: true, gap: false, gapTimer: 0,
        nextGap: Math.floor(this.rng.range(60, 200)),
      });
    }
  }

  step(intents) {
    const deaths = [];
    if (this.freeze > 0) {
      this.freeze -= 1;
    } else if (!this.roundOver) {
      this.tick += 1;
      for (let i = 0; i < this.n; i++) {
        const c = this.curves[i];
        if (!c.alive) continue;
        c.a += (intents[i]?.turn || 0) * TURN;
        c.x += Math.cos(c.a) * SPEED;
        c.y += Math.sin(c.a) * SPEED;

        if (c.gapTimer > 0) { c.gapTimer -= 1; c.gap = true; }
        else if (c.nextGap <= 0) {
          c.gapTimer = GAP_LEN;
          c.nextGap = Math.floor(this.rng.range(90, 260));
          c.gap = true;
        } else { c.nextGap -= 1; c.gap = false; }

        if (this.collides(c)) { c.alive = false; deaths.push(i); continue; }
        if (!c.gap) this.mark(c.x, c.y, i + 1);
      }
      if (deaths.length) {
        for (let i = 0; i < this.n; i++) if (this.curves[i].alive) this.scores[i] += deaths.length;
      }
      const alive = this.curves.filter((c) => c.alive).length;
      if (alive <= (this.n > 1 ? 1 : 0)) this.roundOver = true;
    }
    return {
      k: this.tick,
      over: this.roundOver,
      x: this.curves.map((c) => Math.round(c.x * 10) / 10),
      y: this.curves.map((c) => Math.round(c.y * 10) / 10),
      alive: this.curves.map((c) => c.alive),
      gap: this.curves.map((c) => c.gap),
      d: deaths,
    };
  }

  collides(c) {
    const cos = Math.cos(c.a);
    const sin = Math.sin(c.a);
    const ahead = RADIUS + 2;
    const side = RADIUS - 1;
    const probes = [
      [c.x + cos * ahead, c.y + sin * ahead],
      [c.x + cos * ahead - sin * side, c.y + sin * ahead + cos * side],
      [c.x + cos * ahead + sin * side, c.y + sin * ahead - cos * side],
    ];
    for (const [px, py] of probes) {
      const ix = px | 0;
      const iy = py | 0;
      if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return true;
      if (this.grid[iy * this.w + ix]) return true;
    }
    return false;
  }

  mark(x, y, value) {
    const cx = x | 0;
    const cy = y | 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (dx * dx + dy * dy > RADIUS * RADIUS) continue;
        const ix = cx + dx;
        const iy = cy + dy;
        if (ix >= 0 && iy >= 0 && ix < this.w && iy < this.h) this.grid[iy * this.w + ix] = value;
      }
    }
  }

  winner(target) {
    const best = Math.max(...this.scores);
    if (best < target) return -1;
    return this.scores.filter((s) => s === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x", "y"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    alive: { type: "bool", per: "player" },
    gap: { type: "bool", per: "player" },
    d: { type: "players" },
  },
};

export const INTENT = { turn: { min: -1, max: 1, neutral: 0 } };
