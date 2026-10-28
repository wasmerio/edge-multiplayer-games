import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT, ARENA, TARGET, BED, COURSES, COURSE_TICKS, multiplier } from "/game.js";

const PALETTE = ["#244dc4", "#087b7c", "#7a40b1", "#976000", "#ad326d", "#47658c", "#627323", "#192952"];
const PAPER = "#f4f7ff", BLUE = "#163fba", INK = "#102559", LINE = "#cad6f3", FAIL = "#c33727";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const calm = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const fx = { cuts: [] };
const bedAt = (i, w) => ({ x: (i % 2) * w / 2 + (w / 2 - BED) / 2, top: 100 + Math.floor(i / 2) * 160, bottom: 245 + Math.floor(i / 2) * 160 });
function label(s, x, y, value, size = 24, colour = INK, align = "left") {
  s.text("actors", { x, y, value, size, colour, family: MONO, weight: 700, align, baseline: "middle" });
}
function cross(s, x, y, size, colour) {
  s.trail("actors", { x: x - size, y }, { x: x + size, y }, { colour, width: 2 });
  s.trail("actors", { x, y: y - size }, { x, y: y + size }, { colour, width: 2 });
}

function draw(surface, snap, ctx) {
  const { w, h } = surface.arena();
  const me = ctx.seat();
  surface.clear("actors");
  surface.box("actors", { x: 0, y: 0, w, h, colour: PAPER });
  label(surface, 32, 30, `PASS ${String(snap.course + 1).padStart(2, "0")} / 08`, 26, BLUE);
  label(surface, w - 32, 30, snap.ready ? `READY ${Math.ceil(snap.ready / 30)}` : snap.over ? "PRINTED" : multiplier(snap.course) === 2 ? "DOUBLE INK ×2" : "ALIGN + PRESS", 22, BLUE, "right");
  surface.box("actors", { x: 32, y: 61, w: w - 64, h: 16, colour: LINE });
  const fraction = snap.ready ? snap.ready / 60 : snap.t / COURSE_TICKS;
  surface.box("actors", { x: 32, y: 61, w: (w - 64) * fraction, h: 16, colour: BLUE });
  for (let n = 1; n < 8; n++) surface.box("actors", { x: 32 + (w - 64) * n / 8, y: 61, w: 2, h: 16, colour: PAPER });

  for (let i = 0; i < snap.x.length; i++) {
    const b = bedAt(i, w);
    const colour = ctx.colourFor(i);
    const mine = i === me;
    surface.box("actors", { x: b.x - 22, y: b.top, w: BED + 44, h: 152, colour: mine ? "#e3ebff" : "#ffffff" });
    surface.box("actors", { x: b.x - 22, y: b.top, w: BED + 44, h: 152, colour: mine ? BLUE : LINE, stroke: mine ? 3 : 1 });
    if (mine) {
      for (const x of [b.x - 25, b.x + BED + 25]) {
        cross(surface, x, b.top + 5, 7, BLUE);
        cross(surface, x, b.bottom, 7, BLUE);
      }
    }
    label(surface, b.x - 10, b.top + 18, `${i + 1}${mine ? " ◀" : ""}`, 23, colour);
    const result = snap.result[i];
    const mark = !snap.active[i] ? "—" : result === 2 ? `+${snap.award[i]} ◎` : result === 1 ? `+${snap.award[i]} ✓` : result >= 3 ? "×" : "···";
    label(surface, b.x + BED + 10, b.top + 18, mark, 23, result >= 3 ? FAIL : colour, "right");
    for (let x = 0; x <= BED; x += 32) {
      surface.trail("actors", { x: b.x + x, y: b.top + 37 }, { x: b.x + x, y: b.bottom }, { colour: LINE, width: 1 });
      surface.trail("actors", { x: b.x + x, y: b.bottom - 2 }, { x: b.x + x, y: b.bottom + 3 }, { colour: BLUE, width: 1 });
    }
    if (!snap.active[i]) continue;
    for (let j = 0; j < COURSES; j++) {
      const width = snap[`hw${j}`][i];
      if (!width) continue;
      surface.box("actors", { x: b.x + snap[`hx${j}`][i], y: b.bottom - (j + 1) * 11, w: width, h: 9, colour, alpha: j === snap.course ? 1 : 0.72 });
    }
    const y = b.bottom - (snap.course + 1) * 11;
    if (!snap.locked[i]) {
      // The outlined receiving bed stays visible below the moving ink.
      surface.poly("actors", { points: [
        { x: b.x + snap.baseX[i], y }, { x: b.x + snap.baseX[i] + snap.baseW[i], y },
        { x: b.x + snap.baseX[i] + snap.baseW[i], y: y + 9 }, { x: b.x + snap.baseX[i], y: y + 9 },
      ], colour: INK, stroke: 2, dash: [5, 3] });
      surface.box("actors", { x: b.x + snap.x[i], y: y - 17, w: snap.width[i], h: 12, colour });
      surface.box("actors", { x: b.x + snap.x[i], y: y - 17, w: snap.width[i], h: 12, colour: INK, stroke: 1 });
      const overlap = Math.max(0, Math.min(snap.x[i] + snap.width[i], snap.baseX[i] + snap.baseW[i]) - Math.max(snap.x[i], snap.baseX[i]));
      if (overlap > 0) surface.box("actors", { x: b.x + Math.max(snap.x[i], snap.baseX[i]), y: y + 2, w: overlap, h: 5, colour, alpha: 0.45 });
    } else if (result >= 3) {
      surface.poly("actors", { points: [{ x: b.x + snap.baseX[i], y: y + 5 }, { x: b.x + snap.baseX[i] + snap.baseW[i], y: y + 5 }], closed: false, colour: INK, stroke: 2, dash: [4, 4] });
    }
  }

  for (const e of ctx.events("pressed")) {
    if (calm) continue;
    const i = e.player;
    const b = bedAt(i, w);
    const s = e.snapshot;
    const left = s.x[i], right = left + s.width[i];
    const keepL = s[`hx${s.course}`][i], keepR = keepL + s[`hw${s.course}`][i];
    const ranges = s.result[i] >= 3 ? [[left, right]] : [[left, Math.min(right, keepL)], [Math.max(left, keepR), right]];
    for (const [lo, hi] of ranges) if (hi > lo) fx.cuts.push({ x: b.x + lo, y: b.bottom - (s.course + 1) * 11, w: hi - lo, life: 0.65, colour: ctx.colourFor(i), mine: i === me });
  }
  fx.cuts = fx.cuts.filter((cut) => (cut.life -= ctx.dt()) > 0);
  for (const cut of fx.cuts) {
    const age = 0.65 - cut.life;
    surface.box("actors", { x: cut.x, y: cut.y + age * age * 150, w: cut.w, h: cut.mine ? 10 : 7, colour: cut.colour, rotate: age * 0.6, alpha: cut.life / 0.65 });
  }

  if (me < 0) ctx.hud("Watching the presses. You get a bed in the next match.");
  else if (snap.over) ctx.hud(`${snap.total[me]} ink this run. ${ctx.isHost() ? "Enter starts the next run." : "Waiting for the print chief."}`);
  else if (snap.ready) ctx.hud("Your bed has double registration marks. Line up the block, then press.");
  else if (!snap.locked[me]) ctx.hud(`Press when the solid block lines up with its outline. ${multiplier(snap.course) === 2 ? "Double points now!" : "Perfect alignment earns 3."}`);
  else if (snap.result[me] === 2) ctx.hud(`Perfect print! +${snap.award[me]} ink; wider stock next pass. Release the key.`);
  else if (snap.result[me] === 1) ctx.hud(`Trimmed: +${snap.award[me]} ink. The narrower block is your next target. Release.`);
  else ctx.hud("No print. Your next support is wider—try again on the next pass.");
}

