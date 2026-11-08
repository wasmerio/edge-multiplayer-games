# Copper Nine

Rotate nine copper circuits to light every lamp before your friends. A spatial network puzzle for 2–8 players: no movement arena, memory sequence, auction, or timing drop.

## Rules

Everyone receives the same scrambled 3×3 circuit. Power enters the upper-left tile from the left. Select tiles and turn them clockwise; touching pipe ends carry power. Light all nine tiles to complete the board. Completion earns 5 points, plus 2 for the earliest completion tick (simultaneous finishes share the bonus). The circuit then locks so the result cannot be accidentally undone. At the 30-second deadline, unfinished boards earn 1 point for 3–5 lit lamps, or 2 for 6–8. A unique connected leader at 20 points wins at round end; ties continue. A fresh board opens each round. Players behind the match leader start with the centre tile correctly oriented, marked with four small rivets. No one is eliminated; even an unfinished board can score.

Arrow keys or WASD select a tile; Space turns it. On phones, use the thumb stick and TURN button. Enter advances the host to the next board. Input latency is inherent to host authority; this is a friends game, not a ranked contest.

## Visual identity

- Palette: pale mint enamel `#dcece2`, deep petrol `#123936`, warm white `#fff8e8`, copper `#dfa47d`, powered filament `#ffe08a`. Faults use a jagged gap and vermilion `#ff7868`, never red versus green alone.
- Player colours: eight pastel enamel finishes (mint, apricot, lilac, sky, butter, rose, pearl and periwinkle), readable on petrol.
- Typography: rounded system headings (`ui-rounded`, `SF Pro Rounded`, `Trebuchet MS`, `Segoe UI`, sans-serif); system monospace labels and counters. No remote fonts or art.
- Layout: a repair-shop instruction placard beside an enamel registration panel. Play places one large personal circuit above a compact two-column bank of rival lamps, then the HUD, thumb controls and ledger. The fixed 640×620 board keeps tiles large even with eight seats.
- Copy: friendly, practical workshop instructions. Goal and controls precede flavour.
- Canvas art: rounded enamel tile wells, thick copper traces with dark insulation, lit glass bulbs, a striped power inlet, corner brackets identifying the local board and a double outline identifying the local progress badge. Counters reconstruct every lasting effect; only sparks are cosmetic. Reduced motion suppresses sparks and shake.

## Input

`INTENT = { mx: -1..1, my: -1..1, turn: 0 | 1 }`, all neutral at zero. ArrowLeft/Right or A/D drive mx; ArrowUp/Down or W/S drive my. Gamepad axes 0/1 and `data-engine-stick="mx,my"` do the same. Navigation moves immediately on direction change and repeats every 7 ticks; horizontal wins a diagonal. Space or gamepad button 0 and `data-engine-touch="turn=1"` turn the selected tile once on a press edge. Holding never turns repeatedly. Input edges are tracked during countdown and after completion. Missing or numeric-zero intents are neutral; the engine's frozen intents are never mutated.

## Snapshot

Every field is returned on every step. There are no moving world positions: geometry is fixed, rotations are discrete, and no interpolation is needed. A snapshot alone reconstructs the complete visible board; no solution or history is needed by draw.

| Field | Type | Meaning |
|---|---|---|
| k | uint32 | Stream tick, advances on every call including countdown and post-round |
| over | bool | Round ended |
| ready | uint8 | Opening countdown, 60 ticks |
| left | uint16 | Active ticks remaining, 900 max |
| tiles | uint8 × 9 | Shared scrambled pipe masks, N/E/S/W bits 1/2/4/8 |
| rot | uint32 per player | Nine two-bit clockwise rotation counts |
| cursor | uint8 per player | Selected tile 0–8 |
| lit | uint16 per player | Nine-bit mask of lamps reachable from the inlet |
| done, active, assist | bool per player | Completed; connected; received centre-tile starter aid |
| flash | uint8 per player | Ticks of turn feedback remaining |
| award | uint8 per player | Points earned on this board |
| claimed | bool | First completion bonus has been claimed |
| moved, turned, solved, scored | players | One-tick selection, rotation, completion, and point events |
| beep, go, finished | bool | One-tick countdown beat, live start, deadline |

The codec uses the default 100 bytes/player/tick budget. Sound maps every event; selection/rotation effects use flash/cursor/rot, scoring sparks use ctx.events. Disconnected seats remain in all arrays.

## Round lifecycle

`startRound()` increments round, resets tick, countdown, timer, cursors, rotations, lamps, completion flags, awards and input edges. It grows a random spanning tree of the nine tiles using only the injected RNG, attaches the inlet, then scrambles each tile with that RNG. Trailing players get the centre's inverse scramble. Scores and disconnected flags persist. An accidentally complete scramble is perturbed before play.

After 60 countdown ticks, exactly 900 active ticks accept selection and rotation. All seats are processed before assigning the first-finish bonus, so seat order cannot break ties. Solved boards lock until the next round. At the deadline partial points are awarded once and roundOver becomes true. With no connected seats, the next step ends the round without scoring. Post-round calls advance k but cannot score again. disconnect(index) permanently excludes the seat from input, awards and winner checks, including later rounds. One player is safe even though the lobby requires two. The host advances with Enter or the button; the engine owns the lobby, invites, transport and round advance.

