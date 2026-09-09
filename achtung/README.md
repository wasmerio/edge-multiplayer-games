# Achtung, die Kurve! on Wasmer Edge (WebRTC)

A multiplayer Achtung die Kurve clone. Gameplay runs peer-to-peer over
WebRTC DataChannels; Wasmer Edge hosts only the static client and the
WebSocket signaling server. Edge exposes HTTP and WebSocket, not UDP, so
the media/relay plane of WebRTC cannot live there. Signaling can, and for
a DataChannel game signaling is all a server has to do.

## Layout

| Path | Role |
|---|---|
| `src/server.js` | `node:http` static server + `ws` signaling on `/ws`; in-memory rooms |
| `public/game.js` | host-authoritative simulation (grid collision, holes, scoring) |
| `public/client.js` | lobby, WebRTC star topology, renderer, input |
| `public/index.html`, `public/style.css` | UI |
| `app.yaml` | Edge app manifest, pinned to `fr-roub1` |

## Topology

```
browser A (host) ──WS──┐                ┌──WS── browser B
                       │  Edge app      │
                       │  /ws signaling │
                       └────────────────┘
browser A (host) ◄════ RTCDataChannel "game" ════► browser B
                 ◄════ RTCDataChannel "game" ════► browser C
```

The room creator is the host. The host runs `Game` at 60 ticks/s, applies
the latest input per player, and broadcasts a snapshot every tick
(`{t:"s", k, p:[[x,y,alive,gap],…], d:[deaths], over}`); the `lobby` message carries `map: {w, h}`. Every peer,
host included, renders through the same `applyMessage` path, so the host
sees exactly what the others see. Clients send `{t:"i", d:-1|0|1}` only
when their steering changes.

Signaling messages: `create`, `join`, `signal` (SDP or ICE candidate
relayed to `to`), `ping`; server replies `created`, `joined`, `peer`,
`leave`, `host-left`, `signal`, `error`.

## Run locally

```bash
npm install
PORT=8080 node src/server.js
```

Open http://localhost:8080 in two tabs. Create a room in one, join with
the code (or the copied invite link) in the other, press **Start game**
on the host. Tick **add local player 2** on the host to steer a second
curve with A/D from the same keyboard.

Controls: `←`/`→` steer, `A`/`D` steer local player 2, `Space` (host)
starts the next round. Scoring is classic: every surviving player gains
one point per death; first to `10 × (players − 1)` (minimum 5) wins.

### Arena size

The arena grows with the player count. `mapSize(players, scale)` in
`game.js` keeps the 4:3 aspect and scales the *area* by
`(1 + (players − 1) × MAP.perPlayer) × scale`, snapped to multiples of
4 px. The host picks `scale` from the **Map** dropdown (small 0.7,
normal 1, large 1.4, huge 2); the lobby shows the resulting size live.
Tune `MAP.baseW/baseH/perPlayer` for a different curve.

| Players | normal | huge |
|---|---|---|
| 1 | 800×600 | 1132×848 |
| 2 | 928×696 | 1316×984 |
| 4 | 1144×860 | 1620×1216 |
| 8 | 1484×1116 | 2100×1576 |

The dimensions travel to guests in the `lobby` message, and
`setArena()` resizes both canvases and the CSS aspect ratio, so every
peer renders the same grid the host simulates.

## Deploy to Wasmer Edge

The app uses the remote Node preset (`package.json` with a `start`
script, no `wasmer.toml`), the same path the Edge WebSocket contract
tests use.

```bash
wasmer whoami                                   # expect registry wasmer.io
wasmer deploy --owner baalimago --build-remote --non-interactive
```

Change `owner` in `app.yaml` if the app should live under another
namespace. Then open the printed URL and run the same two-tab check.

Deployed 2026-09-09 as https://achtung-webrtc.wasmer.app (CLI 7.3.0,
Anybuild 0.28.2). The `wasmer.io/version` annotation the CLI writes back
into `app.yaml` is the build server's version, not the CLI's. The build log shows the shape to expect:

```
Packaging project directory (28 files, 54.6 KiB)
Detected Node.js provider   Server: Node.js   Node version: 24
node@24  │  wasmer/edgejs-quickjs@=0.2.0
```

Facts learned from the first, broken deploy:

- The first deploy uploaded an archive containing only `.gitignore`.
  Anybuild then saw an empty project, picked the `staticfile` provider,
  and served 404 for every path. A later deploy from the same directory
  with `--dir <absolute path>` uploaded all 28 files, so the cause is in
  the invoking environment (working directory or `--path`), not in the
  project. Unresolved; the CLI prints `Packaging project directory
  (N files, …)` before upload, so check that line first.
- After every remote build the CLI writes `annotations.anybuild.run/*`
  back into `app.yaml`, including the detected provider. After a wrong
  detection delete those annotations before redeploying, or the
  provider stays pinned. With `provider: node` they are fine to keep.
- `.gitignore` is only honoured inside a git repository (the walker uses
  `require_git`). Outside one, `node_modules` is uploaded too. Harmless
  here (only `ws`), but `git init` the directory if it grows.
- The Node preset runs on the EdgeJS QuickJS runtime, not upstream
  Node. `node:http`, the `upgrade` event, and `ws` all work.

Useful follow-ups:

```bash
wasmer app logs baalimago/achtung-webrtc --from 10m --streams stdout --streams stderr
wasmer app deployment list baalimago/achtung-webrtc
```

## Sub-app contract (used by the superapp)

| Entry | Behaviour |
|---|---|
| `GET /healthz` | `{ok, rooms, players}` with `Access-Control-Allow-Origin: *` |
| `/?create=1` | creates a room on load and shows the invite panel |
| `/?room=CODE` | auto-joins with the stored or a generated name |
| `← all games` | header link back to the superapp |

## Edge-specific caveats

- **WebSocket handshake regression (EDGE-2012).** On 2026-08-13 Edge
  rewrote `Connection: Upgrade` to `Connection: close` for reusable
  instances. Fix commits are on Edge `main`; the ticket was reopened the
  same day. If the lobby shows `signaling error`, check
  https://linear.app/wasmer/issue/EDGE-2012 before debugging the app.
- **Rooms are per instance.** Room state is in process memory. Edge runs
  one or more instances per node and has no sticky sessions, so two
  players can, in principle, land on different instances of the same
  app and not see each other's room. Pinning one region keeps this rare.
  A shared store (managed Postgres mailbox) removes the race entirely
  and is the first thing to add if it bites.
- **Instances are ephemeral.** An instance lives for about one hour and
  stops when idle. Losing the signaling socket does not end a game in
  progress: DataChannels stay up. It does prevent new joins until the
  host reloads and recreates the room.
- **No TURN.** Only public STUN is configured. Peers behind symmetric NAT
  cannot connect; add a TURN provider (Cloudflare, Twilio) outside Edge
  in `client.js` `ICE.iceServers` if needed.

## Not yet done

- Reconnect/resume for peers that drop mid-game.
- Unordered/unreliable channel for inputs (currently ordered, reliable;
  fine at this message size).
- Persisted rooms across instances (see caveat above).
- Touch controls.
