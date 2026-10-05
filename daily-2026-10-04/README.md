# Switchback Regatta

A host-authoritative boat race for 2–8 players (or solo practice). Steer an automatically moving skiff through six numbered buoy rings, twice, while currents shift and reefs punish careless shortcuts. Boats do not collide with one another. No trails, elimination, or collection lanes.

## Contract — written before implementation

### Input
At 30 ticks/second each player supplies `-1 | 0 | 1`: left rudder, straight, right rudder. Guests send `{t:"i", d}` only when intent changes over the existing ordered reliable DataChannel. Host reads `state.localDirs` directly. Arrow keys or touch buttons control player 1; A/D control optional host-local player 2. Releasing keys, losing focus, or canceling a touch clears intent. Turning reduces thrust; straight sailing restores speed. Positions use normalized course coordinates, independent of canvas dimensions.

### Snapshot
Each tick emits `{t:"s", k, f, left, current:[dx,dy], gates:[[x,y],...], reefs:[[x,y,r],...], p:[[x,y,heading,checkpoint,finishTick,stun,active],...], scores:[...], d:[[player,event],...], over}`. Floats are rounded to four decimals; player tuples remain below 100 bytes/player. `f` is countdown ticks, `left` is race ticks remaining, `checkpoint` is 0–12, `finishTick` is zero until finished, and event codes are 1=checkpoint, 2=collision, 3=finish, 4=round award. Full geometry and scores travel in snapshots so a guest can draw from scratch without accumulating trails or running physics. `d` retains the host-loop event hook, but does not mean deaths here.

### Round lifecycle
`startRound()` increments `round`, preserves match scores and disconnected-player flags, resets positions, headings, checkpoint counters, finish times, collision cooldowns and a two-second countdown. A race lasts at most 60 seconds, shortened to eight seconds remaining after the first finisher. All active boats finishing also ends it. Earliest finish wins; otherwise highest checkpoint count then nearest next ring wins. Exact ties share the award. Winners receive 3 match points; other finishers receive 1. Zero progress awards nothing. Disconnected boats cannot score. Match target is 9; a tied match continues until a unique leader reaches target.

The `round` message resets the display; snapshots contain the countdown. `over` carries the match winner index, or -1 for a race-only result; the final snapshot supplies race awards and progress. Host Space / Next race advances only after the race ends. After a match win, the host can start a new match. Host and guests render exclusively through `applyMessage`. Late joins wait for the next match; no host migration.

## Running and controls

Prepared dependencies are used as-is:

```bash
cd daily-2026-10-04
node test/run.mjs
node --check public/client.js
PORT=8765 node src/server.js
```

Open `http://localhost:8765/?create=1`, share the full invite link, wait for `connected/open`, then start. Pass inside the numbered rings in order; the HUD shows each boat's next ring. Two circuits (12 rings) finish the race. Reefs and shore collisions turn the boat away and slow it briefly. The current arrow shows the drift direction. Match points and race progress are separate.

`/?create=1`, `/?room=CODE`, the invite panel and copy button, the all-games header link, `/healthz` CORS response, signaling server, and the entire client prefix before `applyMessage` are preserved from Achtung. The host owns all simulation; Edge only serves files and signaling. Public STUN does not guarantee symmetric-NAT connectivity. Rooms are ephemeral and instance-local.

## Registration and deployment — coordinator-owned

Metadata is in `game-entry.json`. The coordinator adds it to both catalogs; the root superapp reads **`public/games.json`**, not `automation/daily-game/catalog.json`. The initial root entry must have `url: null`; do not guess a URL. The coordinator also excludes `/daily-2026-10-04/` in root `.wasmerignore`.

After merge, from the repository root:

```bash
./deploy.sh daily-2026-10-04 super
```

This must deploy the game, record its actual URL from Wasmer, and redeploy the superapp (AGENTS.md §3.8). Leave commits, pushes and deployment to the coordinator.

**Deployment blocker outside the permitted edit paths:** the supplied `app.yaml` still names `achtung-webrtc`, includes the copied `app_id` and `annotations`; `package.json` still has Achtung's name/description. Coordinator must set the new app/package identity and intended owner, remove copied app ID/annotations, and retain `fr-roub1`, ESM, start script and sole `ws` dependency before deploying. These protected files are intentionally not edited here. Package preparation is complete; no skills installation or deployment attempted in this restricted worktree.

## Checks notebook

- PASS: `node test/run.mjs` — interface checks and four distinct exported scenarios: ordered rings/countdown; reef and shore recovery; a complete two-lap steering race with scoring/reset; timeout ties/disconnects/full snapshots. Eight-player snapshots stay below 2,000 bytes and player tuples below 100 bytes/player.
- PASS: `node --check public/client.js`, `node --check public/game.js`, and `node --check test/scenarios.js`.
- PASS: `node /tmp/check-regatta.mjs` — signaling server and client prefix before `applyMessage` are byte-for-byte identical to Achtung; referenced DOM IDs exist; static auto-create/auto-join/invite/superapp contracts and metadata are present. This is source verification, not a browser check.
- BLOCKED: attempted `PORT=8765 node src/server.js`; process exits with `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'`. No dependency or protected package files were changed. `curl` is also unavailable in this job. Local `/healthz` JSON/CORS, root 200, `/ws` 426, traversal 404, and WebSocket create/join checks remain pending until the coordinator restores the prepared `ws` dependency (HTTP probes can use Node instead of curl).
- Pending (browser): two-tab create/join, DataChannel open, guest steering, touch, countdown, scoring, Space/Next race, fresh-match restart.
- Pending (browser): fresh `/?create=1` invite panel and invite `/?room=CODE` auto-join.
- Pending (production): manifest correction, deploy packaging/provider logs, health/CORS, WebSocket handshake, two-tab game, sub-app contracts.
- Pending (registration): both catalogs, root upload exclusion, actual URL and superapp redeployment/card online.


## Automated check status

The Wasmer job ran JavaScript syntax, Game interface, and simulation scenario checks.
Two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
