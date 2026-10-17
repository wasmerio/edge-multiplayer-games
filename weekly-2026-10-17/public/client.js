import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, PHASE, WORK_TICKS, TARGET, ports } from "/game.js";

const PALETTE = ["#70d8ee", "#f5b78d", "#c6db8b", "#bcaaf0", "#efa8c4", "#f3df95", "#8ad6b8", "#e9f4ec"];
const INK = "#092c36", PANEL = "#103f4d", CHALK = "#e9f4ec", COPPER = "#c98155", WATER = "#70d8ee";
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { rings: [] };
const countWet = mask => { let n = 0; for (let i = 0; i < 9; i++) if (mask & (1 << i)) n++; return n; };

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat(), seat = me < 0 ? Math.max(0, snap.active.findIndex(Boolean)) : me;
  const L = "actors", rot = snap.rot[seat], wet = snap.wet[seat];
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w, h, colour: INK });
  for (let x = 0; x < w; x += 24) surface.trail("world", { x, y: 0 }, { x, y: h }, { colour: "#16434f", width: 1 });
  for (let y = 0; y < h; y += 24) surface.trail("world", { x: 0, y }, { x: w, y }, { colour: "#16434f", width: 1 });
  surface.clear(L);
  const caption = snap.phase === PHASE.READY ? "OPENING THE WORKS" : `ORDER ${snap.job + 1} / 3${snap.job === 2 ? "  ·  DOUBLE PAY" : ""}`;
  surface.text(L, { x: 28, y: 29, value: caption, colour: CHALK, family: MONO, size: 21, weight: 700 });
  surface.text(L, { x: w - 28, y: 29, value: snap.phase === PHASE.WORK ? `${Math.ceil(snap.t / 30)}s` : snap.over ? "FILED" : snap.phase === PHASE.REVIEW ? "REVIEW" : `${Math.ceil(snap.t / 15)}`, align: "right", colour: CHALK, family: MONO, size: 24, weight: 700 });
  surface.box(L, { x: 28, y: 44, w: w - 56, h: 12, colour: PANEL });
  surface.box(L, { x: 28, y: 44, w: (w - 56) * (snap.phase === PHASE.WORK ? snap.t / WORK_TICKS : 1), h: 12, colour: snap.phase === PHASE.WORK && snap.t < 90 ? "#ff8d80" : WATER });

  for (let cell = 0; cell < 9; cell++) {
    const x = 120 + (cell % 3) * 120, y = 76 + Math.floor(cell / 3) * 120;
    const cx = x + 60, cy = y + 60, mask = ports(snap.types, rot, cell), flowing = !!(wet & (1 << cell));
    surface.box(L, { x: x + 4, y: y + 4, w: 112, h: 112, radius: 9, colour: PANEL });
    for (const [dx, dy] of [[12, 12], [108, 108]]) surface.disc(L, { x: x + dx, y: y + dy, r: 3, colour: "#42636a" });
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      const end = { x: cx + [0, 60, 0, -60][d], y: cy + [-60, 0, 60, 0][d] };
      surface.trail(L, { x: cx, y: cy }, end, { colour: COPPER, width: 32 });
      surface.trail(L, { x: cx, y: cy }, end, { colour: flowing ? WATER : INK, width: 19 });
      if (flowing) {
        const part = calm ? 0.55 : (ctx.time() * 0.8 + cell * 0.12) % 1;
        surface.disc(L, { x: cx + (end.x - cx) * part, y: cy + (end.y - cy) * part, r: 3.5, colour: CHALK });
      }
    }
    surface.disc(L, { x: cx, y: cy, r: 16, colour: COPPER });
    surface.disc(L, { x: cx, y: cy, r: 9.5, colour: flowing ? WATER : INK });
    surface.text(L, { x: x + 20, y: y + 31, value: cell + 1, colour: CHALK, alpha: 0.65, size: 18, family: MONO });
    if (cell === snap.cursor[seat]) {
      const colour = snap.flash[seat] ? CHALK : ctx.colourFor(seat);
      surface.box(L, { x: x + 6, y: y + 6, w: 108, h: 108, radius: 8, colour, stroke: 4 });
      surface.poly(L, { points: [{ x: x + 45, y: y + 10 }, { x: x + 75, y: y + 10 }, { x: x + 60, y: y + 25 }], colour });
    }
  }
  const cy = 256;
  for (const [x1, x2, label, filled] of [[30, 120, "IN", true], [480, 570, "OUT", snap.solved[seat]]]) {
    surface.trail(L, { x: x1, y: cy }, { x: x2, y: cy }, { colour: COPPER, width: 32 });
    surface.trail(L, { x: x1, y: cy }, { x: x2, y: cy }, { colour: filled ? WATER : INK, width: 19 });
    surface.poly(L, { points: [{ x: (x1 + x2) / 2 - 9, y: cy - 8 }, { x: (x1 + x2) / 2 + 7, y: cy }, { x: (x1 + x2) / 2 - 9, y: cy + 8 }], colour: CHALK });
    surface.text(L, { x: (x1 + x2) / 2, y: cy - 35, value: label, colour: CHALK, size: 23, family: MONO, weight: 700, align: "center" });
  }
  surface.text(L, { x: w / 2, y: 464, value: snap.solved[seat] ? `CONNECTED  +${snap.award[seat]}` : me < 0 ? `VIEWING CREW ${seat + 1}` : `YOUR PLAN  ·  TILE ${snap.cursor[seat] + 1}`, colour: snap.solved[seat] ? WATER : CHALK, size: 22, family: MONO, weight: 700, align: "center" });

  for (const e of ctx.events("completed")) {
    if (!calm && e.player === seat) fx.rings.push({ life: 0.8 });
  }
  fx.rings = fx.rings.filter(r => (r.life -= ctx.dt()) > 0);
  for (const r of fx.rings) surface.disc(L, { x: 540, y: cy, r: 20 + (0.8 - r.life) * 120, colour: WATER, stroke: 5, alpha: r.life });
  if (snap.phase === PHASE.READY) {
    surface.box(L, { x: 166, y: 182, w: 268, h: 148, colour: INK, radius: 12 });
    surface.text(L, { x: w / 2, y: 265, value: Math.ceil(snap.t / 15), colour: CHALK, size: 94, weight: 800, align: "center", baseline: "middle" });
  }
  if (me < 0) ctx.hud("Watching a crew plan. You get your own board next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Orders filed. Enter or the button opens the next shift." : "Orders filed. Waiting for the foreman to open the next shift.");
  else if (snap.phase === PHASE.READY) ctx.hud("Connect IN to OUT. Select a tile, then turn its pipe.");
  else if (snap.phase === PHASE.REVIEW) ctx.hud(snap.solved[me] ? `Connection certified: +${snap.award[me]}. Next order shortly.` : "Time expired. Follow the blue water to find the broken joint next time.");
  else if (snap.solved[me]) ctx.hud(`Connected! +${snap.award[me]}. Watch the crew ledger until the next order.`);
  else ctx.hud(`Tile ${snap.cursor[me] + 1}: ← → select, Space turns. ${snap.claimed ? "Finish for" : "First connection earns"} ${(snap.claimed ? 3 : 5) * (snap.job === 2 ? 2 : 1)} points.`);
}

