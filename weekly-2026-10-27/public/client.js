import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, SHIFT_TICKS, REPAIRS, PORTS, tileAt } from "/game.js";

const PALETTE = ["#15594f", "#a43569", "#265db4", "#92620c", "#7454a6", "#357242", "#ae452d", "#486576"];
const INK = "#133e39", PAPER = "#f5fff9", MINT = "#d5eee3", COPPER = "#a95129", WATER = "#007fbd";
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const TAU = Math.PI * 2;
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { drops: [] };
const centre = (cell) => ({ x: 108 + (cell % 3 + 0.5) * 108, y: 78 + (Math.floor(cell / 3) + 0.5) * 108 });

function pipe(surface, cell, code, wet) {
  const c = centre(cell);
  const ends = [{ x: c.x, y: c.y - 54 }, { x: c.x + 54, y: c.y }, { x: c.x, y: c.y + 54 }, { x: c.x - 54, y: c.y }];
  for (const [width, colour] of [[30, "#783b24"], [24, COPPER], [13, "#342f27"], ...(wet ? [[8, WATER]] : [])]) {
    for (let side = 0; side < 4; side++) if (PORTS[code] & (1 << side)) surface.trail("actors", c, ends[side], { colour, width });
    surface.disc("actors", { ...c, r: width / 2, colour });
  }
  for (let side = 0; side < 4; side++) if (PORTS[code] & (1 << side)) {
    const e = ends[side];
    const p = { x: c.x + (e.x - c.x) * 0.75, y: c.y + (e.y - c.y) * 0.75 };
    surface.box("actors", { x: p.x - (side % 2 ? 4 : 18), y: p.y - (side % 2 ? 18 : 4), w: side % 2 ? 8 : 36, h: side % 2 ? 36 : 8, colour: "#d68c5c", radius: 2 });
  }
  if (wet) surface.disc("actors", { ...c, r: 4, colour: PAPER });
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const seat = ctx.seat();
  const view = seat >= 0 ? seat : Math.max(0, snap.active.findIndex(Boolean));
  const colour = ctx.colourFor(view);
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w, h, colour: MINT });
  surface.box("world", { x: 100, y: 70, w: 340, h: 340, colour: "#a7c9bb", radius: 14 });
  for (let cell = 0; cell < 9; cell++) {
    const { x, y } = centre(cell);
    surface.box("world", { x: x - 52, y: y - 52, w: 104, h: 104, colour: PAPER, radius: 7 });
    for (const sign of [-1, 1]) {
      surface.disc("world", { x: x + 42 * sign, y: y - 42, r: 3, colour: "#91b3a8" });
      surface.trail("world", { x: x + 42 * sign - 2, y: y - 43 }, { x: x + 42 * sign + 2, y: y - 41 }, { colour: INK, width: 1 });
    }
  }
  surface.clear("actors");
  surface.box("actors", { x: 26, y: 20, w: 402, h: 24, colour: "#b0d1c5", radius: 12 });
  surface.box("actors", { x: 26, y: 20, w: 402 * snap.left / SHIFT_TICKS, h: 24, colour: INK, radius: 12 });
  surface.text("actors", { x: 510, y: 34, value: `${Math.ceil(snap.left / 30)}s`, family: MONO, size: 26, weight: 700, align: "right", baseline: "middle", colour: INK });
  for (let cell = 0; cell < 9; cell++) pipe(surface, cell, tileAt(snap.board[view], cell), Boolean(snap.wet[view] & (1 << cell)));

  const selected = centre(snap.cursor[view]);
  surface.box("actors", { x: selected.x - 48, y: selected.y - 48, w: 96, h: 96, colour: colour, stroke: 5, radius: 5 });
  surface.box("actors", { x: selected.x - 43, y: selected.y - 43, w: 86, h: 86, colour: INK, stroke: 1, radius: 3 });
  surface.box("actors", { x: selected.x - 48, y: selected.y - 48, w: 27, h: 25, colour });
  surface.text("actors", { x: selected.x - 35, y: selected.y - 35, value: snap.cursor[view] + 1, size: 19, weight: 800, align: "center", baseline: "middle", colour: PAPER });

  const sourceY = 132 + snap.inlet[view] * 108, destY = 132 + snap.outlet[view] * 108;
  surface.trail("actors", { x: 38, y: sourceY }, { x: 108, y: sourceY }, { colour: WATER, width: 13 });
  surface.poly("actors", { points: [{ x: 63, y: sourceY - 22 }, { x: 87, y: sourceY }, { x: 63, y: sourceY + 22 }], colour: WATER });
  surface.disc("actors", { x: 32, y: sourceY, r: 17, colour: WATER });
  surface.disc("actors", { x: 32, y: sourceY, r: 6, colour: PAPER });
  const solved = snap.pause[view] > 0 || snap.done[view] === REPAIRS;
  surface.trail("actors", { x: 432, y: destY }, { x: 493, y: destY }, { colour: solved ? WATER : INK, width: 13 });
  surface.disc("actors", { x: 497, y: destY, r: 23, colour: solved ? WATER : INK, stroke: 6 });
  if (solved) surface.poly("actors", { points: [{ x: 485, y: destY }, { x: 494, y: destY + 8 }, { x: 508, y: destY - 10 }], closed: false, colour: WATER, stroke: 5 });
  else surface.disc("actors", { x: 497, y: destY, r: 8, colour: INK });

  if (solved) {
    surface.box("actors", { x: 206, y: 209, w: 128, h: 66, colour: WATER, radius: 20 });
    surface.text("actors", { x: 270, y: 243, value: `+${snap.award[view]}`, size: 46, weight: 900, align: "center", baseline: "middle", colour: PAPER });
  }
  const spacing = 480 / snap.board.length;
  for (let i = 0; i < snap.board.length; i++) {
    const x = 30 + spacing * (i + 0.5);
    surface.disc("actors", { x, y: 443, r: 15, colour: ctx.colourFor(i), alpha: snap.active[i] ? 1 : 0.3 });
    if (i === seat) surface.disc("actors", { x, y: 443, r: 20, colour: INK, stroke: 2 });
    surface.text("actors", { x, y: 443, value: i + 1, size: 20, weight: 800, align: "center", baseline: "middle", colour: PAPER });
    surface.box("actors", { x: x - 21, y: 468, w: 42, h: 5, colour: "#a7c9bb", radius: 2 });
    surface.box("actors", { x: x - 21, y: 468, w: 42 * snap.done[i] / REPAIRS, h: 5, colour: ctx.colourFor(i), radius: 2 });
  }

  for (const e of ctx.events("repaired")) if (e.player === view && !calm) {
    const y = 132 + e.snapshot.outlet[view] * 108;
    for (let i = 0; i < 14; i++) fx.drops.push({ x: 497, y, vx: Math.cos(i * TAU / 14) * 85, vy: Math.sin(i * TAU / 14) * 85 - 80, life: 0.65 });
  }
  fx.drops = fx.drops.filter((p) => (p.life -= ctx.dt()) > 0);
  for (const p of fx.drops) {
    p.x += p.vx * ctx.dt(); p.y += p.vy * ctx.dt(); p.vy += 220 * ctx.dt();
    surface.disc("actors", { x: p.x, y: p.y, r: 4, colour: WATER, alpha: Math.min(1, p.life * 3) });
  }
  if (snap.ready) {
    surface.box("actors", { x: 100, y: 70, w: 340, h: 340, colour: PAPER, alpha: 0.8, radius: 14 });
    surface.text("actors", { x: w / 2, y: 242, value: Math.ceil(snap.ready / 20), size: 124, weight: 900, align: "center", baseline: "middle", colour: INK });
  }
  if (seat < 0) ctx.hud(`Watching ${ctx.players()[view]?.name ?? "station 1"}. You get a station next match.`);
  else if (snap.over) ctx.hud(ctx.isHost() ? "Shift closed. Enter or the button opens the next shift." : "Shift closed. Waiting for the foreperson.");
  else if (snap.ready) ctx.hud("Inspect the pipes. Join the left inlet to the right outlet.");
  else if (snap.done[seat] === REPAIRS) ctx.hud("All eight repairs complete! Watch the other stations finish.");
  else if (snap.pause[seat]) ctx.hud(`Water connected! +${snap.award[seat]}. Next repair coming up.`);
  else ctx.hud(`Your station ${seat + 1} · repair ${snap.done[seat] + 1}/8. Select a tile; turn it to carry blue water to the outlet.${snap.assist[seat] ? " Assistance: +1 per repair." : ""}`);
}

