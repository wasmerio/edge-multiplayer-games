import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, ROUND_TICKS, FLUSH_TICKS, ports, flow, DX, DY } from "/game.js";

const PALETTE = ["#efb17a", "#8ce0f2", "#c7b9ff", "#f3db87", "#f2b1d2", "#a5e5c6", "#a7c4ff", "#e8f4eb"];
const BG = "#09282d", PANEL = "#123b40", INK = "#e8f4eb", COPPER = "#efb17a", WATER = "#78e5f1", DANGER = "#ff8173";
const FONT = 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, sparks: [], floats: [] };
const tileAt = (t) => ({ x: 104 + (t % 3) * 118, y: 164 + Math.floor(t / 3) * 118 });
const gaugeAt = (i) => ({ x: 456, y: 93 + i * 55 });
const bits = (mask) => { let n = 0; for (let t = 0; t < 9; t++) if (mask & (1 << t)) n++; return n; };
function text(s, x, y, value, size = 24, colour = INK, extra = {}) {
  s.text("actors", { x, y, value, size, colour, family: FONT, weight: 700, baseline: "middle", ...extra });
}
function diamond(s, x, y, r, colour) {
  s.poly("actors", { points: [{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }], colour });
}
function burst(x, y, colour, big) {
  if (calm) return;
  const count = big ? 20 : 6;
  for (let j = 0; j < count; j++) {
    const a = j / count * Math.PI * 2;
    fx.sparks.push({ x, y, vx: Math.cos(a) * (big ? 150 : 65), vy: Math.sin(a) * (big ? 150 : 65), life: big ? 0.7 : 0.25, max: big ? 0.7 : 0.25, colour });
  }
}
function floor(s) {
  const { w, h } = s.arena();
  s.box("world", { x: 0, y: 0, w, h, colour: BG });
  s.box("world", { x: 26, y: 75, w: 390, h: 470, radius: 22, colour: PANEL });
  s.box("world", { x: 433, y: 64, w: 191, h: 481, radius: 14, colour: "#10353a" });
  for (const [x, y] of [[37, 87], [405, 87], [37, 534], [405, 534], [442, 74], [615, 534]]) {
    s.disc("world", { x, y, r: 4, colour: "#678d8b" });
    s.trail("world", { x: x - 2, y: y + 2 }, { x: x + 2, y: y - 2 }, { colour: BG, width: 2 });
  }
}
function pipeTile(s, snap, seat, t, time) {
  const { x, y } = tileAt(t);
  const wet = !!(snap.wet[seat] & (1 << t));
  const mask = ports(snap.shape[seat], snap.pipes[seat], t);
  s.box("actors", { x: x - 55, y: y - 55, w: 110, h: 110, radius: 15, colour: "#061f24" });
  s.box("actors", { x: x - 55, y: y - 58, w: 110, h: 110, radius: 15, colour: "#1d4a4e" });
  for (const [width, colour] of [[32, "#06272b"], [25, COPPER], [14, "#533e32"], [8, wet ? WATER : "#123035"]]) {
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) {
      s.trail("actors", { x, y }, { x: x + DX[d] * 55, y: y + DY[d] * 55 }, { width, colour });
    }
  }
  for (let d = 0; d < 4; d++) if (mask & (1 << d)) {
    const px = x + DX[d] * 43, py = y + DY[d] * 43;
    s.trail("actors", { x: px - DY[d] * 16, y: py + DX[d] * 16 }, { x: px + DY[d] * 16, y: py - DX[d] * 16 }, { width: 5, colour: COPPER });
    if (wet) {
      const dist = calm ? 24 : (time * 48 + t * 13) % 45;
      s.disc("actors", { x: x + DX[d] * dist, y: y + DY[d] * dist, r: 3, colour: INK });
    }
  }
  s.disc("actors", { x, y, r: 5, colour: wet ? INK : COPPER });
}
function draw(surface, snap, ctx) {
  const me = ctx.seat(), time = ctx.time(), dt = ctx.dt();
  const viewed = me >= 0 ? me : Math.max(0, snap.active.findIndex(Boolean));
  if (!fx.floor) { floor(surface); fx.floor = true; }
  surface.clear("actors");

  for (const e of ctx.events("turned")) {
    if (e.player === viewed) { const p = tileAt(e.snapshot.cursor[e.player]); burst(p.x, p.y, COPPER, false); }
  }
  for (const e of ctx.events("moved")) {
    if (e.player === viewed) { const p = tileAt(e.snapshot.cursor[e.player]); burst(p.x, p.y - 50, INK, false); }
  }
  for (const e of ctx.events("repaired")) {
    const p = e.player === viewed ? { x: 222, y: 280 } : gaugeAt(e.player);
    burst(p.x, p.y, ctx.colourFor(e.player), e.player === me);
    fx.floats.push({ x: p.x, y: p.y, value: `+${e.snapshot.award[e.player]}`, life: 1.1, size: e.player === viewed ? 72 : 32 });
  }
  for (const e of ctx.events("loaded")) {
    if (e.player === viewed) burst(104, 164, WATER, true);
  }
  for (const _ of ctx.events("finished")) burst(320, 40, COPPER, true);

  const fraction = Math.max(0, snap.left - (snap.over || snap.ready ? 0 : ctx.tickFraction())) / ROUND_TICKS;
  surface.box("actors", { x: 28, y: 22, w: 490, h: 26, radius: 13, colour: "#245256" });
  surface.box("actors", { x: 32, y: 26, w: 482 * fraction, h: 18, radius: 9, colour: snap.left <= 150 ? DANGER : WATER });
  for (let j = 1; j < 8; j++) surface.box("actors", { x: 28 + j * 61, y: 22, w: 3, h: 26, colour: BG });
  text(surface, 609, 35, `${Math.ceil(snap.left / 30)}s`, 35, snap.left <= 150 ? DANGER : INK, { align: "right", family: MONO });
  text(surface, 58, 87, `${String(snap.level[viewed] + 1).padStart(2, "0")}`, 24, COPPER, { family: MONO });
  text(surface, 392, 87, me >= 0 ? "YOUR PANEL" : "WATCHING", 20, INK, { align: "right" });

  for (let t = 0; t < 9; t++) pipeTile(surface, snap, viewed, t, time);
  // The inlet and outlet are arrows, not colour-only cues.
  surface.trail("actors", { x: 8, y: 164 }, { x: 48, y: 164 }, { colour: WATER, width: 15 });
  surface.poly("actors", { points: [{ x: 31, y: 149 }, { x: 48, y: 164 }, { x: 31, y: 179 }], colour: INK });
  surface.trail("actors", { x: 395, y: 400 }, { x: 421, y: 400 }, { colour: snap.flush[viewed] ? WATER : COPPER, width: 15 });
  surface.poly("actors", { points: [{ x: 410, y: 385 }, { x: 427, y: 400 }, { x: 410, y: 415 }], colour: INK });
  const c = tileAt(snap.cursor[viewed]);
  surface.box("actors", { x: c.x - 55, y: c.y - 58, w: 110, h: 110, radius: 15, colour: INK, stroke: me >= 0 ? 4 : 2 });
  if (me >= 0) {
    surface.box("actors", { x: c.x - 49, y: c.y - 52, w: 98, h: 98, radius: 12, colour: INK, stroke: 2 });
    diamond(surface, c.x + 43, c.y - 45, 9, BG);
    diamond(surface, c.x + 43, c.y - 45, 6, INK);
  }
  if (snap.flash[viewed] > 0) surface.disc("actors", { x: c.x, y: c.y, r: 25 + (6 - snap.flash[viewed]) * 5, colour: INK, stroke: 3, alpha: snap.flash[viewed] / 6 });
  if (!snap.flush[viewed] && !snap.ready) {
    const f = flow(snap.shape[viewed], snap.pipes[viewed]);
    const p = tileAt(f.tip), x = p.x + DX[f.dir] * 50, y = p.y + DY[f.dir] * 50;
    surface.disc("actors", { x, y, r: 12, colour: BG });
    for (const sign of [-1, 1]) surface.trail("actors", { x: x - 6, y: y - 6 * sign }, { x: x + 6, y: y + 6 * sign }, { colour: DANGER, width: 4 });
  }
  for (let t = 0; t < 9; t++) surface.box("actors", { x: 56 + t * 36, y: 479, w: 29, h: 15, radius: 4, colour: snap.wet[viewed] & (1 << t) ? WATER : "#4d7475" });
  text(surface, 222, 520, snap.flush[viewed] ? `+${snap.award[viewed]}  CONNECTED` : `${bits(snap.wet[viewed])} / 9`, 26, snap.flush[viewed] ? WATER : INK, { align: "center", family: MONO });
  if (snap.flush[viewed]) surface.box("actors", { x: 44, y: 103, w: 355, h: 355, radius: 16, colour: WATER, stroke: 5, alpha: 0.4 + snap.flush[viewed] / FLUSH_TICKS * 0.6 });

  snap.active.forEach((active, i) => {
    const { x, y } = gaugeAt(i), colour = ctx.colourFor(i);
    if (i === me) diamond(surface, x - 10, y + 1, 7, INK);
    else surface.disc("actors", { x: x - 10, y: y + 1, r: 5, colour });
    const name = i === me ? "YOU" : (ctx.players()[i]?.name ?? `Seat ${i + 1}`).slice(0, 10);
    text(surface, x + 3, y, name, Math.min(25, 12 / surface.scale()), INK, { maxWidth: 142 });
    surface.box("actors", { x, y: y + 16, w: 150, h: 14, radius: 5, colour: "#31565a" });
    surface.box("actors", { x, y: y + 16, w: 150 * bits(snap.wet[i]) / 9, h: 14, radius: 5, colour, alpha: active ? 1 : 0.3 });
    text(surface, x + 148, y + 23, active ? `${snap.level[i] + 1}${snap.flush[i] ? " ✓" : ""}` : "—", 18, BG, { align: "right", outline: { colour: INK, width: 2 }, family: MONO });
  });

  fx.sparks = fx.sparks.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.sparks) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    surface.disc("actors", { x: p.x, y: p.y, r: 4, colour: p.colour, alpha: p.life / p.max });
  }
  fx.floats = fx.floats.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.floats) {
    if (!calm) p.y -= dt * 45;
    text(surface, p.x, p.y, p.value, p.size, INK, { align: "center", alpha: Math.min(1, p.life * 2), outline: { colour: BG, width: 8 } });
  }
  if (snap.ready) {
    surface.box("actors", { x: 128, y: 208, w: 188, h: 145, radius: 24, colour: BG });
    text(surface, 222, 285, Math.ceil(snap.ready / 20), 116, INK, { align: "center", family: MONO });
  }

  if (me < 0) ctx.hud(`Watching ${ctx.players()[viewed]?.name ?? "the repair crew"}. You get a panel next match.`);
  else if (snap.over) ctx.hud(ctx.isHost() ? "Sprint complete. Enter or the button opens the next shift." : "Sprint complete. Waiting for the host to open the next shift.");
  else if (!snap.active[me]) ctx.hud("Your station is closed. Rejoin for a seat next match.");
  else if (snap.ready) ctx.hud("Connect left inlet to right outlet through all nine tiles. Get ready!");
  else if (snap.flush[me]) ctx.hud(`Connected! +${snap.award[me]}. Fresh fittings are on their way.`);
  else ctx.hud(`${bits(snap.wet[me])}/9 flowing. Select a fitting; tap Turn. First clear +1. First to ${ctx.target()} wins.`);
}

