export const ARENA = { w: 640, h: 660 };
export const TARGET = 70;
export const READY_TICKS = 60;
export const ROUTE_TICKS = 210;
export const REVEAL_TICKS = 30;
export const PUZZLES = 5;
export const PHASE = { READY: 0, ROUTE: 1, REVEAL: 2, DONE: 3 };
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const opposite = (d) => (d + 2) % 4;
export const rotate = (mask, turns) => ((mask << turns) | (mask >> (4 - turns))) & 15;
export const rotationsOf = (snap, seat) => Array.from({ length: 9 }, (_, j) => snap[`r${j}`][seat]);

export function neighbour(cell, d) {
  const x = cell % 3 + DX[d], y = Math.floor(cell / 3) + DY[d];
  return x >= 0 && x < 3 && y >= 0 && y < 3 ? y * 3 + x : -1;
}

export function trace(tiles, rotations, inlet, outlet) {
  const cells = [];
  let cell = inlet * 3, enter = 3;
  for (let k = 0; k < 9; k++) {
    const mask = rotate(tiles[cell], rotations[cell]);
    if (!(mask & (1 << enter))) return { cells, solved: false, blocked: cell, exit: enter };
    cells.push(cell);
    const exit = [0, 1, 2, 3].find((d) => d !== enter && (mask & (1 << d)));
    if (cell === outlet * 3 + 2 && exit === 1) return { cells, solved: true, blocked: cell, exit };
    const next = neighbour(cell, exit);
    if (next < 0 || cells.includes(next)) return { cells, solved: false, blocked: cell, exit };
    cell = next;
    enter = opposite(exit);
  }
  return { cells, solved: false, blocked: cell, exit: enter };
}

function paths(inlet, outlet) {
  const found = [], end = outlet * 3 + 2;
  function walk(path) {
    const cell = path[path.length - 1];
    if (cell === end) { found.push(path); return; }
    for (let d = 0; d < 4; d++) {
      const next = neighbour(cell, d);
      if (next >= 0 && !path.includes(next)) walk([...path, next]);
    }
  }
  walk([inlet * 3]);
  return found;
}

function masksFor(path) {
  return path.map((cell, i) => {
    const prev = i ? [0, 1, 2, 3].find((d) => neighbour(cell, d) === path[i - 1]) : 3;
    const next = i < path.length - 1 ? [0, 1, 2, 3].find((d) => neighbour(cell, d) === path[i + 1]) : 1;
    return (1 << prev) | (1 << next);
  });
}

