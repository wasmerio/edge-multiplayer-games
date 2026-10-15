# Stackline

Drop sliding beams onto your tower, trim the overhang, and race friends to build the skyline. A one-button spatial stacking game for 2–8 players, distinct from the catalog's movement, memory, auction and resource games.

## Rules and visual identity

A shift lasts 36 seconds after a two-second countdown. Tap to drop a moving beam. Only its overlap with the previous storey survives. A landing earns 1 point; an aligned landing earns 2 and preserves the entire width. Eight storeys complete a tower for 4 extra points, then a fresh foundation arrives. An overlap narrower than 6 units is a miss: lose 2 points (never below zero), then rebuild. Nobody is eliminated. Every drop has an 18-tick settling pause; a completed tower or miss has a 30-tick pause. Holding the key never drops again. Match target is 60 with a unique connected lead, checked at shift end.

Trailing players start the next shift with a 4-unit alignment allowance instead of 2. This is visible in their ledger and local HUD. All players share the same seeded starting direction and baseline speed; higher storeys move faster. Host-authoritative input has inherent guest latency; aim a little early, not at the deadline. No ranked fairness claim.

Visual identity decided before styling:
- Palette: drafting mint `#d4eee2`, charcoal `#17392f`, chalk `#f5fff8`, survey green `#337c62`, amber alignment marks `#ffd37d`. Coral `#f27968` plus crossed lines means demolition only.
- Eight structural accents: mint, sky, butter, lilac, apricot, ice, pink and chalk, all on dark green beams with numbered seat markers.
- Typeface: system sans (`Segoe UI`, system-ui, sans-serif), heavy uppercase letterspaced headings; `ui-monospace`, Menlo, Consolas, monospace for dimension marks and scores.
- Layout: an architectural specification sheet with a giant geometric building diagram and a registration panel; in play a wide local elevation, a rival skyline strip, action line, one broad 96px touch key, and a compact two-column ledger on phones.
- Copy tone: short, constructive studio instructions, not a technical manual. Goal and one-button controls first.
- Canvas: orthographic blocks, cut edges, dimension ticks, dashed alignment guides, a broad shift clock and eight numbered tower floors. The local tower is large at every player count; rivals have compact numbered elevations and the scoreboard carries names. Spectators see the leading connected tower. Flat vector art only; no images or external fonts. Reduced motion disables decorative fragments.

## Input

`INTENT = { drop: 0 | 1 }`, neutral 0. Space or Down, gamepad button 0, or the page's DROP BEAM touch button (`data-engine-touch="drop=1"`). A rising edge requests a landing. Missing/zero intent is neutral. Held state is tracked through countdown and settling, so holding through a transition cannot trigger an extra drop. Frozen intent arrays are never modified. Enter advances the host to the next shift.

## Snapshot

Every visible rule is reconstructible from one snapshot. The arena is fixed at 640 × 480. Geometry is normalized to a 100-unit construction span, positions rounded to tenths. The guest interpolates only moving beam `x`; floors and dimensions are discrete. Historical floor drawings are rounded to whole units (fixed scale 1), then packed as `leftUnits * 128 + widthUnits` (both 0…100) in uint16 fields. Current collision dimensions retain tenths; the visual rounding error is at most half a normalized unit. No hidden guest simulation is needed.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick, advancing on every step including after over |
| `over` | bool | Shift ended |
| `ready`, `left` | uint16 | Countdown and active shift ticks remaining |
| `x` | fixed16 scale 10 per player | Moving beam's left edge, interpolated |
| `base`, `width` | fixed16 scale 10 per player | Current support left edge and width |
| `height`, `cd` | uint8 per player | Landed floors, settling ticks remaining |
| `result` | uint8 per player | Last drop: 0 none, 1 trimmed, 2 aligned, 3 miss, 4 tower complete |
| `gain` | int8 per player | Last drop's score change |
| `tolerance` | uint8 per player | Alignment allowance in normalized units (2 or 4) |
| `active` | bool per player | Still connected |
| `f0`…`f7` | uint16 per player | Packed floor geometry; zero denotes empty |
| `dropped`, `landed`, `perfect`, `missed`, `built`, `denied` | players lists | One-tick drop, scoring, alignment, miss, tower bonus, settling refusal |
| `beep`, `go`, `finished` | bool | Countdown beat, shift starts, shift ends |

