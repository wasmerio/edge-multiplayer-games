# Pocket Curl

Aim a stone, hold to set its weight, then release onto a shared ice sheet. Draw close to the button or knock a rival away before the end is scored. A turn-based tabletop precision sport for 2–8 friends, not an arena fighter, movement race, auction or rhythm game.

## Rules and design

Each player delivers one stone per end (round). Left/right adjusts the launch angle; hold Space to charge and release to slide. A dotted guide and hollow landing marker show the unobstructed shot. Later players can knock earlier stones away. This is arcade curling: only one stone moves at once; a collision stops the striker and transfers 90% of its forward impact speed to the struck stone, allowing chains. Glancing hits lose energy. Ice edges remove stones, not bounce them.

At the end, stone centres within 30/60/100 units of the button score 3/2/1. The nearest eligible stone earns another 2; equal distances rounded to tenths share that bonus. Nothing scores until all deliveries settle, so a later hit can change everything. A unique connected leader with at least 12 match points wins. Leaders deliver first, giving trailing players the last shot; ties use a seeded circular seat order. The target moves slightly each end, using only the injected RNG.

There is a 45-tick opening countdown, then at most 105 aiming ticks, 90 sliding ticks and 15 settling ticks per delivery. Eight players finish in at most 57.5 seconds; two usually finish in about 10 seconds. This deliberately trades the usual 20-second lower bound for quick rematches at small counts. Nobody is eliminated from the match. Waiting players may pre-aim and watch the changing provisional scores. A missed shot does not remove a seat from later ends. Host latency does not create a first-to-click race; release before the shot clock expires.

## Visual identity

- Palette: electric club cobalt `#1646cf`, midnight navy `#10264b`, glacier ice `#eaf6ff`, pale blue `#b7d5ec`, and lime-yellow `#e6f56b`. Coral `#e54d57` marks the out-of-bounds rail, not player identity.
- Eight stone handles: cobalt, teal, violet, ochre, raspberry, cyan, slate and olive. Numbered stones and a double outline identify the local player without relying on hue.
- Type: bold italic system sans headings (`Arial`, `Helvetica Neue`, sans-serif); system sans body; `ui-monospace`, Menlo, Consolas, monospace for rink labels and scores.
- Layout: a sports-club membership sheet, with a large circular target emblem and oblique cobalt title band. In play, the rink and three broad touch keys lead; a compact scorecard follows on phones. Crisp thin rules, pill-ended meters, no dark arcade panels or paper tiles.
- Copy tone: friendly rink coach, direct and brief. “Hold for weight. Release to deliver.” Instructions always precede flavour.
- Canvas: overhead ice, concentric house rings, red boundary rail, numbered granite stones with coloured handles, dotted shot guide and hollow predicted landing marker. The target dominates the right half. A large horizontal weight gauge and shot-clock bar communicate timing without tiny text. Event-driven ice flecks and impact rings are cosmetic; reduced-motion preference suppresses flecks.

## Input

`INTENT = { aim: -1 | 0 | 1, slide: 0 | 1 }`.

| Field | Keyboard / gamepad | Touch | Meaning |
|---|---|---|---|
| `aim` | Left/A, Right/D; axis 0 | Separate −1 / +1 buttons | Rotate launch angle 0.8 degrees per tick, limited to ±55 degrees; can pre-aim before your turn |
| `slide` | Space; button 0 | Hold/release button | Fresh press during your aiming turn starts charge; hold up to 60 ticks, release to launch |

Charge holds at its maximum. The shot clock auto-releases a charging stone, or skips an untouched one. Held buttons are tracked through every phase; holding before a turn cannot accidentally deliver. Missing fields or numeric-zero intents are neutral. No input is mutated. Enter advances the host to the next end, not Space.

## Snapshot

Every field is declared in `SNAPSHOT`; positions are rounded to 0.1 units, angles to 0.1 degree. Only `x`, `y` and `angle` interpolate. One snapshot reconstructs the entire rink; scores also travel through the engine's scoreboard messages. Fixed arena: 640 × 480, sized through `opts.arena` in the simulation.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, increases on every step including after over |
| `over` | bool | End complete |
| `phase` | uint8 | 0 ready, 1 aim, 2 slide, 3 rest, 4 done |
| `t`, `tMax` | uint8 | Remaining phase ticks and phase length |
| `turn`, `moving` | int8 | Delivering seat and currently moving stone, or −1 |
| `charge` | uint8 | Weight, 0…60 ticks |
| `charging` | bool | A fresh hold has armed the current delivery |
| `tx`, `ty` | fixed16, scale 10 | Target centre |
| `x`, `y`, `angle` | fixed16, scale 10, per player | Stone position and launch angle |
| `state` | uint8 per player | 0 undelivered, 1 on ice, 2 out, 3 missed |
| `active` | bool per player | Seat remains connected |
| `rank` | uint8 per player | Delivery order, 0 first; 255 disconnected |
| `award` | uint8 per player | Final award, zero before settlement |
| `aimed`, `wound`, `sent`, `hit`, `out`, `missed`, `scored` | player lists | One-tick events: began aiming, began charging, launched, struck, left ice, missed clock, earned end points |
| `beep`, `opened`, `finished` | bool | One-tick countdown beat, new delivery, end scored |

