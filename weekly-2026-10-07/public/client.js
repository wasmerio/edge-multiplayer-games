import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, PHASE, READY_TICKS, BID_TICKS, REVEAL_TICKS, LOTS } from "/game.js";

const VELVET = "#281b32";
const PANEL = "#36243f";
const IVORY = "#fff3dc";
const LILAC = "#cbb5d2";
const BRASS = "#dfbd78";
const CANCEL = "#ff827b";
const PALETTE = ["#e3aceb", "#b4d599", "#9dbfec", "#eed091", "#d5a6ba", "#95d4c5", "#efb599", "#eee8e0"];
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const TAU = Math.PI * 2;
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { petals: [], rings: [] };
const exposed = (s) => s.phase === PHASE.REVEAL || s.phase === PHASE.DONE;
const purseShown = (s, i, me) => s.purse[i] + (!exposed(s) && i !== me && s.locked[i] ? s.offer[i] : 0);

function position(i, n) {
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  return { x: (i % cols + 0.5) * ARENA.w / cols, y: rows === 1 ? 370 : 304 + Math.floor(i / cols) * 100 };
}

function label(surface, x, y, value, size = 24, colour = IVORY, extras = {}) {
  surface.text("actors", { x, y, value, size, colour, family: SERIF, align: "center", baseline: "middle", ...extras });
}

