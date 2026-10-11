# Echo Loom

Watch a pattern, weave it from memory, and finish before your friends: a three-button memory contest for 2–8 players.

## Rules and design

Five patterns of 3, 4, 5, 6 and 7 stitches form a round. Each stitch is one of three shapes: loop (left), peak (middle), or cross (right). A shared loom demonstrates them one at a time, then goes blank. Reproduce the order with Left/A, Down/S and Right/D, or the three large touch keys. Release between repeated stitches. Input during the demonstration is ignored, and a key held into recall must be released first.

Everyone has seven seconds to recall each pattern. A wrong stitch unweaves one step and locks the shuttle for 12 ticks; it never removes match points. Completion earns pattern length + 2 points. The first completion earns 2 more; simultaneous first finishers share that bonus. No extra points for mashing or repeatedly entering a prefix. Players trailing the connected match leader receive one mend per pattern: their first mistake still locks the shuttle but does not lose progress. No one is eliminated. A unique connected leader at 80 points wins at round end; ties play on.

A 2-second countdown, 0.7 seconds per demonstrated stitch, seven seconds of recall, and a 0.8-second review per pattern make a 58.5-second round. Every player count uses the same 640 × 480 board. Three large shape keys are the main focus; numbered bobbins in two rows show everyone's progress. A double outline marks your bobbin. The HUD gives the current instruction and the scoreboard pairs names with seat numbers. The review shows the full correct sequence. All peers receive the sequence in snapshots; hiding it is presentation, not cryptography. This is a friends game, not a cheat-proof memory test.

## Visual identity

- Palette: cobalt `#243c96`, midnight thread `#14235e`, linen `#f3f0e6`, pale blue `#b7cafa`, and marigold `#f2c453`. Mistakes alone use vermilion `#ce4b34`, accompanied by a cross and a progress loss.
- Eight player thread colours: pale cornflower, honey, mint, pink, periwinkle, peach, ice and white, against a cobalt loom.
- Typeface: system monospace (`ui-monospace`, `SF Mono`, Consolas, `Liberation Mono`, monospace) for labels, scores and canvas; rounded system sans (`ui-rounded`, `Trebuchet MS`, system-ui, sans-serif) for oversized headings and body.
- Layout: woven selvedge border, a wide typographic specimen beside a compact registration card; in play, loom above three equal 96px-minimum keys, followed by a two-column score ledger on phones. No borrowed scaffold panels or neon space graphics.
- Lobby tone: warm, spare workshop instructions: “Watch the thread. Remember the pattern.” Plain goal and controls before flavour.
- Canvas direction: flat jacquard-style geometric shapes, interlaced warp lines, striped bobbins and a broad draining thread. No images, external fonts or raw canvas access. Cosmetic stitch bursts use events and respect reduced motion.

## Input

`INTENT = { stitch: 0 | 1 | 2 | 3 }`.

| Value | Shape | Keyboard | Touch |
|---|---|---|---|
| 0 | Neutral | release all | release |
| 1 | Loop | Left / A | Loop button |
| 2 | Peak | Down / S | Peak button |
| 3 | Cross | Right / D | Cross button |

Bindings use `discrete: false` so values 2 and 3 are preserved. Gamepad buttons 0, 1, 2 mirror the three keys. A stitch acts only on a change from neutral to nonzero; changing directly between nonzero values requires a release. Simultaneous keys are not a chord mechanic; use one at a time. Missing and numeric-zero intents are neutral. The frozen intent array is never modified. Enter is the host's next-round key.

## Snapshot

Flat schema, no interpolated fields: the game has no moving physical positions. All layout positions are derived from fixed arena proportions; there are no unquantised positions to transmit. Every snapshot can reconstruct the loom from scratch.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every step including after over |
| `over` | bool | Round finished |
| `phase` | uint8 | 0 countdown, 1 demonstration, 2 recall, 3 review, 4 done |
| `t` | uint16 | Ticks remaining in this phase |
| `phrase`, `length` | uint8 | Zero-based pattern number and active sequence length |
| `pattern` | uint8 × 7 | Shared sequence; unused tail is zero |
| `shown` | uint8 | Lit demonstration symbol, 0 in the gaps or outside demonstration |
| `first` | int8 | First finisher for display, −1 until one finishes; simultaneous first seats all get bonus |
| `progress`, `lock`, `flash`, `last`, `mend`, `award` | uint8 per player | Correct prefix length, mistake lock ticks, feedback ticks, most recent key, remaining mend (0/1), this pattern's points |
| `done`, `active` | bool per player | Pattern complete; seat connected |
| `woven` | uint16 per player | Points earned this round |
| `pressed`, `correct`, `wrong`, `mended`, `finished` | players | One-tick input, accepted stitch, mistake, protected mistake, completion events |
| `beep`, `cue`, `recall`, `review`, `ended` | bool | One-tick countdown, demonstration beat, recall open, review open, round end events |

