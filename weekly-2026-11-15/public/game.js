// Copper Current: nine fittings, one continuous water route.
export const ARENA = { w: 640, h: 560 };
export const READY_TICKS = 60;
export const ROUND_TICKS = 1200;
export const FLUSH_TICKS = 24;
export const REPEAT_TICKS = 7;
export const TARGET = 32;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rotation = (packed, tile) => (packed >>> (tile * 2)) & 3;
export const setRotation = (packed, tile, value) => ((packed & ~(3 << (tile * 2))) | ((value & 3) << (tile * 2))) >>> 0;
export function ports(shape, packed, tile) {
  const r = rotation(packed, tile);
  return (1 << r) | (1 << ((r + ((shape >> tile) & 1 ? 1 : 2)) % 4));
}
export function neighbour(tile, d) {
  const x = tile % 3 + DX[d], y = Math.floor(tile / 3) + DY[d];
  return x < 0 || x > 2 || y < 0 || y > 2 ? -1 : y * 3 + x;
}

function allRoutes() {
  const routes = [];
  function visit(path, seen) {
    const t = path[path.length - 1];
    if (t === 8) { if (path.length === 9) routes.push(path); return; }
    for (let d = 0; d < 4; d++) {
      const next = neighbour(t, d);
      if (next >= 0 && !(seen & (1 << next))) visit([...path, next], seen | (1 << next));
    }
  }
  visit([0], 1);
  return routes;
}
export function routeBoard(route) {
  let shape = 0, pipes = 0;
  for (let j = 0; j < 9; j++) {
    const t = route[j];
    const dirTo = (other) => [0, 1, 2, 3].find((d) => neighbour(t, d) === other);
    const a = j === 0 ? 3 : dirTo(route[j - 1]);
    const b = j === 8 ? 1 : dirTo(route[j + 1]);
    const elbow = (a + 2) % 4 !== b;
    if (elbow) shape |= 1 << t;
    const r = elbow ? ((a + 1) % 4 === b ? a : b) : a % 2;
    pipes = setRotation(pipes, t, r);
  }
  return { shape, pipes };
}
export const BOARDS = allRoutes().map(routeBoard);
// Visible pipe types suffice to find a solution; the bot never reads hidden state.
export const solution = (shape) => BOARDS.find((board) => board.shape === shape)?.pipes ?? 0;
export function flow(shape, pipes) {
  let tile = 0, entry = 3, wet = 0;
  for (let count = 0; count < 9; count++) {
    const mask = ports(shape, pipes, tile);
    if (!(mask & (1 << entry))) return { wet, complete: false, tip: tile, dir: entry };
    wet |= 1 << tile;
    const exit = [0, 1, 2, 3].find((d) => d !== entry && (mask & (1 << d)));
    if (tile === 8 && exit === 1) return { wet, complete: wet === 511, tip: tile, dir: exit };
    const next = neighbour(tile, exit);
    if (next < 0 || (wet & (1 << next)) || !(ports(shape, pipes, next) & (1 << ((exit + 2) % 4)))) {
      return { wet, complete: false, tip: tile, dir: exit };
    }
    tile = next;
    entry = (exit + 2) % 4;
  }
  return { wet, complete: false, tip: tile, dir: entry };
}

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.arena = opts.arena;
    this.rng = rng;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.ready = 0;
    this.left = 0;
    this.last = -1;
    this.boards = [];
    this.claims = [];
    this.p = Array.from({ length: playerCount }, () => this.player());
  }
  player() {
    return { shape: 0, pipes: 0, wet: 0, cursor: 0, level: 0, flush: 0, flash: 0, award: 0, total: 0, held: false, dir: 0, repeat: 0 };
  }
  board(level) {
    while (this.boards.length <= level) {
      const base = this.rng.pick(BOARDS);
      let pipes = 0;
      for (let t = 0; t < 9; t++) pipes = setRotation(pipes, t, this.rng.int(0, 3));
      if (flow(base.shape, pipes).complete) pipes = setRotation(pipes, 0, rotation(pipes, 0) + 1);
      this.boards.push({ shape: base.shape, pipes });
    }
    return this.boards[level];
  }
  load(p) {
    Object.assign(p, this.board(p.level));
    p.wet = flow(p.shape, p.pipes).wet;
    p.cursor = 0;
    p.flash = 0;
  }
  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = ROUND_TICKS;
    this.last = -1;
    this.boards = [];
    this.claims = [];
    this.p = this.p.map((_, i) => {
      const p = this.player();
      if (!this.gone[i]) this.load(p);
      return p;
    });
  }
  disconnect(index) { this.gone[index] = true; }
  winner(target) {
    let best = -1, seat = -1, tie = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; tie = false; }
      else if (this.scores[i] === best) tie = true;
    }
    return best >= target && !tie ? seat : -1;
  }
  step(intents) {
    this.tick++;
    const moved = [], turned = [], repaired = [], loaded = [];
    let beep = false, go = false, hurry = false, finished = false;
    if (!this.roundOver) {
      const live = this.ready === 0;
      for (let i = 0; i < this.n; i++) {
        if (this.gone[i]) continue;
        const p = this.p[i];
        const mx = Math.sign(intents[i]?.mx || 0), my = Math.sign(intents[i]?.my || 0);
        const dir = mx ? (mx > 0 ? 2 : 4) : my ? (my > 0 ? 3 : 1) : 0;
        const pressed = (intents[i]?.turn || 0) > 0;
        const edge = pressed && !p.held;
        const move = dir && (dir !== p.dir || p.repeat === 0);
        p.held = pressed;
        p.dir = dir;
        p.repeat = move ? REPEAT_TICKS - 1 : Math.max(0, p.repeat - 1);
        if (p.flash > 0) p.flash--;
        if (!live) continue;
        if (p.flush > 0) {
          p.flush--;
          if (p.flush === 0) { p.level++; this.load(p); loaded.push(i); }
          continue;
        }
        if (move) {
          const x = clamp(p.cursor % 3 + DX[dir - 1], 0, 2);
          const y = clamp(Math.floor(p.cursor / 3) + DY[dir - 1], 0, 2);
          const next = y * 3 + x;
          if (next !== p.cursor) { p.cursor = next; moved.push(i); }
        }
        if (edge) {
          p.pipes = setRotation(p.pipes, p.cursor, rotation(p.pipes, p.cursor) + 1);
          p.flash = 6;
          turned.push(i);
          const result = flow(p.shape, p.pipes);
          p.wet = result.wet;
          if (result.complete) repaired.push(i);
        }
      }
      if (live) {
        const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
        for (const i of repaired) {
          const p = this.p[i];
          p.award = 3 + (this.claims[p.level] ? 0 : 1) + (best - this.scores[i] >= 6 ? 1 : 0);
          p.total += p.award;
          this.scores[i] += p.award;
          p.flush = FLUSH_TICKS;
        }
        for (const i of repaired) this.claims[this.p[i].level] = true;
        this.left--;
        hurry = this.left > 0 && this.left <= 150 && this.left % 30 === 0;
      } else {
        beep = this.ready % 20 === 0;
        this.ready--;
        go = this.ready === 0;
      }
      if (this.left === 0 || this.gone.every(Boolean)) {
        this.roundOver = true;
        finished = true;
        const best = Math.max(-1, ...this.p.map((p, i) => this.gone[i] ? -1 : p.total));
        const leaders = this.p.flatMap((p, i) => !this.gone[i] && p.total === best ? [i] : []);
        this.last = leaders.length === 1 ? leaders[0] : -1;
      }
    }
    const snap = { k: this.tick, over: this.roundOver, ready: this.ready, left: this.left, last: this.last, active: this.gone.map((g) => !g), moved, turned, repaired, loaded, beep, go, hurry, finished };
    for (const key of ["shape", "pipes", "wet", "cursor", "level", "flush", "flash", "award", "total"]) snap[key] = this.p.map((p) => p[key]);
    return snap;
  }
}

const per = (bits) => ({ type: "uint", bits, per: "player" });
export const SNAPSHOT = {
  tickField: "k", interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 }, last: { type: "int", bits: 8 },
    shape: per(16), pipes: per(32), wet: per(16), cursor: per(8), level: per(8),
    flush: per(8), flash: per(8), award: per(8), total: per(16), active: { type: "bool", per: "player" },
    moved: { type: "players" }, turned: { type: "players" }, repaired: { type: "players" }, loaded: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, hurry: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 }, my: { min: -1, max: 1, neutral: 0 }, turn: { values: [0, 1], neutral: 0 },
};
