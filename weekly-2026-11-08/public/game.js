export const ARENA = { w: 640, h: 620 };
export const READY_TICKS = 60;
export const PLAY_TICKS = 900;
export const TARGET = 20;
export const REPEAT_TICKS = 7;
export const ALL = 511;
const DIRS = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]];

export function rotate(mask, turns = 1) {
  for (let i = 0; i < turns; i++) mask = ((mask << 1) & 15) | (mask >> 3);
  return mask;
}
export const tileAt = (tiles, rot, cell) => rotate(tiles[cell], (rot >> (cell * 2)) & 3);
export const countLit = (mask) => { let count = 0; for (; mask; mask &= mask - 1) count++; return count; };

export function light(tiles, rot) {
  if (!(tileAt(tiles, rot, 0) & 8)) return 0;
  let seen = 1;
  const queue = [0];
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q], mask = tileAt(tiles, rot, cell);
    for (const [dx, dy, bit, opposite] of DIRS) {
      const x = cell % 3 + dx, y = Math.floor(cell / 3) + dy;
      if (x < 0 || x > 2 || y < 0 || y > 2 || !(mask & bit)) continue;
      const next = y * 3 + x;
      if (!(seen & (1 << next)) && (tileAt(tiles, rot, next) & opposite)) {
        seen |= 1 << next;
        queue.push(next);
      }
    }
  }
  return seen;
}

