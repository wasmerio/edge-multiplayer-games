import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, PHASE, FLOORS, MOVE_TICKS } from "/game.js";

const PALETTE = ["#1645a0", "#087d79", "#7751ac", "#a46a12", "#a43573", "#536581", "#627b25", "#007ca8"];
const INK = "#123052", BLUE = "#1645a0", SKY = "#e8f5f7", PAPER = "#ffffff", STEEL = "#617c94", WASTE = "#bf402b";
const SANS = 'Arial, "Helvetica Neue", system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { paper: false, pieces: [], notes: [] };
const mainSeat = (s, seat) => seat >= 0 ? seat : Math.max(0, s.active.findIndex(Boolean));

function slab(surface, x, y, w, h, colour, alpha = 1) {
  if (w <= 0) return;
  surface.box("actors", { x, y: y + 4, w, h, colour: INK, alpha: alpha * 0.15 });
  surface.box("actors", { x, y, w, h, colour: PAPER, alpha });
  surface.box("actors", { x, y, w, h: 5, colour, alpha });
  surface.box("actors", { x, y, w, h, colour: INK, stroke: 1.5, alpha });
}

function label(surface, x, y, value, size = 18, colour = INK, align = "left") {
  surface.text("actors", { x, y, value, size, colour, align, baseline: "middle", family: MONO, weight: 600 });
}

function effects(s, ctx, focus) {
  for (const e of ctx.events("dropped")) {
    if (e.player !== focus || calm) continue;
    const f = e.snapshot.floor;
    const left = e.snapshot.x[focus], width = e.snapshot.carry[focus];
    const keptLeft = e.snapshot[`sx${f}`][focus], keptWidth = e.snapshot[`sw${f}`][focus];
    const parts = keptWidth <= 0 ? [[left, width]] : [[left, Math.max(0, keptLeft - left)], [keptLeft + keptWidth, Math.max(0, left + width - keptLeft - keptWidth)]];
    for (const [x, w] of parts) if (w > 0) fx.pieces.push({ x, w, y: 164, life: 0.65, vx: x < keptLeft ? -50 : 50, vy: 10 });
  }
  for (const e of ctx.events("scored")) if (e.player === focus) fx.notes.push({ text: `+${e.snapshot.award[focus]}`, life: 0.9, colour: ctx.colourFor(focus) });
  for (const e of ctx.events("bonus")) if (e.player === focus) fx.notes.push({ text: "CLEANEST", life: 0.9, colour: BLUE });
  for (const e of ctx.events("missed")) if (e.player === focus) fx.notes.push({ text: "TRY NEXT LIFT", life: 0.9, colour: WASTE });
}