startGame({
  title: "Canal Works", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: {
    select: { keys: { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }, axis: 0 },
    rotate: { keys: { Space: 1, KeyR: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    moved: { sound: "click", only: "me", gain: 0.35 },
    turned: { sound: "thud", only: "me", gain: 0.6, pitch: 1.3 },
    mine: { field: "completed", sound: "score", only: "me", pitch: s => s.job === 2 ? 1.3 : 1 },
    theirs: { field: "completed", sound: "pickup", only: "others", gain: 0.3 },
    beep: "beep", opened: { sound: "start", gain: 0.55 }, reviewed: { sound: "click", gain: 0.6 }, finished: "win",
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} is chief engineer!` : `Shift filed · ${Math.max(0, ...(info.snapshot?.earned ?? []))} points led this shift`,
    next: won => won ? "Assemble a new crew" : "Open next shift",
  },
  scoreboard(players, scores, snap) {
    return players.map((p, i) => ({ ...p, alive: snap ? snap.active[i] : true,
      state: snap?.solved[i] ? "connected" : "working",
      note: !snap ? "on roster" : !snap.active[i] ? "off shift" : snap.solved[i] ? `✓ +${snap.award[i]}` : `${countWet(snap.wet[i])} wet tiles`,
    }));
  },
  onRound() { fx.rings = []; },
  draw,
});
