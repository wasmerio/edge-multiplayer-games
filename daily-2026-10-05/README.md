# Relay Orbit

A precision broadcast race for 2–8 players (or solo practice). Turn a momentum-driven antenna toward the gold transmission window. Every 2.5 seconds the relay fires: the inner ±8° earns 3 points, the outer ±22° earns 1, and a miss earns 0. Everyone has the same target and starting angle. A dashed marker previews the next target. Release to brake, or countersteer to reverse. Ten broadcasts make a round; a unique leader with at least 60 total points wins at round end. Ties continue into another round.

## Contract — written before implementation

- **Input:** one integer per player, `-1 | 0 | 1`, counterclockwise / brake / clockwise. Guests send `{t:"i", d}` only on change over the existing ordered reliable DataChannel. Host reads `state.localDirs`. Arrow keys or touch buttons control player one; A/D controls the optional second local player. Both directions together brake. Blur releases controls. No client simulation.
- **Snapshot:** `{t:"s", k, f, b, a:[current,next], p:[[angle,velocity,roundPoints,active,lastAward],…], q:[totalScores], d:[[player,award],…], over}` at 30 Hz. Angles are degrees clockwise from twelve o'clock, rounded to tenths; velocity is rounded to hundredths. `f` is the remaining ready countdown, `b` is completed broadcasts, `k` is active round ticks. A broadcast occurs every 75 active ticks, ten per round. `lastAward` is -1 before the first broadcast. `d` is the broadcast event list (including misses), not deaths; it retains the host loop's score-message trigger. The complete arrays suffice to redraw without history; no trails or accumulated guest state. Target angles change on the tick after a broadcast so the scoring snapshot shows the window actually scored. Snapshots aim below 100 bytes/player plus fixed overhead.
- **Round lifecycle:** `startRound()` increments `round`, clears round points, velocity, tick and pulse counters, resets angles to 270°, and gives a 30-tick ready countdown. Totals and disconnected-player flags persist. `round` resets the view and local/remote intent to neutral. `score` repeats totals for the existing host loop. After ten pulses, `over` freezes simulation and `{t:"over", winner}` carries the unique match winner or -1. Host Space / Next round advances; after a match win it starts a fresh match. Disconnects remove that antenna from scoring and winner eligibility. New arrivals wait for a fresh match; reconnect/resume is not supported.

## Architecture / sub-app contract

`src/server.js` is copied verbatim from Achtung. The entire `public/client.js` prefix before `function applyMessage(msg) {` stays byte-for-byte identical. The browser creator alone runs `Game.step()` in a fixed-rate accumulator; all drawing is reached through `applyMessage`. The server only serves static files and relays SDP/ICE. Simulation is headless, deterministic, O(players), and independent of canvas size.

`/?create=1` auto-creates and displays the full invite link plus copy button; `/?room=CODE` auto-joins using the stored/generated name. The header links back to the superapp. `/healthz` returns `{ok,rooms,players}` with wildcard CORS. Existing Achtung storage/debug names remain for prefix compatibility. Keep the host tab visible: browser timer throttling can pause play. STUN-only connections cannot cross every NAT; rooms are per-instance and host authority is trusted.

## Local checks

From this directory:

```bash
node test/run.mjs
node --check public/client.js
PORT=8765 node src/server.js
```

Check `/healthz`, `/`, `/ws` (426), and `/../etc/passwd` (404 using curl `--path-as-is`). Browser checklist: create and join in two tabs, confirm connected/open, start, steer from guest, observe scores, advance with Space, and verify the create/invite/auto-join flow. Touch controls and narrow-screen layout also need browser verification.

### Check notebook

- Contract and reference/catalog review: complete.
- **PASS:** `node test/run.mjs` — interface check plus three exported scenarios: scoring/wraparound, momentum/braking/disconnect, and complete round/tie/reset/snapshot budget. Eight-player snapshots stay below 900 bytes including fixed overhead.
- **PASS:** `node --check public/client.js`, `node --check public/game.js`, and `node --check test/scenarios.js`.
- **PASS:** `/tmp/relay-protected.mjs` compares the entire protected client prefix and `src/server.js` directly with Achtung; both are identical. Required invite/header element IDs are present.
- **PASS (mocked, not browser):** `/tmp/relay-client-check.mjs` executes the client against a mock DOM/canvas: create/invite, two local players, steering, blur release, all round snapshots, next-round button, match restart, and change-only guest intent.
- **BLOCKED / pending:** attempted `PORT=8765 node src/server.js`; the supplied environment has no resolvable `ws` dependency (`ERR_MODULE_NOT_FOUND`). The requested HTTP probes could not run; `curl` is also absent. No dependency files or protected files were changed to work around this. Coordinator must prepare `ws`, start the server, and verify health/CORS, root 200, `/ws` 426, and traversal 404.
- Local two-tab WebRTC, visual/touch checks and automatic invite flow: **pending**.
- Production, deployment and online superapp card: **pending**.

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
