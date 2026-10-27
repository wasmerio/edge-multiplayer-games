# Pipewright

Rotate copper pipe tiles to carry water from the left inlet to the right outlet, racing friends through a shared repair queue. A spatial connection puzzle for 2–8, not a movement, memory, auction or timing game.

## Rules and design

A two-second inspection countdown precedes a 35-second shift. Each player gets the same ordered queue of eight scrambled 3×3 pipe boards. Select a tile, rotate it clockwise, and follow the blue water from the inlet. A continuous connection to the marked outlet automatically earns 4 points and holds the completed board for 24 ticks before the next repair. Unused pipes need not connect. Completing all eight boards finishes your queue, not anyone else's clock. A player starting at least 6 points behind the connected leader earns 5 per repair for the whole shift (the assistance badge). First to 30 with a unique connected lead at shift end wins; ties play another shift. Everyone plays throughout, with no elimination. One-player simulation is supported.

Boards are sampled from eight valid paths, with independent seeded tile rotations and filler pipes; all seats receive identical boards in identical order. A scramble is forced unsolved. A fixed 540×480 canvas shows your large board and eight numbered rival progress indicators, rather than shrinking eight playable boards. Spectators inspect the first connected seat. The scoreboard carries names, queue progress and assistance. Host authority means guest inputs incur network latency; this is a friends game.

## Visual identity

- Palette: pale mint enamel `#d5eee3`, porcelain `#f5fff9`, petrol ink `#133e39`, copper `#a95129`, wet blue `#007fbd`. A hollow outlet becomes a check-marked outlet when connected; player identity uses numbered stations as well as colour.
- Eight player colours: petrol, mulberry, cobalt, ochre, violet, evergreen, brick and slate, readable against porcelain and mint.
- Typeface stacks: heavy system sans headings (`system-ui`, `Segoe UI`, sans-serif), technical monospace labels (`ui-monospace`, Menlo, Consolas, monospace). No external fonts or art.
- Layout: a municipal waterworks service sheet, a large elbow-pipe emblem and plain repair instructions beside an enamel registration panel. Gameplay is board, task line, three 96px touch controls, then compact two-column score ledger on phones.
- Tone: brisk, friendly maintenance-desk copy; the goal and controls always precede flavour.
- Canvas: porcelain tiles with inset screws, thick copper channels with dark bores, blue filled segments, a double bracket on the selected tile, large inlet/outlet arrows, a broad shift gauge. Geometric water droplets on scoring; reduced motion suppresses droplets. No essential information depends on animation.

## Input

`INTENT = { select: -1 | 0 | 1, turn: 0 | 1 }`.

- **select**: Left/A moves to the previous tile, Right/D to the next, row-major with wrap. Direction change moves immediately; holding repeats every 9 ticks. Gamepad axis 0. Separate previous/next touch buttons.
- **turn**: Space/R or gamepad button 0 rotates the selected tile 90° clockwise on the press edge. Its own touch button. Release before rotating again.
- Simultaneous select and turn first selects, then rotates that tile. Missing or numeric-zero intent is neutral. Inputs are read, never mutated. Held state is tracked in countdown and completion holds: a held turn cannot rotate the next board automatically. Enter advances rounds for the host.

## Snapshot

All geometry is derived from the fixed arena, so there are no floating positions or interpolation fields. Every snapshot draws independently of history; packed tiles are decoded with exported helpers.

| Field | Type | Meaning |
|---|---|---|
| k | uint32 | Stream tick, advances on every call including post-round |
| over | bool | Shift ended |
| ready | uint8 | Inspection countdown ticks left |
| left | uint16 | Active shift ticks left |
| board | uint32 per player | Nine 3-bit pipe codes, row-major; 0 NS, 1 EW, 2 NE, 3 ES, 4 SW, 5 WN |
| cursor | uint8 per player | Selected tile 0–8 |
| inlet, outlet | uint8 per player | Source and destination rows 0–2 |
| wet | uint16 per player | Nine-bit mask of connected tiles reached from source |
| done | uint8 per player | Repairs completed this shift, 0–8 |
| pause | uint8 per player | Completed-board display ticks left; latched at 24 on the final completed board |
| award | uint8 per player | Last repair points, displayed during pause |
| active, assist | bool per player | Still connected; earns the catch-up point |
| moved, turned, repaired | players | One-tick selection, rotation and scoring events |
| beep, go, finished | bool | One-tick countdown, shift opens, shift closes events |

