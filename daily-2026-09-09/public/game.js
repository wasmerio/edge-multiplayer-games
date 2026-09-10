// Host-only, fixed-tick push-your-luck simulation.
export const TICK_HZ = 30;
export const MAP = { baseW: 900, baseH: 500 };
export function mapSize(players, scale = 1) {
  return { w: Math.round(900 * Math.sqrt(scale)), h: Math.round((140 + Math.max(2, players) * 100) * Math.sqrt(scale)) };
}
export const COLORS = ["#64e8ca", "#ffbd69", "#91adff", "#f78dc9", "#d5e879", "#9be2ff", "#cf9aff", "#ff8b86"];

export class Game {
  constructor(playerCount, opts = mapSize(playerCount)) {
    this.n = playerCount;
    this.w = opts.w;
    this.h = opts.h;
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.scores = Array(playerCount).fill(0);
    this.active = Array(playerCount).fill(true);
    this.rigs = [];
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.roundOver = false;
    this.rigs = Array.from({ length: this.n }, () => ({ heat: 0, haul: 0, bank: 0, lock: 0, work: 0, mode: 0 }));
  }

  disconnect(pid) {
    this.active[pid] = false;
    const p = this.rigs[pid];
    if (p) { p.haul = 0; p.bank = 0; p.work = 0; p.mode = 0; }
  }

  step(inputs = []) {
    const events = [];
    if (!this.roundOver) {
      const rich = this.tick % 180 >= 120;
      for (let i = 0; i < this.n; i++) {
        const p = this.rigs[i];
        if (!this.active[i]) continue;
        const intent = inputs[i] === 1 ? 1 : inputs[i] === -1 ? -1 : 0;
        p.mode = intent;
        if (p.lock > 0) {
          p.lock--;
          p.heat = Math.max(0, p.heat - 2);
          p.mode = 0;
          continue;
        }
        if (intent === 1) {
          p.bank = 0;
          p.heat += rich ? 2 : 1;
          if (p.heat >= 90) {
            events.push([i, 2, p.haul]);
            p.heat = 90;
            p.haul = p.work = 0;
            p.lock = 45;
            p.mode = 0;
          } else if (++p.work === 10) {
            p.haul += rich ? 3 : 1;
            p.work = 0;
          }
        } else {
          p.work = 0;
          p.heat = Math.max(0, p.heat - (intent === -1 ? 1 : 2));
          if (intent === -1 && p.haul > 0) {
            if (++p.bank === 24) {
              this.scores[i] += p.haul;
              events.push([i, 1, p.haul]);
              p.haul = p.bank = 0;
            }
          } else p.bank = 0;
        }
      }
      this.tick++;
      if (this.tick === 900) {
        this.roundOver = true;
        this.rigs.forEach((p, i) => {
          if (p.haul) events.push([i, 3, p.haul]);
          p.haul = p.bank = p.work = 0;
          p.mode = 0;
        });
      }
    }
    const phase = this.tick % 180;
    return {
      t: "s", k: this.tick, v: [phase >= 120 ? 1 : 0, phase < 120 ? 120 - phase : 180 - phase],
      p: this.rigs.map((p, i) => [p.heat, p.haul, p.bank, p.lock, p.mode, this.active[i] ? 1 : 0, this.scores[i]]),
      d: events, over: this.roundOver,
    };
  }

  winner(target) {
    const best = Math.max(...this.scores.filter((_, i) => this.active[i]));
    if (best < target) return -1;
    const leaders = this.scores.map((s, i) => this.active[i] && s === best ? i : -1).filter(i => i >= 0);
    return leaders.length === 1 ? leaders[0] : -1;
  }
}
