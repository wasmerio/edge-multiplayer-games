# Agent guide: adding a game on the engine

This repository holds browser multiplayer games on Wasmer Edge, the
first-party engine they run on (`engine/`), and a superapp that indexes
them. Follow this file to add a game. Every rule exists because of a
platform constraint or a bug already hit. The checks are commands; run them,
do not reason around them.

| Read | For |
|---|---|
| This file | The steps, the commands, the failure table, the checklists |
| [`engine/README.md`](engine/README.md) | The reference: a complete example game, every option, how the engine behaves, the game feel cookbook |
| [`.claude/skills/make-game/SKILL.md`](.claude/skills/make-game/SKILL.md) | The operating procedure for an agent that creates or reworks a game |

You do not need to read engine source to build a game. The scaffold is the
example; `achtung/` is the oldest game, on an earlier pin.

**Reference games.** Two finished games on the current engine show the level
of finish to reach. Read their `README.md`, `public/client.js`,
`public/style.css` and `test/bot.mjs`; do not copy their look.

| Game | Shows |
|---|---|
| `fuse/` | Continuous movement on a thumb stick, ghosts for eliminated players, events driving particles, shake and sound, a dark theme |
| `trapdoor/` | A grid board rebuilt on every peer from a seed to save snapshot bytes, a light theme, a touch button whose label follows the player's role, a crown that handicaps the leader |

## 0. Before you start

Install the Wasmer agent skills once. They are the source of truth for
`app.yaml`, deploys, logs, rollbacks, secrets, and the local runtime:

```bash
npx skills add wasmerio/docs.wasmer.io
```

Use `wasmer-edge` for anything that touches a deployed app and
`wasmer-cli-usage` for anything local. When those skills and
`wasmer <cmd> --help` disagree, trust `--help`.

Every app in this repository deploys to the `wasmer-playground` namespace;
each `app.yaml` and the scaffold set `owner: wasmer-playground`.

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
schema, an intent, a draw function, and its own page and stylesheet.
The engine owns behaviour; the game owns its look and feel.

Why: Edge exposes HTTPS and WebSocket but no UDP, so TURN or an SFU
cannot live there, and instances are ephemeral (about one hour, stop when
idle), so a server-side game loop is the wrong place for state.

## 2. The engine surface

[`engine/README.md`](engine/README.md) is the API of record. A game touches
only this much:

| You write | With | The engine then owns |
|---|---|---|
| `class Game` in `public/game.js` | `constructor(playerCount, opts, rng)`, `startRound()`, `step(intents)`, `winner(target)`, optional `disconnect(index)`; fields `round`, `tick`, `roundOver`, `scores` | The fixed-tick loop, the host, seeded randomness, record and replay |
| `SNAPSHOT` in `public/game.js` | Field names and types for `defineSnapshot` | The binary codec, deltas, the byte budget, guest interpolation |
| `INTENT` in `public/game.js` | One entry per input field: `{ min, max, neutral }` or `{ values, neutral }` | Keyboard, touch, stick and gamepad sources; resend on loss |
| One `startGame({...})` call in `public/client.js` | `Simulation`, `schema`, `intent`, `bindings`, `draw`, and as needed `palette`, `audioMap`, `labels`, `scoreboard`, `onRound`, `nextKey`, `minPlayers`, `arena`, `target` | Lobby logic, invite link, `?create=1`, `?room=CODE`, scoreboard rows, banner, WebRTC, audio mixer, diagnostics |
| `draw(surface, snapshot, ctx)` | The surface: `clear`, `disc`, `box`, `ellipse`, `poly`, `arc`, `trail`, `text`, `shake`; colours, gradients, `alpha`, `glow`, `rotate`, rounded boxes, dashes, letter-spacing. The context: `seat`, `players`, `events`, `time`, `dt`, `tickFraction`, `hud`, … | Canvas layers, arena scaling, pixel density, one-shot event delivery |
| `public/index.html` and `public/style.css` | Your markup, copy, and theme; elements carry `data-engine="<role>"`, touch controls carry `data-engine-touch` or `data-engine-stick` | Binding behaviour to those roles; showing and hiding them with the `hidden` attribute. It injects no theme |
| `src/server.js` (scaffolded, never edited) | One `serveGame` call | Static files, `/healthz`, `/ws` signaling, room lifecycle |

