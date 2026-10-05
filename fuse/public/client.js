import { defineSnapshot, startGame } from "@engine/engine.js";
import {
  Game, INTENT, SNAPSHOT, ARENA, TARGET, TICK_HZ, PHASE, R, DASH_CD, BOO_CD, BOO_R, BLAST_R, ARM_TICKS, pillars,
} from "/game.js";

const PALETTE = ["#35d0e6", "#ff5c9d", "#bfe63b", "#a98bff", "#f5ecd7", "#4f8dff", "#46e0a2", "#c9a26b"];
const INK = "#f5ecd7";
const AMBER = "#ffb300";
const HOT = "#ff4d1c";
const TAU = Math.PI * 2;

const DISPLAY = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Roboto Condensed", "Liberation Sans Narrow", sans-serif';
const OUTLINE = { colour: "rgba(12, 9, 6, 0.85)", width: 6 };

// Cosmetic state only: everything that matters comes from the snapshot.
const fx = { scorch: [], floor: false, face: [] };

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const easeOut = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

// The floor sits on the persistent layer: painted at a round start and after each new scorch mark.
function drawFloor(surface, w, h, cover) {
  const L = "world";
  surface.clear(L);
  surface.box(L, { x: 0, y: 0, w, h, colour: { radial: [w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.7], stops: [[0, "#241d16"], [1, "#16120e"]] } });
  for (let x = 60; x < w; x += 60) surface.trail(L, { x, y: 0 }, { x, y: h }, { colour: "rgba(245, 236, 215, 0.035)", width: 2 });
  for (let y = 60; y < h; y += 60) surface.trail(L, { x: 0, y }, { x: w, y }, { colour: "rgba(245, 236, 215, 0.035)", width: 2 });
  surface.arc(L, { x: w / 2, y: h / 2, r: h * 0.2, from: 0, to: TAU, colour: "rgba(245, 236, 215, 0.09)", width: 3, dash: [14, 12] });
  surface.arc(L, { x: w / 2, y: h / 2, r: h * 0.4, from: 0, to: TAU, colour: "rgba(245, 236, 215, 0.05)", width: 2 });
  for (const s of fx.scorch) {
    surface.disc(L, { x: s.x, y: s.y, r: 92, colour: "rgba(0, 0, 0, 0.16)" });
    surface.disc(L, { x: s.x, y: s.y, r: 62, colour: "rgba(0, 0, 0, 0.22)" });
    surface.disc(L, { x: s.x, y: s.y, r: 30, colour: "rgba(0, 0, 0, 0.3)" });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + hash(s.x + i) * 0.5;
      const from = { x: s.x + Math.cos(a) * 34, y: s.y + Math.sin(a) * 34 };
      const len = 70 + hash(s.y + i) * 50;
      surface.trail(L, from, { x: s.x + Math.cos(a) * len, y: s.y + Math.sin(a) * len }, { colour: "rgba(0, 0, 0, 0.2)", width: 5 });
    }
  }
  for (const c of cover) {
    const { x, y } = c;
    surface.ellipse(L, { x: x + 6, y: y + 9, rx: c.r + 2, ry: c.r, colour: "rgba(0, 0, 0, 0.4)" });
    surface.disc(L, { x, y, r: c.r, colour: "#4a3d2e" });
    surface.arc(L, { x, y, r: c.r - 3, from: 0, to: TAU, colour: "#6b5a44", width: 6 });
    surface.arc(L, { x, y, r: c.r - 12, from: 0, to: TAU, colour: "#2c241b", width: 3 });
    surface.arc(L, { x, y, r: c.r - 3, from: -2.4, to: -1.2, colour: "rgba(255, 236, 200, 0.35)", width: 4 });
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      surface.disc(L, { x: x + Math.cos(a) * (c.r - 3), y: y + Math.sin(a) * (c.r - 3), r: 2.5, colour: "#2c241b" });
    }
    surface.poly(L, { points: [{ x: x - 8, y: y + 5 }, { x, y: y - 9 }, { x: x + 8, y: y + 5 }], colour: rgba(AMBER, 0.8) });
    surface.box(L, { x: x - 1.5, y: y - 4, w: 3, h: 5, colour: "#2c241b" });
  }
}

function drawEyes(surface, x, y, fx_, fy_, wide, colour) {
  const L = "actors";
  const px = -fy_, py = fx_;
  for (const side of [-1, 1]) {
    const ex = x + fx_ * 6 + px * side * 6.5, ey = y + fy_ * 6 + py * side * 6.5;
    surface.disc(L, { x: ex, y: ey, r: wide ? 6.2 : 5, colour });
    surface.disc(L, { x: ex + fx_ * 2, y: ey + fy_ * 2, r: wide ? 2 : 2.6, colour: "#17130f" });
  }
}

