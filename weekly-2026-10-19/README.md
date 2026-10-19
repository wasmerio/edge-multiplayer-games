# Skysplice

Drop sliding floors onto your tower, trim the overhang, and outbuild your friends.
A one-button precision stacking contest for 2–8 players, distinct from the catalog's steering, survival, auction, memory and collection games.

## Rules and design

Eight lifts make a 34-second round: two seconds to prepare, then three seconds to place and one second to inspect each floor. Tap once when the moving slab lines up with the top of your tower. The overlapping section survives and becomes the next support; the rest falls away. Any overlap earns 1 point, at least 80% earns 2, and at least 95% earns 3 (percentages are rounded to whole numbers). A 95% placement snaps flush and preserves the full width. The uniquely cleanest positive placement earns another point after the deadline; equal accuracy cancels this bonus, never seat-order priority. Floors seven and eight double every award. First to 60 with a unique connected lead wins, checked at round end.

A miss or timeout earns nothing, but nobody is eliminated. Before each lift a safety scaffold restores narrow supports to 72 units; a miss keeps the previous support. Players behind the match leader start the next round with a 200-unit support instead of 180. Each lift has a common seeded direction and speed, increasing with height. Everyone gets the full placement window even if all players have dropped. The engine is host-authoritative; guests must anticipate network and interpolation latency. This is a friends game, not a ranked timing contest.

The local tower fills the top of a compact 560 × 440 board. A numbered skyline below compares all eight builds; the local one has an arrow and double outline, while names live in the score ledger. A spectator sees the first connected tower and gets a seat next match. All rule-relevant geometry, including the eight historical floors, is in every snapshot.

## Visual identity

- Palette: pale glacier `#e8f5f7`, blueprint cobalt `#1645a0`, midnight ink `#123052`, white drafting paper `#ffffff`, steel `#617c94`. Vermilion `#bf402b` is reserved for cut-off waste and misses. Eight player inks: cobalt, teal, violet, ochre, raspberry, slate, olive and marine blue.
- Type: modernist system sans (`Arial`, `Helvetica Neue`, system-ui, sans-serif), heavy tight headings; `ui-monospace`, Menlo, Consolas, monospace for measurement labels and numbers. No external assets or fonts.
- Layout: an airy architect's project sheet, offset slab diagram, large two-line headline, ruled registration block. In play: tower, concise action line, one broad 96px touch key, then a compact numbered score schedule; two-column scores on phones.
- Copy tone: brisk, optimistic studio instructions, not industrial warning signs. Goal and controls precede flavour.
- Canvas art: white structural slabs with dark outlines, blue dimension lines, hanging crane cables, translucent alignment projection, red offcuts and a small skyline. The moving slab is the main visual target. Cosmetic offcuts use one-shot engine events; reduced-motion clients suppress them. Placement feedback and historical floors persist in snapshots.

## Input

`INTENT = { drop: 0 | 1 }`, neutral 0. Space / ArrowDown / gamepad button 0 / the DROP FLOOR touch button all drive `drop`. A rising edge drops once. Held input is tracked in every phase so holding across lifts or the countdown cannot place another floor. Missing fields and numeric-zero seats are neutral. Frozen intent arrays are never written. Enter advances rounds for the host.

## Snapshot

All positions and widths are rounded to tenths and encoded with `fixed`, scale 10, 16 bits. Only the moving `x` interpolates; support/history changes are discrete. The engine's default 100 bytes/player/tick budget is unchanged.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every step, even after over |
| `over` | bool | Round ended |
| `phase` | uint8 | 0 ready, 1 moving, 2 inspection, 3 done |
| `t` | uint16 | Ticks remaining in the phase |
| `floor` | uint8 | Current floor index, 0–7 |
| `speed` | fixed16 ×10 | Common speed, arena units per tick |
| `x`, `carry` | fixed16 ×10 per player | Moving slab's left edge and original width |
| `base`, `width` | fixed16 ×10 per player | Current support's left edge and width |
| `dir` | int8 per player | Moving direction, −1 or +1 |
| `active`, `locked` | bool per player | Connected; has used this lift's drop |
| `quality` | uint8 per player | Rounded overlap percent (0–100), before the flush snap |
| `award`, `built`, `age` | uint8 per player | Current lift points including bonus; round points; ticks since placement (255 means none) |
| `sx0`…`sx7`, `sw0`…`sw7` | fixed16 ×10 per player | Surviving floor left edges and widths, zero width for absent floors |
| `dropped`, `missed`, `scored`, `bonus` | player lists | One-tick drop, miss, base points and cleanest-placement award events |
| `beep`, `opened`, `settled`, `finished` | bool | One-tick countdown beat, lift begins, inspection begins, round ends |

