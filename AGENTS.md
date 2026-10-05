# Agent guide: adding a game on the engine

This repository holds browser multiplayer games on Wasmer Edge, the
first-party engine they run on (`engine/`), and a superapp that indexes
them. `achtung/` is the reference game. Follow this file to add a game.
Every rule exists because of a platform constraint or a bug already hit.
The checks are commands; run them, do not reason around them.

## 0. Before you start

Install the Wasmer agent skills once. They are the source of truth for
`app.yaml`, deploys, logs, rollbacks, secrets, and the local runtime:

```bash
npx skills add wasmerio/docs.wasmer.io
```

Use `wasmer-edge` for anything that touches a deployed app and
`wasmer-cli-usage` for anything local. When those skills and
`wasmer <cmd> --help` disagree, trust `--help`.

Check the registry before any deploy. Dev machines often point at
`wasmer.wtf`:

```bash
wasmer whoami        # expect: Logged into registry wasmer.io as user …
```

## 1. The model in one paragraph

Edge runs the engine's game-agnostic signaling server and serves the
client. The room creator's browser is the host: the engine runs the game's
simulation there at a fixed tick rate, applies the latest intent per
player, and broadcasts one binary snapshot per tick over one ordered,
reliable `RTCDataChannel` per guest (star topology). Guests send intent
only when it changes, and draw an interpolated stream. State is never
agreed upon; one writer owns it. A game is a simulation, a snapshot
schema, an intent, and a draw function. Everything else belongs to the
engine.

Why: Edge exposes HTTPS and WebSocket but no UDP, so TURN or an SFU
cannot live there, and instances are ephemeral (about one hour, stop when
idle), so a server-side game loop is the wrong place for state.

## 2. The engine surface

[`engine/README.md`](engine/README.md) is the API of record. Read it
before you write code. A game touches only this much:

| You write | With | The engine then owns |
|---|---|---|
| `class Game` in `public/game.js` | `constructor(playerCount, opts, rng)`, `startRound()`, `step(intents)`, `winner(target)`; fields `round`, `tick`, `roundOver`, `scores` | The fixed-tick loop, the host, seeded randomness, record and replay |
| `SNAPSHOT` in `public/game.js` | Field names and types for `defineSnapshot` | The binary codec, deltas, the byte budget, guest interpolation |
| `INTENT` in `public/game.js` | One entry per input field: `{ min, max, neutral }` | Keyboard, touch, and gamepad sources; resend on loss |
| One `startGame({...})` call in `public/client.js` | `title`, `Simulation`, `schema`, `intent`, `bindings`, `touchControls`, `draw`, `audioMap` | Lobby, invite panel, `?create=1`, `?room=CODE`, scoreboard, banner, superapp link, WebRTC, audio mixer, diagnostics |
| `draw(surface, snapshot, ctx)` | The 2D surface: `clear`, `disc`, `box`, `trail`, `poly`, `ellipse`, `arc`, `text` | Canvas layers, arena scaling |
| `src/server.js` (scaffolded, never edited) | One `serveGame` call | Static files, `/healthz`, `/ws` signaling, room lifecycle |

The browser imports the engine from one pinned path, declared once in the
import map of `public/index.html`:
`https://edge-multiplayer-games.wasmer.app/engine/<ENGINE_VERSION>/`.
`ENGINE_VERSION` lives in `engine/params.js`, with every other tunable.

## 3. Steps

### 3.1 Scaffold

From the repository root:

```bash
node scripts/new-game.mjs <slug> --name "<Display name>" --description "<One sentence.>"
```

`<slug>` is lowercase letters, digits, and inner hyphens; it is the
directory and the app name. The command refuses an existing directory.
It writes a complete game that already passes its tests and conformance:

| File | Owner | Content |
|---|---|---|
| `public/game.js` | You | Simulation, `SNAPSHOT`, `INTENT` |
| `public/client.js` | You | The `startGame` call |
| `public/index.html` | You: title and description only | Container and the pinned import map |
| `test/game.test.mjs`, `test/reference.mjs`, `test/replay.ndjson` | You | Scenarios, the reference match, its recorded fixture |
| `README.md`, `game-entry.json` | You | The contract; the catalog metadata |
| `src/server.js`, `package.json`, `app.yaml`, `.gitignore` | Scaffold | Do not edit |

Do not copy another game's directory. Do not add a stylesheet, a lobby,
a WebSocket, an `RTCPeerConnection`, a timer loop, or a second engine
import; conformance fails each of them by name.

### 3.2 Design the contract in the README first

Write these three sections, with these words in their headings, before
you write code. Conformance checks the headings.

- **Input**: the intent fields per player per tick. Keep them small and
  discrete: a direction, a button state.
- **Snapshot**: every field, its type, and its meaning. Include an event
  list (a `players` field) for anything that makes a sound or a score.
  The snapshot must be enough to draw from scratch; guests keep no other
  state.
- **Round lifecycle**: what `startRound()` resets, when `roundOver`
  becomes true, and how a match is won.

### 3.3 Write `public/game.js`