function drawBomb(surface, x, y, now, urgency, overtime) {
  const L = "actors";
  const flash = overtime ? Math.sin(now * 46) > 0 : Math.sin(now * (5 + urgency * 26)) > 0.6;
  surface.disc(L, { x: x + 1.5, y: y + 2.5, r: 13, colour: "rgba(0, 0, 0, 0.35)" });
  surface.disc(L, { x, y, r: 12.5, colour: flash ? (overtime ? "#fff3d6" : HOT) : "#15110d" });
  surface.arc(L, { x, y, r: 12.5, from: 0, to: TAU, colour: flash ? "#fff3d6" : "#3b3128", width: 2.5 });
  surface.arc(L, { x, y, r: 8, from: -2.6, to: -1.5, colour: "rgba(255, 255, 255, 0.55)", width: 2.5 });
  surface.box(L, { x: x + 5, y: y - 16, w: 7, h: 6, colour: "#6b5a44" });
  const tip = { x: x + 15 + Math.sin(now * 9) * 1.5, y: y - 22 };
  surface.poly(L, { points: [{ x: x + 8.5, y: y - 15 }, { x: x + 11, y: y - 21 }, tip], colour: "#c9a26b", stroke: 2.5, closed: false });
  const s = 3.5 + hash(Math.floor(now * 40)) * 4 + urgency * 2;
  surface.disc(L, { x: tip.x, y: tip.y, r: s + 3, colour: rgba(HOT, 0.45) });
  surface.disc(L, { x: tip.x, y: tip.y, r: s, colour: AMBER });
  surface.disc(L, { x: tip.x, y: tip.y, r: s * 0.45, colour: "#fff8e0" });
  for (let i = 0; i < 3; i++) {
    const a = hash(Math.floor(now * 30) + i * 7) * TAU, d = s + 3 + hash(Math.floor(now * 30) + i) * 7;
    surface.disc(L, { x: tip.x + Math.cos(a) * d, y: tip.y + Math.sin(a) * d, r: 1.4, colour: "#ffe08a" });
  }
}

function drawFuseBar(surface, snap, w, now) {
  const L = "actors";
  const x = 26, y = 12, bw = w - 52, bh = 12;
  surface.box(L, { x: x - 3, y: y - 3, w: bw + 6, h: bh + 6, colour: "rgba(12, 9, 6, 0.72)" });
  if (snap.ph === PHASE.OVERTIME) {
    const on = Math.sin(now * 40) > 0;
    surface.box(L, { x, y, w: bw, h: bh, colour: on ? HOT : "#fff3d6" });
    return;
  }
  if (snap.ph !== PHASE.LIVE && snap.ph !== PHASE.ARM) return;
  const frac = Math.max(0, Math.min(1, snap.fuse / Math.max(1, snap.fuseMax)));
  const colour = mix(HOT, AMBER, Math.min(1, frac * 1.6));
  surface.box(L, { x, y: y + 3, w: bw * frac, h: bh - 6, colour: "#c9a26b" });
  surface.box(L, { x, y: y + 3, w: bw * frac, h: 2, colour: "rgba(255, 255, 255, 0.35)" });
  for (let i = 1; i < 10; i++) surface.box(L, { x: x + (bw * i) / 10 - 1, y, w: 2, h: bh, colour: "rgba(12, 9, 6, 0.6)" });
  const tip = x + bw * frac;
  const s = 6 + hash(Math.floor(now * 40)) * 5;
  surface.disc(L, { x: tip, y: y + bh / 2, r: s + 5, colour: rgba(HOT, 0.35) });
  surface.disc(L, { x: tip, y: y + bh / 2, r: s, colour });
  surface.disc(L, { x: tip, y: y + bh / 2, r: s * 0.45, colour: "#fff8e0" });
}

