// Only the host simulates; all peers receive complete renderable snapshots.
export const TICK_HZ = 30;
export const MAP = {
  baseW: 960, baseH: 560, perPlayer: 0,
  presets: { small: 0.7, normal: 1, large: 1.4, huge: 2 },
};
export const COLORS = [
  "#62e8ef", "#ffca64", "#b69cff", "#ff8bba",
  "#91ee94", "#81b6ff", "#ffab78", "#eef08b",
];
export function mapSize(players, scale = 1) {
  const cols = Math.min(4, Math.max(1, players));
  const rows = Math.ceil(players / 4);
  const f = Math.sqrt(scale);
  return { w: Math.round(Math.max(480, cols * 280) * f), h: Math.round(rows * 500 * f) };
}
const DURATION = 35 * TICK_HZ;
const READY = TICK_HZ;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class Game {
  constructor(playerCount, opts = mapSize(playerCount)) {
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 8) {
      throw new RangeError("Meteor Market supports 1–8 players");
    }
    this.n = playerCount;
    this.w = opts.w;
    this.h = opts.h;
    this.random = opts.random || Math.random;
    this.scores = Array(playerCount).fill(0);
    this.players = Array.from({ length: playerCount }, () => ({ x: 500, cargo: 0, jam: 0, active: true }));
    this.round = 0;
    this.roundOver = true;
    this.tick = 0;
    this.freeze = 0;
    this.objects = [];
    this.leaders = [];
    this.nextId = 0;
  }

  startRound() {
    this.round++;
    this.roundOver = false;
    this.tick = 0;
    this.freeze = READY;
    this.objects = [];
    this.leaders = [];
    this.nextId = 0;
    for (const p of this.players) {
      p.x = 500;
      p.cargo = 0;
      p.jam = 0;
    }
  }

  disconnect(pid) {
    if (this.players[pid]) this.players[pid].active = false;
  }

  step(inputs = []) {
    const events = [];
    if (!this.roundOver && this.freeze > 0) {
      this.freeze--;
    } else if (!this.roundOver) {
      this.tick++;
      for (let i = 0; i < this.n; i++) {
        const p = this.players[i];
        if (!p.active) continue;
        if (p.jam > 0) p.jam--;
        else {
          const d = inputs[i] === -1 ? -1 : inputs[i] === 1 ? 1 : 0;
          p.x = clamp(p.x + d * 18, 85, 915);
        }
      }
      // Stop spawning in time for the last object to reach the basket.
      if ((this.tick - 1) % 20 === 0 && this.tick <= DURATION - 129) {
        const roll = this.random();
        this.objects.push([this.nextId++, 100 + Math.floor(this.random() * 801), 0, roll < 0.28 ? -4 : roll < 0.5 ? 3 : 1]);
      }
      let keep = 0;
      for (const o of this.objects) {
        o[2] += 7;
        if (o[2] < 900) {
          this.objects[keep++] = o;
          continue;
        }
        for (let i = 0; i < this.n; i++) {
          const p = this.players[i];
          if (!p.active || Math.abs(p.x - o[1]) > 85) continue;
          p.cargo = Math.max(0, p.cargo + o[3]);
          if (o[3] < 0) p.jam = 12;
          events.push([i, o[3]]);
        }
      }
      this.objects.length = keep;
      if (this.tick >= DURATION) {
        this.roundOver = true;
        const best = Math.max(0, ...this.players.filter(p => p.active).map(p => p.cargo));
        this.leaders = this.players.flatMap((p, i) => p.active && best > 0 && p.cargo === best ? [i] : []);
        for (const i of this.leaders) {
          this.scores[i] += this.leaders.length === 1 ? 2 : 1;
          events.push([i, 0]);
        }
      }
    }
    return {
      t: "s", k: this.tick, f: this.freeze,
      p: this.players.map(p => [Math.round(p.x), p.cargo, p.jam, p.active ? 1 : 0]),
      o: this.objects.map(o => o.slice()), q: this.scores.slice(),
      d: events, r: this.leaders.slice(), over: this.roundOver,
    };
  }

  winner(target) {
    const best = Math.max(...this.scores);
    return best >= target && this.scores.filter(s => s === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}