The browser imports the engine from one pinned path, declared once in the
import map of `public/index.html`:
`https://edge-multiplayer-games.wasmer.app/engine/<ENGINE_VERSION>/`.
`ENGINE_VERSION` lives in `engine/params.js`, with every other tunable. A
game may stay on an earlier published version; a new game pins the current
one.

## 3. Steps

### 3.1 Scaffold

From the repository root:

```bash
node scripts/new-game.mjs <slug> --name "<Display name>" --description "<One sentence.>"
```

`<slug>` is lowercase letters, digits, and inner hyphens; it is the
directory and the app name. The command refuses an existing directory.
It writes a complete game that already passes its tests and conformance.
It is the example printed in `engine/README.md`, "Complete example": free
movement on a thumb stick, a boost button, a countdown, events, particles,
sound, a live scoreboard. Read it once, then replace it.

| File | Owner | Content |
|---|---|---|
| `public/game.js` | You | Simulation, `SNAPSHOT`, `INTENT` |
| `public/client.js` | You | The `startGame` call, `draw`, and helpers and cosmetic state for them |
| `public/index.html` | You: markup and copy | The page. Keep the pinned import map, the one module script, the superapp link, and the `data-engine` roles |
| `public/style.css` | You | The game's look. The scaffold's theme is a placeholder to replace |
| `test/game.test.mjs`, `test/reference.mjs`, `test/replay.ndjson` | You | Scenarios, the reference match, its recorded fixture |
| `test/bot.mjs` | You | The bot that plays your game in `scripts/play.mjs`; section 3.7 |
| `README.md`, `game-entry.json` | You | The contract; the catalog metadata |
| `src/server.js`, `package.json`, `app.yaml`, `.gitignore` | Scaffold | Do not edit |

Do not copy another game's directory, page, or stylesheet. Do not add
lobby code, a WebSocket, an `RTCPeerConnection`, a timer loop, or a
second engine import; conformance fails each of them by name.

### 3.2 Design the game, then its contract

Decide the game before the code. Hold the idea against the design checklist
in section 6: if a stranger cannot play it ten seconds after the page opens,
change the idea, not the tutorial.

Then write these three sections in the game's README, with these words in
their headings. Conformance checks the headings.

- **Input**: the intent fields per player per tick. Keep them small and
  discrete: a direction, a button state.
- **Snapshot**: every field, its type, and its meaning. The snapshot must be
  enough to draw from scratch; guests keep no other state. For every moment
  that makes a sound or a one-shot effect, an event field: a `players` list
  (who it happened to) or a `bool` that is true for one tick. For everything
  visible for longer than a tick, a counter or an age.
- **Round lifecycle**: what `startRound()` resets, when `roundOver`
  becomes true, how a match is won, and what `disconnect(index)` does.

### 3.3 Write `public/game.js`

Reference: `engine/README.md`, "The simulation" and "Snapshot schema".

- No DOM, no network, no timers, no `Date`, no `Math.random`. All
  randomness comes from the injected `rng` (`rng.next()`, `rng.range(lo, hi)`,
  `rng.int(lo, hi)`, `rng.pick(array)`), or the fixture will not replay.
- `opts.arena` is `{ w, h }`. Size the world from it. For a board that
  is not the default, export `ARENA` and pass the same value to
  `startGame({ arena })`. `ARENA` is a size, or a function that the suite and
  the scaffold's tests call with the player count:
  `export const ARENA = (players) => ({ w, h })`.
- `startRound()` resets per-round state and adds one to `round`.
- `step(intents)` advances one tick and returns the snapshot object.
  `intents[i]` is the intent of player `i`. A seat that has not sent
  input yet holds `0`, so read fields as `intents[i]?.turn || 0`. The
  array is frozen; never write to it.
- The tick field advances on every `step`, a countdown included.
- `scores` holds one entry per player. `winner(target)` returns a player
  index, or `-1`.
- The class must not throw with one player, even when the game sets
  `minPlayers: 2`: validation and tests build small simulations.
- `disconnect(index)` is called once when a player leaves. The seat stays
  in every array; keep it out of play and out of later rounds yourself.
- Keep `step()` O(players) and light on allocation.
- `SNAPSHOT` uses the types `uint`, `int`, `fixed` (with `scale`), `bool`,
  and `players`; add `per: "player"` for one value per player. Name the
  tick field in `tickField` and the smooth fields in `interpolate`.
