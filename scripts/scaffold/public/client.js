import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, BOOST_COOLDOWN, PELLETS_PER_ROUND, RADIUS } from "/game.js";

// The game's own player colours, by seat.
const PALETTE = ["#ff6b6b", "#4dd4ac", "#5aa9ff", "#ffd166", "#f78fe6", "#7ee0ff", "#ff9f5a", "#b69cff"];
const INK = "#eceef3";
const GOLD = "#ffd54a";
const DISPLAY = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Roboto Condensed", sans-serif';
const TAU = Math.PI * 2;

// Cosmetic state only. Everything that decides the game is in the snapshot.
const fx = { sparks: [], floor: false, shake: 0 };

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  const time = ctx.time();
  const dt = ctx.dt();

  // The world layer persists, so the floor is painted once per round.
  if (!fx.floor) {
    fx.floor = true;
    surface.box("world", { x: 0, y: 0, w, h, colour: { linear: [0, 0, 0, h], stops: [[0, "#151b2c"], [1, "#05060a"]] } });
    for (let x = 40; x < w; x += 40) surface.trail("world", { x, y: 0 }, { x, y: h }, { colour: "rgba(255, 255, 255, 0.035)", width: 1 });
    for (let y = 40; y < h; y += 40) surface.trail("world", { x: 0, y }, { x: w, y }, { colour: "rgba(255, 255, 255, 0.035)", width: 1 });
  }

  // One-shot effects read events: each entry arrives exactly once, on the host and on guests.
  for (const event of ctx.events("took")) {
    const x = event.snapshot.x[event.player];
    const y = event.snapshot.y[event.player];
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * TAU;
      fx.sparks.push({ x, y, vx: Math.cos(angle) * 170, vy: Math.sin(angle) * 170, life: 0.45, colour: ctx.colourFor(event.player) });
    }
    if (event.player === me) fx.shake = 0.2;
  }

  // Shake moves the layers; nothing is redrawn for it.
  fx.shake = Math.max(0, fx.shake - dt);
  surface.shake(Math.sin(time * 90) * fx.shake * 30, Math.cos(time * 70) * fx.shake * 30);

  // The actors layer is redrawn every frame.
  surface.clear("actors");
  const pulse = 1 + Math.sin(time * 6) * 0.15;
  surface.disc("actors", { x: snap.px, y: snap.py, r: 9 * pulse, colour: GOLD, glow: { colour: GOLD, blur: 18 } });

  snap.x.forEach((x, i) => {
    const y = snap.y[i];
    const colour = ctx.colourFor(i);
    // State that lasts longer than a tick is read from the snapshot, not from an event.
    const sinceBoost = BOOST_COOLDOWN - snap.cd[i];
    if (snap.cd[i] > 0 && sinceBoost < 10) surface.disc("actors", { x, y, r: RADIUS + sinceBoost * 2.5, colour, stroke: 3, alpha: 1 - sinceBoost / 10 });
    surface.disc("actors", { x, y, r: RADIUS, colour });
    if (i === me) {
      // A ring marks the local player: a shape, not only a colour.
      surface.disc("actors", { x, y, r: RADIUS + 5, colour: INK, stroke: 2, alpha: 0.85 });
      if (snap.cd[i] > 0) surface.arc("actors", { x, y, r: RADIUS + 9, from: -TAU / 4, to: -TAU / 4 + TAU * (1 - snap.cd[i] / BOOST_COOLDOWN), colour: GOLD, width: 2 });
    } else {
      // Arena units shrink on a narrow screen; dividing by the scale keeps a label readable there.
      const size = 12 / Math.max(0.4, surface.scale());
      surface.text("actors", { x, y: y + RADIUS + 4, value: ctx.players()[i]?.name ?? "", colour: INK, size, align: "center", baseline: "top", alpha: 0.7 });
    }
  });

  fx.sparks = fx.sparks.filter((spark) => (spark.life -= dt) > 0);
  for (const spark of fx.sparks) {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    surface.disc("actors", { x: spark.x, y: spark.y, r: 3, colour: spark.colour, alpha: spark.life * 2 });
  }

  // Canvas text takes a font stack, a baseline and an outline.
  if (snap.ready > 0) {
    surface.text("actors", { x: w / 2, y: h / 2 - 80, value: `ROUND ${ctx.round()}`, size: 28, weight: 700, align: "center", colour: INK, alpha: 0.8 });
    surface.text("actors", {
      x: w / 2, y: h / 2, value: Math.ceil(snap.ready / 15), size: 110, weight: 900, family: DISPLAY,
      align: "center", baseline: "middle", colour: GOLD, outline: { colour: "#05060a", width: 8 },
    });
  }

  // The status line is page text, so the stylesheet owns its look.
  if (me < 0) ctx.hud("Watching. You get a seat in the next match.");
  else if (snap.over) ctx.hud(ctx.isHost() ? "Enter or the button starts the next round." : "Waiting for the host.");
  else ctx.hud(`${snap.left} to go. First to ${ctx.target()} wins.`);
}

startGame({
  title: {{nameJson}},
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  palette: PALETTE,
  // Space is the boost here, so the host's next-round key moves to Enter.
  nextKey: "Enter",
  bindings: {
    mx: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0 },
    my: { keys: { ArrowUp: -1, ArrowDown: 1, KeyW: -1, KeyS: 1 }, axis: 1 },
    boost: { keys: { Space: 1, ShiftLeft: 1 }, buttons: { 0: 1 } },
  },
  // Snapshot field to sound. `field` lets two entries read one event list.
  audioMap: {
    mine: { sound: "pickup", field: "took", only: "me", pitch: (snap) => 1 + (PELLETS_PER_ROUND - snap.left) * 0.08 },
    theirs: { sound: "blip", field: "took", only: "others", gain: 0.5 },
    boosted: { sound: "whoosh", gain: 0.6, pitch: [0.9, 1.2] },
    beep: "beep",
    go: "go",
  },
  labels: {
    // Nothing returned, no banner: the countdown on the canvas announces the round.
    round: () => null,
    over: (winner, info) => (winner ? `${winner} wins the match` : `Round ${info.round} is done. First to ${info.target}.`),
    next: (matchOver) => (matchOver ? "New match" : "Next round"),
  },
  // Rows follow the snapshot on screen; `snap` is null before the first frame.
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores);
    return players.map((player, i) => ({
      ...player,
      state: best > 0 && scores[i] === best ? "lead" : "",
      note: snap && snap.cd[i] > 0 ? "recharging" : "",
    }));
  },
  onRound() {
    fx.floor = false;
    fx.sparks = [];
    fx.shake = 0;
  },
  draw,
});
