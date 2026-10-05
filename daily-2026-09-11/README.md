# Prism Post

A competitive sorting arcade for 2–8 players (or solo practice): slide a mail cart across three lanes, catch mint parcels, and dodge coral glitch parcels. Every player has a separate bay receiving the same delivery pattern, so positioning decides the winner.

The game runs on the repository engine (`engine/`, pinned at `1.0.1` in `public/index.html`). The engine owns the lobby, signaling, WebRTC star, tick loop, snapshot codec, guest interpolation, input sources and lobby behaviour. This directory holds the simulation, the snapshot schema, the intent and the renderer.

## Contract

### Input

One intent field, `move`, declared as `INTENT` in `public/game.js`: `-1` slide left, `0` stop, `1` slide right, held continuously.

| Source | Mapping |
|---|---|
| Keyboard | `ArrowLeft` and `ArrowRight`. Both together cancel to stop. |
| Touch | The page's `←` and `→` buttons (`data-engine-touch`), also usable with a mouse. |
| Gamepad | Axis 0. |

The engine sends the intent only on change, re-sends it on an interval, and releases it on blur. The simulation treats any other value as stop.

### Snapshot

Declared as `SNAPSHOT` in `public/game.js` and encoded by the engine codec at 30 Hz. Every snapshot reconstructs the whole scene.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint16 | Steps since the round started, countdown included. Tick field. |
| `f` | uint8 | Countdown ticks left, `45..0`. |
| `left` | uint16 | Active ticks left, `900..0`. |
| `over` | bool | The shift has ended. |
| `x` | fixed ×1000 per player | Cart position in its bay, `0.12..0.88`. Interpolated. |
| `score` | uint16 per player | Match score. |
| `active` | bool per player | False after the player leaves. |
| `flash` | int8 per player | Signed feedback countdown: positive after a catch, negative after a glitch. |
| `bl` | uint8 × 3 slots | Parcel lane index. |
| `by` | fixed ×1000 × 3 slots | Parcel height, `0..1.04`. Interpolated. |
| `bt` | int8 × 3 slots | `1` mint, `-1` glitch, `0` empty slot. |
| `bm` | uint8 × 3 slots | Bit per player: the parcel is resolved in that bay. |
| `d` | player list | Players whose score changed this tick. |

The old nested lists became flat fields. The per-cart tuple `[x, score, active, flash]` is four per-player fields. The parcel list `[id, lane, y, type, mask]` is four fixed-count fields of three slots; a parcel holds slot `id % 3` for its whole fall, and at most three parcels are live. The parcel id is no longer sent. An eight-player snapshot is 71 bytes, against a budget of 800.

`k` counts every step, not only active ticks. The guest buffer drops a frame whose tick repeats, so a tick that paused during the countdown would freeze the countdown on guests. `Game.tick` still counts active ticks only.

### Round lifecycle

- `startRound()` increments the round, centres the carts, clears parcels, feedback and the tick, and starts a 45-tick countdown. Match scores and disconnected status persist.
- Deliveries last 900 ticks (30 seconds). A parcel spawns every 30 ticks until tick 810, in a lane drawn from the injected generator. Every fourth parcel is a glitch.
- A mint catch earns 1. A glitch catch subtracts 2, floored at zero. A miss costs nothing.
- The round ends at tick 900 or when every cart is inactive, and the simulation then stays inert.
- `winner(20)` is the unique connected leader at or above 20, otherwise `-1`. Tied leaders play on.
- The host advances with Space or the Next round button. `disconnect(index)` keeps that bay inactive in later rounds.

## Look and feel

The page (`public/index.html`) and the stylesheet (`public/style.css`) are the game's own: the depot panel, the shift clock (`#clock`) and the cart buttons. The engine binds behaviour to the elements marked `data-engine="<role>"` and injects no layout or theme. `client.js` passes the game's player colours (`COLORS` in `game.js`) as `palette` and its banner and next-control copy as `labels`; `draw` paints the canvas with the game's palette and updates the page's own elements by id.

## Changes from the pre-engine version

The engine lobby replaced the per-game lobby, so the optional second local player (A/D) and the display-size selector are gone. After a match win the host's next control starts a new match. Delivery lanes now come from the seeded generator the engine injects, so a recorded match replays exactly.

## Local checks

```bash
npm test
```

This runs the four original scenarios, the engine shape check, the snapshot budget at eight players, an exact codec round trip, the committed replay fixture `test/replay.ndjson` (four players, three shifts, seed `20260911`), and a determinism check.

From the repository root:

```bash
node scripts/dev.mjs daily-2026-09-11 8812
```

Open `http://localhost:8812/?create=1` and open the invite link in a second tab.

## Deployment

The game runs at https://daily-2026-09-11.wasmer.app. From the repository root:

```bash
node scripts/sync-engine.mjs game daily-2026-09-11
./deploy.sh daily-2026-09-11 super
```

The first command copies the engine's server modules into `engine/` (ignored by git); `src/server.js` imports them. Production two-browser play remains a human check.
