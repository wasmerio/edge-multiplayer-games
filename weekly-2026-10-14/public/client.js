import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, SNAPSHOT, INTENT, ARENA, TARGET, HISTORY, BUILD_TICKS } from "/game.js";

const INK = "#163b36", MIST = "#dfe8e1", LIME = "#d5f45b", RULE = "#9aaea1", DANGER = "#b63728";
const PALETTE = ["#216e63", "#435ca8", "#995879", "#966326", "#65752f", "#407b8d", "#714e9a", "#4a6159"];
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { chips: [] };

function line(s, x, y, xx, yy, colour = RULE, width = 1) {
  s.trail("actors", { x, y }, { x: xx, y: yy }, { colour, width });
}
function label(s, x, y, value, size = 18, colour = INK, align = "left") {
  s.text("actors", { x, y, value, size, colour, align, family: MONO, baseline: "middle", weight: 600 });
}
function slab(s, x, y, width, thick, colour, alpha = 1) {
  s.box("actors", { x, y, w: width, h: thick, colour, alpha });
  s.box("actors", { x, y, w: width, h: Math.max(2, thick * 0.15), colour: "#ffffff", alpha: alpha * 0.45 });
  s.poly("actors", { points: [{ x, y }, { x: x + 5, y: y - 5 }, { x: x + width + 5, y: y - 5 }, { x: x + width, y }], colour, alpha: alpha * 0.6 });
}
function tower(s, snap, seat, ox, ground, scale, thick, colour) {
  const height = snap.height[seat];
  const visible = Math.min(HISTORY, height);
  if (height > HISTORY) {
    s.box("actors", { x: ox + 115 * scale, y: ground, w: 90 * scale, h: 16 * scale, colour: RULE });
    for (let j = 0; j < 3; j++) line(s, ox + (120 + j * 28) * scale, ground + 14 * scale, ox + (137 + j * 28) * scale, ground, MIST, 2);
  }
  for (let row = 0; row < visible; row++) {
    const floor = height - visible + row;
    const slot = floor % HISTORY;
    const width = snap[`cw${slot}`][seat];
    const centre = snap[`cx${slot}`][seat];
    slab(s, ox + (centre - width / 2) * scale, ground - (row + 1) * thick, width * scale, thick - Math.max(1, 2 * scale), colour);
  }
  return ground - visible * thick;
}

