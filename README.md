# Edge multiplayer games

Browser multiplayer games where Wasmer Edge does the matchmaking and the
browsers do the playing. The repository root is itself an Edge app, the
**superapp**: a static index that lists every game deployed from the
directories beneath it and shows whether each one is up and how many
rooms are open. Each game is one directory with its own `app.yaml`,
deployable on its own.

| App | Directory | Live |
|---|---|---|
| Superapp (index) | `public/` at the root | https://edge-multiplayer-games.wasmer.app |
| Achtung, die Kurve! | [`achtung/`](achtung/) | https://achtung-webrtc.wasmer.app |
| Ring Rumble (3D fighter) | [`ring-rumble/`](ring-rumble/) | First publish pending |
| Prism Post | [`daily-2026-09-11/`](daily-2026-09-11/) | https://daily-2026-09-11.wasmer.app |

Want to add a game? Read [`AGENTS.md`](AGENTS.md). It is the step by step
recipe for cloning the model below onto any real-time multiplayer game
and registering it in the superapp.

## The model

```
     ┌───────────────── Wasmer Edge app ─────────────────┐
     │  GET /          static client                     │
     │  GET /healthz   {ok, rooms, players}              │
     │  WS  /ws        signaling: rooms + SDP/ICE relay  │
     └────────▲────────────────▲────────────────▲────────┘
              │ ws             │ ws             │ ws
       ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
       │   guest A   │  │    HOST     │  │   guest B   │
       │   renders   │◄═╡  runs the   ╞═►│   renders   │
       │  snapshots  │  │ simulation  │  │  snapshots  │
       └─────────────┘  └─────────────┘  └─────────────┘
              RTCDataChannel per guest, star around the host
```

Three layers, each with one job.

**Signaling on Edge.** A small Node server (`src/server.js`) serves the
static client and runs a WebSocket endpoint that knows nothing about any
game. It hands out room codes, keeps the peer list per room, and relays
opaque `signal` blobs between two peers by id. Those blobs are the WebRTC
handshake: SDP offer, SDP answer, ICE candidates. After the handshake the
socket is only used for late joiners and `host-left`.

**Transport between browsers.** The room creator is the host. It opens one
`RTCPeerConnection` and one `RTCDataChannel` per guest. Guests never talk
to each other. Public STUN discovers addresses; there is no TURN.

**Game state on the host.** Only the host runs the simulation
(`public/game.js`). It ticks at a fixed rate, applies the latest input per
player, and broadcasts a snapshot every tick. Every peer, host included,
renders through the same `applyMessage()` path. State is never agreed
upon between peers: one writer owns it and streams it over an ordered,
reliable channel. Guests send intent (`{t:"i", d:-1}`) only when it
changes.

## Why this shape

Edge exposes HTTPS and WebSocket, not UDP, so the media and relay plane of
WebRTC (TURN, SFU) cannot run there. Signaling can, and for a DataChannel
game that is all a server has to do. Edge instances are also ephemeral
(about one hour, stop when idle), which is fine for a lobby and wrong for
a game loop. Putting the loop in the host's browser sidesteps both
constraints and keeps the latency-critical path off the server entirely.

## The superapp

The root app serves `public/` through its `serve` command and owns the daily game cron job.
The cron starts the `daily-game` command from the same Wasmer package.
`index.html` fetches `games.json`, renders one card per game with
a "Host a game" button that opens `<game>/?create=1`, a "Play a random
game" button in the header that picks an online game, and polls each
game's `/healthz` every 15 seconds. The games answer with
`Access-Control-Allow-Origin: *` so the index can read them cross-origin;
a game that does not answer shows as offline, which also covers a
cold-starting instance.

Static was a deliberate choice over a Node index: no instance, no cold
start, nothing to break, and the games already expose what the page
needs. If the index ever needs server-side features (a shared room
directory, stats), give it the same `src/server.js` shape as a game.

Registering a game is one entry in `public/games.json`:

```json
{
  "slug": "achtung",
  "name": "Achtung, die Kurve!",
  "url": "https://<achtung app url>",
  "players": "2 to 8",
  "description": "Steer a growing curve, avoid every trail, last one alive scores.",
  "source": "achtung/"
}
```

Note that `/healthz` reports the rooms held by the instance that answered.
Edge can run several instances of a game; the number is an indication,
not an exact count.

## Quick start

```bash
cd achtung
npm install
PORT=8080 node src/server.js
```

Open http://localhost:8080 in two tabs. Create a room in one, join with
the code or the copied invite link in the other, press **Start game** on
the host. For the superapp, any static file server over `public/` works:

```bash
python3 -m http.server 8090 --directory public
```

## Deploy

