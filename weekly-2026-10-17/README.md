# Canal Works

Rotate pipe tiles to carry water from IN to OUT before your friends do. A spatial plumbing puzzle race for 2–8 players, with separate boards receiving the same scrambled plan. Unlike the other games, this is about tracing connected geometry, not memory, movement, auctions or reflex timing.

## Rules

Three work orders make a 49.5-second round: a 45-tick briefing, then 450 ticks (15 seconds) to solve each 3×3 plan and 30 ticks to inspect each result. Connect the west edge of the middle-left tile to the east edge of the middle-right tile. Pipes have two openings; a joint carries water only when both ends meet. Blue pipes and white water dots show the connected part. Unused pipes are decoys; you need not use every tile.

Left/right select tiles in reading order, wrapping at the ends. Space rotates the selected pipe clockwise. First completion earns 5 points, later completions earn 3; simultaneous first finishers all get 5. The third order pays double, allowing a comeback. Unfinished plans earn nothing. Solved boards lock until the next order; nobody is eliminated, and everyone gets the full work window. A unique connected leader at 30 points wins at round end. Host latency is inherent to this friends game; it is not a ranked contest.

## Visual identity

Decided before styling: a municipal waterworks schematic, with petrol blue `#103f4d`, chalk `#e9f4ec`, oxidised copper `#c98155`, water blue `#70d8ee`, and deep ink `#092c36`. Coral `#ff8d80` is reserved for an expiring clock, never a seat colour. Eight enamel player colours: ice, apricot, lime, lavender, rose, butter, seafoam and chalk.

Typeface: practical system sans (`system-ui`, `Segoe UI`, Arial, sans-serif), bold tightly spaced headings; instrument labels and scores use `ui-monospace`, Menlo, Consolas, monospace. Layout: broad utility heading, a large pipe emblem and plain-language brief beside a service-desk form; in play a personal schematic above three square 96px touch keys, with a compact crew ledger. Copy is brisk, friendly public-works language, not fantasy lore. Canvas art: thick copper pipe casings, blue water channels, bolted tile panels, numbered cursor brackets, inlet/outlet arrows and a wide deadline gauge. Personal board stays large even at eight players; the ledger shows every rival's progress. No external assets or fonts. Reduced-motion disables decorative droplets and score rings.

## Input

`INTENT = { select: -1 | 0 | 1, rotate: 0 | 1 }`.

- `select`: Left/A = previous tile; Right/D = next tile; gamepad axis 0. A direction change moves immediately, then a held direction repeats every 8 ticks. Separate previous and next touch buttons.
- `rotate`: Space/R or gamepad button 0; one clockwise quarter-turn per press, never auto-repeats. Separate turn touch button.
- Missing intents, numeric zero and absent fields are neutral. Frozen input arrays are never written. Held inputs are tracked through briefing/review, so holding rotation across orders cannot turn a new tile. Enter advances rounds for the host.

## Snapshot

No moving simulation coordinates exist: all positions derive from the fixed 600×480 arena. No floating positions are transmitted, and interpolation is empty; pipe orientations are discrete.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every call |
| `over` | bool | Round finished |
| `phase` | uint8 | 0 briefing, 1 work, 2 review, 3 done |
| `t` | uint16 | Ticks left in phase |
| `job` | uint8 | Work order 0–2 |
| `types` | uint16 | Nine bits: 1 elbow, 0 straight |
| `claimed` | bool | First-completion bonus already claimed |
| `rot` | uint32 per player | Nine packed two-bit clockwise orientations |
| `wet` | uint16 per player | Nine bits of inlet-connected tiles |
| `cursor` | uint8 per player | Selected tile 0–8 |
| `solved`, `active` | bool per player | Outlet connected; seat has not disconnected |
| `award`, `earned` | uint8 per player | This order's points; this round's points |
| `flash` | uint8 per player | Remaining turn-feedback ticks |
| `moved`, `turned`, `completed` | player lists | One-tick selection, rotation and score events |
| `beep`, `opened`, `reviewed`, `finished` | bool | One-tick briefing beat, work opens, review begins, round ends |

