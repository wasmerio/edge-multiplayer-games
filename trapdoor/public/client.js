import { defineSnapshot, startGame } from "@engine/engine.js";
import {
  Game, INTENT, SNAPSHOT, ARENA, TARGET, TILE, TOP, RADIUS, DASH_COOLDOWN, DASH_TICKS, DROP_TICKS, LOCK_TICKS, READY_TICKS,
  NONE, PHASE, ALIVE, FALLEN, GONE, layout,
} from "/game.js";

// Cut-paper poster: bright plates on an ink stage. Red means the pit and nothing else.
const INK = "#1b1630";
const STAGE = "#120e22";
const PIT = "#07050f";
const PAPER = "#f6eedc";
const DANGER = "#ff3b2f";
const BLANK = ["#d8ccb1", "#cdc0a3"];
const SHAPES = [
  { name: "CIRCLE", mark: "●", colour: "#f7b731", dark: "#b97f0d" },
  { name: "TRIANGLE", mark: "▲", colour: "#17b8a6", dark: "#0b7d70" },
  { name: "SQUARE", mark: "■", colour: "#8a6cff", dark: "#5741b8" },
  { name: "PLUS", mark: "✚", colour: "#f58ab1", dark: "#b9517a" },
  { name: "DIAMOND", mark: "◆", colour: "#4aa8f0", dark: "#256fad" },
  { name: "STAR", mark: "★", colour: "#9bd13c", dark: "#638d17" },
];
const PALETTE = ["#ff8a1f", "#35c9ff", "#c6f24e", "#ff74d4", "#ffffff", "#ffd91a", "#b59bff", "#3fe6a8"];
const DISPLAY = 'Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", Georgia, serif';
const TAU = Math.PI * 2;
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// Cosmetic state only. Everything that decides the game is in the snapshot.
const fx = { bits: [], floats: [], shake: 0, face: [], prev: [], callAt: -9, openAt: -9, floor: null, role: "" };

function floorOf(snap, tiles) {
  const key = `${snap.seed}:${snap.sym}:${snap.nsym}:${snap.safe}:${tiles}`;
  if (!fx.floor || fx.floor.key !== key) fx.floor = { key, lay: layout(snap.seed, tiles, snap.nsym, snap.sym, snap.safe) };
  return fx.floor.lay;
}

function glyph(surface, layer, sym, x, y, size, colour, alpha = 1) {
  const s = size;
  if (sym === 0) surface.disc(layer, { x, y, r: s * 0.92, colour, alpha });
  else if (sym === 1) surface.poly(layer, { points: [{ x, y: y - s }, { x: x + s * 1.08, y: y + s * 0.82 }, { x: x - s * 1.08, y: y + s * 0.82 }], colour, alpha });
  else if (sym === 2) surface.box(layer, { x: x - s * 0.82, y: y - s * 0.82, w: s * 1.64, h: s * 1.64, colour, alpha });
  else if (sym === 3) {
    surface.box(layer, { x: x - s * 0.34, y: y - s, w: s * 0.68, h: s * 2, colour, alpha });
    surface.box(layer, { x: x - s, y: y - s * 0.34, w: s * 0.66, h: s * 0.68, colour, alpha });
    surface.box(layer, { x: x + s * 0.34, y: y - s * 0.34, w: s * 0.66, h: s * 0.68, colour, alpha });
  } else if (sym === 4) surface.poly(layer, { points: [{ x, y: y - s * 1.12 }, { x: x + s * 0.86, y }, { x, y: y + s * 1.12 }, { x: x - s * 0.86, y }], colour, alpha });
  else {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.5 : s * 1.14;
      const a = -TAU / 4 + (i / 10) * TAU;
      points.push({ x: x + Math.cos(a) * r, y: y + s * 0.06 + Math.sin(a) * r });
    }
    surface.poly(layer, { points, colour, alpha });
  }
}

function burst(x, y, count, speed, colour, life = 0.5, r = 6, gravity = 0) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + x * 0.01;
    const v = speed * (0.55 + ((i * 7919) % 10) / 20);
    fx.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, colour, r, gravity });
  }
}