function flower(surface, x, y, radius, colour, count = 8) {
  for (let i = 0; i < count; i++) {
    const a = i / count * TAU;
    const px = x + Math.cos(a) * radius * 0.51;
    const py = y + Math.sin(a) * radius * 0.51;
    surface.ellipse("actors", { x: px, y: py, rx: radius * 0.27, ry: radius * 0.48, rotate: a + Math.PI / 2, colour, alpha: 0.2 });
    surface.ellipse("actors", { x: px, y: py, rx: radius * 0.27, ry: radius * 0.48, rotate: a + Math.PI / 2, colour, stroke: 1.5 });
  }
  surface.disc("actors", { x, y, r: radius * 0.3, colour: VELVET });
  surface.disc("actors", { x, y, r: radius * 0.3, colour, stroke: 1.5 });
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  const n = snap.active.length;
  const reveal = exposed(snap);
  const dt = ctx.dt();
  const clock = ctx.time();
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w, h, colour: VELVET });
  surface.box("world", { x: 12, y: 12, w: w - 24, h: h - 24, colour: "#634a6c", stroke: 1 });
  for (const x of [22, w - 22]) {
    surface.trail("world", { x, y: 22 }, { x, y: 54 }, { colour: BRASS, width: 2 });
    surface.trail("world", { x: x - 5, y: 22 }, { x: x + 5, y: 22 }, { colour: BRASS, width: 2 });
  }
  surface.clear("actors");
  label(surface, 320, 27, `LOT ${String(snap.lot + 1).padStart(2, "0")} / ${LOTS}`, 22, LILAC, { family: MONO });
  const max = snap.phase === PHASE.READY ? READY_TICKS : snap.phase === PHASE.BID ? BID_TICKS : REVEAL_TICKS;
  const fraction = snap.over ? 0 : Math.max(0, snap.t - ctx.tickFraction()) / max;
  surface.box("actors", { x: 42, y: 50, w: w - 84, h: 9, colour: PANEL });
  surface.box("actors", { x: 42, y: 50, w: (w - 84) * fraction, h: 9, colour: snap.phase === PHASE.BID && snap.t < 30 ? CANCEL : BRASS });

  // The central bloom is the lot; the large middle numeral is its value.
  const tint = snap.last >= 0 && reveal ? ctx.colourFor(snap.last) : BRASS;
  flower(surface, 320, 151, 83, tint, snap.value + 3);
  label(surface, 320, 152, snap.phase === PHASE.READY ? Math.ceil(snap.t / 20) : snap.value, 48, IVORY);
  surface.trail("actors", { x: 320, y: 235 }, { x: 320, y: 264 }, { colour: BRASS, width: 2 });
  surface.ellipse("actors", { x: 306, y: 248, rx: 15, ry: 5, rotate: 0.45, colour: BRASS, stroke: 1.5 });
  surface.ellipse("actors", { x: 334, y: 254, rx: 15, ry: 5, rotate: -0.45, colour: BRASS, stroke: 1.5 });

  label(surface, 112, 94, me < 0 ? "GALLERY" : "YOUR BID", 22, LILAC);
  label(surface, 112, 151, me < 0 ? "—" : snap.locked[me] ? snap.offer[me] : snap.choice[me], 66, IVORY, { family: MONO });
  label(surface, 112, 211, me < 0 ? "Watch & learn" : `${snap.purse[me]} coins left`, 24, BRASS);
  label(surface, 528, 94, "NEXT LOT", 22, LILAC);
  if (snap.preview) {
    flower(surface, 528, 151, 40, LILAC, 6);
    label(surface, 528, 151, snap.preview, 30, IVORY);
    label(surface, 528, 211, "petals", 24, BRASS);
  } else label(surface, 528, 155, "Final bloom", 24, IVORY);

  for (let i = 0; i < n; i++) {
    const { x, y } = position(i, n);
    const mine = i === me;
    const colour = ctx.colourFor(i);
    const cardW = Math.min(132, w / Math.min(n, 4) - 26);
    surface.box("actors", { x: x - cardW / 2, y: y - 32, w: cardW, h: 72, radius: 4, colour: PANEL, alpha: snap.active[i] ? 1 : 0.4 });
    surface.box("actors", { x: x - cardW / 2, y: y - 32, w: cardW, h: 72, radius: 4, colour: mine ? IVORY : colour, stroke: mine ? 3 : 1 });
    if (!reveal && !mine && snap.active[i]) {
      surface.poly("actors", { points: [{ x: x - cardW / 2, y: y - 30 }, { x, y: y + 1 }, { x: x + cardW / 2, y: y - 30 }], colour, stroke: 1, closed: false });
      if (snap.locked[i]) {
        surface.disc("actors", { x, y: y + 4, r: 16, colour });
        surface.poly("actors", { points: [{ x: x - 7, y: y + 4 }, { x: x - 1, y: y + 10 }, { x: x + 8, y: y - 4 }], colour: VELVET, stroke: 3, closed: false });
      } else label(surface, x, y + 8, "···", 30, colour);
    } else {
      const value = !snap.active[i] ? "×" : reveal && !snap.locked[i] ? "—" : snap.locked[i] ? snap.offer[i] : snap.choice[i];
      label(surface, x, y + 1, value, 36, colour, { family: MONO });
    }
    // Numbered seals match the ledger; a diamond marks the local bidder.
    surface.disc("actors", { x: x - cardW / 2 + 12, y: y - 25, r: 15, colour });
    label(surface, x - cardW / 2 + 12, y - 25, i + 1, 23, VELVET, { family: MONO, weight: 700 });
    if (mine) surface.poly("actors", { points: [{ x: x + cardW / 2 - 14, y: y - 22 }, { x: x + cardW / 2 - 7, y: y - 15 }, { x: x + cardW / 2 - 14, y: y - 8 }, { x: x + cardW / 2 - 21, y: y - 15 }], colour: IVORY });
    if (reveal && snap.result[i] === 2) {
      surface.trail("actors", { x: x - 18, y: y - 15 }, { x: x + 18, y: y + 17 }, { colour: CANCEL, width: 3 });
      surface.trail("actors", { x: x + 18, y: y - 15 }, { x: x - 18, y: y + 17 }, { colour: CANCEL, width: 3 });
    }
    if (reveal && snap.result[i] === 3) {
      surface.arc("actors", { x, y: y + 1, r: 29, from: 0, to: TAU, colour: BRASS, width: 2, dash: [4, 4] });
    }
    label(surface, x, y + 52, !snap.active[i] ? "away" : reveal ? ["pass", "outbid", "tied", `+${snap.value} petals`][snap.result[i]] : mine && snap.locked[i] ? "sealed" : `${purseShown(snap, i, me)} coins`, 22, LILAC);
  }

  for (const field of ["changed", "sealed", "awarded"]) {
    for (const e of ctx.events(field)) {
      const pos = position(e.player, n);
      if (field !== "changed" || e.player === me) fx.rings.push({ ...pos, life: 0.35, colour: field === "awarded" ? BRASS : ctx.colourFor(e.player) });
      if (field === "awarded" && !calm) {
        for (let i = 0; i < (e.player === me ? 20 : 10); i++) {
          const a = i * 2.4;
          fx.petals.push({ x: 320, y: 151, vx: Math.cos(a) * (60 + i * 6), vy: Math.sin(a) * 90 - 60, life: 0.8, colour: ctx.colourFor(e.player) });
        }
      }
    }
  }
  fx.rings = fx.rings.filter((r) => (r.life -= dt) > 0);
  if (!calm) for (const r of fx.rings) surface.disc("actors", { x: r.x, y: r.y, r: 26 + (0.35 - r.life) * 65, colour: r.colour, stroke: 2, alpha: r.life / 0.35 });
  fx.petals = fx.petals.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.petals) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 110 * dt;
    surface.ellipse("actors", { x: p.x, y: p.y, rx: 4, ry: 8, rotate: clock, colour: p.colour, alpha: Math.min(1, p.life * 2) });
  }

  if (me < 0) ctx.hud("Gallery seat. Watch the sealed bids; join the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Catalogue closed. Enter or the button opens the next one." : "Catalogue closed. Waiting for the auction host.");
  else if (snap.phase === PHASE.READY) ctx.hud("Eight blooms. Choose with ← / →, then seal with Space. Every bid is spent.");
  else if (reveal) ctx.hud(snap.last < 0 ? "No unique bid. This bloom stays in the house." : `${ctx.players()[snap.last]?.name ?? "A bidder"} wins ${snap.value} petals with ${snap.offer[snap.last]} coins.`);
  else if (snap.locked[me]) ctx.hud(`${snap.offer[me] ? `${snap.offer[me]} coins sealed` : "Passing this lot"}. Bids open in ${Math.ceil(snap.t / 30)}s. Matching bids cancel.`);
  else ctx.hud(`${snap.value} petals · bid ${snap.choice[me]} · ${snap.purse[me]} coins. ${snap.choice[me] ? "Seal to enter." : "Raise a bid, or seal zero to pass."}`);
}