- No DOM, no network, no timers, no `Date`, no `Math.random`. All
  randomness comes from the injected `rng` (`rng.next()`, `rng.range(lo, hi)`,
  `rng.int(lo, hi)`), or the fixture will not replay.
- `opts.arena` is `{ w, h }`. Size the world from it. For a board that
  is not the default, export `ARENA` and pass the same value to
  `startGame({ arena })`.
- `startRound()` resets per-round state and adds one to `round`.
- `step(intents)` advances one tick and returns the snapshot object.
  `intents[i]` is the intent of player `i`. A seat that has not sent
  input yet holds `0`, so read fields as `intents[i]?.turn || 0`. The
  array is frozen; never write to it.
- `scores` holds one entry per player. `winner(target)` returns a player
  index, or `-1`.
- Keep `step()` O(players) and light on allocation.
- `SNAPSHOT` uses the types `uint`, `int`, `fixed` (with `scale`), `bool`,
  and `players`; add `per: "player"` for one value per player. Name the
  tick field in `tickField` and the smooth fields in `interpolate`.
- The budget is `SNAPSHOT_BUDGET_BYTES` (100 bytes per player per tick).
  Quantise positions with `fixed`; do not raise `budgetBytes`.

### 3.4 Write `public/client.js`

Keep the scaffold's shape: one `startGame` call and nothing else at the
top level.

- `bindings`: one entry per `INTENT` field, for example
  `{ turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } }`.
- `touchControls`: one button per direction or action,
  `{ field, value, label }`. A phone has no keyboard.
- `draw(surface, snapshot, ctx)`: draw only through `surface`. `ctx`
  gives `players()`, `colourFor(i)`, `seat()`, `isHost()`, `target()`,
  and `hud(text)`. Draw from the snapshot alone.
- `audioMap`: snapshot event field to a shared sound name. See
  `engine/README.md` for the sound set.

### 3.5 Tests and the fixture

Edit `test/game.test.mjs`. Keep its engine checks (shape, budget,
fixture replay, same-seed equality) and replace the scaffold's rule
scenarios with at least two of your own: set a known state, step, and
assert the exact tick or score. Update `test/reference.mjs` so its
scripted intents use your `INTENT` fields, then record the fixture again
after every rule change:

```bash
cd <slug>
RECORD=1 npm test        # rewrites test/replay.ndjson from test/reference.mjs
npm test                 # node --test test/*.test.mjs
```

Without npm, run `RECORD=1 node test/game.test.mjs` and
`node test/game.test.mjs`. From the repository root, the test command is
`node --test scripts/*.test.mjs`; the glob form is required.

### 3.6 Run it locally

```bash
node scripts/dev.mjs <slug> 8765
```

This publishes `engine/` to `public/engine/<version>/`, copies the
engine's server modules into `<slug>/engine/`, installs `ws` if needed,
and serves the game with the pinned import redirected to this checkout.
Open `http://localhost:8765/?create=1` in one tab and the invite link in
a second. Loopback ICE works without STUN.

### 3.7 Conformance and soak

```bash
node scripts/conformance.mjs <slug> --static   # source rows; no browser, no server
node scripts/conformance.mjs <slug>            # full tier: local server and headless browser
node scripts/soak.mjs <slug> --duration 60     # host and guests play; diagnostics asserted
```

Every row prints `PASS` or `FAIL` with its reason, and any failed row
makes the exit status non-zero. Fix the named row; do not skip the
command. The static tier is the gate of the daily generator, which has
no browser. The full tier and the soak run are required before a deploy.

| Failed row or error | Cause | Fix |
|---|---|---|
| `pinned` | The import map changed, or a module imports the engine by another path | Restore the scaffold's import map; import only `@engine/engine.js` |
| `published` | `public/engine/<version>/` is missing or stale | `node scripts/sync-engine.mjs publish`, then `node scripts/sync-engine.mjs verify` |
| `server`, `netcode`, `accumulator` | The game has its own server, socket, or loop | Delete it; the engine owns these |
| `simulation` naming `missing method …` | The class does not match the shape in section 2 | Add the method or field it names |
| `schema` | Unknown type, width, or an interpolated discrete field | Fix the `SNAPSHOT` field it names |
| `fixture` with `replay: diverged` | Rules changed after recording, or the simulation uses unseeded randomness or time | Remove the nondeterminism, then `RECORD=1 npm test` |
| `budget` | A snapshot is larger than the budget | Fewer fields, narrower `bits`, coarser `scale` |
| `readme` | A contract heading is missing | Section 3.2 |

### 3.8 Deploy and verify

```bash
./deploy.sh <slug>
```

The script copies the engine's server modules into `<slug>/engine/`
(ignored by git, required in the upload), then runs
`wasmer deploy --build-remote --non-interactive`. Read the log for
`Packaging project directory (N files, …)`. If `N` is one or two, the
archive is empty; stop and fix before you continue. Then confirm
`Detected Node.js provider` and `node@… │ wasmer/edgejs-quickjs`.

After the rollout, from outside:

```bash
curl -sD - -o /dev/null https://<app>/healthz | grep -i x-edge
node scripts/conformance.mjs https://<app>
```

