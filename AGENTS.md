# Agent guide: cloning the multiplayer model onto a new game

This repository holds browser multiplayer games on Wasmer Edge plus a
superapp that indexes them. `achtung/` is the reference implementation.
Follow this file to add a game. Every rule here exists because of a
platform constraint or a bug already hit; do not skip the checks.

## 0. Before you start

Install the Wasmer agent skills once. They are the source of truth for
`app.yaml`, deploys, logs, rollbacks, secrets, and the local runtime, and
they are verified against the live CLI and API:

```bash
npx skills add wasmerio/docs.wasmer.io
```

Use `wasmer-edge` for anything that touches a deployed app and
`wasmer-cli-usage` for anything local (`wasmer run`, packages, WASIX).
When those skills and `wasmer <cmd> --help` disagree, trust `--help`.

Check the registry before any deploy. Dev machines often point at
`wasmer.wtf`:

```bash
wasmer whoami        # expect: Logged into registry wasmer.io as user …
```

## 1. The model in one paragraph

Edge runs a game-agnostic signaling server and serves the client. The
room creator's browser is the host: it runs the simulation at a fixed
tick rate, applies the latest input per player, and broadcasts a snapshot
per tick over one ordered, reliable `RTCDataChannel` per guest (star
topology). Guests send intent only when it changes and render the stream.
State is never agreed upon; one writer owns it. The superapp at the repo
root lists every game and can drop a player straight into a fresh room.

Why: Edge exposes HTTPS and WebSocket but no UDP, so TURN or an SFU
cannot live there, and instances are ephemeral (about one hour, stop when
idle), so a server-side game loop is the wrong place for state.

## 2. What is reusable and what is not

| Part | File | Reuse |
|---|---|---|
| Static + signaling server | `src/server.js` | Verbatim. It has no game knowledge. |
| Lobby, WebRTC handshake, star wiring | `public/client.js` top half | Verbatim. |
| Host tick loop, `broadcastGame`, `applyMessage` dispatch | `public/client.js` | Keep the shape, change the cases. |
| Sub-app contract (`?create`, `?room`, invite panel, `/healthz`) | `client.js`, `server.js`, `index.html` | Verbatim. Required. |
| Simulation | `public/game.js` | Rewrite. Keep the interface. |
| Snapshot format, renderer, input mapping | `client.js` bottom half | Rewrite per game. |
| Arena scaling | `mapSize()` | Optional. Keep if the game has a board. |

## 3. Steps

### 3.1 Copy and rename

```bash
cp -r achtung <game>
cd <game>
rm -rf node_modules .anybuild .shipit
```

Edit `app.yaml`: set `name` (lowercase, digits, inner hyphens), set
`owner`, delete `app_id`, delete the whole `annotations:` block. The
annotations are written back by the CLI after every remote build and pin
the detected provider; a copied block would pin the old app's detection.
Keep `locality.regions: [fr-roub1]` unless there is a reason to change it
(one region keeps the per-instance room registry mostly coherent).

Edit `package.json`: `name`, `description`. Keep `"type": "module"`, the
`start` script, and `ws` as the only dependency. No `wasmer.toml`: the
remote build detects Node from `package.json` and runs it on EdgeJS.

### 3.2 Design the contract before writing code

Write these three things down in the game's README first:

- **Input** per player per tick. Keep it tiny and discrete: a direction,
  a button state, a cell index. Send it only on change.
- **Snapshot** per tick. Arrays, not objects; round floats; include an
  event list (`d` for deaths in Achtung) and `over`. Aim for under 100
  bytes per player per tick. The snapshot must be enough to render from
  scratch after a `round` message, because guests keep no other state.
- **Round lifecycle**: what `round` resets, what `over` carries, what
  the host does on Space.

### 3.3 Implement `game.js`

Keep this interface, the host loop depends on it:

```js
export class Game {
  constructor(playerCount, opts)   // opts from mapSize() or your own
  startRound()                     // reset per-round state, round += 1
  step(inputs)                     // inputs[i] per player; returns snapshot
  winner(target)                   // index or -1
  // fields read by the loop: round, roundOver, scores
}
```

Rules:

