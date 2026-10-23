# Plumb Club

Stop a sliding floor over your tower; overhang gets cut away, and the tallest tower at the bell wins. A one-button construction contest for 2–8 friends, not a movement, auction, memory, collection or survival game.

## Rules and design

A two-second countdown opens a 36-second building session. Each player has a tower and an automatically sliding floor. Tap to place it: only the horizontal overlap remains. An alignment within 8 units is perfect: keep the old alignment and recover 8 units of width (up to 184). Less than 24 units of overlap collapses the tower to zero floors and restores a broad foundation. There is no elimination; rebuild immediately after the short collapse pause. A landed floor pauses for 12 ticks; a collapse pauses for 30. Holding the button never places repeatedly. Sweep speed increases with height, from 4 to at most 8 units/tick. You may stop building to protect a lead, but rivals can keep climbing.

At the bell, every connected player tied for the tallest positive tower earns 3 match points. Other towers at least four floors tall earn 1. Empty skylines award nothing. Match target: 9 points and a unique connected lead. Only the current height matters, not a previous peak. The unique match leader starts the next session with a narrower 152-unit floor instead of 184; perfect placement can repair that disadvantage. A collapse resets everyone to 184. No hidden dice during play: the injected RNG chooses a shared initial sweep side. Each next sweep alternates sides.

Guest latency is inherent to host authority; placement is judged when the host receives it. This is a friendly timing game, not ranked competition. The moving floor is deliberately slow and broad at the start. The fixed session lets everyone participate for the whole round. Local construction is large; numbered mini-elevations show all rivals without crowding the work area. On a spectator view the leading tower is enlarged. A late spectator gets a seat next match.

## Visual identity

- Palette: saturated blueprint cobalt `#123db5`, deep blue `#10266b`, chalk `#f3f6ff`, pale drafting blue `#b7ccff`, acid-yellow survey marks `#e4f27b`. Coral `#ff816a` plus a broken-floor cross is reserved for collapse.
- Eight player inks: chalk, lemon, glacier, orchid, apricot, mint, periwinkle, rose. Seats also have numbers and the local tower has double outlines.
- Typeface: system sans (`Arial`, `Helvetica Neue`, system-ui, sans-serif) with tight heavy headings; drafting numerals in `ui-monospace`, Menlo, Consolas, monospace. No external fonts.
- Layout: a bold blue architectural sheet with oversized title, elevation diagram and a white registration panel; in play a wide construction drawing, instruction strip, one broad thumb key, then a compact score schedule. Hairline rules, dimension arrows, square corners and generous margins rather than cards, fabric or floral motifs.
- Tone: concise, upbeat studio instructions. “Build tall. Keep it plumb.” Goal and control remain plain.
- Canvas: chalk outlines, hatch-cut overhang, a moving filled slab, dashed plumb guides, and a tall central elevation with windows. Camera follows the top; the lower building is a schematic silhouette, not retained collision geometry. A right-hand schedule shows all numbered tower elevations. Lasting placement feedback uses counters; cut fragments are cosmetic events. Reduced motion suppresses fragments and shaking.

## Input

`INTENT = { drop: 0 | 1 }`, neutral 0. Space / ArrowDown / gamepad button 0 / one DROP FLOOR touch button place a floor on a rising press edge. Release before the next placement. Countdown and cooldown track held state but cannot place; holding through them cannot auto-place. Missing, numeric-zero and absent-field intents are neutral. The frozen intents array is never mutated. The host advances with Enter, not Space.

## Snapshot

All geometry needed to draw is present in one snapshot; no tower history is required. Coordinates are rounded to tenths using fixed scale 10. Only moving `x` interpolates; the newly cut foundation must change discretely.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick, advances every step including after over |
| `over` | bool | Session ended |
| `ready` | uint8 | Countdown ticks left |
| `left` | uint16 | Building ticks remaining |
| `lead` | int8 | Narrow-foundation match leader, or -1 |
| `x`, `base`, `width` | fixed16 scale 10, per player | Moving floor left edge; top foundation left edge; shared moving/foundation width |
| `dir` | int8 per player | Sweep direction, -1 or 1 |
| `height`, `cd`, `flash`, `award` | uint8 per player | Current floors; pause ticks; feedback ticks; session match award |
| `mark` | uint8 per player | Last placement: 0 none, 1 cut, 2 perfect, 3 collapsed |
| `active` | bool per player | Connected seat |
| `placed`, `perfect`, `collapsed`, `awarded` | player lists | One-tick placement, perfect alignment, collapse, scoring events |
| `beep`, `go`, `finished` | bool | One-tick countdown beat, building opens, bell |