One-shot visuals use `ctx.events`, sound uses `audioMap`; persistent feedback reads `result`, `gain`, `height` and `cd`. At most 8 floors per seat; default engine byte budget is not raised.

## Round lifecycle

`startRound()` increments round, resets tick, countdown (60 ticks), shift time (1080 ticks), floors, dimensions, held keys and settling state. Scores and disconnected flags persist. It uses only the injected RNG to choose a shared starting side and baseline speed (7…10 tenths per tick). Each connected trailing seat gets the wider perfect allowance; tied leaders do not.

During live ticks, settling counts down before input. Once settling reaches zero, a completed or missed tower resets, otherwise the next beam starts at the opposite edge. A fresh press lands at the beam's current coordinate; a neutral tick advances it by baseline speed plus 2 tenths per existing floor, reflecting at boundaries. Landings within tolerance snap to the support; otherwise the overlap is cut. Last-tick drops count before the shift timer ends. The round ends at tick 1140, or on the next step after everyone disconnects. Post-round calls advance the stream tick but never score again. `winner(target)` ignores disconnected seats and needs target plus a unique lead.

`disconnect(index)` marks a permanent inactive seat, keeps array lengths intact and excludes it from input, scoring, comeback calculations and future shifts. A single-player build is safe though the lobby requires two.

## Checks / shared notebook

Completed in this job on 2026-10-15:

- `cd weekly-2026-10-15 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final simulation/schema change; all 19 tests passed.
- `cd weekly-2026-10-15 && node test/game.test.mjs`: all 19 tests passed. Exact overlap and alignment boundaries, eight-floor bonuses, misses/rebuild timing, countdown and held-input behavior, settling refusal, last-tick scoring, disconnects, catch-up allowance, ties, frozen inputs and one-player safety are covered. Complete shifts at every player count 1–8 round-trip through the codec.
- `node /app/check_game.mjs . weekly-2026-10-15`: passed on engine 1.0.2, schema `075ee50f`. Fixture has 3,423 records and three complete shifts; final tick 1140, scores 212/238/211/152.
- `node scripts/conformance.mjs weekly-2026-10-15 --static`: all 18 rows passed; 22 unique page roles and one valid touch button. Full eight-player snapshot 283 B / 800 B budget. Largest reference snapshot 175 B / 400 B; mean delta 29.8 B.
- `node /tmp/stackline-check.mjs`: supplemental non-browser renderer/bot smoke test passed for three shifts with 1, 2 and 8 seats, including three-tick-delayed guest input views and spectators. 4,096,910 surface calls checked for finite numbers and valid sizes/alpha; all bots scored. Peak snapshots 94/121/283 B respectively. Import map verified byte-for-byte against the resolved scaffold. This is not a visual or transport test.

The first one-player budget probe found an oversized 110 B snapshot; compacting historical floor drawings to uint16 fixed it (94 B) without reducing collision precision. The fixture was then re-recorded and all gates rerun. Bot alignment habits were varied by seat to avoid identical full-room behavior.

Browser screenshots, phone usability, two/eight-player gameplay, late spectators, full conformance and soak are **pending**: this job has no browser. Production and deployment checks are **pending**. The engine owns lobby, invites, transport, interpolation, audio and round advance. No custom lobby or netcode. All coordinator-owned scaffold files remain untouched; no deployment or commit was attempted.

Required commands from repository root:

```sh
(cd weekly-2026-10-15 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-15 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-15
node scripts/conformance.mjs weekly-2026-10-15 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-15 --phone --rounds 3 --shots /tmp/stackline-shots`, then `--guests 1`, `--guests 7 --no-late` and actual touch input with `--no-bot --phone`. Inspect screenshots before accepting visual usability.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator adds it to both catalogs; the superapp reads root **public/games.json**. Its entry has `url: null` until deployment obtains the real Wasmer URL. The coordinator adds `/weekly-2026-10-15/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-15 super
```

This deploys the game, records its actual URL and redeploys the superapp. Protected scaffold files, commits, pushes, pull requests and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
