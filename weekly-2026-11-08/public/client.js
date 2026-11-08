import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, PLAY_TICKS, tileAt, countLit } from "/game.js";

const PALETTE = ["#8fe0c3", "#ffba8e", "#d1b4f0", "#8ed5eb", "#f1dc83", "#eea6c0", "#fff4df", "#aebef9"];
const INK = "#123936", WELL = "#0a2827", CREAM = "#fff8e8", COPPER = "#dfa47d", LIGHT = "#ffe08a", FAULT = "#ff7868";
const ROUND = 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace';
const TAU = Math.PI * 2;
const GRID = { x: 155, y: 85, tile: 110 };
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
const fx = { floor: false, sparks: [], floats: [], shake: 0, pulse: 0 };
const centre = (cell) => ({ x: GRID.x + (cell % 3 + 0.5) * GRID.tile, y: GRID.y + (Math.floor(cell / 3) + 0.5) * GRID.tile });
const badge = (i) => ({ x: 28 + (i % 2) * 310, y: 445 + Math.floor(i / 2) * 40 });

function burst(x, y, colour, many = 12) {
  if (calm) return;
  for (let j = 0; j < many; j++) {
    const angle = j / many * TAU;
    fx.sparks.push({ x, y, vx: Math.cos(angle) * (65 + j % 4 * 23), vy: Math.sin(angle) * (65 + j % 4 * 23), life: 0.6, colour });
  }
}
function brackets(surface, x, y, w, h, colour, width = 4) {
  for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const px = x + sx * w, py = y + sy * h, dx = sx ? -1 : 1, dy = sy ? -1 : 1;
    surface.poly("actors", { points: [{ x: px, y: py + dy * 16 }, { x: px, y: py }, { x: px + dx * 16, y: py }], colour, stroke: width, closed: false });
  }
}
function draw(surface, snap, ctx) {
  const me = ctx.seat(), time = ctx.time(), dt = ctx.dt();
  const view = me >= 0 ? me : Math.max(0, snap.active.findIndex(Boolean));
  const { w, h } = surface.arena();
  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: INK });
    for (let x = 20; x < w; x += 30) for (let y = 20; y < h; y += 30) surface.disc("world", { x, y, r: 1, colour: "#32605a" });
    surface.box("world", { x: GRID.x - 15, y: GRID.y - 15, w: 360, h: 360, radius: 18, colour: "#2c5750" });
    for (const x of [140, 500]) for (const y of [70, 430]) {
      surface.disc("world", { x, y, r: 5, colour: COPPER });
      surface.trail("world", { x: x - 2, y: y + 2 }, { x: x + 2, y: y - 2 }, { colour: INK, width: 2 });
    }
  }
  for (const e of ctx.events("moved")) if (e.player === me) fx.pulse = 0.16;
  for (const e of ctx.events("turned")) {
    const at = e.player === view ? centre(e.snapshot.cursor[e.player]) : badge(e.player);
    burst(at.x, at.y, COPPER, e.player === me ? 12 : 4);
  }
  for (const e of ctx.events("solved")) {
    const at = e.player === view ? centre(4) : badge(e.player);
    burst(at.x, at.y, LIGHT, e.player === me ? 36 : 16);
    if (e.player === me) fx.shake = 0.18;
  }
  for (const e of ctx.events("scored")) {
    const at = badge(e.player);
    fx.floats.push({ x: at.x + 240, y: at.y + 20, value: `+${e.snapshot.award[e.player]}`, life: 1.2 });
  }
  for (const e of ctx.events("go")) burst(GRID.x - 25, GRID.y + 55, LIGHT);
  for (const e of ctx.events("finished")) burst(w / 2, 30, CREAM, 24);
  fx.shake = Math.max(0, fx.shake - dt);
  fx.pulse = Math.max(0, fx.pulse - dt);
  surface.shake(calm ? 0 : Math.sin(time * 70) * fx.shake * 15, 0);
  surface.clear("actors");

  const remaining = Math.max(0, snap.left - (snap.over || snap.ready ? 0 : ctx.tickFraction()));
  surface.box("actors", { x: 28, y: 21, w: 488, h: 20, radius: 10, colour: WELL });
  surface.box("actors", { x: 31, y: 24, w: 482 * remaining / PLAY_TICKS, h: 14, radius: 7, colour: snap.left <= 150 ? FAULT : LIGHT });
  surface.text("actors", { x: 604, y: 40, value: String(Math.ceil(snap.left / 30)).padStart(2, "0"), size: 36, family: MONO, colour: CREAM, align: "right" });
  surface.text("actors", { x: 320, y: 62, value: me < 0 ? `${ctx.players()[view]?.name ?? "Bench"}` : `${countLit(snap.lit[view])} / 9`, size: 23, family: MONO, colour: CREAM, align: "center", maxWidth: 280 });

  const inlet = centre(0);
  surface.trail("actors", { x: 78, y: inlet.y }, { x: GRID.x, y: inlet.y }, { colour: WELL, width: 24 });
  surface.trail("actors", { x: 78, y: inlet.y }, { x: GRID.x, y: inlet.y }, { colour: LIGHT, width: 10 });
  surface.poly("actors", { points: [{ x: 111, y: inlet.y - 15 }, { x: 131, y: inlet.y }, { x: 111, y: inlet.y + 15 }], colour: LIGHT });
  surface.disc("actors", { x: 77, y: inlet.y, r: 17, colour: LIGHT, glow: { colour: LIGHT, blur: 12 } });
  surface.poly("actors", { points: [{ x: 79, y: inlet.y - 11 }, { x: 70, y: inlet.y + 1 }, { x: 78, y: inlet.y + 1 }, { x: 75, y: inlet.y + 11 }, { x: 85, y: inlet.y - 3 }, { x: 78, y: inlet.y - 3 }], colour: INK });

  for (let cell = 0; cell < 9; cell++) {
    const at = centre(cell), x = at.x, y = at.y, half = GRID.tile / 2;
    const mask = tileAt(snap.tiles, snap.rot[view], cell), powered = Boolean(snap.lit[view] & (1 << cell));
    const selected = cell === snap.cursor[view];
    surface.box("actors", { x: x - half + 3, y: y - half + 3, w: 104, h: 104, radius: 10, colour: WELL });
    surface.box("actors", { x: x - half + 6, y: y - half + 6, w: 98, h: 96, radius: 8, colour: powered ? "#416052" : "#254943" });
    for (const [dx, dy, bit, opposite] of [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]]) {
      if (!(mask & bit)) continue;
      const tip = { x: x + dx * (half - 3), y: y + dy * (half - 3) };
      surface.trail("actors", at, tip, { colour: WELL, width: 23 });
      surface.trail("actors", at, tip, { colour: COPPER, width: 15 });
      if (powered) surface.trail("actors", at, tip, { colour: LIGHT, width: 6 });
      const nx = cell % 3 + dx, ny = Math.floor(cell / 3) + dy;
      const joins = nx >= 0 && nx < 3 && ny >= 0 && ny < 3 && (tileAt(snap.tiles, snap.rot[view], ny * 3 + nx) & opposite);
      const source = cell === 0 && bit === 8;
      if (powered && !joins && !source) {
        surface.poly("actors", { points: [{ x: tip.x - 7, y: tip.y - 5 }, { x: tip.x, y: tip.y + 5 }, { x: tip.x + 7, y: tip.y - 5 }], colour: FAULT, stroke: 4, closed: false });
      }
    }
    surface.disc("actors", { x, y, r: 19, colour: WELL });
    surface.disc("actors", { x, y, r: 14, colour: powered ? LIGHT : "#668578", glow: powered ? { colour: LIGHT, blur: 12 } : undefined });
    surface.arc("actors", { x, y, r: 9, from: -2.7, to: -1.2, colour: CREAM, width: 3, alpha: powered ? 0.9 : 0.3 });
    if (snap.assist[view] && cell === 4) for (const dx of [-37, 37]) for (const dy of [-37, 37]) surface.disc("actors", { x: x + dx, y: y + dy, r: 3, colour: COPPER });
    if (selected) {
      brackets(surface, x - 48, y - 48, 96, 96, CREAM, 4 + fx.pulse * 8);
      if (snap.flash[view]) surface.arc("actors", { x, y, r: 28 + (8 - snap.flash[view]) * 2, from: -1, to: 4.6, colour: CREAM, width: 3, alpha: snap.flash[view] / 8 });
    }
  }
  if (me >= 0) brackets(surface, GRID.x - 24, GRID.y - 24, 378, 378, ctx.colourFor(me), 5);
  if (snap.done[view]) {
    surface.disc("actors", { x: 540, y: 250, r: 27, colour: LIGHT });
    surface.poly("actors", { points: [{ x: 525, y: 250 }, { x: 537, y: 261 }, { x: 556, y: 237 }], stroke: 6, colour: INK, closed: false });
  }

  snap.active.forEach((active, i) => {
    const { x, y } = badge(i), c = ctx.colourFor(i);
    surface.box("actors", { x, y, w: 274, h: 33, radius: 16, colour: WELL });
    surface.disc("actors", { x: x + 17, y: y + 16, r: 11, colour: c, stroke: active ? undefined : 3 });
    if (i === me) surface.disc("actors", { x: x + 17, y: y + 16, r: 15, colour: CREAM, stroke: 2 });
    surface.text("actors", { x: x + 17, y: y + 17, value: i + 1, size: 15, weight: 800, colour: active ? INK : CREAM, align: "center", baseline: "middle" });
    surface.text("actors", { x: x + 39, y: y + 22, value: i === me ? "YOU" : (ctx.players()[i]?.name ?? "Bench").slice(0, 9), size: 21, family: ROUND, maxWidth: 104, colour: CREAM });
    for (let lamp = 0; lamp < 9; lamp++) surface.disc("actors", { x: x + 157 + lamp * 10, y: y + 16, r: 3.7, colour: active && countLit(snap.lit[i]) > lamp ? LIGHT : "#4b7064" });
    if (snap.done[i]) surface.poly("actors", { points: [{ x: x + 253, y: y + 16 }, { x: x + 258, y: y + 21 }, { x: x + 267, y: y + 10 }], stroke: 3, colour: LIGHT, closed: false });
    else if (!active) surface.text("actors", { x: x + 259, y: y + 23, value: "×", colour: CREAM, size: 25, align: "center" });
  });

  fx.sparks = fx.sparks.filter((s) => (s.life -= dt) > 0);
  for (const s of fx.sparks) {
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 90 * dt;
    surface.box("actors", { x: s.x - 2, y: s.y - 2, w: 4, h: 4, colour: s.colour, alpha: Math.min(1, s.life * 3), rotate: time * 2 });
  }
  fx.floats = fx.floats.filter((f) => (f.life -= dt) > 0);
  for (const f of fx.floats) {
    f.y -= dt * 24;
    surface.text("actors", { x: f.x, y: f.y, value: f.value, size: 28, weight: 800, colour: LIGHT, outline: { colour: WELL, width: 5 }, alpha: Math.min(1, f.life * 2) });
  }
  if (snap.ready > 0) {
    surface.disc("actors", { x: 320, y: 250, r: 77, colour: WELL });
    surface.text("actors", { x: 320, y: 255, value: Math.ceil(snap.ready / 20), size: 104, weight: 800, family: ROUND, align: "center", baseline: "middle", colour: LIGHT });
  }

  if (me < 0) ctx.hud(`Watching ${ctx.players()[view]?.name ?? "a bench"}. You get a bench next match.`);
  else if (snap.over) ctx.hud(ctx.isHost() ? `Board settled. Enter or “New circuit” continues. First to ${ctx.target()}.` : "Board settled. Waiting for the host to open the next circuit.");
  else if (!snap.active[me]) ctx.hud("Your bench is closed. You can return in the next match.");
  else if (snap.ready) ctx.hud("Power enters at the top left. Connect all nine lamps.");
  else if (snap.done[me]) ctx.hud(`All nine glowing! +${snap.award[me]} points. Watch the other benches finish.`);
  else ctx.hud(`${countLit(snap.lit[me])}/9 lit. Select a tile; tap TURN or Space. ${snap.assist[me] ? "Riveted centre starts correct." : "Match the pipe ends."}`);
}

