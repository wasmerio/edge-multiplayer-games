import { defineSnapshot, startGame } from "@engine/engine.js";
import {
  Game, SNAPSHOT, INTENT, ARENA, TARGET, PHASE, RADIUS, MAX_CHARGE, AIM_TICKS, READY_TICKS, launchAt, travelFor, awardsFor,
} from "/game.js";

const NAVY = "#10264b";
const ICE = "#eaf6ff";
const COBALT = "#1646cf";
const LIME = "#e6f56b";
const RED = "#e54d57";
const PALETTE = ["#1646cf", "#007f78", "#7946bf", "#ab6810", "#bd3777", "#007da6", "#536579", "#707b12"];
const FONT = 'Arial, "Helvetica Neue", sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const TAU = Math.PI * 2;
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { floor: false, rings: [], chips: [] };
const bound = (v, a, b) => Math.max(a, Math.min(b, v));

function paintIce(surface, snap) {
  const { w, h } = surface.arena();
  surface.clear("world");
  surface.box("world", { x: 0, y: 0, w, h, colour: ICE });
  for (let y = 48; y < h - 32; y += 16) {
    surface.trail("world", { x: 24, y }, { x: w - 24, y: y - 9 }, { colour: "#dcecf7", width: 1 });
  }
  surface.box("world", { x: 24, y: 32, w: w - 48, h: h - 64, radius: 24, colour: RED, stroke: 3 });
  surface.poly("world", { points: [{ x: 138, y: 34 }, { x: 138, y: h - 34 }], closed: false, colour: "#8cafca", stroke: 3, dash: [12, 10] });
  surface.poly("world", { points: [{ x: 25, y: snap.ty }, { x: w - 25, y: snap.ty }], closed: false, colour: "#8cafca", stroke: 1, dash: [5, 8] });
  for (const [r, colour] of [[100, COBALT], [60, "#ffffff"], [30, COBALT]]) {
    surface.disc("world", { x: snap.tx, y: snap.ty, r, colour });
  }
  surface.disc("world", { x: snap.tx, y: snap.ty, r: 5, colour: LIME });
  for (const [r, label] of [[81, "1"], [45, "2"], [17, "3"]]) {
    surface.text("world", { x: snap.tx, y: snap.ty - r, value: label, size: 17, weight: 700, family: MONO, align: "center", baseline: "middle", colour: r === 45 ? NAVY : ICE });
  }
  const start = launchAt({ w, h });
  surface.trail("world", { x: start.x - 22, y: start.y + 28 }, { x: start.x + 22, y: start.y + 28 }, { colour: NAVY, width: 5 });
  surface.text("world", { x: 36, y: h - 64, value: "POCKET / CURL", size: 17, family: FONT, italic: true, weight: 900, colour: "#6e94b5" });
}

function stone(surface, x, y, seat, colour, mine, ghost = false) {
  const L = "actors";
  const alpha = ghost ? 0.42 : 1;
  surface.ellipse(L, { x: x + 2, y: y + 12, rx: 19, ry: 10, colour: NAVY, alpha: 0.15 * alpha });
  if (mine) {
    surface.disc(L, { x, y, r: RADIUS + 8, colour: "#fff", stroke: 4, alpha });
    surface.disc(L, { x, y, r: RADIUS + 11, colour: NAVY, stroke: 2, alpha });
  }
  surface.disc(L, { x, y, r: RADIUS + 2, colour: NAVY, alpha });
  surface.disc(L, { x, y, r: RADIUS, colour: "#a9bed0", alpha });
  surface.disc(L, { x: x - 1, y: y - 2, r: RADIUS - 3, colour: "#f8fcff", alpha });
  surface.box(L, { x: x - 12, y: y - 12, w: 24, h: 7, radius: 3, colour, alpha });
  surface.text(L, { x, y: y + 5, value: seat + 1, size: 19, weight: 900, family: FONT, align: "center", baseline: "middle", colour: NAVY, alpha });
}

