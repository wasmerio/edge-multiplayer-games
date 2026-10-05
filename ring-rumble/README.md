# Ring Rumble

A 3D arena fighter for 2 to 8 players. Punch opponents off a floating platform. The first player with five round wins wins the match.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD or arrow keys | Arrow buttons |
| Punch | Hold J | Hold Punch |
| Dash | Press K or Shift | Press Dash |
| Next round | Host presses Space | Host selects Next round |

Punches face the nearest opponent within reach. Each hit adds damage and increases knockback. A dash gives brief immunity, followed by a cooldown.
The platform shrinks after 20 seconds. If several fighters remain after 60 seconds, the round ends with a draw.
Room matches use one fighter per browser.

## Input contract

The simulation runs at 30 ticks per second. The game declares one intent with four fields in `public/game.js` (`INTENT`, `BINDINGS`):

| Field | Values | Keyboard | Gamepad | Touch |
|---|---|---|---|---|
| `x` | -1, 0, 1 | A / D or left / right | axis 0 | ← → |
| `z` | -1, 0, 1 (negative is up) | W / S or up / down | axis 1 | ↑ ↓ |
| `punch` | 0, 1 | J | button 0 | Punch |
| `dash` | 0, 1 | K or Shift | button 1 | Dash |

The engine input source sends the intent only when it changes, resends it at its resend interval, and releases all fields on blur.
`maskOf()` folds an intent into the bitmask the simulation steps on: left 1, right 2, up 4, down 8, punch 16, dash 32.
A bare bitmask is also a valid input; the scenarios and the replay fixture use that compact form.
Opposite directions cancel. Diagonal movement has the same speed as straight movement.
Holding Punch repeats attacks at the cooldown rate. Dash requires a new press.

## Snapshot contract

`SNAPSHOT` in `public/game.js` declares the schema; the engine derives the binary codec and the delta encoding from it.

| Field | Type | Meaning |
|---|---|---|
| `n` | uint16 | Steps since the round started, countdown included. This is the stream's tick field. |
| `k` | uint16 | Game tick. It stays at 0 during the countdown. |
| `f` | uint8 | Countdown ticks that remain |
| `r` | fixed16, 2 decimals | Platform radius |
| `over` | bool | The round has ended |
| `win` | int8 | Round winner, or -1 |
| `x`, `z`, `a` | fixed16, 2 decimals, per player | Position and facing |
| `dmg` | uint8, per player | Damage percent |
| `alive` | bool, per player | Still in the ring |
| `atk`, `dash`, `cd`, `stun` | uint8, per player | Attack, dash, dash cooldown and stun ticks |
| `hit` | uint8, per player | Bitmask of the fighters this fighter struck in this tick. `hitPairs()` expands it to `[attacker, victim]` pairs. |
| `d` | players | Fighters eliminated in this tick |

A full snapshot is 115 bytes at eight players, 14.4 per player against a budget of 100.
Guests interpolate `x`, `z` and `r`. Facing is not interpolated because an angle wraps.
Scores travel in the engine's `score` and `over` messages, not in the snapshot.
The renderer stays in `public/renderer.js` and uses Three.js 0.170.0 from `public/vendor/` (MIT license in `THREE-LICENSE.txt`).
`client.js` mounts it into the engine arena with the `mount` option of `startGame`. A guest draws the interpolated sample; the host draws its own state.

## Round lifecycle

`lobby` supplies the player table, the score target of five, and `opts.arena.radius`.
`round` resets fighters, damage, timers, input edges, and the arena. Scores persist. Each round starts with a two-second countdown.
The engine sends `over` with the match winner. The round winner is `win` in the last snapshot. A draw gives no points. A sole survivor gets one point.
The host presses Space or selects Next round to continue.
A fighter whose signaling connection closes leaves the round and stays out until the match ends.

## Multiplayer model

`src/server.js` calls the engine server. `node scripts/sync-engine.mjs game ring-rumble` copies the engine's Node modules into `engine/` before a deploy; git ignores that copy.
The lobby, invite panel, scoreboard, WebRTC star and fixed-tick loop come from the engine at the pinned import in `public/index.html`.
The host browser owns all gameplay state. Guests send intent over one ordered, reliable DataChannel each.
Only public STUN is configured. Some NAT pairs require an external TURN service to connect.
Combat checks at most eight fighters per attacker. This fixed cap bounds collision and target searches.

Differences from the pre-engine version, all engine limits at version 1.0.0:

- No practice bot. The engine seats only connected browsers, and a match needs two.
- A late arrival does not receive the running match. The host sends the lobby only when the match starts.
- A finished match does not restart. Reload and create a new room for a rematch.

## Local checks

```bash
cd ring-rumble
npm ci
npm test
```

`npm test` runs the simulation scenarios, the engine shape check, the snapshot budget at eight players, and the replay of `test/replay.ndjson`.
The fixture holds four rounds of a four-player bot match recorded with the engine's `record()`.

For the browser check, start the game against the engine in this checkout from the repository root:

```bash
node scripts/dev.mjs ring-rumble 8801
```

Then, in a second shell:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node ring-rumble/test/browser.mjs http://localhost:8801
```

The browser check opens `/?create=1`, joins through the invite link, starts a match, and drives a punch, a ring-out and a round advance.
`window.rumble` is the object `startGame` returns. `window.rumble.state.sim` is the host simulation.

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

Local checks passed on 2026-10-05 after the move to the engine:

- Eighteen Node tests: the eleven original scenarios, the engine shape, intent and binding equivalence, the budget, the codec round trip, the fixture replay, and seed determinism.
- Two headless Chromium sessions: automatic room creation, invite joining, DataChannel connection, the 3D scene on both sides, guest movement and punches, scores, the winner banner, and Space for round advance.
- No page errors and no console errors.

Production checks are pending. Nothing was deployed.