startGame({
  title: "Velvet Auction",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  palette: PALETTE,
  nextKey: "Enter",
  bindings: {
    bid: { keys: { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }, axis: 0 },
    seal: { keys: { Space: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    changed: { sound: "click", only: "me", gain: 0.7 },
    sealed: { sound: "thud", only: "me", pitch: 1.3 },
    theirSeal: { field: "sealed", sound: "click", only: "others", gain: 0.25 },
    awarded: { sound: "score", only: "me", pitch: (s) => 0.9 + s.value * 0.08 },
    theirAward: { field: "awarded", sound: "pickup", only: "others", gain: 0.5 },
    cancelled: { sound: "buzz", only: "me", gain: 0.45 },
    beep: { sound: "beep", gain: 0.4, pitch: 0.8 },
    opened: { sound: "pop", gain: 0.6 },
    revealed: { sound: "whoosh", gain: 0.45 },
    finished: "fanfare",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} takes the collection.`;
      const best = Math.max(0, ...(info.snapshot?.petals ?? []));
      const seats = (info.snapshot?.petals ?? []).flatMap((p, i) => p === best ? [i] : []);
      return best === 0 ? "No blooms sold. Try a different bid." : seats.length === 1 ? `${info.players[seats[0]]?.name} collected ${best} petals. First to ${info.target}.` : `Shared honours: ${best} petals. First to ${info.target}.`;
    },
    next: (over) => over ? "Open a new auction" : "Next catalogue",
  },
  scoreboard(players, scores, snap) {
    return players.map((p, i) => ({
      ...p,
      name: `${i + 1}. ${p.name}`,
      alive: snap ? snap.active[i] : true,
      state: snap?.last === i && exposed(snap) ? "bloom" : "",
      note: !snap ? "bidder" : !snap.active[i] ? "away" : exposed(snap) ? `${snap.purse[i]} coins · ${["pass", "outbid", "tied", "won"][snap.result[i]]}` : snap.locked[i] ? "sealed" : "choosing",
    }));
  },
  onRound() { fx.petals = []; fx.rings = []; },
  draw,
});
