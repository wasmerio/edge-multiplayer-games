# Echo Loom

Watch a stitch pattern disappear, then weave it back from memory before your friends.
A competitive sequence-memory game for 2–8 players, distinct from the repository's movement, survival, auction and timing games. No one is eliminated.

## Rules

Four patterns make a 50.4-second round. After a two-second countdown, the loom shows 3, then 4, then 5, then 6 stitches, one at a time for 24 ticks each. Remember their order. The pattern disappears for a seven-second weaving window. Tap Loop, Peak or Cross to reproduce it. A mistake unravels your progress and locks the needle for 12 ticks (0.4 seconds); try again within the same window. A held key is only one stitch; release between repeated symbols.

Completing earns 3 points; the earliest completion tick earns 5 instead. Players completing on the same earliest tick all receive 5, with no seat-order priority. Patterns three and four pay double: a late comeback is worth more than an early lead. A 1.5-second reveal shows the answer and everyone's award after every pattern. The fixed window stays open even when everyone finishes, so fast players cannot rush other clients' presentation. Match victory requires a unique connected leader with at least 50 points, checked at round end. Guest input travels to the host, so first-finish bonuses have the engine's inherent latency advantage; this is a friends game, not a ranked contest.

## Visual identity

- Palette: washed blue cloth `#dce6e8`, midnight indigo `#182c49`, natural linen `#fff4d9`, copper `#bd673c`. Canvas thread accents are honey `#efbc63`, ice `#8dd5e8` and lilac `#c4ace8`. Vermilion `#ff7a70` with a broken seam means a mistake, not a player identity.
- Eight player threads: honey, ice, lilac, seafoam, pink, periwinkle, ivory and olive-gold, all legible on indigo. Numbered bobbins plus the local double outline identify seats without colour alone.
- Typeface: rounded system stack (`ui-rounded`, `SF Pro Rounded`, `Trebuchet MS`, `Segoe UI`, sans-serif); monospace (`ui-monospace`, Menlo, Consolas, monospace) for small workshop labels and counters. No downloaded fonts.
- Layout: a horizontal woven masthead; an oversized three-stitch sampler beside a workshop registration card. In play: compact fixed board, instruction line, three large keys, and a stitched score ledger. Narrow screens stack these; the ledger uses two columns. Dashed seams and layered thread lines, not floral tickets or arcade tiles.
- Copy tone: welcoming, practical workshop instructions; goal and keys precede flavour. Short action-specific HUD guidance.
- Canvas: an indigo loom, fine warp lines, three large geometric stitch glyphs, a wide phase clock, and two columns of numbered progress bands. The central stitch is the largest element. Watch displays only the current stitch; weave hides the answer; reveal displays all stitches. Input feedback uses lasting counters; completion emits thread fragments via engine events. Reduced-motion users get no fragments or decorative pulse.

## Input

One field: `stitch`, enum `0 | 1 | 2 | 3`, neutral `0`.

| Value | Meaning | Keyboard | Touch / gamepad |
|---|---|---|---|
| 0 | Release, no stitch | No key | No button |
| 1 | Loop | A / Left | Loop button / button 0 |
| 2 | Peak | S / Up | Peak button / button 1 |
| 3 | Cross | D / Right | Cross button / button 2 |

Bindings use `discrete: false` so values 2 and 3 survive input aggregation. Press one key at a time. A nonzero change from the previous value is one press. Held state is tracked in every phase, so a key held through a phase transition cannot sneak in a stitch. Countdown and watch presses provide feedback but never advance progress. Missing intents, numeric zero and absent fields are neutral. Frozen inputs are never mutated. Enter is the host's next-round key.

## Snapshot

The schema uses no interpolation or moving coordinates: geometry is derived from the fixed 640 × 480 arena and seat count. No unquantised positions are transmitted. Every visible rule state can be drawn from a single snapshot. The full pattern is transmitted for reconstruction but hidden by the renderer during recall; developer tools can reveal it, so this is not cheat-proof.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Stream tick, advances on every step including after over |
| `over` | bool | Round ended |
| `phase` | uint8 | 0 ready, 1 watch, 2 weave, 3 reveal, 4 done |
| `t`, `tMax` | uint16 | Phase ticks remaining and phase duration |
| `panel`, `length` | uint8 | Pattern index 0–3; stitch count 3–6 |
| `pattern` | uint8 × 6 | Symbols 1–3, padded with zero |
| `cursor` | int8 | Currently displayed stitch index, or −1 outside watch |
| `claimed` | bool | First-completion bonus already claimed |
| `progress`, `cd` | uint8 per player | Correct prefix length, error lock ticks left |
| `mark`, `flash` | uint8 per player | Last pressed symbol, feedback ticks left |
| `fault`, `active` | bool per player | Last press was wrong; seat still connected |
| `award`, `woven` | uint8 per player | Current pattern award; points woven this round |
| `tapped`, `wrong`, `completed` | player lists | One-tick press, error and scoring events |
| `beep`, `cue`, `opened`, `revealed`, `finished` | bool | One-tick countdown beat, new shown stitch, recall opens, answer reveal, round ends |

