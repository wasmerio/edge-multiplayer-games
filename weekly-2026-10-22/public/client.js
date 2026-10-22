import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, SNAPSHOT, INTENT, ARENA, TARGET, ROUND_TICKS } from "/game.js";

const BLUE = "#163bb1", DEEP = "#10286d", CHALK = "#f4f7ff", LINE = "#5578d1", LIME = "#dfff72", MISS = "#ff807b";
const PALETTE = [CHALK, LIME, "#9ee9ff", "#ffc19a", "#d4baff", "#ffb9db", "#9ff0c9", "#eddfa3"];
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';
const SANS = 'Arial, "Helvetica Neue", system-ui, sans-serif';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, chips: [] };
const number = (i) => String(i + 1).padStart(2, "0");

function line(surface, layer, x1, y1, x2, y2, colour = LINE, width = 1) {
  surface.trail(layer, { x: x1, y: y1 }, { x: x2, y: y2 }, { colour, width });
}
function label(surface, x, y, value, size = 24, colour = CHALK, align = "left") {
  surface.text("actors", { x, y, value, size, colour, align, baseline: "middle", family: MONO });
}
function floor(surface, w, h) {
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w, h, colour: BLUE });
  for (let x = 20; x < w; x += 20) line(surface, "world", x, 0, x, h, "#2448ba");
  for (let y = 20; y < h; y += 20) line(surface, "world", 0, y, w, y, "#2448ba");
  line(surface, "world", 20, 345, w - 20, 345, CHALK);
  for (let y = 161; y <= 311; y += 25) {
    line(surface, "world", 20, y, 30, y, CHALK, 2);
    line(surface, "world", w - 30, y, w - 20, y, CHALK, 2);
  }
}

function elevation(surface, snap, ctx, seat, x0, bottom, span, storey, mini = false) {
  const { w } = surface.arena();
  const scale = span / w;
  const colour = ctx.colourFor(seat);
  const map = (x) => x0 + x * scale;
  const foundationWidth = w * 0.32;
  const foundation = (w - foundationWidth) / 2;
  const thickness = mini ? 4 : 9;
  surface.box("actors", { x: map(foundation) - 8 * scale, y: bottom, w: (foundationWidth + 16) * scale, h: thickness, colour: CHALK });
  for (let j = 0; j < snap.level[seat]; j++) {
    const bx = snap[`bx${j}`][seat], bw = snap[`bw${j}`][seat];
    const y = bottom - (j + 1) * storey;
    surface.box("actors", { x: map(bx), y, w: bw * scale, h: storey - (mini ? 1 : 3), colour, alpha: snap.active[seat] ? 1 : 0.3 });
    if (!mini) {
      surface.box("actors", { x: map(bx), y: y + storey - 8, w: bw * scale, h: 5, colour: DEEP, alpha: 0.4 });
      for (let wx = bx + 14; wx < bx + bw - 8; wx += 26) line(surface, "actors", map(wx), y + 6, map(wx), y + storey - 10, BLUE, 3);
    }
  }
  if (!snap.active[seat] || snap.over) return;
  const paused = snap.cd[seat] > 0;
  if (paused && snap.result[seat] !== 3) return;
  const top = bottom - (snap.level[seat] + 1) * storey - (mini ? 3 : 14);
  const left = map(snap.x[seat]), width = snap.width[seat] * scale;
  if (!mini) {
    const bx = map(snap.base[seat]);
    surface.poly("actors", { points: [{ x: bx, y: top - 18 }, { x: bx, y: bottom - snap.level[seat] * storey }], closed: false, colour: CHALK, stroke: 1, dash: [5, 5], alpha: 0.65 });
    surface.poly("actors", { points: [{ x: bx + width, y: top - 18 }, { x: bx + width, y: bottom - snap.level[seat] * storey }], closed: false, colour: CHALK, stroke: 1, dash: [5, 5], alpha: 0.65 });
    const overlapLeft = Math.max(snap.x[seat], snap.base[seat]);
    const overlapRight = Math.min(snap.x[seat] + snap.width[seat], snap.base[seat] + snap.width[seat]);
    if (overlapRight > overlapLeft && !paused) surface.box("actors", { x: map(overlapLeft), y: top, w: (overlapRight - overlapLeft) * scale, h: storey - 3, colour: LIME, alpha: 0.22 });
    const middle = left + width / 2;
    line(surface, "actors", middle, 89, middle, top - 5, LINE);
    surface.disc("actors", { x: middle, y: 89, r: 4, colour: CHALK });
  }
  surface.box("actors", { x: left, y: top, w: width, h: storey - 3, colour: paused ? MISS : colour, stroke: mini ? 1 : 3 });
  if (paused && !mini) {
    line(surface, "actors", left + width / 2 - 8, top + 4, left + width / 2 + 8, top + 18, MISS, 3);
    line(surface, "actors", left + width / 2 + 8, top + 4, left + width / 2 - 8, top + 18, MISS, 3);
  }
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const seat = ctx.seat(), focus = seat < 0 ? 0 : seat;
  const dt = ctx.dt();
  if (!fx.floor) { floor(surface, w, h); fx.floor = true; }
  surface.clear("actors");

  for (const field of ["landed", "missed", "built"]) {
    for (const e of ctx.events(field)) {
      if (e.player !== focus || calm) continue;
      const s = e.snapshot;
      const x = 40 + (s.base[focus] + s.width[focus] / 2) * (w - 80) / w;
      const y = 311 - s.level[focus] * 25;
      const count = field === "built" ? 24 : 8;
      for (let j = 0; j < count; j++) {
        const angle = j * Math.PI * 2 / count;
        fx.chips.push({ x, y, vx: Math.cos(angle) * (80 + j * 5), vy: -80 + Math.sin(angle) * 100,
          life: 0.7, colour: field === "missed" ? MISS : field === "built" ? LIME : ctx.colourFor(focus) });
      }
    }
  }

  const remaining = Math.max(0, snap.left - (snap.over || snap.ready ? 0 : ctx.tickFraction()));
  surface.box("actors", { x: 20, y: 18, w: w - 110, h: 12, colour: DEEP });
  surface.box("actors", { x: 20, y: 18, w: (w - 110) * remaining / ROUND_TICKS, h: 12, colour: LIME });
  label(surface, w - 20, 25, `${Math.ceil(snap.left / 30)}s`, 26, LIME, "right");
  surface.disc("actors", { x: 43, y: 62, r: 21, colour: CHALK, stroke: 2 });
  label(surface, 43, 63, number(focus), 23, CHALK, "center");
  label(surface, 76, 63, seat < 0 ? "OBSERVATION" : "YOUR ELEVATION", 21);
  label(surface, w - 22, 63, `${snap.level[focus]} / 6`, 25, CHALK, "right");
  line(surface, "actors", 40, 89, w - 40, 89, CHALK, 2);
  elevation(surface, snap, ctx, focus, 40, 311, w - 80, 25);

  if (snap.cd[focus] > 0 && snap.result[focus] === 4) {
    surface.box("actors", { x: w / 2 - 107, y: 112, w: 214, h: 34, colour: LIME });
    label(surface, w / 2, 130, "SIGNED OFF +4", 22, DEEP, "center");
  }
  const n = snap.x.length, cell = (w - 40) / n;
  for (let i = 0; i < n; i++) {
    const x = 20 + i * cell;
    if (i === seat) {
      surface.box("actors", { x: x + 2, y: 353, w: cell - 4, h: 113, colour: CHALK, stroke: 2 });
      surface.poly("actors", { points: [{ x: x + 7, y: 358 }, { x: x + 19, y: 358 }, { x: x + 7, y: 370 }], colour: LIME });
    }
    label(surface, x + cell / 2, 375, number(i), 25, snap.active[i] ? ctx.colourFor(i) : LINE, "center");
    elevation(surface, snap, ctx, i, x + 6, 453, cell - 12, 8, true);
  }
  fx.chips = fx.chips.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.chips) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 350 * dt;
    surface.box("actors", { x: p.x, y: p.y, w: 6, h: 4, rotate: p.life * 5, colour: p.colour, alpha: Math.min(1, p.life * 2) });
  }
  if (snap.ready > 0) {
    surface.box("actors", { x: w / 2 - 90, y: 139, w: 180, h: 156, colour: DEEP });
    surface.text("actors", { x: w / 2, y: 220, value: Math.ceil(snap.ready / 30), size: 120, weight: 800, family: SANS, colour: LIME, align: "center", baseline: "middle" });
  }

  if (seat < 0) ctx.hud("Observing site 01. You get a building site next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Pencils down. Enter or the button opens the next site." : "Pencils down. Waiting for the host to reopen the sites.");
  else if (snap.ready) ctx.hud("Line up the slab with the roof. Tap once to drop; release to rearm.");
  else if (snap.cd[seat]) {
    const result = snap.result[seat];
    ctx.hud(result === 4 ? "Six floors! +4 commission bonus. A fresh site is coming." : result === 3 ? "Miss: −2 points. Wide foundation incoming. Release the key." : result === 2 ? "Flush! +2 points. Full width saved. Release for the next slab." : "Trimmed: +1 point. Only the overlap survives. Release to rearm.");
  } else ctx.hud(`Tap Space / ↓ or DROP when the outlines align. First to ${ctx.target()} with a clear lead.`);
}

