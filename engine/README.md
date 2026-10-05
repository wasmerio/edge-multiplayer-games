# Browser game engine

A game is a simulation, a snapshot schema, an intent and a draw function. The
engine owns everything else: the signaling server, the lobby and invite panel,
the WebRTC star, the fixed-tick host loop, the binary codec and deltas, guest
interpolation, input sources, audio, diagnostics and the sub-app contract.

Rules that the conformance suite enforces, so learn them first:

- The simulation is headless: no DOM, no network, no timers, no `Math.random`,
  no `Date.now`. Randomness comes from the injected `rng`.
- The page imports the engine from one **pinned** version path.
- A game has no loop, no socket, no `RTCPeerConnection`, no `?room` / `?create`
  handling and no server code of its own.
- `test/replay.ndjson` is committed and replays to its recorded final state.

## Start a game

```bash
node scripts/new-game.mjs my-game --name "My Game"   # [--description "…"] [--root <checkout>]
cd my-game && npm test                               # scenarios, budget, fixture
node ../scripts/dev.mjs my-game 8765                 # run it against this checkout's engine
node ../scripts/conformance.mjs .                    # the contract, every row
```

The scaffold is a complete, passing game. Replace the rules in
`public/game.js`, the drawing in `public/client.js`, re-record the fixture with
`RECORD=1 npm test`, and fill the three README sections.

| File | Content |
|---|---|
| `public/index.html` | A `#game` container, the pinned import map, one module script |
| `public/client.js` | One `startGame({...})` call |
| `public/game.js` | The simulation class, `SNAPSHOT`, `INTENT` |
| `src/server.js` | One `serveGame({ publicDir })` call; never edit it |
| `test/game.test.mjs`, `test/replay.ndjson` | Scenario tests and the replay fixture |
| `README.md` | Headings **Input**, **Snapshot**, **Round lifecycle** |

```html
<script type="importmap">
  { "imports": { "@engine/": "https://edge-multiplayer-games.wasmer.app/engine/1.0.0/" } }
</script>
<div id="game"></div>
<script type="module" src="/client.js"></script>
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
  // optional: disconnect(index) when a player leaves for good
}
export const SNAPSHOT = { /* below */ };
export const INTENT = { turn: { min: -1, max: 1, neutral: 0 } };
// optional: export const ARENA = { w, h }  or  (players) => ({ w, h })
```

`rng`: `next()` in [0,1), `range(lo, hi)`, `int(lo, hi)` inclusive,
`pick(array)`, `state()` / `restore(n)`. `step` receives a frozen array: never
write to it. The snapshot must be enough to draw from scratch.

