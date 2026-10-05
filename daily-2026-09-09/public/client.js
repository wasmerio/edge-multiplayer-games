import { defineSnapshot, startGame } from "@engine/engine.js";
import { BANK_TICKS, COLORS, EVENT, Game, HEAT_MAX, INTENT, ROUND_TICKS, SNAPSHOT, TARGET, TICK_HZ, mapSize } from "/game.js";

const $ = (id) => document.getElementById(id);
const IDLE_NOTE = "Bank before the clock runs out.";
const say = (id, value) => { const node = $(id); if (node && node.textContent !== value) node.textContent = value; };

let lastTick = -1;

startGame({
  title: "Vault Tempo",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: { act: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  palette: COLORS,
  labels: {
    round: (n) => `Shift ${n} · drill, cool, bank`,
    over: (winner) => (winner ? `${winner} wins!` : "Vault closed · unbanked ore lost"),
    next: (matchOver) => (matchOver ? "New match · Space" : "Next shift · Space"),
  },
  tickHz: TICK_HZ,
  target: () => TARGET,
  arena: (players) => mapSize(players),
  draw(surface, snap, ctx) {
    const players = ctx.players();
    const { w, h } = surface.arena();
    const c = surface.canvas("actors").getContext("2d");
    if (snap.k < lastTick) say("event", IDLE_NOTE);
    c.clearRect(0, 0, w, h);
    c.save();
    c.scale(w / 900, h / (140 + Math.max(2, snap.heat.length) * 100));
    c.textAlign = "left";
    const text = (value, x, y, color = "#e8f4ee", size = 16) => {
      c.fillStyle = color;
      c.font = `600 ${size}px system-ui`;
      c.fillText(value, x, y);
    };
    const bar = (x, y, width, fraction, color) => {
      c.fillStyle = "#25393b";
      c.fillRect(x, y, width, 10);
      c.fillStyle = color;
      c.fillRect(x, y, width * Math.max(0, Math.min(1, fraction)), 10);
    };

    const rich = snap.rich;
    const seconds = Math.ceil((ROUND_TICKS - snap.k) / TICK_HZ);
    text(rich ? "RICH VEIN · 3× ORE / 2× HEAT" : "STEADY VEIN · 1× ORE", 24, 35, rich ? "#ffbd69" : "#64e8ca", 22);
    text(`${seconds}s`, 800, 35, "#ffffff", 26);
    text(`${rich ? "Steady" : "Rich"} vein in ${(snap.vein / TICK_HZ).toFixed(1)}s`, 24, 64, "#a2b7b8");
    bar(24, 79, 852, 1 - snap.k / ROUND_TICKS, "#64e8ca");

    snap.heat.forEach((rawHeat, i) => {
      const heat = Math.round(rawHeat);
      const active = snap.active[i];
      const color = ctx.colourFor(i);
      const name = players[i]?.name ?? `rig ${i + 1}`;
      const lock = snap.lock[i];
      const mode = snap.mode[i];
      const y = 112 + i * 100;
      c.fillStyle = active ? "#162a2e" : "#182020";
      c.fillRect(16, y, 868, 90);
      c.fillStyle = color;
      c.fillRect(16, y, 4, 90);
      text(`${name.slice(0, 16)}${ctx.seat() === i ? " · YOU" : ""}`, 30, y + 26, color);
      text(!active ? "OFFLINE" : lock ? `MELTDOWN · ${(lock / TICK_HZ).toFixed(1)}s` : mode === 1 ? "DRILLING" : mode === -1 ? "BANKING" : "COOLING", 30, y + 57, "#a2b7b8", 13);
      text(`HEAT ${heat}/${HEAT_MAX}`, 290, y + 26, heat >= 65 ? "#ff8b86" : "#a2b7b8", 13);
      bar(290, y + 40, 230, rawHeat / HEAT_MAX, heat >= 65 ? "#ff8b86" : "#ffbd69");
      text(`HAUL ${snap.haul[i]}`, 555, y + 26, "#ffbd69", 20);
      bar(555, y + 40, 140, snap.bank[i] / BANK_TICKS, "#64e8ca");
      text(`BANK ${snap.score[i]}`, 730, y + 26, color, 20);
      bar(730, y + 40, 126, snap.score[i] / ctx.target(), color);
      text(snap.bank[i] ? "Keep holding to deposit" : `${BANK_TICKS} ticks to bank`, 555, y + 70, "#a2b7b8", 12);

      if (snap.k !== lastTick && snap.ev[i] !== EVENT.none) {
        const amount = snap.amt[i];
        say("event", `${name}: ${snap.ev[i] === EVENT.bank ? `banked +${amount}` : snap.ev[i] === EVENT.meltdown ? `meltdown! Lost ${amount}` : `closing lost ${amount}`}`);
      }
    });
    c.restore();
    lastTick = snap.k;
    say("clock", `${seconds}s left · ${rich ? "rich vein" : "steady vein"}`);
    say("target", `Lead with ${ctx.target()}+ banked at shift end`);
  },
});