function shotGuide(surface, snap, seat, alpha) {
  const start = launchAt(surface.arena());
  const radians = snap.angle[seat] * Math.PI / 180;
  const charging = snap.turn === seat && snap.charging;
  const distance = travelFor(charging ? snap.charge : 35);
  const end = { x: start.x + Math.cos(radians) * distance, y: start.y + Math.sin(radians) * distance };
  const { w, h } = surface.arena();
  const safe = end.x < w - 40 && end.y > 48 && end.y < h - 48;
  const clipped = { x: bound(end.x, 40, w - 40), y: bound(end.y, 48, h - 48) };
  const colour = safe ? NAVY : RED;
  surface.poly("actors", { points: [start, clipped], closed: false, colour, stroke: 2.5, dash: [5, 9], alpha });
  surface.disc("actors", { ...clipped, r: RADIUS + 3, colour, stroke: 3, alpha });
  surface.trail("actors", { x: clipped.x - 7, y: clipped.y }, { x: clipped.x + 7, y: clipped.y }, { colour, width: 2, alpha });
  if (!safe) surface.trail("actors", { x: clipped.x, y: clipped.y - 7 }, { x: clipped.x, y: clipped.y + 7 }, { colour, width: 2, alpha });
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  const dt = ctx.dt();
  const players = ctx.players();
  if (!fx.floor) { fx.floor = true; paintIce(surface, snap); }
  surface.clear("actors");

  for (const field of ["hit", "sent", "out", "scored"]) {
    for (const e of ctx.events(field)) {
      const colour = field === "out" ? RED : ctx.colourFor(e.player);
      fx.rings.push({ x: e.snapshot.x[e.player], y: e.snapshot.y[e.player], life: 0.5, colour });
      if (!calm) {
        const count = e.player === me ? 12 : 6;
        for (let j = 0; j < count; j++) {
          const a = j * TAU / count;
          fx.chips.push({ x: e.snapshot.x[e.player], y: e.snapshot.y[e.player], vx: Math.cos(a) * 75, vy: Math.sin(a) * 75, life: 0.45, colour });
        }
      }
    }
  }

  const preview = !snap.over && me >= 0 && snap.active[me] && snap.state[me] === 0 ? me : snap.turn;
  if (preview >= 0 && snap.state[preview] === 0 && snap.phase !== PHASE.READY) {
    shotGuide(surface, snap, preview, preview === snap.turn ? 0.8 : 0.35);
  }
  for (let i = 0; i < snap.x.length; i++) {
    if (!snap.active[i]) continue;
    if (snap.state[i] === 1 || (snap.state[i] === 0 && i === snap.turn)) {
      stone(surface, snap.x[i], snap.y[i], i, ctx.colourFor(i), i === me);
      if (i === snap.moving) surface.arc("actors", { x: snap.x[i], y: snap.y[i], r: 23, from: ctx.time() * 4, to: ctx.time() * 4 + Math.PI, colour: ctx.colourFor(i), width: 3 });
    }
    if (snap.state[i] === 2) {
      surface.trail("actors", { x: snap.x[i] - 8, y: snap.y[i] - 8 }, { x: snap.x[i] + 8, y: snap.y[i] + 8 }, { colour: RED, width: 4, alpha: 0.5 });
      surface.trail("actors", { x: snap.x[i] + 8, y: snap.y[i] - 8 }, { x: snap.x[i] - 8, y: snap.y[i] + 8 }, { colour: RED, width: 4, alpha: 0.5 });
    }
  }
  if (preview === me && me >= 0 && me !== snap.turn && snap.state[me] === 0 && snap.phase !== PHASE.READY) {
    const start = launchAt({ w, h });
    stone(surface, start.x, start.y, me, ctx.colourFor(me), true, true);
  }

  const clock = snap.phase === PHASE.AIM ? snap.t / AIM_TICKS : snap.phase === PHASE.READY ? snap.t / READY_TICKS : 0;
  surface.box("actors", { x: 24, y: 10, w: w - 48, h: 10, radius: 5, colour: "#bfd5e7" });
  if (clock > 0) surface.box("actors", { x: 24, y: 10, w: (w - 48) * clock, h: 10, radius: 5, colour: snap.phase === PHASE.AIM && snap.t < 30 ? RED : COBALT });
  if (snap.phase === PHASE.AIM) {
    const colour = ctx.colourFor(snap.turn);
    surface.box("actors", { x: 32, y: h - 23, w: w - 64, h: 13, radius: 6, colour: "#bfd5e7" });
    surface.box("actors", { x: 32, y: h - 23, w: (w - 64) * snap.charge / MAX_CHARGE, h: 13, radius: 6, colour });
    surface.box("actors", { x: 32 + (w - 64) * 35 / MAX_CHARGE, y: h - 26, w: 3, h: 19, colour: NAVY });
    if (me === snap.turn) {
      surface.text("actors", { x: 186, y: 67, value: snap.charging ? "RELEASE" : "YOUR SHOT", size: 27, family: FONT, weight: 900, italic: true, colour: NAVY });
    }
  }
  if (snap.phase === PHASE.READY) {
    surface.text("actors", { x: 170, y: h / 2 - 48, value: "GET SET", size: 26, family: FONT, weight: 900, italic: true, align: "center", colour: NAVY });
    surface.text("actors", { x: 170, y: h / 2 + 25, value: Math.ceil(snap.t / 15), size: 100, family: FONT, weight: 900, italic: true, align: "center", baseline: "middle", colour: COBALT });
  }

  fx.rings = fx.rings.filter((r) => (r.life -= dt) > 0);
  for (const r of fx.rings) surface.disc("actors", { x: r.x, y: r.y, r: RADIUS + 4 + (0.5 - r.life) * 55, colour: r.colour, stroke: 3, alpha: r.life * 1.4 });
  fx.chips = fx.chips.filter((p) => (p.life -= dt) > 0);
  for (const p of fx.chips) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    surface.box("actors", { x: p.x, y: p.y, w: 4, h: 4, colour: p.colour, alpha: p.life * 2 });
  }

  const name = snap.turn >= 0 ? players[snap.turn]?.name || `Player ${snap.turn + 1}` : "";
  if (me < 0) ctx.hud("Rinkside view. You get a stone in the next match.");
  else if (snap.over) ctx.hud(`End scored: +${snap.award[me]}. ${ctx.isHost() ? "Enter opens the next end." : "Waiting for the host."}`);
  else if (snap.phase === PHASE.READY) ctx.hud("One stone each. Land near the button; later shots can knock you away.");
  else if (snap.phase === PHASE.AIM && snap.turn === me) ctx.hud(snap.charging ? `Weight ${Math.round(snap.charge / MAX_CHARGE * 100)}%. Release to deliver; hollow ring predicts your stop.` : "Your shot! Aim left/right. Hold for weight, then release to slide.");
  else if (snap.phase === PHASE.SLIDE) ctx.hud(`${name} delivered. Watch the knock-ons; points count after the final stone.`);
  else if (snap.phase === PHASE.REST) ctx.hud("Let it settle. The next delivery is coming up.");
  else ctx.hud(`${name} is aiming. ${snap.state[me] === 0 ? "You can pre-aim your faint guide with left/right." : "Your stone can still be knocked away."}`);
}

