# Counterstrike: Breach

A first-person 3D tactical shooter for 2–8 friends. This original browser game takes inspiration from Counter-Strike.
The host browser runs the simulation. Wasmer Edge serves the files and connects peers through WebSocket signaling.

## Game contract

### Input

the game declares one intent in `public/game.js` (`INTENT`, `BINDINGS`).

| Field | Values | Source |
|---|---|---|
| `strafe` | -1, 0, 1 | A / D or left / right, gamepad axis 0 |
| `forward` | -1, 0, 1 | W / S or up / down |
| `fire` | 0, 1 | Left mouse button while the mouse is captured |
| `reload` | 0, 1 | R |
| `use` | 0, 1 | E, to plant or defuse |
| `aim` | 0 to 360 degrees | Mouse, horizontal |
| `pitch` | -75 to 75 degrees | Mouse, vertical |

The engine input source owns the keys and sends the intent only on change. The client feeds the three mouse fields through `ctx.intent()`.
Mouse look is coalesced to one update per tick; a button change is sent at once.
`inputOf()` folds an intent into `[buttons, yaw, pitch]`, which the simulation steps on. Movement bits are strafe left 1, strafe right 2, forward 4, and backward 8. Action bits are fire 16, reload 32, and interact 64.
The array form is also a valid input; the scenarios and the replay fixture use it. A seat with no input keeps its spawn facing.
Movement follows the aim direction. The host checks each input and runs 30 ticks per second.
Shots use three-dimensional ray intersections against walls and player bodies. Headshots cause double damage. Armor absorbs 30 percent of body damage.
Aim down sights is local to the browser and is not part of the intent. There are no touch controls: the game needs a keyboard and a mouse.

### Purchases

a purchase is an engine command, not intent. The client calls `ctx.command({t:"buy", item})`.
The engine delivers it to `onCommand` on the host with the seat taken from the connection, so a guest cannot buy for another player.
The host checks the item, balance, team, life state, spawn area, and buy timer. Only the buyer receives the `{t:"purchase", ok, reason}` reply.
The next snapshot carries the balance and equipment.

### Snapshot

`SNAPSHOT` in `public/game.js` declares the schema; the engine derives the binary codec and the delta encoding from it.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint16 | Tick of the round. It also advances during the buy period. |
| `over` | bool | The round has ended |
| `left`, `freeze` | uint16 | Round ticks and buy-period ticks that remain |
| `rt`, `rr` | int8, uint8 | Winning team or -1, and an index into `REASONS` |
| `bm`, `bc`, `bx`, `by`, `bt`, `bs` | mixed | Bomb state (0 carried or dropped, 1 planted, 2 defused, 3 exploded), carrier, position, fuse ticks, site |
| `x`, `y`, `a`, `pitch` | fixed16, 1 decimal, per player | Position, yaw and pitch |
| `hp`, `ammo`, `rl`, `act`, `kills`, `w`, `armor` | uint8, per player | Health, magazine, reload ticks, plant or defuse ticks, kills, weapon, armor |
| `money` | uint16, per player | Balance |
| `kit` | bool, per player | Defuse kit |
| `shot`, `sx`, `sy`, `sz`, `sh` | per player | This player fired in this tick; the impact point; the player hit or -1 |
| `d` | players | Players who died in this tick |

Team assignment is `playerIndex % 2`: attackers 0, defenders 1. A shot starts at its shooter's position at eye height 60.
A full snapshot is 221 bytes at eight players, 27.6 per player against a budget of 100.
Guests interpolate `x`, `y`, `bx` and `by`. Yaw is not interpolated because an angle wraps.
The renderer in `public/renderer.js` draws other players from the interpolated sample and the local player from the newest snapshot, so the camera does not trail the interpolation delay.
Tracers, recoil and hit markers come from the per-snapshot hook, so no shot is skipped or drawn twice.
Team scores travel in the engine's `score` and `over` messages. `sim.scores` holds two entries, one per team, and the `scoreboard` option shows them as two rows.

### Round lifecycle

Each round starts with a 15-second buy period. Combat and movement stop during this period.
Players start the match with $800 and a pistol. Survivors keep weapons, armor, and kits. Dead players receive a pistol next round.
Health and ammunition reset each round. Wins pay $3,250. Losses pay $1,900. Kills, plants, and defuses each pay $300.
Each weapon purchase replaces the equipped weapon. The balance limit is $16,000. The buy menu offers a pistol, SMG, rifle, sniper rifle, armor, and a defender-only defuse kit.