- The budget is `SNAPSHOT_BUDGET_BYTES` (100 bytes per player per tick).
  Quantise positions with `fixed`; do not raise `budgetBytes`.

### 3.4 Write `public/client.js`

Reference: `engine/README.md`, "`startGame(config)`", "Surface", "Sound",
"How it behaves" and "Game feel cookbook".

Keep the scaffold's shape: imports, constants, helper functions and cosmetic
state at the top, then one `startGame` call. No loop, no timer, no socket,
no lobby code, no second engine import.

- `bindings`: one entry per `INTENT` field a keyboard or gamepad drives, for
  example `{ turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } }`.
- `draw(surface, snapshot, ctx)` runs every animation frame from the first
  snapshot on, also after a round is over. Draw only through `surface`, and
  derive everything that matters from the snapshot.
- One-shot effects (particles, a shake, a scorch mark) read
  `ctx.events(field)`: each event arrives exactly once on every peer. Never
  read an event list from the snapshot in `draw`; the same snapshot is drawn
  more than once. Lasting effects read a counter or an age field.
- Cosmetic animation uses `ctx.time()` and `ctx.dt()`. Reset cosmetic state
  in `onRound`.
- `palette`: the game's own player colours, by seat. `labels`: the game's own
  banner and next-control copy; each label also receives the players, the
  scores and the latest snapshot.
- `scoreboard(players, scores, snapshot)`: rows that follow the game live
  (`alive`, `state`, `note`). The engine marks the local player's row.
- `audioMap`: snapshot event field to a shared sound name. The sound list is
  in `engine/README.md`, "Sound".
- Space is the host's next-round key by default. If Space is an action in
  your game, set `nextKey: "Enter"` and say so in the page.

### 3.5 Write the page and the stylesheet

Reference: `engine/README.md`, "Page slots", "Touch controls", "Scoreboard",
"Arena and screen" and "Typography".

The engine owns behaviour. The game owns its page and stylesheet. Each
game has its own style, look, and feel: its own palette, typography,
layout, lobby copy, and canvas art direction. The scaffold's theme is a
starting point; a game that ships it unchanged is not finished.

- `public/index.html` is yours. Mark each element the engine drives with
  `data-engine="<role>"`. Required: `arena`, `name`, `create`, `code`, `join`,
  `start`. Without `invite-link` the host cannot share the room.
- Use each role once. The engine sets text, reads values, and toggles
  the `hidden` attribute; it adds no class and no theme.
- A phone has no keyboard. Give every intent field a touch control in the
  page: a button, `<button data-engine-touch="boost=1">`, or a thumb stick
  for two fields, `<div data-engine-stick="mx,my"><i></i></div>`. The fields
  must be in `INTENT`. Show them under `[data-touch="on"]`, which the engine
  sets on a touch device.
- The page loads nothing from another origin: no web font, no CDN, no remote
  image. Use the system font stacks in "Typography", or ship your own
  licensed font file under `public/`. The soak run and the `origin` row of
  conformance fail anything else.
- Keep the import map, the one `<script type="module" src="/client.js">`,
  the `<link rel="stylesheet" href="/style.css">`, and a link to the
  superapp. Add no other script.
- State-dependent styling goes through the page: `client.js` may set a `data-`
  attribute or a class on its own elements from `draw` or a hook (a touch
  button that reads DASH or CRACK by role), and the stylesheet follows it.
  `game.js` never touches the DOM. The pattern is in `engine/README.md`,
  "Game feel cookbook", under state on the page.
- The header must fit one or two rows at 328 px: title left, chips right, the
  status line on its own row.
- `public/style.css` is yours. Keep `[hidden] { display: none !important; }`.
  The engine sets the arena's width and aspect ratio. Give the arena's parent
  a definite width, and cap the arena by the viewport height with the
  `max-width` rule from "Arena and screen".
- One arena unit is at most one CSS pixel, and on a 360 px phone a default
  four-player board shrinks to under a third. Make actors big, and keep
  words in the page (HUD, scoreboard, banner), not on the canvas.

### 3.6 Tests and the fixture

Edit `test/game.test.mjs`. Keep its engine checks (shape, budget,
fixture replay, same-seed equality, one player) and replace the scaffold's
rule scenarios with at least two of your own: set a known state, step, and
assert the exact tick or score. Update `test/reference.mjs` so its
scripted intents use your `INTENT` fields. Build every simulation in a test
with its `build(players, {}, rng)`, and take a board size from its
`arenaOf(players)`: both use the game's exported `ARENA` when there is one, as
conformance does. Then record the fixture again after every rule change:

