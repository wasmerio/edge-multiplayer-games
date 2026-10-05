// Trapdoor: stand on the called shape before the floor drops.
// Headless: no DOM, no network, no timers, no Math.random. It runs in Node.
export const TILE = 150;
export const TOP = 120;
export const RADIUS = 30;
export const SPEED = 11;
export const LEADER_SLOW = 0.92;
export const DASH_SPEED = 30;
export const DASH_TICKS = 6;
export const DASH_COOLDOWN = 50;
export const SHOVE = 27;
export const KNOCK_DECAY = 0.8;
export const READY_TICKS = 75;
export const DROP_TICKS = 36;
export const LOCK_TICKS = 30;
export const MAX_DROPS = 20;
export const BONUS = 2;
export const NONE = 255;
export const PHASE = { READY: 0, CALL: 1, DROP: 2, DONE: 3 };
export const ALIVE = 0;
export const FALLEN = 1;
export const GONE = 2;

export const gridFor = (players) => (players <= 3 ? { cols: 6, rows: 4 } : players <= 5 ? { cols: 7, rows: 5 } : { cols: 8, rows: 6 });
export const ARENA = (players) => {
  const { cols, rows } = gridFor(players);
  return { w: cols * TILE, h: TOP + rows * TILE };
};
export const TARGET = (players) => 3 * (players + 1);

export const callTicks = (drop) => Math.max(45, 126 - 11 * drop);
export const symbolsAt = (drop) => (drop < 2 ? 4 : drop < 4 ? 5 : 6);
const SHARE = [0.34, 0.28, 0.22, 0.17, 0.13, 0.1, 0.08];
export function safeCount(drop, tiles, alive) {
  const floor = Math.max(1, Math.ceil(alive / 3));
  const wanted = drop < SHARE.length ? Math.round(tiles * SHARE[drop]) : Math.round(tiles * 0.08) - (drop - SHARE.length + 1);
  return Math.max(floor, Math.min(tiles - 1, wanted));
}

