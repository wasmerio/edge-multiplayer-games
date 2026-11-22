import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, PHASE, READY_TICKS, ROUTE_TICKS, REVEAL_TICKS, PUZZLES, DX, DY, rotate, trace, rotationsOf } from "/game.js";

const PALETTE = ["#a7f2e6", "#f4d580", "#cbbcff", "#f6b4ce", "#d0e997", "#a9d7ff", "#f5c5a0", "#f3f8e9"];
const BOTTLE = "#133e3b", TILE_INK = "#1a504b", WATER = "#a7f2e6", PAPER = "#f7fcf6", MUTED = "#a7c8bf", STOP = "#ff987e";
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace';
const TAU = Math.PI * 2;
const LEFT = 128, TOP = 88, TILE = 128;
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
const fx = { floor: false, drops: [], rings: [], chime: 0 };
const centre = (cell) => ({ x: LEFT + (cell % 3 + 0.5) * TILE, y: TOP + (Math.floor(cell / 3) + 0.5) * TILE });
const medal = (i, n) => {
  const cols = Math.min(4, n);
  return { x: 80 + (i % cols) * 480 / Math.max(1, cols - 1) + (cols === 1 ? 240 : 0), y: 526 + Math.floor(i / cols) * 72 };
};

function text(s, x, y, value, size, colour = PAPER, extra = {}) {
  s.text("actors", { x, y, value, size, colour, align: "center", baseline: "middle", ...extra });
}
function diamond(s, x, y, radius, colour) {
  s.poly("actors", { points: [{ x, y: y - radius }, { x: x + radius, y }, { x, y: y + radius }, { x: x - radius, y }], colour });
}
function pipePoints(cell, mask) {
  const at = centre(cell), ports = [0, 1, 2, 3].filter((d) => mask & (1 << d));
  const a = { x: at.x + DX[ports[0]] * TILE / 2, y: at.y + DY[ports[0]] * TILE / 2 };
  const b = { x: at.x + DX[ports[1]] * TILE / 2, y: at.y + DY[ports[1]] * TILE / 2 };
  return Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    return { x: a.x * (1 - t) ** 2 + 2 * at.x * t * (1 - t) + b.x * t * t, y: a.y * (1 - t) ** 2 + 2 * at.y * t * (1 - t) + b.y * t * t };
  });
}
function burst(x, y, colour, count) {
  if (calm) return;
  for (let j = 0; j < count; j++) {
    const a = j / count * TAU;
    fx.drops.push({ x, y, vx: Math.cos(a) * (70 + j % 4 * 25), vy: Math.sin(a) * 110, life: 0.65, colour });
  }
}
function draw(surface, snap, ctx) {
  const me = ctx.seat(), view = me >= 0 ? me : Math.max(0, snap.active.findIndex(Boolean));
  const n = snap.active.length, now = ctx.time(), dt = ctx.dt();
  const { w, h } = surface.arena();
  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: BOTTLE });
    for (let i = 0; i < 8; i++) surface.arc("world", { x: w / 2, y: 280, r: 180 + i * 36, from: 0, to: TAU, colour: "#24534e", width: 1 });
    surface.box("world", { x: LEFT - 8, y: TOP - 8, w: TILE * 3 + 16, h: TILE * 3 + 16, colour: "#0b2d2a", radius: 16 });
    surface.trail("world", { x: 32, y: 492 }, { x: 608, y: 492 }, { colour: "#39746c", width: 2 });
  }
  for (const e of ctx.events("turned")) {
    if (e.player === view) fx.rings.push({ ...centre(e.snapshot.cursor[e.player]), life: 0.25, colour: PAPER });
  }
  for (const e of ctx.events("solved")) {
    const at = medal(e.player, n);
    burst(at.x, at.y, ctx.colourFor(e.player), e.player === me ? 22 : 10);
    if (e.player === view) { burst(560, TOP + (e.snapshot.outlet + 0.5) * TILE, WATER, 28); fx.chime = 0.6; }
  }
  for (const e of ctx.events("opened")) fx.rings.push({ x: 76, y: TOP + (e.snapshot.inlet + 0.5) * TILE, life: 0.4, colour: WATER });
  for (const e of ctx.events("finished")) {
    if (me >= 0 && e.snapshot.total[me] > 0) burst(320, 46, PALETTE[me], 22);
  }
  surface.clear("actors");
  const live = snap.phase === PHASE.ROUTE;
  const full = snap.phase === PHASE.READY ? READY_TICKS : live ? ROUTE_TICKS : REVEAL_TICKS;
  const fraction = snap.over ? 0 : Math.max(0, snap.t - ctx.tickFraction()) / full;
  surface.box("actors", { x: 32, y: 20, w: 576, h: 10, radius: 5, colour: "#35675f" });
  surface.box("actors", { x: 32, y: 20, w: 576 * fraction, h: 10, radius: 5, colour: live && snap.t < 45 ? STOP : WATER });
  for (let i = 0; i < PUZZLES; i++) {
    const x = 264 + i * 28;
    surface.disc("actors", { x, y: 53, r: i === snap.puzzle ? 8 : 5, colour: i <= snap.puzzle ? WATER : "#39746c" });
    if (i >= 3) surface.disc("actors", { x, y: 53, r: 11, colour: PAPER, stroke: 1.5 });
  }
  text(surface, 76, 53, `${snap.puzzle + 1}/5`, 24, MUTED, { family: MONO });
  text(surface, 560, 53, snap.puzzle >= 3 ? "×2" : "×1", 30, PAPER, { family: SERIF });

  const rotations = rotationsOf(snap, view);
  const flow = trace(snap.tiles, rotations, snap.inlet, snap.outlet);
  for (let cell = 0; cell < 9; cell++) {
    const at = centre(cell), mask = rotate(snap.tiles[cell], rotations[cell]);
    const selected = cell === snap.cursor[view];
    const filled = flow.cells.includes(cell);
    surface.box("actors", { x: at.x - 61, y: at.y - 61, w: 122, h: 122, radius: 10, colour: selected ? "#306c63" : TILE_INK });
    surface.box("actors", { x: at.x - 57, y: at.y - 57, w: 114, h: 114, radius: 8, colour: "#39746c", stroke: 1 });
    const points = pipePoints(cell, mask);
    for (const [width, colour] of [[46, "#0a302c"], [34, filled ? "#4a9f91" : "#53837a"], [18, filled ? WATER : "#9bbcb0"]]) {
      surface.poly("actors", { points, closed: false, stroke: width, colour });
    }
    for (const end of [points[0], points[points.length - 1]]) {
      surface.disc("actors", { ...end, r: 18, colour: filled ? WATER : "#9bbcb0" });
      surface.disc("actors", { ...end, r: 12, colour: filled ? "#defdf2" : "#3a6860", stroke: 3 });
    }
    if (filled && !calm && !snap.over) {
      const p = points[Math.floor((now * 5 + cell * 0.9) % points.length)];
      surface.disc("actors", { ...p, r: 4, colour: PAPER });
    }
    if (selected) {
      // Double corner brackets identify the local cursor even in the final snapshot.
      const colour = me >= 0 ? PAPER : MUTED;
      for (const sign of [-1, 1]) {
        const x = at.x + sign * 54, y = at.y + sign * 54;
        surface.poly("actors", { points: [{ x: x - sign * 19, y }, { x, y }, { x, y: y - sign * 19 }], colour, stroke: 5, closed: false });
        surface.poly("actors", { points: [{ x: x - sign * 17, y: y - sign * 8 }, { x: x - sign * 8, y: y - sign * 8 }, { x: x - sign * 8, y: y - sign * 17 }], colour, stroke: 2, closed: false });
      }
      if (snap.flash[view] > 0) surface.box("actors", { x: at.x - 59, y: at.y - 59, w: 118, h: 118, radius: 10, stroke: 4, colour: PAPER, alpha: snap.flash[view] / 8 });
    }
  }

  const iy = TOP + (snap.inlet + 0.5) * TILE, oy = TOP + (snap.outlet + 0.5) * TILE;
  surface.trail("actors", { x: 76, y: iy }, { x: LEFT, y: iy }, { colour: WATER, width: 20 });
  surface.disc("actors", { x: 76, y: iy, r: 29, colour: WATER });
  surface.poly("actors", { points: [{ x: 66, y: iy - 13 }, { x: 86, y: iy }, { x: 66, y: iy + 13 }], colour: BOTTLE });
  text(surface, 76, iy + 48, "IN", 22, WATER, { family: MONO });
  surface.trail("actors", { x: LEFT + TILE * 3, y: oy }, { x: 564, y: oy }, { colour: flow.solved ? WATER : MUTED, width: 20 });
  surface.disc("actors", { x: 564, y: oy, r: 30, colour: flow.solved ? WATER : MUTED, stroke: 6 });
  if (flow.solved) {
    surface.poly("actors", { points: [{ x: 549, y: oy }, { x: 560, y: oy + 10 }, { x: 580, y: oy - 12 }], colour: PAPER, stroke: 6, closed: false });
  } else {
    surface.disc("actors", { x: 564, y: oy, r: 8, colour: MUTED });
    const at = centre(flow.blocked);
    const bx = at.x + DX[flow.exit] * 49, by = at.y + DY[flow.exit] * 49;
    surface.disc("actors", { x: bx, y: by, r: 13, colour: BOTTLE });
    surface.trail("actors", { x: bx - 6, y: by - 6 }, { x: bx + 6, y: by + 6 }, { colour: STOP, width: 4 });
    surface.trail("actors", { x: bx + 6, y: by - 6 }, { x: bx - 6, y: by + 6 }, { colour: STOP, width: 4 });
  }
  text(surface, 564, oy + 48, "OUT", 22, flow.solved ? WATER : MUTED, { family: MONO });

  for (let i = 0; i < n; i++) {
    const at = medal(i, n), colour = ctx.colourFor(i);
    const route = trace(snap.tiles, rotationsOf(snap, i), snap.inlet, snap.outlet);
    surface.disc("actors", { ...at, r: 22, colour, stroke: snap.done[i] ? undefined : 3, alpha: snap.active[i] ? 1 : 0.4 });
    if (i === me) diamond(surface, at.x - 34, at.y, 8, PAPER);
    text(surface, at.x, at.y, snap.done[i] ? `+${snap.award[i]}` : !snap.active[i] ? "—" : `${route.cells.length}`, 23, snap.done[i] ? BOTTLE : colour, { family: MONO, weight: 700 });
    text(surface, at.x, at.y + 32, i === me ? "YOU" : ctx.players()[i]?.name ?? `Seat ${i + 1}`, 21, PAPER, { maxWidth: 136 });
    if (!snap.done[i] && snap.active[i]) surface.arc("actors", { ...at, r: 26, from: -TAU / 4, to: -TAU / 4 + TAU * route.cells.length / 9, colour, width: 2 });
  }
  fx.rings = fx.rings.filter((r) => (r.life -= dt) > 0);
  if (!calm) for (const r of fx.rings) surface.disc("actors", { x: r.x, y: r.y, r: 25 + (0.4 - r.life) * 100, colour: r.colour, stroke: 2, alpha: Math.min(1, r.life * 3) });
  fx.drops = fx.drops.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.drops) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 150 * dt;
    surface.disc("actors", { x: p.x, y: p.y, r: 4, colour: p.colour, alpha: Math.min(1, p.life * 2) });
  }
  fx.chime = Math.max(0, fx.chime - dt);
  if (snap.done[view] && !snap.over) {
    const r = 39 + (calm ? 0 : fx.chime * 20);
    surface.disc("actors", { x: 564, y: oy, r, colour: WATER, stroke: 2 });
  }
  if (snap.phase === PHASE.READY) {
    surface.box("actors", { x: 220, y: 210, w: 200, h: 140, radius: 70, colour: BOTTLE });
    text(surface, 320, 282, Math.ceil(snap.t / 30), 110, PAPER, { family: SERIF });
  }

  if (me < 0) ctx.hud(`Watching ${ctx.players()[view]?.name ?? "the pipes"}. You get a board next match.`);
  else if (snap.over) ctx.hud(ctx.isHost() ? "Round bottled. Enter or the button opens the next one." : "Round bottled. Waiting for the host to continue.");
  else if (!snap.active[me]) ctx.hud("Your board is closed. Watch the connections; rejoin next match.");
  else if (snap.phase === PHASE.READY) ctx.hud("Connect IN to OUT. Arrows or stick select; Space or TURN rotates.");
  else if (snap.phase === PHASE.REVEAL) ctx.hud(snap.done[me] ? `Flowing! +${snap.award[me]} points. A fresh board is next.` : "Not connected this time. The next board is a fresh chance.");
  else if (snap.done[me]) ctx.hud(`Flowing! +${snap.award[me]} points. Watch your friends finish.`);
  else ctx.hud(`${Math.ceil(snap.t / 30)}s · Connect IN to OUT. ${snap.puzzle >= 3 ? "Double points! " : ""}${snap.claimed ? "A finish still scores." : "First flow earns a bonus."}`);
}

