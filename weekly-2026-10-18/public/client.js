import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, BUILD_TICKS, PERFECT } from "/game.js";

const PALETTE = ["#2769b1", "#117d73", "#946619", "#7655a5", "#a74776", "#17748f", "#985738", "#526984"];
const INK = "#153c59";
const SKY = "#cde9f4";
const PAPER = "#f5fbff";
const STEEL = "#456a80";
const DANGER = "#c13f2c";
const MONO = 'ui-monospace, Consolas, "Liberation Mono", monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { chips: [], shake: 0 };
const TAU = Math.PI * 2;

function brick(s, x, y, width, colour, alpha = 1, tall = 28) {
  if (width <= 0) return;
  s.box("actors", { x, y, w: width, h: tall, colour, alpha });
  s.box("actors", { x, y, w: width, h: tall, colour: INK, stroke: 2, alpha });
  s.box("actors", { x: x + 2, y: y + 2, w: Math.max(0, width - 4), h: 5, colour: PAPER, alpha: alpha * 0.5 });
  s.trail("actors", { x: x + 2, y: y + tall - 2 }, { x: x + width - 2, y: y + tall - 2 }, { colour: PAPER, width: 3, alpha: alpha * 0.8 });
  for (let b = x + 32; b < x + width - 10; b += 38) {
    s.trail("actors", { x: b, y: y + 8 }, { x: b, y: y + tall - 5 }, { colour: INK, width: 1, alpha: 0.3 * alpha });
  }
}

function text(s, x, y, value, size = 24, colour = INK, align = "left") {
  s.text("actors", { x, y, value, size, colour, align, baseline: "middle", weight: 700, family: MONO });
}

