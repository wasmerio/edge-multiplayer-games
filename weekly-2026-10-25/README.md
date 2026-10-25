# Copper Circuit

Rotate copper tracks into a continuous connection from the left power terminal to the right lamp before your friends. A spatial wiring puzzle race for 2–8 players, not a memory, timing, collection or movement game.

## Rules

Everyone gets the same four scrambled 3×3 circuits, in the same order. Select a tile with Left/Right (the cursor wraps through all nine tiles), then tap Space to rotate it clockwise. Only tracks joined at both ends carry power. Connect the triangular inlet beside the top-left tile to the square lamp beside the bottom-right tile; unused tracks do not matter. A completed circuit glows for 18 ticks before the next appears. Each repair earns 5 points, plus 2 for the earliest completion of that circuit (same-tick ties share the bonus). Circuits 3 and 4 earn 10 instead of 5, so a late recovery outweighs an early bonus. There is no elimination or score penalty. A round allows 45 seconds after a two-second inspection countdown, ending early if every connected player finishes. Match target: 60 with a unique connected leader, checked at round end.

Generated paths are simple routes of at least seven tiles between opposite corners. Random decoy tracks occupy unused cells; every puzzle has a solution and starts unsolved. All randomness comes from the injected RNG. All players see identical puzzles, without seat-order scoring priority. Host input has the engine's inherent latency advantage; this is a friendly race, not ranked play.

## Visual identity

Decided before styling:
- Palette: celadon paper `#d9e5d8`, forest ink `#183a31`, enamel board `#102e27`, copper tracks `#d49562`, powered mint `#b9f3cf`, chalk `#f2f7e9`. Vermilion `#bd4f38` is reserved for the closing clock.
- Eight seat colours: mint, apricot, lilac, sky, butter, rose, pearl and jade on forest, always accompanied by a seat number.
- Typeface: system monospace (`ui-monospace`, Menlo, Consolas, monospace), with compact system sans for long instructions. No external assets or fonts.
- Layout: an electrical service manual: ruled masthead, oversized circuit diagram beside a stamped work-order form; play uses a large personal workbench, instruction strip, three rectangular thumb keys, and a test-results ledger. Mobile stacks these in that order.
- Tone: calm, concise repair-shop instructions. Plain action wording before workshop flavour.
- Canvas: etched circuit board, thick right-angle copper tracks, circular solder pads, mint power with centre-line highlights, square output lamp and triangular inlet. A double corner bracket identifies the selected tile. The local board is large regardless of player count; eight numbered progress meters sit below it. Spectators watch the leading connected technician's board. Cosmetic solder sparks use event delivery; no essential information depends on animation.

## Input

`INTENT = { select: -1 | 0 | 1, rotate: 0 | 1 }`.

| Field | Keyboard / gamepad | Touch | Meaning |
|---|---|---|---|
| select | Left/A, Right/D; axis 0 | Previous and Next, separate buttons | Move through row-major tiles, wrap at either end. Immediate on direction change; repeat after 12 ticks, then every 8 ticks. |
| rotate | Space/R; button 0 | Rotate button | Clockwise quarter-turn, once per press. |

Selection is processed before rotation when both arrive together. Held keys are tracked during inspection and repair feedback, so a held rotate cannot leak into a later puzzle. Zero, missing intents and missing fields are neutral. Engine-frozen input arrays are never changed. Host uses Enter for next round/match, not Space.

## Snapshot

All geometry is discrete, derived from a fixed 480×480 board; there are no moving positions to quantise or interpolate. Packing uses two orientation bits per tile and one type bit per tile. No nested player arrays. Scores use the engine's score messages.

| Field | Type | Meaning |
|---|---|---|
| k | uint32 | Stream tick, advances on every call, including countdown and post-round |
| over | bool | Round ended |
| ready | uint8 | Inspection countdown ticks left |
| left | uint16 | Active ticks left, initially 1350 |
| types | uint16 × 4 | Bit per tile: 1 straight, 0 elbow, for each circuit |
| starts | uint32 × 4 | Scrambled orientations for each circuit (two bits per tile) |
| claimed | uint8 | Bit per circuit whose first-repair bonus has been awarded |
| board | uint32 per player | Current packed tile orientations |
| cursor, stage | uint8 per player | Selected tile 0–8; current circuit 0–3 or 4 for finished |
| power | uint16 per player | Bit per tile connected to the inlet |
| flash | uint8 per player | Repair glow ticks left; board is locked during this feedback |
| earned | uint8 per player | Points earned this round |
| active | bool per player | Seat remains connected |
| moved, turned, repaired | player lists | One-tick selection, rotation and repair events |
| beep, go, ended | bool | One-tick inspection beat, power-on, round end |

