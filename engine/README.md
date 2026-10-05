# Browser game engine

A game is a simulation, a snapshot schema, an intent, a draw function and its
own page. The engine owns everything else: the signaling server, the lobby and
invite panel, the WebRTC star, the fixed-tick host loop, the binary codec and
deltas, guest interpolation, input sources, audio, diagnostics and the sub-app
contract.

This file is the reference. [`AGENTS.md`](../AGENTS.md) is the recipe: the
steps, the commands, the failure table. You do not need to read engine source
to build a game. If you had to, that is a gap in this file: fix the file.

| You want | Section |
|---|---|
| A whole game to copy from | [Complete example](#complete-example) |
| Every option of the one call | [`startGame(config)`](#startgameconfig) |
| What `draw` can do | [Draw context](#draw-context-ctx), [Surface](#surface) |
| Board size, phones, crisp text | [Arena and screen](#arena-and-screen) |
| The page and its roles | [Page slots](#page-slots), [Touch controls](#touch-controls), [Scoreboard](#scoreboard) |
| Sound | [Sound](#sound) |
| When things run, and for whom | [How it behaves](#how-it-behaves) |
| Shake, particles, countdowns, phone layout | [Game feel cookbook](#game-feel-cookbook) |
| To see the game without a human, with bots that play it | [Look at your game](#look-at-your-game) |
| Fonts | [Typography](#typography) |

Rules that the conformance suite enforces, so learn them first:

- The simulation is headless: no DOM, no network, no timers, no `Math.random`,
  no `Date.now`. Randomness comes from the injected `rng`.
- The page imports the engine from one **pinned** version path.
- A game has no loop, no socket, no `RTCPeerConnection`, no `?room` / `?create`
  handling and no server code of its own.
- The page loads nothing from another origin. Fonts, images, scripts and
  stylesheets live under `public/`. The only shared origin is the pinned
  engine and its asset set. See [Nothing from another origin](#nothing-from-another-origin).
- `test/replay.ndjson` is committed and replays to its recorded final state.

## Start a game

```bash
node scripts/new-game.mjs my-game --name "My Game"   # [--description "…"] [--root <checkout>]
cd my-game && npm test                               # scenarios, budget, fixture
node ../scripts/dev.mjs my-game 8765                 # run it against this checkout's engine
node ../scripts/play.mjs my-game --phone --shots /tmp/my-game-shots   # play it headlessly, save screenshots
node ../scripts/conformance.mjs .                    # the contract, every row
```

The scaffold is a complete, passing game, and it is the example printed below.
Replace the rules in `public/game.js`, the drawing in `public/client.js`, the
markup and copy in `public/index.html` and the theme in `public/style.css`,
re-record the fixture with `RECORD=1 npm test`, and fill the three README
sections. The engine owns behaviour; the game owns its page and stylesheet.

| File | Content |
|---|---|
| `public/index.html` | The game's own markup with `data-engine` roles, the pinned import map, one module script |
| `public/style.css` | The game's own look; the scaffold's theme is a placeholder |
| `public/client.js` | The `startGame({...})` call, the `draw` function, and helpers and cosmetic state for them |
| `public/game.js` | The simulation class, `SNAPSHOT`, `INTENT` |
| `src/server.js` | One `serveGame({ publicDir })` call; never edit it |
| `test/game.test.mjs`, `test/reference.mjs`, `test/replay.ndjson` | Scenario tests, the scripted reference match, the replay fixture |
| `test/bot.mjs` | The bot `play.mjs` plays the game with; see [Bots](#bots) |
| `README.md` | Headings **Input**, **Snapshot**, **Round lifecycle** |

`public/client.js` may hold functions, constants and cosmetic state above the
`startGame` call. It may not hold a loop (`requestAnimationFrame`,
`setInterval`), a socket, an `RTCPeerConnection`, lobby code or a second
engine import.

## Complete example

These four files are what `node scripts/new-game.mjs pellet-rush --name "Pellet Rush"`
writes, byte for byte. A test scaffolds the game, runs its tests and
conformance, and plays it in a browser; another test fails when a block below
differs from the scaffold. After a change to `scripts/scaffold/`, run
`node scripts/sync-example.mjs`.

The game: move to the pellet, a boost gets you there first, five pellets end
a round. It uses a countdown, two event lists, two one-tick flags, a live
scoreboard, a thumb stick and a touch button.

**`public/game.js`**: the simulation, the snapshot schema, the intent.

<!-- example:public/game.js -->
```js
// Pellet Rush: race to the pellet; a boost gets you there first.
// Headless: no DOM, no network, no timers, no Math.random. It runs in Node.
export const SPEED = 4;
export const BOOST_SPEED = 9;
export const BOOST_TICKS = 6;
export const BOOST_COOLDOWN = 45;
export const READY_TICKS = 45;
export const PELLETS_PER_ROUND = 5;
export const RADIUS = 12;
const REACH = 20;
const MARGIN = 40;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts.arena;
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    // The engine reads these four.
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.left = 0;
    this.ready = 0;
    this.pellet = { x: w / 2, y: h / 2 };
    this.gone = new Array(playerCount).fill(false);
    this.p = Array.from({ length: playerCount }, () => ({ x: w / 2, y: h / 2, boost: 0, cd: 0, held: false }));
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.left = PELLETS_PER_ROUND;
    this.ready = READY_TICKS;
    // Everyone starts on a ring, so no seat is closer to the middle. One player works too.
    const turn = this.rng.range(0, Math.PI * 2);
    this.p = this.p.map((_, i) => {
      const angle = turn + (i / this.n) * Math.PI * 2;
      return { x: this.w / 2 + Math.cos(angle) * this.h * 0.3, y: this.h / 2 + Math.sin(angle) * this.h * 0.3, boost: 0, cd: 0, held: false };
    });
    this.placePellet();
  }

  placePellet() {
    this.pellet = {
      x: Math.round(this.rng.range(MARGIN, this.w - MARGIN)),
      y: Math.round(this.rng.range(MARGIN, this.h - MARGIN)),
    };
  }

  // Called once when a player leaves for good. The seat stays in every array.
  disconnect(index) {
    this.gone[index] = true;
  }

  step(intents) {
    const took = [];
    const boosted = [];
    let beep = false;
    let go = false;
    if (!this.roundOver) {
      // The tick advances on every step, the countdown included.
      this.tick += 1;
      if (this.ready > 0) {
        beep = this.ready % 15 === 0;
        this.ready -= 1;
        go = this.ready === 0;
      } else {
        for (let i = 0; i < this.n; i++) {
          if (this.gone[i]) continue;
          const me = this.p[i];
          // A seat that has sent no input yet holds 0, not an object.
          const intent = intents[i] || {};
          const mx = clamp(intent.mx || 0, -1, 1);
          const my = clamp(intent.my || 0, -1, 1);
          const pressed = (intent.boost || 0) > 0;
          // Act on the press edge, so a held key boosts once.
          if (pressed && !me.held && me.cd === 0) { me.boost = BOOST_TICKS; me.cd = BOOST_COOLDOWN; boosted.push(i); }
          me.held = pressed;
          const length = Math.max(1, Math.hypot(mx, my));
          const speed = me.boost > 0 ? BOOST_SPEED : SPEED;
          me.x = clamp(me.x + (mx / length) * speed, RADIUS, this.w - RADIUS);
          me.y = clamp(me.y + (my / length) * speed, RADIUS, this.h - RADIUS);
          if (me.boost > 0) me.boost -= 1;
          if (me.cd > 0) me.cd -= 1;
          if (Math.hypot(me.x - this.pellet.x, me.y - this.pellet.y) < REACH) took.push(i);
        }
        if (took.length) {
          for (const i of took) this.scores[i] += 1;
          this.left -= 1;
          if (this.left <= 0) this.roundOver = true;
          else this.placePellet();
        }
      }
    }
    // Every SNAPSHOT field, every tick. Guests keep no other state.
    return {
      k: this.tick,
      over: this.roundOver,
      ready: this.ready,
      left: this.left,
      x: this.p.map((me) => Math.round(me.x * 10) / 10),
      y: this.p.map((me) => Math.round(me.y * 10) / 10),
      cd: this.p.map((me) => me.cd),
      px: this.pellet.x,
      py: this.pellet.y,
      took,
      boosted,
      beep,
      go,
    };
  }

  // A seat index, or -1 to play another round.
  winner(target) {
    const best = Math.max(...this.scores);
    if (best < target) return -1;
    return this.scores.filter((score) => score === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x", "y"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    ready: { type: "uint", bits: 8 },
    left: { type: "uint", bits: 8 },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    cd: { type: "uint", bits: 8, per: "player" },
    px: { type: "uint", bits: 16 },
    py: { type: "uint", bits: 16 },
    took: { type: "players" },
    boosted: { type: "players" },
    beep: { type: "bool" },
    go: { type: "bool" },
  },
};

export const INTENT = {
  mx: { min: -1, max: 1, neutral: 0 },
  my: { min: -1, max: 1, neutral: 0 },
  boost: { values: [0, 1], neutral: 0 },
};
```

**`public/client.js`**: bindings, sound, labels, scoreboard, and `draw`.

<!-- example:public/client.js -->
```js
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
  title: "Pellet Rush",
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
```

**`public/index.html`**: the page. The elements with `data-engine` are the
ones the engine drives.

<!-- example:public/index.html -->
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pellet Rush</title>
  <meta name="description" content="Pellet Rush: race to the pellet; a boost gets you there first.">
  <link rel="stylesheet" href="/style.css">
  <script type="importmap">
    { "imports": { "@engine/": "https://edge-multiplayer-games.wasmer.app/engine/<ENGINE_VERSION>/" } }
  </script>
</head>
<body>
  <header class="top">
    <h1>Pellet Rush</h1>
    <span class="status" data-engine="status">connecting</span>
    <button class="quiet" data-engine="mute">sound on</button>
    <a class="home" href="https://edge-multiplayer-games.wasmer.app">all games</a>
  </header>

  <main>
    <section class="lobby" data-engine="lobby">
      <p class="pitch">Pellet Rush: race to the pellet; a boost gets you there first.</p>
      <label class="field">Your name
        <input data-engine="name" maxlength="16" placeholder="your name" autocomplete="nickname">
      </label>
      <div class="row">
        <button class="primary" data-engine="create">Create room</button>
        <span class="or">or</span>
        <input class="code" data-engine="code" maxlength="8" placeholder="CODE" aria-label="Room code">
        <button data-engine="join">Join</button>
      </div>
      <div class="room" data-engine="room-info" hidden>
        <p>Room <strong data-engine="room-code"></strong></p>
        <div class="invite" data-engine="invite" hidden>
          <span>Send this link to your friends</span>
          <a data-engine="invite-link" href="#"></a>
          <button class="quiet" data-engine="copy">copy</button>
        </div>
        <ul class="peers" data-engine="peers"></ul>
        <div class="row" data-engine="host-controls" hidden>
          <button class="primary" data-engine="start">Start game</button>
        </div>
        <p class="wait" data-engine="wait" hidden>Waiting for the host to start.</p>
      </div>
      <p class="help">Move with WASD or the arrow keys. Space boosts.</p>
    </section>

    <section class="game" data-engine="game" hidden>
      <div class="stage">
        <div class="arena" data-engine="arena">
          <div class="banner" data-engine="banner" hidden></div>
        </div>
        <p class="hud" data-engine="hud"></p>
        <div class="touch">
          <div class="stick" data-engine-stick="mx,my" role="group" aria-label="Move: drag in any direction"><i></i></div>
          <button class="boost" data-engine-touch="boost=1" aria-label="Boost">BOOST</button>
        </div>
      </div>
      <aside class="side">
        <ol class="scores" data-engine="scores"></ol>
        <button class="primary" data-engine="next" hidden>Next round</button>
        <p class="help keys">WASD or arrows move. Space boosts. The host starts the next round with Enter.</p>
      </aside>
    </section>
  </main>

  <script type="module" src="/client.js"></script>
</body>
</html>
```

**`public/style.css`**: the look.

<!-- example:public/style.css -->
```css
/* Pellet Rush: this stylesheet is the game's own. Change it freely.
   The engine binds behaviour to the data-engine roles in index.html and
   shows or hides elements with the hidden attribute; it brings no theme. */

/* 1. Theme: restyle from here first. System font stacks only: the page loads nothing from another origin. */
:root {
  color-scheme: dark;
  --bg: #12141a;
  --panel: #1c2029;
  --line: #2e3442;
  --ink: #eceef3;
  --muted: #8d93a3;
  --accent: #ffb347;
  --on-accent: #1a1304;
  --arena: #05060a;
  --radius: 10px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --display: Impact, Haettenschweiler, "Arial Narrow Bold", "Roboto Condensed", sans-serif;
}

/* 2. Base. Keep the [hidden] rule: the engine shows and hides with that attribute. */
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); font: 16px/1.5 var(--font); }
input, button {
  font: inherit; color: var(--ink); background: var(--panel);
  border: 1px solid var(--line); border-radius: var(--radius);
  padding: 0.55rem 0.9rem; min-height: 44px; max-width: 100%;
}
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 650; }
button.quiet { min-height: 32px; padding: 0.15rem 0.6rem; font-size: 0.85rem; }

/* 3. Header. */
.top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--line); }
.top h1 { margin: 0; font: 400 1.5rem/1 var(--display); letter-spacing: 0.04em; color: var(--accent); }
.status, .help, .wait, .or { color: var(--muted); font-size: 0.9rem; }
.home { margin-left: auto; color: var(--muted); text-decoration: none; font-size: 0.9rem; }
.home:hover { color: var(--accent); }

/* 4. Lobby. */
main { padding: 1rem; }
.lobby { max-width: 34rem; margin: 0 auto; display: grid; gap: 0.75rem; }
.pitch { margin: 0; color: var(--muted); }
.field { display: grid; gap: 0.25rem; font-size: 0.9rem; color: var(--muted); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.code { width: 7rem; text-transform: uppercase; letter-spacing: 0.15em; }
.room { display: grid; gap: 0.5rem; padding: 0.75rem; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.room p, .help { margin: 0; }
.invite { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.invite a { color: var(--accent); word-break: break-all; }
.peers { margin: 0; padding-left: 1.2rem; }
.peers li.you { color: var(--accent); }

/* 5. Game. The engine sets the arena's width and aspect ratio; give it a background, not a size. */
/*    The arena's parent needs a definite width (a 1fr grid column here), or the arena collapses. */
.game { display: grid; grid-template-columns: minmax(0, 1fr) 14rem; align-items: start; gap: 1rem; max-width: 80rem; margin: 0 auto; }
.stage { display: grid; justify-items: center; gap: 0.6rem; min-width: 0; }
/*    The max-width keeps the whole board on screen: the engine publishes --arena-w and --arena-h. */
.arena {
  position: relative; background: var(--arena); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
  max-width: min(100%, calc((100vh - 9rem) * var(--arena-w, 4) / var(--arena-h, 3)));
}
.banner {
  position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; pointer-events: none; padding: 1rem; text-align: center;
  font: 400 clamp(1.4rem, 6vw, 2.6rem)/1.1 var(--display); letter-spacing: 0.03em; text-shadow: 0 2px 12px var(--arena);
}
.banner[data-kind="win"] { color: var(--accent); }
.hud { width: 100%; min-height: 1.5em; margin: 0; color: var(--muted); text-align: center; }
.side { display: grid; gap: 0.6rem; }

/* 6. Scoreboard rows: li.you, li.host and li.dead are set by the engine; data-state and .note come from scoreboard(). */
.scores { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
.scores li { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; border-left: 3px solid transparent; background: var(--panel); border-radius: 4px; }
.scores .swatch { flex: none; width: 0.8em; height: 0.8em; border-radius: 50%; }
.scores .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scores .score { font: 400 1.25rem/1 var(--display); font-variant-numeric: tabular-nums; }
.scores .note { order: 3; color: var(--muted); font-size: 0.75rem; }
.scores li.you .name { color: var(--accent); }
.scores li.you .name::after { content: " (you)"; color: var(--muted); font-size: 0.8em; }
.scores li.dead { opacity: 0.45; }
.scores li[data-state="lead"] { border-left-color: var(--accent); }

/* 7. Touch controls: the engine sets data-touch="on" on a touch device and --stick-x / --stick-y while the stick is dragged. */
.touch { display: none; width: 100%; max-width: 30rem; justify-content: space-between; align-items: center; -webkit-tap-highlight-color: transparent; }
[data-touch="on"] .touch { display: flex; }
[data-touch="on"] .keys { display: none; }
.stick { position: relative; width: 132px; height: 132px; border-radius: 50%; background: var(--panel); border: 2px solid var(--line); }
.stick i {
  position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; pointer-events: none;
  background: var(--muted); transform: translate(calc(var(--stick-x, 0) * 38px), calc(var(--stick-y, 0) * 38px));
}
.stick[data-active] i { background: var(--accent); }
.boost { width: 104px; height: 104px; border-radius: 50%; background: var(--accent); border-color: var(--accent); color: var(--on-accent); font: 400 1.3rem var(--display); }
.boost[data-pressed] { filter: brightness(1.3); }

/* 8. Phone width. */
@media (max-width: 900px) {
  main { padding: 0.75rem; }
  .game { grid-template-columns: minmax(0, 1fr); }
}
```

## The simulation (`public/game.js`)

```js
export class Game {                       // export name: Simulation or Game
  constructor(playerCount, opts, rng) {   // opts.arena = { w, h }; rng is seeded
    this.scores = new Array(playerCount).fill(0);
    this.round = 0; this.tick = 0; this.roundOver = true;
  }
  startRound() { this.round += 1; this.tick = 0; this.roundOver = false; }
  step(intents) {                         // intents[i] is player i's intent object (or 0 before any input)
    if (!this.roundOver) this.tick += 1;
    return { k: this.tick, over: this.roundOver, /* every SNAPSHOT field */ };
  }
  winner(target) { return -1; }           // player index, or -1 for "play another round"
  disconnect(index) {}                    // optional: a player left for good
}
export const SNAPSHOT = { /* below */ };
export const INTENT = { turn: { min: -1, max: 1, neutral: 0 } };
// optional: export const ARENA = { w, h }  or  (players) => ({ w, h })
```

| Member | The engine | You |
|---|---|---|
| `constructor(playerCount, opts, rng)` | Builds one simulation per match, on the host only. `opts.arena` is `{ w, h }` | Size the world from `opts.arena`. Keep `rng` |
| `startRound()` | Calls it at the start of every round | Reset per-round state, add one to `round`, set `roundOver = false` |
| `step(intents)` | Calls it once per tick while `roundOver` is false, and once right after `startRound()` with every intent `0` | Advance one tick, return the snapshot object |
| `winner(target)` | Calls it when `roundOver` becomes true | Return a seat index for a match winner, or `-1` |
| `disconnect(index)` | Calls it once when a seated player leaves | Take the seat out of play. Optional |
| `round`, `tick`, `roundOver`, `scores` | Reads them | `scores` has one entry per player |

`rng` is the only source of randomness:

| Method | Returns |
|---|---|
| `rng.next()` | A number in [0, 1) |
| `rng.range(lo, hi)` | A number in [lo, hi) |
| `rng.int(lo, hi)` | An integer, both ends inclusive |
| `rng.pick(array)` | One element; throws on an empty array |
| `rng.state()`, `rng.restore(n)` | The generator's state, for a save and a restore |

Rules for `step`:

- `intents` is a frozen array. Never write to it.
- `intents[i]` is `0` until seat `i` has sent input, and again after that seat
  disconnects. Read fields as `intents[i]?.turn || 0`.
- The tick field must advance on every call, countdowns included. A guest
  drops a frame that repeats a tick.
- Return every `SNAPSHOT` field on every tick. Guests keep no other state.
- Keep it O(players) and light on allocation.

**One player must not throw.** `minPlayers: 2` only stops the Start button.
The engine probes the class with two players, and tests, conformance and a
solo developer build it with one. Guard every "pick another player" and every
division by `players − 1`.

**A seat never disappears.** After `disconnect(index)` the seat stays in
`scores`, in every per-player snapshot array and in `intents`. The game must
keep it out of play itself: skip it in `step`, do not spawn it in later
rounds, do not let it win a "last one standing" check.

The suite and the generator find these by name: the class as `Simulation`,
`Game` or the default export; `SNAPSHOT`; `INTENT`; optionally `ARENA`.

**`ARENA`** is the board for tools that have no `startGame` call to read. It is
a size, `{ w, h }`, or a function of the player count,
`(players) => ({ w, h })`; the suite and the generator call a function with
the number of players of the simulation they build. Without the export they
use `arenaFor(players)`. The host builds the simulation with
`startGame({ arena })`, so pass it the same thing: `arena: ARENA` for a
function, `arena: () => ARENA` for a size. The scaffold's
`test/reference.mjs` exports `arenaOf(players)`, which reads `ARENA` the same
way, and its tests build every simulation through it, so tests, conformance
and the host agree once the game exports `ARENA`.

## Snapshot schema

```js
export const SNAPSHOT = {
  tickField: "k",                 // default "k"; must be a declared field
  interpolate: ["x", "y"],        // numeric fields blended on guests
  fields: {
    k:     { type: "uint", bits: 32 },
    over:  { type: "bool" },
    x:     { type: "fixed", scale: 10, bits: 16, per: "player" },
    alive: { type: "bool", per: "player" },
    cells: { type: "uint", bits: 8, count: 16 },
    took:  { type: "players" },   // an event list
    go:    { type: "bool" },      // a one-tick flag
  },
};
```

| `type` | Value | Options |
|---|---|---|
| `uint`, `int` | Integer | `bits`: 8, 16 or 32 (default 32) |
| `fixed` | Number rounded to `1/scale` | `scale` (required), `bits` 8/16/32 (default 16), `signed: false` for unsigned, `wrap` for an angle |
| `bool` | Boolean, bit-packed in lists | — |
| `players` | List of player indexes; the event list | Scalar only |

| Shape | Declared with | Value |
|---|---|---|
| Scalar | nothing | One value |
| Per player | `per: "player"` | An array with one entry per seat |
| Fixed list | `count: n` (1 to 255) | An array of `n` values |

A value outside its range throws at encode time on the host, so size fields
honestly: `fixed, scale 10, bits 16` holds ±3276.7; `uint, bits 8` holds 0 to
255. A full snapshot must fit `params.SNAPSHOT_BUDGET_BYTES` (100 B) per
player; deltas are automatic. Do not raise `budgetBytes`.

`interpolate` takes numeric fields only. An angle needs `wrap`
(`{ type: "fixed", scale: 10, wrap: 360 }`, or `2 * Math.PI` for radians) so
it turns the short way round.

**Events.** Anything that happens on one tick and makes a sound, a score or a
one-shot effect is an event field:

| Event | Field | Example |
|---|---|---|
| Something happened to players | `players` list, holding their indexes for that one tick | `took: [2]`, `d: [0, 3]` |
| Something happened to nobody in particular | `bool`, true for that one tick | `beep: true`, `go: true` |

Both drive `audioMap` and `ctx.events(field)`. Anything that lasts longer than
one tick is a counter or an age, not an event: `cd` (cooldown ticks left),
`ready` (countdown ticks left), `bAge` (ticks since the blast). See
[Events and state](#events-and-state).

`defineSnapshot(spec)` returns `{ hash, fields, budgetBytes, tickField,
byteLength(players), encode(snap, players), decode(buffer, players),
delta(prev, next, players), apply(prev, buffer, players), isInterpolated(name),
interpolatedFields(), wrapOf(name) }`.

## Intent and bindings

The intent is the whole input of one player. Declare each field once; the
engine clamps it, sends it only on change and re-sends it every
`params.INPUT_RESEND_INTERVAL_MS`.

```js
export const INTENT = {
  turn: { min: -1, max: 1, neutral: 0 },         // a range
  fire: { values: [0, 1], neutral: 0 },          // an enumeration
};
```

| Intent option | Type | Default | Meaning |
|---|---|---|---|
| `min`, `max` | number | −1, 1 | The range a value is clamped to |
| `values` | number[] | — | An enumeration instead of a range; another value becomes `neutral` |
| `neutral` | number | 0 | The value with nothing pressed |

```js
// client.js
bindings: {
  turn: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0, deadZone: 0.3 },
  fire: { keys: { Space: 1 }, buttons: { 0: 1 } },
},
```

| Binding option | Type | Default | Meaning |
|---|---|---|---|
| `keys` | `{ [KeyboardEvent.code]: number }` | `{}` | Contribution of each held key. One key belongs to one field |
| `axis` | number | — | Gamepad axis index; adds ±1 past the dead zone |
| `deadZone` | number | 0.3 | Axis values at or below this are ignored |
| `analog` | boolean | false | The axis adds its real deflection instead of ±1 |
| `buttons` | `{ [gamepadButtonIndex]: number }` | `{}` | Contribution of each pressed gamepad button |
| `discrete` | boolean | true | The sum of keys, axes and buttons is limited to −1…1, so two keys for one direction are one unit. `false` keeps the sum, up to the field's own range |

Contributions of keys, gamepads, touch controls, sticks and `ctx.intent` add
up, and the total is clamped to the field's range. A touch, stick or
`ctx.intent` value is taken as given, and a field needs no binding to take one. A
key typed into an `<input>` is text, never game input. The engine calls
`preventDefault` on bound keys, so arrows and Space do not scroll the page.

The host's next-round key is `nextKey`, `"Space"` by default. See
[Rounds and matches](#rounds-and-matches) before you bind Space to an action.

## `startGame(config)`

```js
import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT } from "/game.js";

startGame({
  title: "My Game", Simulation: Game, schema: defineSnapshot(SNAPSHOT), intent: INTENT,
  bindings: { turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  draw(surface, snap, ctx) {
    surface.clear("actors");
    snap.x.forEach((x, i) => surface.disc("actors", { x, y: snap.y[i], r: 8, colour: ctx.colourFor(i) }));
  },
});
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `Simulation` | class | required | The simulation class |
| `schema` | object | required | `defineSnapshot(SNAPSHOT)` |
| `intent` | object | required | `INTENT` |
| `bindings` | object | required | Key, gamepad and axis bindings by intent field; `{}` is allowed |
| `draw` | `(surface, snapshot, ctx) => void` | required unless `mount` | Called every animation frame once a match has a snapshot |
| `mount` | `(arenaElement, ctx) => view` | — | Own renderer (three.js): return `{ draw(snapshot, ctx) }` plus optional `lobby`, `round`, `over`, `snapshot`, `reply` hooks |
| `title` | string | — | Header text of the default chrome; a page with slots writes its own |
| `palette` | string[] | shared eight | Player colours by seat; feeds `players()[i].colour`, `ctx.colourFor`, `surface.colour` and the score swatches |
| `layers` | string[] | `["world", "actors"]` | Canvas layers, back to front |
| `arena` | `(players) => { w, h }` | `arenaFor(players)` | Board size, sent to every peer |
| `target` | `(players) => number` | `max(5, 10 × (players − 1))` | Score passed to `winner(target)` |
| `tickHz` | number | `params.DEFAULT_TICK_HZ` (30) | Simulation rate, at most `params.MAX_TICK_HZ` (60) |
| `minPlayers` | number | 1 | Start is refused below this many connected players; the status line says why |
| `nextKey` | `KeyboardEvent.code` or `null` | `"Space"` | The host's key for the next round or match; `null` leaves only the `next` control |
| `pixelRatio` | number | `devicePixelRatio` | Backing-store density of the canvases, capped at `params.MAX_PIXEL_RATIO` (2) |
| `audioMap` | object | `{}` | Snapshot field to sound; see [Sound](#sound) |
| `audioAssets` | `{ [name]: AudioBuffer }` | `{}` | Sounds the game decoded itself, by name |
| `assetsUrl` | string | the set beside the engine | Manifest URL of another asset set |
| `labels` | object | engine copy | Banner and next-control text; see [Labels](#labels) |
| `scoreboard` | `(players, scores, snapshot) => rows` | one row per player | See [Scoreboard](#scoreboard) |
| `onReady` | `(ctx) => void` | — | Called once, at the end of `startGame` |
| `onRound` | `(n, ctx) => void` | — | Called on every peer when round `n` starts, after the layers were cleared |
| `onOver` | `(winnerSeat, ctx) => void` | — | Called on every peer when a round ends; `winnerSeat` is −1 unless the match is won |
| `onCommand` | `(sim, playerIndex, data) => reply` | — | Host-side handler for `ctx.command(data)`; a reply goes back to the sender's `reply` hook |
| `touchControls` | `{ field, value, label }[]` | `[]` | Buttons for the default chrome only; a page with slots declares its own |
| `container` | element | `#game` or `<body>` | Where the default chrome mounts, and the element that carries `data-touch` |

Seams for tests, not for games: `doc`, `where`, `history`, `now`, `loopDeps`,
`audioContext`.

`startGame` returns `{ ctx, intent(field, value), ui, surface, view, peers(),
signal, state, diagnostics, input, mixer, engineVersion }`. `ctx` is the draw
context below, so code outside `draw` can reach it; `onReady(ctx)` hands over
the same object.

### Draw context `ctx`

| Member | Returns or does |
|---|---|
| `players()` | `[{ pid, owner, name, colour, score }]` in seat order |
| `colourFor(index)` | The colour of a seat, from `palette` or the shared eight |
| `seat()` | This peer's player index, −1 for a spectator |
| `isHost()`, `spectator()`, `selfId()` | Role of this peer |
| `target()` | The score target of the match |
| `round()` | The round number, 0 before the first round |
| `over()` | True from the end of a round until the next one starts |
| `winner()` | `null` during a round; after it, the winning seat, or −1 while the match goes on |
| `scores()` | A copy of the latest scores |
| `time()` | Seconds, for cosmetic animation. The same value for the whole frame |
| `dt()` | Seconds since the previous frame, at most 0.1 |
| `tickFraction()` | 0 to 1: how far the screen is past the snapshot's tick, as a part of one tick. On a guest it is the blend between the two snapshots on screen; on the host it is the time since the last step. 0 once the round is over. See [Host and guests](#host-and-guests) |
| `events(field)` | `[{ player, tick, snapshot }]`: the entries of an event field for every tick the screen reached since the last frame, each exactly once. `player` is −1 for a `bool` flag. `snapshot` is the exact snapshot of that tick |
| `hud(text)` | Sets the status line (the `hud` slot) |
| `banner(text, ms)` | Shows a banner for `ms` milliseconds, or until the next one; `banner()` clears |
| `intent(field, value)` | Adds a contribution to an intent field from a source bindings cannot express; 0 removes it |
| `command(data)` | A discrete request to the host's `onCommand` |

There is no `performance.now()` to call and no frame counter to keep: use
`time()` and `dt()`.

### Labels

```js
labels: {
  round: (n, info) => `Round ${n}`,
  over: (winnerName, info) => (winnerName ? `${winnerName} wins` : "Round over"),
  next: (matchOver, info) => (matchOver ? "New match" : "Next round"),
},
```

| Label | First argument | Shown |
|---|---|---|
| `round` | The round number | In the banner for 1.4 s at a round start |
| `over` | The match winner's name, or `null` while the match goes on | In the banner from the end of a round until the next round |
| `next` | `true` when the match is won | On the host's `next` control |

`info` is `{ snapshot, players, scores, target, round, winner, seat }`:
`snapshot` is the latest one this peer received (`null` at the first round
start), `winner` is a seat index, −1 or `null`, `seat` is the local player.
Override any subset. A `round` or `over` label that returns `null` or `""`
shows no banner; use that when the canvas announces the round itself.

## Surface

Everything `draw` paints goes through `surface`. Coordinates are arena units,
`{ x: 0, y: 0 }` is the top left, and every peer has the same arena.

| Call | Options (default) | Draws |
|---|---|---|
| `clear(layer)` | — | Empties one layer |
| `clearAll()` | — | Empties every layer |
| `disc(layer, o)` | `x, y, r, colour, stroke` | A filled circle; with `stroke` (a line width) an outline |
| `box(layer, o)` | `x, y, w, h, colour, stroke, radius, rotate` | A filled rectangle from its top-left corner; with `stroke` an outline. `radius` rounds the corners, at most half the shorter side |
| `ellipse(layer, o)` | `x, y, rx, ry, colour, stroke, rotate` | A filled ellipse; with `stroke` an outline |
| `poly(layer, o)` | `points, colour, stroke, closed (true), dash, rotate` | `points` is `[{ x, y }, …]`, at least two. Filled; with `stroke` a line. `closed: false` leaves a polyline open |
| `arc(layer, o)` | `x, y, r, from, to, colour, width (2), dash` | A stroked circular arc. Angles are radians, clockwise from the +x axis (3 o'clock); `-Math.PI / 2` is 12 o'clock |
| `trail(layer, from, to, o)` | `colour, width (6)` | A round-capped segment from `{ x, y }` to `{ x, y }` |
| `text(layer, o)` | `x, y, value, colour ("#fff"), size (16), align ("left"), weight, italic (false), family (system-ui, sans-serif), baseline ("alphabetic"), maxWidth, outline, spacing, rotate` | Text. See below |
| `shake(dx, dy)` | arena units | Shifts every layer without a redraw; `shake(0, 0)` or `shake()` resets |
| `arena()` | — | `{ w, h }` |
| `scale()` | — | CSS pixels per arena unit: 1 on a wide screen, less on a narrow one |
| `pixelRatio()` | — | Backing-store pixels per arena unit |
| `colour(index)` | — | The colour of a seat |
| `layers()` | — | The layer names, back to front |
| `canvas(layer)` | — | The raw `<canvas>`, as a last resort |

Every drawing call also takes:

| Option | Type | Meaning |
|---|---|---|
| `alpha` | 0 to 1 | Opacity of this one call |
| `glow` | `{ colour, blur (12), x (0), y (0) }` | A soft halo behind this one call; with `x` and `y`, a drop shadow. In arena units |

Options of some calls:

| Option | On | Type | Meaning |
|---|---|---|---|
| `stroke` | `disc`, `box`, `ellipse`, `poly` | number | A line width in arena units: the shape is outlined, not filled |
| `dash` | `poly` with `stroke`, `arc` | `[on, off, …]` | Lengths in arena units, repeated along the line: `[12, 8]` is 12 drawn, 8 open |
| `radius` | `box` | number | Corner radius in arena units |
| `rotate` | `box`, `ellipse`, `poly`, `text` | radians, clockwise | Turns this one call about the shape's centre: the middle of a box, the `x, y` of an ellipse, the middle of a polygon's bounding box, the `x, y` anchor of a text. A gradient turns with the shape |
| `spacing` | `text` | number | Extra arena units between characters (letter-spacing). The characters are placed one by one, so `maxWidth` is ignored with it |

```js
// A spinning rounded card, and a label tilted about its own middle.
surface.box("actors", { x: x - 20, y: y - 14, w: 40, h: 28, radius: 6, rotate: ctx.time() * 2, colour: "#ffd54a" });
surface.text("actors", { x, y, value: "GO", size: 48, weight: 900, spacing: 6, rotate: -0.1, align: "center", baseline: "middle" });
```

**Colours.** `colour` is any CSS colour string: `"#ffb300"`, `"rgb(255 179 0)"`,
`"rgba(255, 179, 0, 0.4)"`, `"hsl(40 100% 50%)"`, a named colour. Or a
gradient, in arena units:

```js
colour: { linear: [x0, y0, x1, y1], stops: [[0, "#151b2c"], [1, "#05060a"]] }
colour: { radial: [x0, y0, r0, x1, y1, r1], stops: [[0, "#fff"], [1, "rgba(255, 255, 255, 0)"]] }
```

**Text.** `align` is `"left"`, `"center"` or `"right"` and says which point of
the text sits at `x`. `baseline` is `"alphabetic"`, `"top"`, `"middle"` or
`"bottom"` and says which sits at `y`. `family` is a CSS font stack; see
[Typography](#typography). `weight` is a CSS weight (`700`, `"bold"`).
`outline` is `{ colour ("#000"), width (3) }`, drawn under the fill.
`maxWidth` squeezes a longer text into that many units. `spacing` adds that
many units between characters, and with `align: "center"` the spaced text is
still centred on `x`. `rotate` turns the text about `(x, y)`, so centre it
with `align: "center", baseline: "middle"` to spin it in place.

```js
surface.text("actors", {
  x: w / 2, y: h / 2, value: "3", size: 110, weight: 900, family: 'Impact, "Arial Narrow Bold", sans-serif',
  align: "center", baseline: "middle", colour: "#ffd54a", outline: { colour: "#05060a", width: 8 },
});
```

**Layers.** A layer is a canvas. `world` is under `actors`. Nothing clears a
layer between frames, so `world` keeps what you paint on it: paint the floor
once per round, and clear and redraw `actors` every frame. The engine clears
every layer when a round starts, and then calls `onRound`.

**Raw canvas.** `surface.canvas(layer).getContext("2d")` returns the context
the surface draws with. Its transform already maps arena units to backing
pixels. Call `save()` and `restore()` around your own state, and never reset
the transform.

## Arena and screen

The arena is the board, in arena units. `arena(players)` decides it; without
one, `arenaFor(players)` does, and the board's area grows with the player
count:

```
factor = sqrt((1 + (players − 1) × perPlayer) × scale)        perPlayer 0.35, scale 1
w = baseW × factor, h = baseH × factor, each rounded to 4     baseW 800, baseH 600
```

| Players | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| `arenaFor(n)` | 800×600 | 928×696 | 1044×784 | 1144×860 | 1240×928 | 1328×996 | 1408×1056 | 1484×1116 |

`arenaFor(players, { baseW, baseH, perPlayer, scale })` takes other values.
A fixed board is `arena: () => ({ w: 960, h: 600 })`; export the same as
`ARENA` from `game.js`.

**How the board reaches the screen.** The engine sets three things on the
arena element: `width: min(<w>px, 100%)`, `aspect-ratio: w / h`, and the
custom properties `--arena-w` and `--arena-h`. So:

- One arena unit is at most one CSS pixel. The board never grows past its own
  size on a wide screen; it shrinks to fit a narrow one.
- The element's parent needs a definite width (a `1fr` grid column, a block,
  `width: 100%`). In a shrink-to-fit parent the arena collapses to nothing.
- The width rule ignores the viewport height. A 1144×860 board is taller than
  a laptop screen. Cap it in the stylesheet:

```css
.arena { max-width: min(100%, calc((100vh - 9rem) * var(--arena-w, 4) / var(--arena-h, 3))); }
```

**A 360 px phone.** With 16 px of page padding the arena is 328 CSS pixels
wide. A four-player default board is 1144 units wide, so `surface.scale()` is
0.29: a radius of 12 units is 3.4 pixels on screen, and 13-unit text is
3.7 pixels. Design for it:

- Make actors big: a radius of 14 units is the floor for a four-player board.
- Keep words out of the canvas. The `hud` slot, the scoreboard and the banner
  are page text and stay readable at any width.
- For text that must sit on the canvas, divide by the scale:
  `size: 13 / Math.max(0.45, surface.scale())`.
- Or use a smaller fixed board for a game that is played on phones.

**Pixel density.** The canvases' backing store is `arena × pixelRatio`, where
the ratio is the device's, capped at 2. Drawing coordinates stay in arena
units, so text and edges are crisp on a high-density screen with no work from
the game. `pixelRatio: 1` in `startGame` turns it off for a game that fills
large areas every frame on slow phones.

## Page slots

The engine owns behaviour. The game owns its page and its stylesheet. A page
that contains an element with `data-engine="arena"` owns its look: the engine
builds no chrome, injects no theme or layout rule, and binds behaviour to the
page's own elements by role. Use each role once; any element type works unless
the table names one.

| Role | Required | The engine |
|---|---|---|
| `arena` | yes | Mounts the canvas layers (or the game's `mount`) and the diagnostics overlay in it; sets its `width`, `aspect-ratio`, `--arena-w` and `--arena-h` |
| `name` | yes | `<input>`: offers the stored player name, stores a change |
| `create` | yes | Click creates a room; disabled once in a room |
| `code` | yes | `<input>`: the room code to join; filled with the room once in one |
| `join` | yes | Click joins the room in `code`; disabled once in a room |
| `start` | yes | Click starts the match; hidden unless this peer may start |
| `invite-link` | for the contract | `<a>`: `href` and text become the full `?room=CODE` link. Without it the invite is never shown and conformance fails `create` |
| `copy` | no | Click copies the invite link; its text confirms for 1.5 s, then returns |
| `room-code` | no | Text becomes the room code |
| `status` | no | Text becomes the connection state, `waiting for players: 1 of 2 connected`, or `error: <code>` |
| `mute` | no | Click toggles sound; text becomes `sound on` or `sound off` |
| `peers` | no | A list: one `<li data-channel="none\|connecting\|open\|…">` per peer with classes `host` and `you`; text is the name, plus `(you)`, `(watching)`, `(away)` |
| `scores` | no | A list of score rows; see [Scoreboard](#scoreboard) |
| `banner` | no | Text becomes the round or winner banner; shown and hidden; `data-kind` is `round`, `over`, `win` or `note`. Added to the arena when absent |
| `next` | no | Click starts the next round or match (host); shown when a round is over, with the `labels.next` text |
| `hud` | no | Text becomes the `ctx.hud(text)` line |
| `lobby` | no | Hidden when the match starts |
| `game` | no | Shown when the match starts |
| `room-info` | no | Shown once this peer is in a room |
| `invite` | no | Shown to the host once in a room |
| `host-controls` | no | Shown to the host once in a room |
| `wait` | no | Shown to a guest once in a room |

Rules the stylesheet can rely on:

- "Shown" and "hidden" mean the `hidden` attribute. Start the elements that are
  not visible at rest with `hidden` in the markup, and keep
  `[hidden] { display: none !important; }` so a `display` rule cannot undo it.
- The engine sets `data-touch="on"` on the container (`#game`, else `<body>`) on a
  touch device when the page has touch controls, and `data-overlay="on"` while
  the diagnostics overlay is open.
- The canvases are `canvas.engine-layer`, absolutely positioned to fill the
  arena. Give the arena a background and a border, not a size.
- The page keeps its own header, title, and link back to the superapp; the
  engine adds none. Conformance fails `link` without one.
- The page keeps the import map, one `<script type="module" src="/client.js">`
  and its stylesheet link. It adds no other script.

### Touch controls

A phone has no keyboard. Touch controls are the page's own elements.

```html
<div class="stick" data-engine-stick="mx,my"><i></i></div>
<button data-engine-touch="boost=1" aria-label="Boost">BOOST</button>
<button data-engine-touch="turn=-1" aria-label="Turn left">◀</button>
```

| Attribute | On | Value | Meaning |
|---|---|---|---|
| `data-engine-touch` | Any element | `<intent field>=<number>` | The field takes the number while a finger is on the element, and nothing after |
| `data-engine-stick` | Any element | `<x field>,<y field>` | A thumb stick: one drag drives two fields. Down and right are positive |
| `data-stick-mode` | The stick | `8way` (default) or `analog` | `8way`: each field is its `min`, 0 or its `max`. `analog`: the deflection in eighths, scaled to the field's range |
| `data-stick-dead` | The stick | 0 to below 1 (default `params.STICK_DEAD_ZONE`, 0.25) | Fraction of the radius that counts as centre |

What the engine sets, for the stylesheet:

| Set by the engine | On | When |
|---|---|---|
| `data-pressed` | A touch button | While a finger holds it |
| `data-active` | A stick | While it is dragged |
| `--stick-x`, `--stick-y` | A stick | −1 to 1: where the thumb is. Move the knob with `transform: translate(calc(var(--stick-x, 0) * 38px), calc(var(--stick-y, 0) * 38px))` |
| `touch-action: none`, `user-select: none` | Both | Always, so a drag does not scroll the page |

Behaviour:

- A finger that slides from one touch button onto another moves the hold with
  it, so a left and a right button work as a rocker. A finger that leaves all
  buttons holds nothing.
- Two fingers on two buttons of one field: the last one down wins, and the
  survivor's value returns when it lifts.
- A stick or a button works with a mouse too.
- A field that is not in `INTENT` throws at start, and fails the `slots` row of
  conformance before that.
- Show the controls only under `[data-touch="on"]`. Give each a size of at
  least 44 CSS pixels; a thumb control wants 96 or more.
- A control an element cannot express (a tap on the board, mouse look) calls
  `ctx.intent(field, value)` from `draw`, or `startGame(...).intent(field, value)`
  from a listener the page adds itself.

### Scoreboard

The `scores` slot is a list. The engine fills it with one row per player:

```html
<li class="you host dead" data-state="holder">
  <span class="swatch" style="background:#35d0e6"></span>
  <span class="name">Ann</span>
  <strong class="score">3</strong>
  <span class="note">BOMB</span>
</li>
```

| Part | Present when |
|---|---|
| `li.you` | The row is the local player |
| `li.host` | The row is the host |
| `li.dead` | The row has `alive: false` |
| `li[data-state]` | The row has a `state` string |
| `span.note` | The row has a `note` string |

The name and the score are separate elements with no punctuation between
them; the stylesheet adds any (`.name::after { content: ":"; }`).

Without a `scoreboard` hook, rows are the players, redrawn when a score
changes. A hook makes the rows follow the game as it is played:

```js
scoreboard(players, scores, snapshot) {
  return players.map((player, i) => ({
    ...player,                                        // name, score, colour, you, host
    alive: snapshot ? snapshot.alive[i] : true,
    state: snapshot?.holder === i ? "holder" : "",
    note: snapshot?.holder === i ? "BOMB" : "",
  }));
}
```

| Row field | Type | Meaning |
|---|---|---|
| `name` | string | Required |
| `score` | number | Default 0 |
| `colour` | CSS colour | Default: the seat's colour |
| `alive` | boolean | `false` adds `li.dead` |
| `you`, `host` | boolean | Set by the engine on the `players` it passes in |
| `state` | string | Becomes `data-state` |
| `note` | string | Becomes `span.note` |

The hook runs once per tick on screen, and when a score changes. `snapshot`
is the one being drawn, and `null` before the first frame of a match. The list
is rebuilt only when a row's content changes. Rows need not be one per player:
a team game returns one row per team.

### Default chrome

A page without an arena slot gets the engine's own chrome: give it
`<div id="game"></div>` and the engine builds the header, lobby, invite panel,
arena, scoreboard and `touchControls` buttons into it, styles them with its
own light and dark theme, and links back to the superapp. This is a fallback
for a prototype; a game in the catalog owns its page.

## Sound

`audioMap` maps a snapshot field to a sound. A game writes no audio code and
cannot play a sound any other way.

```js
audioMap: {
  took: "pickup",                                              // field name: sound name
  boosted: { sound: "whoosh", gain: 0.6, pitch: [0.9, 1.2] },
  mine: { sound: "pickup", field: "took", only: "me" },        // two entries may read one field
  tk: { sound: "tick", pitch: (snapshot, player) => 0.8 + 0.9 * (1 - snapshot.fuse / snapshot.fuseMax) },
  go: "go",
},
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| (key) | string | — | The snapshot field to read, unless `field` names another |
| `sound` | string | required | A name from the table below, or a key of `audioAssets` |
| `field` | string | the key | The snapshot field; lets several entries read one field |
| `gain` | 0 to 1, or `(snapshot, player) => number` | 1 | Volume of each voice |
| `pitch` | `[lo, hi]`, a number, or `(snapshot, player) => number` | 1 | Playback rate. A range picks a random rate per voice; a function is clamped to 0.25…4 |
| `only` | `"me"` or `"others"` | — | Play only the local player's entries of an event list, or only everyone else's |

| Field value | Voices started |
|---|---|
| A `players` list | One per entry, on the tick it appears |
| A `bool` | One on every tick it is true: keep it true for one tick |
| A `bool` per player | One per true entry, on every tick: usually not what you want |

A sound plays when the screen reaches its tick: at once on the host, three
ticks later on a guest, in step with what the guest sees. At most
`params.AUDIO_MAX_VOICES` (16) play at once. Sound is silent until the first
click or key press, which browsers require. An unknown sound name throws at
start.

The shared set, `SOUND_NAMES`:

| Sound | Character |
|---|---|
| `blip` | short high square blip: a tap, a step, a menu move |
| `hit` | noisy falling thump: a collision, a death, damage |
| `score` | two rising notes: a point scored |
| `start` | three rising notes: a round or a bomb starts |
| `win` | four-note rising arpeggio: a match won |
| `boom` | deep explosion with a noisy tail |
| `tick` | dry clock tick: a fuse, a timer |
| `whoosh` | airy swell: a dash, a swing, a fast pass |
| `pickup` | bright rising chirp: a coin, a pellet, an item |
| `bounce` | rubbery upward boing: a wall or a paddle |
| `buzz` | low flat buzzer: refused, wrong, out of ammo |
| `beep` | plain countdown beep: three, two, one |
| `go` | longer high beep that ends a countdown |
| `fanfare` | six-note flourish: a big win |
| `pop` | small bubbly pop: a spawn, a burst, a tag |
| `powerup` | rising sweep of five notes: a buff begins |
| `zap` | fast falling laser: a shot, a spark |
| `thud` | soft low knock: a landing, a block placed |
| `lose` | three falling notes: a round lost |
| `click` | tiny noise click: a UI press, a ratchet |

Twenty sounds make many more with `pitch`: `hit` at 0.6 is a heavy impact and
at 1.8 a slap; `tick` on a rising `pitch` function is a fuse; `blip` at three
pitches is three different players.

The set is generated by `node scripts/make-assets.mjs` into
`public/assets/<ASSET_SET_VERSION>/`; every byte is first-party. An engine
version loads the set its own `params.ASSET_SET_VERSION` names, so an earlier
set stays on disk for the engine versions that load it.

## How it behaves

### The draw lifecycle

- `draw` does not run in the lobby. It starts with the first snapshot of the
  first round.
- From then on it runs once per animation frame, on every peer, forever:
  during a round, after `roundOver`, between rounds, after the match is won.
  After a round ends it keeps receiving the last snapshot of that round, so
  animation driven by `ctx.time()` continues and the scene stays up.
- A hidden tab gets no frames. The host's simulation keeps its tick rate there
  (it runs on a worker timer); only its drawing stops.
- A round start clears every layer, then calls `onRound(n, ctx)`. Reset
  cosmetic state there: particles, trails, a "floor is painted" flag.
  `ctx.round()` gives the number inside `draw`.
- Derive everything that matters from the snapshot. Keep only cosmetic state
  in `client.js`: a late joiner and a reloaded tab start with none of it.

### Host and guests

| | Host | Guest |
|---|---|---|
| Runs the simulation | Yes | No |
| Snapshot given to `draw` | The newest one, as returned by `step` | One blended between two received snapshots, `params.INTERP_BUFFER_TICKS` (3) ticks behind the newest |
| Fields in `interpolate` | Exact | Blended every frame |
| Every other field | Exact | The value of the older of the two snapshots |
| Input latency | None | One trip to the host |
| Frames per tick | About two at 30 Hz on a 60 Hz screen; the same snapshot is drawn twice | The same, with different blends |
| `ctx.tickFraction()` | The part of a tick since the last step, at most 1 | The blend between the two snapshots, 0 to 1 |

A frame can also span more than one tick: after a slow frame, or on a 30 Hz
screen with a 60 Hz simulation.

**Discrete fields step, and they step late on a guest.** A counter, an age or
a flag is not blended: a guest shows the value of the older snapshot, which is
`params.INTERP_BUFFER_TICKS` (3) ticks behind the host. A flash driven by an
age field therefore starts about three ticks (0.1 s at 30 Hz) later on a guest
than on the host, in step with the positions that guest sees. That is
harmless; do not compensate for it. To move something smoothly between two
ticks without interpolating its field, subtract or add `ctx.tickFraction()`:
`snap.ready - ctx.tickFraction()` is a countdown that runs smoothly on the
host and on guests.

### Events and state

An event field holds its entries for exactly one tick. A snapshot handed to
`draw` is therefore the wrong place to look for it: the same snapshot is drawn
more than once, and a tick can pass between two frames. Reading `snap.took`
in `draw` fires an effect twice, or never.

| For | Use | Why |
|---|---|---|
| A sound | An event field in `audioMap` | The engine plays each tick once, when the screen reaches it |
| A one-shot visual: particles, a shake, a scorch mark, a floating "+1" | `ctx.events(field)` in `draw` | Each entry arrives exactly once, on the host and on guests, even when a frame spans several ticks |
| Anything visible for longer than a tick: a cooldown ring, a blast that expands, a flash that fades | A counter or an age field in the snapshot | A late joiner, a reloaded tab and a skipped frame all still see it |

```js
for (const event of ctx.events("took")) {
  const x = event.snapshot.x[event.player];    // the exact snapshot of the event's tick
  spawnSparks(x, event.snapshot.y[event.player], ctx.colourFor(event.player));
}
```

`ctx.events` returns the same list for the whole frame and an empty one on
the next. After a stall it replays at most `params.EVENT_BACKLOG_TICKS` (30)
ticks. It throws for a field that is not a `players` list or a scalar `bool`.

### Rounds and matches

1. The host clicks Start. Refused below `minPlayers`.
2. Every connected peer gets a seat, in the order host, then guests, up to
   `params.MAX_PLAYERS_PER_ROOM` (8). `target(players)` is fixed for the match.
3. A round: `startRound()`, the `round` banner, then `step` at `tickHz`.
4. `roundOver` becomes true. The engine calls `winner(target)` and shows the
   `over` banner with the winner's name, or with `null`. The host's `next`
   control appears with the `labels.next` text. Guests wait.
5. The host clicks `next`, or presses `nextKey`. With no match winner, the
   next round starts with the same seats. With a winner, a **new match**
   starts: a new simulation, scores at zero, and seats for everyone connected
   at that moment.

**Space.** `nextKey` is `"Space"` by default, and Space is also the natural
action key. The engine does two things about it: the key is ignored for
`params.NEXT_ROUND_GUARD_MS` (600 ms) after a round ends, and a held key
(auto-repeat) never counts. A host who is still mashing Space after that
starts the next round early. So if Space is an action in your game, set
`nextKey: "Enter"` and say so in the page.

### Late joiners and spectators

A peer that joins after Start watches. It gets the lobby, the round and a full
snapshot at once, so `draw` runs from its first frame; `ctx.seat()` is −1,
`ctx.spectator()` is true, its input is ignored, and the peer list marks it
`(watching)`. It gets a seat when the host starts the next match. Up to
`params.MAX_SPECTATORS_PER_ROOM` (8) may watch.

Write the spectator's status line: `if (ctx.seat() < 0) ctx.hud("Watching. You get a seat in the next match.")`.

### A player leaves

When the signaling server reports that a seated player's connection closed
(tab closed, reload, network gone), the host sets that seat's intent to `0`
and calls `disconnect(index)` once. The seat stays in every array. A player
who comes back inside the same match watches the rest of it and is seated
again in the next match. If the host leaves, the match is lost: the state
lived in that tab.

### Nothing from another origin

The page may load nothing from another origin except the pinned engine and
its asset set: no web font, no CDN script, no remote image, no analytics, no
`@import` of a remote stylesheet, no `fetch` to an API. The soak run denies
every other origin and fails on the attempt, and so does a player on a train.
Static conformance fails the `origin` row for an absolute URL in
`index.html`, in any stylesheet under `public/`, or in a script. A link the
player follows (`<a href>`) is not a load.

Ship files under `public/` and reference them by a local path.

## Game feel cookbook

Short patterns, each true of the engine as documented above. `fx` is cosmetic
state in `client.js`; reset it in `onRound`.

**Screen shake.** Shake moves the layers; nothing is redrawn.

```js
for (const hit of ctx.events("d")) fx.shake = 0.3;                // seconds
fx.shake = Math.max(0, fx.shake - ctx.dt());
surface.shake(Math.sin(ctx.time() * 90) * fx.shake * 40, Math.cos(ctx.time() * 70) * fx.shake * 40);
```

Keep it under 12 units for small events and under 0.4 s. Shake only the
player it concerns when the event is personal: `if (hit.player === ctx.seat())`.

**Particles from events.**

```js
for (const e of ctx.events("took")) {
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    fx.sparks.push({ x: e.snapshot.x[e.player], y: e.snapshot.y[e.player], vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, life: 0.45, colour: ctx.colourFor(e.player) });
  }
}
fx.sparks = fx.sparks.filter((s) => (s.life -= ctx.dt()) > 0);
for (const s of fx.sparks) { s.x += s.vx * ctx.dt(); s.y += s.vy * ctx.dt(); surface.disc("actors", { x: s.x, y: s.y, r: 3, colour: s.colour, alpha: s.life * 2 }); }
```

**Trails.** Paint on the persistent layer and never clear it during a round.

```js
const last = fx.last[i];
if (last) surface.trail("world", last, { x, y }, { colour: ctx.colourFor(i), width: 6 });
fx.last[i] = { x, y };                                             // reset fx.last = [] in onRound
```

A late joiner sees only the trail drawn since it arrived. When the trail
matters to the rules, as in a light-cycle game, send it in the snapshot or
make it rebuildable from one.

**A fading trail** needs no state: draw the last few positions from a counter,
or fade the layer with a translucent box each frame:

```js
surface.box("world", { x: 0, y: 0, w, h, colour: "rgba(5, 6, 10, 0.12)" });
```

**Countdown.** A snapshot counter, drawn big, with a beep flag per second.

```js
// game.js: ready counts down from 90 at 30 Hz; beep is true when a second starts; go when it ends
if (snap.ready > 0) surface.text("actors", { x: w / 2, y: h / 2, value: Math.ceil(snap.ready / 30), size: 120, align: "center", baseline: "middle", weight: 900 });
// client.js: audioMap: { beep: "beep", go: "go" }
```

**Hit flash.** An age field, not an event, so it survives a skipped frame.

```js
if (snap.hurt[i] < 6) surface.disc("actors", { x, y, r: R + 2, colour: "#fff", alpha: 1 - snap.hurt[i] / 6 });
```

A full-screen flash is one translucent box on the top layer for four to six
ticks. Keep its alpha under 0.6, and skip it under
`matchMedia("(prefers-reduced-motion: reduce)")`.

**Squash, pulse, bob.** Cosmetic motion comes from `ctx.time()`.

```js
const pulse = 1 + Math.sin(ctx.time() * 6) * 0.15;
surface.disc("actors", { x, y, r: 9 * pulse, colour: GOLD, glow: { colour: GOLD, blur: 18 } });
```

**Squash and stretch.** An ellipse turned into the direction of travel, longer
along it and thinner across it. The velocity is cosmetic state, so nothing is
added to the snapshot. The host draws one snapshot on two frames, so measure
speed between two changes of position, not between two frames.

```js
const m = (fx.motion[i] ??= { x, y, at: ctx.time(), vx: 0, vy: 0 });      // reset fx.motion = [] in onRound
const since = Math.max(0.004, ctx.time() - m.at);
if (x !== m.x || y !== m.y) Object.assign(m, { vx: (x - m.x) / since, vy: (y - m.y) / since, x, y, at: ctx.time() });
else if (since > 0.1) m.vx = m.vy = 0;
const stretch = Math.min(0.35, Math.hypot(m.vx, m.vy) / 900);              // units a second
surface.ellipse("actors", { x, y, rx: R * (1 + stretch), ry: R * (1 - stretch), rotate: Math.atan2(m.vy, m.vx), colour: ctx.colourFor(i) });
```

**Spinning pickup.** A rounded box that turns with the clock and bobs.

```js
const bob = Math.sin(ctx.time() * 4) * 3;
surface.box("actors", { x: px - 10, y: py - 10 + bob, w: 20, h: 20, radius: 5, rotate: ctx.time() * 3, colour: GOLD, glow: { colour: GOLD, blur: 14 } });
```

**Smooth countdown ring.** A counter steps once per tick, and a ring drawn
from it ticks visibly. `ctx.tickFraction()` fills the gap between two ticks.

```js
// game.js: t counts down from tMax, one per tick
const left = Math.max(0, snap.t - ctx.tickFraction()) / snap.tMax;
surface.arc("actors", { x, y, r: 40, from: -Math.PI / 2, to: -Math.PI / 2 + Math.PI * 2 * left, colour: GOLD, width: 6 });
```

**Mark the local player.** Every frame, by shape and not only by colour: a
ring, an arrow above, a thicker outline. Other players get their name.

```js
if (i === ctx.seat()) surface.disc("actors", { x, y, r: R + 5, colour: "#fff", stroke: 2 });
else surface.text("actors", { x, y: y + R + 4, value: ctx.players()[i].name, size: 12 / Math.max(0.45, surface.scale()), align: "center", baseline: "top" });
```

**Crowded names.** Eight name labels on one spot are unreadable. Draw a name
only where it helps: never for the local player (the ring says "you"), and
for another player only when nobody else is close, or only for the one
nearest to the local player. The scoreboard carries every name and colour.

```js
const crowded = snap.x.some((ox, j) => j !== i && Math.hypot(ox - x, snap.y[j] - y) < R * 4);
if (i !== ctx.seat() && !crowded) surface.text("actors", { x, y: y + R + 4, value: ctx.players()[i].name, size: 12 / Math.max(0.45, surface.scale()), align: "center", baseline: "top" });
```

**HUD patterns.**

| Information | Where |
|---|---|
| What to do right now, in one sentence | `ctx.hud(text)`, different for each state: spectator, round over (host / guest), dead, the special role, the default |
| Scores, who is out, who has the bomb | The scoreboard hook: `alive`, `state`, `note` |
| A timer or a meter everyone watches | The canvas: a bar along the top edge, wide and thick |
| A cooldown that belongs to one player | An arc around that player: `surface.arc` from `-Math.PI / 2` |
| Round start, round result, match result | The banner, through `labels`; style `[data-kind="win"]` apart |

**Phone layout.** One column: header, arena, HUD, touch controls, scoreboard.
The stick sits bottom left and the action button bottom right, both within
reach of a thumb, both at least 96 px. Hide keyboard hints under
`[data-touch="on"]`. For a phone on its side, cap the arena by height (the
`max-width` rule in [Arena and screen](#arena-and-screen)) and float the
controls over the board's lower corners with `pointer-events: none` on their
wrapper.

**Phone header.** At 360 px the header has 328 px. It must fit one or two
rows: the title on the left, the chips (mute, all games) on the right, and
the status line on a row of its own. A title that wraps, or chips that drop
under it one by one, push the board off the first screen.

```css
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.5rem; }
.top h1 { margin-right: auto; font-size: 1.3rem; white-space: nowrap; }
.top .status { order: 9; flex-basis: 100%; }
```

**Eight players on a phone.** The default board for eight is 1484 units wide,
so one unit is 0.22 CSS pixels at 360 px: a radius of 12 units is under
3 pixels. Three things keep a full room playable there. Keep an actor at
7 CSS pixels of radius or more on that screen: 32 units on the default
eight-player board. Scale the board per player count, in two or three steps,
instead of one large board for everybody: `arena: (players) => …`, with the
same function exported as `ARENA`. And let the scoreboard wrap into two
columns under the controls, so eight rows do not push the board away.

**State on the page, not only on the canvas.** `client.js` may set a `data-`
attribute or a class on an element of its own page, from `draw` or from a
hook, so the stylesheet can follow the game: a touch button whose label
follows the player's role, a HUD that changes colour for a ghost. Set it only
when the value changes. `game.js` may not touch the DOM, and `client.js` must
not show, hide or rewrite an element that carries a `data-engine` role; the
engine owns those.

```html
<button class="act" data-engine-touch="act=1" aria-label="Dash, or crack a plate after you fell">
  <span class="alive">DASH</span><span class="ghost">CRACK</span>
</button>
```

```css
.act .ghost, [data-role="ghost"] .act .alive { display: none; }
[data-role="ghost"] .act .ghost { display: inline; }
```

```js
// in draw: one write per change of role
const role = me < 0 ? "watch" : snap.alive[me] ? "alive" : "ghost";
if (role !== fx.role) { fx.role = role; document.body.dataset.role = role; }
```

`fx.role` is cosmetic state like any other: a reloaded tab sets it again on
its first frame, because it is derived from the snapshot.

**Two players.** Check every elimination design with two: the first fall
ends the round, so the role of an eliminated player (a ghost, a vote, a
hazard) never appears. Either that role still matters with two, for example
because a round has several lives, or the round loop is fast: a short
countdown, a result that reads in two seconds, and a next round one key away.

**Crisp text.** Canvas text is crisp on any screen without work. Prefer page
text for sentences. For a display word on the canvas use a heavy weight, an
`outline` in the background colour and a size of at least 28 units; small
thin canvas text is the first thing to turn to mush on a phone.

**Colour.** Pick a background, one accent, and eight player colours that all
read on that background. Check them at 3 px radius. Never tell two things
apart by hue alone: pair red/green with a shape, a pattern or a label. Use
the accent for one meaning only (danger, or "you", not both). Put translucent
dark (`rgba(0, 0, 0, 0.35)`) under anything bright to lift it off the floor.

**Sound mapping.** Give every player action a sound, quiet and short. Give
the local player's own events a different, richer sound than everyone else's
(`only: "me"` and `only: "others"`). Let the stakes raise the pitch: a
function of a snapshot field. One loud sound per round, for the moment the
round turns on. See [Sound](#sound).

## Look at your game

The author of a game must see it. One command plays it in a headless browser
and saves screenshots:

```bash
node scripts/play.mjs my-game --phone --rounds 3 --shots /tmp/my-game-shots
```

It starts the game's server against this checkout's engine, opens a host and
guests, starts a match, plays it with the game's bot (or with scripted or
random input), joins a late spectator, and stops everything. Then read the
PNG files.

| Option | Default | Meaning |
|---|---|---|
| `--guests <n>` | 2 | Guests beside the host. A game with `minPlayers: 3` needs 2 or more; 7 fills the room |
| `--seconds <s>` | 12; with `--rounds`, 45 for each round | Seconds of play after Start: the time limit of the run |
| `--rounds <n>` | — | Keep playing, the host starting each next round, until `n` rounds have ended or `--seconds` have passed |
| `--shots <dir>` | — | Where the PNG files go |
| `--frames <n>` | 4 | In-game screenshots per page, spread over the run. With `--rounds`: per page and per round, the n-th one n × (n + 1) seconds into the round (2 s, 6 s, 12 s, 20 s) |
| `--phone` | off | `guest-1` is a 360×740 touch phone. Without a bot it plays with the stick and the touch buttons |
| `--bot <file>` | `test/bot.mjs` of the game, when it exists | The module that plays the game; see [Bots](#bots) |
| `--no-bot` | — | Random players even when the game has a `test/bot.mjs` |
| `--keys <list>` | arrows, WASD, Space | The key codes random players press |
| `--script <file>` | — | Timed input instead of a bot or random play: `[{ "at": 0.5, "page": "host", "down": "ArrowLeft" }, { "at": 1.2, "page": "host", "up": "ArrowLeft" }, { "at": 2, "page": "all", "tap": "Space" }, { "at": 3, "shot": "after-dash" }]` |
| `--seed <n>` | 1 | Seed of the random players |
| `--no-late` | — | No late spectator |
| `--online` | — | Do not deny other origins |
| `--port <n>`, `--json <file>` | a free port, — | The server's port; a copy of the summary |

| File | Shows |
|---|---|
| `01-lobby-desktop.png`, `02-lobby-phone.png` | The page before a room, at 1280×800 and at 360×740 |
| `03-room-<page>.png` | The room with everyone connected, before Start |
| `04-game-<page>-<n>.png` | The match, `--frames` times per page; `<n>` is `01`, `02`, … or a script's shot name. With `--rounds` it is `r<round>-<n>`: `04-game-host-r2-03.png` |
| `05-over-<page>.png` | The result of the first round that ended |
| `05-over-<page>-r<round>.png` | The result of each later round, the match result included |
| `06-spectator.png` | What a late joiner sees |

`<page>` is `host`, `guest-1`, `guest-2`, … `<round>` counts the rounds of the
run from 1, across matches.

The summary on stdout is one JSON document:

| Key | Holds |
|---|---|
| `ok`, `problems` | The verdict, and every reason against it |
| `roundsEnded` | How many rounds ended during the run |
| `matchesWon` | How many of those rounds ended a match |
| `stopped` | `"rounds"` when `--rounds` was reached, `"seconds"` when the time limit ended the run |
| `final` | The host's `{ round, over, winner, scores, target }` when the run stopped. `round` is the round number inside the current match; `over: true` means the run stopped on a round result, `false` in the middle of a round |
| `bot` | The path of the bot that played, or `null` |
| `shots` | The PNG files written |
| `pages` | Per page: `errors`, `requestsToOtherOrigins`, `state` (`__engine.state()`), `snapshot` (the one on screen), `hud`, `banner`, `scores`, `next`, `touch`, `viewport`, `arena` (its size in CSS pixels), `scrollsSideways` and `bot` (`{ calls, error }`) |

The exit status is 1 when a page logged an error, requested another origin,
scrolls sideways, is a phone with no touch controls, or has a bot that threw
or was never called.

### Bots

Random players lose a skill game in its first seconds: they fall at the first
drop, and the screenshots show ten seconds of round 1. A bot that plays the
game competently is how the author sees rounds 2 and later, the endgame, the
match result, eight players and the phone layout in play. Write it early, as
soon as the rules run; it is a few lines.

`test/bot.mjs` is picked up by `play.mjs` when it exists. The scaffold ships
one for its example game. Its core:

```js
export default function bot(snap, info) {
  const me = info.seat;
  const dx = snap.px - snap.x[me];
  const dy = snap.py - snap.y[me];
  return { ArrowLeft: dx < -6, ArrowRight: dx > 6, ArrowUp: dy < -6, ArrowDown: dy > 6, Space: snap.cd[me] === 0 && info.step % 4 < 2 };
}
```

The contract:

- The default export is `(snapshot, info) => keys`. `keys` is an object of
  `KeyboardEvent.code` to boolean: the keys to hold from now on. A key the
  answer does not name, or names as `false`, is released. No answer releases
  everything. The keys go through the game's own `bindings`, so use the codes
  the game binds.
- A button that acts on the press must be let go between two presses:
  `Space: wanted && info.step % 6 < 2`.
- It is called every 50 ms in every seated page, with that page's own seat,
  while a round is running. It is not called for a spectator or while a round
  is over; every key is released then, and the harness starts the next round.
- `snapshot` is the one on that page's screen, as `draw` receives it. Read it,
  do not write to it.
- The file is one self-contained module. It is loaded into the page from
  memory, where an `import` cannot resolve, so `play.mjs` refuses a bot that
  imports. Everything `public/game.js` exports is in `info.game`: constants,
  `ARENA`, helper functions.
- Variables at the top of the module are that page's own memory; each page
  loads its own copy.
- A phone page is played by the same bot through the same keys, so the touch
  controls are on screen but not pressed. Run once with `--no-bot --phone` to
  see the stick and the buttons drive the game.
- The game must pin an engine with `__engine.snapshot()`: 1.0.2 or later.

| `info` | Holds |
|---|---|
| `seat` | This page's player index |
| `players` | `[{ pid, owner, name, colour, score }]` in seat order |
| `scores` | The latest scores |
| `round` | The round number inside the match |
| `target` | The score target of the match |
| `isHost` | True on the host's page |
| `tick` | The snapshot's tick |
| `step` | How many times this page's bot has been called: a clock for press patterns and for a different habit per seat |
| `game` | The exports of `public/game.js` |

Make the seats differ (a reaction time per seat, a taste per seat), or eight
bots walk as one and the round never turns. `fuse/test/bot.mjs` and
`trapdoor/test/bot.mjs` are finished examples: a chaser, runners and ghosts;
a floor rebuilt from the snapshot with `info.game.layout`.

Without a bot, raise `--seconds`, lower `--guests`, or script the inputs, to
see `05-over`.

**The loop.** Change the game. Run `npm test`. Run `play.mjs`. Open the
screenshots and judge them as a player would: can I tell which one is me, what
is dangerous, what just happened, who is winning? Fix what you see. Repeat.

### The debug handle

`globalThis.__engine` is a read-only window for tools. `play.mjs` and the soak
run read it; a game never does.

| Member | Returns |
|---|---|
| `version` | The engine version string |
| `state()` | `{ room, selfId, isHost, spectator, players, tickHz, over, round, seat, target, scores, winner, peers, loop, workerLoop, audio }` |
| `snapshot()` | The snapshot most recently handed to `draw`; `null` before a match |
| `players()` | A copy of `[{ pid, owner, name, colour, score }]` |
| `diagnostics` | `{ enabled(), current(), samples(), series(name), worst(), breaches() }` |

In `state()`: `players` is the seat count; `round` is `null` before the first
round; `peers` is `[{ id, connection, channel }]`; `loop` is `{ ticks, dropped }`
on the host and `null` on a guest; `audio` is `{ unlocked, muted, voices,
started, context, loaded, failures }`.

To drive a page yourself, `scripts/lib/browser.mjs` is the helper `play.mjs`
is built on: `launch({ offline, args })`, `browser.newPage(url)`,
`page.goto(url)`, `page.evaluate(fn, ...args)`, `page.waitFor(fn, { timeout, args })`,
`page.errors`, `page.requests`, `page.cdp(method, params)`, `page.close()`,
`browser.close()`. Two things a new driver gets wrong:

- Call `page.cdp("Emulation.setFocusEmulationEnabled", { enabled: true })` on
  every page, or every page but the last one stops rendering frames.
- Launch with `args: ["--disable-features=WebRtcHideLocalIpsWithMdns"]`, or
  loopback ICE fails when `offline` is on.

`?overlay=1`, or Alt+Shift+D, shows the diagnostics overlay in the arena.

## Typography

The page loads no web font. Use a system stack per mood; each of these
resolves on Windows, macOS, iOS, Android and Linux:

| Mood | Stack |
|---|---|
| Neutral UI | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| Display, heavy and condensed | `Impact, Haettenschweiler, "Arial Narrow Bold", "Roboto Condensed", "Liberation Sans Narrow", sans-serif` |
| Condensed labels | `"Roboto Condensed", "Arial Narrow", "Liberation Sans Narrow", "Helvetica Neue", Arial, sans-serif` |
| Monospace, terminal, score digits | `ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace` |
| Serif, editorial or old-world | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif` |
| Rounded and friendly | `ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", sans-serif` |
| Slab, poster | `Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", Georgia, serif` |

A stack looks different on each system, so carry the identity with what does
not vary: letter-spacing, `text-transform`, weight, size contrast, colour, and
shapes drawn in CSS. `font-variant-numeric: tabular-nums` keeps a changing
score from jumping. Pass the same stack to `surface.text({ family })` so the
canvas matches the page.

A game may ship its own font files under `public/` when it owns the licence:

```css
@font-face { font-family: "Own Display"; src: url("/fonts/own-display.woff2") format("woff2"); font-display: swap; }
```

The shared asset set holds no fonts.

## Everything `engine.js` exports

| Export | Use |
|---|---|
| `startGame` | The one call a game makes |
| `defineSnapshot` (alias `snapshot`) | Schema to codec |
| `seededRng(seed)` | The deterministic generator |
| `validateSimulation(Class, opts)` | Throws naming what the class lacks |
| `record({ seed, tickHz, players })`, `replay(text, factory)`, `parseFixture`, `finalState` | Fixtures; see below |
| `arenaFor(players, { baseW, baseH, perPlayer, scale })` | Default arena, area grows with players |
| `PLAYER_COLOURS`, `colourFor(i)`, `paletteOf(list)` | Shared palette; a lookup for a game's own |
| `params` | Every tunable: `ENGINE_VERSION`, `MAX_PLAYERS_PER_ROOM`, `SNAPSHOT_BUDGET_BYTES`, … |
| `ENGINE` | The version string |
| `SOUND_NAMES`, `loadAssets(url, names)`, `manifestUrl`, `manifestUrlFor`, `auditLedger` | Shared asset set |
| `hostGame`, `joinGame`, `fixedTick`, `createBuffer`, `createSurface`, `createStage`, `inputSource`, `mountUi`, `labelsWith`, `createMixer`, `createWebAudio`, `createCollector`, `meterTransport`, `sparkline`, `workerTimers`, `connectSignal`, `createStar`, `ICE` | The parts `startGame` is assembled from. A game does not call them; conformance fails a game that runs its own loop or network |

Each module is also importable on its own from the same version directory.
Tests import from the checkout: `../../engine/sim.js`, `schema.js`, `rng.js`,
`replay.js`, `render2d.js`, `params.js`.

## Replay fixture

```js
const rec = record({ seed, tickHz: 30, players: 4 });
rec.round(); game.startRound();
rec.tick(intents); game.step(intents);          // once per tick
fs.writeFileSync("test/replay.ndjson", rec.finish(game));
// later
replay(fs.readFileSync("test/replay.ndjson", "utf8"), (n, opts, rng) => new Game(n, { arena: arenaFor(n) }, rng));
```

`replay` throws when the simulation diverges from the recorded final state or
writes to its inputs. Record at least three rounds with every intent value in
use, so the budget row measures real motion. `test/reference.mjs` holds the
scripted match; `RECORD=1 npm test` records it again.

## Conformance

```bash
node scripts/conformance.mjs <game-dir>            # full tier
node scripts/conformance.mjs <game-dir> --static   # source only: no browser, server or child process
node scripts/conformance.mjs https://<game>.wasmer.app
node scripts/conformance.mjs https://edge-multiplayer-games.wasmer.app   # superapp header rows
```

Options: `--json` (one document: `{ ok, tier, kind, rows: [{ id, title, status, detail }] }`),
`--root <checkout>`, `--offline`, `--port <n>`, `--engine-version <v>`.
Every row is always printed as `PASS`, `FAIL` or `SKIP`; exit status is 0 only
with no `FAIL`, 1 with a failing row, 2 for a usage error.

| Row | Full tier | Static tier |
|---|---|---|
| `healthz` | `GET /healthz`: JSON `{ ok, rooms, players }`, `access-control-allow-origin: *` | `src/server.js` is the engine call |
| `create` | Headless browser: `/?create=1` shows the invite link (the `invite-link` slot, visible and filled) with no input | `client.js` calls `startGame` from the pinned engine, no own lobby code; a page with slots has `invite-link` |
| `join` | Second browser context: `/?room=CODE` lands in the room | Same proof |
| `link` | The rendered page links to the superapp | `index.html` does; a bare-container page may rely on the kit's link |
| `slots` | A page with an arena slot has every required role, no unknown or repeated role, and touch buttons and sticks that name `INTENT` fields, on an engine version that binds them; otherwise it has a `#game` container | Same |
| `stylesheet` | Every local stylesheet the page links exists and is not empty; a page with slots brings one | Same |
| `origin` | `index.html`, every stylesheet under `public/` and every game script name no other origin: no remote `<link>`, `<script>`, `<img>`, `url(...)`, `@import` or absolute URL string | Same |
| `pinned` | Import map and import specifiers name `/engine/<x.y.z>/` on the superapp origin, or a vendored copy | Same |
| `published` | That version exists in `public/engine/<version>/` and is served | Exists on disk |
| `server` | `src/server.js` is exactly `serveGame({ publicDir })` | Same |
| `accumulator` | No `requestAnimationFrame`, `setInterval`, `fixedTick` in `public/**/*.js` | Same |
| `netcode` | No `RTCPeerConnection`, `new WebSocket`, `createDataChannel`, `?room` / `?create` handling | Same |
| `simulation` | `validateSimulation`, and no `Math.random`, `Date.now`, `setTimeout`, `document`, `window` in `game.js` | Same |
| `schema` | `SNAPSHOT` compiles, `INTENT` is non-empty | Same |
| `fixture` | `test/replay.ndjson` exists and replays | Same |
| `budget` | Largest encoded snapshot over the fixture ≤ budget × players | Same |
| `readme` | Headings for input, snapshot, round lifecycle | Same |
| `ledger` | Every asset in `public/assets/<v>/manifest-<v>.json` has a row in `ledger-<v>.json` and the reverse | Same |

A game may pin any published engine version; the pin need not be the current
one. Scans skip comments, string contents (except the `origin` scan, which
reads URL strings), `public/vendor/`, `public/engine/` and `*.min.js`. The
full tier starts `node src/server.js` on a free port with the checkout's
`public/` standing in for the superapp origin, refreshes the git-ignored
`engine/` copy if it is stale, and needs Chrome or Chromium (`CHROME_BIN`
overrides; a missing browser fails `create` and `join` as a named
prerequisite). The static tier uses only `node:fs`, `node:path`, `node:url`
and dynamic imports, so it runs under EdgeJS inside Wasmer; so does the
scaffold. A deployed origin runs the HTTP and browser rows and skips the rows
that need source. The superapp origin gets its own rows: `engine-reachable`,
`engine-cache`, `cors`, `cors-vary`, `index-lifetime`, `assets`, `ledger`.

A full run holds one server and one browser, and stops both before it returns.
Run the repository's script tests one file at a time:
`node --test --test-concurrency=1 scripts/*.test.mjs`.

## Other commands

| Command | Effect |
|---|---|
| `node scripts/dev.mjs <game> [port]` | Publish, copy the server half, serve the game with the local `public/` as the superapp. It runs until Ctrl+C or a kill of that process, and passes the signal on to the server, so the port is free afterwards |
| `node scripts/play.mjs <game> [options]` | Play the game headlessly and save screenshots; see [Look at your game](#look-at-your-game) |
| `node scripts/soak.mjs <game> --duration <s> --guests <n>` | A host and guests play offline while tick rate, snapshot size, memory, errors and foreign requests are asserted |
| `node scripts/sync-engine.mjs publish` | Copy `engine/*.js` to `public/engine/<ENGINE_VERSION>/`; run after every engine edit. Earlier version directories are frozen and stay untouched |
| `node scripts/sync-engine.mjs verify` | Fail when the published copy differs from `engine/`; the deploy and a test run it |
| `node scripts/sync-engine.mjs game <game>` | Copy the Node half (`params`, `rng`, `rooms`, `server`) into `<game>/engine/` |
| `node scripts/sync-engine.mjs vendor <game>` | Freeze: copy the engine into `<game>/public/engine/`, point the import map at `/engine/`, stop ignoring the copy |
| `node scripts/make-assets.mjs [--check]` | Write, or verify, the shared asset set of `ASSET_SET_VERSION` |
| `node scripts/sync-example.mjs [--check]` | Rewrite, or verify, the example in this file from `scripts/scaffold/` |
| `./deploy.sh <game> super` | Deploy; see below |

A vendored game needs no superapp origin and passes
`conformance.mjs <game> --offline`. Commit `public/engine/` with it.

## Moving a game from 1.0.1 to 1.0.2

A game pinned to 1.0.1 keeps working and needs no change. To move one, change
the version in its import map, then check these, which differ:

| 1.0.1 | 1.0.2 |
|---|---|
| The score row's name was `Ann: ` with a colon in it | The name is `Ann`; add punctuation in CSS |
| Canvases had one backing pixel per arena unit | They follow `devicePixelRatio` up to 2. Code that uses the raw canvas must not reset the transform |
| Space started the next round at once | It waits 600 ms after the round ends and ignores key repeat; `nextKey` moves it |
| A late joiner watched for the life of the room | It is seated in the next match |
| Guests could miss a sound after a slow frame | Each tick sounds once |
| Five shared sounds | Twenty; the first five are unchanged |

New in 1.0.2, all optional: `ctx.events`, `ctx.round`, `ctx.over`,
`ctx.winner`, `ctx.scores`, `ctx.time`, `ctx.dt`, `ctx.tickFraction`;
`surface.shake`, `scale`, `pixelRatio`, `alpha`, `glow`, gradients, `disc`
with `stroke`, `box` with `radius`, `rotate` for `box`, `ellipse`, `poly` and
`text`, and `family`, `baseline`, `italic`, `outline`, `spacing` for text; `data-engine-stick`, sliding touch
buttons, `data-pressed`; the `scoreboard` hook's snapshot, `you`, `host`,
`state`, `note`; `info` for labels; `onReady`, `onRound`, `onOver`, `nextKey`,
`pixelRatio`; `pitch` and `gain` functions and `only` in `audioMap`; `analog`
bindings; `__engine.snapshot()` and `__engine.players()`.

## Distribution

The superapp serves `public/` with `wasmer/static-web-server@1.1.0`
(static-web-server 2.32.2). Its environment sets `SERVER_CORS_ALLOW_ORIGINS=*`
and `SERVER_CACHE_CONTROL_HEADERS=true`; `config/static-web-server.toml`,
mounted at `/config`, adds header rules. Measured locally on 2026-10-05 with
`wasmer run . --net` and `Origin: https://game.example`:

| Request | `cache-control` | `access-control-allow-origin` | `vary` |
|---|---|---|---|
| `/engine/1.0.0/engine.js` | `public, max-age=31536000` | `*` | `Accept-Encoding, Origin` |
| `/assets/1.0.0/manifest-1.0.0.json` | `public, max-age=3600` | `*` | `Accept-Encoding, Origin` |
| `/`, `/index.html`, `/games.json` | `no-cache` | the request origin, reflected | `accept-encoding` |

Without the config file the server reflects the request origin on every path
and sets only `vary: accept-encoding`, and the index inherits one day. Lifetime
follows the file extension, and a 404 under `/engine/` inherits the one-year
lifetime too, so publish a version before any game pins it.

A version directory that has been deployed is frozen: browsers hold its files
for a year, so an edit would reach some players and not others. Ship an engine
fix as a new `ENGINE_VERSION` in `engine/params.js`, publish it beside the
earlier directories, and move each game's import map to it. The earlier
directories stay in `public/engine/` for the pages that still pin them. An
asset set is frozen the same way: a new sound is a new `ASSET_SET_VERSION`
and a new directory under `public/assets/`.

A game deploy uploads the game directory alone. The remote-build packager
walks it with `.gitignore` honoured, which would leave the git-ignored
`engine/` copy out and the server unable to start; an `.ignore` file outranks
`.gitignore` for the packager without changing what git tracks. `./deploy.sh`
therefore copies the server half in, writes `!/engine/` to the game's
`.ignore` for the duration of the upload, and removes it. Deploy a game with
`./deploy.sh <game>`, not with a bare `wasmer deploy`. The superapp deploy
stops before the upload when `public/engine/<version>/` is missing or differs
from `engine/`.
