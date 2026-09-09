# Ring Rumble

A 3D arena fighter for 2 to 8 players. Punch opponents off a floating platform. The first player with five round wins wins the match.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD or arrow keys | Direction pad |
| Punch | Hold J | Hold Punch |
| Dash | Press K or Shift | Press Dash |
| Next round or rematch | Host presses Space | Host selects the next-round button |

Punches face the nearest opponent within reach. Each hit adds damage and increases knockback. A dash gives brief immunity, followed by a cooldown.
The platform shrinks after 20 seconds. If several fighters remain after 60 seconds, the round ends with a draw.
A practice button starts a local match against a bot. Room matches use one fighter per browser.

## Input contract

The simulation runs at 30 ticks per second. Each player supplies one integer bitmask:

| Bit | Intent |
|---|---|
| 1 | Left |
| 2 | Right |
| 4 | Up (negative Z) |
| 8 | Down (positive Z) |
| 16 | Punch |
| 32 | Dash |

Guests send `{t:"i", d:mask}` only when the mask changes. The host reads its local mask directly. Diagonal movement has the same speed as straight movement.
Holding Punch repeats attacks at the cooldown rate. Dash requires a new press. Blur and hidden tabs release all controls.

## Snapshot contract

Each snapshot contains `{t:"s", k, r, f, p, e, d, over, win, scores}`.
`k` is the tick, `r` is the platform radius, and `f` is the countdown in ticks.
`e` contains hit pairs `[attacker, victim]`. `d` contains eliminated player indices. `win` is the round winner or `-1`.

Each entry in `p` contains `[x, z, facing, damage, alive, attackTicks, dashTicks, cooldownTicks, stunTicks]`.
Positions and angles use two decimal places. Player data stays below 100 bytes per player per tick.
Every snapshot contains the complete visible state, including scores. Guests need no previous snapshot to draw the arena.
The renderer uses Three.js from the local `public/vendor/` directory. The server has only the `ws` dependency.
Three.js is pinned to version 0.170.0. Its MIT license is in `public/vendor/THREE-LICENSE.txt`.

## Round lifecycle

`lobby` supplies the player table, score target, and initial platform radius.
`round` resets fighters, damage, timers, input edges, and the arena. Scores persist. Each round starts with a two-second countdown.
`over` supplies the round winner and match winner. A draw gives no points. A sole survivor gets one point.
The host presses Space for the next round. After a match winner, Space resets scores and starts a new match.
Late arrivals watch the current match and become fighters in the next match.
Disconnected fighters leave the round and stay excluded until a new match rebuilds the player table.

## Multiplayer model

The unchanged Achtung server serves static files and relays WebSocket signals. The host browser owns all gameplay state.
Guests send intent over one ordered, reliable WebRTC DataChannel each. All browsers draw through the same message handler.
Signaling loss leaves open DataChannels in place. The room registry lives in instance memory in `fr-roub1`.
DataChannel heartbeats detect a lost browser after ten seconds without a reply. Signaling loss alone does not eliminate a fighter.
Only public STUN is configured. Some NAT pairs require an external TURN service to connect.
Combat checks at most eight fighters per attacker. This fixed cap bounds collision and target searches.

## Local checks

```bash
cd ring-rumble
npm ci
npm test
PORT=8765 npm start
```

Open `http://localhost:8765/?create=1`. Copy the invite link into a second tab. Wait for the connection, then select Start fight.
Move and punch in the guest tab. Check the host input through `window.rumble.inputs`. After a round, press Space in the host tab.
The browser test uses Playwright from `PLAYWRIGHT_MODULE` or the local installation.

```bash
node test/browser.mjs http://localhost:8765
node test/signaling.mjs http://localhost:8765
```

The server contract includes `/healthz` with cross-origin access, automatic `?create=1`, automatic `?room=CODE`, and a link to all games.

## Publish

From the repository root:

```bash
./deploy.sh ring-rumble
./deploy.sh super
```

`./deploy.sh` publishes every game directory and then the superapp. No separate target list is necessary.
The script updates `public/games.json` with the actual URL from Wasmer after each game publishes.
The initial Ring Rumble URL in that file is provisional until the first publish.

## Checks completed

Local checks passed on 2026-09-09:

- Eleven Node scenarios cover movement, combat, dash immunity, simultaneous hits, ring-outs, draws, round resets, disconnects, shrinkage, replay, and match scoring.
- Server checks passed for `/healthz`, cross-origin access, `/`, `/ws` (426), and path traversal (404).
- Separate Chromium sessions passed automatic room creation, invite joining, DataChannel connection, guest movement, guest punches, scores, and Space for round advance.
- Late arrivals spectated the current match and joined the next match. Rematches reset scores. Closed browsers left the round.
- After both signaling sockets closed, guest input and snapshots continued. Healthy DataChannels remained connected beyond the heartbeat timeout.
- Mobile checks passed for the practice bot, touch controls, control release, and page width. Browser sessions reported no JavaScript errors.
- Desktop and mobile screenshots passed visual inspection. The signaling server matches the Achtung server byte for byte.
- The publish script passed its Bash syntax check. The root upload filter exposes only `app.yaml` and the two superapp files.

Production checks are pending. The command policy rejected `wasmer whoami`, including an escalated attempt, because Wasmer is outside its cloud-command allowlist.
No remote build, production room check, or superapp publish ran. The registry URL remains provisional until the first successful publish.
