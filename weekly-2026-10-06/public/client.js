import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, PHASE, BID_TICKS, LOTS } from "/game.js";

const PALETTE = ["#edacbd", "#b7cea2", "#a9bff2", "#efb38a", "#cfabe1", "#91cfc8", "#efe1bf", "#d5c16a"];
const INK = "#281b30", VELVET = "#38243f", IVORY = "#f9edcf", BRASS = "#d6b878", MUTED = "#bfaac4";
const SERIF = 'Georgia, "Palatino Linotype", Palatino, "Times New Roman", serif';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, rings: [] };

function placard(i, n) {
  const cols = Math.min(4, n);
  return { x: 24 + (i % cols) * (592 / cols), y: 302 + Math.floor(i / cols) * 119, w: 592 / cols - 12, h: 105 };
}
function text(surface, x, y, value, size, colour = IVORY, extra = {}) {
  surface.text("actors", { x, y, value, size, colour, family: SERIF, align: "center", baseline: "middle", ...extra });
}
function gem(surface, x, y, r, colour) {
  const points = [{ x: x - r, y: y - r * 0.3 }, { x: x - r * 0.52, y: y - r * 0.78 }, { x: x + r * 0.52, y: y - r * 0.78 }, { x: x + r, y: y - r * 0.3 }, { x, y: y + r }];
  surface.poly("actors", { points, colour, stroke: 3 });
  surface.trail("actors", points[0], points[3], { colour, width: 2 });
  for (const dx of [-0.52, 0.52]) {
    surface.poly("actors", { points: [{ x: x + r * dx, y: y - r * 0.78 }, { x: x + r * dx * 0.75, y: y - r * 0.3 }, points[4]], closed: false, colour, stroke: 2 });
  }
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat(), n = snap.bid.length;
  const reveal = snap.phase >= PHASE.REVEAL;
  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: INK });
    surface.box("world", { x: 10, y: 10, w: w - 20, h: h - 20, colour: BRASS, stroke: 1 });
    surface.box("world", { x: 15, y: 15, w: w - 30, h: h - 30, colour: BRASS, stroke: 1, alpha: 0.4 });
    for (const x of [24, w - 24]) for (const y of [24, h - 24]) {
      surface.box("world", { x: x - 4, y: y - 4, w: 8, h: 8, rotate: Math.PI / 4, colour: BRASS });
    }
  }
  for (const field of ["sealed", "sold"]) for (const event of ctx.events(field)) {
    fx.rings.push({ seat: event.player, life: 0.65, won: field === "sold" });
  }
  surface.clear("actors");
  for (let j = 0; j < LOTS; j++) {
    const x = 180 + j * 56;
    surface.disc("actors", { x, y: 44, r: 18, colour: j === snap.lot ? BRASS : VELVET });
    text(surface, x, 44, snap.values[j], 23, j === snap.lot ? INK : MUTED);
    if (j < snap.lot) surface.trail("actors", { x: x - 12, y: 44 }, { x: x + 12, y: 44 }, { colour: MUTED, width: 2 });
  }
  gem(surface, 188, 157, 70, BRASS);
  surface.ellipse("actors", { x: 188, y: 241, rx: 72, ry: 6, colour: BRASS, alpha: 0.2 });
  text(surface, 430, 141, snap.values[snap.lot], 112, IVORY);
  text(surface, 430, 216, "POINTS", 24, BRASS, { spacing: 3 });
  const fraction = snap.phase === PHASE.BID ? Math.max(0, snap.t - ctx.tickFraction()) / BID_TICKS : 0;
  surface.box("actors", { x: 35, y: 272, w: 506, h: 10, colour: VELVET });
  surface.box("actors", { x: 35, y: 272, w: 506 * fraction, h: 10, colour: BRASS });
  text(surface, 580, 276, snap.phase === PHASE.BID ? Math.ceil(snap.t / 30) : "—", 34, BRASS);
  const counts = Array(10).fill(0);
  if (reveal) snap.bid.forEach((b, i) => { if (snap.locked[i] && !snap.gone[i]) counts[b]++; });
  snap.bid.forEach((bid, i) => {
    const p = placard(i, n), cx = p.x + p.w / 2;
    const colour = ctx.colourFor(i);
    const won = reveal && snap.last === i;
    surface.box("actors", { ...p, colour: won ? "#514035" : VELVET });
    surface.box("actors", { x: p.x, y: p.y, w: 5, h: p.h, colour });
    text(surface, p.x + 22, p.y + 21, i + 1, 23, colour);
    if (i === me) {
      surface.box("actors", { ...p, colour: IVORY, stroke: 3 });
      surface.box("actors", { x: p.x + 5, y: p.y + 5, w: p.w - 10, h: p.h - 10, colour: IVORY, stroke: 1 });
    }
    const visible = i === me || reveal;
    if (snap.gone[i]) text(surface, cx, p.y + 65, "—", 42, MUTED);
    else if (visible) {
      const valid = !reveal || snap.locked[i];
      text(surface, cx, p.y + 61, valid ? bid : "—", 48, won ? BRASS : IVORY);
      if (reveal && valid && bid > 0 && counts[bid] > 1) {
        surface.trail("actors", { x: cx - 22, y: p.y + 80 }, { x: cx + 22, y: p.y + 41 }, { colour: MUTED, width: 4 });
      }
    } else {
      surface.box("actors", { x: cx - 30, y: p.y + 42, w: 60, h: 40, colour: MUTED, stroke: 2 });
      surface.poly("actors", { points: [{ x: cx - 30, y: p.y + 42 }, { x: cx, y: p.y + 64 }, { x: cx + 30, y: p.y + 42 }], closed: false, colour: MUTED, stroke: 2 });
    }
    if (snap.locked[i] && !snap.gone[i]) {
      surface.disc("actors", { x: p.x + p.w - 21, y: p.y + 21, r: 8, colour });
      surface.trail("actors", { x: p.x + p.w - 25, y: p.y + 21 }, { x: p.x + p.w - 18, y: p.y + 21 }, { colour: INK, width: 2 });
    }
    if (won) surface.poly("actors", { points: [{ x: cx - 9, y: p.y + 90 }, { x: cx, y: p.y + 98 }, { x: cx + 17, y: p.y + 83 }], closed: false, colour: BRASS, stroke: 3 });
  });
  fx.rings = fx.rings.filter((ring) => (ring.life -= ctx.dt()) > 0);
  if (!calm) for (const ring of fx.rings) {
    const p = placard(ring.seat, n);
    surface.disc("actors", { x: p.x + p.w / 2, y: p.y + 56, r: 25 + (0.65 - ring.life) * 70, colour: ring.won ? BRASS : ctx.colourFor(ring.seat), stroke: ring.seat === me ? 4 : 2, alpha: ring.life / 0.65 });
  }
  if (snap.ready > 0) {
    surface.box("actors", { x: 85, y: 83, w: 470, h: 161, colour: INK });
    text(surface, 320, 116, "TAKE YOUR SEAT", 27, BRASS, { spacing: 2 });
    text(surface, 320, 188, Math.ceil(snap.ready / 30), 86);
  }
  const lot = `Lot ${snap.lot + 1}/6`;
  if (me < 0) ctx.hud(`${lot}. Watching the auction; you get a seat in the next match.`);
  else if (snap.over) ctx.hud(ctx.isHost() ? "Catalogue closed. Enter or the button opens the next one." : "Catalogue closed. Your host will open the next one.");
  else if (snap.ready) ctx.hud(`You are bidder ${me + 1}. ${snap.wallet[me]} coins for six lots. Highest unique sealed bid wins.`);
  else if (reveal) {
    ctx.hud(snap.last < 0 ? `${lot}: unsold. No unique sealed offer. Keep your coins.` : `${ctx.players()[snap.last]?.name ?? "A bidder"} pays ${snap.bid[snap.last]} coins for ${snap.values[snap.lot]} points. Crossed bids cancelled.`);
  } else if (snap.locked[me]) ctx.hud(`${lot} · Sealed ${snap.bid[me] || "PASS"}. ${snap.wallet[me]} coins in your purse. Waiting for the bell.`);
  else ctx.hud(`${lot} · Offer ${snap.bid[me]} / purse ${snap.wallet[me]}. Adjust, then SEAL before the bell. Zero passes.`);
}

