import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, TICK_HZ, PULSE_TICKS, PULSES } from "/game.js";

const schema = defineSnapshot(SNAPSHOT);
// Degrees clockwise from twelve o'clock, as the simulation counts them.
const rad = (degrees) => ((degrees - 90) * Math.PI) / 180;

function drawDial(surface, snap, i, cell, ctx) {
  const { x, y, r, width } = cell;
  const on = snap.on[i];
  const fade = (colour) => (on ? colour : `${colour}59`);
  const own = ctx.colourFor(i);
  const arc = (at, span, colour, w, radius = r, dash) =>
    surface.arc("actors", { x, y, r: radius, from: rad(at - span), to: rad(at + span), colour: fade(colour), width: w, dash });
  arc(180, 180, "#25394d", 3);
  for (let mark = 0; mark < 360; mark += 30) arc(mark, 0.7, "#4b6075", 8);
  arc(snap.aim, 22, "#927842", 15);
  arc(snap.aim, 8, "#ffdc79", 17);
  arc(snap.next, 12, "#a0b8cb", 3, r + 16, [4, 5]);
  const tip = { x: x + Math.cos(rad(snap.ang[i])) * r, y: y + Math.sin(rad(snap.ang[i])) * r };
  surface.poly("actors", { points: [{ x, y }, tip], colour: fade(own), stroke: 4, closed: false });
  surface.disc("actors", { ...tip, r: 7, colour: fade(own) });
  const name = ctx.players()[i]?.name ?? "";
  const centred = { align: "center", maxWidth: width - 16 };
  surface.text("actors", { ...centred, x, y: y - r - 29, value: `${i + 1}. ${name}${i === ctx.seat() ? " · YOU" : ""}`, colour: fade("#e8f2fc"), size: Math.max(12, r * 0.2), weight: 600 });
  const small = Math.max(11, r * 0.17);
  const line = on ? `${snap.pts[i]} this round · ${snap.last[i] < 0 ? "aim for gold" : `last +${snap.last[i]}`}` : "disconnected";
  surface.text("actors", { ...centred, x, y: y + r + 34, value: line, colour: fade(on ? own : "#adb9c5"), size: small });
  const spin = Math.abs(snap.vel[i]) < 0.1 ? "BRAKED" : snap.vel[i] > 0 ? "↻" : "↺";
  surface.text("actors", { ...centred, x, y: y + r * 0.55, value: spin, colour: fade("#a0b8cb"), size: small });
}

startGame({
  title: "Relay Orbit",
  Simulation: Game,
  schema,
  intent: INTENT,
  tickHz: TICK_HZ,
  arena: () => ARENA,
  target: () => TARGET,
  bindings: { turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "turn", value: -1, label: "↺" },
    { field: "turn", value: 1, label: "↻" },
  ],
  draw(surface, snap, ctx) {
    const { w, h } = surface.arena();
    const count = snap.ang.length;
    const columns = count === 1 ? 1 : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const cw = w / columns;
    const ch = h / rows;
    const phase = snap.k > 0 && snap.k % PULSE_TICKS === 0 ? PULSE_TICKS : snap.k % PULSE_TICKS;
    surface.clear("actors");
    surface.box("actors", { x: 0, y: 0, w, h: 6, colour: "#25394d" });
    surface.box("actors", { x: 0, y: 0, w: (w * phase) / PULSE_TICKS, h: 6, colour: "#ffdc79" });
    for (let i = 0; i < count; i++) {
      drawDial(surface, snap, i, {
        x: ((i % columns) + 0.5) * cw,
        y: (Math.floor(i / columns) + 0.5) * ch,
        r: Math.min(cw * 0.34, ch * 0.31),
        width: cw,
      }, ctx);
    }
    const seconds = ((PULSE_TICKS - phase) / TICK_HZ).toFixed(1);
    const firing = phase === PULSE_TICKS;
    ctx.hud(snap.over ? `${PULSES} broadcasts complete · totals above`
      : snap.f ? "Get ready · release to brake"
        : `Broadcast ${Math.min(PULSES, snap.b + (firing ? 0 : 1))}/${PULSES} · ${firing ? "TRANSMIT!" : `${seconds}s to transmit`} · gold centre +3, outer window +1, dashed arc is next`);
  },
});
