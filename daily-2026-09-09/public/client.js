import { defineSnapshot, startGame } from "@engine/engine.js";
import { BANK_TICKS, EVENT, Game, HEAT_MAX, INTENT, ROUND_TICKS, SNAPSHOT, TARGET, TICK_HZ, mapSize } from "/game.js";

const INK = "#e8f4ee";
const MUTED = "#a2b7b8";
const WARM = "#ffbd69";
const COOL = "#64e8ca";
const HOT = "#ff8b86";
const TRACK = "#25393b";
const ROW = "#162a2e";
const ROW_OFF = "#182020";
const LAYER = "actors";
const IDLE_NOTE = "Bank before the clock runs out.";

let lastTick = -1;
let note = IDLE_NOTE;

function bar(surface, x, y, w, fraction, colour) {
  surface.box(LAYER, { x, y, w, h: 10, colour: TRACK });
  surface.box(LAYER, { x, y, w: w * Math.max(0, Math.min(1, fraction)), h: 10, colour });
}

startGame({
  title: "Vault Tempo",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: { act: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "act", value: -1, label: "← bank" },
    { field: "act", value: 1, label: "drill →" },
  ],
  tickHz: TICK_HZ,
  target: () => TARGET,
  arena: (players) => mapSize(players),
  draw(surface, snap, ctx) {
    const players = ctx.players();
    const text = (value, x, y, colour = INK, size = 16) => surface.text(LAYER, { x, y, value, colour, size, weight: 600 });
    if (snap.k < lastTick) note = IDLE_NOTE;
    surface.clear(LAYER);

    const seconds = Math.ceil((ROUND_TICKS - snap.k) / TICK_HZ);
    text(snap.rich ? "RICH VEIN · 3× ORE / 2× HEAT" : "STEADY VEIN · 1× ORE", 24, 35, snap.rich ? WARM : COOL, 22);
    text(`${seconds}s`, 800, 35, INK, 26);
    text(`${snap.rich ? "Steady" : "Rich"} vein in ${(snap.vein / TICK_HZ).toFixed(1)}s`, 24, 64, MUTED);
    bar(surface, 24, 79, 852, 1 - snap.k / ROUND_TICKS, COOL);

    snap.heat.forEach((rawHeat, i) => {
      const heat = Math.round(rawHeat);
      const active = snap.active[i];
      const colour = ctx.colourFor(i);
      const name = players[i]?.name ?? `rig ${i + 1}`;
      const y = 112 + i * 100;
      surface.box(LAYER, { x: 16, y, w: 868, h: 90, colour: active ? ROW : ROW_OFF });
      surface.box(LAYER, { x: 16, y, w: 4, h: 90, colour });
      text(`${name.slice(0, 16)}${ctx.seat() === i ? " · YOU" : ""}`, 30, y + 26, colour);
      const lock = snap.lock[i];
      const mode = snap.mode[i];
      const status = !active ? "OFFLINE"
        : lock ? `MELTDOWN · ${(lock / TICK_HZ).toFixed(1)}s`
        : mode === 1 ? "DRILLING" : mode === -1 ? "BANKING" : "COOLING";
      text(status, 30, y + 57, MUTED, 13);
      const danger = heat >= 65;
      text(`HEAT ${heat}/${HEAT_MAX}`, 290, y + 26, danger ? HOT : MUTED, 13);
      bar(surface, 290, y + 40, 230, rawHeat / HEAT_MAX, danger ? HOT : WARM);
      text(`HAUL ${snap.haul[i]}`, 555, y + 26, WARM, 20);
      bar(surface, 555, y + 40, 140, snap.bank[i] / BANK_TICKS, COOL);
      text(`BANK ${snap.score[i]}`, 730, y + 26, colour, 20);
      bar(surface, 730, y + 40, 126, snap.score[i] / ctx.target(), colour);
      text(snap.bank[i] ? "Keep holding to deposit" : `${BANK_TICKS} ticks to bank`, 555, y + 70, MUTED, 12);

      if (snap.k !== lastTick && snap.ev[i] !== EVENT.none) {
        const amount = snap.amt[i];
        const what = snap.ev[i] === EVENT.bank ? `banked +${amount}`
          : snap.ev[i] === EVENT.meltdown ? `meltdown! Lost ${amount}` : `closing lost ${amount}`;
        note = `${name}: ${what}`;
      }
    });
    lastTick = snap.k;
    ctx.hud(`${seconds}s left · ${snap.rich ? "rich vein" : "steady vein"} · lead with ${ctx.target()}+ banked at shift end · ${note} · ← bank, → drill, release to cool`);
  },
});
