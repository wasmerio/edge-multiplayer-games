export const ARENA = { w: 480, h: 480 };
export const READY_TICKS = 60;
export const LIVE_TICKS = 1350;
export const REPAIR_TICKS = 18;
export const CIRCUITS = 4;
export const TARGET = 60;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

export function ports(types, board, tile) {
  const base = (types >> tile) & 1 ? 5 : 3;
  const rotation = (board >> (tile * 2)) & 3;
  return ((base << rotation) | (base >> (4 - rotation))) & 15;
}

export function neighbour(tile, direction) {
  const x = tile % 3 + DX[direction], y = Math.floor(tile / 3) + DY[direction];
  return x < 0 || x > 2 || y < 0 || y > 2 ? -1 : y * 3 + x;
}

export function powered(types, board) {
  if (!(ports(types, board, 0) & 8)) return 0;
  let mask = 1;
  const queue = [0];
  for (let at = 0; at < queue.length; at++) {
    const tile = queue[at], links = ports(types, board, tile);
    for (let d = 0; d < 4; d++) {
      const next = neighbour(tile, d);
      if (next < 0 || (mask & (1 << next)) || !(links & (1 << d))) continue;
      if (ports(types, board, next) & (1 << ((d + 2) % 4))) {
        mask |= 1 << next;
        queue.push(next);
      }
    }
  }
  return mask;
}
export const connected = (types, board) => !!((powered(types, board) & 256) && (ports(types, board, 8) & 2));
export const turnTile = (board, tile) => (board & ~(3 << (tile * 2))) | ((((board >> (tile * 2)) + 1) & 3) << (tile * 2));

function routes() {
  const result = [];
  function visit(path, mask) {
    const last = path[path.length - 1];
    if (last === 8) { if (path.length >= 7) result.push(path); return; }
    for (let d = 0; d < 4; d++) {
      const next = neighbour(last, d);
      if (next >= 0 && !(mask & (1 << next))) visit([...path, next], mask | (1 << next));
    }
  }
  visit([0], 1);
  return result;
}
const ROUTES = routes();
function routeMasks(path) {
  return path.map((tile, i) => {
    const before = i === 0 ? 3 : [0, 1, 2, 3].find((d) => neighbour(tile, d) === path[i - 1]);
    const after = i === path.length - 1 ? 1 : [0, 1, 2, 3].find((d) => neighbour(tile, d) === path[i + 1]);
    return (1 << before) | (1 << after);
  });
}