Audio and droplets use events through the engine; ongoing completion feedback uses `pause` and `award`. The standard 100 bytes/player/tick budget is unchanged.

## Round lifecycle

`startRound()` increments round, resets tick, ready=60 and left=1050, generates eight shared puzzles using only the injected RNG, clears per-round cursors, completions, pauses, input edges and awards, and computes assistance from connected scores. Scores and disconnected flags persist. Each seat begins puzzle zero. No action is applied during inspection.

`step()` tracks input edges, processes active players in O(players) with at most nine pipe visits each, awards each completion independently (no seat-order first bonus), then drains the shift clock. The last active tick accepts actions. A 24-tick hold advances to the next puzzle without consuming a held rotation. `roundOver` becomes true at tick 1110, or on the next step if everyone disconnected. Post-round steps cannot score or emit events. `winner(target)` excludes disconnected seats, requires the target and a unique lead. `disconnect(index)` preserves array slots but excludes the seat from actions and all later rounds.

## Checks / shared notebook

Completed on 2026-10-27:

- `cd weekly-2026-10-27 && RECORD=1 node test/game.test.mjs`: recorded after the last rule change; all 17 tests passed.
- `cd weekly-2026-10-27 && node test/game.test.mjs`: all 17 tests passed, including exact repair timing, blocked connections, selection repeat/wrap, countdown edges, simultaneous scoring, assistance, last-tick scoring, final repair, disconnects, one-player safety, seed equality, replay and full-shift codec checks for 1–8 players. Fifty seeds produced 400 unsolved but solvable puzzles.
- `node /app/check_game.mjs . weekly-2026-10-27`: passed, engine 1.0.2, schema `f78d4a2e`. Fixture: 3,333 events, three complete 1,110-tick rounds, final scores 96/96/89/79.
- `node scripts/conformance.mjs weekly-2026-10-27 --static`: all 18 rows passed. 22 page roles, three valid touch buttons; full eight-player snapshot 136 B against 800 B. Largest fixture snapshot 88 B / 400 B; mean delta 23.5 B.
- `node /tmp/pipewright-smoke.mjs`: passed. Executed the actual client draw, scoreboard, result label and browser bot for three shifts at 1, 2 and 8 seats, with three-tick-delayed guest snapshots and spectator views. Checked 1,076,920 surface calls for finite coordinates, nonnegative sizes and valid alpha. Every bot repaired pipes, and the two/eight-seat runs reached a unique match leader; peak encoded sizes were 52/64/136 B. Verified the import map byte-for-byte against the resolved scaffold. This mock is not a visual, browser-input or network test.

Browser gameplay, full conformance, soak, desktop/360px screenshots, two/eight-player sessions, late spectators and actual touch use: **pending**, no browser in this job. Phone layout is designed, not visually verified. Production health, two-browser play and phone invites: **pending**. All coordinator-owned scaffold files remain untouched; no deployment was attempted.

Commands from the repository root:

```sh
(cd weekly-2026-10-27 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-27 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-27
node scripts/conformance.mjs weekly-2026-10-27 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-27 --phone --rounds 3 --shots /tmp/pipewright-shots`; also run with `--guests 1`, `--guests 7 --no-late`, and `--no-bot --phone`, then inspect screenshots. The bot follows visible connected pipe ends; no hidden solution is needed.

## Registration and deployment

`game-entry.json` provides name, description and player range. The coordinator adds entries to both catalogs and `/weekly-2026-10-27/` to root `.wasmerignore`. The superapp reads **public/games.json**; its entry remains `url: null` until deployment obtains the actual Wasmer URL.

After merge, the coordinator runs `./deploy.sh weekly-2026-10-27 super` to deploy the game, record its real URL and redeploy the superapp. No deployment, credentials, commits, pushes or pull requests are part of this implementation. Coordinator-owned scaffold files remain untouched.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
