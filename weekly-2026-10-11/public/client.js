import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, READY_TICKS, BEAT_TICKS, RECALL_TICKS, PHASE, PHRASES } from "/game.js";

const INK = "#14235e";
const BLUE = "#243c96";
const LINEN = "#f3f0e6";
const PALE = "#b7cafa";
const GOLD = "#f2c453";
const ERROR = "#ce4b34";
const MONO = 'ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace';
const PALETTE = ["#a7c5ff", "#f2c453", "#9dd6bc", "#f4b5cb", "#c3b4f2", "#f5b98d", "#99dae3", "#f3f0e6"];
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, bits: [] };

function glyph(surface, symbol, x, y, r, colour, layer = "actors") {
  if (symbol === 1) surface.disc(layer, { x, y, r: r * 0.78, colour, stroke: r * 0.25 });
  if (symbol === 2) surface.poly(layer, { points: [{ x, y: y - r }, { x: x + r, y: y + r * 0.75 }, { x: x - r, y: y + r * 0.75 }], colour, stroke: r * 0.22 });
  if (symbol === 3) {
    surface.trail(layer, { x: x - r * 0.72, y: y - r * 0.72 }, { x: x + r * 0.72, y: y + r * 0.72 }, { colour, width: r * 0.3 });
    surface.trail(layer, { x: x + r * 0.72, y: y - r * 0.72 }, { x: x - r * 0.72, y: y + r * 0.72 }, { colour, width: r * 0.3 });
  }
}
function bobbin(i, n, w, h) {
  const cols = Math.min(4, n);
  return { x: (i % cols + 0.5) * w / cols, y: h - 142 + Math.floor(i / cols) * 88, width: w / cols - 16 };
}
function burst(x, y, colour, big) {
  if (calm) return;
  const count = big ? 18 : 8;
  for (let j = 0; j < count; j++) {
    const angle = j * Math.PI * 2 / count;
    fx.bits.push({ x, y, vx: Math.cos(angle) * (big ? 95 : 60), vy: Math.sin(angle) * 75 - 25, life: 0.45, colour });
  }
}
function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  const n = snap.active.length;
  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: BLUE });
    for (let x = 12; x < w; x += 24) surface.box("world", { x, y: 0, w: 2, h, colour: PALE, alpha: 0.09 });
    for (let y = 12; y < h; y += 24) surface.box("world", { x: 0, y, w, h: 2, colour: LINEN, alpha: 0.05 });
    for (let x = 8; x < w; x += 20) {
      surface.box("world", { x, y: 2, w: 10, h: 5, colour: PALE });
      surface.box("world", { x, y: h - 7, w: 10, h: 5, colour: PALE });
    }
  }
  surface.clear("actors");
  const title = snap.phase === PHASE.READY ? "GET READY" : snap.phase === PHASE.SHOW ? "WATCH" : snap.phase === PHASE.RECALL ? "WEAVE" : snap.phase === PHASE.REVIEW ? "THE PATTERN" : "CLOTH COMPLETE";
  surface.text("actors", { x: 24, y: 43, value: title, colour: LINEN, size: 27, weight: 800, family: MONO, spacing: 2 });
  surface.text("actors", { x: w - 24, y: 43, value: `${snap.phrase + 1}/${PHRASES}`, colour: PALE, size: 26, align: "right", family: MONO });

  const lit = snap.phase === PHASE.SHOW ? snap.shown : snap.phase === PHASE.RECALL && me >= 0 && snap.flash[me] > 0 ? snap.last[me] : 0;
  for (let symbol = 1; symbol <= 3; symbol++) {
    const x = w * (0.21875 + (symbol - 1) * 0.28125);
    const active = lit === symbol;
    const mistaken = active && snap.phase === PHASE.RECALL && snap.lock[me] > 0;
    const fill = mistaken ? ERROR : active ? GOLD : LINEN;
    surface.box("actors", { x: x - 79, y: 87, w: 158, h: 145, colour: INK, radius: 9 });
    surface.box("actors", { x: x - 79, y: 79, w: 158, h: 145, colour: fill, radius: 9 });
    surface.box("actors", { x: x - 70, y: 88, w: 140, h: 127, colour: active ? INK : BLUE, stroke: 2, radius: 4 });
    glyph(surface, symbol, x, 141, 35, mistaken ? LINEN : INK);
    surface.text("actors", { x, y: 204, value: ["", "A / ←", "S / ↓", "D / →"][symbol], colour: mistaken ? LINEN : BLUE, size: 20, family: MONO, align: "center", weight: 700 });
  }

  const review = snap.phase === PHASE.REVIEW || snap.phase === PHASE.DONE;
  const center = w / 2;
  for (let j = 0; j < snap.length; j++) {
    const x = center + (j - (snap.length - 1) / 2) * 38;
    if (review) glyph(surface, snap.pattern[j], x, 257, 12, LINEN);
    else {
      const filled = snap.phase === PHASE.RECALL && me >= 0 && j < snap.progress[me];
      const watching = snap.phase === PHASE.SHOW && j === Math.floor((snap.length * BEAT_TICKS - snap.t) / BEAT_TICKS);
      surface.disc("actors", { x, y: 255, r: watching ? 9 : 7, colour: filled || watching ? GOLD : PALE, stroke: filled || watching ? undefined : 2 });
    }
  }
  surface.box("actors", { x: 24, y: 282, w: w - 48, h: 10, colour: INK });
  let fraction = 0;
  if (snap.phase === PHASE.RECALL) fraction = Math.max(0, snap.t - ctx.tickFraction()) / RECALL_TICKS;
  else if (snap.phase === PHASE.SHOW) fraction = snap.t / (snap.length * BEAT_TICKS);
  else if (snap.phase === PHASE.READY) fraction = 1 - snap.t / READY_TICKS;
  surface.box("actors", { x: 24, y: 282, w: (w - 48) * fraction, h: 10, colour: snap.phase === PHASE.RECALL ? GOLD : PALE });

  snap.active.forEach((active, i) => {
    const at = bobbin(i, n, w, h);
    const bw = Math.min(140, at.width);
    const colour = ctx.colourFor(i);
    surface.box("actors", { x: at.x - bw / 2, y: at.y - 30, w: bw, h: 70, colour: INK, radius: 5, alpha: active ? 1 : 0.45 });
    if (i === me) {
      surface.box("actors", { x: at.x - bw / 2 - 3, y: at.y - 33, w: bw + 6, h: 76, colour: LINEN, stroke: 3, radius: 6 });
      surface.poly("actors", { points: [{ x: at.x - 7, y: at.y - 45 }, { x: at.x + 7, y: at.y - 45 }, { x: at.x, y: at.y - 36 }], colour: LINEN });
    }
    surface.text("actors", { x: at.x - bw / 2 + 12, y: at.y + 3, value: i + 1, colour, size: 25, weight: 800, family: MONO });
    const text = !active ? "—" : snap.done[i] ? `+${snap.award[i]}` : snap.lock[i] ? "×" : `${snap.progress[i]}/${snap.length}`;
    surface.text("actors", { x: at.x + bw / 2 - 12, y: at.y + 3, value: text, colour: snap.lock[i] ? "#ffb9a4" : LINEN, size: 25, family: MONO, align: "right" });
    const sw = (bw - 24) / snap.length;
    for (let j = 0; j < snap.length; j++) surface.box("actors", { x: at.x - bw / 2 + 12 + j * sw, y: at.y + 17, w: sw - 3, h: 10, colour: j < snap.progress[i] ? colour : BLUE });
    if (snap.mend[i] && active) surface.disc("actors", { x: at.x, y: at.y - 18, r: 4, colour: GOLD });
  });

  for (const e of ctx.events("correct")) {
    if (e.player === me) burst(w * (0.21875 + (e.snapshot.last[me] - 1) * 0.28125), 143, GOLD, false);
  }
  for (const e of ctx.events("finished")) {
    const at = bobbin(e.player, n, w, h);
    burst(at.x, at.y, ctx.colourFor(e.player), e.player === me);
  }
  fx.bits = fx.bits.filter((b) => (b.life -= ctx.dt()) > 0);
  for (const b of fx.bits) {
    b.x += b.vx * ctx.dt(); b.y += b.vy * ctx.dt();
    surface.box("actors", { x: b.x, y: b.y, w: 4, h: 9, colour: b.colour, alpha: Math.min(1, b.life * 3), rotate: b.life * 3 });
  }
  if (snap.phase === PHASE.READY) {
    surface.box("actors", { x: center - 50, y: 106, w: 100, h: 92, colour: BLUE, radius: 8 });
    surface.text("actors", { x: center, y: 180, value: Math.ceil(snap.t / 20), colour: LINEN, size: 80, weight: 800, align: "center", family: MONO });
  }

  if (me < 0) ctx.hud("Watching the loom. You get a bobbin in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Cloth complete. Enter or the button starts the next round." : "Cloth complete. Waiting for the host to continue.");
  else if (!snap.active[me]) ctx.hud("Your bobbin is retired. Return for the next match.");
  else if (snap.phase === PHASE.READY) ctx.hud(`You are bobbin ${me + 1}. Watch first; weave from memory after the signal.`);
  else if (snap.phase === PHASE.SHOW) ctx.hud(`Watch ${snap.length} stitches in order. Hands off the keys for now.`);
  else if (snap.phase === PHASE.REVIEW) ctx.hud(snap.done[me] ? `Pattern complete: +${snap.award[me]} points. Here is the stitch order.` : "Time ran out. Read the order; the next pattern starts shortly.");
  else if (snap.done[me]) ctx.hud(`Woven! +${snap.award[me]} points. Watch your friends finish.`);
  else if (snap.lock[me]) ctx.hud("Tangled thread! Pause, release, then continue from your progress dots.");
  else ctx.hud(`Weave from memory · ${snap.progress[me]}/${snap.length} · ${Math.ceil(snap.t / 30)}s${snap.mend[me] ? " · one mistake protected" : ""}. Release between stitches.`);
}