startGame({
  title: "Pocket Curl",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  palette: PALETTE,
  nextKey: "Enter",
  bindings: {
    aim: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0 },
    slide: { keys: { Space: 1 }, buttons: { 0: 1 } },
  },
  audioMap: {
    aimed: { sound: "click", gain: 0.35, only: "me" },
    wound: { sound: "whoosh", gain: 0.45, only: "me", pitch: 0.7 },
    sent: { sound: "whoosh", gain: 0.6, pitch: (snap) => 0.8 + snap.charge / 100 },
    hit: { sound: "thud", gain: 0.45, pitch: 1.4 },
    out: { sound: "buzz", gain: 0.5 },
    missed: { sound: "lose", gain: 0.5, only: "me" },
    mine: { sound: "score", field: "scored", only: "me" },
    theirs: { sound: "blip", field: "scored", only: "others", gain: 0.25 },
    beep: { sound: "beep", gain: 0.4 },
    opened: { sound: "pop", gain: 0.5 },
    finished: { sound: "win", gain: 0.6 },
  },
  scoreboard(players, scores, snap) {
    const live = snap ? awardsFor(snap) : [];
    return players.map((player, i) => ({
      ...player,
      name: `${i + 1}. ${player.name}`,
      score: scores[i],
      alive: snap ? snap.active[i] : true,
      state: snap?.turn === i ? "delivery" : "",
      note: !snap ? "one stone" : !snap.active[i] ? "left rink" : snap.over ? `+${snap.award[i]} this end` : snap.turn === i && snap.phase === PHASE.AIM ? "DELIVER" : snap.state[i] === 0 ? `throw ${snap.rank[i] + 1}` : snap.state[i] === 2 ? "out" : snap.state[i] === 3 ? "missed" : `${live[i]} provisional`,
    }));
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} wins the club cup!`;
      const best = Math.max(0, ...(info.snapshot?.award ?? []));
      if (!best) return "Empty house. Nobody scores this end.";
      const leaders = info.players.filter((_, i) => info.snapshot.award[i] === best).map((p) => p.name);
      return `${leaders.join(" & ")} take ${best}. End scored.`;
    },
    next: (won) => won ? "Play another cup" : "Open next end",
  },
  onRound() { fx.floor = false; fx.rings = []; fx.chips = []; },
  draw,
});