- No DOM, no network, no timers inside `game.js`. It must run headless in
  Node so you can unit test it: `node --input-type=module -e 'import …'`.
- All randomness inside the game (spawns, holes, loot) is fine because
  only the host runs it. If you later move to lockstep, seed it.
- `step()` is called at `TICK_HZ` by an accumulator loop; make it O(n)
  and allocation-light. A `Uint8Array` grid is the Achtung collision
  structure; pick what fits.

### 3.4 Wire `client.js`

- `hostStart()`: build the player table, construct `Game`, broadcast and
  apply `lobby`, call `hostNextRound()`, start the accumulator loop. Only
  the `Game` constructor arguments and the `lobby` payload change.
- `applyMessage()`: add the cases your snapshot needs. Both host and
  guests go through this function; never draw outside it.
- Input: map keys to the intent your game defined. Guests call
  `dcSend(host.dc, {t:"i", …})` on change; the host reads
  `state.localDirs` (or your equivalent) directly.
- Keep `setArena()` if the game has a board. It sizes canvases and the
  CSS aspect ratio from the `lobby` message so every peer draws the same
  grid.

### 3.5 Implement the sub-app contract

The superapp relies on every game honouring this. It is already in the
Achtung copy; verify it survived your edits.

| Entry | Behaviour |
|---|---|
| `GET /healthz` | JSON `{ok, rooms, players}` with `Access-Control-Allow-Origin: *`. The superapp page polls it cross-origin. |
| `GET /?create=1` | On WebSocket open, create a room automatically, show the invite panel with the full `?room=CODE` link and a copy button. This is where "Play a random game" lands. |
| `GET /?room=CODE` | Auto-join with the stored or a generated name. This is the link friends receive. |
| Header link | A link back to the superapp so players can find the other games. |

The room creator is the host, so whoever clicks "Play a random game"
hosts. That matches the model: the first browser in is the one that
runs the simulation.

### 3.6 Test locally, in this order

1. Unit: put the simulation through known scenarios in Node. For a board
   game, a straight run must die at the predictable wall tick; a turning
   curve must survive until it meets its own trail. For a card or turn
   game, replay a fixed input sequence and assert the final state.
2. Server: `PORT=8765 node src/server.js`, then `curl /healthz`, `/`,
   `/ws` (expect 426), and `/../etc/passwd` (expect 404, not 403 leak).
3. Two tabs on `localhost`: create, join, DataChannel `connected/open`,
   Start, steer from the guest, watch the host's input array change,
   Space for the next round. Loopback ICE works without STUN.
4. Contract: open `/?create=1` in a fresh tab and confirm the invite
   panel appears with no clicks; open the link in a second tab and
   confirm it auto-joins.

### 3.7 Deploy and verify

```bash
../deploy.sh <game>        # or, by hand, from the game directory:
wasmer deploy --build-remote --non-interactive --owner <namespace>
```

Read the log for `Packaging project directory (N files, …)`. If `N` is
one or two, the archive is empty (seen once, cause unresolved, working
directory suspected) and the build will produce a static 404 site. Stop
and fix before continuing. Then confirm `Detected Node.js provider` and
`node@… │ wasmer/edgejs-quickjs`.

After the rollout, from outside:

```bash
curl -sD - -o /dev/null https://<app>/healthz | grep -i x-edge   # region, version
node -e 'const w=new WebSocket("wss://<app>/ws");w.onopen=()=>{w.send(JSON.stringify({t:"create"}));};w.onmessage=e=>{console.log(e.data);w.close()}'
```

A 400 on the WebSocket handshake with an otherwise healthy app is Edge
rewriting `Connection: Upgrade`; check
https://linear.app/wasmer/issue/EDGE-2012 before touching the app.

Finish with the two-tab test against the production URL. Then run the
contract check against production: `/?create=1` must land in a room.

### 3.8 Register in the superapp

Deployment is complete only when the root catalog contains the game and the
superapp deployment serves that entry. Deploying the game alone does not publish
its card.

For daily games, write `game-entry.json` with `slug`, `name`, `players`,
`description`, and `source`. The generation coordinator adds these fields to
`public/games.json` with `url: null` and adds `/<game>/` to `.ignore` in the PR.
The page shows these entries as coming soon until deployment supplies a URL.
Do not guess a Wasmer URL.