startGame({
  title: "Plumb Club", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE,
  nextKey: "Enter",
  bindings: { drop: { keys: { Space: 1, ArrowDown: 1 }, buttons: { 0: 1 } } },
  audioMap: {
    landed: { sound: "thud", gain: 0.7, only: "me", pitch: (s, i) => 0.9 + s.level[i] * 0.09 },
    others: { field: "landed", sound: "click", gain: 0.25, only: "others" },
    perfect: { sound: "score", only: "me", gain: 0.55 },
    missed: { sound: "buzz", only: "me", gain: 0.6 },
    built: { sound: "fanfare", gain: 0.7, only: "me" },
    beep: "beep", go: "go", finished: "win",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins the commission.`;
      const seats = info.scores.map((_, i) => i).filter((i) => info.snapshot?.active[i] !== false);
      const best = Math.max(0, ...seats.map((i) => info.scores[i]));
      const leaders = seats.filter((i) => info.scores[i] === best);
      const lead = leaders.length === 1 ? `${info.players[leaders[0]]?.name ?? "A builder"} leads: ${best}` : `Shared lead: ${best}`;
      return `Time. ${lead} points. Target ${info.target}.`;
    },
    next: (matchOver) => matchOver ? "Open a new competition" : "Open the next site",
  },
  scoreboard(players, scores, snap) {
    return players.map((player, i) => ({ ...player, name: `${number(i)} · ${player.name}`, score: scores[i],
      alive: snap ? snap.active[i] : true,
      state: scores[i] > 0 && scores[i] === Math.max(...scores) ? "lead" : "",
      note: !snap ? "builder" : !snap.active[i] ? "departed" : snap.result[i] === 4 && snap.cd[i] ? "commissioned" : `${snap.level[i]} / 6 floors`,
    }));
  },
  onRound() { fx.floor = false; fx.chips = []; },
  draw,
});