Rounds have a 90-second time limit. Planting takes 3 seconds. Defusing takes 5 seconds, or 2.5 seconds with a kit.
The bomb explodes after 35 seconds. Defenders win on timeout before planting. After planting, surviving defenders must defuse.
Elimination ends a round unless all attackers die after planting. Friendly fire is disabled. There are no respawns during a round.
The engine sends `over` with the match winner. The last snapshot carries the winning team and the reason. The first team to five rounds wins.
The host presses Space or selects Next round to continue.
A player whose signaling connection closes stays eliminated for the rest of the match.

Differences from the pre-engine version, all engine limits at version 1.0.0:

- A late arrival does not receive the running match. The host sends the lobby only when the match starts.
- A finished match does not restart. Reload and create a new room for a rematch.
- Movement keys act without mouse capture. The engine input source owns the keys.

## Controls

| Action | Control |
|---|---|
| Move and strafe | WASD or arrow keys |
| Enter mouse look | Click the 3D view |
| Aim | Mouse, horizontal and vertical |
| Fire | Hold left mouse button |
| Aim down sights | Hold right mouse button |
| Reload | R |
| Buy menu | B during the buy period |
| Plant or defuse | Hold E near the site or bomb |
| Release mouse | Escape |
| Advance round | Space or Next round, host only |

Movement interrupts planting and defusing. Cover blocks movement and bullets. Dead players watch a surviving teammate.
The game needs WebGL, a keyboard, and a mouse. Three.js is bundled locally with its MIT license.

## Run locally

```bash
cd counterstrike
npm ci
npm test
```

`npm test` runs the simulation scenarios, the engine shape check, the snapshot budget at eight players, and the replay of `test/replay.ndjson`.
The fixture holds three rounds of a scripted four-player match recorded with the engine's `record()`.

For the browser check, start the game against the engine in this checkout from the repository root:

```bash
node scripts/dev.mjs counterstrike 8802
```

Then, in a second shell:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node counterstrike/test/browser.mjs http://localhost:8802
```

Open `http://localhost:8802/?create=1` to play by hand. Send the invite link to another player, then select **Start** on the host.
`window.breach` is the object `startGame` returns. `window.breach.state.sim` is the host simulation.

## Deployment

From the repository root, run:

```bash
wasmer whoami
./deploy.sh counterstrike super
```

`game-entry.json` supplies the catalog metadata. The deployment script reads the URL from Wasmer and updates the root catalog.
`/?create=1` creates a room and shows its invite link. `/?room=CODE` joins that room.
`/healthz` returns `{ok,rooms,players}` with cross-origin access. The header links to the superapp.

Only the host owns game state. Each guest has one ordered, reliable WebRTC DataChannel to the host.
The room registry stays in one Edge instance. Public STUN supports direct connections, but some NAT pairs need an external TURN service.
`src/server.js` calls the engine server. `node scripts/sync-engine.mjs game counterstrike` copies the engine's Node modules into `engine/` before a deploy; git ignores that copy.
The lobby, invite panel, scoreboard, WebRTC star and fixed-tick loop come from the engine at the pinned import in `public/index.html`.
Game simulation has no DOM, network calls, or timers.

## Test results

Local checks passed on 2026-10-05 after the move to the engine:

- Twenty Node tests: the thirteen original scenarios, the engine shape, intent and binding equivalence, the budget and codec round trip under fire, shot and result encoding, the fixture replay, and seed determinism.
- Two headless Chromium sessions: automatic room creation, invite joining, DataChannel connection, the first-person scene on both sides, host and guest purchases, mouse capture and look, movement, sights, overlapping mouse buttons, elimination, rewards, round advance, planting, and kit defusing.
- No page errors and no console errors. The narrow lobby had no horizontal overflow.

`test/browser.mjs` replaces the earlier browser script and covers the checks of the removed `mouse-buttons.mjs`. The draw-call and input-rate measurements of `performance.mjs` were removed with it.
Nothing was deployed after the move. https://counterstrike-breach.wasmer.app still serves the previous build until the next deployment.
