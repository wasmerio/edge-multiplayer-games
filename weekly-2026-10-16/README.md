# Stack Bureau

Drop moving slabs onto your tower, keep as much overlap as possible, and outbuild your friends in a 36-second construction sprint. A one-button precision-stacking race for 2–8 players, not a movement, memory, auction, collection or survival game. Players build independently against a shared clock; the competition is the live points race.

## Rules

Tap when the moving slab aligns with the top of your tower. Only the overlap survives: each imperfect placement narrows the next slab. A centre error of at most 6 units is PERFECT: snap to centre, restore 8 units of width (up to the starting width), and earn 2 points instead of 1. An overlap below 12 units is a miss: no points, a one-second rebuild, and a fresh foundation. Earned points are never lost. Nobody is eliminated.

A successful placement settles for 10 ticks. Each floor raises speed from 3 by 0.16 units/tick, capped after 20 floors. The slab bounces at the ends of a 240-unit construction bay. All players start on the same seeded side. Players behind the connected match leader start the next round with a 140-unit foundation instead of 110, a visible catch-up allowance. The round lasts 1080 live ticks after a 60-tick countdown (38 seconds total at the engine default 30 Hz). The unique connected leader at or above 60 match points wins at round end; tied leaders play another round. Host input has the engine's inherent latency advantage: this is a friends game.

## Visual identity

- Palette: concrete `#eceee7`, white stock `#fafbf6`, charcoal `#202920`, graphite `#536052`, acid lime `#d5ed56`. Misses use vermilion `#bd3c26` plus a broken-slab cross, never colour alone.
- Eight slab pigments: forest, cobalt, plum, ochre, teal, rust, slate and magenta. Numbered site markers and a double outline identify the local site without colour.
- Typeface: system grotesk (`Arial`, `Helvetica Neue`, system-ui, sans-serif); technical counters in `ui-monospace`, Menlo, Consolas, monospace. No downloaded assets.
- Layout: an architectural job sheet with an oversized numbered stacking diagram and a bordered dispatch form; in play a large local elevation, a narrow rival progress register, HUD, one broad 96px touch key, then the score schedule. Two-column score rows on phones. Sharp corners, ruler ticks, heavy horizontal rules; no cards with soft shadows.
- Tone: terse, useful construction-office copy, gently playful. Goal and one-button controls appear before flavour text.
- Canvas art direction: pale drafting field, dark ruler ticks, flat pigment slabs with white inset seams, acid-lime alignment brackets, cut fragments and stamped result symbols. Six recent floors are fully reconstructible from a snapshot. The local elevation stays large even with eight players; rivals have numbered miniature elevations. Reduced-motion users get no cosmetic fragments or shake.

## Input

`INTENT = { drop: 0 | 1 }`, neutral 0. Space, ArrowDown or gamepad button 0 drops; the page has one `data-engine-touch="drop=1"` button. Only a rising edge acts; release before dropping another slab. Missing fields, absent entries and numeric-zero intents are neutral. Held state is tracked during countdown and settling, so holding cannot submit an automatic placement later. Frozen intent arrays are never modified. Enter advances the host's round, never Space.

## Snapshot

Fixed 640 × 480 arena; simulation coordinates describe a 240-unit bay, not screen pixels. Positions and widths are rounded to tenths, encoded as fixed16 at scale 10. Only moving `x` is interpolated; foundation and history changes must be discrete. No private persistent client rule state is needed.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, incremented on every step including after over |
| `over` | bool | Round ended |
| `ready` | uint8 | Countdown ticks remaining |
| `left` | uint16 | Live ticks remaining |
| `x`, `centre`, `width` | fixed16 ×10 per player | Moving slab centre; foundation/top centre; current slab width |
| `cap` | uint8 per player | Starting/maximum width, including catch-up allowance |
| `dir` | int8 per player | Travel direction, −1 or +1 |
| `height`, `points` | uint16 per player | Current tower floors; points earned this round |
| `cd`, `flash`, `result` | uint8 per player | Settle/rebuild ticks; feedback ticks; 0 none, 1 trimmed, 2 perfect, 3 missed, 4 wait |
| `active` | bool per player | Connected seat, eligible for input and scoring |
| `c0`…`c5`, `w0`…`w5` | fixed16 ×10 per player | Six recent floor centres and widths, oldest to newest; zero width is an empty row |
| `tapped`, `placed`, `perfect`, `missed` | player lists | One-tick input, ordinary score, perfect score and miss events |
| `beep`, `go`, `finished` | bool | One-tick countdown beat, live start, round end |