function draw(surface, s, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  const focus = mainSeat(s, me);
  const colour = ctx.colourFor(focus);
  const dt = ctx.dt();
  if (!fx.paper) {
    fx.paper = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: SKY });
    for (let x = 0; x < w; x += 28) surface.trail("world", { x, y: 0 }, { x, y: 296 }, { colour: "#d5e8ef", width: 1 });
    for (let y = 16; y < 296; y += 28) surface.trail("world", { x: 0, y }, { x: w, y }, { colour: "#d5e8ef", width: 1 });
    surface.box("world", { x: 0, y: 296, w, h: h - 296, colour: PAPER });
    surface.trail("world", { x: 16, y: 296 }, { x: w - 16, y: 296 }, { colour: INK, width: 2 });
  }
  surface.clear("actors");
  effects(s, ctx, focus);
  const multiplier = s.floor >= FLOORS - 2 ? " / ×2" : "";
  label(surface, 20, 24, `LIFT ${s.floor + 1} / ${FLOORS}${multiplier}`, 20);
  label(surface, w - 20, 24, me < 0 ? `VIEW ${focus + 1}` : "YOUR BUILD", 16, colour, "right");
  const progress = s.phase === PHASE.MOVE ? Math.max(0, s.t - ctx.tickFraction()) / MOVE_TICKS : 0;
  surface.box("actors", { x: 20, y: 45, w: w - 40, h: 7, colour: "#c3dbe6" });
  surface.box("actors", { x: 20, y: 45, w: (w - 40) * progress, h: 7, colour: s.t < 20 ? WASTE : colour });

  // A close-up of the top three floors; the complete tower appears in the skyline.
  for (let f = Math.max(0, s.floor - 3); f < s.floor; f++) {
    slab(surface, s[`sx${f}`][focus], 190 + (s.floor - 1 - f) * 26, s[`sw${f}`][focus], 22, colour, 0.75);
  }
  const bx = s.base[focus], bw = s.width[focus];
  surface.poly("actors", { points: [{ x: bx, y: 276 }, { x: bx, y: 187 }, { x: bx + bw, y: 187 }, { x: bx + bw, y: 276 }], colour: STEEL, stroke: 2, dash: [5, 6], closed: false });
  surface.poly("actors", { points: [{ x: bx, y: 276 }, { x: bx + bw, y: 218 }, { x: bx, y: 218 }, { x: bx + bw, y: 276 }], colour: STEEL, stroke: 1, alpha: 0.3, closed: false });
  surface.box("actors", { x: bx, y: 164, w: bw, h: 22, colour, alpha: 0.14 });
  surface.trail("actors", { x: bx, y: 158 }, { x: bx + bw, y: 158 }, { colour, width: 2 });
  for (const x of [bx, bx + bw]) surface.trail("actors", { x, y: 151 }, { x, y: 186 }, { colour, width: 2 });

  if (!s.locked[focus]) {
    const x = s.x[focus], cw = s.carry[focus];
    for (const cable of [x + cw * 0.25, x + cw * 0.75]) surface.trail("actors", { x: cable, y: 60 }, { x: cable, y: 99 }, { colour: STEEL, width: 1.5 });
    slab(surface, x, 100, cw, 26, colour);
    // The outline projection is the actual slab footprint, not a second target.
    surface.box("actors", { x, y: 164, w: cw, h: 22, colour, stroke: 1, alpha: 0.5 });
    label(surface, x + cw / 2, 114, s.dir[focus] > 0 ? "→" : "←", 24, colour, "center");
  } else {
    const sw = s[`sw${s.floor}`][focus];
    if (sw > 0) {
      const age = Math.min(1, (s.age[focus] + ctx.tickFraction()) / 7);
      slab(surface, s[`sx${s.floor}`][focus], calm ? 164 : 100 + 64 * (1 - (1 - age) ** 2), sw, 22, colour);
    }
    const result = s.award[focus] > 0 ? `${s.quality[focus]}% FIT · +${s.award[focus]}` : "NO FLOOR";
    label(surface, w / 2, 83, result, 22, s.award[focus] > 0 ? colour : WASTE, "center");
  }

  // Every seat has a distinct numbered building, even when their colours are close.
  const span = (w - 32) / s.active.length;
  s.active.forEach((active, i) => {
    const cx = 16 + (i + 0.5) * span;
    const mini = (span - 12) / w;
    const origin = cx - w * mini / 2;
    const c = ctx.colourFor(i);
    for (let f = 0; f < FLOORS; f++) {
      const fw = s[`sw${f}`][i];
      if (fw > 0) surface.box("actors", { x: origin + s[`sx${f}`][i] * mini, y: 405 - f * 10, w: Math.max(3, fw * mini), h: 8, colour: c, alpha: active ? 1 : 0.25 });
    }
    if (!s.locked[i] && active && s.phase === PHASE.MOVE) surface.box("actors", { x: origin + s.x[i] * mini, y: 395 - s.floor * 10, w: Math.max(3, s.carry[i] * mini), h: 5, colour: c });
    surface.trail("actors", { x: cx - span * 0.35, y: 415 }, { x: cx + span * 0.35, y: 415 }, { colour: STEEL, width: 1 });
    label(surface, cx, 429, i + 1, 19, active ? c : STEEL, "center");
    if (i === me) {
      surface.poly("actors", { points: [{ x: cx - 6, y: 301 }, { x: cx + 6, y: 301 }, { x: cx, y: 309 }], colour: INK });
      surface.box("actors", { x: cx - span / 2 + 3, y: 313, w: span - 6, h: 101, colour: c, stroke: 2 });
    }
  });

  fx.pieces = fx.pieces.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.pieces) {
    p.vy += 580 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    surface.box("actors", { x: p.x, y: p.y, w: p.w, h: 22, colour: WASTE, alpha: Math.min(1, p.life * 3), rotate: (0.65 - p.life) * p.vx * 0.012 });
  }
  fx.notes = fx.notes.filter((n) => (n.life -= dt) > 0);
  for (const n of fx.notes) surface.text("actors", { x: w / 2, y: 250 - (calm ? 0 : (0.9 - n.life) * 20), value: n.text, size: 25, family: SANS, weight: 800, align: "center", colour: n.colour, alpha: Math.min(1, n.life * 4), outline: { colour: SKY, width: 5 } });

  if (s.phase === PHASE.READY) {
    surface.box("actors", { x: 170, y: 78, w: 220, h: 182, colour: PAPER, alpha: 0.96 });
    label(surface, w / 2, 110, "LINE IT UP", 22, BLUE, "center");
    surface.text("actors", { x: w / 2, y: 193, value: Math.ceil(s.t / 20), size: 96, family: SANS, weight: 900, align: "center", baseline: "middle", colour: BLUE });
  }

  if (me < 0) ctx.hud("Skyline view. You get a building in the next match.");
  else if (s.over) ctx.hud(ctx.isHost() ? "Inspection complete. Enter or the button opens the next project." : "Inspection complete. Waiting for the project host.");
  else if (s.phase === PHASE.READY) ctx.hud("Tap Space or DROP FLOOR when the slab lines up with its support.");
  else if (s.phase === PHASE.INSPECT) ctx.hud(`${s.quality[me]}% fit · +${s.award[me]} points. Next lift in a moment${s.floor === 5 ? " — double points next!" : "."}`);
  else if (s.locked[me]) ctx.hud(s.award[me] > 0 ? `${s.quality[me]}% fit. Placed! The cleanest fit takes a bonus at the bell.` : "Missed this floor. Your support stays; try the next lift.");
  else ctx.hud(`Line up the edges, then drop. Lift ${s.floor + 1}${s.floor >= 6 ? " pays double" : " of eight"}.`);
}