startGame({
  title: "Copper Nine", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: {
    mx: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0 },
    my: { keys: { ArrowUp: -1, ArrowDown: 1, KeyW: -1, KeyS: 1 }, axis: 1 },
    turn: { keys: { Space: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    moved: { sound: "click", only: "me", gain: 0.5 },
    turned: { sound: "thud", only: "me", pitch: (s) => 1 + (1 - s.left / PLAY_TICKS) * 0.4 },
    solved: { sound: "powerup", gain: 0.45 },
    solvedMe: { field: "solved", sound: "fanfare", only: "me", gain: 0.75 },
    scored: { sound: "score", only: "me", pitch: (s) => 1 + (1 - s.left / PLAY_TICKS) * 0.3 },
    beep: "beep", go: "go", finished: "win",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} lights up the workshop!`;
      const best = Math.max(0, ...(info.snapshot?.award ?? []));
      const leaders = (info.snapshot?.award ?? []).flatMap((v, i) => v === best && info.snapshot.active[i] ? [info.players[i]?.name ?? "A bench"] : []);
      return best ? `${leaders.join(" & ")} · +${best} for ${best >= 5 ? "a complete circuit" : "partial lighting"}` : "No circuit awards. Fresh wiring next round.";
    },
    next: (matchOver) => matchOver ? "Reopen workshop" : "New circuit",
  },
  scoreboard(players, scores, snap) {
    return players.map((player, i) => ({
      ...player, score: scores[i], alive: snap ? snap.active[i] : true,
      state: snap?.done[i] ? "complete" : snap?.assist[i] ? "starter" : "wiring",
      note: !snap ? "bench ready" : !snap.active[i] ? "left" : snap.over ? `+${snap.award[i]} this board` : snap.done[i] ? `complete · +${snap.award[i]}` : `${countLit(snap.lit[i])}/9 lit${snap.assist[i] ? " · aid" : ""}`,
    }));
  },
  onRound() { fx.floor = false; fx.sparks = []; fx.floats = []; fx.shake = 0; fx.pulse = 0; },
  draw,
});