Audio and cosmetic fragments consume `ctx.events`; persistent feedback uses `flash`, `result` and `cd`. The unchanged engine budget is 100 bytes/player/tick. Match scores travel through the engine; `points` is the live round subtotal.

## Round lifecycle

`startRound()` increments round, resets tick and the countdown, restores foundations, clears floor history, height, points, held keys, feedback and cooldowns, and chooses a common starting side using only the injected RNG. Scores and disconnected flags persist. The history initially contains only the foundation. A successful drop appends a floor and starts settling; a miss clears the tower and rebuilds the foundation. Each new slab starts at the edge, with sides alternating by tower height.

Every live tick accepts rising-edge input at the current position before moving the slab. A cooldown tick never places a floor, even if it reaches zero on that tick. The final live tick can score before closing. `roundOver` becomes true when `left` reaches zero or all players have disconnected; `finished` is emitted only once. Post-round calls increment the stream tick but neither score nor emit events. `winner(target)` ignores disconnected seats and requires a unique lead. `disconnect(index)` leaves the seat in every array but excludes it from play and later rounds. One-player simulations are valid.

The engine owns hosting, lobby, invitations, transport, interpolation and round advance. The game adds no netcode or DOM lobby behaviour.

## Checks / shared notebook

Completed in this job on 2026-10-16:

- `cd weekly-2026-10-16 && RECORD=1 node test/game.test.mjs`: recorded the fixture after the final rules change; all 18 tests passed.
- `cd weekly-2026-10-16 && node test/game.test.mjs`: all 18 tests passed, including exact overlap/perfect boundaries, rebuild timing, countdown and held inputs, simultaneous awards, final-tick scoring, catch-up foundations, disconnects, one-player safety, seed equality, replay and complete 1–8-seat codec checks.
- `node /app/check_game.mjs . weekly-2026-10-16`: passed on engine 1.0.2, schema `127e03a2`; three complete reference rounds, 3,423 fixture records, final tick 1140 and scores 282/271/94/83.
- `node scripts/conformance.mjs weekly-2026-10-16 --static`: all 18 rows passed; 22 unique roles and one valid touch button. Full eight-player snapshot 360 B against 800 B. Largest reference snapshot 204 B / 400 B, mean delta 40.6 B.
- `node /tmp/stack-bureau-check.mjs`: supplemental non-browser smoke test passed. Exercised the actual draw, scoreboard, result label and bots for three complete rounds at 1, 2 and 8 seats, including delayed guest snapshots and spectator views. All bots scored; 4,790,499 surface calls passed finite/range checks. Peak encoded sizes were 87/126/360 B. Import map verified byte-for-byte. This is not a visual or transport test.
- SHA-256 checks before and after implementation confirmed all four coordinator-owned scaffold files are unchanged. No deployment, commit or credential access was attempted.

Browser gameplay, full conformance, soak, screenshots at 360px, two/eight-player games, late spectators and actual touch input remain **pending**: this job has no browser. The phone layout is designed, not visually verified. Production health, actual URL, two-browser play, phone invite and deployment remain **pending**.

From the repository root:

```sh
(cd weekly-2026-10-16 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-16 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-16
node scripts/conformance.mjs weekly-2026-10-16 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-16 --phone --rounds 3 --shots /tmp/stack-bureau-shots`; repeat with `--guests 1` and `--guests 7 --no-late`, then `--no-bot --phone`. Inspect the screenshots rather than treating a smoke test as a visual approval.

## Registration and deployment

`game-entry.json` supplies display metadata. The coordinator registers the game in both catalogs; the superapp reads root **public/games.json**, not the automation catalog. The root entry remains `url: null` until deployment obtains the actual Wasmer URL. The coordinator adds `/weekly-2026-10-16/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-16 super
```

This deploys the game, records its actual URL, and redeploys the superapp. Commits, pushes, pull requests, protected scaffold files and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
