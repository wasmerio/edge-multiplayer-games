# Copper Current

Rotate pipe fittings to carry water through all nine tiles, racing friends for first-clear bonuses in a forty-second repair sprint. A spatial connection puzzle for 2–8, not a memory, timing, movement, auction or survival game.

## Rules

Everyone receives the same sequence of scrambled 3×3 pipe panels. Water enters the top-left tile from the left and must leave the bottom-right tile to the right **after visiting all nine tiles**. Select a fitting with arrows/WASD and tap Space to turn it clockwise. Lit pipes show exactly how far water reaches; loose ends have a coral cross. There is no submit button: a completed connection scores automatically.

A repair earns 3 points. The first player to repair each panel earns +1 (same-tick finishers share it). A player at least 6 match points behind the connected leader earns +1 catch-up point on a repair, evaluated before that tick's awards. After a 24-tick water-flush celebration, the next panel appears. Everyone can keep repairing until the forty-second clock expires. No elimination or lives. A unique connected leader at 32 points wins at round end; tied leaders play another sprint. Guest latency can affect a first-clear bonus; this is a friends game, not a ranked service.

## Visual identity

- Palette: petrol enamel `#123b40`, deeper recess `#09282d`, pale porcelain `#e8f4eb`, copper `#efb17a`, water cyan `#78e5f1`. Coral `#ff8173` exclusively marks a broken connection or urgent clock, always with a cross or time label.
- Eight seat colours: pale copper, ice blue, lavender, butter yellow, pink, mint, periwinkle and white. Every seat has a number/name; local identity adds a diamond and double selection bracket.
- Typography: rounded system stack (`ui-rounded`, `SF Pro Rounded`, `Hiragino Maru Gothic ProN`, `Arial Rounded MT Bold`, `Trebuchet MS`, `Segoe UI`, sans-serif), with the documented monospace stack for gauge digits. No remote fonts or art.
- Layout: a compact pump-console masthead, large plumbing diagram and repair ticket in the lobby. In play, a large personal panel and eight named rival gauges in one fixed 640×560 canvas; HUD, two thumb controls, then a compact score ledger. A spectator sees the first connected seat's board.
- Tone: cheerful, practical repair-shop instructions. The goal and controls come before flavour.
- Canvas: rounded enamel tile recesses, layered copper pipe strokes, bright moving water dots, screw heads, tank gauges and a porcelain selection diamond. No borrowed game theme. Reduced motion disables particles and decorative water movement.

## Input

`INTENT = { mx: -1..1, my: -1..1, turn: 0|1 }`.

| Field | Keyboard / gamepad | Touch | Meaning |
|---|---|---|---|
| mx | Left/A, Right/D; axis 0 | Thumb stick horizontal | Move cursor one column on change; hold repeats every 7 ticks |
| my | Up/W, Down/S; axis 1 | Thumb stick vertical | Move cursor one row on change; hold repeats every 7 ticks |
| turn | Space or X; button 0 | TURN button | One clockwise quarter turn per press edge |

Horizontal wins when both directions are held. Cursor movement clamps at panel edges. Inputs are tracked during countdown and flush so holding Turn never rotates a new panel accidentally. Missing or numeric-zero intents are neutral; the frozen engine intent array is never written. Enter advances the host to the next round.

## Snapshot

The entire visible board is rebuilt from packed pipe types and orientations. No moving simulation positions are needed, and no field interpolates. Geometry scales from `opts.arena` / exported `ARENA` (640×560). All fields are emitted every tick.

| Field | Type | Meaning |
|---|---|---|
| k | uint32 | Stream tick, advances on every step, including countdown and post-round |
| over | bool | Sprint ended |
| ready | uint8 | Opening countdown, 60 ticks |
| left | uint16 | Active ticks left, initially 1200 |
| last | int8 | Unique round points leader, or -1 on a tie |
| shape | uint16 per player | Nine bits; 1 is an elbow, 0 a straight |
| pipes | uint32 per player | Nine two-bit clockwise orientations |
| wet | uint16 per player | Bitset of tiles reached by water |
| cursor | uint8 per player | Selected tile 0–8 |
| level | uint8 per player | Zero-based panel number |
| flush | uint8 per player | Successful panel celebration ticks remaining |
| flash | uint8 per player | Turn-feedback ticks remaining |
| award | uint8 per player | Last repair's points |
| total | uint16 per player | Points earned this sprint |
| active | bool per player | Still connected |
| moved, turned, repaired, loaded | players | One-tick cursor, rotation, scoring and new-panel events |
| beep, go, hurry, finished | bool | One-tick countdown beat, live start, last-five-second beat, round end |

The first-clear claim table and future panels are simulation-only: neither is needed to draw a current frame. All randomness is from the constructor's injected RNG. Events feed sounds and `ctx.events`; persistent effects use flush/flash/award/wet. Budget stays 100 bytes per player per tick.

## Round lifecycle

`startRound()` increments round, resets tick, ready, left, input edges, panel sequence/claims and per-round points, and gives every connected seat the identical first panel. Scores and disconnected flags persist. Each generated panel chooses a Hamiltonian route using the injected RNG, then independently scrambles the orientations; an already solved scramble is rejected by rotating its first tile.

Each live tick handles movement and rotation, computes the connected water route, gathers all repairs, then awards using pre-tick scores and claims so seat order never breaks a tie. A 24-tick flush prevents repeat awards and then loads the next panel. The final live tick accepts a repair before closing. `roundOver` becomes true at tick 1260, or on the next step after all seats disconnect. Post-round steps only advance k. `winner(target)` excludes disconnected seats and needs a unique leader at target. `disconnect(index)` leaves arrays intact but removes that seat from input, scoring, future rounds and victory.

