export const ARENA = { w: 540, h: 480 };
export const READY_TICKS = 60;
export const SHIFT_TICKS = 1050;
export const HOLD_TICKS = 24;
export const REPEAT_TICKS = 9;
export const REPAIRS = 8;
export const TARGET = 30;
export const PORTS = [5, 10, 3, 6, 12, 9];
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const PATHS = [
  [0, 1, 4, 3, 6, 7, 8, 5, 2], [3, 0, 1, 2, 5],
  [6, 3, 0, 1, 4, 7, 8, 5, 2], [0, 3, 6, 7, 4, 1, 2],
  [3, 6, 7, 4, 1, 2, 5], [6, 7, 4, 3, 0, 1, 2, 5, 8],
  [0, 1, 4, 7, 8], [6, 7, 4, 1, 2],
];
export const tileAt = (board, cell) => (board >>> (cell * 3)) & 7;
export const setTile = (board, cell, code) => (board & ~(7 << (cell * 3))) | (code << (cell * 3));
export const rotate = (code) => code < 2 ? 1 - code : 2 + (code - 1) % 4;
const sideTo = (a, b) => b === a - 3 ? 0 : b === a + 1 ? 1 : b === a + 3 ? 2 : 3;

export function trace(board, inlet, outlet) {
  let cell = inlet * 3, entry = 3, wet = 0;
  for (let count = 0; count < 9; count++) {
    const ports = PORTS[tileAt(board, cell)];
    if (!(ports & (1 << entry)) || (wet & (1 << cell))) return { wet, complete: false };
    wet |= 1 << cell;
    const exit = [0, 1, 2, 3].find((d) => d !== entry && (ports & (1 << d)));
    const x = cell % 3 + DX[exit], y = Math.floor(cell / 3) + DY[exit];
    if (x < 0 || x > 2 || y < 0 || y > 2) return { wet, complete: x === 3 && y === outlet };
    cell = y * 3 + x;
    entry = (exit + 2) % 4;
  }
  return { wet, complete: false };
}

// A visible-board solver for the test bot: chooses the least clockwise work.
export function plan(board, inlet, outlet) {
  let best = [], cost = Infinity;
  function visit(cell, entry, seen, path, spent) {
    if (seen & (1 << cell) || spent >= cost) return;
    const original = tileAt(board, cell);
    let code = original;
    for (let turns = 0; turns < (original < 2 ? 2 : 4); turns++, code = rotate(code)) {
      if (!(PORTS[code] & (1 << entry))) continue;
      const exit = [0, 1, 2, 3].find((d) => d !== entry && (PORTS[code] & (1 << d)));
      const x = cell % 3 + DX[exit], y = Math.floor(cell / 3) + DY[exit];
      const next = [...path, { cell, code }], total = spent + turns;
      if (x === 3 && y === outlet && total < cost) { best = next; cost = total; }
      else if (x >= 0 && x < 3 && y >= 0 && y < 3) visit(y * 3 + x, (exit + 2) % 4, seen | (1 << cell), next, total);
    }
  }
  visit(inlet * 3, 3, 0, [], 0);
  return best;
}

function puzzle(rng) {
  const path = rng.pick(PATHS);
  const inlet = Math.floor(path[0] / 3), outlet = Math.floor(path[path.length - 1] / 3);
  let board = 0;
  for (let cell = 0; cell < 9; cell++) board = setTile(board, cell, rng.int(0, 5));
  path.forEach((cell, index) => {
    const entry = index ? sideTo(cell, path[index - 1]) : 3;
    const exit = index + 1 < path.length ? sideTo(cell, path[index + 1]) : 1;
    let code = PORTS.indexOf((1 << entry) | (1 << exit));
    const turns = rng.int(0, 3);
    for (let i = 0; i < turns; i++) code = rotate(code);
    board = setTile(board, cell, code);
  });
  while (trace(board, inlet, outlet).complete) board = setTile(board, path[0], rotate(tileAt(board, path[0])));
  return { board, inlet, outlet };
}

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
    this.p = [];
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = SHIFT_TICKS;
    this.queue = Array.from({ length: REPAIRS }, () => puzzle(this.rng));
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.p = Array.from({ length: this.n }, (_, i) => ({
      ...this.queue[0], cursor: 0, done: 0, pause: 0, award: 0,
      assist: best - this.scores[i] >= 6, held: false, direction: 0, repeat: 0,
    }));
  }

  disconnect(index) { this.gone[index] = true; }

  step(intents) {
    this.tick++;
    const moved = [], turned = [], repaired = [];
    let beep = false, go = false, finished = false;
    if (!this.roundOver) {
      const inspecting = this.ready > 0;
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i];
        const select = intents[i]?.select === -1 ? -1 : intents[i]?.select === 1 ? 1 : 0;
        const held = intents[i]?.turn === 1;
        const press = held && !p.held;
        const move = select !== 0 && (select !== p.direction || p.repeat === 0);
        p.held = held;
        p.direction = select;
        p.repeat = move ? REPEAT_TICKS - 1 : Math.max(0, p.repeat - 1);
        if (this.gone[i] || inspecting || p.done >= REPAIRS) continue;
        if (p.pause > 0) {
          p.pause--;
          if (p.pause === 0) Object.assign(p, this.queue[p.done], { cursor: 0 });
          continue;
        }
        if (move) { p.cursor = (p.cursor + select + 9) % 9; moved.push(i); }
        if (press) {
          p.board = setTile(p.board, p.cursor, rotate(tileAt(p.board, p.cursor)));
          turned.push(i);
          if (trace(p.board, p.inlet, p.outlet).complete) {
            p.done++;
            p.award = p.assist ? 5 : 4;
            this.scores[i] += p.award;
            p.pause = HOLD_TICKS;
            repaired.push(i);
          }
        }
      }
      if (inspecting) { beep = this.ready % 20 === 0; this.ready--; go = this.ready === 0; }
      else this.left--;
      if (this.left === 0 || this.gone.every(Boolean)) { this.roundOver = true; finished = true; }
    }
    return {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      board: this.p.map((p) => p.board), cursor: this.p.map((p) => p.cursor),
      inlet: this.p.map((p) => p.inlet), outlet: this.p.map((p) => p.outlet),
      wet: this.p.map((p) => trace(p.board, p.inlet, p.outlet).wet),
      done: this.p.map((p) => p.done), pause: this.p.map((p) => p.pause),
      award: this.p.map((p) => p.award), assist: this.p.map((p) => p.assist),
      active: this.gone.map((gone) => !gone), moved, turned, repaired, beep, go, finished,
    };
  }

  winner(target) {
    const eligible = this.scores.map((s, i) => this.gone[i] ? -1 : s);
    const best = Math.max(...eligible);
    return best >= target && eligible.filter((s) => s === best).length === 1 ? eligible.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k", interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    board: { type: "uint", bits: 32, per: "player" },
    cursor: { type: "uint", bits: 8, per: "player" },
    inlet: { type: "uint", bits: 8, per: "player" },
    outlet: { type: "uint", bits: 8, per: "player" },
    wet: { type: "uint", bits: 16, per: "player" },
    done: { type: "uint", bits: 8, per: "player" },
    pause: { type: "uint", bits: 8, per: "player" },
    award: { type: "uint", bits: 8, per: "player" },
    active: { type: "bool", per: "player" }, assist: { type: "bool", per: "player" },
    moved: { type: "players" }, turned: { type: "players" }, repaired: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, finished: { type: "bool" },
  },
};

export const INTENT = {
  select: { values: [-1, 0, 1], neutral: 0 },
  turn: { values: [0, 1], neutral: 0 },
};
