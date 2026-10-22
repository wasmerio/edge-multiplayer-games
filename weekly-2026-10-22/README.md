# Plumb Club

Stack sliding slabs into six-storey towers: only the overlap survives. A one-button architectural precision contest for 2–8 friends, not a movement, collection, auction or memory game.

## Rules and design

Tap when the moving slab lines up with the roof. An ordinary landing trims the overhang and earns 1 point; alignment within 6 arena units snaps flush and earns 2. Less than 12 units of support is a miss: lose 2 points (never below zero), then rebuild on a wide foundation. Completing six floors earns an extra 4 points and opens a fresh site. A landing pauses for 12 ticks; a miss or completion pauses for 30. Release between drops. Everyone builds for 30 seconds after a two-second countdown; no one is eliminated. The last active tick accepts a drop. A unique connected leader at 60 points wins at round end; ties continue. Taller stacks move faster, so banking a six-floor tower resets the difficulty. A miss restores the wide foundation, giving struggling builders a way back.

The local construction fills the large upper elevation; numbered miniature rival sites sit underneath. Spectators see seat 1 enlarged and get a seat next match. A fixed 640 × 480 board keeps the slab readable on a phone, even with eight players. Guest input has host-authoritative latency: aim a little ahead; this is a friendly contest, not ranked play.

## Visual identity

- Palette: blueprint ultramarine `#163bb1`, deep drafting ink `#10286d`, chalk `#f4f7ff`, rule blue `#5578d1`, fluorescent survey lime `#dfff72`. Coral `#ff807b` plus broken marks means a miss.
- Eight player inks: chalk, survey lime, ice, apricot, lavender, rose, mint and sand; seat numbers and a double frame distinguish the local builder without relying on hue.
- Typeface: system sans (`Arial`, `Helvetica Neue`, system-ui, sans-serif) with heavy, tightly tracked headings; `ui-monospace`, Menlo, Consolas, monospace for drawing numbers and dimensions.
- Layout: an architectural drawing sheet, oversized stacked headline and an orthographic tower illustration opposite a ruled registration form. In play: elevation, instruction strip, one broad 96px-high drop key, compact two-column score schedule on phones. Square corners, fine grid lines, circular drawing-number stamps.
- Lobby tone: a playful architecture club, but plain goal and controls first. No construction-site hazard tape or workshop cloth.
- Canvas: flat rectangular slabs, outlined moving material, dashed plumb lines, visible trimmed edges, dimension ticks and six-floor elevation studies. Main building is large; miniatures are context, not controls. One-shot offcuts use engine events. Reduced-motion users get no flying offcuts; essential slab motion remains.

## Input

`INTENT = { drop: 0 | 1 }`. Space, ArrowDown, gamepad button 0, or the page's `data-engine-touch="drop=1"` button drops one slab on the rising edge. Missing fields and numeric zero are neutral. Held state is tracked through the countdown and cooldown, so holding never auto-builds or queues a drop. Inputs are never modified. Enter is the host's next-round key.

## Snapshot

All positions are quantised to tenths, fixed16 scale 10. Coordinates use the supplied arena width. The top six slabs are the entire active building, not client history; every snapshot can reconstruct it from scratch. Only `x` is interpolated (moving slab). Other fields are discrete to avoid blending different landings.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every call |
| `over` | bool | Round ended |
| `ready` | uint8 | Countdown ticks left |
| `left` | uint16 | Active ticks remaining |
| `x`, `width`, `base` | fixed16 ×10 per player | Moving slab left edge, slab/roof width, roof left edge |
| `dir` | int8 per player | Moving slab direction, −1 or +1 |
| `level`, `cd`, `result` | uint8 per player | Built floors 0–6, pause ticks, last result (0 none, 1 trimmed, 2 flush, 3 miss, 4 commissioned) |
| `active` | bool per player | Connected and eligible |
| `bx0`…`bx5`, `bw0`…`bw5` | fixed16 ×10 per player | Landed slab left edges and widths, zero width for empty floors |
| `landed`, `perfect`, `missed`, `built` | player lists | One-tick landing, flush landing, miss and commission events |
| `beep`, `go`, `finished` | bool | Countdown beat, start, round end events |