function crackLines(surface, x0, y0, colour) {
  const zig = [[0.5, 0.06], [0.42, 0.26], [0.58, 0.4], [0.44, 0.58], [0.6, 0.76], [0.5, 0.94]];
  const arm = [[0.58, 0.4], [0.78, 0.34], [0.92, 0.46]];
  const leg = [[0.44, 0.58], [0.24, 0.64], [0.08, 0.56]];
  for (const line of [zig, arm, leg]) {
    const points = line.map(([u, v]) => ({ x: x0 + u * TILE, y: y0 + v * (TILE - 10) }));
    surface.poly("world", { points, colour: INK, stroke: 11, closed: false });
    surface.poly("world", { points, colour, stroke: 4, closed: false });
  }
}

function drawFloor(surface, snap, ctx, lay, cols, rows) {
  const { w, h } = surface.arena();
  const time = ctx.time();
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w, h, colour: STAGE });
  const gap = 5;
  const side = TILE - gap * 2;
  const sinceCall = time - fx.callAt;
  const sinceOpen = time - fx.openAt;
  const dropping = snap.phase === PHASE.DROP || (snap.phase === PHASE.DONE && snap.tMax === DROP_TICKS);
  const closing = snap.phase === PHASE.DROP && snap.last < 0 && snap.t <= 5 ? 1 - snap.t / 5 : 0;
  const cracks = new Map();
  snap.crack.forEach((index, seat) => { if (index !== NONE) cracks.set(index, seat); });
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    let x0 = col * TILE;
    const y0 = TOP + row * TILE;
    if (snap.phase === PHASE.READY) {
      surface.box("world", { x: x0 + gap, y: y0 + gap, w: side, h: side, colour: "#a2957a" });
      surface.box("world", { x: x0 + gap, y: y0 + gap, w: side, h: side - 10, colour: BLANK[(col + row) % 2] });
      continue;
    }
    const sym = lay[i];
    const shape = SHAPES[sym];
    const called = sym === snap.sym;
    const cracked = cracks.has(i);
    const opens = !called || cracked;
    if (dropping && opens) {
      // The pit, with the two door leaves folded against its sides.
      const swing = Math.max(closing, 1 - Math.min(1, sinceOpen / 0.16));
      const leaf = Math.max(9, (side / 2) * swing);
      surface.box("world", { x: x0 + gap, y: y0 + gap, w: side, h: side, colour: { radial: [x0 + TILE / 2, y0 + TILE / 2, 10, x0 + TILE / 2, y0 + TILE / 2, TILE * 0.75], stops: [[0, PIT], [1, "#2a0d18"]] } });
      surface.box("world", { x: x0 + gap, y: y0 + gap, w: leaf, h: side, colour: shape.dark });
      surface.box("world", { x: x0 + TILE - gap - leaf, y: y0 + gap, w: leaf, h: side, colour: shape.dark });
      surface.box("world", { x: x0 + gap + 2, y: y0 + gap + 2, w: side - 4, h: side - 4, colour: DANGER, stroke: 4, alpha: 0.55 * (1 - swing) });
      continue;
    }
    // The last half second: every plate that will drop rattles.
    const warn = snap.phase === PHASE.CALL && snap.t <= 15 && opens && !calm;
    if (warn) x0 += Math.sin(time * 75 + i * 1.7) * 3.5;
    const flip = snap.phase === PHASE.CALL ? Math.max(0, Math.min(1, (sinceCall - col * 0.018 - row * 0.012) / 0.14)) : 1;
    if (flip < 1) {
      // The back of the plate shows while the new face flips in.
      surface.box("world", { x: x0 + gap, y: y0 + gap, w: side, h: side, colour: "#a2957a" });
      surface.box("world", { x: x0 + gap, y: y0 + gap, w: side, h: side - 10, colour: BLANK[(col + row) % 2] });
    }
    const tall = (side - 10) * flip;
    const top = y0 + gap + (side - 10 - tall) / 2;
    surface.box("world", { x: x0 + gap, y: top + 10, w: side, h: tall, colour: shape.dark });
    surface.box("world", { x: x0 + gap, y: top, w: side, h: tall, colour: shape.colour });
    if (flip > 0.7) {
      surface.box("world", { x: x0 + gap, y: top, w: side, h: 8, colour: "#ffffff", alpha: 0.22 });
      glyph(surface, "world", sym, x0 + TILE / 2, y0 + gap + (side - 10) / 2, 36, INK, 0.82);
      if (cracked && !dropping) crackLines(surface, x0, y0, ctx.colourFor(cracks.get(i)));
    }
    if (dropping && !opens) surface.box("world", { x: x0 + gap + 3, y: y0 + gap + 3, w: side - 6, h: side - 16, colour: "#ffffff", stroke: 6, alpha: 0.9 });
  }
}