startGame({
  title: "Velvet Bid",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  palette: PALETTE,
  nextKey: "Enter",
  bindings: {
    adjust: { keys: { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }, axis: 0 },
    seal: { keys: { Space: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    adjusted: { sound: "click", only: "me", gain: 0.55 },
    sealMine: { field: "sealed", sound: "pop", only: "me", pitch: 0.7 },
    sealOthers: { field: "sealed", sound: "click", only: "others", gain: 0.3 },
    soldMine: { field: "sold", sound: "score", only: "me", pitch: (s) => 0.9 + s.values[s.lot] * 0.06 },
    soldOthers: { field: "sold", sound: "blip", only: "others", gain: 0.45 },
    beep: { sound: "beep", gain: 0.4, pitch: 0.7 },
    go: { sound: "start", gain: 0.5 },
    revealed: { sound: "thud", gain: 0.7 },
    ended: { sound: "win", gain: 0.7, pitch: 0.8 },
  },
  labels: {
    round: () => null,
    over: (winner, info) => winner ? `${winner} takes the collection.` : `Catalogue closed. First to ${info.target} points with a clear lead.`,
    next: (matchOver) => matchOver ? "A new collection" : "Open next catalogue",
  },
  scoreboard(players, scores, snap) {
    return players.map((player, i) => ({
      ...player, name: `${i + 1}. ${player.name}`, score: scores[i],
      alive: snap ? !snap.gone[i] : true,
      state: snap?.last === i ? "sold" : "",
      note: snap ? snap.gone[i] ? "departed" : `${snap.wallet[i]} coins · ${snap.locked[i] ? "sealed" : "open"}` : "bidder",
    }));
  },
  onRound() { fx.floor = false; fx.rings = []; },
  draw,
});