startGame({
  title: "Copper Current", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: {
    mx: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0 },
    my: { keys: { ArrowUp: -1, ArrowDown: 1, KeyW: -1, KeyS: 1 }, axis: 1 },
    turn: { keys: { Space: 1, KeyX: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    moved: { sound: "click", only: "me", gain: 0.35 },
    turned: { sound: "thud", only: "me", gain: 0.7 },
    repaired: { sound: "blip", gain: 0.25 },
    ownRepair: { field: "repaired", sound: "score", only: "me", pitch: (s, i) => 1 + Math.min(0.6, s.level[i] * 0.05) },
    loaded: { sound: "pop", only: "me", gain: 0.5 },
    beep: "beep", go: "go",
    hurry: { sound: "tick", pitch: (s) => 1 + (150 - s.left) / 150 },
    finished: "fanfare",
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} runs the waterworks!` : info.snapshot?.last >= 0 ? `${info.players[info.snapshot.last]?.name ?? "The leader"} repaired best: ${info.snapshot.total[info.snapshot.last]} points this shift.` : "Even pressure! Shift tied — keep repairing.",
    next: (matchOver) => matchOver ? "Reopen the waterworks" : "Next repair shift",
  },
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores.filter((_, i) => !snap || snap.active[i]));
    return players.map((player, i) => ({
      ...player, score: scores[i], alive: snap ? snap.active[i] : true,
      state: snap && !snap.active[i] ? "closed" : snap?.flush[i] ? "flush" : scores[i] === best && best > 0 ? "lead" : "repair",
      note: !snap ? "ready" : !snap.active[i] ? "closed" : snap.flush[i] ? `+${snap.award[i]} connected` : `panel ${snap.level[i] + 1} · ${bits(snap.wet[i])}/9${best - scores[i] >= 6 ? " · +1 aid" : ""}`,
    }));
  },
  onRound() { fx.floor = false; fx.sparks = []; fx.floats = []; },
  draw,
});
