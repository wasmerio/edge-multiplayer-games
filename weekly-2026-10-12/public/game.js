export const ARENA = { w: 640, h: 480 };
export const READY_TICKS = 60;
export const STITCH_TICKS = 24;
export const WEAVE_TICKS = 210;
export const REVEAL_TICKS = 45;
export const ERROR_TICKS = 12;
export const PATTERNS = 4;
export const TARGET = 50;
export const PHASE = { READY: 0, WATCH: 1, WEAVE: 2, REVEAL: 3, DONE: 4 };
export const multiplier = (panel) => panel >= 2 ? 2 : 1;

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.rng = rng;
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.scores = new Array(playerCount).fill(0);
    this.active = new Array(playerCount).fill(true);
    this.p = Array.from({ length: playerCount }, () => this.player());
    this.pattern = new Array(6).fill(0);
    this.panel = 0;
    this.length = 3;
    this.cursor = -1;
    this.claimed = false;
    this.setPhase(PHASE.DONE, 0);
  }

  player() {
    return { progress: 0, cd: 0, mark: 0, flash: 0, fault: false, award: 0, woven: 0, held: 0 };
  }

  setPhase(phase, ticks) {
    this.phase = phase;
    this.t = ticks;
    this.tMax = ticks;
  }

  newPattern() {
    this.length = 3 + this.panel;
    this.pattern = Array.from({ length: 6 }, (_, i) => i < this.length ? this.rng.int(1, 3) : 0);
    this.cursor = -1;
    this.claimed = false;
    for (const p of this.p) {
      p.progress = p.cd = p.mark = p.flash = p.award = 0;
      p.fault = false;
    }
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.panel = 0;
    this.p = Array.from({ length: this.n }, () => this.player());
    this.newPattern();
    this.setPhase(PHASE.READY, READY_TICKS);
  }

  disconnect(index) {
    this.active[index] = false;
  }

  step(intents) {
    this.tick += 1;
    const tapped = [], wrong = [], completed = [];
    let beep = false, cue = false, opened = false, revealed = false, finished = false;
    if (!this.roundOver) {
      for (let i = 0; i < this.n; i++) {
        if (!this.active[i]) continue;
        const p = this.p[i];
        const raw = intents[i]?.stitch || 0;
        const key = raw === 1 || raw === 2 || raw === 3 ? raw : 0;
        const press = key !== 0 && key !== p.held;
        p.held = key;
        if (p.flash > 0) p.flash -= 1;
        const locked = p.cd > 0;
        if (locked) p.cd -= 1;
        if (!press) continue;
        p.mark = key;
        p.flash = 10;
        p.fault = false;
        tapped.push(i);
        if (this.phase !== PHASE.WEAVE || locked || p.progress === this.length) continue;
        if (key !== this.pattern[p.progress]) {
          p.progress = 0;
          p.cd = ERROR_TICKS;
          p.fault = true;
          wrong.push(i);
        } else {
          p.progress += 1;
          if (p.progress === this.length) completed.push(i);
        }
      }
      // Settle as a batch so simultaneous first finishers share the bonus.
      for (const i of completed) {
        const points = (this.claimed ? 3 : 5) * multiplier(this.panel);
        this.p[i].award = points;
        this.p[i].woven += points;
        this.scores[i] += points;
      }
      if (completed.length) this.claimed = true;
      if (!this.active.some(Boolean)) {
        this.roundOver = true;
        this.cursor = -1;
        this.setPhase(PHASE.DONE, 0);
        finished = true;
      } else {
        if (this.phase === PHASE.READY) beep = this.t % 30 === 0;
        this.t -= 1;
        if (this.t === 0) {
          if (this.phase === PHASE.READY) {
            this.setPhase(PHASE.WATCH, this.length * STITCH_TICKS);
            this.cursor = 0;
            cue = true;
          } else if (this.phase === PHASE.WATCH) {
            this.setPhase(PHASE.WEAVE, WEAVE_TICKS);
            this.cursor = -1;
            opened = true;
          } else if (this.phase === PHASE.WEAVE) {
            this.setPhase(PHASE.REVEAL, REVEAL_TICKS);
            revealed = true;
          } else if (this.phase === PHASE.REVEAL) {
            if (this.panel === PATTERNS - 1) {
              this.roundOver = true;
              this.setPhase(PHASE.DONE, 0);
              finished = true;
            } else {
              this.panel += 1;
              this.newPattern();
              this.setPhase(PHASE.WATCH, this.length * STITCH_TICKS);
              this.cursor = 0;
              cue = true;
            }
          }
        } else if (this.phase === PHASE.WATCH && this.t % STITCH_TICKS === 0) {
          this.cursor += 1;
          cue = true;
        }
      }
    }
    return {
      k: this.tick, over: this.roundOver, phase: this.phase,
      t: this.t, tMax: this.tMax, panel: this.panel, length: this.length,
      pattern: [...this.pattern], cursor: this.cursor, claimed: this.claimed,
      progress: this.p.map((p) => p.progress), cd: this.p.map((p) => p.cd),
      mark: this.p.map((p) => p.mark), flash: this.p.map((p) => p.flash),
      fault: this.p.map((p) => p.fault), active: [...this.active],
      award: this.p.map((p) => p.award), woven: this.p.map((p) => p.woven),
      tapped, wrong, completed, beep, cue, opened, revealed, finished,
    };
  }

  winner(target) {
    let best = -1, seat = -1, tied = false;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; seat = i; tied = false; }
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
    tMax: { type: "uint", bits: 16 },
    panel: { type: "uint", bits: 8 },
    length: { type: "uint", bits: 8 },
    pattern: { type: "uint", bits: 8, count: 6 },
    cursor: { type: "int", bits: 8 },
    claimed: { type: "bool" },
    progress: { type: "uint", bits: 8, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    mark: { type: "uint", bits: 8, per: "player" },
    flash: { type: "uint", bits: 8, per: "player" },
    fault: { type: "bool", per: "player" },
    active: { type: "bool", per: "player" },
    award: { type: "uint", bits: 8, per: "player" },
    woven: { type: "uint", bits: 8, per: "player" },
    tapped: { type: "players" },
    wrong: { type: "players" },
    completed: { type: "players" },
    beep: { type: "bool" },
    cue: { type: "bool" },
    opened: { type: "bool" },
    revealed: { type: "bool" },
    finished: { type: "bool" },
  },
};

export const INTENT = { stitch: { values: [0, 1, 2, 3], neutral: 0 } };