## Design checklist / review notebook

Design review against AGENTS.md §6:

- Ten-second goal and controls appear in lobby; HUD gives the next action for playing, complete, disconnected, spectator and host/guest results.
- Local circuit has corner brackets and local badge has a double ring every frame; rivals have names and numbered badges.
- Selection and turn events answer with sounds and visible cursor/trace changes; points and completion have sparks and separate sounds.
- The important object is the personal nine-tile circuit, not eight tiny boards. The deadline is a broad bar.
- No elimination; completed players wait at most 30 seconds. Spectators are told they receive a seat next match.
- Trailing players receive a correctly oriented centre; winner needs a clear lead.
- A round lasts 32 seconds including countdown; the result persists until the host advances.
- Two through eight share the same puzzle and fixed board. Progress badges use two columns; names never overlap tiles.
- Light/dark traces, broken gaps, outlines and labels distinguish state without red/green alone.
- Touch stick and TURN are at least 96px; narrow layout puts board and controls before the two-column scoreboard.
- Every event has sound; remaining time raises pitch. Muted play retains all information.
- Mint enamel, copper traces, glass lamps and rounded type provide the game's own look.

Completed in this job on 2026-11-08:

- `cd weekly-2026-11-08 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final rule change; all 17 tests passed.
- `cd weekly-2026-11-08 && node test/game.test.mjs`: all 17 passed. Scenarios cover reciprocal wiring, exact completion and partial awards, simultaneous bonuses, last-tick completion, input edges, repeat timing, countdown, disconnects, starter aid, winner ties, one player, frozen zero intents, codec round-trips, seeded solvability and replay.
- `node /app/check_game.mjs . weekly-2026-11-08`: passed on engine 1.0.2, schema `15e3a0e8`, 39 bytes/player against 100. Fixture: 2,883 records, three complete rounds, final tick 960, scores 21/15/15/5.
- `node scripts/conformance.mjs weekly-2026-11-08 --static`: all 18 rows passed; 22 distinct roles, one valid touch button and one stick. Full eight-player snapshot 132 B / 800 B. Reference maximum 96 B / 400 B; mean delta 18.9 B.
- `node /tmp/copper-check.mjs`: supplemental non-browser smoke test passed. Ran the actual bot and renderer for every player count 1–8, with three-tick-delayed guest snapshots, seated and spectator views, host/guest results, and a disconnected seat. Every configuration completed three 960-tick rounds, every bot scored, and seat 0 won at 21 points. Checked 1,512,922 finite/range-safe surface calls, scoreboard rows, result labels, event sound coverage, all keyboard/touch fields, and the byte-identical resolved import map. Peak encoded snapshot was 132 B. An initial assertion in this temporary script used the wrong scaffold placeholder spelling; it was corrected and rerun. This is not visual or transport validation.
- `node /tmp/copper-style-check.mjs`: checked declared fixed widths (none above 328px), principal text/background pairs (minimum contrast 5.37:1), and all eight player colours against the canvas (minimum 6.52:1). No red/green-only distinctions: numbered badges, local double rings, lit/dark pipes, broken-end chevrons and text states accompany colour.
- `node --check weekly-2026-11-08/test/bot.mjs` and `node --check weekly-2026-11-08/public/client.js`: passed.

Source audit: all three INTENT fields have keyboard and touch input. All seven event fields have sounds; moved/turned update cursor and feedback, solved/scored emit bursts or point floats, beep reads the countdown, go and finished burst. draw handles spectator seat −1 and counts 1–8; HUD covers every applicable state, including a closed bench (there is no elimination rule). Cosmetic clocks use ctx.time/dt and reset in onRound. The local marker persists through completion and results. The phone layout puts the 112px controls directly below the board and HUD; names and score rows have overflow constraints. Every section-6 design item is addressed above, but actual visual quality is not claimed verified.

Browser screenshots, full conformance, soak, two/eight-player play, actual touch controls, late spectators and production checks remain **pending**: this job has no browser. No deployment or credential access was attempted. Coordinator-owned files and root catalogs were left unchanged.

Reviewer commands from the repository root:

```sh
node scripts/play.mjs weekly-2026-11-08 --phone --rounds 3 --shots /tmp/copper-nine-shots
node scripts/play.mjs weekly-2026-11-08 --guests 1 --rounds 2
node scripts/play.mjs weekly-2026-11-08 --guests 7 --phone --rounds 2 --no-late
node scripts/play.mjs weekly-2026-11-08 --no-bot --phone
node scripts/conformance.mjs weekly-2026-11-08
node scripts/soak.mjs weekly-2026-11-08 --duration 60
```

Open and judge the desktop, phone, late-round, result and spectator screenshots. The self-contained bot solves only the visible scrambled pipe masks through `info.game.solveBoard`, then taps keyboard navigation and rotation with different pacing per seat. It does not read a hidden solution.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator updates both catalogs; the superapp reads root **public/games.json**. Its entry keeps `url: null` until deployment obtains the actual Wasmer URL. The coordinator adds `/weekly-2026-11-08/` to root `.wasmerignore`. After merge:

```sh
./deploy.sh weekly-2026-11-08 super
```

This deploys the game, records its actual URL, and redeploys the superapp. Root catalogs, protected scaffold files, commits, pushes, PRs and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
