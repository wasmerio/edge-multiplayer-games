import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, BINDINGS, INTENT, SNAPSHOT, TICK_HZ, mapSize } from "/game.js";
import { ArenaView } from "/renderer.js";

// Six touch buttons do not fit one row on a phone.
const style = document.createElement("style");
style.textContent = ".engine-touch{flex-wrap:wrap;justify-content:center}.engine-touch button{min-width:56px;min-height:56px}";
document.head.append(style);

const game = startGame({
  title: "Ring Rumble",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: BINDINGS,
  tickHz: TICK_HZ,
  minPlayers: 2,
  arena: (players) => ({ w: 960, h: 600, ...mapSize(players) }),
  target: () => 5,
  touchControls: [
    { field: "x", value: -1, label: "←" },
    { field: "z", value: -1, label: "↑" },
    { field: "z", value: 1, label: "↓" },
    { field: "x", value: 1, label: "→" },
    { field: "punch", value: 1, label: "Punch" },
    { field: "dash", value: 1, label: "Dash" },
  ],
  mount(arena, ctx) {
    arena.style.width = "min(960px, 100%)";
    arena.style.aspectRatio = "16 / 10";
    const canvas = document.createElement("canvas");
    canvas.className = "engine-layer";
    canvas.setAttribute("aria-label", "3D fighting arena");
    arena.prepend(canvas);
    let view = null;
    try {
      view = new ArenaView(canvas);
    } catch (error) {
      console.warn(error);
      ctx.hud("3D graphics are unavailable. Enable WebGL or try another browser.");
    }
    let last = null;
    return {
      renderer: () => view,
      lobby(msg) { view?.setup(msg.opts.arena, msg.players, ctx.seat()); },
      round() { last = null; },
      // Every tick: countdown, clock and damage, read from the uninterpolated stream.
      snapshot(snap) {
        if (snap.f > 0) ctx.banner(String(Math.ceil(snap.f / TICK_HZ)));
        else if (last?.f > 0) ctx.banner(null);
        last = snap;
        const own = ctx.seat();
        const clock = snap.f > 0 ? "Get ready" : `${Math.max(0, 60 - Math.floor(snap.k / TICK_HZ))}s`;
        const hint = snap.k >= 600 ? "The ring is shrinking" : "Knock them off";
        const status = own < 0 ? "Spectating" : !snap.alive[own] ? "You are out" : snap.cd[own] ? `Dash ${(snap.cd[own] / TICK_HZ).toFixed(1)}s` : "Dash ready";
        const damage = ctx.players().map((p, i) => `${p.name} ${snap.alive[i] ? `${snap.dmg[i]}%` : "OUT"}`).join("  ");
        ctx.hud(`${clock} · ${hint} · ${status} · ${damage} · first to ${ctx.target()}`);
      },
      over(msg) {
        const champion = msg.winner >= 0;
        const name = ctx.players()[champion ? msg.winner : last?.win]?.name;
        ctx.banner(name ? `${name} wins the ${champion ? "match" : "round"}!` : "Draw!");
      },
      draw(snap) { view?.draw(snap); },
    };
  },
});
window.rumble = game;