```bash
cd <slug>
RECORD=1 npm test        # rewrites test/replay.ndjson from test/reference.mjs
npm test                 # node --test test/*.test.mjs
```

Without npm, run `RECORD=1 node test/game.test.mjs` and
`node test/game.test.mjs`. From the repository root, the test command is
`node --test scripts/*.test.mjs`; the glob form is required.

### 3.7 Look at your game, and iterate

```bash
node scripts/play.mjs <slug> --phone --rounds 3 --shots /tmp/<slug>-shots
```

This starts the game against this checkout's engine, opens a host, a touch
phone and a second guest in a headless browser, starts a match, plays it,
joins a late spectator, saves labelled PNG screenshots (lobby, room, several
in-game frames per page and round, every round result, the spectator), prints
a JSON summary, and stops everything. It exits non-zero when a page logged an
error, requested another origin, scrolls sideways, is a phone without touch
controls, or has a bot that threw. Options, file names and the summary keys:
`engine/README.md`, "Look at your game".

**Write the bot early.** `test/bot.mjs` is what plays: a module whose default
export is `(snapshot, info) => ({ ArrowLeft: true, Space: false })`, the keys
to hold now, called in every seated page while a round runs. The scaffold
ships one for its example game; rewrite it as soon as your rules run. Random
players lose a skill game in its first seconds, so without a bot you see ten
seconds of round 1. A bot that plays your game competently is how you see
rounds 2 and later, the endgame, the match result, eight players and the
phone layout. The contract and the `info` fields: `engine/README.md`, "Bots".

| Run | To see |
|---|---|
| `--phone --rounds 3` | Three whole rounds on a desktop host and a phone guest, with each round result |
| `--guests 1 --rounds 2` | The two-player game |
| `--guests 7 --phone --rounds 2 --no-late` | A full room of eight, on the desktop and on the phone |
| `--no-bot --phone` | The stick and the touch buttons driving the game |

Open the screenshots. Judge them as a player would, against section 6. Fix
what you see, run it again. A game is not done until its author has looked at
it on the desktop page and on the phone page, in a late round and with a full
room, and found nothing to fix.

**Run it locally.** For a human at a keyboard:

```bash
node scripts/dev.mjs <slug> 8765
```

This publishes `engine/` to `public/engine/<version>/`, copies the
engine's server modules into `<slug>/engine/`, installs `ws` if needed,
and serves the game with the pinned import redirected to this checkout.
Open `http://localhost:8765/?create=1` in one tab and the invite link in
a second. Loopback ICE works without STUN. Stop it with Ctrl+C, or with a
kill of that `node scripts/dev.mjs` process: it passes the signal on to the
server, so the port is free again. `play.mjs`, conformance and the soak run
start and stop their own server; they do not need this one.

### 3.8 Conformance and soak

```bash
node scripts/conformance.mjs <slug> --static   # source rows; no browser, no server
node scripts/conformance.mjs <slug>            # full tier: local server and headless browser
node scripts/soak.mjs <slug> --duration 60     # host and guests play; diagnostics asserted
```

Every row prints `PASS` or `FAIL` with its reason, and any failed row
makes the exit status non-zero. Fix the named row; do not skip the
command. The static tier is the gate of the weekly generator, which has
no browser. The full tier and the soak run are required before a deploy.

