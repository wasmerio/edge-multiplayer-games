# Stackworks

Drop sliding slabs onto your tower, trim the overhang, and build a taller personal best than your friends in thirty seconds. A one-button spatial stacking contest for 2–8 players; no movement, auctions, memory sequences or elimination.

## Rules and design

Space drops the slab at its current horizontal position. Only the overlap with the top floor survives. Align centres within 7 units for a perfect joint: it snaps to centre and restores 8 units of width, up to your foundation width. Less than 16 units of overlap collapses the tower. Rebuild immediately after a short repair pause; your best height survives. Every drop requires a release before another press. Slabs move faster as the current tower grows. A successful drop pauses for 18 ticks; a collapse repairs for 36 ticks. There is no early finish: everyone gets the full 900-tick build window after a 60-tick countdown.

At closing, each connected player earns their best height in points; all players tied for the tallest positive height get 3 extra. First to 45 total with a unique connected lead wins at round end. Trailing players start the next round with a wider foundation: 140 plus 2 units per point behind, capped at 170. All seats receive the same seeded opening direction. Scores persist, towers do not. A missed slab costs time, never a player's seat.

The local tower fills most of the compact 640×480 board; numbered miniature rival towers make the competition visible without shrinking the local timing target. The scoreboard pairs seat numbers with names. Spectators see seat 1's tower and the whole skyline. The HUD always gives the current action. Host authority means guests have transport and interpolation delay; this is a friends game, not a latency-neutral ranked contest.

## Visual identity

- Palette: concrete `#e4e3db`, model-board mist `#dfe8e1`, deep drafting ink `#163b36`, muted rule `#9aaea1`, acid-lime highlight `#d5f45b`. Vermilion `#b63728` plus broken geometry means a collapse.
- Eight player mineral inks: jade, cobalt, mulberry, ochre, olive, blue-slate, amethyst and graphite-green. Numbers and a double outline identify players independently of colour.
- Typeface: system sans (`system-ui`, `-apple-system`, `Segoe UI`, sans-serif), heavy tightly spaced headings; `ui-monospace`, Menlo, Consolas, monospace for plan labels and measurements.
- Layout: an architectural competition brief beside a ruled registration form, a narrow masthead, then an uncluttered model board with HUD, one wide 96px-high touch key, and a two-column score schedule on phones. Squared corners, hairline rules, offset slab illustrations, no arcade neon or hazard tape.
- Copy: concise studio instructions with a gently competitive tone. Goal and controls are stated before flavour.
- Canvas: flat slab elevations with small isometric top lips, ruler ticks, a dashed plumb line and overlap guide; a bottom skyline of all seats. The moving slab and supporting top are largest. Score/drop effects use short cut-off fragments; reduced-motion clients suppress fragments. No external art, fonts or scripts.

## Input

`INTENT = { drop: 0 | 1 }`, neutral 0. Space / ArrowDown / S, gamepad button 0, or the page's DROP SLAB touch button. A rising edge attempts one drop. Held state is tracked during countdown and repair, so holding across a transition cannot trigger another action. Missing intents and numeric zero are neutral; frozen intent arrays are never changed. Enter advances rounds for the host.

## Snapshot

All geometry uses fixed ×10 quantisation. Only moving `x` is interpolated; locked floors are discrete. A single snapshot rebuilds the whole visible tower (the last six floors, older floors represented by a shaft).

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every step including after over |
| `over` | bool | Build window ended |
| `ready` | uint8 | Countdown remaining |
| `left` | uint16 | Active ticks remaining |
| `x`, `width`, `base` | fixed16 ×10 per player | Sliding slab centre, slab/top width, foundation width |
| `dir` | int8 per player | Horizontal direction −1 or +1 |
| `height`, `best`, `cd`, `flash`, `result`, `award` | uint8 per player | Current height; personal best; pause ticks; feedback ticks; 0 none/1 trimmed/2 perfect/3 collapse; closing points |
| `active` | bool per player | Connected and eligible |
| `cx0`…`cx5`, `cw0`…`cw5` | fixed16 ×10 per player | Floor centre and width, ring slot `(floorNumber − 1) % 6`; zero width means empty |
| `dropped`, `landed`, `perfect`, `fell`, `awarded` | player lists | One-tick attempt, successful placement, perfect joint, collapse and closing score events |
| `beep`, `go`, `finished` | bool | Countdown beat, window opens, window closes |

