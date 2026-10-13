import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, PHASE, STITCH_TICKS, READY_TICKS, PATTERNS, TARGET, multiplier } from "/game.js";

const INDIGO = "#182c49";
const LINEN = "#fff4d9";
const DIM = "#93a8bd";
const ERROR = "#ff7a70";
const THREADS = ["#efbc63", "#8dd5e8", "#c4ace8"];
const PALETTE = [...THREADS, "#96d6ba", "#f2b9d0", "#a5bdf4", "#fff4d9", "#c9cf85"];
const TYPE = 'ui-rounded, "SF Pro Rounded", "Trebuchet MS", "Segoe UI", sans-serif';
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, fibres: [] };
const bobbin = (i) => ({ x: 34 + (i % 2) * 316, y: 298 + Math.floor(i / 2) * 46 });

function text(surface, value, x, y, size, colour = LINEN, extra = {}) {
  surface.text("actors", { value, x, y, size, colour, family: TYPE, weight: 700, baseline: "middle", ...extra });
}

function stitch(surface, value, x, y, size, colour, alpha = 1) {
  const line = (points) => surface.poly("actors", { points, closed: false, stroke: Math.max(3, size * 0.18), colour, alpha });
  if (value === 1) surface.ellipse("actors", { x, y, rx: size * 0.73, ry: size, stroke: Math.max(3, size * 0.18), colour, alpha });
  else if (value === 2) line([{ x: x - size, y: y + size * 0.7 }, { x, y: y - size }, { x: x + size, y: y + size * 0.7 }]);
  else if (value === 3) {
    line([{ x: x - size * 0.8, y: y - size * 0.8 }, { x: x + size * 0.8, y: y + size * 0.8 }]);
    line([{ x: x + size * 0.8, y: y - size * 0.8 }, { x: x - size * 0.8, y: y + size * 0.8 }]);
  }
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: INDIGO });
    for (let x = 8; x < w; x += 12) surface.trail("world", { x, y: 0 }, { x, y: h }, { colour: "#223956", width: 1 });
    for (let y = 8; y < h; y += 12) surface.trail("world", { x: 0, y }, { x: w, y }, { colour: "#203651", width: 1 });
    for (let x = 16; x < w - 16; x += 16) {
      surface.trail("world", { x, y: 266 }, { x: x + 7, y: 266 }, { colour: DIM, width: 2 });
      surface.trail("world", { x, y: h - 14 }, { x: x + 7, y: h - 14 }, { colour: DIM, width: 2 });
    }
  }
  surface.clear("actors");

  const phaseNames = ["GET READY", "WATCH", "WEAVE", "THE PATTERN", "ROUND WOVEN"];
  text(surface, phaseNames[snap.phase], 22, 29, 24, LINEN, { spacing: 1 });
  text(surface, `${snap.panel + 1}/${PATTERNS}${multiplier(snap.panel) === 2 ? " · DOUBLE" : ""}`, w - 22, 29, 21, THREADS[0], { align: "right", family: MONO });
  surface.box("actors", { x: 22, y: 53, w: w - 44, h: 12, colour: "#314865", radius: 6 });
  const fraction = Math.max(0, (snap.t - (snap.over ? 0 : ctx.tickFraction())) / Math.max(1, snap.tMax));
  surface.box("actors", { x: 22, y: 53, w: (w - 44) * fraction, h: 12, colour: snap.phase === PHASE.WEAVE ? THREADS[1] : THREADS[0], radius: 6 });

  if (snap.phase === PHASE.READY) {
    text(surface, Math.ceil(snap.t / (READY_TICKS / 2)), w / 2, 147, 106, LINEN, { align: "center" });
    text(surface, "LOOK · REMEMBER · REPEAT", w / 2, 226, 22, DIM, { align: "center", family: MONO });
  } else if (snap.phase === PHASE.WATCH) {
    const symbol = snap.pattern[snap.cursor];
    const beat = calm ? 1 : 1 + Math.sin((snap.t % STITCH_TICKS) / STITCH_TICKS * Math.PI) * 0.06;
    surface.disc("actors", { x: w / 2, y: 144, r: 66, colour: "#2b4360" });
    stitch(surface, symbol, w / 2, 144, 46 * beat, THREADS[symbol - 1]);
    for (let j = 0; j < snap.length; j++) {
      const x = w / 2 + (j - (snap.length - 1) / 2) * 36;
      surface.disc("actors", { x, y: 234, r: j === snap.cursor ? 9 : 5, colour: j === snap.cursor ? LINEN : DIM, stroke: j > snap.cursor ? 2 : undefined });
    }
  } else if (snap.phase === PHASE.WEAVE) {
    for (let symbol = 1; symbol <= 3; symbol++) {
      const x = w / 2 + (symbol - 2) * 132;
      const pressed = me >= 0 && snap.mark[me] === symbol && snap.flash[me] > 0;
      surface.box("actors", { x: x - 49, y: 98, w: 98, h: 105, colour: pressed ? "#3a536b" : "#223b57", radius: 24 });
      if (pressed) surface.box("actors", { x: x - 49, y: 98, w: 98, h: 105, colour: snap.fault[me] ? ERROR : LINEN, radius: 24, stroke: 3 });
      stitch(surface, symbol, x, 139, 24, THREADS[symbol - 1]);
      text(surface, ["", "A", "S", "D"][symbol], x, 181, 19, DIM, { align: "center", family: MONO });
    }
    text(surface, me >= 0 && snap.progress[me] === snap.length ? "PATTERN COMPLETE" : "YOUR TURN", w / 2, 234, 23, LINEN, { align: "center", spacing: 2 });
  } else {
    for (let j = 0; j < snap.length; j++) {
      const x = w / 2 + (j - (snap.length - 1) / 2) * 88;
      stitch(surface, snap.pattern[j], x, 150, 26, THREADS[snap.pattern[j] - 1]);
      text(surface, j + 1, x, 207, 20, DIM, { align: "center", family: MONO });
    }
  }

  for (let i = 0; i < snap.active.length; i++) {
    const { x, y } = bobbin(i);
    const colour = ctx.colourFor(i);
    const alpha = snap.active[i] ? 1 : 0.28;
    if (i === me) {
      surface.box("actors", { x: x - 23, y: y - 21, w: 302, h: 42, radius: 16, colour: LINEN, stroke: 2 });
      surface.poly("actors", { points: [{ x: x - 23, y: y - 6 }, { x: x - 16, y }, { x: x - 23, y: y + 6 }], colour: LINEN });
    }
    surface.disc("actors", { x, y, r: 14, colour, alpha });
    text(surface, i + 1, x, y, 18, INDIGO, { align: "center", family: MONO, alpha });
    const error = snap.fault[i] && snap.flash[i] > 0;
    for (let j = 0; j < snap.length; j++) {
      const sx = x + 33 + j * 32;
      if (j > 0) surface.trail("actors", { x: sx - 27, y }, { x: sx - 5, y }, { width: 3, colour: error ? ERROR : "#4d6179", alpha });
      surface.disc("actors", { x: sx, y, r: 7, colour: error ? ERROR : colour, stroke: j < snap.progress[i] ? undefined : 2, alpha });
      if (error) surface.trail("actors", { x: sx - 5, y: y - 6 }, { x: sx + 5, y: y + 6 }, { colour: ERROR, width: 2 });
    }
    if (snap.award[i]) text(surface, `+${snap.award[i]}`, x + 250, y, 23, colour, { align: "center", family: MONO });
    else if (snap.cd[i]) text(surface, "…", x + 250, y, 25, ERROR, { align: "center" });
    else if (!snap.active[i]) text(surface, "—", x + 250, y, 23, DIM, { align: "center" });
  }

  for (const event of ctx.events("completed")) {
    if (calm) continue;
    const { x, y } = bobbin(event.player);
    const count = event.player === me ? 18 : 8;
    for (let j = 0; j < count; j++) {
      const angle = j / count * Math.PI * 2;
      fx.fibres.push({ x: x + 160, y, vx: Math.cos(angle) * 95, vy: Math.sin(angle) * 95 - 25, life: 0.65, colour: ctx.colourFor(event.player) });
    }
  }
  fx.fibres = fx.fibres.filter((p) => (p.life -= ctx.dt()) > 0);
  for (const p of fx.fibres) {
    p.x += p.vx * ctx.dt(); p.y += p.vy * ctx.dt();
    surface.trail("actors", p, { x: p.x + 6, y: p.y - 6 }, { colour: p.colour, width: 3, alpha: Math.min(1, p.life * 2) });
  }

  if (me < 0) ctx.hud("Watching the loom. You get a bobbin in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Round woven. Enter or the button starts the next round." : "Round woven. Waiting for the host to continue.");
  else if (snap.phase === PHASE.READY) ctx.hud("Watch the stitches, then repeat them with A / S / D or the three touch keys.");
  else if (snap.phase === PHASE.WATCH) ctx.hud(`Remember ${snap.length} stitches in order. Wait for WEAVE. ${multiplier(snap.panel) === 2 ? "Double points!" : ""}`);
  else if (snap.phase === PHASE.REVEAL) ctx.hud(snap.award[me] ? `You wove +${snap.award[me]} points. Here is the pattern.` : "No points this time. Read the pattern and try the next one.");
  else if (snap.progress[me] === snap.length) ctx.hud(`Complete! +${snap.award[me]} points. Watch the other threads finish.`);
  else if (snap.cd[me]) ctx.hud("That stitch unravelled. Release the key; start again from the beginning.");
  else ctx.hud(`Weave from memory: ${snap.progress[me]}/${snap.length}. A Loop · S Peak · D Cross. Release between repeats.`);
}