startGame({
  title: "Echo Loom",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  palette: PALETTE,
  nextKey: "Enter",
  bindings: {
    stitch: { keys: { ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3 }, buttons: { 0: 1, 1: 2, 2: 3 }, discrete: false },
  },
  audioMap: {
    beep: { sound: "beep", gain: 0.5 },
    cue: { sound: "blip", pitch: (snap) => 0.7 + snap.shown * 0.3, gain: 0.8 },
    recall: "go",
    pressed: { sound: "click", only: "me", gain: 0.4 },
    correct: { sound: "thud", only: "me", pitch: (snap, i) => 0.9 + snap.progress[i] * 0.12 },
    wrong: { sound: "buzz", only: "me", gain: 0.6 },
    mended: { sound: "bounce", only: "me", gain: 0.5 },
    mine: { field: "finished", sound: "score", only: "me", pitch: 1.2 },
    others: { field: "finished", sound: "pickup", only: "others", gain: 0.3 },
    review: { sound: "whoosh", gain: 0.3 },
    ended: { sound: "fanfare", gain: 0.7 },
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} is the master weaver!` : `Five patterns woven. First to ${info.target} with a clear lead wins.`,
    next: (matchOver) => matchOver ? "Fresh cloth · new match" : "Weave another round",
  },
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores);
    return players.map((p, i) => ({
      ...p,
      alive: snap ? snap.active[i] : true,
      state: scores[i] === best && best > 0 ? "lead" : "",
      note: `${i + 1} · ${!snap ? "thread ready" : !snap.active[i] ? "left" : snap.done[i] ? `woven +${snap.award[i]}` : snap.phase === PHASE.RECALL ? `${snap.progress[i]}/${snap.length}${snap.mend[i] ? " · mend" : ""}` : "watch & remember"}`,
    }));
  },
  onRound() { fx.floor = false; fx.bits = []; },
  draw,
});