`audioMap` and `ctx.events` consume one-shot fields. Lasting feedback reads `flash`, `fault`, `cd`, `progress` and `award`, not event arrays. The default 100 bytes/player/tick budget is unchanged.

## Round lifecycle

`startRound()` increments `round`, resets tick, pattern index, phase timer, held keys, progress, locks, press feedback, pattern awards and round totals. It draws the first pattern using only the injected RNG. Match scores and disconnected flags persist. Each new pattern resets per-pattern state but preserves held keys and round totals. Sequence symbols are independently drawn from 1–3, so repeated stitches are intentional.

`step()` processes input edges, awards all simultaneous first finishers equally, then advances the phase clock. The last weave tick accepts input before the answer is revealed. Four watch/weave/reveal cycles end at tick 1512. Post-round calls advance the stream tick but cannot score or emit events. If all players disconnect the next step ends the round. `disconnect(index)` keeps the seat in every array but permanently excludes it from input, scoring and winner checks, including later rounds. One-player simulations are valid even though the lobby requires two.

The engine owns lobby, invites, transport, hosting, timing and round advance. No custom netcode or DOM lobby behaviour is added.

## Checks / shared notebook

Completed in this job on 2026-10-12:

- `cd weekly-2026-10-12 && RECORD=1 node test/game.test.mjs`: recorded the fixture after the final rules change; all 17 tests passed.
- `cd weekly-2026-10-12 && node test/game.test.mjs`: all 17 tests passed. Includes exact scoring/timing scenarios, simultaneous first finishes, error lock duration, held/repeated inputs, frozen neutral intents, disconnects, one-player safety, same-seed equality and complete 1–8-player codec round-trips.
- `node /app/check_game.mjs . weekly-2026-10-12`: passed on engine 1.0.2, schema `9887346d`. Fixture: 4 players, 4,539 records, three complete rounds; final tick 1512 and scores 90/54/54/18.
- `node scripts/conformance.mjs weekly-2026-10-12 --static`: all 18 rows passed. 22 distinct page roles, three valid touch buttons; 102 B full at eight players against an 800 B budget. Largest reference snapshot 78 B / 400 B, mean delta 14.4 B.
- `node /tmp/echo-loom-check.mjs`: supplemental non-browser smoke test passed. Exercised the actual draw, scoreboard, result label and memory bots for three complete rounds at 1, 2 and 8 seats, with three-tick-delayed guest snapshots and spectator views. All bots completed patterns; 2,297,475 surface calls passed finite/range checks. Peak encoded sizes were 60/66/102 B. Import map verified byte-for-byte against the resolved scaffold. An initial assertion in this temporary script used the wrong scaffold placeholder names; the script was corrected and rerun. This is not a visual or transport test.

Browser gameplay, screenshots, full conformance, soak, two/eight-player phone sessions and production checks remain **pending**: this job has no browser. Phone usability is designed, not visually verified. All coordinator-owned scaffold files remain untouched; no deployment, commit or credential access was attempted.

From the repository root:

```sh
(cd weekly-2026-10-12 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-12 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-12
node scripts/conformance.mjs weekly-2026-10-12 --static
```

Reviewer browser command: `node scripts/play.mjs weekly-2026-10-12 --phone --rounds 3 --seconds 180 --shots /tmp/echo-loom-shots`. The explicit time limit is needed because three 50.4-second rounds exceed the harness's default 45 seconds per round. Also test two players (`--guests 1`) and eight (`--guests 7 --no-late`), late spectators and actual touch input with `--no-bot --phone`. The bot memorises only visible cues and varies tempo by seat; it does not read the hidden answer during recall.

## Registration and deployment

`game-entry.json` supplies the metadata. The coordinator registers it in both catalogs; root **public/games.json** is what the superapp reads. Its URL remains `null` until deployment obtains the real Wasmer URL. The coordinator adds `/weekly-2026-10-12/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-12 super
```

This deploys the game, records its actual URL and redeploys the superapp. Commits, pushes, pull requests, deployment and protected scaffold files remain coordinator-owned. No credentials are needed for this implementation.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