function draw(s, snap, ctx) {
  const { w, h } = s.arena();
  const me = ctx.seat();
  const n = snap.bx.length;
  let focus = me;
  if (focus < 0) {
    focus = 0;
    for (let i = 0; i < n; i++) if (snap.active[i] && (!snap.active[focus] || snap.height[i] > snap.height[focus])) focus = i;
  }
  const colour = ctx.colourFor(focus);
  const top = 224;
  const moving = 154;
  const now = ctx.time();
  s.clear("world");
  s.box("world", { x: 0, y: 0, w, h, colour: SKY });
  for (let x = 20; x < w; x += 40) s.trail("world", { x, y: 70 }, { x, y: 382 }, { colour: INK, width: 1, alpha: 0.07 });
  for (let y = 102; y < 382; y += 40) s.trail("world", { x: 20, y }, { x: w - 20, y }, { colour: INK, width: 1, alpha: 0.07 });
  // Cloud contours, kept away from the working brick.
  for (const [x, y, r] of [[78, 311, 25], [108, 307, 36], [145, 319, 23], [500, 115, 22], [530, 109, 30], [563, 119, 22]]) {
    s.disc("world", { x, y, r, colour: PAPER, alpha: 0.6 });
  }
  s.clear("actors");

  for (const field of ["placed", "missed", "bonus"]) {
    for (const e of ctx.events(field)) {
      if (e.player !== focus || calm) continue;
      const isMiss = field === "missed";
      const count = field === "bonus" ? 28 : 10;
      for (let j = 0; j < count; j++) {
        const a = j / count * TAU;
        fx.chips.push({ x: e.snapshot.x0[focus] + e.snapshot.w0[focus] / 2, y: top, vx: Math.cos(a) * 100, vy: Math.sin(a) * 100 - 60, life: 0.7, colour: isMiss ? DANGER : colour });
      }
      if (isMiss) fx.shake = 0.15;
    }
  }
  fx.shake = Math.max(0, fx.shake - ctx.dt());
  s.shake(calm ? 0 : Math.sin(now * 60) * fx.shake * 16, 0);

  // A large clock rule, and the seat being viewed.
  s.box("actors", { x: 20, y: 18, w: w - 116, h: 16, colour: PAPER });
  s.box("actors", { x: 20, y: 18, w: (w - 116) * snap.left / BUILD_TICKS, h: 16, colour: INK });
  text(s, w - 24, 27, `${Math.ceil(snap.left / 30)}s`, 28, INK, "right");
  const name = me < 0 ? `VIEW / ${ctx.players()[focus]?.name ?? "Mason"}` : `${focus + 1} / YOUR TOWER`;
  text(s, 24, 62, name, 23);
  text(s, w - 24, 62, `+${snap.earned[focus]}`, 26, INK, "right");

  // Latest five floors; the camera crops old floors instead of shrinking the working target.
  for (let j = 4; j >= 0; j--) brick(s, snap[`x${j}`][focus], top + j * 29, snap[`w${j}`][focus], colour, 1 - j * 0.13);
  const baseY = top + Math.min(5, snap.height[focus] + 1) * 29;
  s.trail("actors", { x: 48, y: baseY }, { x: w - 48, y: baseY }, { colour: INK, width: 2, alpha: 0.5 });
  // Dimension marks and the local player's triangular marker identify the tower without hue.
  text(s, 32, top + 14, snap.height[focus], 36);
  for (const x of [snap.x0[focus], snap.x0[focus] + snap.w0[focus]]) {
    s.poly("actors", { points: [{ x, y: 124 }, { x, y: top }], colour: INK, stroke: 2, dash: [6, 6], closed: false, alpha: 0.5 });
  }
  const cx = snap.x0[focus] + snap.w0[focus] / 2;
  s.poly("actors", { points: [{ x: cx - 9, y: top - 21 }, { x: cx + 9, y: top - 21 }, { x: cx, y: top - 9 }], colour: INK });
  if (snap.active[focus] && !snap.over) {
    const aligned = Math.abs(snap.bx[focus] - snap.x0[focus]) <= PERFECT;
    brick(s, snap.bx[focus], moving, snap.w0[focus], colour, snap.cd[focus] > 0 ? 0.25 : 1, 32);
    if (aligned && snap.cd[focus] === 0) {
      s.box("actors", { x: snap.bx[focus] - 4, y: moving - 4, w: snap.w0[focus] + 8, h: 40, colour: PAPER, stroke: 4 });
    }
    const arrowX = snap.bx[focus] + snap.w0[focus] / 2;
    text(s, arrowX, moving - 19, snap.dir[focus] > 0 ? "→" : "←", 30, INK, "center");
  }
  if (snap.flash[focus] > 0) {
    const mark = snap.mark[focus];
    const words = ["", "+2 / SET", "+3 / PERFECT", "−2 MAX / REBUILD", "MORTAR SETTING"];
    s.box("actors", { x: 145, y: 91, w: 350, h: 35, colour: PAPER });
    text(s, w / 2, 110, words[mark], 23, mark === 3 ? DANGER : INK, "center");
    if (mark === 2) s.box("actors", { x: snap.x0[focus] - 4, y: top - 3, w: snap.w0[focus] + 8, h: 34, colour: PAPER, stroke: 4, alpha: snap.flash[focus] / 24 });
  }

  // A numbered shared skyline: the tallest towers take the five-point closing bonus.
  s.box("actors", { x: 0, y: 390, w, h: h - 390, colour: PAPER });
  s.trail("actors", { x: 20, y: 390 }, { x: w - 20, y: 390 }, { colour: INK, width: 2 });
  const best = Math.max(1, ...snap.height.filter((_, i) => snap.active[i]));
  const slot = (w - 40) / n;
  for (let i = 0; i < n; i++) {
    const x = 20 + (i + 0.5) * slot;
    const tall = 12 + 50 * snap.height[i] / best;
    const active = snap.active[i];
    const bw = Math.min(42, slot - 18);
    s.box("actors", { x: x - bw / 2, y: 470 - tall, w: bw, h: tall, colour: ctx.colourFor(i), alpha: active ? 1 : 0.25 });
    for (let y = 466; y > 470 - tall; y -= 10) s.trail("actors", { x: x - bw / 2, y }, { x: x + bw / 2, y }, { colour: PAPER, width: 2 });
    if (active && snap.height[i] === best) s.poly("actors", { points: [{ x: x - 6, y: 400 }, { x, y: 394 }, { x: x + 6, y: 400 }, { x, y: 406 }], colour: INK });
    s.disc("actors", { x, y: 492, r: 17, colour: i === me ? INK : SKY });
    if (i === me) s.disc("actors", { x, y: 492, r: 20, colour: INK, stroke: 2 });
    text(s, x, 492, i + 1, 22, i === me ? PAPER : INK, "center");
  }

  fx.chips = fx.chips.filter((p) => (p.life -= ctx.dt()) > 0);
  for (const p of fx.chips) {
    p.vy += 230 * ctx.dt(); p.x += p.vx * ctx.dt(); p.y += p.vy * ctx.dt();
    s.box("actors", { x: p.x, y: p.y, w: 6, h: 6, colour: p.colour, alpha: Math.min(1, p.life * 2) });
  }
  if (snap.ready > 0) {
    s.box("actors", { x: w / 2 - 52, y: 208, w: 104, h: 106, colour: PAPER });
    text(s, w / 2, 263, Math.ceil(snap.ready / 20), 86, INK, "center");
  }

  if (me < 0) ctx.hud("Skyline watch. You get a building permit in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Whistle blown. Enter or the button opens the next build." : "Build closed. Waiting for the foreman to continue.");
  else if (snap.ready) ctx.hud("Get ready: tap when the sliding brick lines up with your tower.");
  else if (snap.cd[me]) ctx.hud(snap.mark[me] === 3 ? "Rebuilding wide. Up to 2 points lost; you are still in." : "Mortar setting. Release the key, then line up the next brick.");
  else ctx.hud(`Tap to place. Perfect = 3 + wider brick. Tallest at the whistle gets +5. First to ${ctx.target()}.`);
}

