export const ARENA = { w: 640, h: 560 };
export const READY_TICKS = 60;
export const BID_TICKS = 150;
export const REVEAL_TICKS = 45;
export const LOTS = 6;
export const TARGET = 35;
export const PHASE = { READY: 0, BID: 1, REVEAL: 2, DONE: 3 };

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.rng = rng;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.gone = Array(playerCount).fill(false);
    this.wallet = Array(playerCount).fill(0);
    this.values = [2, 3, 4, 5, 6, 7];
    this.phase = PHASE.DONE;
    this.ready = 0;
    this.t = 0;
    this.lot = 0;
    this.resetOffers();
  }

  resetOffers() {
    this.bid = Array(this.n).fill(0);
    this.locked = Array(this.n).fill(false);
    this.direction = Array(this.n).fill(0);
    this.repeat = Array(this.n).fill(0);
    this.held = Array(this.n).fill(false);
    this.last = -1;
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.phase = PHASE.READY;
    this.ready = READY_TICKS;
    this.t = BID_TICKS;
    this.lot = 0;
    this.values = [2, 3, 4, 5, 6, 7];
    for (let i = LOTS - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [this.values[i], this.values[j]] = [this.values[j], this.values[i]];
    }
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    this.wallet = this.scores.map((score, i) => this.gone[i] ? 0 : 24 + Math.min(6, best - score));
    this.resetOffers();
  }

  disconnect(index) {
    this.gone[index] = true;
    this.bid[index] = 0;
    this.locked[index] = false;
  }

  step(intents) {
    this.tick++;
    const adjusted = [], sealed = [], sold = [];
    let beep = false, go = false, revealed = false, ended = false;
    if (!this.roundOver) {
      if (this.phase === PHASE.READY) {
        beep = this.ready % 30 === 0;
        this.ready--;
        if (this.ready === 0) { this.phase = PHASE.BID; go = true; }
      } else if (this.phase === PHASE.BID) {
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i] || this.locked[i]) continue;
          const dir = Math.sign(intents[i]?.adjust || 0);
          const press = (intents[i]?.seal || 0) > 0;
          if (this.repeat[i] > 0) this.repeat[i]--;
          if (dir && (dir !== this.direction[i] || this.repeat[i] === 0)) {
            const next = Math.max(0, Math.min(9, this.wallet[i], this.bid[i] + dir));
            if (next !== this.bid[i]) { this.bid[i] = next; adjusted.push(i); }
            this.repeat[i] = 8;
          }
          this.direction[i] = dir;
          if (press && !this.held[i]) { this.locked[i] = true; sealed.push(i); }
          this.held[i] = press;
        }
        this.t--;
        if (this.t === 0) {
          const count = Array(10).fill(0);
          for (let i = 0; i < this.n; i++) if (!this.gone[i] && this.locked[i]) count[this.bid[i]]++;
          let best = 0;
          for (let b = 1; b <= 9; b++) if (count[b] === 1) best = b;
          this.last = -1;
          if (best) {
            for (let i = 0; i < this.n; i++) {
              if (!this.gone[i] && this.locked[i] && this.bid[i] === best) {
                this.last = i;
                this.wallet[i] -= best;
                this.scores[i] += this.values[this.lot];
                sold.push(i);
              }
            }
          }
          this.phase = PHASE.REVEAL;
          this.t = REVEAL_TICKS;
          revealed = true;
        }
      } else if (this.phase === PHASE.REVEAL) {
        this.t--;
        if (this.t === 0) {
          if (this.lot === LOTS - 1) {
            this.roundOver = true;
            this.phase = PHASE.DONE;
            ended = true;
          } else {
            this.lot++;
            this.resetOffers();
            this.phase = PHASE.BID;
            this.t = BID_TICKS;
            go = true;
          }
        }
      }
    }
    return {
      k: this.tick, over: this.roundOver, phase: this.phase, ready: this.ready,
      t: this.t, lot: this.lot, values: [...this.values], bid: [...this.bid], wallet: [...this.wallet],
      locked: [...this.locked], gone: [...this.gone], last: this.last,
      adjusted, sealed, sold, beep, go, revealed, ended,
    };
  }

  winner(target) {
    const best = Math.max(0, ...this.scores.filter((_, i) => !this.gone[i]));
    const leaders = this.scores.flatMap((score, i) => !this.gone[i] && score === best ? [i] : []);
    return best >= target && leaders.length === 1 ? leaders[0] : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: [],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    phase: { type: "uint", bits: 8 },
    ready: { type: "uint", bits: 8 },
    t: { type: "uint", bits: 16 },
    lot: { type: "uint", bits: 8 },
    values: { type: "uint", bits: 8, count: 6 },
    bid: { type: "uint", bits: 8, per: "player" },
    wallet: { type: "uint", bits: 8, per: "player" },
    locked: { type: "bool", per: "player" },
    gone: { type: "bool", per: "player" },
    last: { type: "int", bits: 8 },
    adjusted: { type: "players" },
    sealed: { type: "players" },
    sold: { type: "players" },
    beep: { type: "bool" },
    go: { type: "bool" },
    revealed: { type: "bool" },
    ended: { type: "bool" },
  },
};

export const INTENT = {
  adjust: { values: [-1, 0, 1], neutral: 0 },
  seal: { values: [0, 1], neutral: 0 },
};
