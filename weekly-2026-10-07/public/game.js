export const ARENA = { w: 640, h: 480 };
export const READY_TICKS = 60;
export const BID_TICKS = 120;
export const REVEAL_TICKS = 30;
export const LOTS = 8;
export const TARGET = 24;
export const MAX_BID = 9;
export const REPEAT_TICKS = 6;
export const PHASE = { READY: 0, BID: 1, REVEAL: 2, DONE: 3 };

const fresh = (purse = 8) => ({ purse, choice: 0, offer: 0, locked: false, result: 0, petals: 0, held: false, dir: 0, repeat: 0 });

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.arena = opts.arena;
    this.rng = rng;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.p = Array.from({ length: playerCount }, () => fresh());
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.phase = PHASE.DONE;
    this.t = 0;
    this.lot = 0;
    this.values = [3, 4, 4, 5, 5, 6, 7, 8];
    this.last = -1;
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.phase = PHASE.READY;
    this.t = READY_TICKS;
    this.lot = 0;
    this.last = -1;
    this.values = [3, 4, 4, 5, 5, 6, 7, 8];
    for (let i = this.values.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [this.values[i], this.values[j]] = [this.values[j], this.values[i]];
    }
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.p = this.p.map((_, i) => fresh(this.gone[i] ? 0 : this.scores[i] < best ? 10 : 8));
  }

  disconnect(index) {
    this.gone[index] = true;
    this.p[index].choice = 0;
    if (this.phase !== PHASE.REVEAL && this.phase !== PHASE.DONE) this.p[index].offer = 0;
  }

  openLot() {
    this.phase = PHASE.BID;
    this.t = BID_TICKS;
    this.last = -1;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (this.lot > 0 && !this.gone[i]) p.purse = Math.min(15, p.purse + 3);
      p.choice = 0;
      p.offer = 0;
      p.locked = false;
      p.result = 0;
      p.dir = 0;
      p.repeat = 0;
    }
  }

  settle(awarded, cancelled) {
    const counts = Array(MAX_BID + 1).fill(0);
    for (let i = 0; i < this.n; i++) {
      if (!this.gone[i] && this.p[i].locked && this.p[i].offer > 0) counts[this.p[i].offer]++;
    }
    let winningBid = 0;
    for (let bid = 1; bid <= MAX_BID; bid++) if (counts[bid] === 1) winningBid = bid;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (this.gone[i] || !p.locked || p.offer === 0) continue;
      if (counts[p.offer] > 1) { p.result = 2; cancelled.push(i); }
      else if (p.offer === winningBid) {
        p.result = 3;
        this.last = i;
        this.scores[i] += this.values[this.lot];
        p.petals += this.values[this.lot];
        awarded.push(i);
      } else p.result = 1;
    }
    this.phase = PHASE.REVEAL;
    this.t = REVEAL_TICKS;
  }

  step(intents) {
    this.tick += 1;
    const changed = [], sealed = [], awarded = [], cancelled = [];
    let beep = false, opened = false, revealed = false, finished = false;
    if (!this.roundOver) {
      if (this.gone.every(Boolean)) {
        this.roundOver = true;
        this.phase = PHASE.DONE;
        this.t = 0;
        finished = true;
      } else {
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const p = this.p[i];
          const direction = Math.sign(intents[i]?.bid || 0);
          const press = (intents[i]?.seal || 0) > 0;
          if (this.phase === PHASE.BID && !p.locked) {
            if (p.repeat > 0) p.repeat--;
            if (direction && (direction !== p.dir || p.repeat === 0)) {
              const before = p.choice;
              p.choice = Math.max(0, Math.min(MAX_BID, p.purse, p.choice + direction));
              p.repeat = REPEAT_TICKS;
              if (p.choice !== before) changed.push(i);
            }
            if (press && !p.held) {
              p.offer = p.choice;
              p.purse -= p.offer;
              p.locked = true;
              sealed.push(i);
            }
          }
          p.held = press;
          p.dir = direction;
        }
        if (this.phase === PHASE.READY) beep = this.t % 20 === 0;
        this.t--;
        if (this.t === 0) {
          if (this.phase === PHASE.READY) { this.openLot(); opened = true; }
          else if (this.phase === PHASE.BID) { this.settle(awarded, cancelled); revealed = true; }
          else if (this.lot + 1 < LOTS) { this.lot++; this.openLot(); opened = true; }
          else { this.phase = PHASE.DONE; this.roundOver = true; finished = true; }
        }
      }
    }
    return {
      k: this.tick, over: this.roundOver, phase: this.phase, t: this.t,
      lot: this.lot, value: this.values[this.lot], preview: this.values[this.lot + 1] || 0, last: this.last,
      purse: this.p.map((p) => p.purse), choice: this.p.map((p) => p.choice), offer: this.p.map((p) => p.offer),
      locked: this.p.map((p) => p.locked), active: this.gone.map((gone) => !gone),
      result: this.p.map((p) => p.result), petals: this.p.map((p) => p.petals),
      changed, sealed, awarded, cancelled, beep, opened, revealed, finished,
    };
  }

  winner(target) {
    let seat = -1, best = -1, tied = false;
    for (let i = 0; i < this.n; i++) {
      if (this.gone[i]) continue;
      if (this.scores[i] > best) { seat = i; best = this.scores[i]; tied = false; }
      else if (this.scores[i] === best) tied = true;
    }
    return best >= target && !tied ? seat : -1;
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
    lot: { type: "uint", bits: 8 },
    value: { type: "uint", bits: 8 },
    preview: { type: "uint", bits: 8 },
    last: { type: "int", bits: 8 },
    purse: { type: "uint", bits: 8, per: "player" },
    choice: { type: "uint", bits: 8, per: "player" },
    offer: { type: "uint", bits: 8, per: "player" },
    locked: { type: "bool", per: "player" },
    active: { type: "bool", per: "player" },
    result: { type: "uint", bits: 8, per: "player" },
    petals: { type: "uint", bits: 8, per: "player" },
    changed: { type: "players" },
    sealed: { type: "players" },
    awarded: { type: "players" },
    cancelled: { type: "players" },
    beep: { type: "bool" },
    opened: { type: "bool" },
    revealed: { type: "bool" },
    finished: { type: "bool" },
  },
};

export const INTENT = {
  bid: { values: [-1, 0, 1], neutral: 0 },
  seal: { values: [0, 1], neutral: 0 },
};