The suite and the generator find these by name: the class as `Simulation`,
`Game` or the default export; `SNAPSHOT`; `INTENT`; optionally `ARENA`. A
simulation is built with `{ arena: ARENA ?? arenaFor(players) }`, exactly as
the host builds it, so pass the same value to `startGame({ arena })`.

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
    d:     { type: "players" },
  },
};
```

| `type` | Value | Options |
|---|---|---|
| `uint`, `int` | Integer | `bits`: 8, 16 or 32 (default 32) |
| `fixed` | Number rounded to `1/scale` | `scale` (required), `bits` 8/16/32 (default 16), `signed: false` for unsigned |
| `bool` | Boolean, bit-packed in lists | — |
| `players` | List of player indexes; the event list | Scalar only |

Shape: scalar by default; `per: "player"` is an array with one entry per
player; `count: n` (1 to 255) is a fixed-length array. A value outside its
range throws at encode time on the host, so size fields honestly:
`fixed, scale 10, bits 16` holds ±3276.7. A full snapshot must fit
`params.SNAPSHOT_BUDGET_BYTES` (100 B) per player; deltas are automatic.

Guests draw a presentation tick `params.INTERP_BUFFER_TICKS` behind the
newest arrival and blend the `interpolate` fields every frame. An angle
needs `wrap` (`{ type: "fixed", scale: 10, wrap: 360 }`, or `2 * Math.PI`
for radians) so it turns the short way round. The tick field must advance
on every `step()`, countdowns included: a frame that repeats a tick is
dropped by the guest buffer.

A peer that joins after Start is a spectator: the host sends it the lobby,
the round and a full snapshot. After a match winner the host's
"New match" control (or Space) starts a fresh match with the peers then
connected.

`defineSnapshot(spec)` returns `{ hash, fields, budgetBytes, tickField,
byteLength(players), encode(snap, players), decode(buffer, players),
delta(prev, next, players), apply(prev, buffer, players), isInterpolated(name),
interpolatedFields() }`.

## Intent and bindings

The intent is the whole input of one player. Declare each field once; the
engine clamps it, sends it only on change and re-sends it every second.

```js
export const INTENT = {
  turn: { min: -1, max: 1, neutral: 0 },         // a range
  fire: { values: [0, 1], neutral: 0 },          // an enumeration
};
// client.js
bindings: {
  turn: { keys: { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 }, axis: 0, deadZone: 0.3 },
  fire: { keys: { Space: 1 }, buttons: { 0: 1 } },           // gamepad button index
},
touchControls: [{ field: "turn", value: -1, label: "◀" }, { field: "turn", value: 1, label: "▶" }],
```

Keys are `KeyboardEvent.code` values and one key belongs to one field.
Contributions add up and collapse to −1, 0 or 1; set `discrete: false` on a
binding to keep the sum. Touch buttons appear only on coarse pointers. `Space`
is also the host's "next round" key once a round is over.

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

| Option | Default | Meaning |
|---|---|---|
| `title` | — | Header text |
| `Simulation`, `schema`, `intent`, `bindings` | required | As above; `schema` comes from `defineSnapshot` |
| `draw(surface, snapshot, ctx)` | required unless `mount` | Called every frame with the snapshot to show |
| `mount(arenaElement, ctx)` | — | Own renderer (three.js): return `{ draw(snapshot, ctx) }` plus optional `lobby`, `round`, `over`, `snapshot`, `reply` hooks |
| `layers` | `["world", "actors"]` | Canvas layers, back to front; `world` persists, clear `actors` each frame |
| `arena(players)` | `arenaFor(players)` | Board size `{ w, h }`, sent to every peer in the lobby message |
| `target(players)` | `max(5, 10 × (players − 1))` | Score passed to `winner(target)` |
| `tickHz` | `params.DEFAULT_TICK_HZ` (30) | Simulation rate, at most `MAX_TICK_HZ` |
| `minPlayers` | 1 | Start is refused below this many connected players |
| `touchControls` | `[]` | `{ field, value, label }` buttons |
| `audioMap` | `{}` | `{ snapshotField: "sound" \| { sound, gain, pitch: [lo, hi], field } }`; one voice per entry of an event list, or while a flag is true |
| `audioAssets`, `assetsUrl` | shared set | Sounds are `blip`, `hit`, `score`, `start`, `win` (`SOUND_NAMES`); an unknown name throws at start |
| `scoreboard(players, scores)` | one row per player | Rows `{ name, score, colour, alive }` for team games |
| `onCommand(sim, playerIndex, data)` | — | Host-side handler for `ctx.command(data)`; its return value goes back to the sender's `reply` hook |
| `container` | `#game` or `body` | Where the kit mounts |

Returns `{ ui, surface, view, peers(), signal, state, diagnostics, input, mixer, engineVersion }`.
`?overlay=1` shows the diagnostics overlay; `globalThis.__engine` is a
read-only window for tests.

### Draw context `ctx`

| Member | Meaning |
|---|---|
| `players()` | `[{ pid, owner, name, colour, score }]` in seat order |
| `colourFor(index)` | The shared palette colour of a seat |
| `seat()` | This peer's player index, −1 for a spectator |
| `isHost()`, `spectator()`, `selfId()` | Role of this peer |
| `target()` | The score target of the match |
| `hud(text)`, `banner(text, ms)` | One status line under the scoreboard; a centred banner (`banner()` clears) |
| `intent(field, value)` | Set an intent field from a source bindings cannot express (mouse look) |
| `command(data)` | A discrete request to the host's `onCommand` |

### Surface

Coordinates are arena pixels; every peer has the same arena.

```js
surface.clear(layer); surface.clearAll(); surface.arena()            // { w, h }
surface.disc(layer, { x, y, r, colour });
surface.box(layer, { x, y, w, h, colour, stroke });                  // stroke: line width, omit to fill
surface.trail(layer, from, to, { colour, width });                   // a segment on a persistent layer
surface.text(layer, { x, y, value, colour, size, align, weight, maxWidth });
surface.poly(layer, { points, colour, stroke, closed, dash });
surface.ellipse(layer, { x, y, rx, ry, colour, stroke });
surface.arc(layer, { x, y, r, from, to, colour, width, dash });
surface.canvas(layer)                                                // the raw canvas, as a last resort
```

The engine clears every layer at a round start. `draw` runs on the host with
the latest snapshot and on guests with an interpolated one, so derive
everything from the snapshot and keep only cosmetic state in `client.js`.

