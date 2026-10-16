import { defineSnapshot, startGame, params } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, LIVE_TICKS, BAY, PERFECT } from "/game.js";

const PAPER = "#eceee7", STOCK = "#fafbf6", INK = "#202920", GREY = "#536052";
const LIME = "#d5ed56", MISS = "#bd3c26";
const PALETTE = ["#275c3c", "#315bb6", "#754971", "#88611b", "#146d70", "#904d32", "#4d637f", "#a23972"];
const FONT = 'Arial, "Helvetica Neue", system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { bits: [], shake: 0 };
const floorY = (height) => 398 - (Math.min(height + 1, 6) - 1) * 28;
const px = (x) => 56 + x * 1.5;
const number = (i) => String(i + 1).padStart(2, "0");

function text(s, x, y, value, size = 18, colour = INK, align = "left") {
  s.text("actors", { x, y, value, size, colour, align, family: MONO, weight: 700, baseline: "middle" });
}

function slab(s, x, y, width, height, colour, alpha = 1) {
  s.box("actors", { x: x - width / 2, y, w: width, h: height, colour, alpha });
  if (width > 10) s.trail("actors", { x: x - width / 2 + 4, y: y + 4 }, { x: x + width / 2 - 4, y: y + 4 }, { colour: STOCK, width: 1, alpha: alpha * 0.7 });
}

function draw(surface, snap, ctx) {
  const me = ctx.seat();
  const focus = me >= 0 ? me : Math.max(0, snap.points.findIndex((p, i) => snap.active[i] && p === Math.max(...snap.points.filter((_, j) => snap.active[j]))));
  const time = ctx.time(), dt = ctx.dt();
  const top = floorY(snap.height[focus]);
  const colour = ctx.colourFor(focus);
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w: 640, h: 480, colour: PAPER });
  for (let x = 16; x <= 432; x += 16) surface.trail("world", { x, y: 72 }, { x, y: 448 }, { colour: "#dce0d5", width: 1 });
  for (let y = 80; y <= 448; y += 16) surface.trail("world", { x: 16, y }, { x: 432, y }, { colour: "#dce0d5", width: 1 });
  surface.clear("actors");
  surface.box("actors", { x: 16, y: 16, w: 516, h: 26, colour: INK });
  surface.box("actors", { x: 20, y: 20, w: 508 * (snap.ready ? 1 : snap.left / LIVE_TICKS), h: 18, colour: LIME });
  text(surface, 624, 30, `${Math.ceil(snap.left / params.DEFAULT_TICK_HZ)}s`, 30, INK, "right");
  text(surface, 18, 57, `SPRINT ${String(ctx.round()).padStart(2, "0")}`, 15);
  text(surface, 624, 57, `TARGET ${ctx.target()}`, 15, GREY, "right");

  surface.box("actors", { x: 16, y: 72, w: 420, h: 380, colour: INK, stroke: 2 });
  surface.box("actors", { x: 22, y: 78, w: 408, h: 368, colour: me >= 0 ? LIME : GREY, stroke: 3 });
  surface.box("actors", { x: 28, y: 84, w: 64, h: 44, colour: INK });
  text(surface, 60, 107, number(focus), 32, LIME, "center");
  text(surface, 418, 100, `${snap.height[focus]} ↑`, 27, INK, "right");
  text(surface, 418, 124, `${Math.round(snap.width[focus])} / ${snap.cap[focus]}`, 16, GREY, "right");

  for (let y = 150; y <= 420; y += 14) surface.trail("actors", { x: 32, y }, { x: y % 28 === 0 ? 45 : 39, y }, { colour: GREY, width: 1 });
  const count = Math.min(snap.height[focus] + 1, 6);
  for (let j = 6 - count; j < 6; j++) {
    const y = 398 - (j - (6 - count)) * 28;
    slab(surface, px(snap[`c${j}`][focus]), y, snap[`w${j}`][focus] * 1.5, 25, colour);
  }
  surface.trail("actors", { x: 52, y: 426 }, { x: 420, y: 426 }, { colour: INK, width: 3 });
  if (snap.height[focus] >= 6) {
    for (let x = 60; x < 415; x += 24) surface.trail("actors", { x, y: 434 }, { x: x + 12, y: 440 }, { colour: GREY, width: 1 });
  }

  const baseX = px(snap.centre[focus]);
  const bw = snap.width[focus] * 1.5;
  const movingY = top - 56;
  if (!snap.over && snap.active[focus]) {
    surface.box("actors", { x: baseX - bw / 2, y: top - 29, w: bw, h: 25, colour: GREY, stroke: 1 });
    surface.box("actors", { x: baseX - PERFECT * 1.5, y: movingY - 12, w: PERFECT * 3, h: 64, colour: LIME, alpha: 0.7 });
    surface.poly("actors", { points: [{ x: baseX - bw / 2, y: movingY - 10 }, { x: baseX - bw / 2, y: top - 2 }, { x: baseX + bw / 2, y: top - 2 }, { x: baseX + bw / 2, y: movingY - 10 }], colour: INK, stroke: 1, closed: false, dash: [4, 5] });
    if (!snap.cd[focus]) {
      const x = px(snap.x[focus]);
      slab(surface, x, movingY, bw, 25, colour);
      surface.box("actors", { x: x - bw / 2 - 2, y: movingY - 2, w: bw + 4, h: 29, colour: INK, stroke: 2 });
      const d = snap.dir[focus];
      surface.poly("actors", { points: [{ x: x - d * 8, y: movingY - 14 }, { x: x + d * 8, y: movingY - 14 }, { x: x + d * 2, y: movingY - 20 }], colour: INK, stroke: 2, closed: false });
    } else {
      const rebuilding = snap.result[focus] === 3;
      text(surface, 236, movingY + 12, rebuilding ? "REBUILD" : "SET", 25, rebuilding ? MISS : GREY, "center");
    }
  }

  text(surface, 456, 88, "SITE", 14, GREY);
  text(surface, 622, 88, "+PT", 14, GREY, "right");
  snap.points.forEach((points, i) => {
    const y = 103 + i * 43;
    if (i === me) surface.box("actors", { x: 450, y, w: 178, h: 40, colour: LIME });
    text(surface, 455, y + 22, number(i), 19, snap.active[i] ? INK : GREY);
    const miniColour = snap.active[i] ? ctx.colourFor(i) : "#a9b1a3";
    for (let j = 3; j < 6; j++) {
      const width = snap[`w${j}`][i] * 0.44;
      if (width > 0) slab(surface, 490 + snap[`c${j}`][i] * 0.44, y + 30 - (j - 3) * 8, width, 6, miniColour);
    }
    text(surface, 620, y + 22, snap.active[i] ? points : "—", 23, INK, "right");
    surface.trail("actors", { x: 454, y: y + 41 }, { x: 624, y: y + 41 }, { colour: "#c4ccbc", width: 1 });
  });

  for (const field of ["placed", "perfect", "missed"]) {
    for (const e of ctx.events(field)) {
      if (e.player !== focus || calm) continue;
      const bad = field === "missed";
      fx.shake = bad ? 0.16 : 0.05;
      for (let j = 0; j < 10; j++) {
        fx.bits.push({ x: px(e.snapshot.centre[focus]), y: floorY(e.snapshot.height[focus]), vx: (j - 4.5) * 40, vy: -80 - (j % 3) * 30, life: 0.55, colour: bad ? MISS : field === "perfect" ? INK : colour });
      }
    }
  }
  fx.bits = fx.bits.filter((b) => (b.life -= dt) > 0);
  for (const b of fx.bits) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 450 * dt;
    surface.box("actors", { x: b.x, y: b.y, w: 7, h: 4, colour: b.colour, alpha: Math.min(1, b.life * 3) });
  }
  fx.shake = Math.max(0, fx.shake - dt);
  surface.shake(calm ? 0 : Math.sin(time * 75) * fx.shake * 14, 0);

  if (snap.flash[focus] > 0 && !snap.ready) {
    const result = snap.result[focus];
    const label = ["", "TRIM +1", "PERFECT +2", "MISS ×", "WAIT"][result];
    surface.box("actors", { x: 112, y: 145, w: 248, h: 40, colour: result === 3 ? MISS : INK });
    surface.text("actors", { x: 236, y: 165, value: label, size: 25, colour: STOCK, family: FONT, weight: 800, align: "center", baseline: "middle" });
  }
  if (snap.ready) {
    surface.box("actors", { x: 146, y: 185, w: 180, h: 125, colour: INK });
    text(surface, 236, 251, Math.ceil(snap.ready / 20), 96, LIME, "center");
  }

  if (me < 0) ctx.hud("Observing the lead site. You get a site in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? `Sprint filed: +${snap.points[me]}. Enter or the button opens the next job.` : `Sprint filed: +${snap.points[me]}. Waiting for the foreman.`);
  else if (snap.ready) ctx.hud(`You are site ${number(me)}. Tap Space or DROP when the slab aligns.`);
  else if (snap.cd[me] && snap.result[me] === 3) ctx.hud("Missed. Fresh foundation in one second; your points are safe.");
  else if (snap.cd[me]) ctx.hud("Slab set. Release the button, then line up the next one.");
  else ctx.hud(`Site ${number(me)} · Tap to stack. Centre hits restore width and earn +2.`);
}