| Failed row or error | Cause | Fix |
|---|---|---|
| `pinned` | The import map changed, or a module imports the engine by another path | Restore the scaffold's import map; import only `@engine/engine.js` |
| `slots` naming `missing required slot(s)` | The page has an arena slot but lacks a required role | Add the element with that `data-engine` role |
| `slots` naming `unknown data-engine role` or `used more than once` | A misspelt or repeated role | Use each role from "Page slots" once |
| `slots` naming `unknown intent field` | A `data-engine-touch` button or a `data-engine-stick` names a field outside `INTENT` | Use `<field>=<number>`, or `<field>,<field>`, with `INTENT` fields |
| `slots` naming `predates` | The import map pins an engine version older than page slots, or older than `data-engine-stick` | Pin the current `ENGINE_VERSION` |
| `stylesheet` | A linked stylesheet is missing or empty, or the page brings none | Write `public/style.css` and link it |
| `origin`, or soak `external_request` | The page, a stylesheet or a script names a URL on another origin: a web font, a CDN, a remote image, an API | Ship the file under `public/` and use a local path; for fonts use a system stack from `engine/README.md`, "Typography" |
| soak `logged_error` | A page logged an error or threw. A blocked request to another origin also lands here | Read the detail; run `node scripts/play.mjs <slug>` and read `errors` |
| soak `snapshot_over_budget` | A live snapshot is larger than the budget | As `budget` |
| soak `tick_rate` | `step` or `draw` is too slow for the tick rate | Make `step` O(players); draw less per frame |
| `play.mjs` says `the match did not start` | Fewer players than `minPlayers` | Pass `--guests` |
| `play.mjs` says `the bot threw` | `test/bot.mjs` reads a field the snapshot does not have, often a leftover of the scaffold's bot | Rewrite the bot for your snapshot; the message carries the error |
| `play.mjs` says `must not import` | The bot has an `import` | Use `info.game`, which holds the exports of `public/game.js` |
| `play.mjs` stops with `"stopped": "seconds"` and too few rounds | The bots do not finish a round in time | Make the bot play better or the seats differ; or raise `--seconds` |
| `play.mjs` says `scrolls sideways` | An element is wider than a 360 px screen | Fix the stylesheet; nothing may have a fixed width above 328 px |
| The arena is a thin strip or invisible | Its parent shrinks to fit | Give the parent a definite width: a `1fr` grid column or `width: 100%` |
| `link` | The page has no link to the superapp | Add `<a href="https://edge-multiplayer-games.wasmer.app">` |
| `create` naming `no invite-link slot` | The page cannot show the invite | Add an element with `data-engine="invite-link"` |
| `published` | `public/engine/<version>/` is missing or stale | `node scripts/sync-engine.mjs publish`, then `node scripts/sync-engine.mjs verify` |
| `server`, `netcode`, `accumulator` | The game has its own server, socket, or loop | Delete it; the engine owns these |
| `simulation` naming `missing method …` | The class does not match the shape in section 2 | Add the method or field it names |
| `schema` | Unknown type, width, or an interpolated discrete field | Fix the `SNAPSHOT` field it names |
| `fixture` with `replay: diverged` | Rules changed after recording, or the simulation uses unseeded randomness or time | Remove the nondeterminism, then `RECORD=1 npm test` |
| `budget` | A snapshot is larger than the budget | Fewer fields, narrower `bits`, coarser `scale` |
| `readme` | A contract heading is missing | Section 3.2 |

### 3.9 Deploy and verify

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

### 3.10 Register in the superapp

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
shared assets) and owns the weekly generation cron job. Its `wasmer.toml`
bundles `public/`, the generation runtime, and prepared Pi dependencies.
Do not add a root `package.json`, a second automation app, or a second
cron schedule. The root `.wasmerignore` is the upload filter for the
root package; do not use `.ignore` there, because search tools read that
filename. It excludes `CLAUDE.md`, a symlink the packager refuses.

Weekly games reach this point through the generator
([`automation/daily-game/README.md`](automation/daily-game/README.md)):
it scaffolds, lets the model author the files in section 3.1, rejects a
candidate that fails any static check or keeps the scaffold's theme, and
opens a draft pull request
with `url: null`. A person runs the full tier and `scripts/play.mjs`, looks
at the screenshots, merges, and deploys.

### 3.11 Vendoring escape hatch

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
- [ ] `npm test` passes in the game directory, with at least two rule scenarios and a one-player scenario
- [ ] `test/replay.ndjson` was recorded after the last rule change
- [ ] `test/bot.mjs` plays the game well enough to finish rounds
- [ ] `node scripts/play.mjs <slug> --phone --rounds 3 --shots <dir>` exits 0, and you opened the screenshots: desktop, phone, a late round, each round result, spectator
- [ ] The same with `--guests 1` and with `--guests 7`: two players have a game, eight fit
- [ ] Every item of the design checklist in section 6 holds, or the README says why not
- [ ] `node scripts/conformance.mjs <slug>` passes every row (full tier)
- [ ] `node scripts/soak.mjs <slug>` passes
- [ ] Scaffold-owned files are unchanged; the import map pins the current engine version
- [ ] The page and `public/style.css` are the game's own: its palette, typography, layout, and copy, not the scaffold's theme
- [ ] The page loads nothing from another origin
- [ ] Lobby and game are usable at 360 px wide, and every intent field has a touch control on a phone
- [ ] Two-tab local game: join, steer from the guest, round advance
- [ ] Deploy log: `Packaging project directory (N files…)` with a sane `N`, `Detected Node.js provider`
- [ ] `node scripts/conformance.mjs https://<app>` passes
- [ ] Production two-browser game, and one invite link opened on a phone
- [ ] Entry in `public/games.json` has the real URL, superapp redeployed, card shows online

