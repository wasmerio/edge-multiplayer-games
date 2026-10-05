// {{name}}: race to the pellet; a boost gets you there first.
// Headless: no DOM, no network, no timers, no Math.random. It runs in Node.
export const SPEED = 4;
export const BOOST_SPEED = 9;
export const BOOST_TICKS = 6;
export const BOOST_COOLDOWN = 45;
export const READY_TICKS = 45;
export const PELLETS_PER_ROUND = 5;
export const RADIUS = 12;
const REACH = 20;
const MARGIN = 40;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts.arena;
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    // The engine reads these four.
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.left = 0;
    this.ready = 0;
    this.pellet = { x: w / 2, y: h / 2 };
    this.gone = new Array(playerCount).fill(false);
    this.p = Array.from({ length: playerCount }, () => ({ x: w / 2, y: h / 2, boost: 0, cd: 0, held: false }));
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.left = PELLETS_PER_ROUND;
    this.ready = READY_TICKS;
    // Everyone starts on a ring, so no seat is closer to the middle. One player works too.
    const turn = this.rng.range(0, Math.PI * 2);
    this.p = this.p.map((_, i) => {
      const angle = turn + (i / this.n) * Math.PI * 2;
      return { x: this.w / 2 + Math.cos(angle) * this.h * 0.3, y: this.h / 2 + Math.sin(angle) * this.h * 0.3, boost: 0, cd: 0, held: false };
    });
    this.placePellet();
  }

  placePellet() {
    this.pellet = {
      x: Math.round(this.rng.range(MARGIN, this.w - MARGIN)),
      y: Math.round(this.rng.range(MARGIN, this.h - MARGIN)),
    };
  }

  // Called once when a player leaves for good. The seat stays in every array.
  disconnect(index) {
    this.gone[index] = true;
  }

  step(intents) {
    const took = [];
    const boosted = [];
    let beep = false;
    let go = false;
    if (!this.roundOver) {
      // The tick advances on every step, the countdown included.
      this.tick += 1;
      if (this.ready > 0) {
        beep = this.ready % 15 === 0;
        this.ready -= 1;
        go = this.ready === 0;
      } else {
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const me = this.p[i];
          // A seat that has sent no input yet holds 0, not an object.
          const intent = intents[i] || {};
          const mx = clamp(intent.mx || 0, -1, 1);
          const my = clamp(intent.my || 0, -1, 1);
          const pressed = (intent.boost || 0) > 0;
          // Act on the press edge, so a held key boosts once.
          if (pressed && !me.held && me.cd === 0) { me.boost = BOOST_TICKS; me.cd = BOOST_COOLDOWN; boosted.push(i); }
          me.held = pressed;
          const length = Math.max(1, Math.hypot(mx, my));
          const speed = me.boost > 0 ? BOOST_SPEED : SPEED;
          me.x = clamp(me.x + (mx / length) * speed, RADIUS, this.w - RADIUS);
          me.y = clamp(me.y + (my / length) * speed, RADIUS, this.h - RADIUS);
          if (me.boost > 0) me.boost -= 1;
          if (me.cd > 0) me.cd -= 1;
          if (Math.hypot(me.x - this.pellet.x, me.y - this.pellet.y) < REACH) took.push(i);
        }
        if (took.length) {
          for (const i of took) this.scores[i] += 1;
          this.left -= 1;
          if (this.left <= 0) this.roundOver = true;
          else this.placePellet();
        }
      }
    }
    // Every SNAPSHOT field, every tick. Guests keep no other state.
    return {
      k: this.tick,
      over: this.roundOver,
      ready: this.ready,
      left: this.left,
      x: this.p.map((me) => Math.round(me.x * 10) / 10),
      y: this.p.map((me) => Math.round(me.y * 10) / 10),
      cd: this.p.map((me) => me.cd),
      px: this.pellet.x,
      py: this.pellet.y,
      took,
      boosted,
      beep,
      go,
    };
  }

  // A seat index, or -1 to play another round.
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
    ready: { type: "uint", bits: 8 },
    left: { type: "uint", bits: 8 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    px: { type: "uint", bits: 16 },
    py: { type: "uint", bits: 16 },
    took: { type: "players" },
    boosted: { type: "players" },
    beep: { type: "bool" },
    go: { type: "bool" },
  },
};

export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 },
  my: { min: -1, max: 1, neutral: 0 },
  boost: { values: [0, 1], neutral: 0 },
};