startGame({
  title: "Skysplice",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  palette: PALETTE,
  nextKey: "Enter",
  bindings: { drop: { keys: { Space: 1, ArrowDown: 1 }, buttons: { 0: 1 } } },
  audioMap: {
    dropped: { sound: "thud", only: "me", gain: 0.7 },
    otherDrops: { field: "dropped", sound: "click", only: "others", gain: 0.2 },
    scored: { sound: "score", only: "me", pitch: (s) => 0.9 + s.floor * 0.07 },
    missed: { sound: "buzz", only: "me", gain: 0.55 },
    bonus: { sound: "powerup", only: "me", gain: 0.65 },
    beep: { sound: "beep", gain: 0.5 },
    opened: { sound: "whoosh", gain: 0.4 },
    settled: { sound: "click", gain: 0.35 },
    finished: "fanfare",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} owns the skyline!`;
      const built = info.snapshot?.built ?? [];
      const best = Math.max(0, ...built.filter((_, i) => info.snapshot.active[i]));
      const leaders = built.flatMap((p, i) => p === best && info.snapshot.active[i] ? [i] : []);
      return best === 0 ? "No floors scored. A fresh blueprint?" : leaders.length === 1 ? `${info.players[leaders[0]]?.name ?? "Builder"} leads this project: ${best} points.` : `Shared project lead: ${best} points each.`;
    },
    next: (over) => over ? "New skyline" : "Next project",
  },
  scoreboard(players, scores, s) {
    const best = Math.max(0, ...scores);
    return players.map((p, i) => ({ ...p,
      alive: s ? s.active[i] : true,
      state: best > 0 && scores[i] === best ? "lead" : "",
      note: `${i + 1} · ${!s ? "builder" : !s.active[i] ? "left" : s.locked[i] ? `${s.quality[i]}% / +${s.award[i]}` : "lining up"}`,
    }));
  },
  onRound() { fx.paper = false; fx.pieces = []; fx.notes = []; },
  draw,
});
