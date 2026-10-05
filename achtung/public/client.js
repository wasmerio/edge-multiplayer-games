import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT } from "/game.js";

const schema = defineSnapshot(SNAPSHOT);
const previous = new Map();
let lastTick = -1;

startGame({
  title: "Achtung, die Kurve!",
  Simulation: Game,
  schema,
  intent: INTENT,
  bindings: { turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "turn", value: -1, label: "◀" },
    { field: "turn", value: 1, label: "▶" },
  ],
  audioMap: { d: { sound: "hit", pitch: [0.9, 1.1] } },
  draw(surface, snap, ctx) {
    if (snap.k < lastTick) previous.clear();
    lastTick = snap.k;
    surface.clear("actors");
    snap.x.forEach((x, i) => {
      const y = snap.y[i];
      const before = previous.get(i);
      if (before && snap.alive[i] && !snap.gap[i] && !before.gap) {
        surface.trail("world", before, { x, y }, { colour: ctx.colourFor(i) });
      }
      previous.set(i, { x, y, gap: snap.gap[i] });
      if (snap.alive[i]) surface.disc("actors", { x, y, r: 3.5, colour: "#fff" });
    });
  },
});
