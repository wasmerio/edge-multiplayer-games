# Cloud Mason

Tap to place a sliding brick, keep the overlap, and outbuild your friends before the whistle.
A precision tower-stacking race for 2–8 players. Unlike the catalogue's steering, catching, memory and broadcast games, every placement changes the geometry of your next target. No one is eliminated.

## Rules and design

A two-second countdown opens a 36-second build. Each player's brick slides back and forth above their own tower. Space (or the large PLACE BRICK button) places it at its current position, before that tick's movement. Only the horizontal overlap survives. A surviving width of at least 24 units earns 2 points and adds a floor. Align the left edges within 8 units for a perfect: 3 points, snapped alignment and 12 units of repaired width, capped at 160. Taller towers slide faster (4 up to 6 units/tick). Every placement has 12 ticks of mortar-setting time.

Less than 24 units of overlap is a miss: the tower is rebuilt from a broad 160-unit foundation after 24 ticks, and up to 2 points earned this round are lost. Earlier rounds' points are safe. No one sits out. At the whistle the tallest connected positive-height towers share a 5-point bonus. A unique connected match leader with at least 70 points wins; tied leaders build another round. All seats score independently on the same tick, without seat-order priority.

Initial width is 136 plus 2 units per point behind the connected match leader (maximum 160). This is the comeback aid; perfects also let narrow towers recover. Everyone gets the same seeded starting direction, alternated on every attempt. The local tower is large even at eight players; a numbered skyline shows all heights, and the scoreboard supplies names. Host authority means guests have input and interpolation latency: this is a friends game, not a ranked timing contest.

## Visual identity

- Palette: cloud blue `#cde9f4`, porcelain `#f5fbff`, blueprint navy `#153c59`, muted steel `#456a80`, safety vermilion `#c13f2c` reserved for a miss. Eight masonry glazes: cobalt, teal, ochre, violet, rose, deep aqua, clay and slate, outlined in navy.
- Typeface stack: system sans (`system-ui`, `Segoe UI`, Arial, sans-serif) for clear instructions; narrow architectural headings (`Arial Narrow`, `Liberation Sans Narrow`, Impact, sans-serif); monospace numerals (`ui-monospace`, Consolas, monospace).
- Layout: airy architect's drawing sheet with a huge stacked-word lobby headline, a CSS elevation sketch and a bordered permit card. In play: full-width build elevation, action strip, one broad 96px touch key, then a compact two-column crew ledger on phones. Fine solid rules, dimension ticks and square corners, not woven seams, floral cards or hazard tape.
- Tone: optimistic construction club. Short practical instructions before flavour; errors say rebuild, not eliminated.
- Canvas: sky-blue elevation with outlined glazed bricks, pale mortar seams, dimension guides, a large local working area and a miniature skyline. Brief chips and perfect rings come from events; essential placement feedback persists in snapshot counters. Reduced-motion preference suppresses decorative particles and shake. All art is drawn through the engine surface; no external assets or fonts.

## Input

`INTENT = { place: 0 | 1 }`, neutral 0. Space, ArrowDown, S and gamepad button 0 all place; touch has one `data-engine-touch="place=1"` button.

Only a new press acts. Holding never places a second brick, including across countdown and mortar-setting transitions. Presses during setting are acknowledged but not queued. Missing intent, numeric zero and missing fields are neutral. Inputs and their frozen array are never modified. Enter is the host's next-round key.

## Snapshot

Every field is declared in `SNAPSHOT`. Positions and widths use fixed scale 10; only the moving brick `bx` is interpolated. Quantised top/history geometry changes discretely on placement. All game-relevant visuals reconstruct from one snapshot. Historical floors below the five visible tiers are deliberately cropped; they have no further collision role.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every step including after over |
| `over` | bool | Build ended |
| `ready` | uint8 | Countdown ticks remaining |
| `left` | uint16 | Build ticks remaining |
| `bx` | fixed16 ×10 per player | Moving brick's left edge |
| `dir` | int8 per player | Motion direction, −1 or +1 |
| `x0`…`x4`, `w0`…`w4` | fixed16 ×10 per player | Left edge and width of top five settled tiers, newest first |
| `height` | uint16 per player | Successful floors in current tower |
| `earned` | uint16 per player | Net points earned this round, including final bonus |
| `cd`, `flash`, `mark` | uint8 per player | Setting ticks; feedback ticks; last result (0 none, 1 placed, 2 perfect, 3 miss, 4 wait) |
| `active` | bool per player | Connected and eligible |
| `tapped`, `placed`, `perfect`, `missed`, `denied`, `bonus` | players | One-tick input, successful floor, perfect, miss, busy press and skyline award events |
| `beep`, `go`, `finished` | bool | Countdown beat, build opens, whistle |