// A constraint solver for the reviewer bot; it uses only the visible scrambled tiles.
export function solveBoard(tiles) {
  const masks = [];
  function visit(cell, packed) {
    if (cell === 9) return light(tiles, packed) === ALL ? packed : -1;
    const x = cell % 3, y = Math.floor(cell / 3), tried = new Set();
    for (let r = 0; r < 4; r++) {
      const m = rotate(tiles[cell], r);
      if (tried.has(m)) continue;
      tried.add(m);
      if (y === 0 && (m & 1) || y === 2 && (m & 4) || x === 2 && (m & 2)) continue;
      if (x === 0 && Boolean(m & 8) !== (cell === 0)) continue;
      if (y > 0 && Boolean(m & 1) !== Boolean(masks[cell - 3] & 4)) continue;
      if (x > 0 && Boolean(m & 8) !== Boolean(masks[cell - 1] & 2)) continue;
      masks[cell] = m;
      const result = visit(cell + 1, packed | (r << (cell * 2)));
      if (result >= 0) return result;
    }
    return -1;
  }
  return visit(0, 0);
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
    this.ready = 0;
    this.left = 0;
    this.claimed = false;
    this.tiles = Array(9).fill(0);
    this.p = Array.from({ length: playerCount }, () => this.pawn());
  }
  pawn() { return { rot: 0, cursor: 0, lit: 0, done: false, assist: false, flash: 0, award: 0, held: false, direction: 0, repeat: 0 }; }
  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = PLAY_TICKS;
    this.claimed = false;
    const solution = Array(9).fill(0), visited = new Set([0]), stack = [0];
    while (stack.length) {
      const cell = stack[stack.length - 1];
      const options = DIRS.filter(([dx, dy]) => {
        const x = cell % 3 + dx, y = Math.floor(cell / 3) + dy;
        return x >= 0 && x < 3 && y >= 0 && y < 3 && !visited.has(y * 3 + x);
      });
      if (!options.length) { stack.pop(); continue; }
      const [dx, dy, bit, opposite] = this.rng.pick(options);
      const next = cell + dx + dy * 3;
      solution[cell] |= bit;
      solution[next] |= opposite;
      visited.add(next);
      stack.push(next);
    }
    solution[0] |= 8;
    const scramble = solution.map(() => this.rng.int(0, 3));
    this.tiles = solution.map((mask, i) => rotate(mask, scramble[i]));
    if (light(this.tiles, 0) === ALL) this.tiles[0] = rotate(this.tiles[0]);
    const best = Math.max(0, ...this.scores.filter((_, i) => this.active[i]));
    this.p = this.p.map((_, i) => {
      const p = this.pawn();
      p.assist = this.active[i] && this.scores[i] < best;
      if (p.assist) p.rot = ((4 - scramble[4]) % 4) << 8;
      p.lit = this.active[i] ? light(this.tiles, p.rot) : 0;
      return p;
    });
  }
  disconnect(index) { this.active[index] = false; }
  step(intents) {
    this.tick++;
    const moved = [], turned = [], solved = [], scored = [];
    let beep = false, go = false, finished = false;
    if (!this.roundOver) {
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i], intent = intents[i] || {};
        const pressed = (intent.turn || 0) > 0;
        const mx = Math.abs(intent.mx || 0) > 0.3 ? Math.sign(intent.mx) : 0;
        const my = Math.abs(intent.my || 0) > 0.3 ? Math.sign(intent.my) : 0;
        const direction = mx || my * 3;
        const edge = pressed && !p.held;
        p.held = pressed;
        if (p.flash > 0) p.flash--;
        if (this.active[i] && !this.ready && !p.done) {
          if (direction && (direction !== p.direction || p.repeat === 0)) {
            const x = p.cursor % 3, y = Math.floor(p.cursor / 3);
            const nx = Math.max(0, Math.min(2, x + mx));
            const ny = Math.max(0, Math.min(2, y + (mx ? 0 : my)));
            const next = ny * 3 + nx;
            if (next !== p.cursor) { p.cursor = next; moved.push(i); }
            p.repeat = REPEAT_TICKS;
          }
          if (p.repeat > 0) p.repeat--;
          if (edge) {
            const shift = p.cursor * 2;
            const r = (((p.rot >> shift) & 3) + 1) % 4;
            p.rot = (p.rot & ~(3 << shift)) | (r << shift);
            p.flash = 8;
            turned.push(i);
          }
          p.lit = light(this.tiles, p.rot);
          if (p.lit === ALL) { p.done = true; solved.push(i); }
        }
        p.direction = direction;
      }
      if (!this.active.some(Boolean)) { this.roundOver = true; finished = true; }
      else if (this.ready > 0) {
        beep = this.ready % 20 === 0;
        this.ready--;
        go = this.ready === 0;
      } else {
        for (const i of solved) {
          this.p[i].award = this.claimed ? 5 : 7;
          this.scores[i] += this.p[i].award;
          scored.push(i);
        }
        if (solved.length) this.claimed = true;
        this.left--;
        if (this.left === 0) {
          for (let i = 0; i < this.n; i++) {
            if (!this.active[i] || this.p[i].done) continue;
            const award = Math.floor(countLit(this.p[i].lit) / 3);
            this.p[i].award = award;
            this.scores[i] += award;
            if (award) scored.push(i);
          }
          this.roundOver = true;
          finished = true;
        }
      }
    }
    const values = (key) => this.p.map((p) => p[key]);
    return {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      tiles: [...this.tiles], claimed: this.claimed, active: [...this.active],
      rot: values("rot"), cursor: values("cursor"), lit: values("lit"), done: values("done"),
      assist: values("assist"), flash: values("flash"), award: values("award"),
      moved, turned, solved, scored, beep, go, finished,
    };
  }
  winner(target) {
    const best = Math.max(-1, ...this.scores.filter((_, i) => this.active[i]));
    const seats = this.scores.flatMap((score, i) => this.active[i] && score === best ? [i] : []);
    return best >= target && seats.length === 1 ? seats[0] : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k", interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    tiles: { type: "uint", bits: 8, count: 9 }, claimed: { type: "bool" },
    rot: { type: "uint", bits: 32, per: "player" }, cursor: { type: "uint", bits: 8, per: "player" },
    lit: { type: "uint", bits: 16, per: "player" },
    done: { type: "bool", per: "player" }, active: { type: "bool", per: "player" }, assist: { type: "bool", per: "player" },
    flash: { type: "uint", bits: 8, per: "player" }, award: { type: "uint", bits: 8, per: "player" },
    moved: { type: "players" }, turned: { type: "players" }, solved: { type: "players" }, scored: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 },
  my: { min: -1, max: 1, neutral: 0 },
  turn: { values: [0, 1], neutral: 0 },
};