startGame({
  title: "Echo Loom",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  palette: PALETTE,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  nextKey: "Enter",
  bindings: {
    stitch: { keys: { KeyA: 1, ArrowLeft: 1, KeyS: 2, ArrowUp: 2, KeyD: 3, ArrowRight: 3 }, buttons: { 0: 1, 1: 2, 2: 3 }, discrete: false },
  },
  audioMap: {
    tapped: { sound: "click", only: "me", gain: 0.35, pitch: (s, p) => 0.8 + s.mark[p] * 0.2 },
    wrong: { sound: "buzz", only: "me", gain: 0.65 },
    myFinish: { field: "completed", sound: "score", only: "me", pitch: (s) => multiplier(s.panel) === 2 ? 1.3 : 1 },
    otherFinish: { field: "completed", sound: "pickup", only: "others", gain: 0.25 },
    beep: { sound: "beep", gain: 0.5 },
    cue: { sound: "blip", gain: 0.65, pitch: (s) => [1, 0.8, 1.1, 1.45][s.pattern[s.cursor]] || 1 },
    opened: { sound: "whoosh", gain: 0.6 },
    revealed: { sound: "thud", gain: 0.45 },
    finished: { sound: "fanfare", gain: 0.7 },
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} is the master weaver!`;
      const points = info.snapshot?.woven || [];
      const best = Math.max(0, ...points);
      if (!best) return "No finished patterns. Try another weave.";
      const leaders = points.flatMap((p, i) => p === best ? [info.players[i]?.name || "Weaver"] : []);
      return `${leaders.length === 1 ? leaders[0] : "Shared lead"} · ${best} this round. First to ${info.target}.`;
    },
    next: (matchOver) => matchOver ? "Fresh cloth · new match" : "Weave another round",
  },
  scoreboard(players, scores, snap) {
    return players.map((player, i) => ({
      ...player,
      name: `${i + 1} · ${player.name}`,
      score: scores[i],
      alive: snap ? snap.active[i] : true,
      state: snap?.award[i] ? "woven" : "",
      note: !snap ? "ready" : !snap.active[i] ? "left" : snap.award[i] ? `+${snap.award[i]} woven` : snap.phase === PHASE.WEAVE ? `${snap.progress[i]}/${snap.length} stitches` : "remember",
    }));
  },
  onRound() { fx.floor = false; fx.fibres = []; },
  draw,
});
