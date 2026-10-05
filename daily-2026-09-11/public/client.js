import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, LANES, SNAPSHOT, TARGET, TICK_HZ, mapSize } from "/game.js";

const MINT = "#6cf2bc";
const CORAL = "#ff7289";
const FLASH = "#ffffff";
const BAY_EVEN = "#10242f";
const BAY_ODD = "#142c39";
const LANE = "#294754";
const LAYER = "actors";
const TOP = 65;

startGame({
  title: "Prism Post",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: { move: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "move", value: -1, label: "←" },
    { field: "move", value: 1, label: "→" },
  ],
  tickHz: TICK_HZ,
  target: () => TARGET,
  arena: (players) => mapSize(players),
  draw(surface, snap, ctx) {
    const { w, h } = surface.arena();
    const players = ctx.players();
    const bay = w / snap.x.length;
    const height = h - 100;
    surface.clear(LAYER);
    snap.x.forEach((x, i) => {
      const active = snap.active[i];
      const colour = ctx.colourFor(i);
      const left = bay * i;
      const width = bay - 12;
      const px = (v) => left + 6 + v * width;
      surface.box(LAYER, { x: left + 2, y: 0, w: bay - 4, h, colour: i % 2 ? BAY_ODD : BAY_EVEN });
      for (const lane of LANES) {
        surface.trail(LAYER, { x: px(lane), y: TOP }, { x: px(lane), y: h - 20 }, { colour: LANE, width: 1 });
      }
      const name = players[i]?.name ?? `bay ${i + 1}`;
      surface.text(LAYER, {
        x: left + bay / 2, y: 26, value: `${ctx.seat() === i ? "YOU · " : ""}${name}`,
        colour, size: Math.min(18, bay / 9), weight: "bold", align: "center", maxWidth: bay - 12,
      });
      surface.text(LAYER, {
        x: left + bay / 2, y: 47, value: active ? `${snap.score[i]} / ${ctx.target()}` : "disconnected",
        colour, size: 14, align: "center", maxWidth: bay - 10,
      });
      if (!active) return;
      snap.bt.forEach((type, slot) => {
        if (type === 0 || (snap.bm[slot] & (1 << i))) return;
        const bx = px(LANES[snap.bl[slot]]);
        const by = TOP + snap.by[slot] * height;
        const r = Math.min(15, width * 0.09);
        surface.box(LAYER, { x: bx - r, y: by - r, w: r * 2, h: r * 2, colour: type === 1 ? MINT : CORAL });
        surface.text(LAYER, { x: bx, y: by + r * 0.5, value: type === 1 ? "+" : "×", colour: BAY_EVEN, size: r * 1.5, weight: "bold", align: "center" });
      });
      const cy = TOP + 0.88 * height;
      const flash = snap.flash[i];
      const cart = flash < 0 ? CORAL : flash > 0 ? FLASH : colour;
      surface.box(LAYER, { x: px(x) - width * 0.13, y: cy, w: width * 0.26, h: 13, colour: cart });
      surface.box(LAYER, { x: px(x) - width * 0.13, y: cy - 8, w: 4, h: 10, colour: cart });
      surface.box(LAYER, { x: px(x) + width * 0.13 - 4, y: cy - 8, w: 4, h: 10, colour: cart });
    });
    const clock = snap.f ? `Ready in ${Math.ceil(snap.f / TICK_HZ)}` : `${Math.ceil(snap.left / TICK_HZ)}s left`;
    ctx.hud(`${clock} · first to ${ctx.target()} at shift end · + catch: +1 · × glitch: −2 · ← → slide, release to stop`);
  },
});