function drawBlast(surface, snap, w, h) {
  const L = "actors";
  const age = snap.bAge;
  if (age > 34) return;
  const x = snap.bx, y = snap.by;
  if (age < 5) surface.box(L, { x: 0, y: 0, w, h, colour: `rgba(255, 228, 170, ${0.55 * (1 - age / 5)})` });
  const t = easeOut(age / 20);
  const fade = Math.max(0, 1 - age / 30);
  surface.disc(L, { x, y, r: BLAST_R * 0.55 * t, colour: `rgba(30, 22, 16, ${0.5 * fade})` });
  if (age < 12) surface.disc(L, { x, y, r: 26 + BLAST_R * 0.5 * t, colour: rgba(AMBER, 0.75 * (1 - age / 12)) });
  if (age < 8) surface.disc(L, { x, y, r: 14 + BLAST_R * 0.3 * t, colour: `rgba(255, 248, 224, ${1 - age / 8})` });
  surface.arc(L, { x, y, r: BLAST_R * t, from: 0, to: TAU, colour: rgba(HOT, fade), width: 2 + 12 * fade });
  surface.arc(L, { x, y, r: BLAST_R * 1.25 * easeOut(age / 28), from: 0, to: TAU, colour: `rgba(255, 243, 214, ${0.5 * fade})`, width: 2 });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + hash(i + snap.bx) * 0.6;
    const d = (40 + hash(i * 3 + snap.by) * BLAST_R * 1.25) * easeOut(age / 26);
    const r = (3 + hash(i * 5) * 7) * fade;
    const colour = i % 3 === 0 ? `rgba(60, 48, 38, ${fade})` : i % 3 === 1 ? rgba(AMBER, fade) : rgba(HOT, fade);
    surface.disc(L, { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + age * age * 0.03, r, colour });
  }
  if (age < 22) {
    surface.text(L, { x, y: y - 40 - age * 2.2, value: "BOOM", colour: "#fff3d6", alpha: 1 - age / 22, size: 52 + age, align: "center", family: DISPLAY, outline: OUTLINE });
  }
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const now = ctx.time();
  const players = ctx.players();
  const n = snap.x.length;
  const me = ctx.seat();
  const L = "actors";

  // Each pop leaves one scorch mark: the event arrives exactly once, on the host and on guests.
  for (const pop of ctx.events("d")) { fx.scorch.push({ x: pop.snapshot.bx, y: pop.snapshot.by }); fx.floor = false; }
  if (!fx.floor) { fx.floor = true; drawFloor(surface, w, h, pillars({ w, h })); }

  // The shake moves the layers; nothing is redrawn for it.
  const amp = snap.bAge < 16 ? (1 - snap.bAge / 16) * 11 : snap.pAge < 5 ? (1 - snap.pAge / 5) * 3 : 0;
  surface.shake(Math.sin(now * 97) * amp, Math.cos(now * 83) * amp);

  surface.clear(L);
  drawFuseBar(surface, snap, w, now);

  const live = snap.ph === PHASE.LIVE || snap.ph === PHASE.OVERTIME;
  const urgency = snap.ph === PHASE.OVERTIME ? 1 : 1 - snap.fuse / Math.max(1, snap.fuseMax);
  const order = [];
  for (let i = 0; i < n; i++) if (!snap.alive[i]) order.push(i);
  for (let i = 0; i < n; i++) if (snap.alive[i] && i !== snap.holder) order.push(i);
  if (snap.holder >= 0) order.push(snap.holder);

  for (const i of order) {
    const x = snap.x[i], y = snap.y[i];
    const colour = players[i]?.colour || ctx.colourFor(i);
    const face = fx.face[i] || (fx.face[i] = { x, y, fx: 0, fy: 1 });
    const mvx = x - face.x, mvy = y - face.y, speed = Math.hypot(mvx, mvy);
    if (speed > 0.6 && speed < 80) { face.fx += (mvx / speed - face.fx) * 0.35; face.fy += (mvy / speed - face.fy) * 0.35; }
    face.x = x; face.y = y;
    const fm = Math.hypot(face.fx, face.fy) || 1;
    const ux = face.fx / fm, uy = face.fy / fm;

    if (!snap.alive[i]) {
      // A ghost: a hollow wisp that can still shove.
      const bob = Math.sin(now * 3 + i) * 3;
      const booAge = BOO_CD - snap.cd[i];
      if (snap.cd[i] > 0 && booAge < 14) {
        const t = easeOut(booAge / 14);
        surface.arc(L, { x, y, r: BOO_R * t, from: 0, to: TAU, colour: rgba(colour, 0.8 * (1 - t)), width: 8 * (1 - t) + 1 });
        surface.arc(L, { x, y, r: BOO_R * t * 0.6, from: 0, to: TAU, colour: rgba(colour, 0.5 * (1 - t)), width: 3 });
      }
      surface.disc(L, { x, y: y + bob, r: R - 3, colour: rgba(colour, 0.24) });
      surface.arc(L, { x, y: y + bob, r: R - 3, from: 0, to: TAU, colour: rgba(colour, 0.75), width: 2, dash: [5, 5] });
      drawEyes(surface, x, y + bob, ux, uy, false, rgba(colour, 0.7));
      if (i === me && snap.cd[i] === 0 && !snap.over) {
        surface.arc(L, { x, y: y + bob, r: R + 4 + Math.sin(now * 6) * 2, from: 0, to: TAU, colour: rgba(colour, 0.5), width: 1.5 });
      }
      continue;
    }

    const holding = i === snap.holder;
    surface.ellipse(L, { x: x + 3, y: y + R - 2, rx: R * 0.95, ry: R * 0.42, colour: "rgba(0, 0, 0, 0.35)" });

    if (snap.dashing[i]) {
      for (let s = 1; s <= 4; s++) {
        surface.disc(L, { x: x - ux * s * 11, y: y - uy * s * 11, r: R - s * 2.5, colour: rgba(colour, 0.34 - s * 0.07) });
      }
    }
    if (holding && live) {
      const beat = 0.5 + 0.5 * Math.sin(now * (5 + urgency * 26));
      surface.disc(L, { x, y, r: R + 16 + beat * 8, colour: rgba(HOT, 0.1 + urgency * 0.12) });
      surface.arc(L, { x, y, r: R + 9 + beat * 6, from: 0, to: TAU, colour: rgba(HOT, 0.55 + 0.4 * beat), width: 3 });
    }
    if (holding && snap.ph === PHASE.ARM) {
      const t = snap.t / ARM_TICKS;
      surface.arc(L, { x, y, r: R + 10 + t * 170, from: 0, to: TAU, colour: rgba(AMBER, 0.9 * (1 - t) + 0.1), width: 4 });
      surface.arc(L, { x, y, r: R + 10 + t * 90, from: 0, to: TAU, colour: rgba(HOT, 0.7 * (1 - t) + 0.1), width: 2 });
    }

    surface.disc(L, { x, y, r: R, colour });
    surface.arc(L, { x, y, r: R - 1.5, from: 0, to: TAU, colour: "rgba(23, 19, 15, 0.55)", width: 3 });
    surface.arc(L, { x, y, r: R - 5.5, from: -2.5, to: -1.3, colour: "rgba(255, 255, 255, 0.5)", width: 3 });
    drawEyes(surface, x, y, ux, uy, holding || snap.stun[i], "#ffffff");

    if (snap.safe[i]) {
      surface.arc(L, { x, y, r: R + 6, from: now * 4, to: now * 4 + TAU, colour: rgba(INK, 0.8), width: 2, dash: [6, 6] });
    }
    if (snap.stun[i]) {
      for (let s = 0; s < 3; s++) {
        const a = now * 9 + (s * TAU) / 3;
        surface.disc(L, { x: x + Math.cos(a) * 15, y: y - R - 9 + Math.sin(a) * 4, r: 3, colour: "#ffe08a" });
      }
    }
    if (holding) drawBomb(surface, x + 12, y - 14, now, urgency, snap.ph === PHASE.OVERTIME);
    if (snap.pAge < 9 && holding) {
      const t = snap.pAge / 9;
      surface.arc(L, { x, y, r: R + 4 + t * 46, from: 0, to: TAU, colour: `rgba(255, 248, 224, ${1 - t})`, width: 5 * (1 - t) + 1 });
    }

    if (i === me) {
      const bob = Math.sin(now * 5) * 2.5;
      const ty = y - R - (holding ? 36 : 12) + bob;
      surface.poly(L, { points: [{ x: x - 8, y: ty - 10 }, { x: x + 8, y: ty - 10 }, { x, y: ty }], colour: INK });
      if (snap.cd[i] > 0) {
        const t = 1 - snap.cd[i] / DASH_CD;
        surface.arc(L, { x, y, r: R + 4, from: -Math.PI / 2, to: -Math.PI / 2 + TAU * t, colour: rgba(INK, 0.55), width: 2.5 });
      }
    } else {
      // Arena units shrink on a phone; dividing by the scale keeps the name readable there.
      const name = players[i]?.name || "";
      surface.text(L, { x, y: y + R + 5, value: name, colour: INK, alpha: 0.62, size: 13 / Math.max(0.45, surface.scale()), align: "center", baseline: "top", weight: 700 });
    }
  }

  drawBlast(surface, snap, w, h);
  if (snap.ph === PHASE.OVERTIME) {
    surface.text(L, { x: w / 2, y: 66, value: "ANY SECOND NOW", colour: Math.sin(now * 40) > 0 ? "#fff3d6" : HOT, size: 34, align: "center", family: DISPLAY, outline: OUTLINE });
  }

  const holderName = snap.holder >= 0 ? players[snap.holder]?.name || "Someone" : "";
  if (snap.ph === PHASE.ARM && snap.holder >= 0) {
    const mine = snap.holder === me;
    const a = Math.min(1, snap.t / 10);
    surface.box(L, { x: 0, y: h * 0.2 - 50, w, h: 96, colour: `rgba(12, 9, 6, ${0.72 * a})` });
    surface.text(L, {
      x: w / 2, y: h * 0.2, value: mine ? "YOU'VE GOT THE BOMB" : `${holderName.toUpperCase()} HAS THE BOMB`,
      colour: mine ? HOT : AMBER, alpha: a, size: mine ? 54 : 44, align: "center", family: DISPLAY, maxWidth: w - 80,
      glow: mine ? { colour: HOT, blur: 18 } : undefined,
    });
    surface.text(L, { x: w / 2, y: h * 0.2 + 30, value: mine ? "touch anyone to hand it over" : "scatter!", colour: rgba(INK, 0.8 * a), size: 18, align: "center", weight: 600 });
  }

  const goal = `First to ${ctx.target()} with a clear lead.`;
  if (me < 0) ctx.hud(`Watching. You get a seat in the next match. ${goal}`);
  else if (snap.over) ctx.hud(ctx.isHost() ? `Enter or the button starts the next round. ${goal}` : `Waiting for the host. ${goal}`);
  else if (!snap.alive[me]) ctx.hud("You popped. Haunt them: your dash is now a BOO that shoves the living.");
  else if (snap.holder === me) ctx.hud(snap.ph === PHASE.ARM ? "You have the bomb. It goes live in a moment." : "You have the bomb! Touch anyone to pass it.");
  else if (snap.holder >= 0) ctx.hud(`${holderName} has the bomb. Keep away, and dash when it gets close.`);
  else ctx.hud(goal);
}