startGame({
  title: "Pipewright", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: {
    select: { keys: { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }, axis: 0 },
    turn: { keys: { Space: 1, KeyR: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    moved: { sound: "click", only: "me", gain: 0.5 },
    turned: { sound: "thud", only: "me", gain: 0.65, pitch: 1.5 },
    mine: { field: "repaired", sound: "powerup", only: "me", pitch: (s, i) => 0.9 + s.done[i] * 0.07 },
    theirs: { field: "repaired", sound: "pop", only: "others", gain: 0.3 },
    beep: "beep", go: "go", finished: { sound: "fanfare", gain: 0.65 },
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} is chief pipewright!` : `Shift complete · ${Math.max(0, ...(info.snapshot?.done ?? []))} repairs led the crew. First to ${info.target}.`,
    next: (over) => over ? "Assemble a new crew" : "Open next shift",
  },
  scoreboard: (players, scores, s) => players.map((p, i) => ({
    ...p, name: `${i + 1}. ${p.name}`, score: scores[i], alive: s ? s.active[i] : true,
    state: s?.assist[i] ? "assist" : "",
    note: s ? !s.active[i] ? "off duty" : `${s.done[i]}/8 fixed${s.assist[i] ? " · +1 aid" : ""}` : "ready",
  })),
  onRound() { fx.drops = []; }, draw,
});