startGame({
  title: "Cloud Mason",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  palette: PALETTE,
  arena: () => ARENA,
  target: () => TARGET,
  minPlayers: 2,
  nextKey: "Enter",
  bindings: { place: { keys: { Space: 1, ArrowDown: 1, KeyS: 1 }, buttons: { 0: 1 } } },
  audioMap: {
    tapped: { sound: "click", only: "me", gain: 0.4 },
    myBrick: { field: "placed", sound: "thud", only: "me", gain: 0.8 },
    otherBrick: { field: "placed", sound: "thud", only: "others", gain: 0.22 },
    perfect: { sound: "pickup", only: "me", pitch: (snap, i) => 1 + Math.min(0.5, snap.height[i] * 0.025) },
    missed: { sound: "lose", only: "me", gain: 0.7 },
    denied: { sound: "click", only: "me", pitch: 0.65, gain: 0.3 },
    bonus: { sound: "score", only: "me" },
    beep: "beep", go: "go", finished: { sound: "fanfare", gain: 0.65 },
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} owns the skyline!`;
      const snap = info.snapshot;
      if (!snap) return "Build closed.";
      const top = Math.max(0, ...snap.height.filter((_, i) => snap.active[i]));
      const leaders = snap.height.flatMap((height, i) => snap.active[i] && height === top ? [i] : []);
      if (top === 0) return "Fresh foundations. No skyline bonus this time.";
      return leaders.length === 1 ? `${info.players[leaders[0]]?.name ?? "Mason"}: ${top} floors · +5 skyline bonus` : `${top} floors · shared skyline · +5 each`;
    },
    next: (won) => won ? "New building club" : "Open next build",
  },
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores.filter((_, i) => !snap || snap.active[i]));
    return players.map((p, i) => ({
      ...p, name: `${i + 1} · ${p.name}`, score: scores[i], alive: !snap || snap.active[i],
      state: scores[i] === best && best > 0 ? "lead" : "",
      note: !snap ? "permit ready" : !snap.active[i] ? "left site" : `${snap.height[i]} floors / +${snap.earned[i]}`,
    }));
  },
  onRound() { fx.chips = []; fx.shake = 0; },
  draw,
});
