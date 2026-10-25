import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, CIRCUITS, LIVE_TICKS, ports } from "/game.js";

const PALETTE = ["#b9f3cf", "#f5b782", "#cbb3ef", "#9dd4ee", "#ece593", "#f0b3c6", "#f2f7e9", "#72ccaf"];
const INK = "#102e27", PANEL = "#1c4035", MINT = "#b9f3cf", COPPER = "#d49562", CHALK = "#f2f7e9";
const FONT = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { sparks: [], floor: false };
const centre = (tile) => ({ x: 144 + (tile % 3) * 96, y: 128 + Math.floor(tile / 3) * 96 });
function viewing(snap, me) {
  if (me >= 0) return me;
  let best = 0;
  for (let i = 0; i < snap.board.length; i++) if (snap.active[i] && (!snap.active[best] || snap.earned[i] > snap.earned[best])) best = i;
  return best;
}
function line(s, a, b, colour, width) { s.trail("actors", a, b, { colour, width }); }
function text(s, x, y, value, size, colour = CHALK, align = "left") {
  s.text("actors", { x, y, value, size, colour, align, baseline: "middle", family: FONT, weight: 700 });
}
function draw(surface, snap, ctx) {
  const me = ctx.seat(), seat = viewing(snap, me), stage = Math.min(CIRCUITS - 1, snap.stage[seat]);
  const dt = ctx.dt(), done = snap.stage[seat] === CIRCUITS;
  if (!fx.floor) {
    fx.floor = true;
    surface.clear("world");
    surface.box("world", { x: 0, y: 0, w: 480, h: 480, colour: INK });
    for (let x = 16; x < 480; x += 16) for (let y = 16; y < 480; y += 16) {
      surface.disc("world", { x, y, r: 0.8, colour: "#2c4b40" });
    }
    for (const [x, y] of [[14, 14], [466, 14], [14, 466], [466, 466]]) {
      surface.disc("world", { x, y, r: 4, colour: COPPER });
      surface.trail("world", { x: x - 2, y: y - 2 }, { x: x + 2, y: y + 2 }, { colour: INK, width: 2 });
    }
  }
  surface.clear("actors");
  text(surface, 30, 35, `${String(seat + 1).padStart(2, "0")} / ${stage + 1} OF 4`, 22, ctx.colourFor(seat));
  const seconds = Math.ceil(snap.left / 30);
  text(surface, 446, 35, snap.ready ? "INSPECT" : `${seconds}s`, 28, snap.left < 300 ? "#f1947e" : CHALK, "right");
  surface.box("actors", { x: 30, y: 58, w: 420, h: 8, colour: "#385449" });
  surface.box("actors", { x: 30, y: 58, w: 420 * snap.left / LIVE_TICKS, h: 8, colour: snap.left < 300 ? "#bd4f38" : MINT });

  for (let tile = 0; tile < 9; tile++) {
    const { x, y } = centre(tile), selected = !done && snap.cursor[seat] === tile;
    const powered = !!(snap.power[seat] & (1 << tile));
    const colour = powered ? MINT : COPPER;
    surface.box("actors", { x: x - 45, y: y - 45, w: 90, h: 90, radius: 6, colour: powered ? "#285140" : PANEL });
    surface.box("actors", { x: x - 45, y: y - 45, w: 90, h: 90, radius: 6, colour: "#41614f", stroke: 1 });
    const mask = ports(snap.types[stage], snap.board[seat], tile);
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      const end = { x: x + [0, 48, 0, -48][d], y: y + [-48, 0, 48, 0][d] };
      line(surface, { x, y }, end, INK, 21);
      line(surface, { x, y }, end, colour, 13);
      if (powered) line(surface, { x, y }, end, CHALK, 3);
      surface.disc("actors", { x: x + (end.x - x) * 0.7, y: y + (end.y - y) * 0.7, r: 3, colour: INK });
    }
    surface.disc("actors", { x, y, r: 11, colour });
    surface.disc("actors", { x, y, r: 4, colour: INK });
    text(surface, x - 33, y - 31, tile + 1, 13, "#c1cdbb");
    if (selected) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const corner = { x: x + sx * 41, y: y + sy * 41 };
        line(surface, { x: corner.x - sx * 15, y: corner.y }, corner, CHALK, 4);
        line(surface, corner, { x: corner.x, y: corner.y - sy * 15 }, CHALK, 4);
      }
    }
    if (snap.flash[seat]) surface.box("actors", { x: x - 45, y: y - 45, w: 90, h: 90, radius: 6, colour: MINT, stroke: 3, alpha: 0.8 });
  }
  line(surface, { x: 51, y: 128 }, { x: 96, y: 128 }, MINT, 12);
  surface.poly("actors", { points: [{ x: 30, y: 110 }, { x: 57, y: 128 }, { x: 30, y: 146 }], colour: MINT });
  const lit = snap.flash[seat] > 0 || done;
  line(surface, { x: 384, y: 320 }, { x: 427, y: 320 }, lit ? MINT : COPPER, 12);
  surface.box("actors", { x: 418, y: 300, w: 32, h: 40, radius: 4, colour: lit ? MINT : INK, stroke: lit ? undefined : 4 });
  if (!lit) surface.box("actors", { x: 418, y: 300, w: 32, h: 40, radius: 4, colour: COPPER, stroke: 3 });
  if (lit) {
    line(surface, { x: 425, y: 320 }, { x: 432, y: 327 }, INK, 4);
    line(surface, { x: 432, y: 327 }, { x: 443, y: 311 }, INK, 4);
  }

  // Numbered bench meters keep every rival visible without shrinking the local puzzle.
  const columns = Math.min(4, snap.board.length), width = 420 / columns;
  snap.stage.forEach((c, i) => {
    const x = 30 + (i % columns) * width, y = 406 + Math.floor(i / columns) * 36;
    const complete = Math.min(4, c + (snap.flash[i] > 0 ? 1 : 0));
    text(surface, x + 7, y, i + 1, 18, ctx.colourFor(i));
    if (i === me) surface.disc("actors", { x: x + 7, y, r: 14, colour: CHALK, stroke: 2 });
    for (let k = 0; k < 4; k++) surface.box("actors", {
      x: x + 29 + k * ((width - 38) / 4), y: y - 8, w: Math.max(9, (width - 46) / 4), h: 16,
      colour: snap.active[i] && k < complete ? ctx.colourFor(i) : "#3b574b", radius: 2,
    });
    if (!snap.active[i]) line(surface, { x, y }, { x: x + width - 8, y }, CHALK, 2);
  });

  for (const event of ctx.events("turned")) {
    if (event.player !== seat || calm) continue;
    const at = centre(event.snapshot.cursor[seat]);
    for (let j = 0; j < 4; j++) fx.sparks.push({ ...at, a: j * Math.PI / 2 + 0.4, life: 0.22, max: 0.22, big: false });
  }
  for (const event of ctx.events("repaired")) {
    if (event.player !== seat || calm) continue;
    for (let j = 0; j < 20; j++) fx.sparks.push({ x: 434, y: 320, a: j * Math.PI / 10, life: 0.65, max: 0.65, big: true });
  }
  fx.sparks = fx.sparks.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.sparks) {
    const distance = (p.max - p.life) * (p.big ? 100 : 80);
    surface.disc("actors", { x: p.x + Math.cos(p.a) * distance, y: p.y + Math.sin(p.a) * distance, r: p.big ? 3 : 2, colour: p.big ? MINT : CHALK, alpha: p.life / p.max });
  }
  if (snap.ready) {
    surface.box("actors", { x: 174, y: 184, w: 132, h: 80, radius: 8, colour: INK, alpha: 0.92 });
    text(surface, 240, 225, Math.ceil(snap.ready / 30), 64, MINT, "center");
  }
  if (done && !snap.over) {
    surface.box("actors", { x: 105, y: 194, w: 270, h: 60, colour: MINT, radius: 4 });
    text(surface, 240, 225, "ALL TESTS PASS", 27, INK, "center");
  }
  if (me < 0) ctx.hud(`Watching ${ctx.players()[seat]?.name ?? "bench 1"}. Your bench opens next match.`);
  else if (snap.over) ctx.hud(ctx.isHost() ? `+${snap.earned[me]} this shift. Enter opens the next work order.` : `+${snap.earned[me]} this shift. Waiting for the supervisor.`);
  else if (snap.ready) ctx.hud("Inspect the tracks. Connect the triangle to the square lamp.");
  else if (done) ctx.hud("Four circuits repaired. Watch the other benches finish.");
  else if (snap.flash[me]) ctx.hud("Connection tested! Loading your next circuit…");
  else ctx.hud(`Circuit ${stage + 1}/4 · ${stage >= 2 ? "10" : "5"} points. Select a tile; rotate to carry power to the lamp.`);
}

