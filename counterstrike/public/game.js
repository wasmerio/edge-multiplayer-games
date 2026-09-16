export const TICK_HZ = 30;
export const MAP = { w: 1200, h: 760 };
export const COLORS = ['#edb35c', '#72c4e8'];
export const TEAMS = ['Attackers', 'Defenders'];
export const RULES = { radius: 13, speed: 4.8, eye: 60, height: 76, wallHeight: 140, plant: 90, defuse: 150, kitDefuse: 75, fuse: 1050, round: 2700, freeze: 450 };
export const WEAPONS = [
  { id: 'pistol', name: 'P12 Pistol', price: 0, magazine: 12, damage: 26, cooldown: 9, reload: 42, speed: 1, note: 'Light sidearm · 12 rounds' },
  { id: 'smg', name: 'V9 SMG', price: 1250, magazine: 30, damage: 20, cooldown: 3, reload: 48, speed: 0.96, note: 'Fast fire · 30 rounds' },
  { id: 'rifle', name: 'AR-34 Rifle', price: 2700, magazine: 30, damage: 34, cooldown: 5, reload: 60, speed: 0.9, note: 'Balanced rifle · 30 rounds' },
  { id: 'sniper', name: 'SR-90 Sniper', price: 4750, magazine: 5, damage: 90, cooldown: 32, reload: 84, speed: 0.8, note: 'Heavy precision · 5 rounds' },
];
export const SHOP = [...WEAPONS, { id: 'armor', name: 'Kevlar vest', price: 650, note: '100 armor · absorbs 30% body damage' },
  { id: 'kit', name: 'Defuse kit', price: 400, note: 'Defenders only · defuse in 2.5 seconds' }];
export const SITES = [[910, 160, 74], [910, 600, 74]];
export const WALLS = [
  [0, 0, 1200, 24], [0, 736, 1200, 24], [0, 0, 24, 760], [1176, 0, 24, 760],
  [210, 160, 100, 145], [210, 455, 100, 145],
  [410, 24, 70, 180], [410, 285, 70, 190], [410, 556, 70, 180],
  [640, 140, 90, 145], [640, 475, 90, 145],
  [835, 300, 130, 160], [1020, 115, 65, 95], [1020, 550, 65, 95],
];
export function cleanInput(input) {
  if (!Array.isArray(input) || !Number.isFinite(input[0]) || !Number.isFinite(input[1])) return [0, 0, 0];
  return [input[0] & 127, ((round(input[1]) % 360) + 360) % 360,
    Number.isFinite(input[2]) ? Math.max(-75, Math.min(75, round(input[2]))) : 0];
}
export function blocked(x, y) {
  const r = RULES.radius;
  return WALLS.some(([wx, wy, w, h]) => {
    const dx = x - Math.max(wx, Math.min(x, wx + w));
    const dy = y - Math.max(wy, Math.min(y, wy + h));
    return dx * dx + dy * dy < r * r;
  });
}
export function movePlayer(p, buttons, aim, weapon, ticks = 1) {
  const angle = aim * Math.PI / 180;
  const strafe = Number(!!(buttons & 2)) - Number(!!(buttons & 1));
  const forward = Number(!!(buttons & 4)) - Number(!!(buttons & 8));
  if (!strafe && !forward) return;
  const x = Math.cos(angle) * forward - Math.sin(angle) * strafe;
  const y = Math.sin(angle) * forward + Math.cos(angle) * strafe;
  const speed = RULES.speed * WEAPONS[weapon].speed * ticks / (strafe && forward ? Math.SQRT2 : 1);
  if (!blocked(p.x + x * speed, p.y)) p.x += x * speed;
  if (!blocked(p.x, p.y + y * speed)) p.y += y * speed;
}
function rayBox(origin, direction, min, max) {
  let near = 0, far = 1600;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis], d = direction[axis];
    if (Math.abs(d) < 1e-8) { if (o < min[axis] || o > max[axis]) return Infinity; }
    else {
      const a = (min[axis] - o) / d, b = (max[axis] - o) / d;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (far < near) return Infinity;
    }
  }
  return near;
}
const round = n => Math.round(n * 10) / 10 || 0;

