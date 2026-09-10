# Meteor Market

A 2–8 player catch-and-dodge contest (with solo practice). Slide your basket beneath an identical meteor shower in your own market stall. Cyan crystals earn 1 cargo, gold crystals earn 3, and red mines remove 4 cargo and jam movement for 0.4 seconds. Most cargo after 35 seconds wins the round. There are no trails, attacks, or elimination collisions.

## Contract — written before implementation

### Input

At 30 fixed ticks/second the host consumes one integer per player: `-1` left, `0` idle, `1` right. Guests send `{t:"i",d}` only when intent changes on the existing ordered, reliable star DataChannel. Host input is read directly from `state.localDirs`. Left/right arrows control player one; A/D control the optional second host player. On-screen hold buttons control player one. Opposite directions cancel; blur releases input. Input changes are ignored by the simulation during the one-second ready phase.

### Snapshot

Every tick sends `{t:"s",k,f,p,o,q,d,r,over}`:

- `k`: elapsed active ticks (35 seconds = 1050 ticks); `f`: ready ticks remaining.
- `p`: player arrays `[x,cargo,jamTicks,active]`; x uses normalized 0–1000 coordinates.
- `o`: falling-object arrays `[id,x,y,value]`, where value is `1`, `3`, or `-4`. Everyone receives an independent copy of the same shower; catching does not steal from another stall.
- `q`: cumulative match points in player order.
- `d`: tick events `[player,value]` for catches and `[player,0]` for round awards. The preserved host loop uses nonempty `d` to send its `score` message.
- `r`: indices of round leaders, empty before round end.
- `over`: boolean. Positions are rounded integers. A complete snapshot, plus the `lobby` player table and map, redraws the entire scene without trails or earlier snapshots.

Objects cross the basket at y=900 and resolve simultaneously for all players within 85 units horizontally. Objects are then removed. At most seven objects are in flight. Simulation cost is O(players + bounded objects); payload target is below 100 bytes/player plus a small shared shower.

### Round lifecycle

`Game` exposes `constructor`, `startRound`, `step`, `winner`, `round`, `roundOver`, and `scores`. `startRound` increments `round`, clears objects/cargo/jams/results, resets baskets to center and the 35-second clock, and sets a one-second ready countdown; match points and disconnected status persist. The host broadcasts `round` and every peer clears the view. Late joins wait for the next match.

At timeout, the active player(s) with the most positive cargo receive 2 match points for an outright win, or 1 each for a tie. No cargo means no awards. A unique match leader at 5+ points wins; tied match leaders play on. `over` carries the match winner index or `-1`, while the final snapshot carries round leaders and cargo. Host Space (or Next round) starts another round, or a new match after a match winner. Solo practice uses the same positive-cargo award. Disconnects deactivate that basket and exclude it from awards. A match restart rebuilds the connected player table (maximum eight).

## Multiplayer and entry contract

The Achtung WebSocket signaling server and `public/client.js` prefix before `function applyMessage(msg) {` are preserved verbatim. Only the host simulates; all peers draw through `applyMessage`. No server-side gameplay, new dependencies, or transport changes.

- `/?create=1`: auto-create on WebSocket open and show the full invite URL/copy panel.
- `/?room=CODE`: auto-join using the stored/generated name.
- Header retains the superapp link.
- `/healthz`: JSON `{ok,rooms,players}` and CORS `*`.
- The display-size selector changes rendering resolution, not gameplay coordinates or difficulty.

## Local run

Dependencies are already prepared. From this directory:

```sh
node test/run.mjs
node --check public/client.js
PORT=8765 node src/server.js
```

Open `http://localhost:8765/?create=1`, send the invite to another tab, wait for connected/open, and start. Guests use arrows or hold buttons. The host can add a second local basket using A/D.

## Shared notebook / verification

Implemented: headless catch/jam simulation; complete-snapshot canvas stall renderer; keyboard and pointer controls; responsive market page; round/match controls; catalog display metadata. Small screens can horizontally scroll the stall board while the movement buttons remain outside the scroll area.

Actual checks run on 2026-09-10:

- **PASS** `node test/run.mjs`: interface contract plus five distinct exported scenarios — independent shared catches/mine jam, ready/input/bounds/catch edge, timeout/ties/reset/winner, disconnected/empty stalls, and a full eight-player replay. The replay asserts at most seven objects and snapshots under 1000 bytes.
- **PASS** `node --check public/client.js` and `node --check public/game.js`.
- **PASS** byte comparison: client prefix before `applyMessage` and the complete signaling server are identical to the Achtung reference.
- **PASS** static check: every literal client DOM ID exists in the new page.
- **PASS** in-memory Node VM smoke with mocked DOM/canvas/DataChannel: three-player roster (host, local second player, guest), remote intent consumption, snapshot rendering, score award, host next-round button, round advance, match restart, and outgoing `over`. This is not a real browser or WebRTC test.
- **BLOCKED** local server HTTP checks: attempted `PORT=8765 node src/server.js`, but this environment reports `ERR_MODULE_NOT_FOUND` for `ws`; `curl` is also unavailable. No dependencies were installed or files changed outside the allowlist. `/healthz` CORS, `/` 200, `/ws` 426, and traversal 404 remain pending on a prepared server runtime.

Browser checks: **pending** — two tabs, guest movement, DataChannel open, countdown, catches/mines, scores, round advance, match restart, touch controls, narrow viewport, auto-create invite and auto-join.

Production checks: **pending** — deployment, health/WebSocket, production two-tab and entry contract, catalog registration and superapp online card.

Coordinator prerequisite: scaffold `app.yaml` still has the Achtung name, copied `app_id`, and annotations; package metadata is scaffold-owned too. These are outside the editable paths. Coordinator must give the app its own manifest identity and remove copied deployment metadata before deploying. No deployment, credentials, Git configuration, or package preparation is touched here.

Known inherited limits: public STUN only (symmetric NAT may fail); ephemeral, per-instance signaling rooms; host advantage; no reconnect/resume or mid-match join synchronization. Host tab should stay foregrounded.


## Automated check status

The Edge cron job ran JavaScript syntax, Game interface, and simulation scenario checks.
Two-browser gameplay, invite behavior, production deployment, and catalog registration remain pending.
Complete the repository AGENTS.md checklist before calling this game done.