startGame({
  title: "Copper Circuit", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: () => ARENA, target: () => TARGET, minPlayers: 2, nextKey: "Enter", palette: PALETTE,
  bindings: {
    select: { keys: { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }, axis: 0 },
    rotate: { keys: { Space: 1, KeyR: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    moved: { sound: "click", only: "me", gain: 0.4 },
    turned: { sound: "thud", only: "me", gain: 0.65, pitch: 1.6 },
    repairMe: { sound: "powerup", field: "repaired", only: "me", pitch: (snap, i) => 1 + snap.stage[i] * 0.12 },
    repairThem: { sound: "blip", field: "repaired", only: "others", gain: 0.3 },
    beep: "beep", go: "go", ended: { sound: "win", gain: 0.7 },
  },
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores);
    return players.map((p, i) => ({ ...p, score: scores[i], name: `${i + 1}. ${p.name}`,
      alive: snap ? snap.active[i] : true, state: scores[i] === best && best > 0 ? "lead" : "",
      note: !snap ? "bench ready" : !snap.active[i] ? "disconnected" : `${Math.min(4, snap.stage[i] + (snap.flash[i] ? 1 : 0))}/4 · +${snap.earned[i]}`,
    }));
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} earns the master licence!` : `Shift tested. Best repair yield: ${Math.max(0, ...(info.snapshot?.earned ?? []))}. First to ${info.target} wins.`,
    next: (matchOver) => matchOver ? "Open a new workshop" : "Issue next work order",
  },
  onRound() { fx.sparks = []; fx.floor = false; },
  draw,
});