Sound and one-shot particles consume events, never raw snapshot event lists in draw. Lasting feedback uses `flash`, `mark`, `cd`. The default engine budget stays 100 bytes/player/tick. A full encoded snapshot is 96 bytes at one player and 306 bytes at eight, including reserved event capacity.

## Round lifecycle

`startRound()` increments round, resets tick, ready to 60 and left to 1080; clears height, earned, feedback, cooldowns, held inputs and tier history; builds foundations and draws one direction from the injected RNG. Match scores and disconnected flags persist. All connected seats share the direction, with no random seat advantage.

`step()` tracks input edges in every phase. Countdown consumes exactly 60 ticks and cannot place. During the build a press resolves against the current geometry before movement. A cooldown present at tick start consumes that tick without accepting placement; there are exactly 12 (or 24 after a miss) such ticks. The final build tick accepts input, then awards the skyline bonus, emits the whistle and sets `roundOver`. The normal end is tick 1140. If all seats disconnect, the next call ends without a bonus. Post-round calls only advance the tick and return empty events.

`disconnect(index)` leaves the seat in all arrays but permanently removes it from motion, input, scoring, bonuses and winner eligibility, including later rounds. One-player simulation is valid; the lobby requires two. The engine alone handles hosting, lobby, invites, networking, interpolation and round advance.

## Checks / shared notebook

Completed in this job on 2026-10-18:

- `cd weekly-2026-10-18 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final rule change; all 17 tests passed.
- `cd weekly-2026-10-18 && node test/game.test.mjs`: all 17 tests passed. Includes exact overlap and repair boundaries, penalties, countdown and cooldown timing, simultaneous final-tick bonuses, held and frozen inputs, disconnects, one-player safety, deterministic replay and full-round codec/budget checks at every player count from 1 through 8.
- `node /app/check_game.mjs . weekly-2026-10-18`: passed on engine 1.0.2, schema `d13d949b`. Fixture: 3,423 records, four players, three complete builds; final tick 1140 and scores 204/125/76/6.
- `node scripts/conformance.mjs weekly-2026-10-18 --static`: all 18 rows passed. 22 distinct page roles and one valid touch button; full eight-player snapshot 306 B / 800 B. Largest reference snapshot 186 B / 400 B; mean delta 31.3 B.
- `node /tmp/cloud-mason-check.mjs`: supplemental non-browser smoke passed. Exercised the actual draw, labels, scoreboard and bots for three builds at 1, 2 and 8 seats, including spectator views and three-tick-delayed guest images. Checked 1,315,018 surface calls for finite geometry, nonnegative sizes and alpha bounds. Peak encoded sizes were 96/126/306 B; all bots scored and each run reached a unique match winner. The eight-seat scores were 204/201/187/168/106/86/78/74. Verified the import map byte-for-byte against the resolved scaffold. The temporary check initially used incorrect scaffold placeholder names; the check was corrected and rerun. The first eight-seat bot trial tied seats with identical biases; unique seat biases fixed that bot issue without changing rules or the fixture. This mock is not a visual or transport test.

Browser gameplay, 360px screenshots, full conformance, soak, late spectators and production checks are **pending**: this job has no browser. Phone usability is designed, not visually verified. All coordinator-owned files remain untouched. No deployment, commit, credential access or Git configuration change was attempted.

From the repository root:

```sh
(cd weekly-2026-10-18 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-18 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-18
node scripts/conformance.mjs weekly-2026-10-18 --static
```

Browser reviewer: run `node scripts/play.mjs weekly-2026-10-18 --phone --rounds 3 --shots /tmp/cloud-mason-shots`, also with `--guests 1` and `--guests 7 --no-late`. Inspect desktop, phone, later rounds, results and spectator screenshots. Use `--no-bot --phone` separately for real touch input. Full conformance and soak remain reviewer gates.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator adds both catalog entries; the superapp reads root **public/games.json**, not the automation catalogue. The root entry keeps `url: null` until the real URL is read from Wasmer. The coordinator adds `/weekly-2026-10-18/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-18 super
```

This deploys the game, records its actual URL and redeploys the superapp. Commits, pushes, pull requests, protected scaffold files and deployment are coordinator-owned. No credentials are needed.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
