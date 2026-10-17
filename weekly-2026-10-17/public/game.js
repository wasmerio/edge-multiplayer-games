export const ARENA = { w: 600, h: 480 };
export const READY_TICKS = 45;
export const WORK_TICKS = 450;
export const REVIEW_TICKS = 30;
export const JOBS = 3;
export const TARGET = 30;
export const PHASE = { READY: 0, WORK: 1, REVIEW: 2, DONE: 3 };
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export function neighbour(cell, dir) {
  const x = cell % 3 + DX[dir], y = Math.floor(cell / 3) + DY[dir];
  return x < 0 || x > 2 || y < 0 || y > 2 ? -1 : y * 3 + x;
}
export const orientation = (rot, cell) => (rot >>> (cell * 2)) & 3;
export function setOrientation(rot, cell, value) {
  return (rot & ~(3 << (cell * 2))) | ((value & 3) << (cell * 2));
}
export function ports(types, rot, cell) {
  const base = (types & (1 << cell)) ? 3 : 5;
  const turn = orientation(rot, cell);
  return ((base << turn) | (base >>> (4 - turn))) & 15;
}

// All simple routes on a nine-cell board: bounded work, not a simulation search.
const ROUTES = [];
function visit(path) {
  const cell = path[path.length - 1];
  if (cell === 5) { if (path.length >= 5) ROUTES.push(path); return; }
  for (let dir = 0; dir < 4; dir++) {
    const next = neighbour(cell, dir);
    if (next >= 0 && !path.includes(next)) visit([...path, next]);
  }
}
visit([3]);
function routePorts(route, at) {
  const cell = route[at];
  let mask = at === 0 ? 8 : at === route.length - 1 ? 2 : 0;
  for (let d = 0; d < 4; d++) {
    const next = neighbour(cell, d);
    if ((at > 0 && next === route[at - 1]) || (at + 1 < route.length && next === route[at + 1])) mask |= 1 << d;
  }
  return mask;
}
export function solutionFor(types) {
  for (const route of ROUTES) {
    let rot = 0, valid = true;
    for (let j = 0; j < route.length; j++) {
      const cell = route[j], wanted = routePorts(route, j);
      let turn = 0;
      while (turn < 4 && ports(types, setOrientation(0, cell, turn), cell) !== wanted) turn++;
      if (turn === 4) { valid = false; break; }
      rot = setOrientation(rot, cell, turn);
    }
    if (valid) return { rot, route };
  }
  return null;
}
export function flow(types, rot) {
  if (!(ports(types, rot, 3) & 8)) return { wet: 0, solved: false };
  let wet = 1 << 3;
  const queue = [3];
  let solved = false;
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at], mask = ports(types, rot, cell);
    if (cell === 5 && (mask & 2)) solved = true;
    for (let d = 0; d < 4; d++) {
      const next = neighbour(cell, d);
      if (next < 0 || !(mask & (1 << d)) || (wet & (1 << next))) continue;
      if (ports(types, rot, next) & (1 << ((d + 2) % 4))) { wet |= 1 << next; queue.push(next); }
    }
  }
  return { wet, solved };
}

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.rng = rng;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.phase = PHASE.DONE;
    this.t = 0;
    this.job = 0;
    this.types = 0;
    this.claimed = false;
    this.p = Array.from({ length: playerCount }, () => ({ rot: 0, wet: 0, cursor: 3, solved: false, award: 0, earned: 0, flash: 0, held: false, dir: 0, repeat: 0 }));
  }
  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.phase = PHASE.READY;
    this.t = READY_TICKS;
    this.job = 0;
    for (const p of this.p) Object.assign(p, { earned: 0, held: false, dir: 0, repeat: 0 });
    this.newPlan();
  }
  newPlan() {
    const route = this.rng.pick(ROUTES);
    this.types = this.rng.int(0, 511);
    for (let j = 0; j < route.length; j++) {
      const mask = routePorts(route, j), bit = 1 << route[j];
      if (mask === 5 || mask === 10) this.types &= ~bit;
      else this.types |= bit;
    }
    let rot = this.rng.int(0, 262143);
    while (ports(this.types, rot, 3) & 8) rot = setOrientation(rot, 3, orientation(rot, 3) + 1);
    this.claimed = false;
    for (const p of this.p) Object.assign(p, { rot, wet: 0, cursor: 3, solved: false, award: 0, flash: 0 });
  }
  disconnect(index) { this.gone[index] = true; }
  step(intents) {
    this.tick++;
    const moved = [], turned = [], completed = [];
    let beep = false, opened = false, reviewed = false, finished = false;
    if (!this.roundOver) {
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i];
        const dir = Math.sign(intents[i]?.select || 0);
        const held = (intents[i]?.rotate || 0) > 0;
        if (p.flash > 0) p.flash--;
        if (!this.gone[i] && !p.solved && this.phase === PHASE.WORK) {
          if (dir && (dir !== p.dir || p.repeat === 0)) {
            p.cursor = (p.cursor + dir + 9) % 9;
            p.repeat = 8;
            moved.push(i);
          }
          if (held && !p.held) {
            p.rot = setOrientation(p.rot, p.cursor, orientation(p.rot, p.cursor) + 1);
            p.flash = 6;
            turned.push(i);
          }
          const result = flow(this.types, p.rot);
          p.wet = result.wet;
          if (result.solved) { p.solved = true; completed.push(i); }
        }
        p.dir = dir;
        p.held = held;
        if (!dir) p.repeat = 0;
        else if (p.repeat > 0) p.repeat--;
      }
      const value = (this.claimed ? 3 : 5) * (this.job === JOBS - 1 ? 2 : 1);
      for (const i of completed) {
        this.p[i].award = value;
        this.p[i].earned += value;
        this.scores[i] += value;
      }
      if (completed.length) this.claimed = true;
      beep = this.phase === PHASE.READY && this.t % 15 === 0;
      this.t--;
      if (this.gone.every(Boolean)) {
        this.roundOver = true; this.phase = PHASE.DONE; finished = true;
      } else if (this.t === 0) {
        if (this.phase === PHASE.READY) { this.phase = PHASE.WORK; this.t = WORK_TICKS; opened = true; }
        else if (this.phase === PHASE.WORK) { this.phase = PHASE.REVIEW; this.t = REVIEW_TICKS; reviewed = true; }
        else if (this.job + 1 < JOBS) {
          this.job++; this.newPlan(); this.phase = PHASE.WORK; this.t = WORK_TICKS; opened = true;
        } else { this.phase = PHASE.DONE; this.roundOver = true; finished = true; }
      }
    }
    return {
      k: this.tick, over: this.roundOver, phase: this.phase, t: this.t, job: this.job, types: this.types, claimed: this.claimed,
      rot: this.p.map(p => p.rot), wet: this.p.map(p => p.wet), cursor: this.p.map(p => p.cursor),
      solved: this.p.map(p => p.solved), active: this.gone.map(g => !g), award: this.p.map(p => p.award),
      earned: this.p.map(p => p.earned), flash: this.p.map(p => p.flash),
      moved, turned, completed, beep, opened, reviewed, finished,
    };
  }
  winner(target) {
    let best = -1, seat = -1, tie = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; tie = false; }
      else if (this.scores[i] === best) tie = true;
    }
    return best >= target && !tie ? seat : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k", interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 }, over: { type: "bool" }, phase: { type: "uint", bits: 8 },
    t: { type: "uint", bits: 16 }, job: { type: "uint", bits: 8 }, types: { type: "uint", bits: 16 }, claimed: { type: "bool" },
    rot: { type: "uint", bits: 32, per: "player" }, wet: { type: "uint", bits: 16, per: "player" },
    cursor: { type: "uint", bits: 8, per: "player" }, solved: { type: "bool", per: "player" }, active: { type: "bool", per: "player" },
    award: { type: "uint", bits: 8, per: "player" }, earned: { type: "uint", bits: 8, per: "player" }, flash: { type: "uint", bits: 8, per: "player" },
    moved: { type: "players" }, turned: { type: "players" }, completed: { type: "players" },
    beep: { type: "bool" }, opened: { type: "bool" }, reviewed: { type: "bool" }, finished: { type: "bool" },
  },
};
export const INTENT = {
  select: { values: [-1, 0, 1], neutral: 0 },
  rotate: { values: [0, 1], neutral: 0 },
};
