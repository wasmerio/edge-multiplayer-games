# Prism Post

A competitive sorting arcade for 2–8 players (or solo practice): slide a mail cart across three lanes, catch mint parcels, and dodge coral glitch parcels. Every player has a separate bay receiving the same delivery pattern, so positioning—not fighting or trails—decides the winner. Optional second local player uses A/D.

## Contract (design recorded before implementation)

- **Input:** one integer per player, `-1 | 0 | 1` (slide left, stop, slide right), held continuously. Arrow keys or touch buttons control slot 0; A/D controls the host's optional slot 1. Opposing buttons cancel. Guests send `{t:"i", d}` only when intent changes; blur/cancel releases intent. The preserved transport clamps guest values. Host simulates at 30 Hz over ordered reliable star DataChannels.
- **Snapshot:** `{t:"s", k, f, left, p, b, d, over}`. `p` contains `[x, score, active, flash]` per cart; x is normalized and rounded to three decimals, flash is a signed feedback countdown. `b` contains `[id, lane, y, type, resolvedMask]` per parcel, with normalized y rounded to three decimals, type `1` for mint and `-1` for glitch. All bays share these deliveries; mask bits prevent double catches and hide resolved parcels in each bay. `d` is an array of player indices whose score changed, preserving the host loop's score-message trigger (not deaths). `f` is countdown ticks and `left` is remaining active ticks. Every snapshot fully reconstructs the scene without trails or guest simulation; aim below 100 bytes per player plus a small shared parcel list.
- **Round lifecycle:** `startRound()` increments round, resets carts to center, clears parcels/feedback/tick and starts a 45-tick countdown, retaining match scores and disconnected status. Deliveries last 900 ticks (30 seconds). Mint catches earn 1, glitch catches subtract 2, floored at zero. Misses cost nothing. Round completion freezes simulation; `over` carries the unique match winner index if the target (20 points) is reached, otherwise `-1`. Tied leaders play on. Host Space / Next round starts another round; after a match win it starts a fresh match. Solo uses the same target. Departed players remain inactive in later rounds. Late joiners wait for a new match.

## Model and constraints

Signaling server and client prefix before `function applyMessage(msg) {` remain verbatim Achtung. Auto-create, invite link/copy, auto-join, health endpoint and superapp backlink are retained. Only the host owns simulation and random delivery choices. Board presets scale the display, not difficulty. Same-frame catches are independent across bays, with no player-order advantage.

## Checks notebook

- PASS: design contract written before simulation/UI implementation.
- PASS: `node test/run.mjs` (2026-09-11): interface checks plus four exported scenarios—independent catches/glitch penalties, countdown/steering/clamping, timed round lifecycle/ties/disconnects, and eight-player complete snapshots under 800 bytes.
- PASS: `node --check public/client.js` (2026-09-11).
- PASS: `/tmp/check-prism.mjs` protected-file section: server equals Achtung byte-for-byte; client prefix before the required boundary equals Achtung byte-for-byte; all literal DOM IDs exist and the superapp link is retained.
- PASS: `node /tmp/check-prism-client.mjs`: mocked DOM and paired in-memory transport exercise auto-create, invite rendering, auto-join, host/guest snapshot rendering, guest keyboard intent, opposing buttons, change-only sends, touch/cancel, round advance, fresh match reset and disconnect. This is not a real browser or WebRTC check.
- BLOCKED / pending: local HTTP checks. Attempting to import the unchanged server from `/tmp/check-prism.mjs` failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'`; no HTTP assertions ran. Package installation and dependency-path changes were not made because preparation is supplied and those paths are outside the edit allowlist. Coordinator must make `ws` available and rerun `/healthz` (including CORS), `/`, `/ws` (426), raw `/../etc/passwd` (404), and static asset requests.
- Pending: real browser two-tab create/join, DataChannel connected/open and guest input, touch controls, resize, round advance, auto-create invite/copy and auto-join.
- Pending / deployment blocker: supplied protected `app.yaml` still contains Achtung's name, `app_id` and annotations; protected `package.json` still carries Achtung metadata. Coordinator must assign game-specific deployment/package metadata and remove copied deployment IDs/annotations before deploying. These files were deliberately not changed.
- Pending: production deployment, production two-tab/contract checks, root catalog/ignore registration, superapp redeployment and online card (coordinator-owned). `game-entry.json` now provides Prism Post's display name and description.

## Playing and operational notes

Run `node src/server.js` from this directory once the prepared `ws` dependency is available. Open `http://localhost:8080/?create=1` and share the displayed invite. All friends must connect before the host presses Start. The optional local player is disabled when eight network players are connected. Hold arrows or touch buttons to slide; release to stop. A new shift clears held intent, so press again after the countdown. Host Space or the Next round button advances a finished shift; after a win it creates a fresh match.

The immutable transport retains Achtung's `window.achtung` debug state and stored-name key. Public STUN only, no TURN, no reconnect/resume, no host migration; rooms and signaling are instance-local. Late arrivals enter on the next fresh match, not mid-shift. A disconnected bay is inactive for the remainder of its match.

Package preparation is supplied; no runtime installs, deployment, credentials, Git configuration, or protected metadata changes are part of this task.


## Automated check status

The Edge cron job ran JavaScript syntax, Game interface, and simulation scenario checks.
Two-browser gameplay, invite behavior, production deployment, and catalog registration remain pending.
Complete the repository AGENTS.md checklist before calling this game done.