startGame({
  title: "Tideglass", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: {
    mx: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0 },
    my: { keys: { ArrowUp: -1, ArrowDown: 1, KeyW: -1, KeyS: 1 }, axis: 1 },
    turn: { keys: { Space: 1, KeyE: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    moved: { sound: "click", only: "me", gain: 0.4 },
    turned: { sound: "thud", only: "me", gain: 0.7 },
    solved: { sound: "pop", gain: 0.25, pitch: (s) => 1 + s.puzzle * 0.12 },
    myFlow: { field: "solved", sound: "score", only: "me", pitch: (s) => 1 + s.puzzle * 0.12 },
    beep: "beep", opened: { sound: "go", gain: 0.55 },
    revealed: { sound: "tick", gain: 0.4 }, finished: "fanfare",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins Tideglass`;
      const totals = info.snapshot?.total ?? [], best = Math.max(0, ...totals);
      const leaders = totals.flatMap((v, i) => v === best && info.snapshot.active[i] ? [i] : []);
      return best === 0 ? "No flow this round. Fresh pipes?" : leaders.length === 1 ? `${info.players[leaders[0]]?.name ?? "A player"} routed ${best} points this round` : `Shared lead · ${best} points this round`;
    },
    next: (matchOver) => matchOver ? "Fresh match" : "Fresh pipes",
  },
  scoreboard(players, scores, snap) {
    return players.map((p, i) => ({
      ...p, score: scores[i] ?? 0,
      alive: snap ? snap.active[i] : true,
      state: !snap ? "waiting" : !snap.active[i] ? "away" : snap.done[i] ? "flowing" : "routing",
      note: !snap ? "ready" : !snap.active[i] ? "left" : snap.done[i] ? `flow +${snap.award[i]}` : `${snap.total[i]} this round`,
    }));
  },
  onRound() { fx.floor = false; fx.drops = []; fx.rings = []; fx.chime = 0; },
  draw,
});