## 6. Design checklist for a great game

A game that passes every command can still be dull. Hold the design, and then
the screenshots, against this list. The patterns it names are in
`engine/README.md`, "Game feel cookbook".

- **Clear in ten seconds.** One sentence in the lobby says the goal and one
  says the controls. In the game, the status line (`ctx.hud`) always says
  what this player should do now. Nobody reads a rules page.
- **You know which one is you.** At once and all the time: a ring or an arrow
  on your actor, your row marked in the scoreboard. By shape, not only colour.
- **Every action answers back.** Each press does something visible within a
  frame or two, and has a sound. Each score, hit and death has a one-shot
  effect and a sound. The player's own events look and sound richer than
  everyone else's.
- **The important thing is the biggest thing.** Whatever decides the round (a
  bomb, a timer, the last pellet) is readable from across the room and on a
  phone. Danger has one colour and nothing else uses it.
- **Nobody sits out.** A player who is eliminated keeps a role: a ghost that
  nudges, a vote, a hazard to steer. Or rounds are under a minute. A
  spectator's status line says when they get a seat.
- **The leader can be caught.** A comeback mechanic: the leader is marked or
  slowed, the trailing player spawns better, late rounds score more, or a
  clear lead is needed to win.
- **Rounds are short.** 20 to 90 seconds. A countdown opens the round so
  nobody dies at the spawn. The round result stays on screen long enough to
  read, and says who and why.
- **It works with two and with eight.** Two players must still have a game
  (no mechanic that needs a crowd). In an elimination game the first fall
  ends a two-player round: make sure the eliminated player's role still
  matters, or that the round loop is fast. Eight must fit: the board grows
  with the player count, spawns do not overlap, names do not pile up on a
  crowd, the scoreboard does not push the board off a phone.
- **Colour-blind safe.** No two things differ by red against green alone.
  Player colours come with a name label; states come with a shape or a word.
- **Playable on a phone.** Every intent field has a touch control under a
  thumb, at least 96 px. Nothing scrolls sideways at 360 px. The board is
  visible together with the controls. Text on the canvas is rare and large.
- **It sounds like something.** A sound for each action, the stakes raise the
  pitch, one big sound per round. It is also fully playable muted.
- **It has a look.** One palette, one typographic voice, lobby copy with a
  tone. A stranger shown two screenshots can tell this game from the others
  in the catalog.

## 7. Conventions

- One directory per game, self-contained, own `app.yaml`.
- The engine owns behaviour, the game owns its page and stylesheet.
  Shared code never carries a theme into a game, and no two games share
  a look.
- One copy of the engine: `engine/`. `public/engine/<version>/` is its
  published copy, written only by `node scripts/sync-engine.mjs publish`.
  `engine/` inside a game is a deploy-time copy and is ignored by git.
- A game never restates an engine tunable; import it from `params`.
- Comments: one short line for the non-obvious only. Rationale goes in
  the README.
- Browsers cache a version path for a year. After a version has been
  deployed, its directory under `public/engine/` is frozen: never edit
  or delete it. An engine change ships as a new `ENGINE_VERSION` in
  `engine/params.js`, `node scripts/sync-engine.mjs publish` into a new
  directory beside the old ones, and a new pin in each game that wants it.
- An asset set is frozen the same way. A new shared sound ships as a new
  `ASSET_SET_VERSION` and a new directory under `public/assets/`, written by
  `node scripts/make-assets.mjs`.
- The scaffold's files are `scripts/scaffold/`. The example in
  `engine/README.md` is those files; after a change run
  `node scripts/sync-example.mjs`.
- Keep this file and `engine/README.md` current. If a step is wrong for the
  platform as it exists today, fix the step, do not work around it silently.
  If you had to read engine source to build a game, add what you learned to
  `engine/README.md`.