// A visible-topology solver for the test bot: unused tracks retain their orientation.
export function solution(types, board = 0) {
  for (const path of ROUTES) {
    const masks = routeMasks(path);
    let candidate = board, valid = true;
    for (let i = 0; i < path.length; i++) {
      const tile = path[i];
      let found = false;
      for (let r = 0; r < 4; r++) {
        if (ports(types, r << (tile * 2), tile) !== masks[i]) continue;
        candidate = (candidate & ~(3 << (tile * 2))) | (r << (tile * 2));
        found = true;
        break;
      }
      if (!found) { valid = false; break; }
    }
    if (valid) return candidate;
  }
  return -1;
}

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.rng = rng;
    this.scores = Array(playerCount).fill(0);
    this.active = Array(playerCount).fill(true);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.ready = 0;
    this.left = LIVE_TICKS;
    this.types = Array(CIRCUITS).fill(0);
    this.starts = Array(CIRCUITS).fill(0);
    this.claimed = 0;
    this.p = Array.from({ length: playerCount }, () => this.player());
  }
  player() {
    return { board: this.starts[0], cursor: 0, stage: 0, power: powered(this.types[0], this.starts[0]), flash: 0, earned: 0, held: false, direction: 0, repeat: 0 };
  }
  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.ready = READY_TICKS;
    this.left = LIVE_TICKS;
    this.claimed = 0;
    for (let c = 0; c < CIRCUITS; c++) {
      const path = this.rng.pick(ROUTES), masks = routeMasks(path);
      let types = this.rng.int(0, 511), board = 0;
      path.forEach((tile, i) => {
        const straight = masks[i] === 5 || masks[i] === 10;
        types = (types & ~(1 << tile)) | (Number(straight) << tile);
      });
      for (let tile = 0; tile < 9; tile++) board |= this.rng.int(0, 3) << (tile * 2);
      // Force the inlet closed if the scramble accidentally solved the circuit.
      while (connected(types, board)) board = turnTile(board, 0);
      this.types[c] = types;
      this.starts[c] = board;
    }
    this.p = Array.from({ length: this.n }, () => this.player());
  }
  disconnect(index) { this.active[index] = false; }
  step(intents) {
    this.tick++;
    const moved = [], turned = [], repaired = [];
    let beep = false, go = false, ended = false;
    if (!this.roundOver) {
      const inspecting = this.ready > 0;
      if (inspecting) {
        beep = this.ready % 30 === 0;
        this.ready--;
        go = this.ready === 0;
      }
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i];
        const direction = Math.sign(intents[i]?.select || 0);
        const held = (intents[i]?.rotate || 0) > 0;
        const press = held && !p.held;
        const changed = direction !== p.direction;
        p.held = held;
        p.direction = direction;
        if (!this.active[i] || inspecting || p.stage === CIRCUITS) continue;
        if (p.flash > 0) {
          p.flash--;
          if (p.flash === 0) {
            p.stage++;
            p.cursor = 0;
            p.repeat = 0;
            if (p.stage < CIRCUITS) {
              p.board = this.starts[p.stage];
              p.power = powered(this.types[p.stage], p.board);
            }
          }
          continue;
        }
        if (!direction) p.repeat = 0;
        else {
          p.repeat = Math.max(0, p.repeat - 1);
          if (changed || p.repeat === 0) {
            p.cursor = (p.cursor + direction + 9) % 9;
            p.repeat = changed ? 12 : 8;
            moved.push(i);
          }
        }
        if (press) {
          p.board = turnTile(p.board, p.cursor);
          turned.push(i);
          p.power = powered(this.types[p.stage], p.board);
          if ((p.power & 256) && (ports(this.types[p.stage], p.board, 8) & 2)) repaired.push(i);
        }
      }
      // Resolve all awards against the previous claimed mask, never seat order.
      for (const i of repaired) {
        const p = this.p[i];
        const points = (p.stage >= 2 ? 10 : 5) + ((this.claimed & (1 << p.stage)) ? 0 : 2);
        p.earned += points;
        this.scores[i] += points;
        p.flash = REPAIR_TICKS;
      }
      for (const i of repaired) this.claimed |= 1 << this.p[i].stage;
      if (!inspecting) this.left--;
      if (this.left === 0 || !this.active.some((on, i) => on && this.p[i].stage < CIRCUITS)) {
        this.roundOver = true;
        ended = true;
      }
    }
    return {
      k: this.tick, over: this.roundOver, ready: this.ready, left: this.left,
      types: [...this.types], starts: [...this.starts], claimed: this.claimed,
      board: this.p.map((p) => p.board), cursor: this.p.map((p) => p.cursor),
      stage: this.p.map((p) => p.stage), power: this.p.map((p) => p.power),
      flash: this.p.map((p) => p.flash), earned: this.p.map((p) => p.earned),
      active: [...this.active], moved, turned, repaired, beep, go, ended,
    };
  }
  winner(target) {
    const best = Math.max(-1, ...this.scores.filter((_, i) => this.active[i]));
    const leaders = this.scores.map((s, i) => this.active[i] && s === best ? i : -1).filter((i) => i >= 0);
    return best >= target && leaders.length === 1 ? leaders[0] : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k", interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    ready: { type: "uint", bits: 8 }, left: { type: "uint", bits: 16 },
    types: { type: "uint", bits: 16, count: CIRCUITS },
    starts: { type: "uint", bits: 32, count: CIRCUITS }, claimed: { type: "uint", bits: 8 },
    board: { type: "uint", bits: 32, per: "player" },
    cursor: { type: "uint", bits: 8, per: "player" }, stage: { type: "uint", bits: 8, per: "player" },
    power: { type: "uint", bits: 16, per: "player" }, flash: { type: "uint", bits: 8, per: "player" },
    earned: { type: "uint", bits: 8, per: "player" }, active: { type: "bool", per: "player" },
    moved: { type: "players" }, turned: { type: "players" }, repaired: { type: "players" },
    beep: { type: "bool" }, go: { type: "bool" }, ended: { type: "bool" },
  },
};
export const INTENT = {
  select: { values: [-1, 0, 1], neutral: 0 },
  rotate: { values: [0, 1], neutral: 0 },
};