`ctx.events` and `audioMap` consume the event fields. Phase, charge, stone state and final awards carry lasting feedback. The codec's default 100 bytes/player/tick budget is unchanged. Only one moving stone means collision detection is O(players), not all-pairs physics.

## Round lifecycle

`startRound()` increments round, resets tick, phase, stone states, positions, angles, charge, awards and held controls. Scores and disconnected flags persist. It draws the target and tied delivery order from the injected RNG, sorts connected players by descending score (ties follow the circular seeded order), and opens the countdown. Each turn starts its stone at the common launch mark; the other stones remain on the ice.

A released stone uses speed `4 + 0.16 × charge`, then loses 0.12 speed each tick. Movement precedes friction. Contact can transfer the moving role to a stationary stone; transferred speed is 90% of the velocity component toward that stone. At speed below 0.12, on leaving the ice, or after 90 sliding ticks, motion ends. A 15-tick rest lets everyone read the new positions. After the last rest, awards are computed exactly once and `roundOver` becomes true. Post-round steps only advance the tick. `winner(target)` excludes disconnected seats and requires a unique lead at target.

`disconnect(index)` removes that stone from play and scoring without resizing arrays. Future turns skip it; if its stone was moving, motion stops. Gone seats do not return in later rounds. If everyone leaves, the next step ends the round without awards. One-player simulations are safe even though the lobby requires two.

## Checks / shared notebook

Completed in this job on 2026-10-20:

- `cd weekly-2026-10-20 && RECORD=1 node test/game.test.mjs`: recorded the fixture after the final simulation change; all 18 tests passed.
- `cd weekly-2026-10-20 && node test/game.test.mjs`: all 18 tests passed. Exact scenarios cover countdown ticks, press/release charge, held inputs across turns, timeout, impact transfer, ice edges, scoring once, shared bonuses, delivery ordering and disconnects. Complete rounds at every player count 1–8 round-trip through the codec within budget; frozen/zero inputs, seed equality and replay are covered.
- `node /app/check_game.mjs . weekly-2026-10-20`: passed on engine 1.0.2, schema `35e2dc34`. Fixture: 1,691 records, four players, three complete ends; final tick 533, scores 9/12/5/7.
- `node scripts/conformance.mjs weekly-2026-10-20 --static`: all 18 rows passed. 22 distinct roles, three valid touch buttons. Full eight-player snapshot 155 B against 800 B; largest reference snapshot 119 B / 400 B, mean delta 19.4 B.
- `node /tmp/pocket-curl-check.mjs`: supplemental non-browser smoke test passed. The actual client draw, scorecard, end label and bots ran for three ends with 1, 2 and 8 seats, including bots reading three-tick-delayed guest snapshots and spectator rendering. All 33 deliveries launched, stones collided and scores were awarded. 326,602 surface calls passed finite/range checks. Peak encoded sizes: 92/101/155 B. The retained import map matches the supplied scaffold byte for byte. This mock is not a visual or transport test.

Browser gameplay, screenshots at 360 px, full conformance, soak, two/eight-player sessions, late spectators and production verification are **pending** because this job has no browser. Phone usability is designed but not visually verified. No deployment, commit or credential access was attempted. The engine owns hosting, lobby, invites, transport, interpolation and round advance.

From the repository root:

```sh
(cd weekly-2026-10-20 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-20 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-20
node scripts/conformance.mjs weekly-2026-10-20 --static
```

Browser reviewer: `node scripts/play.mjs weekly-2026-10-20 --phone --rounds 3 --seconds 180 --shots /tmp/pocket-curl-shots`; repeat with `--guests 1`, `--guests 7 --no-late` and actual touch input with `--no-bot --phone`. Inspect desktop, phone, late-round, result and spectator screenshots.

## Registration and deployment

`game-entry.json` supplies name, description and player range. The coordinator registers both catalogs; the superapp reads root **public/games.json**. Keep its URL `null` until deployment obtains the real URL from Wasmer. The coordinator adds `/weekly-2026-10-20/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-20 super
```

This deploys the game, records its actual Wasmer URL and redeploys the superapp. Commits, pushes, pull requests and deployment are left to the coordinator. Protected scaffold files are not edited.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