function drawSign(surface, snap, ctx) {
  const { w } = surface.arena();
  const time = ctx.time();
  surface.box("actors", { x: 0, y: 0, w, h: TOP - 6, colour: INK });
  const shape = SHAPES[snap.sym];
  const live = snap.phase === PHASE.CALL || snap.phase === PHASE.DROP || (snap.phase === PHASE.DONE && snap.k > READY_TICKS);
  // The called shape: the biggest thing on the board.
  const pop = live ? 1 + Math.max(0, 0.22 - (time - fx.callAt)) * 1.4 : 1;
  const bw = 100 * pop;
  surface.box("actors", { x: 62 - bw / 2, y: 57 - bw / 2 + 5, w: bw, h: bw, colour: live ? shape.dark : "#a2957a" });
  surface.box("actors", { x: 62 - bw / 2, y: 57 - bw / 2 - 3, w: bw, h: bw, colour: live ? shape.colour : BLANK[0], glow: live ? { colour: shape.colour, blur: 26 } : undefined });
  if (live) glyph(surface, "actors", snap.sym, 62, 54, 30 * pop, INK, 0.9);
  else surface.text("actors", { x: 62, y: 56, value: "?", size: 70, weight: 900, family: DISPLAY, align: "center", baseline: "middle", colour: INK });
  // The clock: a thick bar that drains towards the shape.
  const x0 = 136;
  const bar = w - x0 - 130;
  surface.box("actors", { x: x0, y: 30, w: bar, h: 54, colour: "#2d2648" });
  if (snap.phase === PHASE.CALL) {
    const part = snap.t / snap.tMax;
    const hot = snap.t <= 36;
    const blink = hot && Math.floor(time * 8) % 2 === 0;
    surface.box("actors", { x: x0 + 5, y: 35, w: Math.max(0, (bar - 10) * part), h: 44, colour: hot ? (blink ? "#ffffff" : DANGER) : shape.colour });
    // For the fallen: no cracking once the bar is past this mark.
    const lock = (bar - 10) * (LOCK_TICKS / snap.tMax);
    if (ctx.seat() >= 0 && snap.st[ctx.seat()] === FALLEN) surface.box("actors", { x: x0 + 5 + lock - 3, y: 26, w: 6, h: 62, colour: PAPER });
  } else if (snap.phase === PHASE.DROP || (snap.phase === PHASE.DONE && live)) {
    for (let x = x0 + 5; x < x0 + bar - 30; x += 44) {
      surface.poly("actors", { points: [{ x: x + 14, y: 35 }, { x: x + 36, y: 35 }, { x: x + 22, y: 79 }, { x, y: 79 }], colour: DANGER, alpha: 0.85 });
    }
  } else {
    surface.box("actors", { x: x0 + 5, y: 35, w: (bar - 10) * (1 - snap.ready / READY_TICKS), h: 44, colour: PAPER, alpha: 0.5 });
  }
  surface.text("actors", { x: w - 112, y: 40, value: "DROP", size: 22, weight: 700, family: DISPLAY, baseline: "middle", colour: PAPER, alpha: 0.7 });
  surface.text("actors", { x: w - 112, y: 74, value: String(snap.drop + 1).padStart(2, "0"), size: 46, weight: 900, family: DISPLAY, baseline: "middle", colour: PAPER });
}

