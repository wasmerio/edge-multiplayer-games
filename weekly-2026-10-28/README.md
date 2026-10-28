# Margin Press

Time your press to stack sliding ink blocks: overhang is cut away, so every landing changes the next target. A competitive stacking game for 2–8, not a movement, memory, auction or survival game.

## Rules

Eight courses make a 34-second print run: two seconds ready, then four seconds per course. Each player has a separate stack. Tap once to drop the sliding block onto its outlined support. At least 16 units of overlap earns 1 point and keeps only that overlap. Align the left edges within 6 units for a perfect print: 3 points, plus 8 units of restored width (cap 192). Courses 7 and 8 pay double. Missing or timing out earns nothing but restores 32 units of width for the next course. Everyone gets another block; nobody is eliminated. The next course waits for the shared clock even if everyone has pressed.

The first support is 160 units wide. A player behind the connected match leader starts with up to 32 extra units (2 per point behind). A unique connected leader at 45 points wins at the end of a run; ties continue. Press early enough to account for guest-to-host input latency; this is a friends game, not latency-compensated ranked play.

## Visual identity

- Palette: porcelain white `#f4f7ff`, saturated press blue `#163fba`, deep ink `#102559`, pale ruling `#cad6f3`. Vermilion `#c33727` is reserved for a failed print and a cross mark.
- Eight player inks: cobalt, teal, violet, ochre, raspberry, slate, olive, and midnight. All blocks have seat numbers and outlines as well as colour.
- Typeface: `ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace` for labels, counters and controls; `Arial, Helvetica, sans-serif` in heavy tightly spaced display headlines. No external fonts or art.
- Layout: a print specimen with a giant offset headline, registration crosshairs, a ruled job ticket and an explanatory overlap diagram. Play uses two columns of compact print beds, a clock strip, instruction line, a full-width 96px press pad, then the score sheet. The scoreboard folds into two columns on phones.
- Copy tone: concise and practical printer's instructions, with job-ticket labels rather than generic arcade copy.
- Canvas: white paper, cobalt registration lines, opaque rectangular ink layers, dotted alignment guides, striped offcuts and a double registration bracket on the local bed. Whole stack history is visible, not cosmetic-only. Small seat numbers map to numbered scoreboard names. No flashing or screen shake; a short event-driven offcut effect respects reduced motion.

## Input

`INTENT = { press: 0 | 1 }`, neutral 0. Space, ArrowDown or gamepad button 0 presses; a single `data-engine-touch="press=1"` button is the phone control. One rising edge drops one block; release before another press. Held state is tracked during ready, between courses and after a placement, so holding never automatically drops the next block. Missing intents and numeric zero are neutral; frozen inputs are never changed. Enter advances the host to the next run.

## Snapshot

All fields are sent every tick. Geometry uses a 256-unit bed inside each half of `opts.arena`; exported `ARENA(n)` is 640 × (100 + 160 × ceil(n/2)). No hidden client state is required to draw.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every call |
| `over` | bool | Run ended |
| `ready` | uint8 | Ready ticks remaining |
| `course`, `t` | uint8 | Zero-based course and ticks remaining (120 max) |
| `x` | fixed16 ×10 per player | Sliding block's left edge, local bed coordinates; interpolated |
| `width`, `baseX`, `baseW` | uint8 per player | Moving width and next support's left edge and width |
| `locked`, `active` | bool per player | Already pressed this course; still connected |
| `result`, `award`, `total` | uint8 per player | 0 waiting / 1 trimmed / 2 perfect / 3 miss / 4 timeout; points just earned; points this run |
| `hx0`…`hx7`, `hw0`…`hw7` | unsigned fixed8 ×1 per player | Left edge and width of each retained layer; width 0 means no layer |
| `pressed`, `scored`, `missed` | players | One-tick action, score and failure events |
| `beep`, `opened`, `finished` | bool | Ready beat, a course begins, run ends |

Position rounding is explicit: moving blocks to tenths, settled layers to integers. Only `x` interpolates. Persistent feedback reads `result` and the layer fields; sound and offcuts use events. The default 100 bytes/player/tick budget is unchanged.

## Round lifecycle

`startRound()` increments round, resets tick, ready=60, course=0, t=120, input edges, histories, results and run totals. Scores and disconnected flags persist. Initial support widths apply the comeback allowance. Each course starts blocks at a common seeded side and direction; speed rises from 3 to 5.8 units/tick across eight courses. Randomness comes only from the injected RNG.

Each live tick moves unlocked blocks, then handles press edges, then decrements the clock. The final tick accepts a press before timeout. At t=0 the last course remains visible until the next tick starts a new course; the eighth ends the round immediately, at tick 1020. A perfect landing expands the retained overlap around its centre within bed bounds. A miss widens the next support, but adds no layer. Disconnected seats remain in every array, cannot move, score or win, and stay inactive in later rounds. All-disconnected ends on the next step. Post-round calls advance k without scoring. One-player simulations remain valid.

## Checks / shared notebook

Completed on 2026-10-28:

- `cd weekly-2026-10-28 && RECORD=1 node test/game.test.mjs`: recorded the fixture after the final rule change; all 17 tests passed.
- `cd weekly-2026-10-28 && node test/game.test.mjs`: all 17 passed, including exact overlaps, perfect restoration, minimum overlap, timeout ordering, held-input edges, comeback stock, disconnects, one-player safety, full 1–8-player codec round-trips, deterministic seeds and replay.
- `node /app/check_game.mjs . weekly-2026-10-28`: passed; engine 1.0.2, schema `fc6d56fd`, reported 44 bytes/player against 100. Fixture: 3,063 records, three complete runs, final tick 1020, scores 90/30/25/19.
- `node scripts/conformance.mjs weekly-2026-10-28 --static`: all 18 rows passed. 22 unique page roles, one valid touch button, full eight-player snapshot 232 B / 800 B. Reference peak 136 B / 400 B, mean delta 17.1 B.
- `node /tmp/margin-check.mjs`: supplemental renderer/bot smoke test passed. Three complete runs at 1, 2 and 8 seats, including three-tick-delayed guest snapshots and spectator draws; 3,229,209 finite/range-checked surface calls, peak snapshot 232 B. All bots scored and every configuration produced a match winner. The import map was verified byte-for-byte. This mock is not visual, input-transport or browser validation.

Browser screenshots, actual phone controls, two/eight-player play, late spectator, full conformance, soak and production verification are **pending**: this job has no browser. Layout at 360px is designed, not visually verified. No deployment was attempted. Coordinator-owned files and root catalogs were left unchanged.

Commands from repository root:

```sh
(cd weekly-2026-10-28 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-28 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-28
node scripts/conformance.mjs weekly-2026-10-28 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-28 --phone --rounds 3 --shots /tmp/margin-press-shots`, then `--guests 1`, `--guests 7 --no-late`, and actual touch with `--no-bot --phone`. Open and judge screenshots before approving. Bots vary precision by seat.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator registers both catalogs; the root superapp reads **public/games.json**, with `url: null` until the actual Wasmer URL is known. The coordinator adds `/weekly-2026-10-28/` to root `.wasmerignore`. After merge:

```sh
./deploy.sh weekly-2026-10-28 super
```

This deploys the game, records its actual URL and redeploys the superapp. Scaffold-owned files, root catalogs, commits, pushes, PRs and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
