import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, SHIFT_TICKS, FLOORS, unpackFloor } from "/game.js";

const PALETTE = ["#84dfb5", "#88c6ef", "#ffe39a", "#c8b3ef", "#f3bc8e", "#a0e5e6", "#e9b1cb", "#f5fff8"];
const INK = "#17392f", PAPER = "#d4eee2", CHALK = "#f5fff8", LINE = "#416657", BAD = "#f27968", GOLD = "#ffd37d";
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { bits: [], shake: 0 };
const X = 64, SPAN = 512, GROUND = 338, PITCH = 27;
const px = (x) => X + x * SPAN / 100;

function beam(s, x, y, width, height, colour, detailed = true) {
  s.box("actors", { x, y, w: width, h: height, colour });
  s.box("actors", { x, y: y + height - 4, w: width, h: 4, colour: "#000", alpha: 0.19 });
  if (detailed) {
    s.trail("actors", { x: x + 3, y: y + 3 }, { x: x + width - 3, y: y + 3 }, { colour: CHALK, width: 1, alpha: 0.6 });
    for (let at = x + 14; at < x + width - 7; at += 27) s.box("actors", { x: at, y: y + 8, w: 8, h: 6, colour: INK, alpha: 0.65 });
  }
}
function focusSeat(snap, ctx) {
  if (ctx.seat() >= 0) return ctx.seat();
  const scores = ctx.scores();
  let best = -1;
  for (let i = 0; i < snap.active.length; i++) if (snap.active[i] && (best < 0 || scores[i] > scores[best])) best = i;
  return best < 0 ? 0 : best;
}
function draw(s, snap, ctx) {
  const { w, h } = s.arena();
  const me = ctx.seat(), view = focusSeat(snap, ctx), colour = ctx.colourFor(view);
  s.clear("world");
  s.box("world", { x: 0, y: 0, w, h, colour: INK });
  for (let x = 16; x < w; x += 32) s.trail("world", { x, y: 48 }, { x, y: 356 }, { colour: LINE, width: 1, alpha: 0.22 });
  for (let y = 50; y < 360; y += 27) s.trail("world", { x: 32, y }, { x: 608, y }, { colour: LINE, width: 1, alpha: 0.22 });
  s.clear("actors");
  const bar = snap.ready ? 1 - snap.ready / 60 : snap.left / SHIFT_TICKS;
  s.box("actors", { x: 32, y: 16, w: 492, h: 13, colour: LINE });
  s.box("actors", { x: 32, y: 16, w: 492 * bar, h: 13, colour: snap.left < 180 ? GOLD : PAPER });
  s.text("actors", { x: 607, y: 29, value: `${Math.ceil(snap.left / 30)}s`, colour: PAPER, size: 26, family: MONO, align: "right" });

  const left = px(snap.base[view]), right = px(snap.base[view] + snap.width[view]);
  const top = GROUND - (snap.height[view] + 1) * PITCH;
  if (!snap.over && snap.height[view] < FLOORS) {
    for (const x of [left, right]) s.poly("actors", { points: [{ x, y: Math.max(52, top - 20) }, { x, y: GROUND + 4 }], colour: GOLD, stroke: 1.5, closed: false, dash: [5, 6], alpha: 0.7 });
    if (snap.cd[view] === 0) s.box("actors", { x: left, y: top, w: right - left, h: 23, colour: GOLD, stroke: 2, alpha: 0.6 });
  }
  beam(s, px(20), GROUND + 3, SPAN * 0.6, 12, LINE, false);
  s.trail("actors", { x: 32, y: GROUND + 18 }, { x: 608, y: GROUND + 18 }, { colour: PAPER, width: 2 });
  for (let i = 0; i < FLOORS; i++) {
    const y = GROUND - (i + 1) * PITCH;
    s.text("actors", { x: 39, y: y + 17, value: String(i + 1).padStart(2, "0"), colour: i < snap.height[view] ? PAPER : LINE, size: 16, family: MONO, align: "center" });
    const packed = snap[`f${i}`][view];
    if (!packed) continue;
    const floor = unpackFloor(packed);
    beam(s, px(floor.left), y, floor.width * SPAN / 100, 23, colour);
  }
  if (!snap.over && snap.cd[view] === 0 && snap.height[view] < FLOORS) {
    const aligned = Math.abs(snap.x[view] - snap.base[view]) <= snap.tolerance[view];
    beam(s, px(snap.x[view]), top, snap.width[view] * SPAN / 100, 23, aligned ? GOLD : CHALK);
    s.poly("actors", { points: [{ x: px(snap.x[view]) + 10, y: top - 12 }, { x: px(snap.x[view]) + 22, y: top - 12 }, { x: px(snap.x[view]) + 16, y: top - 5 }], colour: CHALK });
  }
  if (snap.result[view] === 3 && snap.cd[view] > 0) {
    const x = px(snap.x[view] + snap.width[view] / 2);
    for (const direction of [-1, 1]) s.trail("actors", { x: x - 13, y: top - 13 * direction }, { x: x + 13, y: top + 13 * direction }, { colour: BAD, width: 6 });
  }
  if (snap.cd[view] > 0 && snap.gain[view] !== 0) {
    s.text("actors", { x: 600, y: 78, value: `${snap.gain[view] > 0 ? "+" : ""}${snap.gain[view]}`, size: 36, align: "right", family: MONO, colour: snap.gain[view] < 0 ? BAD : GOLD });
  }
  s.text("actors", { x: 32, y: 384, value: me < 0 ? `VIEW / ${view + 1}` : `YOU / ${me + 1}`, size: 20, family: MONO, colour: PAPER });
  s.text("actors", { x: 608, y: 384, value: `${snap.height[view]} / 8`, size: 20, family: MONO, colour: PAPER, align: "right" });

  // The skyline is numbered; names stay readable in the page ledger.
  const cell = 576 / snap.x.length;
  for (let i = 0; i < snap.x.length; i++) {
    const x0 = 32 + i * cell;
    if (i === view) s.box("actors", { x: x0 + 2, y: 395, w: cell - 4, h: 77, colour: PAPER, stroke: 2 });
    for (let f = 0; f < snap.height[i]; f++) {
      const floor = unpackFloor(snap[`f${f}`][i]);
      s.box("actors", { x: x0 + 6 + floor.left / 100 * (cell - 12), y: 442 - f * 5, w: floor.width / 100 * (cell - 12), h: 4, colour: ctx.colourFor(i), alpha: snap.active[i] ? 1 : 0.25 });
    }
    s.text("actors", { x: x0 + cell / 2, y: 470, value: snap.active[i] ? String(i + 1) : "×", size: 22, family: MONO, colour: PAPER, align: "center" });
  }

  for (const e of ctx.events("landed")) {
    if (e.player !== view || calm) continue;
    const es = e.snapshot;
    const y = GROUND - es.height[view] * PITCH;
    for (let i = 0; i < 10; i++) fx.bits.push({ x: px(es.base[view] + es.width[view] * i / 9), y, vx: (i - 4.5) * 15, vy: -45 - (i % 3) * 20, life: 0.45, colour });
  }
  for (const e of ctx.events("missed")) if (e.player === me) fx.shake = 0.2;
  fx.shake = Math.max(0, fx.shake - ctx.dt());
  s.shake(calm ? 0 : Math.sin(ctx.time() * 70) * fx.shake * 18, 0);
  fx.bits = fx.bits.filter((p) => (p.life -= ctx.dt()) > 0);
  for (const p of fx.bits) {
    p.x += p.vx * ctx.dt(); p.y += p.vy * ctx.dt(); p.vy += 300 * ctx.dt();
    s.box("actors", { x: p.x, y: p.y, w: 4, h: 4, colour: p.colour, alpha: Math.min(1, p.life * 3) });
  }
  if (snap.ready > 0) {
    s.box("actors", { x: 205, y: 125, w: 230, h: 122, colour: INK, alpha: 0.95 });
    s.text("actors", { x: 320, y: 190, value: Math.ceil(snap.ready / 20), size: 96, family: MONO, weight: 700, align: "center", baseline: "middle", colour: GOLD });
  }
  if (me < 0) ctx.hud("Skyline view. You get a building site in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Shift closed. Enter or the button opens the next shift." : "Shift closed. Your host opens the next shift.");
  else if (snap.ready) ctx.hud("Line up the beam with the dotted guide. Tap to drop; release to re-arm.");
  else if (snap.cd[me]) {
    const messages = ["", "Overhang trimmed. Release, then line up the next beam.", "Aligned! Full width saved. Release for the next beam.", "Too little overlap. −2 points; a fresh foundation is coming.", "Eight storeys! +4 tower bonus. A new site is coming."];
    ctx.hud(messages[snap.result[me]]);
  } else ctx.hud(`Tap Space / DROP to stack. Eight floors earn +4. ${snap.tolerance[me] === 4 ? "Catch-up: wider alignment bonus." : "Gold beam = aligned bonus."}`);
}