function drawPawn(surface, ctx, snap, i, me, time) {
  const st = snap.st[i];
  if (st === GONE) return;
  const x = snap.x[i];
  const y = snap.y[i];
  const colour = ctx.colourFor(i);
  const face = fx.face[i] || { x: 0, y: 1 };
  const mine = i === me;
  const small = Math.max(0.3, surface.scale());
  if (st === FALLEN && snap.fa[i] < 14) {
    // Down the hole: shrink and spin.
    const part = snap.fa[i] / 14;
    const r = RADIUS * (1 - part * 0.85);
    surface.disc("actors", { x, y: y + part * 14, r: r + 5, colour: INK, alpha: 1 - part * 0.5 });
    surface.disc("actors", { x, y: y + part * 14, r, colour, alpha: 1 - part * 0.5 });
    const a = part * 9;
    surface.disc("actors", { x: x + Math.cos(a) * r * 0.5, y: y + part * 14 + Math.sin(a) * r * 0.5, r: r * 0.28, colour: "#fff" });
    return;
  }
  if (st === FALLEN) {
    // A ghost under the floor lights: hollow, bobbing, still pointing at trouble.
    const bob = Math.sin(time * 4 + i) * 5;
    const armed = snap.phase === PHASE.CALL && snap.t >= LOCK_TICKS && snap.crack[i] === NONE;
    const gr = RADIUS * 0.9;
    surface.disc("actors", { x, y: y + bob, r: gr + 4, colour: INK, alpha: 0.55 });
    surface.disc("actors", { x, y: y + bob, r: gr, colour: "#fff", alpha: 0.28 });
    surface.disc("actors", { x, y: y + bob, r: gr, colour, stroke: 7 });
    surface.disc("actors", { x: x - 10, y: y + bob - 3, r: 6, colour });
    surface.disc("actors", { x: x + 10, y: y + bob - 3, r: 6, colour });
    if (armed) surface.arc("actors", { x, y: y + bob, r: gr + 13, from: time * 3, to: time * 3 + TAU * 0.7, colour: PAPER, width: 5, dash: [10, 9] });
    if (mine) marker(surface, x, y + bob - gr, time, small);
    else if (snap.fa[i] < 60) surface.text("actors", { x, y: y + bob + gr + 10, value: ctx.players()[i]?.name ?? "", size: Math.min(40, 11 / small), weight: 700, align: "center", baseline: "top", colour, outline: { colour: INK, width: Math.min(10, 3.5 / small) }, alpha: 0.9 });
    return;
  }
  const dashing = snap.cd[i] > DASH_COOLDOWN - DASH_TICKS - 3;
  if (dashing) {
    for (let n = 3; n >= 1; n--) surface.disc("actors", { x: x - face.x * n * 20, y: y - face.y * n * 20, r: RADIUS - n * 4, colour, alpha: 0.4 - n * 0.1 });
  }
  surface.ellipse("actors", { x, y: y + RADIUS * 0.78, rx: RADIUS * 0.95, ry: RADIUS * 0.38, colour: "#000", alpha: 0.3 });
  const hurt = snap.ha[i] < 9 ? 1 - snap.ha[i] / 9 : 0;
  const bounce = Math.abs(Math.sin(time * 9 + i * 2)) * (fx.moving?.[i] ? 4 : 0);
  const by = y - bounce;
  surface.disc("actors", { x, y: by, r: RADIUS + 5, colour: INK });
  surface.disc("actors", { x, y: by, r: RADIUS, colour });
  surface.disc("actors", { x: x - RADIUS * 0.3, y: by - RADIUS * 0.35, r: RADIUS * 0.34, colour: "#fff", alpha: 0.35 });
  // Eyes look where the pawn is going.
  const px = -face.y;
  const py = face.x;
  for (const s of [-1, 1]) {
    const ex = x + face.x * 9 + px * 11 * s;
    const ey = by + face.y * 9 + py * 11 * s;
    surface.disc("actors", { x: ex, y: ey, r: 9, colour: "#fff" });
    surface.disc("actors", { x: ex + face.x * 3.5, y: ey + face.y * 3.5, r: 4.5, colour: INK });
  }
  if (hurt > 0) surface.disc("actors", { x, y: by, r: RADIUS + 5, colour: "#fff", alpha: hurt * 0.8 });
  let head = by - RADIUS - 6;
  if (snap.lead === i) {
    // The leader wears the crown, and it is heavy.
    const c = [[-20, 0], [-24, -24], [-10, -11], [0, -28], [10, -11], [24, -24], [20, 0]].map(([dx, dy]) => ({ x: x + dx, y: head + dy }));
    surface.poly("actors", { points: c, colour: INK, stroke: 9 });
    surface.poly("actors", { points: c, colour: "#ffd21f" });
    head -= 30;
  }
  if (mine) {
    surface.disc("actors", { x, y: by, r: RADIUS + 11, colour: "#fff", stroke: 4 });
    if (snap.cd[i] > 0) surface.arc("actors", { x, y: by, r: RADIUS + 11, from: -TAU / 4, to: -TAU / 4 + TAU * (snap.cd[i] / DASH_COOLDOWN), colour: INK, width: 5 });
    marker(surface, x, head, time, small);
  } else {
    surface.text("actors", {
      x, y: y + RADIUS + 12, value: ctx.players()[i]?.name ?? "", size: Math.min(46, 13 / small), weight: 800, align: "center", baseline: "top",
      colour: "#fff", outline: { colour: INK, width: Math.min(12, 4 / small) }, maxWidth: TILE * 1.4,
    });
  }
}

