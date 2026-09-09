// Host-authoritative simulation. Runs only on the host tab; every tick
// produces a snapshot that all peers (host included) render.
export const TICK_HZ = 60;
// Arena area grows with player count; presets scale it further.
export const MAP = {
  baseW: 800,
  baseH: 600,
  perPlayer: 0.35,
  presets: { small: 0.7, normal: 1, large: 1.4, huge: 2 },
};

export function mapSize(players, scale = 1) {
  const f = Math.sqrt((1 + Math.max(0, players - 1) * MAP.perPlayer) * scale);
  const snap = (v) => Math.round(v / 4) * 4;
  return { w: snap(MAP.baseW * f), h: snap(MAP.baseH * f) };
}
const SPEED = 2;
const TURN = 0.055;
const R = 3;
const FREEZE_TICKS = 90;
const GAP_LEN = 11;
const MARGIN = 60;

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

export class Game {
  constructor(playerCount, { w, h } = mapSize(playerCount)) {
    this.n = playerCount;
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
    for (let i = 0; i < this.n; i++) {
      const { w, h } = this;
      const spacing = Math.min(150, w / 4);
      let x, y;
      do {
        x = rnd(MARGIN, w - MARGIN);
        y = rnd(MARGIN, h - MARGIN);
      } while (this.curves.some((c) => Math.hypot(c.x - x, c.y - y) < spacing));
      this.curves.push({
        x,
        y,
        a: Math.atan2(h / 2 - y, w / 2 - x) + rnd(-0.7, 0.7),
        alive: true,
        gap: false,
        gapTimer: 0,
        nextGap: Math.floor(rnd(60, 200)),
      });
    }
  }

  // inputs: array of -1 | 0 | 1 per player index
  step(inputs) {
    const deaths = [];
    if (this.freeze > 0) {
      this.freeze -= 1;
    } else if (!this.roundOver) {
      this.tick += 1;
      for (let i = 0; i < this.n; i++) {
        const c = this.curves[i];
        if (!c.alive) continue;
        c.a += (inputs[i] || 0) * TURN;
        c.x += Math.cos(c.a) * SPEED;
        c.y += Math.sin(c.a) * SPEED;

        if (c.gapTimer > 0) {
          c.gapTimer -= 1;
          c.gap = true;
        } else if (c.nextGap <= 0) {
          c.gapTimer = GAP_LEN;
          c.nextGap = Math.floor(rnd(90, 260));
          c.gap = true;
        } else {
          c.nextGap -= 1;
          c.gap = false;
        }

        if (this.collides(c)) {
          c.alive = false;
          deaths.push(i);
          continue;
        }
        if (!c.gap) this.mark(c.x, c.y, i + 1);
      }
      if (deaths.length) {
        for (let i = 0; i < this.n; i++) {
          if (this.curves[i].alive) this.scores[i] += deaths.length;
        }
      }
      const alive = this.curves.filter((c) => c.alive).length;
      if (alive <= (this.n > 1 ? 1 : 0)) this.roundOver = true;
    }
    return {
      t: "s",
      k: this.tick,
      p: this.curves.map((c) => [
        Math.round(c.x * 10) / 10,
        Math.round(c.y * 10) / 10,
        c.alive ? 1 : 0,
        c.gap ? 1 : 0,
      ]),
      d: deaths,
      over: this.roundOver,
    };
  }

  collides(c) {
    const cos = Math.cos(c.a);
    const sin = Math.sin(c.a);
    const ahead = R + 2;
    const side = R - 1;
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

  mark(x, y, v) {
    const cx = x | 0;
    const cy = y | 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const ix = cx + dx;
        const iy = cy + dy;
        if (ix >= 0 && iy >= 0 && ix < this.w && iy < this.h) this.grid[iy * this.w + ix] = v;
      }
    }
  }

  winner(target) {
    const best = Math.max(...this.scores);
    if (best < target) return -1;
    const leaders = this.scores.filter((s) => s === best).length;
    return leaders === 1 ? this.scores.indexOf(best) : -1;
  }
}

export const COLORS = [
  "#ff4b4b", "#4bff7a", "#4ba8ff", "#ffd24b",
  "#ff4bd8", "#4bfff0", "#ff9a4b", "#c04bff",
];
