# Switchback Regatta

A host-authoritative boat race for 2–8 players (or solo practice). Steer an automatically moving skiff through six numbered buoy rings, twice, while currents shift and reefs punish careless shortcuts. Boats do not collide with one another. No trails, elimination, or collection lanes.

## Contract

The game runs on the repository engine (`engine/`, pinned at `1.0.1` in `public/index.html`). The engine owns the lobby, signaling, WebRTC star, fixed-tick host loop, snapshot codec, guest interpolation and lobby behaviour. This directory holds the simulation (`public/game.js`), the draw function (`public/client.js`) and the tests.

### Input
The intent is `{ turn }` with `turn` in `-1 | 0 | 1`: port rudder, straight, starboard rudder (`INTENT` in `game.js`). Arrow keys steer; both keys together cancel out. The page's two hold-to-turn buttons (`data-engine-touch`) work with touch or mouse, and a gamepad's first axis steers too. The engine sends the intent only when it changes, re-sends it once a second, and clears it on blur. The simulation also accepts a bare number per player, which the scenario tests use. Turning reduces thrust; straight sailing restores speed.

### Snapshot
Declared once as `SNAPSHOT` in `game.js` and encoded by the engine's binary codec (143 bytes at eight players, against a budget of 100 bytes per player).

| Field | Type | Meaning |
|---|---|---|
| `n` | uint16 | Steps since the round began, countdown included. The frame order key for guests. |
| `k` | uint16 | Race ticks; stays at zero during the countdown. |
| `f` | uint8 | Countdown ticks remaining. |
| `left` | uint16 | Race ticks remaining. |
| `cx`, `cy` | fixed, 4 decimals | Current drift per tick. |
| `over` | bool | The race has ended. |
| `x`, `y` | fixed, 4 decimals, per player | Position as a fraction of the course. Interpolated on guests. |
| `a` | fixed, 1/5000 rad, per player | Heading. Not interpolated, because it wraps. |
| `cp` | uint8, per player | Rings passed, 0 to 12. |
| `fin` | uint16, per player | Finish tick, zero until finished. |
| `stun` | uint8, per player | Collision slowdown ticks remaining. |
| `on` | bool, per player | False once the player has disconnected. |
| `scores` | uint16, per player | Match points. |
| `gate`, `hit`, `done`, `award` | player lists | Who passed a ring, hit a reef or shore, finished, or won points on this tick. |

Ring and reef geometry is constant, so it is exported from `game.js` (`GATES`, `REEFS`) and not sent. A guest draws any frame from scratch with the snapshot and those constants.

### Round lifecycle
`startRound()` increments `round`, preserves match scores and disconnected-player flags, resets positions, headings, checkpoint counters, finish times, collision cooldowns and a two-second countdown. A race lasts at most 60 seconds, shortened to eight seconds remaining after the first finisher. All active boats finishing also ends it. Earliest finish wins; otherwise highest checkpoint count then nearest next ring wins. Exact ties share the award. Winners receive 3 match points; other finishers receive 1. Zero progress awards nothing. Disconnected boats cannot score. Match target is 9; a tied match continues until a unique leader reaches the target.

The engine's `round` message clears the canvases and the snapshot carries the countdown. Its `over` message carries the match winner index, or -1 for a race-only result. The host advances with Space or the Next round button, only after the race ends. The simulation draws no randomness, so a replay needs only the input log.

## Look and feel

The page (`public/index.html`) and the stylesheet (`public/style.css`) are the game's own: the marina lobby, the race clock (`#race-clock`), the helm buttons and the standings list (`#scores`, which `draw` fills itself because each row carries race progress). The engine binds behaviour to the elements marked `data-engine="<role>"` and injects no layout or theme. `client.js` passes the game's player colours (`COLORS` in `game.js`) as `palette` and its banner and next-control copy as `labels`; `draw` paints the canvas with the game's palette and updates the page's own elements by id.

## Running and controls

```bash
cd daily-2026-10-04
npm test
```

From the repository root, run the game against the engine in the checkout:

```bash
node scripts/dev.mjs daily-2026-10-04 8765
```

Open `http://localhost:8765/?create=1`, share the invite link, then start. Pass inside the numbered rings in order; the clock above the course and the standings beside it show the time left and each boat's next ring. Two circuits (12 rings) finish the race. Reefs and shore collisions turn the boat away and slow it briefly. The current arrow shows the drift direction.

`npm test` runs the four rule scenarios in `test/scenarios.js`, the engine shape check, the codec round trip, the eight-player snapshot budget, and the replay of the committed fixture `test/replay.ndjson` (three players, three races).

## Registration and deployment — coordinator-owned

Metadata is in `game-entry.json`. The coordinator adds it to both catalogs; the root superapp reads **`public/games.json`**, not `automation/daily-game/catalog.json`. The initial root entry must have `url: null`; do not guess a URL. The coordinator also excludes `/daily-2026-10-04/` in root `.wasmerignore`.

After merge, from the repository root:

```bash
./deploy.sh daily-2026-10-04 super
```

This must deploy the game, record its actual URL from Wasmer, and redeploy the superapp (AGENTS.md §3.8). Leave commits, pushes and deployment to the coordinator.

**Deployment blocker outside the permitted edit paths:** the supplied `app.yaml` still names `achtung-webrtc`, includes the copied `app_id` and `annotations`; `package.json` still has Achtung's name/description. Coordinator must set the new app/package identity and intended owner, remove copied app ID/annotations, and retain `fr-roub1`, ESM, start script and sole `ws` dependency before deploying. These protected files are intentionally not edited here. Package preparation is complete; no skills installation or deployment attempted in this restricted worktree.
