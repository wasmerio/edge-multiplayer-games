export const TICK_HZ = 30;
export const MAP = { baseW: 960, baseH: 720 };
export function mapSize(_players, scale = 1) {
  const factor = Math.sqrt(Number.isFinite(scale) && scale > 0 ? scale : 1);
  return { w: Math.round(MAP.baseW * factor), h: Math.round(MAP.baseH * factor) };
}
export const COLORS = ["#6ef5cf", "#ff8ca8", "#85baff", "#ffdc79", "#cc9cff", "#ffae70", "#7ce3ff", "#e6ee96"];
const wrap = (a) => ((a % 360) + 360) % 360;
const distance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const target = (round, pulse) => wrap(35 + round * 47 + pulse * 113 + (pulse % 3) * 29);

export class Game {
  constructor(playerCount, opts = mapSize(playerCount)) {
    this.n = playerCount;
    this.w = opts.w;
    this.h = opts.h;
    this.scores = new Array(playerCount).fill(0);
    this.active = new Array(playerCount).fill(true);
    this.players = [];
    this.round = 0;
    this.tick = 0;
    this.freeze = 0;
    this.broadcasts = 0;
    this.roundOver = true;
    this.aim = 0;
    this.nextAim = 0;
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.freeze = TICK_HZ;
    this.broadcasts = 0;
    this.roundOver = false;
    this.aim = target(this.round, 0);
    this.nextAim = target(this.round, 1);
    this.players = Array.from({ length: this.n }, () => ({ angle: 270, velocity: 0, points: 0, award: -1 }));
  }

  disconnect(pid) {
    if (pid >= 0 && pid < this.n) this.active[pid] = false;
  }

  step(inputs = []) {
    const events = [];
    if (!this.roundOver) {
      if (this.freeze > 0) {
        this.freeze--;
      } else {
        if (this.tick > 0 && this.tick % 75 === 0) {
          this.aim = this.nextAim;
          this.nextAim = target(this.round, this.broadcasts + 1);
        }
        this.tick++;
        for (let i = 0; i < this.n; i++) {
          if (!this.active[i]) continue;
          const p = this.players[i];
          const intent = inputs[i] === -1 ? -1 : inputs[i] === 1 ? 1 : 0;
          p.velocity = intent ? Math.max(-5, Math.min(5, p.velocity + intent * 0.6)) : p.velocity * 0.65;
          if (Math.abs(p.velocity) < 0.02) p.velocity = 0;
          p.angle = wrap(p.angle + p.velocity);
          if (this.tick % 75 === 0) {
            const error = distance(p.angle, this.aim);
            p.award = error <= 8 ? 3 : error <= 22 ? 1 : 0;
            p.points += p.award;
            this.scores[i] += p.award;
            events.push([i, p.award]);
          }
        }
        if (this.tick % 75 === 0) this.broadcasts++;
        if (this.broadcasts === 10 || !this.active.some(Boolean)) this.roundOver = true;
      }
    }
    return {
      t: "s", k: this.tick, f: this.freeze, b: this.broadcasts,
      a: [this.aim, this.nextAim],
      p: this.players.map((p, i) => [Math.round(p.angle * 10) / 10, Math.round(p.velocity * 100) / 100, p.points, this.active[i] ? 1 : 0, p.award]),
      q: [...this.scores], d: events, over: this.roundOver,
    };
  }

  winner(goal) {
    let best = goal - 1;
    let winner = -1;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      if (this.scores[i] > best) { best = this.scores[i]; winner = i; }
      else if (this.scores[i] === best) winner = -1;
    }
    return winner;
  }
}