startGame({
  title: "Stack Bureau",
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
    tapped: { sound: "click", only: "me", gain: 0.4 },
    placedMe: { field: "placed", sound: "thud", only: "me", gain: 0.75 },
    placedThem: { field: "placed", sound: "click", only: "others", gain: 0.2 },
    perfectMe: { field: "perfect", sound: "score", only: "me", pitch: (s, i) => 1 + Math.min(20, s.height[i]) * 0.025 },
    perfectThem: { field: "perfect", sound: "blip", only: "others", gain: 0.2 },
    missed: { sound: "hit", only: "me", gain: 0.7 },
    beep: "beep", go: "go", finished: "win",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins the commission`;
      const snap = info.snapshot;
      if (!snap) return "Sprint filed";
      const best = Math.max(0, ...snap.points.filter((_, i) => snap.active[i]));
      const leaders = snap.points.flatMap((p, i) => snap.active[i] && p === best ? [info.players[i]?.name ?? `Site ${i + 1}`] : []);
      const lead = leaders.length > 2 ? `${leaders.length} builders share the lead` : leaders.join(" & ");
      return best === 0 ? "No floors filed. Try another sprint." : `${lead} · ${best} points this sprint`;
    },
    next: (over) => over ? "New commission" : "Next sprint",
  },
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores.filter((_, i) => !snap || snap.active[i]));
    return players.map((p, i) => ({
      ...p,
      name: `${number(i)} ${p.name}`,
      alive: !snap || snap.active[i],
      state: scores[i] === best && best > 0 ? "lead" : "",
      note: !snap ? "site assigned" : !snap.active[i] ? "site closed" : `+${snap.points[i]} · ${snap.height[i]} floors`,
    }));
  },
  onRound() { fx.bits = []; fx.shake = 0; },
  draw,
});