// A bouncing arrow over the local player: a shape, not only a colour.
function marker(surface, x, y, time, small) {
  const size = Math.min(34, 11 / small);
  const top = y - 8 - size - Math.abs(Math.sin(time * 5)) * 8;
  const tri = (grow) => [{ x: x - size - grow, y: top - grow * 0.8 }, { x: x + size + grow, y: top - grow * 0.8 }, { x, y: top + size * 1.1 + grow * 1.3 }];
  surface.poly("actors", { points: tri(6), colour: INK });
  surface.poly("actors", { points: tri(0), colour: "#fff" });
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  const time = ctx.time();
  const dt = ctx.dt();
  const cols = Math.round(w / TILE);
  const rows = Math.round((h - TOP) / TILE);
  const lay = floorOf(snap, cols * rows);
  const tileCentre = (index) => ({ x: (index % cols + 0.5) * TILE, y: TOP + (Math.floor(index / cols) + 0.5) * TILE });
  const tileUnder = (x, y) => Math.max(0, Math.min(rows - 1, Math.floor((y - TOP) / TILE))) * cols + Math.max(0, Math.min(cols - 1, Math.floor(x / TILE)));

  // One-shot effects read events: each arrives exactly once on every peer.
  for (const _ of ctx.events("call")) fx.callAt = time;
  for (const _ of ctx.events("open")) { fx.openAt = time; fx.shake = Math.max(fx.shake, 0.22); }
  for (const e of ctx.events("fell")) {
    const x = e.snapshot.x[e.player];
    const y = e.snapshot.y[e.player];
    burst(x, y, 16, 260, ctx.colourFor(e.player), 0.55, 7);
    burst(x, y, 8, 120, PAPER, 0.4, 4);
    if (e.player === me) fx.shake = 0.4;
  }
  for (const e of ctx.events("pt")) {
    const mine = e.player === me;
    fx.floats.push({ x: e.snapshot.x[e.player], y: e.snapshot.y[e.player] - RADIUS - 20, value: `+${e.snapshot.fell.length}`, life: 1, colour: mine ? "#fff" : ctx.colourFor(e.player), size: mine ? 64 : 40 });
  }
  for (const e of ctx.events("dashed")) burst(e.snapshot.x[e.player], e.snapshot.y[e.player] + RADIUS * 0.6, 7, 110, PAPER, 0.3, 5);
  for (const e of ctx.events("shoved")) {
    burst(e.snapshot.x[e.player], e.snapshot.y[e.player], 10, 300, "#fff", 0.3, 5);
    if (e.player === me) fx.shake = Math.max(fx.shake, 0.25);
  }
  for (const e of ctx.events("cracked")) {
    const at = tileCentre(e.snapshot.crack[e.player]);
    burst(at.x, at.y, 12, 220, INK, 0.45, 7, 500);
    burst(at.x, at.y, 6, 150, ctx.colourFor(e.player), 0.45, 5, 500);
  }
  for (const e of ctx.events("denied")) {
    if (e.player === me) fx.floats.push({ x: e.snapshot.x[me], y: e.snapshot.y[me] - RADIUS - 10, value: "✕", life: 0.6, colour: DANGER, size: 56 });
  }
  for (const e of ctx.events("won")) {
    const x = e.snapshot.x[e.player];
    const y = e.snapshot.y[e.player];
    for (let i = 0; i < 70; i++) {
      const a = -TAU / 4 + ((i % 14) / 14 - 0.5) * 2.4;
      const v = 380 + ((i * 53) % 9) * 55;
      fx.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.6, max: 1.6, colour: SHAPES[i % 6].colour, r: 8, gravity: 900 });
    }
    fx.floats.push({ x, y: y - RADIUS - 50, value: "+2", life: 1.4, colour: "#ffd21f", size: 72 });
  }

  fx.shake = Math.max(0, fx.shake - dt);
  if (calm) surface.shake(0, 0);
  else surface.shake(Math.sin(time * 90) * fx.shake * 34, Math.cos(time * 70) * fx.shake * 34);

  // Where each pawn looks: cosmetic, from the motion on screen.
  fx.moving = [];
  snap.x.forEach((x, i) => {
    const prev = fx.prev[i];
    if (prev) {
      const dx = x - prev.x;
      const dy = snap.y[i] - prev.y;
      const far = Math.hypot(dx, dy);
      if (far > 1.2 && far < 80) { fx.face[i] = { x: dx / far, y: dy / far }; fx.moving[i] = true; }
      else if (far > 0.3) fx.moving[i] = true;
    }
    fx.prev[i] = { x, y: snap.y[i] };
  });

  drawFloor(surface, snap, ctx, lay, cols, rows);
  surface.clear("actors");

  if (snap.phase === PHASE.READY) {
    const cy = TOP + (h - TOP) / 2;
    surface.text("actors", { x: w / 2, y: cy - 120, value: `ROUND ${ctx.round()}`, size: 44, weight: 900, family: DISPLAY, align: "center", baseline: "middle", colour: INK });
    const beat = (snap.ready % 25) / 25;
    surface.text("actors", {
      x: w / 2, y: cy + 10, value: Math.ceil(snap.ready / 25), size: 170 + beat * 40, weight: 900, family: DISPLAY,
      align: "center", baseline: "middle", colour: PAPER, outline: { colour: INK, width: 16 },
    });
  }

  // Under the local player: is this plate the right one?
  if (me >= 0 && snap.st[me] === ALIVE && snap.phase === PHASE.CALL) {
    const index = tileUnder(snap.x[me], snap.y[me]);
    const good = lay[index] === snap.sym && !snap.crack.includes(index);
    const x0 = (index % cols) * TILE;
    const y0 = TOP + Math.floor(index / cols) * TILE;
    if (good) surface.box("actors", { x: x0 + 9, y: y0 + 9, w: TILE - 18, h: TILE - 28, colour: "#fff", stroke: 7, alpha: 0.95 });
    else if (snap.t <= 45) surface.box("actors", { x: x0 + 9, y: y0 + 9, w: TILE - 18, h: TILE - 28, colour: DANGER, stroke: 9, alpha: 0.55 + 0.45 * Math.sin(time * 18) });
  }

  // Ghosts first, then the standing ones from the back of the board to the front.
  const order = snap.st.map((_, i) => i).sort((a, b) => (snap.st[b] === FALLEN) - (snap.st[a] === FALLEN) || snap.y[a] - snap.y[b]);
  for (const i of order) if (i !== me) drawPawn(surface, ctx, snap, i, me, time);
  if (me >= 0) drawPawn(surface, ctx, snap, me, me, time);

  if (snap.over && snap.last >= 0) {
    const x = snap.x[snap.last];
    const y = snap.y[snap.last];
    surface.arc("actors", { x, y, r: RADIUS + 26 + Math.sin(time * 5) * 4, from: time * 2, to: time * 2 + TAU, colour: "#ffd21f", width: 7, dash: [16, 12] });
  }

  fx.bits = fx.bits.filter((bit) => (bit.life -= dt) > 0);
  for (const bit of fx.bits) {
    bit.vy += bit.gravity * dt;
    bit.x += bit.vx * dt;
    bit.y += bit.vy * dt;
    surface.box("actors", { x: bit.x - bit.r, y: bit.y - bit.r, w: bit.r * 2, h: bit.r * 2, colour: bit.colour, alpha: Math.min(1, (bit.life / bit.max) * 1.6) });
  }
  fx.floats = fx.floats.filter((float) => (float.life -= dt) > 0);
  for (const float of fx.floats) {
    float.y -= 70 * dt;
    surface.text("actors", { x: float.x, y: float.y, value: float.value, size: float.size, weight: 900, family: DISPLAY, align: "center", baseline: "bottom", colour: float.colour, outline: { colour: INK, width: 9 }, alpha: Math.min(1, float.life * 2.5) });
  }

  drawSign(surface, snap, ctx);

  // The status line and the touch button say what this player does now.
  const shape = SHAPES[snap.sym];
  const role = me < 0 ? "watch" : snap.st[me] === ALIVE ? "run" : "ghost";
  if (role !== fx.role && globalThis.document?.body) { fx.role = role; globalThis.document.body.dataset.role = role; }
  if (me < 0) ctx.hud("Watching from the audience. You get a spot on the floor in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Enter or the button starts the next round." : "Waiting for the host to start the next round.");
  else if (snap.phase === PHASE.READY) ctx.hud("Get ready. A shape gets called: stand on it before the clock runs out.");
  else if (snap.st[me] === ALIVE) {
    const index = tileUnder(snap.x[me], snap.y[me]);
    const safe = lay[index] === snap.sym && !snap.crack.includes(index);
    if (snap.phase === PHASE.DROP) ctx.hud("Hold on! Stay off the pits. A dash shoves a rival in.");
    else if (safe) ctx.hud(`${shape.mark} You are on a ${shape.name}. Hold it, or shove someone off theirs.`);
    else ctx.hud(`${shape.mark} Run to a ${shape.name}! Everything else drops.`);
  } else if (snap.phase === PHASE.CALL && snap.crack[me] !== NONE) ctx.hud("Cracked. It drops with the rest. Watch them scramble.");
  else if (snap.phase === PHASE.CALL && snap.t >= LOCK_TICKS) ctx.hud(`You fell, so haunt them: fly onto a ${shape.name} ${shape.mark} and crack it.`);
  else if (snap.phase === PHASE.CALL) ctx.hud("Too late to crack this one. Line up the next call.");
  else ctx.hud("The pit is open. On the next call, crack a tile under someone.");
}

