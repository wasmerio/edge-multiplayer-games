export const ARENA = { w: 640, h: 480 };
export const TARGET = 80;
export const READY_TICKS = 60;
export const BEAT_TICKS = 21;
export const LIT_TICKS = 15;
export const RECALL_TICKS = 210;
export const REVIEW_TICKS = 24;
export const LOCK_TICKS = 12;
export const PHRASES = 5;
export const PHASE = { READY: 0, SHOW: 1, RECALL: 2, REVIEW: 3, DONE: 4 };

export class Game {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.w = opts.arena.w;
    this.h = opts.arena.h;
    this.rng = rng;
    this.scores = Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.phase = PHASE.DONE;
    this.t = 0;
    this.phrase = 0;
    this.length = 3;
    this.pattern = Array(7).fill(0);
    this.first = -1;
    this.p = Array.from({ length: playerCount }, () => ({ active: true, held: false, progress: 0, lock: 0, flash: 0, last: 0, mend: 0, award: 0, done: false, woven: 0 }));
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.phrase = 0;
    for (const p of this.p) { p.woven = 0; p.held = false; }
    this.setupPattern();
    this.phase = PHASE.READY;
    this.t = READY_TICKS;
  }

  setupPattern() {
    this.length = this.phrase + 3;
    this.pattern.fill(0);
    for (let j = 0; j < this.length; j++) {
      const choices = [1, 2, 3].filter((symbol) => symbol !== this.pattern[j - 1]);
      this.pattern[j] = this.rng.pick(choices);
    }
    let best = 0;
    for (let i = 0; i < this.n; i++) if (this.p[i].active) best = Math.max(best, this.scores[i]);
    this.first = -1;
    this.p.forEach((p, i) => {
      p.progress = 0; p.lock = 0; p.flash = 0; p.last = 0; p.award = 0; p.done = false;
      p.mend = p.active && this.scores[i] < best ? 1 : 0;
    });
    this.phase = PHASE.SHOW;
    this.t = this.length * BEAT_TICKS;
  }

  disconnect(index) { this.p[index].active = false; }

  step(intents) {
    this.tick += 1;
    const e = { pressed: [], correct: [], wrong: [], mended: [], finished: [], beep: false, cue: false, recall: false, review: false, ended: false };
    if (!this.roundOver) {
      if (!this.p.some((p) => p.active)) {
        this.roundOver = true; this.phase = PHASE.DONE; this.t = 0; e.ended = true;
      } else {
        for (let i = 0; i < this.n; i++) {
          const p = this.p[i];
          const raw = intents[i]?.stitch || 0;
          const key = raw === 1 || raw === 2 || raw === 3 ? raw : 0;
          const press = key !== 0 && !p.held;
          p.held = key !== 0;
          if (p.flash > 0) p.flash -= 1;
          if (p.lock > 0) p.lock -= 1;
          if (!p.active || this.phase !== PHASE.RECALL || !press || p.done || p.lock > 0) continue;
          p.last = key;
          p.flash = LOCK_TICKS;
          e.pressed.push(i);
          if (key === this.pattern[p.progress]) {
            p.progress += 1;
            e.correct.push(i);
            if (p.progress === this.length) { p.done = true; e.finished.push(i); }
          } else {
            e.wrong.push(i);
            p.lock = LOCK_TICKS;
            if (p.mend > 0) { p.mend -= 1; e.mended.push(i); }
            else p.progress = Math.max(0, p.progress - 1);
          }
        }
        // Batch awards so simultaneous finishers have no seat-order disadvantage.
        for (const i of e.finished) {
          const amount = this.length + 2 + (this.first < 0 ? 2 : 0);
          this.p[i].award = amount;
          this.p[i].woven += amount;
          this.scores[i] += amount;
        }
        if (this.first < 0 && e.finished.length) this.first = e.finished[0];
        if (this.phase === PHASE.READY) e.beep = this.t % 20 === 0;
        this.t -= 1;
        if (this.t === 0) {
          if (this.phase === PHASE.READY) { this.phase = PHASE.SHOW; this.t = this.length * BEAT_TICKS; e.cue = true; }
          else if (this.phase === PHASE.SHOW) { this.phase = PHASE.RECALL; this.t = RECALL_TICKS; e.recall = true; }
          else if (this.phase === PHASE.RECALL) { this.phase = PHASE.REVIEW; this.t = REVIEW_TICKS; e.review = true; }
          else if (this.phase === PHASE.REVIEW) {
            if (this.phrase === PHRASES - 1) { this.phase = PHASE.DONE; this.roundOver = true; e.ended = true; }
            else { this.phrase += 1; this.setupPattern(); e.cue = true; }
          }
        } else if (this.phase === PHASE.SHOW && (this.length * BEAT_TICKS - this.t) % BEAT_TICKS === 0) e.cue = true;
      }
    }
    const elapsed = this.length * BEAT_TICKS - this.t;
    const shown = this.phase === PHASE.SHOW && elapsed % BEAT_TICKS < LIT_TICKS ? this.pattern[Math.floor(elapsed / BEAT_TICKS)] : 0;
    return {
      k: this.tick, over: this.roundOver, phase: this.phase, t: this.t,
      phrase: this.phrase, length: this.length, pattern: [...this.pattern], shown, first: this.first,
      progress: this.p.map((p) => p.progress), lock: this.p.map((p) => p.lock), flash: this.p.map((p) => p.flash),
      last: this.p.map((p) => p.last), mend: this.p.map((p) => p.mend), award: this.p.map((p) => p.award),
      done: this.p.map((p) => p.done), active: this.p.map((p) => p.active), woven: this.p.map((p) => p.woven), ...e,
    };
  }

  winner(target) {
    let seat = -1, best = -1, tied = false;
    for (let i = 0; i < this.n; i++) {
      if (!this.p[i].active) continue;
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
    k: { type: "uint", bits: 32 }, over: { type: "bool" },
    phase: { type: "uint", bits: 8 }, t: { type: "uint", bits: 16 },
    phrase: { type: "uint", bits: 8 }, length: { type: "uint", bits: 8 },
    pattern: { type: "uint", bits: 8, count: 7 }, shown: { type: "uint", bits: 8 }, first: { type: "int", bits: 8 },
    progress: { type: "uint", bits: 8, per: "player" }, lock: { type: "uint", bits: 8, per: "player" },
    flash: { type: "uint", bits: 8, per: "player" }, last: { type: "uint", bits: 8, per: "player" },
    mend: { type: "uint", bits: 8, per: "player" }, award: { type: "uint", bits: 8, per: "player" },
    done: { type: "bool", per: "player" }, active: { type: "bool", per: "player" },
    woven: { type: "uint", bits: 16, per: "player" },
    pressed: { type: "players" }, correct: { type: "players" }, wrong: { type: "players" },
    mended: { type: "players" }, finished: { type: "players" },
    beep: { type: "bool" }, cue: { type: "bool" }, recall: { type: "bool" }, review: { type: "bool" }, ended: { type: "bool" },
  },
};

export const INTENT = { stitch: { values: [0, 1, 2, 3], neutral: 0 } };