// The floor of one call, rebuilt from the snapshot's seed on every peer.
export function layout(seed, tiles, nsym, sym, safe) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: tiles }, (_, i) => i);
  for (let i = tiles - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const keep = order[i];
    order[i] = order[j];
    order[j] = keep;
  }
  const others = [];
  for (let k = 0; k < nsym; k++) if (k !== sym) others.push(k);
  const out = new Uint8Array(tiles);
  order.forEach((index, n) => { out[index] = n < safe || !others.length ? sym : others[(n - safe) % others.length]; });
  return out;
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts.arena;
    this.n = playerCount;
    this.rng = rng;
    this.cols = Math.max(2, Math.round(w / TILE));
    this.rows = Math.max(2, Math.round((h - TOP) / TILE));
    this.w = this.cols * TILE;
    this.h = TOP + this.rows * TILE;
    this.tiles = this.cols * this.rows;
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.gone = new Array(playerCount).fill(false);
    this.phase = PHASE.DONE;
    this.ready = 0;
    this.t = 0;
    this.tMax = 1;
    this.drop = 0;
    this.seed = 0;
    this.sym = 0;
    this.nsym = 4;
    this.safe = 0;
    this.lay = new Uint8Array(this.tiles);
    this.last = -1;
    this.lead = -1;
    this.ending = false;
    this.p = Array.from({ length: playerCount }, () => this.fresh(this.w / 2, TOP + (this.h - TOP) / 2, ALIVE));
  }

  fresh(x, y, st) {
    return { x, y, st, fa: NONE, ha: NONE, cd: 0, dash: 0, dx: 0, dy: -1, kx: 0, ky: 0, held: false, crack: NONE };
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.phase = PHASE.READY;
    this.ready = READY_TICKS;
    this.t = 0;
    this.tMax = 1;
    this.drop = 0;
    this.last = -1;
    this.ending = false;
    this.lay = new Uint8Array(this.tiles);
    const best = Math.max(...this.scores);
    this.lead = best > 0 && this.scores.filter((score) => score === best).length === 1 ? this.scores.indexOf(best) : -1;
    const cx = this.w / 2;
    const cy = TOP + (this.h - TOP) / 2;
    const ring = (this.h - TOP) * 0.3;
    const turn = this.rng.range(0, Math.PI * 2);
    this.p = this.p.map((_, i) => {
      const angle = turn + (i / this.n) * Math.PI * 2;
      const me = this.fresh(cx + Math.cos(angle) * ring * 1.3, cy + Math.sin(angle) * ring, this.gone[i] ? GONE : ALIVE);
      me.dx = -Math.cos(angle);
      me.dy = -Math.sin(angle);
      return me;
    });
  }

  disconnect(index) {
    this.gone[index] = true;
    if (this.p[index]) this.p[index].st = GONE;
  }

  aliveCount() {
    let alive = 0;
    for (const me of this.p) if (me.st === ALIVE) alive += 1;
    return alive;
  }

  startCall() {
    this.phase = PHASE.CALL;
    this.tMax = callTicks(this.drop);
    this.t = this.tMax;
    const nsym = symbolsAt(this.drop);
    // Never the same shape twice in a row.
    let sym = this.rng.int(0, nsym - 1);
    if (this.drop > 0 && sym === this.sym) sym = (sym + 1) % nsym;
    this.nsym = nsym;
    this.sym = sym;
    this.safe = safeCount(this.drop, this.tiles, this.aliveCount());
    this.seed = Math.floor(this.rng.next() * 4294967296) >>> 0;
    this.lay = layout(this.seed, this.tiles, this.nsym, this.sym, this.safe);
    for (const me of this.p) me.crack = NONE;
  }

  tileAt(x, y) {
    const col = clamp(Math.floor(x / TILE), 0, this.cols - 1);
    const row = clamp(Math.floor((y - TOP) / TILE), 0, this.rows - 1);
    return row * this.cols + col;
  }

  cracked(index) {
    for (const me of this.p) if (me.crack === index) return true;
    return false;
  }

  isOpen(index) {
    return this.phase === PHASE.DROP && (this.lay[index] !== this.sym || this.cracked(index));
  }

  intactSafe() {
    let count = 0;
    for (let i = 0; i < this.tiles; i++) if (this.lay[i] === this.sym && !this.cracked(i)) count += 1;
    return count;
  }

  step(intents) {
    const fell = [];
    const dashed = [];
    const shoved = [];
    const cracked = [];
    const denied = [];
    const pt = [];
    const won = [];
    let beep = false;
    let go = false;
    let call = false;
    let tk = false;
    let open = false;
    if (!this.roundOver) {
      this.tick += 1;
      if (this.phase === PHASE.READY) {
        beep = this.ready % 25 === 0;
        this.ready -= 1;
        if (this.ready === 0) { go = true; call = true; this.startCall(); }
      } else if (this.phase === PHASE.CALL) {
        if (this.ending) {
          this.phase = PHASE.DONE;
          this.roundOver = true;
        } else {
          this.t -= 1;
          tk = this.t > 0 && this.t <= 36 && this.t % 6 === 0;
          if (this.t === 0) { this.phase = PHASE.DROP; this.t = DROP_TICKS; this.tMax = DROP_TICKS; open = true; }
        }
      } else if (this.phase === PHASE.DROP) {
        this.t -= 1;
        if (this.t === 0) {
          if (this.ending || this.drop + 1 >= MAX_DROPS) {
            this.phase = PHASE.DONE;
            this.roundOver = true;
          } else {
            this.drop += 1;
            call = true;
            this.startCall();
          }
        }
      }
    }
    if (!this.roundOver) {
      for (let i = 0; i < this.n; i++) {
        const me = this.p[i];
        if (me.st === GONE) continue;
        // A seat that has sent no input yet holds 0, not an object.
        const intent = intents[i] || {};
        let mx = clamp(intent.mx || 0, -1, 1);
        let my = clamp(intent.my || 0, -1, 1);
        const length = Math.max(1, Math.hypot(mx, my));
        mx /= length;
        my /= length;
        if (mx || my) { const l = Math.hypot(mx, my); me.dx = mx / l; me.dy = my / l; }
        const pressed = (intent.act || 0) > 0;
        const edge = pressed && !me.held;
        me.held = pressed;
        if (me.fa < NONE) me.fa += 1;
        if (me.ha < NONE) me.ha += 1;
        if (me.st === FALLEN) {
          // A fallen player haunts the floor, and the button cracks a called tile.
          me.x = clamp(me.x + mx * SPEED, RADIUS, this.w - RADIUS);
          me.y = clamp(me.y + my * SPEED, TOP + RADIUS, this.h - RADIUS);
          if (edge) {
            const index = this.tileAt(me.x, me.y);
            const allowed = this.phase === PHASE.CALL && this.t >= LOCK_TICKS && me.crack === NONE
              && this.lay[index] === this.sym && !this.cracked(index) && this.intactSafe() > 1;
            if (allowed) { me.crack = index; cracked.push(i); } else denied.push(i);
          }
          continue;
        }
        if (edge && me.cd === 0) { me.dash = DASH_TICKS; me.cd = DASH_COOLDOWN; dashed.push(i); }
        const speed = SPEED * (i === this.lead ? LEADER_SLOW : 1);
        const vx = me.dash > 0 ? me.dx * DASH_SPEED : mx * speed;
        const vy = me.dash > 0 ? me.dy * DASH_SPEED : my * speed;
        me.x += vx + me.kx;
        me.y += vy + me.ky;
        me.kx *= KNOCK_DECAY;
        me.ky *= KNOCK_DECAY;
        if (Math.abs(me.kx) < 0.5) me.kx = 0;
        if (Math.abs(me.ky) < 0.5) me.ky = 0;
        if (me.dash > 0) me.dash -= 1;
        if (me.cd > 0) me.cd -= 1;
      }
      // Bodies are solid; a dash that lands is a shove.
      for (let i = 0; i < this.n; i++) {
        const a = this.p[i];
        if (a.st !== ALIVE) continue;
        for (let j = i + 1; j < this.n; j++) {
          const b = this.p[j];
          if (b.st !== ALIVE) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          if (dist >= RADIUS * 2) continue;
          if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }
          const nx = dx / dist;
          const ny = dy / dist;
          if (a.dash > 0) { b.kx = nx * SHOVE; b.ky = ny * SHOVE; b.ha = 0; b.dash = 0; a.dash = 0; a.kx = -nx * 6; a.ky = -ny * 6; shoved.push(j); }
          else if (b.dash > 0) { a.kx = -nx * SHOVE; a.ky = -ny * SHOVE; a.ha = 0; b.dash = 0; b.kx = nx * 6; b.ky = ny * 6; shoved.push(i); }
          const push = (RADIUS * 2 - dist) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
      let fallers = 0;
      for (let i = 0; i < this.n; i++) {
        const me = this.p[i];
        if (me.st !== ALIVE) continue;
        me.x = clamp(me.x, RADIUS, this.w - RADIUS);
        me.y = clamp(me.y, TOP + RADIUS, this.h - RADIUS);
        if (this.phase === PHASE.DROP && i !== this.last && this.isOpen(this.tileAt(me.x, me.y))) {
          me.st = FALLEN;
          me.fa = 0;
          me.dash = 0;
          me.kx = 0;
          me.ky = 0;
          fell.push(i);
          fallers += 1;
        }
      }
      if (fallers) {
        // Everyone still standing outlasted the ones who fell this tick.
        for (let i = 0; i < this.n; i++) {
          if (this.p[i].st !== ALIVE) continue;
          this.scores[i] += fallers;
          pt.push(i);
        }
      }
      if (!this.ending && this.phase !== PHASE.READY) {
        const alive = this.aliveCount();
        if (alive <= (this.n >= 2 ? 1 : 0)) {
          this.ending = true;
          if (alive === 1 && this.n >= 2) {
            const i = this.p.findIndex((me) => me.st === ALIVE);
            this.last = i;
            this.scores[i] += BONUS;
            won.push(i);
          }
        }
      }
    }
    return {
      k: this.tick,
      over: this.roundOver,
      phase: this.phase,
      ready: this.ready,
      t: this.t,
      tMax: this.tMax,
      drop: this.drop,
      seed: this.seed,
      sym: this.sym,
      nsym: this.nsym,
      safe: this.safe,
      last: this.last,
      lead: this.lead,
      x: this.p.map((me) => Math.round(me.x * 10) / 10),
      y: this.p.map((me) => Math.round(me.y * 10) / 10),
      st: this.p.map((me) => me.st),
      fa: this.p.map((me) => me.fa),
      ha: this.p.map((me) => me.ha),
      cd: this.p.map((me) => me.cd),
      crack: this.p.map((me) => me.crack),
      fell,
      dashed,
      shoved,
      cracked,
      denied,
      pt,
      won,
      beep,
      go,
      call,
      tk,
      open,
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
    phase: { type: "uint", bits: 8 },
    ready: { type: "uint", bits: 8 },
    t: { type: "uint", bits: 8 },
    tMax: { type: "uint", bits: 8 },
    drop: { type: "uint", bits: 8 },
    seed: { type: "uint", bits: 32 },
    sym: { type: "uint", bits: 8 },
    nsym: { type: "uint", bits: 8 },
    safe: { type: "uint", bits: 8 },
    last: { type: "int", bits: 8 },
    lead: { type: "int", bits: 8 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    st: { type: "uint", bits: 8, per: "player" },
    fa: { type: "uint", bits: 8, per: "player" },
    ha: { type: "uint", bits: 8, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    crack: { type: "uint", bits: 8, per: "player" },
    fell: { type: "players" },
    dashed: { type: "players" },
    shoved: { type: "players" },
    cracked: { type: "players" },
    denied: { type: "players" },
    pt: { type: "players" },
    won: { type: "players" },
    beep: { type: "bool" },
    go: { type: "bool" },
    call: { type: "bool" },
    tk: { type: "bool" },
    open: { type: "bool" },
  },
};

export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 },
  my: { min: -1, max: 1, neutral: 0 },
  act: { values: [0, 1], neutral: 0 },
};