Game apps deploy with a remote build.
They are detected as Node from `package.json` (`start` script, no
`wasmer.toml`) and run on the EdgeJS runtime; expect
`Detected Node.js provider` in their build logs.
The root uses an explicit `wasmer.toml` package with the static server and generation runtime.
Its deployment does not use remote provider detection.
The manifest sets `private = true` to match the existing registry package.
Package visibility does not restrict access to the public game website.

```bash
./deploy.sh              # every game, then the superapp
./deploy.sh super        # superapp only
./deploy.sh achtung      # one game
./deploy.sh ring-rumble super # 3D fighter and its index card
```

The script checks that `wasmer whoami` points at `wasmer.io`, runs
`wasmer deploy --non-interactive` for the root, and adds `--build-remote` for each game.
Before the root deployment, it installs the pinned Pi dependencies and prepares them for QuickJS.
It builds the package locally, prints its size, and rejects packages larger than 64 MiB before upload.
The Wasmer filter excludes Pi's unused native dependencies. The root package is about 20 MiB.
The script retries registry 502, 503, and 504 responses twice, after 5 and 10 seconds.
It prepares Pi once per invocation and keeps the final failure log when deployment fails.
It checks game upload sizes and probes the deployed URLs.
`OWNER=<namespace>` overrides the owner in
`app.yaml`; `NO_WAIT=1` skips waiting for the rollout.

Ring Rumble uses WASD or arrows to move, J to punch, and K or Shift to dash.
It supports 2 to 8 browsers, touch controls, and local practice against a bot.
The publish script discovers its directory automatically.
After each game publishes, the script updates its registry URL from Wasmer before the superapp publishes.
For daily games, it inserts missing entries from `game-entry.json` too.
Run `./deploy.sh <game> super` to publish both the game and its card.
If the game is already deployed, `./deploy.sh super` repairs missing catalog entries before deploying the root.
New game PRs include a root catalog entry with `url: null`; the page shows these games as coming soon.

Check catalog updates and pending cards with:

```bash
node scripts/register-game.test.mjs
node scripts/superapp.test.mjs
node scripts/deploy.test.mjs
```

`CLAUDE.md` is a symlink to `AGENTS.md`, and the packager refuses
symlinks. The root `.wasmerignore` file uses Git-style patterns and applies only
to Wasmer packaging. It keeps the symlink, the docs, and the game
directories out of the superapp upload. The root package mounts `public/`,
the automation runtime, and Pi dependencies. Add every new game directory to `.wasmerignore`.

For game builds, watch for `Packaging project directory (N files, …)` before the upload.
If `N` is tiny, the archive is empty and the build will fall back to a
static site with nothing in it; fix the working directory before
anything else. This repository is a git checkout, so `.gitignore` is
honoured by the packager and `node_modules/` stays out of the upload.

## Agent skills

The [daily game automation](automation/daily-game/README.md) runs as a cron job on this root app.
It clones this repository, streams Pi activity, checks a new game, and uses Git
to push a dated branch. It opens a draft PR against `main` for review.
The root `app.yaml` schedules it daily at 06:00 UTC and selects the coding model with `env.OPENAI_MODEL`.
Set `OPENAI_API_KEY` and `GH_TOKEN` as secrets on `wasmer/edge-multiplayer-games` before deployment.
Local model generation and remote PR creation passed. The root cron deployment remains pending.

After [preparing Pi](automation/daily-game/README.md#prepare-once), run these commands from the repository root:

```bash
wasmer run . --net                                  # website at http://localhost:8080
wasmer run . -e daily-game --net \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  --env "GH_TOKEN=${GH_TOKEN:?Set GH_TOKEN first}" \
  -- --publish
```

Install the Wasmer skills once, then let the agent use them for deploys,
logs, rollbacks, and local runtime questions:

```bash
npx skills add wasmerio/docs.wasmer.io
```

That adds `wasmer-edge` (app.yaml, deploys, secrets, databases, volumes,
cron, domains, logs, failure triage) and `wasmer-cli-usage` (local
runtime, packages, WASIX, compiler backends, debugging).

## Layout

```
edge-multiplayer-games/
├── README.md              this file
├── AGENTS.md              how to clone the model onto a new game
├── CLAUDE.md -> AGENTS.md
├── app.yaml               superapp configuration and daily cron schedule
├── wasmer.toml            static server and generation commands
├── automation/daily-game/ Pi implementation, dependencies, and tests
├── deploy.sh              root package and remote game builds
├── public/
│   ├── index.html         game index with live status
│   └── games.json         registry of deployed games
└── achtung/               one directory per game, self-contained
    ├── app.yaml
    ├── package.json
    ├── src/server.js      signaling + static (game-agnostic)
    └── public/
        ├── game.js        simulation (host only, headless-testable)
        ├── client.js      lobby, WebRTC, renderer, input
        ├── index.html
        └── style.css
```