One-shot sound and drawing consume `audioMap` and `ctx.events`, not raw event arrays. Lasting feedback uses `locked`, `quality`, `age`, `award`, phase and the history fields. Scores persist in the engine's score channel.

## Round lifecycle

`startRound()` increments round, resets tick, phase timer, floor histories, locks, ages, round points and held keys. It centres the supports, applies the trailing-player wider start, and draws lift zero's common speed and starting side using only the injected RNG. Scores and disconnected flags persist.

The 60-tick countdown opens lift zero. Each lift accepts 90 ticks of input, including the deadline tick, then resolves the unique-best bonus and starts a 30-tick inspection. Input is evaluated at the current slab position, then unlocked slabs move and bounce within the margins. At the next lift, histories persist, thin supports expand to the 72-unit safety minimum, original carry width is captured, locks clear, and held state persists. Eight inspections end the round at tick 1020. All-disconnected rounds end on the next step. Post-round steps advance tick without scoring or events.

`disconnect(index)` permanently excludes that seat from input, unresolved cleanest-placement bonuses and match victory, while retaining it in all arrays and histories. Already earned points remain. `winner(target)` ignores disconnected seats and returns a unique leader at the target, or −1. The engine owns lobby, invites, transport, interpolation and lifecycle controls.

## Checks / shared notebook

Completed in this job on 2026-10-19:

- `cd weekly-2026-10-19 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final rules change; all 16 tests passed.
- `cd weekly-2026-10-19 && node test/game.test.mjs`: all 16 tests passed, including exact trims and scores, countdown/held inputs, simultaneous ties, deadline input, double points, disconnects, recovery, single-player safety, deterministic replay and complete 1–8-player codec round-trips.
- `node /app/check_game.mjs . weekly-2026-10-19`: passed on engine 1.0.2, schema `00696983`. Fixture contains 3,063 records and three complete projects; final tick 1020, scores 64/76/36/27.
- `node scripts/conformance.mjs weekly-2026-10-19 --static`: all 18 rows passed. 22 distinct page roles, one valid touch button; full eight-player snapshot 413 B / 800 B. Largest reference snapshot 233 B / 400 B, mean delta 23.0 B.
- `node /tmp/skysplice-check.mjs`: supplemental non-browser renderer/bot smoke test passed. Exercised the actual draw function, scoreboard, result labels and bots for three rounds at 1, 2 and 8 players with delayed guest observations and spectator views. 1,820,991 surface calls checked for finite coordinates and valid dimensions/opacity; peak snapshots 98/143/413 B. Every bot scored, and each run reached a unique match winner. Import map verified byte-for-byte. This is not visual or network validation.

Browser gameplay, screenshots at 360px, two/eight-player sessions, late spectators, full conformance and soak are **pending**: this job has no browser. Phone layout is designed, not visually verified. Production health, invites and deployment are **pending**. Scaffold-owned files were not edited; no credentials, commits or deployment were needed.

Commands from repository root:

```sh
(cd weekly-2026-10-19 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-19 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-19
node scripts/conformance.mjs weekly-2026-10-19 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-19 --phone --rounds 3 --shots /tmp/skysplice-shots`, then `--guests 1` and `--guests 7 --no-late`. Inspect screenshots and test real touch input with `--no-bot --phone`. The bot varies accuracy by seat and releases between lifts.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator adds it to both catalogs; the superapp reads root **public/games.json**, not the automation catalog. The URL stays `null` until deployment reads the actual Wasmer URL. The coordinator adds `/weekly-2026-10-19/` to root `.wasmerignore`.

After merge the coordinator runs:

```sh
./deploy.sh weekly-2026-10-19 super
```

This deploys the game, records its actual URL and redeploys the superapp. Commits, pushes, pull requests, deployment and scaffold-owned files remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