function draw(surface, snap, ctx) {
  const me = ctx.seat();
  const focus = me >= 0 ? me : Math.max(0, snap.active.findIndex(Boolean));
  const colour = ctx.colourFor(focus);
  const height = snap.height[focus];
  const top = height ? snap[`cx${(height - 1) % HISTORY}`][focus] : 160;
  const width = snap.width[focus];
  const ground = 330;
  const topY = ground - Math.min(HISTORY, height) * 32;
  const movingY = topY - 43;
  const ox = 44;
  surface.clear("actors");
  surface.box("actors", { x: 0, y: 0, w: 640, h: 480, colour: MIST });
  for (let x = 24; x < 410; x += 20) line(surface, x, 64, x, 350, "#d0dbd2");
  for (let y = 70; y < 350; y += 20) line(surface, 24, y, 402, y, "#d0dbd2");
  label(surface, 24, 27, `BUILD ${String(ctx.round()).padStart(2, "0")}`, 18);
  label(surface, 614, 27, `${Math.ceil(snap.left / 30)}s`, 24, INK, "right");
  surface.box("actors", { x: 24, y: 47, w: 592, h: 6, colour: RULE });
  surface.box("actors", { x: 24, y: 47, w: 592 * snap.left / BUILD_TICKS, h: 6, colour: INK });

  for (let i = 0; i <= HISTORY; i++) line(surface, 25, ground - i * 32, 33, ground - i * 32, INK);
  surface.poly("actors", { points: [{ x: ox + top, y: 66 }, { x: ox + top, y: ground }], colour: RULE, stroke: 1, dash: [4, 6], closed: false });
  slab(surface, ox + (320 - snap.base[focus]) / 2, ground, snap.base[focus], 13, INK);
  tower(surface, snap, focus, ox, ground, 1, 32, colour);
  if (!snap.over) {
    const x = ox + snap.x[focus] - width / 2;
    const aligned = Math.abs(snap.x[focus] - top) <= 7;
    if (!snap.cd[focus] && !snap.ready) {
      const lo = Math.max(top - width / 2, snap.x[focus] - width / 2);
      const hi = Math.min(top + width / 2, snap.x[focus] + width / 2);
      if (hi > lo) surface.box("actors", { x: ox + lo, y: movingY + 23, w: hi - lo, h: topY - movingY - 23, colour: colour, alpha: 0.13 });
      line(surface, x, movingY - 12, x + width, movingY - 12, INK, 2);
      surface.poly("actors", { points: snap.dir[focus] > 0 ? [{ x: x + width - 7, y: movingY - 17 }, { x: x + width, y: movingY - 12 }, { x: x + width - 7, y: movingY - 7 }] : [{ x: x + 7, y: movingY - 17 }, { x, y: movingY - 12 }, { x: x + 7, y: movingY - 7 }], colour: INK, stroke: 2, closed: false });
    }
    slab(surface, x, movingY, width, 22, aligned ? INK : colour, snap.cd[focus] ? 0.25 : 1);
    if (aligned && !snap.cd[focus]) surface.box("actors", { x: x + 2, y: movingY + 5, w: Math.max(1, width - 4), h: 8, colour: LIME });
  }

  line(surface, 416, 74, 416, 349, RULE);
  label(surface, 444, 90, me < 0 ? "WATCHING" : `YOU / ${focus + 1}`, 18);
  label(surface, 445, 142, String(height).padStart(2, "0"), 64);
  label(surface, 446, 185, "FLOORS", 16);
  label(surface, 446, 234, `BEST ${snap.best[focus]}`, 23);
  label(surface, 446, 272, `${Math.round(width)} WIDE`, 16);
  if (snap.flash[focus] > 0) label(surface, 446, 312, ["", "TRIMMED", "PERFECT", "REBUILD"][snap.result[focus]], 18, snap.result[focus] === 3 ? DANGER : INK);
  else label(surface, 446, 312, snap.cd[focus] ? "SETTING" : "LINE UP", 18);

  line(surface, 24, 365, 616, 365, INK);
  label(surface, 24, 382, "THE SKYLINE / BEST HEIGHTS", 14);
  const n = snap.height.length;
  const cell = 592 / n;
  for (let i = 0; i < n; i++) {
    const cx = 24 + (i + 0.5) * cell;
    const scale = Math.min(0.19, (cell - 10) / 320);
    const c = snap.active[i] ? ctx.colourFor(i) : RULE;
    tower(surface, snap, i, cx - 160 * scale, 446, scale, 5, c);
    line(surface, cx - 25, 448, cx + 25, 448, c, 2);
    label(surface, cx, 464, `${i + 1}:${snap.best[i]}`, 17, INK, "center");
    if (i === me) {
      surface.box("actors", { x: cx - cell / 2 + 2, y: 397, w: cell - 4, h: 78, colour: INK, stroke: 2 });
      surface.poly("actors", { points: [{ x: cx - 5, y: 390 }, { x: cx + 5, y: 390 }, { x: cx, y: 396 }], colour: INK });
    }
  }

  for (const e of ctx.events("landed")) {
    if (calm || e.player !== focus) continue;
    for (let j = 0; j < 10; j++) fx.chips.push({ x: ox + top, y: topY, vx: (j - 4.5) * 28, vy: -60 - j % 3 * 25, life: 0.5, colour });
  }
  for (const e of ctx.events("fell")) {
    if (calm || e.player !== focus) continue;
    for (let j = 0; j < 14; j++) fx.chips.push({ x: ox + 160, y: ground - 80, vx: (j - 6.5) * 25, vy: -30 - j % 4 * 30, life: 0.7, colour: DANGER });
  }
  fx.chips = fx.chips.filter((p) => (p.life -= ctx.dt()) > 0);
  for (const p of fx.chips) {
    p.x += p.vx * ctx.dt(); p.vy += 400 * ctx.dt(); p.y += p.vy * ctx.dt();
    surface.box("actors", { x: p.x, y: p.y, w: 6, h: 4, colour: p.colour, alpha: Math.min(1, p.life * 3) });
  }
  if (snap.ready > 0) {
    surface.box("actors", { x: 105, y: 130, w: 204, h: 140, colour: INK });
    label(surface, 207, 168, "TOOLS READY", 20, MIST, "center");
    label(surface, 207, 223, Math.ceil(snap.ready / 30), 70, LIME, "center");
  }
  if (me < 0) ctx.hud("Watching the studio. You get a foundation in the next match.");
  else if (snap.over) ctx.hud(`Best ${snap.best[me]} floors · +${snap.award[me]} points. ${ctx.isHost() ? "Enter opens the next build." : "Waiting for the host."}`);
  else if (snap.ready) ctx.hud("Line up the moving slab. Tap to drop; release between drops.");
  else if (snap.cd[me]) ctx.hud(snap.result[me] === 3 ? `Rebuilding. Your best of ${snap.best[me]} is safe.` : snap.result[me] === 2 ? "Perfect joint. Width restored. Get ready for the next slab." : "Overhang trimmed. Aim at the centre of the new top.");
  else ctx.hud("Drop when the slab overlaps your tower. Centre it to restore width.");
}

startGame({
  title: "Stackworks", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: { drop: { keys: { Space: 1, ArrowDown: 1, KeyS: 1 }, buttons: { 0: 1 } } },
  audioMap: {
    dropped: { sound: "click", only: "me", gain: 0.4 },
    mine: { sound: "thud", field: "landed", only: "me", pitch: (s, i) => 0.8 + s.height[i] * 0.04 },
    others: { sound: "thud", field: "landed", only: "others", gain: 0.15 },
    perfect: { sound: "pickup", only: "me", gain: 0.65 },
    fell: { sound: "hit", only: "me", gain: 0.65 },
    awarded: { sound: "score", only: "me" }, beep: "beep", go: "go", finished: "win",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins the commission`;
      const best = Math.max(0, ...(info.snapshot?.best ?? []).filter((_, i) => info.snapshot.active[i]));
      const leaders = info.players.filter((_, i) => info.snapshot?.active[i] && info.snapshot.best[i] === best);
      return best === 0 ? "No floors signed off. Try another build." : `${leaders.length === 1 ? leaders[0].name : "Joint leaders"} · ${best} floors · +3 bonus`;
    },
    next: (won) => won ? "New commission" : "Open next build",
  },
  scoreboard(players, scores, snap) {
    return players.map((p, i) => ({ ...p, name: `${i + 1}. ${p.name}`, alive: snap ? snap.active[i] : true,
      state: scores[i] > 0 && scores[i] === Math.max(...scores) ? "lead" : "",
      note: snap ? !snap.active[i] ? "left studio" : `best ${snap.best[i]}${snap.over ? ` / +${snap.award[i]}` : " floors"}` : "foundation ready" }));
  },
  onRound() { fx.chips = []; },
  draw,
});