startGame({
  title: "Margin Press", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  arena: ARENA, target: () => TARGET, minPlayers: 2, palette: PALETTE, nextKey: "Enter",
  bindings: { press: { keys: { Space: 1, ArrowDown: 1 }, buttons: { 0: 1 } } },
  audioMap: {
    pressed: { sound: "thud", gain: 0.5 },
    mine: { field: "scored", sound: "score", only: "me", pitch: (s, i) => s.result[i] === 2 ? 1.35 : 1 },
    others: { field: "scored", sound: "click", only: "others", gain: 0.35 },
    missed: { sound: "buzz", only: "me", gain: 0.6 },
    beep: "beep", opened: { sound: "pop", gain: 0.5, pitch: (s) => 0.9 + s.course * 0.08 }, finished: "fanfare",
  },
  labels: {
    round: () => null,
    over(winner, info) {
      if (winner) return `${winner} takes the edition.`;
      const totals = info.snapshot?.total ?? [];
      const best = Math.max(0, ...totals.filter((_, i) => info.snapshot.active[i]));
      const leaders = info.players.filter((_, i) => info.snapshot?.active[i] && totals[i] === best).map((p) => p.name);
      return best ? `${leaders.join(" & ")} printed ${best} ink. First to ${info.target} wins.` : "Blank edition. Give it another press.";
    },
    next: (over) => over ? "New edition" : "Next print run",
  },
  scoreboard(players, scores, snap) {
    const best = Math.max(0, ...scores);
    return players.map((p, i) => ({ ...p, name: `${i + 1}. ${p.name}`, alive: snap ? snap.active[i] : true,
      state: scores[i] === best && best > 0 ? "lead" : "",
      note: !snap ? "ready" : !snap.active[i] ? "away" : `${snap.total[i]} this run`,
    }));
  },
  onRound() { fx.cuts = []; },
  draw,
});