export class Game {
  constructor(playerCount) {
    if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) throw new Error('A match needs 2–8 players.');
    this.count = playerCount;
    this.round = 0; this.roundOver = true; this.scores = [0, 0];
    this.disconnected = new Set(); this.players = []; this.events = []; this.deaths = [];
  }
  startRound() {
    this.round++; this.roundOver = false; this.tick = 0; this.left = RULES.round;
    this.freeze = RULES.freeze; this.result = [-1, '']; this.events = []; this.deaths = [];
    this.players = Array.from({ length: this.count }, (_, i) => {
      const previous = this.players[i], survived = previous?.hp > 0;
      const weapon = survived ? previous.weapon : 0;
      return {
        x: i % 2 ? 1120 : 90, y: 285 + Math.floor(i / 2) * 62, a: i % 2 ? 180 : 0, pitch: 0,
        hp: this.disconnected.has(i) ? 0 : 100, ammo: WEAPONS[weapon].magazine, reload: 0, cooldown: 0, action: 0,
        kills: previous?.kills || 0, weapon, money: previous?.money ?? 800,
        armor: survived ? previous.armor : 0, kit: survived ? previous.kit : false,
      };
    });
    const carrier = this.players.findIndex((p, i) => i % 2 === 0 && p.hp > 0);
    this.bomb = [0, carrier, carrier < 0 ? 90 : this.players[carrier].x, carrier < 0 ? 380 : this.players[carrier].y, 0, -1];
  }
  disconnect(i) {
    this.disconnected.add(i);
    if (this.players[i]) this.players[i].hp = 0;
  }
  finish(team, reason) {
    if (this.roundOver) return;
    this.roundOver = true; this.scores[team]++; this.result = [team, reason];
    this.players.forEach((p, i) => this.reward(i, i % 2 === team ? 3250 : 1900));
  }
  reward(i, amount) { this.players[i].money = Math.min(16000, this.players[i].money + amount); }
  buy(i, item) {
    const p = this.players[i], product = SHOP.find(product => product.id === item);
    if (!p || p.hp <= 0 || this.disconnected.has(i)) return { ok: false, reason: 'Only living players can buy.' };
    if (this.roundOver || this.freeze <= 0) return { ok: false, reason: 'The buy period has ended.' };
    if (i % 2 ? p.x < 1040 : p.x > 180) return { ok: false, reason: 'Buy from your spawn area.' };
    if (!product) return { ok: false, reason: 'Unknown item.' };
    if (item === 'kit' && i % 2 === 0) return { ok: false, reason: 'Defuse kits are for defenders.' };
    const weapon = WEAPONS.findIndex(w => w.id === item);
    if (weapon === p.weapon || item === 'armor' && p.armor === 100 || item === 'kit' && p.kit) return { ok: false, reason: 'Already equipped.' };
    if (p.money < product.price) return { ok: false, reason: 'Not enough money.' };
    p.money -= product.price;
    if (weapon >= 0) { p.weapon = weapon; p.ammo = WEAPONS[weapon].magazine; p.reload = 0; p.cooldown = 0; }
    else if (item === 'armor') p.armor = 100;
    else p.kit = true;
    return { ok: true, reason: `${product.name} equipped.` };
  }
  winner(target) { return this.scores.findIndex(score => score >= target); }
  fire(i) {
    const p = this.players[i], angle = p.a * Math.PI / 180, pitch = p.pitch * Math.PI / 180;
    const direction = [Math.cos(angle) * Math.cos(pitch), Math.sin(angle) * Math.cos(pitch), Math.sin(pitch)];
    const origin = [p.x, p.y, RULES.eye], weapon = WEAPONS[p.weapon];
    let distance = Math.min(1600, ...WALLS.map(([x,y,w,h]) => rayBox(origin, direction, [x,y,0], [x+w,y+h,RULES.wallHeight]))), hit = -1;
    if (direction[2] < 0) distance = Math.min(distance, -RULES.eye / direction[2]);
    this.players.forEach((other, j) => {
      if (j === i || other.hp <= 0) return;
      const contact = rayBox(origin, direction, [other.x-11,other.y-11,0], [other.x+11,other.y+11,RULES.height]);
      if (contact < distance) { distance = contact; hit = j; }
    });
    if (hit >= 0 && hit % 2 !== i % 2) {
      const victim = this.players[hit], headshot = RULES.eye + direction[2] * distance >= 62;
      const damage = weapon.damage * (headshot ? 2 : 1);
      const absorbed = headshot ? 0 : Math.min(victim.armor, Math.ceil(damage * 0.3));
      victim.armor -= absorbed; victim.hp = Math.max(0, victim.hp - damage + absorbed);
      if (!victim.hp) { this.deaths.push(hit); p.kills++; this.reward(i, 300); }
    }
    this.events.push([i, round(p.x), round(p.y), round(p.x + direction[0] * distance), round(p.y + direction[1] * distance), hit, round(RULES.eye + direction[2] * distance)]);
    p.ammo--; p.cooldown = weapon.cooldown;
  }
  step(inputs = []) {
    this.events = []; this.deaths = [];
    if (this.roundOver) return this.snapshot();
    this.tick++;
    const intents = this.players.map((_, i) => cleanInput(inputs[i]));
    if (this.freeze > 0) {
      this.freeze--;
      this.players.forEach((p, i) => { p.a = intents[i][1]; p.pitch = intents[i][2]; });
      return this.snapshot();
    }
    this.left--;
    this.players.forEach((p, i) => {
      if (p.hp <= 0) { p.action = 0; return; }
      const [buttons, aim, pitch] = intents[i]; p.a = aim; p.pitch = pitch;
      const weapon = WEAPONS[p.weapon];
      movePlayer(p, buttons, aim, p.weapon);
      if (p.cooldown) p.cooldown--;
      if (p.reload) { p.reload--; if (!p.reload) p.ammo = weapon.magazine; }
      else if ((buttons & 32 || !p.ammo) && p.ammo < weapon.magazine) p.reload = weapon.reload;
      else if (buttons & 16 && !p.cooldown && !(buttons & 64)) this.fire(i);
    });
    const b = this.bomb;
    if (b[0] === 0) {
      if (b[1] >= 0 && this.players[b[1]].hp <= 0) b[1] = -1;
      if (b[1] < 0) b[1] = this.players.findIndex((p, i) => i % 2 === 0 && p.hp > 0 && Math.hypot(p.x - b[2], p.y - b[3]) < 28);
      if (b[1] >= 0) { b[2] = this.players[b[1]].x; b[3] = this.players[b[1]].y; }
    }
    this.players.forEach((p, i) => {
      const buttons = intents[i][0];
      if (p.hp <= 0 || !(buttons & 64) || buttons & 15 || p.reload) { p.action = 0; return; }
      const site = SITES.findIndex(([x, y, r]) => Math.hypot(p.x - x, p.y - y) <= r);
      if (b[0] === 0 && b[1] === i && site >= 0) {
        if (++p.action >= RULES.plant) { b[0] = 1; b[1] = -1; b[4] = RULES.fuse; b[5] = site; p.action = 0; this.reward(i, 300); }
      } else if (b[0] === 1 && i % 2 === 1 && Math.hypot(p.x - b[2], p.y - b[3]) < 48) {
        if (++p.action >= (p.kit ? RULES.kitDefuse : RULES.defuse)) { b[0] = 2; this.reward(i, 300); this.finish(1, 'Bomb defused'); }
      } else p.action = 0;
    });
    if (!this.roundOver) {
      const attack = this.players.some((p, i) => i % 2 === 0 && p.hp > 0);
      const defend = this.players.some((p, i) => i % 2 === 1 && p.hp > 0);
      if (b[0] === 1 && --b[4] <= 0) { b[0] = 3; this.finish(0, 'Bomb detonated'); }
      else if (!defend) this.finish(0, 'Defenders eliminated');
      else if (!attack && b[0] !== 1) this.finish(1, 'Attackers eliminated');
      else if (this.left <= 0 && b[0] === 0) this.finish(1, 'Time expired');
    }
    return this.snapshot();
  }
  snapshot() {
    return { t: 's', k: this.tick, p: this.players.map(p => [round(p.x), round(p.y), round(p.a), p.hp, p.ammo, p.reload, p.action, p.kills, p.weapon, p.money, p.armor, Number(p.kit), p.pitch]),
      b: this.bomb.map(roundOrKeep), e: this.events, d: this.deaths, over: this.roundOver,
      left: this.left, freeze: this.freeze, scores: [...this.scores], result: [...this.result] };
  }
}
const roundOrKeep = n => typeof n === 'number' ? round(n) : n;
