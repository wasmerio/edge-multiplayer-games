# Counterstrike: Breach

A first-person 3D tactical shooter for 2–8 friends. This original browser game takes inspiration from Counter-Strike.
The host browser runs the simulation. Wasmer Edge serves the files and connects peers through WebSocket signaling.

## Game contract

**Input:** `[buttons, yaw, pitch]`. Movement bits are strafe left 1, strafe right 2, forward 4, and backward 8. Action bits are fire 16, reload 32, and interact 64.
Yaw and pitch use degrees. Pitch ranges from -75 to 75. Guests send `{t:"i", i:[buttons,yaw,pitch]}` only on change.
Movement follows the aim direction. The host checks each input and runs 30 ticks per second.
Shots use three-dimensional ray intersections against walls and player bodies. Headshots cause double damage. Armor absorbs 30 percent of body damage.

**Purchases:** Guests send `{t:"buy", item}` over the ordered DataChannel. The host determines the buyer from the connection.
The host checks the item, balance, team, life state, spawn area, and buy timer before each purchase.
A `{t:"purchase", ok, reason}` reply explains the result. The next snapshot carries the balance and equipment.

**Snapshot:** `{t:"s", k, p, b, e, d, over, left, freeze, scores, result}`.
Each player array contains `[x,y,yaw,hp,ammo,reloadTicks,actionTicks,kills,weapon,money,armor,kit,pitch]`.
Coordinates have one decimal place. Team assignment is `playerIndex % 2`: attackers 0, defenders 1.
The bomb array contains `[state,carrier,x,y,ticks,site]`: state 0 is carried or dropped, 1 is planted, 2 is defused, 3 is exploded.
Each shot event contains `[shooter,x1,y1,x2,y2,hitPlayer,z2]`. Shots start at eye height 60. `d` lists player deaths.
Snapshots contain all dynamic state. The lobby carries the player table and map dimensions.
Player arrays stay below 100 bytes per player. Shot events add traffic only during gunfire.

**Round lifecycle:** Each round starts with a 15-second buy period. Combat and movement stop during this period.
Players start the match with $800 and a pistol. Survivors keep weapons, armor, and kits. Dead players receive a pistol next round.
Health and ammunition reset each round. Wins pay $3,250. Losses pay $1,900. Kills, plants, and defuses each pay $300.
Each weapon purchase replaces the equipped weapon. The balance limit is $16,000. The buy menu offers a pistol, SMG, rifle, sniper rifle, armor, and a defender-only defuse kit.

Rounds have a 90-second time limit. Planting takes 3 seconds. Defusing takes 5 seconds, or 2.5 seconds with a kit.
The bomb explodes after 35 seconds. Defenders win on timeout before planting. After planting, surviving defenders must defuse.
Elimination ends a round unless all attackers die after planting. Friendly fire is disabled. There are no respawns during a round.
`over` carries the winning team, reason, and match winner. The first team to five rounds wins.
The host presses Space or the next-round button to continue. After a match, this action starts a new match with connected players.
Late arrivals spectate until the next match. Disconnected players stay eliminated for the rest of the match.

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
| Advance round or start rematch | Space, host only |

Movement interrupts planting and defusing. Cover blocks movement and bullets. Dead players watch a surviving teammate.
The game needs WebGL, a keyboard, and a mouse. Three.js is bundled locally with its MIT license.

## Run locally

```bash
cd counterstrike
npm ci
npm test
PORT=8765 npm start
```

Open `http://localhost:8765/?create=1`. Send the invite link to another player.
After the connection opens, press **Start match** on the host.

For the browser check, install Playwright outside the game directory. Run:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/browser.mjs http://localhost:8765
```

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
The signaling server remains identical to Achtung. Game simulation has no DOM, network calls, or timers.

## Test results

Local checks passed on 2026-09-16:

- Thirteen simulation scenarios cover 3D aiming, headshots, movement, cover, all weapons, armor, purchases, rewards, equipment persistence, and bomb objectives.
- Chromium peers connected through WebRTC and showed the first-person scene with a perspective camera.
- Mouse capture, horizontal and vertical aim, movement, sights, and mouse release passed.
- Host and guest purchases updated equipment and money. The host rejected insufficient funds and ignored a forged buyer identifier.
- Guest shots, elimination rewards, round advance, planting, kit defusing, spectating, rematches, and disconnects passed.
- The narrow buy menu and lobby had no horizontal overflow. Browser checks reported no JavaScript errors.
- Server health, CORS, static pages, bundled Three.js, upgrade responses, and path traversal checks passed.

The app runs at https://counterstrike-breach.wasmer.app and the root catalog lists it.
Edge serves the files from the last deployment. Redeploy after each change to `public/` or `src/`.