startGame({
  title: "Stackline", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: { drop: { keys: { Space: 1, ArrowDown: 1 }, buttons: { 0: 1 } } },
  audioMap: {
    dropped: { sound: "thud", only: "me", gain: 0.65 },
    landed: { sound: "click", only: "others", gain: 0.2 },
    perfect: { sound: "pickup", only: "me", pitch: (snap, i) => 0.9 + snap.height[i] * 0.08 },
    missed: { sound: "hit", only: "me", gain: 0.65 },
    built: { sound: "fanfare", only: "me", gain: 0.7 },
    denied: { sound: "click", only: "me", gain: 0.2, pitch: 0.6 },
    beep: { sound: "beep", gain: 0.4 }, go: "go", finished: "win",
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} owns the skyline` : `Shift ${info.round} closed · first to ${info.target} with a clear lead`,
    next: (done) => done ? "New skyline" : "Open next shift",
  },
  scoreboard: (players, scores, snap) => players.map((player, i) => ({
    ...player, alive: snap ? snap.active[i] : true,
    state: scores[i] > 0 && scores[i] === Math.max(...scores) ? "lead" : "",
    note: !snap ? "site ready" : !snap.active[i] ? "left site" : `${snap.height[i]}/8 floors${snap.tolerance[i] === 4 ? " · assist" : ""}`,
  })),
  onRound() { fx.bits = []; fx.shake = 0; },
  draw,
});
