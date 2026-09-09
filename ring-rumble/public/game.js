export const TICK_HZ = 30;
export const COLORS = ["#b3ff70", "#ad94ff", "#ff866b", "#6fdcff", "#ffcb65", "#ff82c8", "#6effcf", "#f2f0df"];
export const INPUT = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, PUNCH: 16, DASH: 32 };
export const mapSize = (n) => ({ radius: 5.8 + Math.max(0, n - 2) * 0.45 });
const round = (v) => Math.round(v * 100) / 100 || 0;

export class Game {
  constructor(playerCount, opts = mapSize(playerCount)) {
    if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) throw new RangeError("2 to 8 fighters required");
    this.n = playerCount;
    this.baseRadius = opts.radius;
    this.scores = Array(playerCount).fill(0);
    this.round = 0;
    this.roundOver = true;
    this.disconnected = new Set();
    this.fighters = [];
  }

  startRound() {
    this.round++;
    this.tick = 0;
    this.freeze = 60;
    this.radius = this.baseRadius;
    this.roundOver = false;
    this.roundWinner = -1;
    this.fighters = Array.from({ length: this.n }, (_, i) => {
      const a = i * Math.PI * 2 / this.n - Math.PI / 2;
      return { x: Math.sin(a) * this.radius * 0.55, z: Math.cos(a) * this.radius * 0.55,
        a: a + Math.PI, vx: 0, vz: 0, damage: 0, alive: !this.disconnected.has(i),
        attack: 0, punchCooldown: 0, dash: 0, cooldown: 0, stun: 0, previous: 0 };
    });
    this.pendingDeaths = [];
    return this.snapshot();
  }

  disconnect(i) {
    this.disconnected.add(i);
    if (this.fighters[i]?.alive) {
      this.fighters[i].alive = false;
      this.pendingDeaths.push(i);
    }
  }

  step(inputs) {
    if (this.roundOver) return this.snapshot();
    const deaths = this.pendingDeaths.splice(0);
    const events = [];
    if (this.freeze > 0) {
      this.freeze--;
      return this.snapshot(events, deaths);
    }
    this.tick++;
    this.radius = Math.max(1.4, this.baseRadius - Math.max(0, this.tick - 600) * 0.0045);
    const strikes = [];
    for (let i = 0; i < this.n; i++) {
      const p = this.fighters[i];
      if (!p.alive) continue;
      const mask = (inputs[i] | 0) & 63;
      for (const key of ["attack", "punchCooldown", "dash", "cooldown", "stun"]) p[key] = Math.max(0, p[key] - 1);
      let x = Number(!!(mask & 2)) - Number(!!(mask & 1));
      let z = Number(!!(mask & 8)) - Number(!!(mask & 4));
      const length = Math.hypot(x, z);
      if (length) { x /= length; z /= length; }
      if (!p.stun && !p.dash) {
        if (length) p.a = Math.atan2(x, z);
        if ((mask & 32) && !(p.previous & 32) && !p.cooldown) {
          p.dash = 7;
          p.cooldown = 42;
          p.vx = Math.sin(p.a) * 0.38;
          p.vz = Math.cos(p.a) * 0.38;
        } else if ((mask & 16) && !p.punchCooldown) {
          const target = this.nearest(i, 2.1);
          if (target >= 0) {
            const q = this.fighters[target];
            p.a = Math.atan2(q.x - p.x, q.z - p.z);
          }
          p.attack = 9;
          p.punchCooldown = 17;
        }
      }
      if (p.attack === 6 && !p.stun && !p.dash) strikes.push(i);
      const speed = p.stun || p.dash ? 0 : p.attack > 0 ? 0.07 : 0.115;
      p.x += x * speed + p.vx;
      p.z += z * speed + p.vz;
      p.vx *= p.dash ? 0.96 : 0.78;
      p.vz *= p.dash ? 0.96 : 0.78;
      p.previous = mask;
    }
    // Resolve every attack from the same tick, so simultaneous hits can trade.
    for (const i of strikes) {
      const p = this.fighters[i];
      for (let j = 0; j < this.n; j++) {
        const q = this.fighters[j];
        if (j === i || !q.alive || q.dash) continue;
        const dx = q.x - p.x, dz = q.z - p.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 1.75 || (distance > 0.01 && (dx * Math.sin(p.a) + dz * Math.cos(p.a)) / distance < 0.25)) continue;
        q.damage = Math.min(200, q.damage + 18);
        const power = 0.23 + q.damage * 0.004;
        q.vx += (distance > 0.01 ? dx / distance : Math.sin(p.a)) * power;
        q.vz += (distance > 0.01 ? dz / distance : Math.cos(p.a)) * power;
        q.stun = 9;
        events.push([i, j]);
      }
    }
    for (let i = 0; i < this.n; i++) {
      const p = this.fighters[i];
      if (!p.alive) continue;
      for (let j = i + 1; j < this.n; j++) {
        const q = this.fighters[j];
        if (!q.alive) continue;
        let dx = q.x - p.x, dz = q.z - p.z;
        let distance = Math.hypot(dx, dz);
        if (distance >= 0.82) continue;
        const push = (0.82 - distance) / 2;
        if (distance < 0.001) { dx = 1; dz = 0; distance = 1; }
        p.x -= dx / distance * push; p.z -= dz / distance * push;
        q.x += dx / distance * push; q.z += dz / distance * push;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const p = this.fighters[i];
      if (p.alive && Math.hypot(p.x, p.z) > this.radius + 0.15 + 1e-9) {
        p.alive = false;
        deaths.push(i);
      }
    }
    const living = this.fighters.reduce((n, p) => n + Number(p.alive), 0);
    if (living <= 1 || this.tick >= 1800) {
      this.roundOver = true;
      this.roundWinner = living === 1 ? this.fighters.findIndex(p => p.alive) : -1;
      if (this.roundWinner >= 0) this.scores[this.roundWinner]++;
    }
    return this.snapshot(events, deaths);
  }

  nearest(i, reach = Infinity) {
    const p = this.fighters[i];
    let target = -1;
    for (let j = 0; j < this.n; j++) {
      if (i === j || !this.fighters[j].alive) continue;
      const q = this.fighters[j];
      const distance = Math.hypot(q.x - p.x, q.z - p.z);
      if (distance < reach) { reach = distance; target = j; }
    }
    return target;
  }

  snapshot(e = [], d = []) {
    return { t: "s", k: this.tick, r: round(this.radius), f: this.freeze,
      p: this.fighters.map(p => [round(p.x), round(p.z), round(p.a), p.damage, +p.alive, p.attack, p.dash, p.cooldown, p.stun]),
      e, d, over: this.roundOver, win: this.roundWinner, scores: [...this.scores] };
  }

  winner(target) {
    return this.scores.findIndex(score => score >= target);
  }
}

export function botInput(game, i) {
  const p = game.fighters[i];
  const j = game.nearest(i);
  if (!p?.alive || j < 0) return 0;
  const q = game.fighters[j];
  const dx = q.x - p.x, dz = q.z - p.z;
  let mask = 0;
  if (Math.hypot(dx, dz) > 1.3) {
    if (Math.abs(dx) > 0.2) mask |= dx > 0 ? 2 : 1;
    if (Math.abs(dz) > 0.2) mask |= dz > 0 ? 8 : 4;
  }
  if (game.tick % 45 < 28) mask |= 16;
  return mask;
}
