import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, TICK_HZ, GATES, REEFS, GATE_RADIUS, LAP_GATES } from "/game.js";

const schema = defineSnapshot(SNAPSHOT);
const LAP = GATES.length;
const BOAT = [[15, 0], [-10, -8], [-6, 0], [-10, 8]];
const ARROW = [[[-22, 0], [22, 0], [12, -8]], [[22, 0], [12, 8]]];
const turned = (shape, angle, ox, oy) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return shape.map(([x, y]) => ({ x: ox + x * cos - y * sin, y: oy + x * sin + y * cos }));
};

function drawCourse(surface, snap, own) {
  const { w, h } = surface.arena();
  surface.box("world", { x: 0, y: 0, w, h, colour: "#0e2f42" });
  for (let y = 35; y < h; y += 38) {
    for (let x = 20; x < w; x += 55) {
      surface.poly("world", { points: [{ x, y }, { x: x + 10.5, y: y + 2.5 }, { x: x + 22, y }], colour: "#286074", stroke: 1, closed: false });
    }
  }
  surface.box("world", { x: w * 0.015, y: h * 0.02, w: w * 0.97, h: h * 0.96, colour: "#d0b67b", stroke: 6 });
  surface.poly("world", { points: GATES.map(([x, y]) => ({ x: x * w, y: y * h })), colour: "#608d9d", stroke: 2, dash: [4, 12] });
  for (const [x, y, r] of REEFS) {
    surface.ellipse("world", { x: x * w, y: y * h, rx: r * w, ry: r * h, colour: "#27434b" });
    surface.ellipse("world", { x: x * w, y: y * h, rx: r * w, ry: r * h, colour: "#708b88", stroke: 2 });
    surface.text("world", { x: x * w, y: y * h + 5, value: "REEF", colour: "#aec7bc", size: 15, weight: "bold", align: "center" });
  }
  GATES.forEach(([x, y], i) => {
    const next = own >= 0 && snap.cp[own] < LAP_GATES && snap.cp[own] % LAP === i;
    const ring = { x: x * w, y: y * h, rx: GATE_RADIUS * w, ry: GATE_RADIUS * h };
    surface.ellipse("world", { ...ring, colour: next ? "#ffcf6725" : "#7ee7db0d" });
    surface.ellipse("world", { ...ring, colour: next ? "#ffcf67" : "#80c0bd", stroke: next ? 4 : 2 });
    surface.text("world", { x: x * w, y: y * h + 7, value: i + 1, colour: next ? "#ffdf9b" : "#b3d6d6", size: 22, weight: "bold", align: "center" });
  });
  const drift = Math.atan2(snap.cy, snap.cx);
  for (const part of ARROW) {
    surface.poly("world", { points: turned(part, drift, w * 0.57, h * 0.45), colour: "#7ee7db", stroke: 3, closed: false });
  }
  surface.text("world", { x: w * 0.57, y: h * 0.45 + 30, value: "CURRENT", colour: "#a9c8ce", size: 12, align: "center" });
}

const progress = (snap, i) => {
  if (!snap.on[i]) return "disconnected";
  if (snap.fin[i]) return `finished ${(snap.fin[i] / TICK_HZ).toFixed(1)}s`;
  return `lap ${Math.floor(snap.cp[i] / LAP) + 1}/2 · next ${(snap.cp[i] % LAP) + 1} · ${snap.cp[i]}/${LAP_GATES}`;
};

startGame({
  title: "Switchback Regatta",
  Simulation: Game,
  schema,
  intent: INTENT,
  tickHz: TICK_HZ,
  arena: () => ARENA,
  target: () => TARGET,
  bindings: { turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "turn", value: -1, label: "↶ Port" },
    { field: "turn", value: 1, label: "Starboard ↷" },
  ],
  draw(surface, snap, ctx) {
    const { w, h } = surface.arena();
    const own = ctx.seat();
    const players = ctx.players();
    surface.clear("world");
    surface.clear("actors");
    drawCourse(surface, snap, own);
    snap.x.forEach((fx, i) => {
      if (!snap.on[i]) return;
      const x = fx * w;
      const y = snap.y[i] * h;
      const hull = turned(BOAT, Math.atan2(Math.sin(snap.a[i]) * h, Math.cos(snap.a[i]) * w), x, y);
      surface.poly("actors", { points: hull, colour: snap.stun[i] ? "#fff" : ctx.colourFor(i) });
      surface.poly("actors", { points: hull, colour: "#091d2b", stroke: 2 });
      surface.text("actors", { x, y: y - 15, value: `${i + 1}${i === own ? " YOU" : ""}`, colour: ctx.colourFor(i), size: 13, weight: "bold", align: "center" });
    });
    const clock = snap.f ? `Cast off in ${Math.ceil(snap.f / TICK_HZ)}…`
      : snap.over ? "Race complete"
        : `${Math.ceil(snap.left / TICK_HZ)}s remaining · pass rings in order`;
    const fleet = snap.cp.map((_, i) => `${players[i]?.name ?? i + 1}: ${progress(snap, i)}`).join("  |  ");
    ctx.hud(`${clock}  —  ${fleet}`);
  },
});