The engine owns lobby, hosting, invitations, transport, timing, interpolation and round advance. No custom netcode or DOM lobby logic.

## Design checklist / review notebook

- Clear in ten seconds: lobby goal and controls, state-specific HUD; no hidden answer or tutorial required.
- Local identity: double cursor outline and diamond every frame, plus marked score row. Rivals have distinct named gauges.
- Action feedback: movement ticks, turn clicks and lasting rotation flash; scoring water flush, particles and chirp; new-panel sound. Own events receive richer sound/effect.
- Important thing largest: the local nine-tile panel occupies most of the canvas; thick water path and clock are readable on a phone.
- Nobody sits out: no elimination, continuous puzzles, 40-second active round; spectators are told when they get a seat.
- Comeback: +1 per repair when at least six points behind; unique leader required to win.
- Short rounds: two-second countdown plus forty-second sprint; result remains until host Enter/button.
- Two/eight: identical personal panel size at every count; separate rival gauges avoid crowded names. One-player simulation is supported.
- Colour safety: water is thick and dotted, dry pipes hollow/dark, broken ends crossed; names and seat numbers supplement colour.
- Phone: 132px stick and 104px turn button, no fixed CSS width above 328px, engine-owned arena sizing with viewport-height cap. Actual screenshots still pending.
- Sound: each event mapped to a documented sound; urgency pitch rises; one finish chord. Muted play retains all information.
- Own look: petrol enamel/copper plumbing console and rounded lettering, distinct from existing catalog games.

### Completed checks (2026-11-15)

- `cd weekly-2026-11-15 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final rule change; all 17 tests passed.
- `cd weekly-2026-11-15 && node test/game.test.mjs`: all 17 passed. Scenarios cover exact countdown ticks, connected routes, a broken inlet, simultaneous bonus claims, catch-up scoring, input edges/repeat, flush transitions, final-tick awards, disconnect persistence, winner ties, one-player safety, frozen neutral inputs and full-round codec equality for every count from 1 to 8.
- `node /app/check_game.mjs . weekly-2026-11-15`: passed; engine 1.0.2, schema `651e4573`, reported 40 bytes/player against 100. Fixture: 3,783 records, three complete rounds, final tick 1260, scores 184/162/115/107.
- `node scripts/conformance.mjs weekly-2026-11-15 --static`: all 18 rows passed. 22 distinct roles, one valid stick and one valid touch button; 170 B full at eight players against 800 B. Reference peak 110 B / 400 B, mean delta 35.8 B.
- `node /tmp/copper-check.mjs`: supplemental non-browser smoke test passed. It exercised the actual bot, draw and scoreboard for three full sprints at **every player count 1–8**, with three-tick delayed guest snapshots, spectators and closed seats. All bots scored, every round ended at tick 1260 and every configuration reached a match winner. 4,186,199 surface calls passed finite/range checks; peak snapshot 170 B. Eight-seat scores after three sprints: 164/115/88/87/107/103/95/80. The import map matched the resolved scaffold byte-for-byte. The initial temporary assertion used different scaffold placeholder names; it was corrected to resolve `origin` and `version` and rerun successfully. This mock is not a browser or transport test.
- `node /tmp/copper-audit.mjs`: source/style audit passed. Reviewed text/background pairs have contrast at least 5.60:1; every player colour has at least 8.30:1 against the canvas recess. No explicit fixed width exceeds 328px. Every INTENT field has both a keyboard binding and touch coverage; every event has a documented sound mapping. Local markers, rival labels and all five HUD roles were checked against the source and exercised by the mock.

The board deliberately uses two full-route topologies, each independently scrambled at nine fittings; this is an accessible rotation race rather than a deep maze generator. Learning the route shapes is part of getting faster. The injected RNG alone selects and scrambles them.

Browser gameplay, screenshots at 360px, full conformance, soak, two/eight-player sessions, human touch, late joining over transport and production checks remain **pending** because this job has no browser. Phone layout is designed and source-audited, not visually verified. No credentials, deployment or Git configuration were accessed; coordinator-owned scaffold files and root catalogs were left untouched.

Reviewer commands from the repository root:

```sh
node scripts/play.mjs weekly-2026-11-15 --phone --rounds 3 --shots /tmp/copper-current-shots
node scripts/play.mjs weekly-2026-11-15 --guests 1 --rounds 2
node scripts/play.mjs weekly-2026-11-15 --guests 7 --phone --rounds 2 --no-late
node scripts/play.mjs weekly-2026-11-15 --no-bot --phone
node scripts/conformance.mjs weekly-2026-11-15
node scripts/soak.mjs weekly-2026-11-15 --duration 60
```

Open the screenshots and review the desktop, phone, spectator, late round and every result before approval. Test muted play and actual touch controls as well as bot keys.

## Registration and deployment

`game-entry.json` supplies metadata. The coordinator registers both catalogs; the superapp reads root **public/games.json** with `url: null` until the real Wasmer URL is known. The coordinator adds `/weekly-2026-11-15/` to root `.wasmerignore`. After merge:

```sh
./deploy.sh weekly-2026-11-15 super
```

This deploys the game, records its actual URL and redeploys the superapp. Protected scaffold files, catalogs, commits, pushes, PRs and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