A 400 on the WebSocket handshake with an otherwise healthy app is Edge
rewriting `Connection: Upgrade`; check
https://linear.app/wasmer/issue/EDGE-2012 before you touch the app.
Finish with a two-browser game against the production URL, and one
invite link opened on a phone.

`app.yaml`: the CLI writes `app_id` and an `annotations:` block back
after each remote build. With the Node provider they are harmless. After
a wrong detection, delete the annotations. Keep
`locality.regions: [fr-roub1]`; one region keeps the per-instance room
registry mostly coherent.

### 3.9 Register in the superapp

Deployment is complete only when the root catalog contains the game and
the superapp deployment serves that entry.

```bash
./deploy.sh <slug> super
```

The script reads the deployed URL from Wasmer, inserts or updates the
entry in `public/games.json` from `<slug>/game-entry.json`, adds
`/<slug>/` to the root `.wasmerignore`, verifies that
`public/engine/<version>/` matches `engine/` byte for byte, and
redeploys the superapp. `./deploy.sh super` alone repairs missing
entries and URLs. Commit the catalog and manifest changes afterwards.
Do not guess a Wasmer URL; an entry without a deployment has `url: null`
and shows as coming soon.

The root app serves `public/` (the index, the published engine, the
shared assets) and owns the daily generation cron job. Its `wasmer.toml`
bundles `public/`, the generation runtime, and prepared Pi dependencies.
Do not add a root `package.json`, a second automation app, or a second
cron schedule. The root `.wasmerignore` is the upload filter for the
root package; do not use `.ignore` there, because search tools read that
filename. It excludes `CLAUDE.md`, a symlink the packager refuses.

Daily games reach this point through the generator
([`automation/daily-game/README.md`](automation/daily-game/README.md)):
it scaffolds, lets the model author the files in section 3.1, rejects a
candidate that fails any static check, and opens a draft pull request
with `url: null`. A person runs the full tier, merges, and deploys.

### 3.10 Vendoring escape hatch

A game that must stay frozen on one engine build can carry its own copy:

```bash
node scripts/sync-engine.mjs vendor <slug>
```

This copies the engine into `<slug>/public/engine/`, points the import
map at `/engine/`, and stops ignoring the copy. Commit
`<slug>/public/engine/` with the game. Verify with
`node scripts/conformance.mjs <slug> --offline`. The game no longer
receives engine fixes. Use it only for a game that is deliberately frozen.

## 4. Constraints to design around

- **No UDP on Edge.** No TURN, no SFU, no game server with DataChannels.
  Only public STUN is configured; symmetric-NAT pairs cannot connect.
- **Rooms live in one instance's memory.** Edge may run several
  instances of an app; `/healthz` counts rooms on the instance that
  answered; a guest can in principle miss the host's room. Pin one region.
- **Instances are ephemeral.** Losing the signaling socket does not end a
  game (DataChannels stay up). Never keep game state on the server.
- **Ordered, reliable channel.** It is SCTP with retransmission; guests
  see exactly the host's sequence.
- **Host authority.** The host has zero input latency and could cheat.
  Acceptable for friends.
- **The simulation must be deterministic.** Same seed and same intents
  give the same state; the fixture proves it.
- **No bundler, no build step.** The browser loads ES modules directly.
- **`.gitignore` is honoured by the packager** inside a git repository.
  A game ignores `engine/`, so the deploy script whitelists it for the
  upload. Do not commit `<slug>/engine/`.
- **EdgeJS is not upstream Node.** `node:http`, the `upgrade` event,
  `ws`, and `node:test` are proven. Test anything else before you depend
  on it.

## 5. Checklist before calling a game done

- [ ] README documents input, snapshot, and round lifecycle
- [ ] `npm test` passes in the game directory, with at least two rule scenarios
- [ ] `test/replay.ndjson` was recorded after the last rule change
- [ ] `node scripts/conformance.mjs <slug>` passes every row (full tier)
- [ ] `node scripts/soak.mjs <slug>` passes
- [ ] Scaffold-owned files are unchanged; the import map pins the current engine version
- [ ] Two-tab local game: join, steer from the guest, round advance
- [ ] Deploy log: `Packaging project directory (N files…)` with a sane `N`, `Detected Node.js provider`
- [ ] `node scripts/conformance.mjs https://<app>` passes
- [ ] Production two-browser game, and one invite link opened on a phone
- [ ] Entry in `public/games.json` has the real URL, superapp redeployed, card shows online

## 6. Conventions

- One directory per game, self-contained, own `app.yaml`.
- One copy of the engine: `engine/`. `public/engine/<version>/` is its
  published copy, written only by `node scripts/sync-engine.mjs publish`.
  `engine/` inside a game is a deploy-time copy and is ignored by git.
- A game never restates an engine tunable; import it from `params`.
- Comments: one short line for the non-obvious only. Rationale goes in
  the README.
- Browsers cache a version path for a year. An engine change that must
  reach players needs a new `ENGINE_VERSION` and a new published directory.
- Keep this file current. If a step here is wrong for the platform as it
  exists today, fix the step, do not work around it silently.