Sounds use `audioMap`; bursts consume `ctx.events`. Persistent feedback reads counters, progress, awards and phase, not event arrays. Budget stays at the engine's 100 bytes per player per tick.

## Round lifecycle

`startRound()` increments round, resets tick, round points, input latches, counters and completion flags, and generates the first pattern exclusively from the injected RNG. Scores and disconnected flags persist. Adjacent symbols differ in demonstrations to make the visual beat unambiguous. Each later pattern is independently generated and one symbol longer. Pattern setup refreshes mends for trailing connected seats, clears awards/progress/locks, but preserves held input latches.

After 60 countdown ticks, the demonstration runs for `length × 21` ticks (15 lit, 6 blank each). The final demonstration tick opens recall but does not accept a stitch. There are exactly 210 recall ticks; the final tick accepts input before opening the 24-tick review. The review exposes the correct sequence; it always lasts its full duration, even if everyone finished. The fifth review ends the round at tick 1755. With no connected players the next step ends the round without points. Post-round steps advance only the tick and emit no events.

`winner(target)` excludes disconnected seats and requires a unique highest score at or above target. `disconnect(index)` marks the seat inactive immediately; arrays keep their original lengths, it cannot score, and it stays out of later rounds. Awards already earned are retained, but it cannot win the match. The engine owns all lobby, invitation, transport, interpolation and round controls.

## Checks / shared notebook

Completed in this job on 2026-10-11:

- `cd weekly-2026-10-11 && RECORD=1 node test/game.test.mjs`: recorded the fixture after the final rules change; all 19 tests passed.
- `cd weekly-2026-10-11 && node test/game.test.mjs`: all 19 tests passed, including exact scoring/timing, simultaneous firsts, mistakes and mends, input release edges, disconnected seats, deterministic replay and full-round codec checks for every player count 1–8.
- `node /app/check_game.mjs . weekly-2026-10-11`: passed on engine 1.0.2; schema `d457dfdd`, fixture 5,268 records, three full rounds ending at tick 1755, scores 123/117/105/105.
- `node scripts/conformance.mjs weekly-2026-10-11 --static`: all 18 rows passed. 22 distinct page roles and three valid touch buttons. Eight-player full snapshot 135 B / 800 B; reference maximum 103 B / 400 B, mean delta 15.1 B.
- `node /tmp/echo-loom-check.mjs`: supplemental non-browser smoke check passed. Exercised the actual client draw, scoreboard and memory bot through three rounds at 1, 2 and 8 players, including spectator draws and delayed guest snapshots. Checked 946,131 surface calls for finite geometry and valid sizes/alpha. Peak snapshots 79/87/135 B. Every bot completed patterns; matches reached the target. Retained import map checked byte for byte. This mock is not a visual or transport test.

Browser gameplay, full conformance, soak, desktop/360px screenshots, human touch, two/eight-player matches and late spectator checks are **pending**: this job has no browser. Production health, URL, two-browser game and phone invite are **pending**. No deployment was attempted. Coordinator-owned scaffold files were not edited.

Commands from the repository root:

```sh
(cd weekly-2026-10-11 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-11 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-11
node scripts/conformance.mjs weekly-2026-10-11 --static
```

Reviewer: run `node scripts/play.mjs weekly-2026-10-11 --phone --rounds 3 --seconds 210 --shots /tmp/echo-loom-shots`, repeat with `--guests 1` and `--guests 7 --no-late`, and inspect the saved images. The explicit time limit accommodates three 58.5-second rounds; the harness default is too short. Test real touch with `--no-bot --phone`. Phone fit and visual polish are designed, not browser-verified. The bot remembers demonstrated symbols rather than reading the hidden pattern during recall, varies reaction speed by seat, and occasionally makes a recoverable error.

## Registration and deployment

`game-entry.json` supplies the metadata. The coordinator adds it to both catalogs; the root superapp reads **public/games.json**, not the automation catalog. The root entry keeps `url: null` until deployment reads the actual Wasmer URL. The coordinator excludes `/weekly-2026-10-11/` in root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-11 super
```

This deploys the game, records the actual URL from Wasmer, and redeploys the superapp. Commits, pushes, pull requests, protected scaffold files and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