Sounds and one-shot fragments use engine event delivery, never raw event lists in draw. The width, top, height and feedback counter survive missed frames and late joins. Scores travel through the engine. The default 100 bytes/player/tick budget is unchanged.

## Round lifecycle

`startRound()` increments `round`, resets tick, countdown, session clock, positions, heights, pauses, held buttons, feedback and awards. It uses only the injected RNG to choose the shared sweep side. Match scores and disconnected flags persist. The unique connected match leader (if positive) gets the narrower starting width.

Each live tick first advances a non-paused floor, reflecting at the workspace bounds, then processes a press. The final building tick accepts a placement before settlement. Ready lasts exactly 60 ticks; building lasts exactly 1080 ticks. `roundOver` becomes true at tick 1140, or on the next step if everybody disconnects. Settlement runs once. Post-round calls only advance the tick. `winner(target)` excludes departed seats and requires the target and unique lead; ties continue.

`disconnect(index)` marks the seat inactive permanently, preserving its array slot but removing it from placement, awards and winner checks in this and subsequent rounds. One-player simulations work, although the lobby requires two. Engine behaviour (lobby, invites, hosting, transport, interpolation, round advance) is untouched.

## Checks / shared notebook

Completed in this job on 2026-10-23:

- `cd weekly-2026-10-23 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final rules change; all 19 tests passed.
- `cd weekly-2026-10-23 && node test/game.test.mjs`: all 19 tests passed, including exact placement/collapse thresholds, countdown and pause edges, final-tick settlement, shared awards, handicap, disconnects, frozen inputs, one-player safety, seed equality, replay and whole-session codec checks for 1–8 seats.
- `node /app/check_game.mjs . weekly-2026-10-23`: passed on engine 1.0.2, schema `0434ae35`. Fixture: 3,423 records, three complete sessions, final tick 1140, scores 9/7/3/3.
- `node scripts/conformance.mjs weekly-2026-10-23 --static`: all 18 rows passed; 22 distinct roles, one valid touch button, 145 B full at eight players against 800 B. Largest reference snapshot: 97 B / 400 B, mean delta 29.8 B.
- `node /tmp/plumb-check.mjs`: supplemental non-browser smoke check passed. Exercised actual draw, scoreboard, result labels and bots through three complete sessions at 1, 2 and 8 seats, including spectator views and three-tick-delayed guest snapshots. 793,701 surface calls passed finite/range checks; every bot built at least 19 floors at its peak. Peak full snapshots: 61/73/145 B. Verified the import map byte-for-byte against the resolved scaffold. The temporary script initially used incorrect scaffold placeholder names; that assertion was corrected and rerun. This mock is not a visual or network check.

The browser bot predicts a short input lead and varies tolerance and hesitation by seat. The reference script exercises both intent values across all three sessions, with deliberate imperfect placements and collapses.

Browser gameplay, screenshots at 360px, full conformance, soak, two/eight-player play, actual touch, late spectators and production checks are **pending**: this job has no browser. The layout is designed, not visually verified. No deployment or credential access was attempted. All coordinator-owned scaffold files remain untouched.

From the repository root:

```sh
(cd weekly-2026-10-23 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-23 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-23
node scripts/conformance.mjs weekly-2026-10-23 --static
```

Browser reviewer: `node scripts/play.mjs weekly-2026-10-23 --phone --rounds 3 --shots /tmp/plumb-shots`, then two-player (`--guests 1`) and eight-player (`--guests 7 --no-late`) runs. Inspect desktop, phone, late round, result and spectator images; use `--no-bot --phone` to exercise actual touch.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator adds it to both catalogs; the superapp reads root **public/games.json**, not the automation catalog. The root entry keeps `url: null` until deployment obtains the actual Wasmer URL. The coordinator adds `/weekly-2026-10-23/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-23 super
```

This deploys the game, records its actual URL and redeploys the superapp. Protected scaffold files, commits, pushes, pull requests and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
