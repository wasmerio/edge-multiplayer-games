import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, BUILD_TICKS, START_WIDTH, workspace } from "/game.js";

const BLUE = "#123db5";
const DEEP = "#10266b";
const CHALK = "#f3f6ff";
const GRID = "#4970ce";
const LEMON = "#e4f27b";
const DANGER = "#ff816a";
const PALETTE = ["#f3f6ff", "#e4f27b", "#83dcff", "#dfb1fa", "#ffc59c", "#9ae4cb", "#b9c7ff", "#ffb7d2"];
const SANS = 'Arial, "Helvetica Neue", system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, bits: [], shake: 0 };
const topOf = (height) => 382 - Math.min(height, 7) * 28;

function line(s, x1, y1, x2, y2, colour = GRID, width = 1) {
  s.trail("actors", { x: x1, y: y1 }, { x: x2, y: y2 }, { colour, width });
}
function text(s, x, y, value, size = 20, colour = CHALK, align = "left") {
  s.text("actors", { x, y, value, size, colour, align, family: MONO, baseline: "middle" });
}
function burst(x, y, colour, count) {
  if (calm) return;
  for (let i = 0; i < count; i++) {
    fx.bits.push({ x, y, vx: (i % 2 ? 1 : -1) * (25 + i * 9), vy: -70 - i * 5, life: 0.65, colour });
  }
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  let focus = me;
  if (focus < 0) {
    focus = 0;
    snap.height.forEach((v, i) => { if (snap.active[i] && (!snap.active[focus] || v > snap.height[focus])) focus = i; });
  }
  const colour = ctx.colourFor(focus);
  const span = workspace({ w, h });
  const ox = 30;
  const base = ox + snap.base[focus];
  const wide = snap.width[focus];
  const floors = snap.height[focus];
  const top = topOf(floors);

  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: BLUE });
    for (let x = 10; x < w; x += 20) surface.trail("world", { x, y: 0 }, { x, y: h }, { colour: GRID, width: 0.5, alpha: 0.4 });
    for (let y = 10; y < h; y += 20) surface.trail("world", { x: 0, y }, { x: w, y }, { colour: GRID, width: 0.5, alpha: 0.4 });
    surface.box("world", { x: 420, y: 70, w: 200, h: 390, colour: DEEP });
  }
  for (const event of ctx.events("placed")) {
    if (event.player === focus) burst(ox + event.snapshot.base[focus] + event.snapshot.width[focus] / 2, topOf(event.snapshot.height[focus]), colour, 8);
  }
  for (const event of ctx.events("perfect")) {
    if (event.player === focus) burst(base + wide / 2, top, LEMON, 10);
  }
  for (const event of ctx.events("collapsed")) {
    if (event.player === focus) { burst(ox + span / 2, 320, DANGER, 18); fx.shake = 0.22; }
  }
  fx.shake = Math.max(0, fx.shake - ctx.dt());
  surface.shake(calm ? 0 : Math.sin(ctx.time() * 80) * fx.shake * 12, 0);
  surface.clear("actors");

  text(surface, 30, 30, "BUILDING TIME", 18);
  text(surface, 610, 30, `${Math.ceil(snap.left / 30)}s`, 28, LEMON, "right");
  surface.box("actors", { x: 30, y: 49, w: 580, h: 9, colour: DEEP });
  surface.box("actors", { x: 30, y: 49, w: 580 * snap.left / BUILD_TICKS, h: 9, colour: LEMON });
  text(surface, 30, 85, `${String(focus + 1).padStart(2, "0")} / ${me < 0 ? "ON VIEW" : "YOUR SITE"}`, 18);
  text(surface, 392, 85, `${floors}F`, 32, colour, "right");

  // An elevation, not a history buffer: only the top face affects collisions.
  const visible = Math.min(7, floors);
  const depth = visible * 28;
  if (visible > 0) {
    surface.box("actors", { x: base, y: top, w: wide, h: depth, colour: DEEP });
    surface.box("actors", { x: base, y: top, w: wide, h: depth, colour, stroke: 2 });
    for (let j = 1; j <= visible; j++) {
      line(surface, base, top + j * 28, base + wide, top + j * 28, colour, 1.5);
      for (let x = base + 8; x < base + wide - 10; x += 22) {
        surface.box("actors", { x, y: top + (j - 1) * 28 + 8, w: 8, h: 11, colour, alpha: 0.4 });
      }
    }
    if (floors > 7) {
      surface.poly("actors", { points: [{ x: base - 4, y: 353 }, { x: base + wide * 0.3, y: 343 }, { x: base + wide * 0.65, y: 355 }, { x: base + wide + 4, y: 345 }], colour: BLUE, stroke: 9, closed: false });
    }
  }
  line(surface, ox, 389, ox + span, 389, CHALK, 3);
  for (let x = ox; x < ox + span; x += 12) line(surface, x, 390, x - 6, 400, GRID, 2);
  surface.box("actors", { x: base, y: top, w: wide, h: 5, colour });
  // Plumb lines and the target outline match the actual placement interval.
  for (const x of [base, base + wide]) {
    surface.poly("actors", { points: [{ x, y: top - 65 }, { x, y: top + 7 }], colour: CHALK, stroke: 1.5, dash: [5, 5], closed: false });
  }
  const at = snap.cd[focus] > 0 || snap.over ? base : ox + snap.x[focus];
  const sy = top - 37;
  surface.box("actors", { x: at, y: sy, w: wide, h: 22, colour });
  surface.box("actors", { x: at + 3, y: sy + 3, w: Math.max(1, wide - 6), h: 16, colour: BLUE, stroke: 2 });
  if (me >= 0) surface.box("actors", { x: at - 4, y: sy - 4, w: wide + 8, h: 30, colour: CHALK, stroke: 1 });
  if (!snap.cd[focus] && !snap.over && !snap.ready) {
    const tx = at + wide / 2;
    const d = snap.dir[focus];
    line(surface, tx - d * 13, sy - 14, tx + d * 13, sy - 14, colour, 2);
    line(surface, tx + d * 13, sy - 14, tx + d * 6, sy - 20, colour, 2);
  }
  line(surface, base, 418, base + wide, 418, CHALK, 1);
  for (const x of [base, base + wide]) line(surface, x, 412, x, 424, CHALK, 2);
  text(surface, ox, 447, `WIDTH ${Math.round(wide)} / ${START_WIDTH}`, 18);
  if (snap.flash[focus] > 0) {
    const msg = ["", "CUT TO FIT", "PLUMB! +WIDTH", "COLLAPSE ×"][snap.mark[focus]];
    text(surface, 210, 117, msg, 21, snap.mark[focus] === 3 ? DANGER : LEMON, "center");
  }

  text(surface, 520, 91, "ELEVATIONS", 17, CHALK, "center");
  snap.height.forEach((height, i) => {
    const x = 432 + (i % 2) * 94;
    const y = 111 + Math.floor(i / 2) * 85;
    const ink = snap.active[i] ? ctx.colourFor(i) : GRID;
    if (i === focus) surface.box("actors", { x, y, w: 84, h: 77, colour: ink, stroke: 2 });
    text(surface, x + 7, y + 14, String(i + 1).padStart(2, "0"), 17, ink);
    const bh = 5 + Math.min(38, height * 2.5);
    surface.box("actors", { x: x + 9, y: y + 67 - bh, w: 19 + snap.width[i] / 12, h: bh, colour: ink, stroke: 2 });
    text(surface, x + 76, y + 51, height, 26, ink, "right");
    line(surface, x + 6, y + 69, x + 78, y + 69, ink);
    if (!snap.active[i]) { line(surface, x + 9, y + 30, x + 74, y + 66, GRID, 2); }
  });

  fx.bits = fx.bits.filter((bit) => (bit.life -= ctx.dt()) > 0);
  for (const bit of fx.bits) {
    bit.x += bit.vx * ctx.dt();
    bit.vy += 340 * ctx.dt();
    bit.y += bit.vy * ctx.dt();
    surface.box("actors", { x: bit.x, y: bit.y, w: 7, h: 4, rotate: bit.life * 5, colour: bit.colour, alpha: Math.min(1, bit.life * 2) });
  }
  if (snap.ready) {
    surface.box("actors", { x: 100, y: 170, w: 220, h: 130, colour: BLUE });
    surface.text("actors", { x: 210, y: 235, value: Math.ceil(snap.ready / 20), size: 100, colour: LEMON, weight: 900, family: SANS, align: "center", baseline: "middle" });
  }

  if (me < 0) ctx.hud("Watching the skyline. You get a building site next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Survey complete. Enter or the button opens the next session." : "Survey complete. Waiting for the host to open the next session.");
  else if (snap.ready) ctx.hud("Line up the moving floor with your tower. Tap to build.");
  else if (snap.mark[me] === 3 && snap.flash[me]) ctx.hud("Too much overhang! A fresh foundation is ready. Rebuild.");
  else ctx.hud(`${floors} floors · ${Math.round(wide)} wide. Tap when the edges line up. Tallest at the bell earns 3.`);
}