The snapshot contains everything needed to redraw a late spectator's frame. `ctx.events` and `audioMap` read events; lasting feedback reads `flash`, `power`, `stage`. Budget stays at the engine default of 100 bytes per player per tick.

## Round lifecycle

`startRound()` increments round, resets tick, creates four shared circuits using only the injected RNG, resets cursors, stages, input repeat/edge state, powered masks, repair feedback and round earnings, and starts 60 inspection ticks. Match scores and disconnected flags persist. The inspection permits looking but not changing tiles. Live play lasts 1350 ticks, with the last tick accepting a repair before time expires. Repair awards are settled together after all inputs, so simultaneous first repairs are equal. The 18-tick repair lock expires into the next circuit; the fourth lock expires into finished state. Post-round steps only advance the stream tick.

`disconnect(index)` marks the seat inactive permanently, including future rounds; its arrays remain intact and it cannot act, earn points or win. If no connected unfinished seat remains, the round ends on the next live tick. `winner(target)` returns a unique connected score leader at target, otherwise −1. One-player simulations work, although the lobby requires two.

## Checks / shared notebook

Completed in this job on 2026-10-25:

- `cd weekly-2026-10-25 && RECORD=1 node test/game.test.mjs`: recorded after the final rule change; all 19 tests passed.
- `cd weekly-2026-10-25 && node test/game.test.mjs`: all 19 tests passed. Includes exact countdown/repeat/repair timing, reciprocal track connections, simultaneous bonuses, doubled finales, timeout and last-tick scoring, frozen neutral inputs, permanent disconnects, seed determinism, fixture replay, 100 generated puzzle sets, and full-round codec checks for 1–8 seats.
- `node /app/check_game.mjs . weekly-2026-10-25`: passed on engine 1.0.2, schema `4013b429`. Fixture: 2,130 records, four players, three completed rounds; final tick 749, scores 114/90/90/90.
- `node scripts/conformance.mjs weekly-2026-10-25 --static`: all 18 rows passed. 22 page roles, three valid touch buttons, 144 B full snapshot at eight players against 800 B; largest reference snapshot 104 B against 400 B, mean delta 21.5 B.
- `node /tmp/copper-check.mjs`: supplemental non-browser smoke passed. Actual client draw, labels, scoreboard and visible-topology bots ran through three rounds at 1, 2 and 8 seats, including three-tick-delayed guest observations and spectator rendering. Every bot finished all four circuits; 2,463,046 surface calls checked for finite values and valid dimensions/alpha. Peak snapshots were 74/84/144 B. Import map verified byte-for-byte against the resolved scaffold. This caught a missing comma in the background-caching edit, which was fixed; the temporary check's scaffold placeholder substitution was also corrected before rerunning. The background is now painted once per round instead of every frame. This mock is not a visual or transport test.

Browser gameplay, 360px screenshots, two/eight-player sessions, late spectator, full conformance, soak and actual touch input: **pending**, this job has no browser. Production checks and deployment: **pending**. Coordinator-owned scaffold files were not edited; no deployment or credential access was attempted.

Root commands:

```sh
(cd weekly-2026-10-25 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-25 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-25
node scripts/conformance.mjs weekly-2026-10-25 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-25 --phone --rounds 3 --seconds 160 --shots /tmp/copper-shots`, then two-player and eight-player configurations and `--no-bot --phone`. Open the screenshots; the phone layout is designed, not visually verified. The bot solves the visible track topology and varies its thinking speed by seat.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator adds both catalog entries; the superapp reads root **public/games.json**. Its URL stays `null` until deployment reads the actual Wasmer URL. The coordinator also excludes `/weekly-2026-10-25/` in root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-25 super
```

This deploys the game, records its actual URL and redeploys the superapp. Commits, pushes, pull requests, protected scaffold files and deployment remain coordinator-owned. The engine alone owns server, lobby behaviour, invite, transport, interpolation and round advance.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