// A pure minimum-click route planner, used by the review bot, not by the simulation.
export function planRoute(tiles, rotations, inlet, outlet) {
  let best = null, bestCost = Infinity;
  for (const path of paths(inlet, outlet)) {
    const masks = masksFor(path), plan = [];
    let cost = 0;
    for (let j = 0; j < path.length; j++) {
      const cell = path[j];
      let turns = 0;
      while (turns < 4 && rotate(tiles[cell], (rotations[cell] + turns) % 4) !== masks[j]) turns++;
      if (turns === 4) { cost = Infinity; break; }
      cost += turns;
      plan.push({ cell, turns });
    }
    if (cost < bestCost) { bestCost = cost; best = plan; }
  }
  return best;
}

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.arena = opts.arena;
    this.rng = rng;
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.active = Array(playerCount).fill(true);
    this.tiles = Array(9).fill(3);
    this.rot = Array.from({ length: playerCount }, () => Array(9).fill(0));
    this.cursor = Array(playerCount).fill(0);
    this.flash = Array(playerCount).fill(0);
    this.done = Array(playerCount).fill(false);
    this.award = Array(playerCount).fill(0);
    this.total = Array(playerCount).fill(0);
    this.held = Array(playerCount).fill(false);
    this.direction = Array(playerCount).fill(0);
    this.repeat = Array(playerCount).fill(0);
    this.phase = PHASE.DONE;
    this.t = 0;
    this.puzzle = 0;
    this.inlet = 0;
    this.outlet = 0;
    this.claimed = false;
  }

  makePuzzle() {
    this.inlet = this.rng.int(0, 2);
    this.outlet = this.rng.int(0, 2);
    const route = this.rng.pick(paths(this.inlet, this.outlet).filter((p) => p.length >= 4 && p.length <= 7));
    const masks = masksFor(route);
    this.tiles = Array.from({ length: 9 }, () => this.rng.pick([3, 5]));
    route.forEach((cell, j) => { this.tiles[cell] = masks[j] === 5 || masks[j] === 10 ? 5 : 3; });
    const initial = Array.from({ length: 9 }, () => this.rng.int(0, 3));
    // Break an accidentally complete scramble at the inlet, without a retry loop.
    while (trace(this.tiles, initial, this.inlet, this.outlet).solved) initial[this.inlet * 3] = (initial[this.inlet * 3] + 1) % 4;
    this.rot = Array.from({ length: this.n }, () => [...initial]);
    this.cursor.fill(this.inlet * 3);
    this.done.fill(false);
    this.flash.fill(0);
    this.award.fill(0);
    this.claimed = false;
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.phase = PHASE.READY;
    this.t = READY_TICKS;
    this.puzzle = 0;
    this.total.fill(0);
    this.held.fill(false);
    this.direction.fill(0);
    this.repeat.fill(0);
    this.makePuzzle();
  }

  disconnect(index) { this.active[index] = false; }

  step(intents) {
    this.tick++;
    const moved = [], turned = [], solved = [];
    let beep = false, opened = false, revealed = false, finished = false;
    if (!this.roundOver) {
      for (let i = 0; i < this.n; i++) {
        const mx = Math.sign(intents[i]?.mx || 0), my = Math.sign(intents[i]?.my || 0);
        const dir = my ? (my > 0 ? 3 : 1) : mx ? (mx > 0 ? 2 : 4) : 0;
        const pressing = (intents[i]?.turn || 0) > 0;
        const edge = pressing && !this.held[i];
        this.held[i] = pressing;
        if (this.flash[i] > 0) this.flash[i]--;
        const move = dir && (dir !== this.direction[i] || this.repeat[i] === 0);
        this.direction[i] = dir;
        this.repeat[i] = move ? 5 : Math.max(0, this.repeat[i] - 1);
        if (!this.active[i] || this.done[i] || this.phase !== PHASE.ROUTE) continue;
        if (move) {
          const next = neighbour(this.cursor[i], dir - 1);
          if (next >= 0) { this.cursor[i] = next; moved.push(i); }
        }
        if (edge) {
          const cell = this.cursor[i];
          this.rot[i][cell] = (this.rot[i][cell] + 1) % 4;
          this.flash[i] = 8;
          turned.push(i);
          if (trace(this.tiles, this.rot[i], this.inlet, this.outlet).solved) solved.push(i);
        }
      }
      for (const i of solved) {
        this.done[i] = true;
        this.award[i] = (this.claimed ? 4 : 7) * (this.puzzle >= 3 ? 2 : 1);
        this.scores[i] += this.award[i];
        this.total[i] += this.award[i];
      }
      if (solved.length) this.claimed = true;
      if (this.phase === PHASE.READY) beep = this.t % 30 === 0;
      this.t = Math.max(0, this.t - 1);
      if (!this.active.some(Boolean)) {
        this.roundOver = true; this.phase = PHASE.DONE; finished = true;
      } else if (this.t === 0) {
        if (this.phase === PHASE.READY) {
          this.phase = PHASE.ROUTE; this.t = ROUTE_TICKS; opened = true;
        } else if (this.phase === PHASE.ROUTE) {
          this.phase = PHASE.REVEAL; this.t = REVEAL_TICKS; revealed = true;
        } else if (this.puzzle === PUZZLES - 1) {
          this.phase = PHASE.DONE; this.roundOver = true; finished = true;
        } else {
          this.puzzle++; this.makePuzzle(); this.phase = PHASE.ROUTE; this.t = ROUTE_TICKS; opened = true;
        }
      }
    }
    const snap = {
      k: this.tick, over: this.roundOver, phase: this.phase, t: this.t, puzzle: this.puzzle,
      inlet: this.inlet, outlet: this.outlet, tiles: [...this.tiles], claimed: this.claimed,
      cursor: [...this.cursor], flash: [...this.flash], done: [...this.done], active: [...this.active],
      award: [...this.award], total: [...this.total], moved, turned, solved, beep, opened, revealed, finished,
    };
    for (let j = 0; j < 9; j++) snap[`r${j}`] = this.rot.map((r) => r[j]);
    return snap;
  }

  winner(target) {
    const best = Math.max(-1, ...this.scores.filter((_, i) => this.active[i]));
    if (best < target) return -1;
    const leaders = this.scores.flatMap((s, i) => this.active[i] && s === best ? [i] : []);
    return leaders.length === 1 ? leaders[0] : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    phase: { type: "uint", bits: 8 },
    t: { type: "uint", bits: 16 },
    puzzle: { type: "uint", bits: 8 },
    inlet: { type: "uint", bits: 8 },
    outlet: { type: "uint", bits: 8 },
    tiles: { type: "uint", bits: 8, count: 9 },
    claimed: { type: "bool" },
    cursor: { type: "uint", bits: 8, per: "player" },
    flash: { type: "uint", bits: 8, per: "player" },
    award: { type: "uint", bits: 8, per: "player" },
    total: { type: "uint", bits: 8, per: "player" },
    done: { type: "bool", per: "player" },
    active: { type: "bool", per: "player" },
    ...Object.fromEntries(Array.from({ length: 9 }, (_, j) => [`r${j}`, { type: "uint", bits: 8, per: "player" }])),
    moved: { type: "players" }, turned: { type: "players" }, solved: { type: "players" },
    beep: { type: "bool" }, opened: { type: "bool" }, revealed: { type: "bool" }, finished: { type: "bool" },
  },
};

export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 },
  my: { min: -1, max: 1, neutral: 0 },
  turn: { values: [0, 1], neutral: 0 },
};