startGame({
  title: "Short Fuse",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  arena: ARENA,
  target: TARGET,
  tickHz: TICK_HZ,
  minPlayers: 2,
  palette: PALETTE,
  bindings: {
    mx: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0, deadZone: 0.35 },
    my: { keys: { ArrowUp: -1, ArrowDown: 1, KeyW: -1, KeyS: 1 }, axis: 1, deadZone: 0.35 },
    dash: { keys: { Space: 1, ShiftLeft: 1, ShiftRight: 1, KeyJ: 1 }, buttons: { 0: 1 } },
  },
  // Space is the dash, so the host's next-round key is Enter.
  nextKey: "Enter",
  labels: {
    round: (n) => `Round ${n}`,
    over: (winner, info) => {
      if (winner) return `${winner} wins the match`;
      const alive = (info.snapshot?.alive ?? []).flatMap((up, i) => (up ? [i] : []));
      return alive.length === 1 ? `${info.players[alive[0]]?.name ?? "Someone"} is the last one standing` : "Nobody walks away";
    },
    next: (matchOver) => (matchOver ? "Rematch" : "Next round"),
  },
  // Rows follow the snapshot on screen: who is out, and who holds the bomb.
  scoreboard: (players, scores, snap) => players.map((player, i) => ({
    ...player,
    alive: snap ? snap.alive[i] : true,
    state: snap && snap.holder === i ? "holder" : "",
    note: snap && snap.holder === i ? "BOMB" : "",
  })),
  audioMap: {
    d: { sound: "boom", gain: 1, pitch: [0.9, 1.1] },
    pass: { sound: "pop", gain: 0.8, pitch: [0.9, 1.15] },
    arm: { sound: "start", gain: 0.6 },
    // The tick climbs in pitch as the visible fuse burns down.
    tk: { sound: "tick", gain: 0.6, pitch: (snap) => 0.8 + 0.9 * (1 - snap.fuse / Math.max(1, snap.fuseMax)) },
    hot: { sound: "beep", gain: 0.5, pitch: [1.9, 2.1] },
    dash: { sound: "whoosh", gain: 0.45, pitch: [1.1, 1.4] },
    boo: { sound: "zap", gain: 0.45, pitch: [0.6, 0.8] },
  },
  onRound() {
    fx.scorch = [];
    fx.floor = false;
    fx.face = [];
  },
  draw,
});
