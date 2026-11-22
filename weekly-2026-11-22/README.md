# Tideglass

Turn a jumble of glass pipes into a flowing connection before your friends. A spatial pipe-routing race for 2–8 players, distinct from the catalog's movement, survival, bidding, memory and timing games.

## Rules

Five shared puzzles make a 42-second round: two seconds ready, then seven seconds to route and one second to admire each result. Everyone receives identical 3×3 pipe shapes and starting rotations. Connect the left inlet to the right outlet by rotating straight pipes and elbows. Water only crosses matching ports; the illuminated route shows exactly how far it reaches. Unused pipes may point anywhere. Completing a route locks your board and earns 4 points; the first completion tick earns 7 instead (simultaneous finishers share that bonus). The last two puzzles pay double. No elimination, penalties or lost lives: the next board always brings another chance. The match ends at a unique connected leader with 70 points, checked after a round. Guest input has the engine's inherent host-authority latency; solve early rather than relying on last-tick presses.

## Visual identity

- Palette: pale sea-glass `#e0eee8`, deep bottle `#133e3b`, porcelain `#f7fcf6`, oxidised teal `#39746c`, bright flowing water `#a7f2e6`. A blocked port is vermilion `#ff987e` plus a capped cross, never colour alone.
- Eight enamel player colours: ice, gold, lavender, pink, lime, blue, peach and pearl; all sit on deep bottle tiles, never on the pale page without an ink outline.
- Typography: editorial system serif (`Iowan Old Style`, `Palatino Linotype`, Palatino, Georgia, `Times New Roman`, serif) for the name and headings; neutral system sans for instructions; system monospace for numerals.
- Layout: a bathhouse scorecard, with a large circular pipe emblem, generous sea-glass margins and fine double rules. In play: a large personal board, action line, thumb stick and turn wheel, then a compact score ledger. No tiny eight-board grid.
- Lobby tone: calm, inviting and practical. “Make a connection” rather than technical networking copy.
- Canvas: enamel tiles, thick glass pipe segments with dark casings and bright inset water, a clear inlet and outlet, a double bracket on the local cursor, and named rival medallions. Geometry is flat and crisp. No external fonts or artwork. Reduced-motion preference disables decorative particles and pulse.

## Input

`INTENT = { mx: -1..1, my: -1..1, turn: 0 | 1 }`.

| Field | Keyboard / gamepad | Touch | Meaning |
|---|---|---|---|
| mx | Left/A, Right/D / axis 0 | Thumb stick x | Move cursor horizontally |
| my | Up/W, Down/S / axis 1 | Thumb stick y | Move cursor vertically |
| turn | Space/E / button 0 | TURN button | Rotate selected pipe clockwise on a rising edge |

Cursor movement is immediate on a direction change, then repeats every 6 ticks. Neutral does nothing. Opposing keys cancel. Holding turn never rotates repeatedly; release between turns. Held states are tracked during ready, reveal and after completion, so a held key cannot sneak into a new puzzle. Frozen intent arrays are never mutated. Enter advances the host to the next round.

## Snapshot

No simulation positions move; tile geometry derives from the arena and seat count. Discrete rotations do not interpolate. Every frame can be reconstructed from one snapshot, including water connectivity (pure `trace()` helper).

| Field | Type | Meaning |
|---|---|---|
| k | uint32 | Stream tick, advances on every step |
| over | bool | Round ended |
| phase | uint8 | 0 ready, 1 routing, 2 reveal, 3 done |
| t | uint16 | Phase ticks remaining |
| puzzle | uint8 | Puzzle index 0–4 |
| inlet, outlet | uint8 | Left and right port rows 0–2 |
| tiles | uint8 × 9 | Canonical pipe masks: 3 elbow (north/east), 5 straight (north/south) |
| r0…r8 | uint8 per player | Tile rotations, clockwise quarter-turns 0–3 |
| cursor, flash, award, total | uint8 per player | Selected tile; rotation feedback ticks; this puzzle's award; round points |
| done, active | bool per player | Solved; still connected |
| claimed | bool | First-flow bonus already taken |
| moved, turned, solved | players | One-tick cursor, rotation and score events |
| beep, opened, revealed, finished | bool | One-tick countdown beat, new puzzle, result phase and round end |

Water persists through `tiles`, rotations, `inlet` and `outlet`, not cosmetic state. Rotation feedback uses `flash`; solved state persists through `done`. Sound and particles consume events only. The 100 bytes/player/tick engine budget is unchanged.

## Round lifecycle

`startRound()` increments round and resets tick, phase, puzzle index, cursors, feedback, input edges, puzzle awards and round totals. It generates a simple inlet-to-outlet path through at least four tiles using only the injected RNG, fills unused cells with seeded decoys, and scrambles every pipe equally for all seats. A scramble already connecting the ports is rejected. Scores and disconnected flags persist.

After 60 ready ticks, five 210-tick routing windows alternate with 30-tick reveals. The last routing tick accepts input before reveal. All simultaneous first finishers earn the same award; there is no seat-order priority. Early completions cannot shorten another player's window. A complete round ends on tick 1260. Post-round steps advance k without scoring. All-disconnected ends on the next step. `disconnect(index)` permanently excludes that seat from input, scoring and winning; arrays retain its slot and subsequent rounds keep it inactive. A one-player simulation works.

The engine owns lobby, invites, hosting, fixed tick, transport and round advance. No custom lobby DOM or netcode.