## Everything `engine.js` exports

| Export | Use |
|---|---|
| `startGame` | The one call a game makes |
| `defineSnapshot` (alias `snapshot`) | Schema to codec |
| `seededRng(seed)` | The deterministic generator |
| `validateSimulation(Class, opts)` | Throws naming what the class lacks |
| `record({ seed, tickHz, players })`, `replay(text, factory)`, `parseFixture`, `finalState` | Fixtures; see below |
| `arenaFor(players, { baseW, baseH, perPlayer, scale })` | Default arena, area grows with players |
| `PLAYER_COLOURS`, `colourFor(i)` | Shared palette |
| `params` | Every tunable: `ENGINE_VERSION`, `MAX_PLAYERS_PER_ROOM`, `SNAPSHOT_BUDGET_BYTES`, … |
| `ENGINE` | The version string |
| `SOUND_NAMES`, `loadAssets(url, names)`, `manifestUrl`, `manifestUrlFor`, `auditLedger` | Shared asset set |
| `hostGame`, `joinGame`, `fixedTick`, `createBuffer`, `createSurface`, `createStage`, `inputSource`, `mountUi`, `createMixer`, `createWebAudio`, `createCollector`, `meterTransport`, `sparkline`, `workerTimers`, `connectSignal`, `createStar`, `ICE` | The parts `startGame` is assembled from. A game does not call them; conformance fails a game that runs its own loop or network |

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
use, so the budget row measures real motion.

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
| `create` | Headless browser: `/?create=1` shows the invite link with no input | `client.js` calls `startGame` from the pinned engine, no own lobby code |
| `join` | Second browser context: `/?room=CODE` lands in the room | Same proof |
| `link` | The rendered page links to the superapp | The kit carries the link, or `index.html` does |
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

Scans skip comments, string contents, `public/vendor/`, `public/engine/` and
`*.min.js`. The full tier starts `node src/server.js` on a free port with the
checkout's `public/` standing in for the superapp origin, refreshes the
git-ignored `engine/` copy if it is stale, and needs Chrome or Chromium
(`CHROME_BIN` overrides; a missing browser fails `create` and `join` as a named
prerequisite). The static tier uses only `node:fs`, `node:path`, `node:url`
and dynamic imports, so it runs under EdgeJS inside Wasmer; so does the
scaffold. A deployed origin runs the HTTP and browser rows and skips the rows
that need source. The superapp origin gets its own rows: `engine-reachable`,
`engine-cache`, `cors`, `cors-vary`, `index-lifetime`, `assets`, `ledger`.

A full run holds one server and one browser, and stops both before it returns.
Run the repository's script tests one file at a time:
`node --test --test-concurrency=1 scripts/*.test.mjs`.

`scripts/lib/browser.mjs` is the browser helper (`launch({ offline })`,
`newPage(url)`, `evaluate`, `waitFor`, `errors`, `requests`, `close`); it
speaks the DevTools protocol over Node's own WebSocket and adds no dependency.

## Other commands

| Command | Effect |
|---|---|
| `node scripts/dev.mjs <game> [port]` | Publish, copy the server half, serve the game with the local `public/` as the superapp |
| `node scripts/sync-engine.mjs publish` | Copy `engine/*.js` to `public/engine/<ENGINE_VERSION>/`; run after every engine edit |
| `node scripts/sync-engine.mjs verify` | Fail when the published copy differs from `engine/`; the deploy and a test run it |
| `node scripts/sync-engine.mjs game <game>` | Copy the Node half (`params`, `rng`, `rooms`, `server`) into `<game>/engine/` |
| `node scripts/sync-engine.mjs vendor <game>` | Freeze: copy the engine into `<game>/public/engine/`, point the import map at `/engine/`, stop ignoring the copy |
| `./deploy.sh <game> super` | Deploy; see below |

A vendored game needs no superapp origin and passes
`conformance.mjs <game> --offline`. Commit `public/engine/` with it.

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

A game deploy uploads the game directory alone. The remote-build packager
walks it with `.gitignore` honoured, which would leave the git-ignored
`engine/` copy out and the server unable to start; an `.ignore` file outranks
`.gitignore` for the packager without changing what git tracks. `./deploy.sh`
therefore copies the server half in, writes `!/engine/` to the game's
`.ignore` for the duration of the upload, and removes it. Deploy a game with
`./deploy.sh <game>`, not with a bare `wasmer deploy`. The superapp deploy
stops before the upload when `public/engine/<version>/` is missing or differs
from `engine/`.