Score totals use the engine's score channel. Result and cooldown drive lasting feedback; particles read `ctx.events`, never raw event arrays. The engine's default 100 bytes/player/tick budget is unchanged.

## Round lifecycle

`startRound()` increments round, resets tick, ready=60 and left=900, clears each building, result, cooldown and input latch, restores a foundation 32% of arena width at centre, and draws each initial travel direction from the injected RNG. Match scores and disconnected flags persist. Slabs move 5 + 0.35 × level arena units per tick and reflect at the side boundaries. Input is evaluated at the current slab position before movement, so the drop matches the most recent host frame. Success advances a floor and uses the remaining overlap as the next slab width. A new slab starts from a seeded side after a pause. A completed or missed building resets when its pause finishes. During pauses the previous slab stays visible.

`step()` processes input then advances the active clock. At tick 960 the round ends; extra calls only advance k and emit no events or points. All seats disconnected also ends on the next step. `winner(target)` excludes departed seats and requires the target and a unique highest score. `disconnect(index)` permanently marks the seat inactive, keeps all arrays intact, and excludes it from input and future rounds. One-player simulations are supported though the lobby requires two. The engine owns lobby, invite, hosting, networking, interpolation and next-round behaviour.

## Checks / shared notebook

Completed in this job on 2026-10-22:

- `cd weekly-2026-10-22 && RECORD=1 node test/game.test.mjs`: recorded after the final simulation change; all 16 tests passed.
- `cd weekly-2026-10-22 && node test/game.test.mjs`: all 16 tests passed. Includes exact overlap and flush awards, minimum support, miss repair, six-floor commission, input edges through countdown/cooldown, exact final tick, disconnects, frozen zero inputs, one-player safety, full-round codec checks for 1–8 seats, deterministic seeds and fixture replay.
- `node /app/check_game.mjs . weekly-2026-10-22`: passed on engine 1.0.2, schema `bb0db69c`. Fixture: 2,883 records, four players, three completed rounds, final tick 960, scores 126/65/56/53. Gate reports 58 bytes/player against 100.
- `node scripts/conformance.mjs weekly-2026-10-22 --static`: all 18 rows passed; 22 page roles, one valid touch button, full eight-player snapshot 320 B / 800 B. Reference maximum 184 B / 400 B, mean delta 25.7 B.
- `node /tmp/plumb-check.mjs`: supplemental non-browser smoke passed. Executed the actual client draw, result label, scoreboard and bots for three rounds at 1, 2 and 8 seats, including delayed guest snapshots and spectators. Checked 2,944,037 surface calls for finite coordinates and valid sizes/alpha; peak snapshots 82/116/320 B. Bots completed 6/12/48 towers respectively, and every bot earned points. Confirmed the import map byte for byte. The first smoke run exposed a bot sampling blind spot at higher slab speeds; widening its timing tolerance fixed it without changing rules. This mock is not a visual or transport test.

Browser gameplay, phone screenshots, two/eight-player play, full conformance, soak, late spectators, actual touch input and all production checks remain **pending** because this job has no browser. Phone usability is designed, not visually verified. No deployment was attempted. Coordinator-owned scaffold files were left untouched.

Required commands from the repository root:

```sh
(cd weekly-2026-10-22 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-22 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-22
node scripts/conformance.mjs weekly-2026-10-22 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-22 --phone --rounds 3 --shots /tmp/plumb-shots`; also run two players (`--guests 1`), eight (`--guests 7 --no-late`) and manual touch (`--no-bot --phone`). Inspect the screenshots before approval.

## Registration and deployment

`game-entry.json` supplies display metadata. The coordinator adds this to both catalogs; the superapp reads **public/games.json**, not the automation catalog. The root entry keeps `url: null` until Wasmer reports the actual deployed URL. The coordinator adds `/weekly-2026-10-22/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-22 super
```

This deploys the game, records its real Wasmer URL and redeploys the superapp. Protected scaffold files, commits, pushes, pull requests and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