startGame({
  title: "Plumb Club",
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
    myFloor: { field: "placed", sound: "thud", only: "me", pitch: (s, i) => 0.8 + Math.min(1.2, s.height[i] * 0.05) },
    otherFloor: { field: "placed", sound: "click", only: "others", gain: 0.25 },
    perfect: { sound: "pickup", only: "me", gain: 0.6 },
    myCollapse: { field: "collapsed", sound: "hit", only: "me" },
    otherCollapse: { field: "collapsed", sound: "thud", only: "others", gain: 0.3 },
    awarded: { sound: "score", only: "me" },
    beep: "beep", go: "go", finished: { sound: "fanfare", gain: 0.65 },
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins Plumb Club.`;
      const snap = info.snapshot;
      if (!snap) return "Survey complete.";
      const leaders = snap.award.flatMap((v, i) => v === 3 ? [info.players[i]?.name ?? "Builder"] : []);
      const tallest = Math.max(0, ...snap.height.filter((_, i) => snap.active[i]));
      return leaders.length ? `${leaders.join(" & ")} · ${tallest} floors · +3` : "No tower standing. A clean slate.";
    },
    next: (over) => over ? "Open a new club" : "Next building session",
  },
  scoreboard(players, scores, snap) {
    return players.map((player, i) => ({
      ...player, name: `${i + 1}. ${player.name}`, score: scores[i],
      alive: snap ? snap.active[i] : true,
      state: snap?.lead === i ? "lead" : "",
      note: !snap ? "builder" : !snap.active[i] ? "left" : snap.over ? `${snap.height[i]} floors · +${snap.award[i]}` : `${snap.height[i]} floors${snap.lead === i ? " · narrow start" : ""}`,
    }));
  },
  onRound() { fx.floor = false; fx.bits = []; fx.shake = 0; },
  draw,
});