Lasting feedback uses `flash`, `result` and `cd`. Effects read `ctx.events`, not raw snapshot event lists. Scores also travel through the engine. The engine's default 100 bytes/player/tick budget is unchanged.

## Round lifecycle

`startRound()` increments round, clears tick, current/best heights, cooldowns, awards, feedback, floor rings and input latches; restores connected players' foundation widths; draws one shared direction from the constructor RNG; starts a 60-tick countdown. Scores and disconnected flags persist. The foundation is centred in a 320-unit construction bay scaled from the supplied arena width.

Each live step processes input at the displayed slab position before moving unpaused slabs; then decrements the 900-tick clock. The last live tick accepts drops before settlement. A drop spawns the next slab at the opposite edge of the bay, held there during the pause. A collapse resets only the current tower and ring to a broad foundation; personal best remains. The round ends at tick 960, or immediately on the next step if everyone disconnected. Closing awards happen exactly once. Post-round steps only advance the stream tick.

`disconnect(index)` permanently removes the seat from input, closing awards and winner checks, while retaining every per-player array entry and keeping it out of later rounds. One-player builds are valid. `winner(target)` requires a unique connected leader at or above the target. The engine owns lobby, invite, transport, timing, interpolation and next-round behaviour.

## Checks / shared notebook

Completed in this job on 2026-10-14:

- `cd weekly-2026-10-14 && RECORD=1 node test/game.test.mjs`: fixture re-recorded after the final rule/schema change; all 20 tests passed.
- `cd weekly-2026-10-14 && node test/game.test.mjs`: all 20 tests passed. Includes exact overlap/centering boundaries, width recovery, collapse and personal-best retention, press edges, cooldown duration, final-tick scoring, tied bonuses, catch-up foundations, disconnects, one-player safety, deterministic replay, and full-round codec checks for every player count 1–8.
- `node /app/check_game.mjs . weekly-2026-10-14`: passed on engine 1.0.2, schema `ccf858eb`. Fixture: 2,883 events, three complete four-player rounds, final tick 960 and scores 87/35/19/14.
- `node scripts/conformance.mjs weekly-2026-10-14 --static`: all 18 rows passed. 22 distinct page roles and one valid touch button. Full eight-player snapshot 353 B / 800 B; largest reference snapshot 205 B / 400 B; mean reference delta 32.2 B.
- `node /tmp/stackworks-check.mjs`: passed. The actual draw, scoreboard, result label and bots ran for three rounds at 1, 2 and 8 players, with delayed guest snapshots and spectator views. 4,247,034 surface calls passed finite-number, nonnegative-size and alpha-range checks. All bots built towers; eight-player match totals were 81/52/50/39/31/28/25/22. Peak encoded snapshots were 94/131/353 B for 1/2/8 players. Import map verified byte-for-byte against the resolved scaffold. This is not a visual or transport check.

The first exhaustive codec test caught a 102 B solo snapshot in the initial eight-floor history. Reducing the visible history to six floors fixed the overflow without changing stacking or scoring. The fixture was then regenerated and every required check rerun successfully. The temporary smoke check initially used the wrong scaffold template placeholders; its comparison was corrected and rerun. Protected scaffold files were not edited.

Browser gameplay, full conformance, soak, screenshots at 360px, two/eight-player play, actual touch and late spectators are **pending**: this job has no browser. Production health, real URL, two-browser play, phone invite and deployment are **pending**. Phone usability is designed, not visually verified.

From repository root:

```sh
(cd weekly-2026-10-14 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-14 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-14
node scripts/conformance.mjs weekly-2026-10-14 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-10-14 --phone --rounds 3 --shots /tmp/stackworks-shots`; also run with `--guests 1`, `--guests 7 --no-late`, and actual touch with `--no-bot --phone`. Inspect screenshots, then run full conformance and soak.

## Registration and deployment

`game-entry.json` supplies display metadata. The coordinator registers it in both catalogs; the superapp reads root **public/games.json**, not the automation catalog. Its URL remains `null` until deployment reads the actual Wasmer URL. The coordinator adds `/weekly-2026-10-14/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-14 super
```

This deploys the game, records the actual URL, and redeploys the superapp. Commits, pushes, pull requests, protected scaffold files and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
