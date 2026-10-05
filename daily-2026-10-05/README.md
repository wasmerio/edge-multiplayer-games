# Relay Orbit

A precision broadcast race for 2–8 players (or solo practice). Turn a momentum-driven antenna toward the gold transmission window. Every 2.5 seconds the relay fires: the inner ±8° earns 3 points, the outer ±22° earns 1, and a miss earns 0. Everyone has the same target and starting angle. A dashed marker previews the next target. Release to brake, or countersteer to reverse. Ten broadcasts make a round; a unique leader with at least 60 total points wins at round end. Ties continue into another round.

## Contract

The game runs on the repository engine (`engine/`, pinned at `1.0.0` in `public/index.html`). The engine owns the lobby, signaling, WebRTC star, fixed-tick host loop, snapshot codec and page chrome. This directory holds the simulation (`public/game.js`), the draw function (`public/client.js`) and the tests.

### Input
The intent is `{ turn }` with `turn` in `-1 | 0 | 1`: counterclockwise, brake, clockwise (`INTENT` in `game.js`). Arrow keys rotate; both keys together brake. Touch devices get two hold-to-rotate buttons, and a gamepad's first axis rotates too. The engine sends the intent only when it changes, re-sends it once a second, and clears it on blur. The simulation also accepts a bare number per player, which the scenario tests use. Guests run no simulation.

### Snapshot
Declared once as `SNAPSHOT` in `game.js` and encoded by the engine's binary codec (85 bytes at eight players, against a budget of 100 bytes per player), at 30 Hz.

| Field | Type | Meaning |
|---|---|---|
| `n` | uint16 | Steps since the round began, countdown included. The frame order key for guests. |
| `k` | uint16 | Active round ticks; stays at zero during the countdown. |
| `f` | uint8 | Ready countdown ticks remaining. |
| `b` | uint8 | Completed broadcasts. |
| `aim`, `next` | uint16 | Current and next target, in degrees clockwise from twelve o'clock. |
| `over` | bool | The round has ended. |
| `ang` | fixed, tenths of a degree, per player | Antenna angle. Not interpolated, because it wraps at 360. |
| `vel` | fixed, hundredths, per player | Angular velocity in degrees per tick. |
| `pts` | uint8, per player | Points this round. |
| `on` | bool, per player | False once the player has disconnected. |
| `last` | int8, per player | Last broadcast award, -1 before the first broadcast. |
| `q` | uint16, per player | Match totals. |
| `d` | player list | Antennas a broadcast scored on this tick, misses included; the award is in `last`. |

A broadcast occurs every 75 active ticks, ten per round. Target angles change on the tick after a broadcast, so the scoring snapshot shows the window that was scored. Every frame redraws from the snapshot alone.

### Round lifecycle
`startRound()` increments `round`, clears round points, velocity, tick and pulse counters, resets angles to 270°, and gives a 30-tick ready countdown. Totals and disconnected-player flags persist. After ten pulses the round ends and the engine's `over` message carries the unique match winner or -1. The match target is 60; a tie continues into another round. The host advances with Space or the Next round button. Disconnects remove that antenna from scoring and winner eligibility. The simulation draws no randomness, so a replay needs only the input log.

## Local checks

```bash
cd daily-2026-10-05
npm test
```

From the repository root, run the game against the engine in the checkout:

```bash
node scripts/dev.mjs daily-2026-10-05 8765
```

`npm test` runs the three rule scenarios in `test/scenarios.js`, the engine shape check, an exact codec round trip over a whole round, the eight-player snapshot budget, and the replay of the committed fixture `test/replay.ndjson` (four players, three rounds).

## Registration / coordinator handoff

`game-entry.json` supplies the display name and one-sentence description. The coordinator adds slug `daily-2026-10-05`, players `2 to 8`, source `daily-2026-10-05/`, and `url: null` to **root `public/games.json`**, updates the automation catalog, and excludes `/daily-2026-10-05/` in root `.wasmerignore`. No URL is guessed.

**Deployment blocker outside this task's editable paths:** the scaffold's `app.yaml` still names `achtung-webrtc` and contains its copied `app_id` and annotations; `package.json` also retains Achtung metadata. The coordinator must rename the app/package, remove copied identity/annotations, and confirm the owner before deployment. Preserve region `fr-roub1`, module type, start script and sole `ws` dependency. These files were deliberately not edited because they are not allowed paths.

After merge, the coordinator runs from the repository root:

```bash
./deploy.sh daily-2026-10-05 super
```

This must deploy the game, read its actual Wasmer URL into the root catalog, then redeploy the superapp (AGENTS.md §3.8). Verify sane packaging, Node provider detection, health/CORS, WSS, two-tab gameplay and `/?create=1` in production. Commits, pushes and deployment are left to the coordinator. Package preparation was supplied; no credentials were read or deployment commands run.


## Automated check status

The Wasmer job ran JavaScript syntax, Game interface, and simulation scenario checks.
Two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
