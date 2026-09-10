# Vault Tempo

A 2–8 player push-your-luck drilling race (solo practice also works). Drill a volatile vault, cool your tool, and bank your haul before it melts. Everyone shares the same rich-vein timing, but chooses their own risk. No falling objects, trails, or combat.

## Contract — written before implementation

- **Input:** one integer per player: `-1` bank, `0` cool, `1` drill. Hold Left/Right; A/D controls the optional second host player. Opposite buttons cancel. Touch buttons control player one. Guests send `{t:"i",d}` only on change; the host samples its local intent. Blur/hidden page releases input.
- **Snapshot:** 30 Hz `{t:"s",k,v,p,d,over}`. `k` is elapsed round ticks; `v` is `[rich, ticksUntilVeinChange]`; `p` contains `[heat,haul,bankProgress,lockTicks,mode,active,score]` per player, all integers. `d` is an event array of `[player,type,amount]` (1 bank, 2 meltdown, 3 closing loss). `over` is boolean. Player arrays fit well below 100 bytes each. Every frame redraws from the snapshot plus the lobby player table; no historical canvas or guest simulation is required. `score` messages retain the reference loop shape, and snapshots also carry scores.
- **Round lifecycle:** `lobby` supplies players, target 60, and canvas dimensions. `round` resets heat, unbanked haul, drilling/banking progress, lockouts and tick clock, preserving banked scores and disconnected status. Each shift lasts 900 ticks / 30 seconds. Every 180 ticks, the last 60 are rich: triple ore but double heating. Drill grants ore every 10 drilling ticks; interrupted drilling resets fractional progress. At 90 heat, lose all haul and lock out for 45 ticks. Cooling removes 2 heat/tick; banking removes 1 and requires 24 uninterrupted ticks to deposit all haul. Closing destroys unbanked ore (a bank completing on the last tick counts). `over` carries the unique match leader at or above 60, otherwise -1. Ties continue another shift. Host Space or Next shift advances; after a match it starts a fresh match with scores reset.

## Architecture and controls

Achtung's static/signaling server and client prefix before `applyMessage` remain byte-for-byte unchanged. One host simulates, ordered reliable star DataChannels carry intent and snapshots, and all peers render via `applyMessage`. Work per tick is O(players). Departed players forfeit their haul and stay inactive; a closed guest channel is also detected by the host loop. Late arrivals wait for a new match. No reconnect/resume or host migration. Keep the host tab visible; background scheduling is capped rather than rapidly replaying a whole hidden shift. STUN-only networking may fail across symmetric NAT; signaling rooms are instance-local and ephemeral.

`/?create=1` automatically creates and displays a full invite link, `/?room=CODE` automatically joins, and the header links to the superapp. `/healthz` remains cross-origin readable. Reload to leave a match or create another room.

## Local checks / shared notebook

Installed runtimes are used without package installation; the supplied game directory does not resolve `ws` in this environment (see blocked server check below).

```sh
cd daily-2026-09-09
node test/run.mjs
node --check public/client.js
PORT=8765 node src/server.js
```

- **PASS:** `node test/run.mjs` — interface smoke test plus four exported scenarios: interrupted/completed banking; exact meltdown and rich-vein recovery; closing, ties, score persistence and departure; deterministic 900-tick eight-player replay. Eight-player snapshots stay below 800 bytes total.
- **PASS:** `node --check public/client.js`, plus syntax checks for `public/game.js` and `test/scenarios.js`.
- **PASS:** `/tmp/vault-static-check.mjs` compares the protected client prefix and full server directly against Achtung; checks unique/present DOM IDs, retained auto-create/auto-join/invite/superapp source contracts, and hidden-panel CSS. These are source checks, not browser verification.
- **BLOCKED / pending:** attempted `PORT=8765 node src/server.js` exits with `ERR_MODULE_NOT_FOUND: ws`. No dependency or protected file was changed. `curl` is also absent; the fallback `/tmp/vault-check.mjs` HTTP probe fails with local socket `EPERM`. Thus `/healthz` CORS, root 200, `/ws` 426, traversal 404 and live signaling remain unverified. Coordinator must provide the prepared ws dependency and a network-capable runtime, then rerun.
- Local browser: **pending** — two tabs, DataChannel open, guest drill/bank, local player two, touch release, next shift / new match, auto-create invite and auto-join.
- Production browser, health, WebSocket, packaging/provider checks: **pending** (coordinator).

## Registration and deployment handoff

`game-entry.json` supplies display metadata. The coordinator registers the slug `daily-2026-09-09`, players `2 to 8`, source `daily-2026-09-09/` in both catalogs, adds `/daily-2026-09-09/` to the root `.wasmerignore`, and uses `url: null` in **public/games.json** until deployment. The root superapp does not read the automation catalog.

After merge, from the repository root:

```sh
./deploy.sh daily-2026-09-09 super
```

This must read the actual Wasmer URL, update the root catalog, and redeploy the superapp (AGENTS.md §3.8). Do not guess a URL. Commits, pushes, deployment and credentials are left to the coordinator.

**Deployment blocker outside editable paths:** the supplied `app.yaml` still has Achtung's name, app_id and annotations, and `package.json` still has Achtung metadata. The coordinator must rename the app/package, remove copied app_id and annotations, confirm owner, and preserve fr-roub1 / Node start / ws-only dependency before deploying. These files are not permitted edits for this task. Skills/package preparation is supplied; no Wasmer invocation was made.


## Automated check status

The Wasmer job ran JavaScript syntax, Game interface, and simulation scenario checks.
Two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