## Design checklist / author audit

- Ten-second explanation: connect inlet to outlet; arrows/stick select, Space/TURN rotates. State-specific HUD tells you what to do.
- Local identity: double white cursor brackets and a diamond on your medallion every frame, including result states; rivals have names. Spectators have an explicit next-match message.
- Feedback: movement and rotation events have short sounds, selected tile and lasting rotation flash; a score has a water burst, richer local sound and persistent solved badge. No damage/death mechanic applies.
- Priority: the personal 3×3 board is the largest object. Inlet/outlet and the broad deadline bar are visible on a phone. Blocked ports use a cross as well as colour.
- Nobody sits out: no elimination, seven-second puzzle windows, a fixed 42-second round. A finished player watches rivals briefly. Disconnected HUD is explicitly handled.
- Comeback: puzzles four and five score double; target requires a clear lead.
- Two/eight: identical puzzles with independent cursors; eight rival medallions fit two rows, while the personal board stays the same size. A spectator sees seat zero's board. No crowded moving names.
- Phone: every input has a keyboard binding and a touch source. Stick and TURN are at least 96px. No fixed CSS width exceeds 328px; arena size belongs to the engine and has a viewport-height cap. Scores wrap into two columns.
- Contrast: dark text on pale panels; pale text and all eight enamel colours on deep bottle canvas. Player colour is supplemented by name and local shape. Nothing differs by red versus green alone.
- Sound: every event mapped to a documented engine sound; local events use `only: "me"`; rising puzzle stakes raise pitch. Muted play has all the same information.
- Own look: sea-glass plumbing, editorial masthead and enamel pipework, not a reskin of any catalog game.

These are source/design audits, not claims of visual or browser validation. Actual check results will be recorded below. Browser, screenshot, touch, full conformance, soak and production checks remain **pending** in this browserless job.

## Checks / shared notebook

Completed in this job on 2026-11-22:

- `cd weekly-2026-11-22 && RECORD=1 node test/game.test.mjs`: recorded the fixture after the final rule change; all 18 tests passed.
- `cd weekly-2026-11-22 && node test/game.test.mjs`: all 18 tests passed. Scenarios cover reciprocal pipe ports, exact first-flow scoring, simultaneous finishes, double finales, the final input tick, cursor repetition, held input across phase boundaries, fixed round duration, disconnects and winner eligibility. Engine shape, frozen/zero input, one-player safety, 100 generated solvable scrambles, seed equality, replay, and full-round 1–8-player codec/budget checks also pass.
- `node /app/check_game.mjs . weekly-2026-11-22`: passed on engine 1.0.2, schema `2b91b60d`, reported 40 bytes/player against 100. Fixture: 3,783 records, three completed rounds, final tick 1260, scores 147/84/84/84.
- `node scripts/conformance.mjs weekly-2026-11-22 --static`: all 18 rows passed. 22 unique page roles; one stick and one valid touch button. Full eight-player snapshot 158 B against 800 B; reference peak 106 B / 400 B, mean delta 15.2 B.
- `node /tmp/tideglass-check.mjs`: supplemental non-browser smoke test passed. Loaded the actual client configuration and reviewer bot, simulated full matches at every count from 1 through 8, used three-tick-delayed guest snapshots, and exercised all seated and spectator draws, result labels, score rows and the inactive HUD. Every match ended with a winner after two complete rounds; every bot scored (98 for the first seat, 56 for the other seats). 2,634,126 finite/range-checked surface calls; peak encoded snapshot 158 B. Verified the import map byte-for-byte against the resolved scaffold. The temporary helper's first assertion used the wrong template placeholder names; corrected the helper and reran successfully.
- `node /tmp/tideglass-audit.mjs`: verified all three input fields have keys and touch sources; every event has a documented sound; no fixed CSS width exceeds 328px; hidden and stick-position rules remain. Checked representative text/background pairs at ≥4.51:1 and all eight player colours against the canvas at ≥6.84:1. State is also conveyed by names, brackets, diamonds, crosses and checkmarks.
- `node --check weekly-2026-11-22/test/bot.mjs` and `node --check weekly-2026-11-22/public/client.js`: passed. Bot uses visible pipe geometry, varies reaction/click tempo by seat, and releases between rotations.

These mocks validate code paths, not visuals, transport or actual touch. Browser screenshots, human gameplay, phone controls at 360px, full conformance, soak, two/eight-player browser sessions, late join behavior and production checks remain **pending**: this job has no browser. The source audit above addresses every item of AGENTS.md section 6; its visual claims still need reviewer confirmation. All coordinator-owned files and root catalogs were left untouched. No deployment, commit or credential access was attempted.

From repository root:

```sh
(cd weekly-2026-11-22 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-11-22 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-11-22
node scripts/conformance.mjs weekly-2026-11-22 --static
```

Reviewer: `node scripts/play.mjs weekly-2026-11-22 --phone --rounds 3 --shots /tmp/tideglass-shots`, then two players (`--guests 1`), eight (`--guests 7 --no-late`) and actual touch (`--no-bot --phone`). Inspect the screenshots, including a late spectator and round results.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator registers both catalogs; the superapp reads root **public/games.json**, not the automation catalog. Keep `url: null` until deployment reads the actual URL from Wasmer. The coordinator adds `/weekly-2026-11-22/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-11-22 super
```

This deploys the game, records its actual URL and redeploys the superapp. Scaffold-owned files, catalogs, commits, pushes, pull requests and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