A single snapshot reconstructs the board and progress. Sound and one-shot rings read engine events; persistent highlights read `wet`, `solved`, `flash` and phase. The engine's default 100 bytes/player/tick budget is unchanged. The engine transports match scores separately.

## Round lifecycle

`startRound()` increments `round`, resets tick, phase clock, input history, order index and round earnings, and generates a guaranteed-solvable shared plan using only the injected RNG. It picks a simple grid route of at least five tiles between inlet and outlet, fits straight/elbow pieces along it, fills unused tiles, then scrambles all orientations. The inlet is forced shut initially. Scores and disconnected flags persist.

Every work tick processes all inputs and gathers completions before awarding the shared first bonus, then decrements the clock. The last work tick counts. Review preserves everyone's final board for 30 ticks. The next order clears cursors, awards and completion flags but preserves held keys. After the third review `roundOver` is true (tick 1485). All seats disconnecting ends on the next step. Post-round steps advance only the tick and emit no events. `winner(target)` ignores disconnected seats and requires a unique highest score at or above target. `disconnect(index)` preserves array slots and excludes the seat from future input, scoring and rounds.

The engine owns hosting, lobby, invitations, transport, tick scheduling, and round advance. The game owns only rules, rendering and presentation.

## Registration and deployment

`game-entry.json` is the metadata handoff. The coordinator registers both catalogs, sets `url: null` in root `public/games.json` until deployed, and adds the root `.wasmerignore` exclusion. No URL is guessed. After merge the coordinator runs:

```bash
./deploy.sh weekly-2026-10-17 super
```

## Checks / shared notebook

Completed on 2026-10-17, from the repository root:

- `cd weekly-2026-10-17 && RECORD=1 node test/game.test.mjs` — recorded the three-round fixture after the final rule change; 17/17 tests passed.
- `cd weekly-2026-10-17 && node test/game.test.mjs` — 17/17 passed. Scenarios cover reciprocal pipe joints, all generated plans over 100 seeds, press-edge rotation, wrapping/repeating selection, simultaneous first awards, later awards, double-pay finale, final-tick acceptance, disconnects, neutral inputs and the exact 1485-tick round deadline. The browser bot also solved all three plans for eight seats in a headless simulation.
- `node /app/check_game.mjs . weekly-2026-10-17` — passed: engine 1.0.2, schema `fb11b623`, reported 33 bytes/player against 100 allowed; fixture reaches round 3, tick 1485, scores 60/36/36/36.
- `node scripts/conformance.mjs weekly-2026-10-17 --static` — all 18 rows passed; 22 page roles, three touch buttons, 125-byte full snapshot at eight players. Four-player fixture maximum 85 bytes, mean delta 13.6 bytes.
- `node /tmp/check-canal-render.mjs` — temporary mock-surface smoke test passed: 12,151 surface calls covering briefing/work/review/done for local, other-seat and spectator views; finite drawing values and populated HUDs. Import map matches the scaffold's resolved pin byte-for-byte. This is not a browser or screenshot check. The first run exposed a placeholder-substitution mistake in the temporary checker; fixing that checker required no game change.

Browser/full conformance, soak, desktop/360px screenshots, two/eight-player browser play, touch interaction, local two-tab play and production checks are **pending**: this job has no browser. The 49.5-second round needs `--seconds 180` for a three-round browser run, since the harness's default is 45 seconds per requested round:

```bash
node scripts/play.mjs weekly-2026-10-17 --phone --rounds 3 --seconds 180 --shots /tmp/canal-works-shots
node scripts/play.mjs weekly-2026-10-17 --guests 1 --rounds 2 --seconds 120
node scripts/play.mjs weekly-2026-10-17 --guests 7 --phone --rounds 2 --seconds 120 --no-late
node scripts/conformance.mjs weekly-2026-10-17
node scripts/soak.mjs weekly-2026-10-17 --duration 60
```

Deployment and catalog registration remain coordinator-owned. No coordinator-owned file was edited; no engine, server, catalog or upload filter was changed.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