const standing = (snap) => (snap ? snap.st.filter((st) => st === ALIVE).length : 0);

startGame({
  title: "Trapdoor",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  palette: PALETTE,
  arena: ARENA,
  target: TARGET,
  minPlayers: 2,
  // Space is the dash, so the host's next-round key is Enter.
  nextKey: "Enter",
  bindings: {
    mx: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0 },
    my: { keys: { ArrowUp: -1, ArrowDown: 1, KeyW: -1, KeyS: 1 }, axis: 1 },
    act: { keys: { Space: 1, ShiftLeft: 1, KeyX: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    beep: "beep",
    go: "go",
    // The stakes raise the pitch: each call sits higher than the last.
    call: { sound: "pop", pitch: (snap) => 0.85 + snap.drop * 0.07 },
    tk: { sound: "tick", pitch: (snap) => 1 + (1 - snap.t / 36) * 0.9 },
    open: { sound: "boom", gain: 0.8, pitch: (snap) => (standing(snap) <= 2 ? 0.8 : 1) },
    fellMe: { sound: "lose", field: "fell", only: "me" },
    fellThem: { sound: "hit", field: "fell", only: "others", gain: 0.55, pitch: [1.3, 1.6] },
    ptMe: { sound: "score", field: "pt", only: "me", pitch: (snap) => 1 + snap.drop * 0.05 },
    dashMe: { sound: "whoosh", field: "dashed", only: "me", gain: 0.7, pitch: [1, 1.2] },
    dashThem: { sound: "whoosh", field: "dashed", only: "others", gain: 0.25, pitch: [0.8, 1] },
    shovedMe: { sound: "hit", field: "shoved", only: "me", pitch: 0.7 },
    shovedThem: { sound: "bounce", field: "shoved", only: "others", gain: 0.6 },
    crackMe: { sound: "zap", field: "cracked", only: "me" },
    crackThem: { sound: "zap", field: "cracked", only: "others", gain: 0.5, pitch: 0.7 },
    denied: { sound: "buzz", only: "me", gain: 0.6 },
    wonMe: { sound: "fanfare", field: "won", only: "me" },
    wonThem: { sound: "win", field: "won", only: "others", gain: 0.7 },
  },
  labels: {
    // The countdown on the floor announces the round.
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins the show!`;
      const last = info.snapshot ? info.snapshot.last : -1;
      return last >= 0 ? `${info.players[last]?.name ?? "Somebody"} is the last one standing` : "Everybody fell. Nobody takes the bonus.";
    },
    next: (matchOver) => (matchOver ? "New show" : "Next round"),
  },
  scoreboard(players, scores, snap) {
    return players.map((player, i) => {
      const st = snap ? snap.st[i] : ALIVE;
      let note = "";
      if (st === GONE) note = "left";
      else if (st === FALLEN) note = snap.crack[i] !== NONE ? "cracked a tile" : "fell · haunting";
      else if (snap && snap.last === i) note = "last one standing";
      else if (snap && snap.lead === i) note = "crown · slower";
      return { ...player, alive: st === ALIVE, state: snap && snap.lead === i ? "lead" : "", note };
    });
  },
  onRound() {
    fx.bits = [];
    fx.floats = [];
    fx.shake = 0;
    fx.prev = [];
    fx.floor = null;
    fx.callAt = -9;
    fx.openAt = -9;
  },
  draw,
});