After merging a daily game, deploy both targets from the repository root:

```bash
./deploy.sh <game> super
```

The script reads the deployed URL from Wasmer and inserts or updates the root
catalog entry from `game-entry.json`. It then redeploys the superapp. If the game
is already deployed, `./deploy.sh super` also repairs missing entries and URLs.
Commit the resulting catalog and manifest changes.

For a game without `game-entry.json`, register it manually before deployment:

Add an entry to `public/games.json` at the repo root and redeploy the
root app:

```json
{
  "slug": "<game>",
  "name": "<Display name>",
  "url": "https://<app>.wasmer.app",
  "players": "2 to 8",
  "description": "One sentence.",
  "source": "<game>/"
}
```

```bash
./deploy.sh super
```

The superapp is static by choice: no `package.json` at the root,
`public/index.html` present, so the remote build picks the static
provider and serves `public/`. Do not add a root `package.json`; it would
flip detection to Node.

Also add `/<game>/` to the root `.ignore`. That file is the upload
filter for the root deploy (ripgrep syntax, honoured by the wasmer
packager, not by git). It already excludes `CLAUDE.md`, which is a
symlink the packager would otherwise refuse, and the other game
directories. Expect `Packaging project directory (3 files, …)` for the
root: `app.yaml`, `index.html`, `games.json`.

## 4. Constraints to design around

- **No UDP on Edge.** No TURN, no SFU, no game server with DataChannels.
  Only public STUN is configured; symmetric-NAT pairs cannot connect.
  A TURN provider, if ever needed, runs outside Edge and is configured in
  `ICE.iceServers`.
- **Rooms live in one instance's memory.** Edge may run several
  instances of an app; `/healthz` counts rooms on the instance that
  answered; a guest can in principle miss the host's room. Pin one region.
  If it bites, back rooms with the managed Postgres (see the
  `wasmer-edge` skill for `capabilities.database`).
- **Instances are ephemeral.** Losing the signaling socket does not end a
  game (DataChannels stay up) but stops new joins until the host recreates
  the room. Never keep game state on the server.
- **Ordered, reliable channel by default.** It is SCTP with
  retransmission; guests see exactly the host's sequence. Add a second
  channel with `ordered: false, maxRetransmits: 0` only for high-rate
  inputs where a stale message is worse than a lost one.
- **Host authority.** The host has zero input latency and could cheat.
  Acceptable for friends. Lockstep (every peer simulates, inputs are
  shared, full mesh, seeded RNG, state hashes) is the alternative when
  fairness matters; it keeps the signaling layer and the renderer.
- **`.gitignore` is honoured only inside a git repository** by the
  packager. This repo is one. Outside it, `node_modules` gets uploaded.
- **The CLI writes annotations back into `app.yaml`** after each remote
  build. With the right provider they are harmless; after a wrong
  detection delete them.
- **EdgeJS is not upstream Node.** `node:http`, the `upgrade` event, and
  `ws` are proven. Test anything else before depending on it.

## 5. Checklist before calling a game done

- [ ] `game.js` runs headless in Node with at least two scenario checks
- [ ] Two-tab local game: join, DataChannel open, steer, round advance
- [ ] `/?create=1` shows the invite panel without a click
- [ ] `/?room=CODE` auto-joins
- [ ] `/healthz` returns JSON with `Access-Control-Allow-Origin: *`
- [ ] `app.yaml` has its own `name`, no copied `app_id`, no copied annotations
- [ ] Deploy log: `Packaging project directory (N files…)` with a sane `N`, `Detected Node.js provider`
- [ ] Production two-tab game and contract check pass
- [ ] Entry added to `public/games.json`, superapp redeployed, card shows online
- [ ] Game README documents input, snapshot, and round lifecycle

## 6. Conventions

- One directory per game, self-contained, own `app.yaml`. No shared
  package; copy the reference files. If three games share a file
  byte-for-byte, extract it then, not before.
- Comments: one short line for the non-obvious only. Rationale goes in
  the README.
- Keep this file current. If a step here is wrong for the platform as it
  exists today, fix the step, do not work around it silently.
