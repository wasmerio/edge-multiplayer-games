# Short Fuse

Hot-potato tag with a live bomb: pass it by touch before the fuse burns out, and haunt the survivors after you pop.

Built on the repository's browser game engine (`engine/README.md`). The engine
owns behaviour: the lobby logic, the networking, the loop, the invite link and
`/healthz`. The game owns its page and its stylesheet.

| Path | Role |
|---|---|
| `public/game.js` | The simulation, `SNAPSHOT`, `INTENT`, `ARENA`, `TARGET` and every tuning constant. Headless. |
| `public/client.js` | The `startGame` call: bindings, sound, labels, the live scoreboard and the `draw` function. |
| `public/index.html` | The page: markup and copy, with `data-engine` roles the engine binds to. |
| `public/style.css` | The look: demolition-yard signage in warm black, kraft and hazard amber. |
| `src/server.js` | One `serveGame` call. |
| `test/` | Scenario tests, the scripted reference match and its replay fixture. |

## Rules

One player holds a lit bomb. Touching another living player hands it over.
When the fuse runs out the holder pops, every survivor scores one point, and
the bomb is lit again on a random survivor with a shorter fuse. The last one
standing scores one more point and the round ends. The first player to reach
`5 × players` points with a clear lead wins the match.

| Rule | Value | Why |
|---|---|---|
| Arming | 45 ticks (1.5 s) in which the bomb cannot pass | Runners get time to scatter; nobody is tagged at the spawn |
| Holder speed | 1.14 × a runner | A chase must be winnable, but cover and a dash can still shake it |
| Dash | 6 ticks of burst, 45 ticks of cooldown, on the press edge | The one skill button: a lunge for the holder, an escape for a runner |
| Receiver daze | 14 ticks without movement | The passer gets away; the pass has a visible beat |
| Passer shield | 30 ticks during which the bomb cannot return to the passer | No tag-backs |
| Fuse | `150 + 30 × min(alive, 5)` ticks plus 0 to 105, drawn from the seeded generator | Shorter with fewer runners left |
| Overtime | 0 to 75 hidden ticks after the visible fuse is gone | Nobody can count the bomb out |
| Blast | Pushes survivors inside 150 px away; 42 ticks of aftermath | Feedback, and a moment to read the score |
| Ghost | A popped player keeps moving, through cover, and the dash becomes a BOO: a shove on everyone inside 110 px, every 4 s | Nobody sits out a round |

Cover is four pillars (five on the larger board for five players and more),
derived from the arena by `pillars()` so it needs no snapshot field.

## Input

Three fields per player per tick, sent only when they change:
`{ mx: -1 | 0 | 1, my: -1 | 0 | 1, dash: 0 | 1 }`.

| Field | Meaning | Sources |
|---|---|---|
| `mx`, `my` | Movement direction; a diagonal is normalised | WASD, arrow keys, gamepad axes 0 and 1, the thumb stick on a phone |
| `dash` | Dash while alive, BOO as a ghost; acts on the press edge | Space, Shift, J, gamepad button 0, the DASH touch button |

The thumb stick is the page's own element, marked
`data-engine-stick="mx,my"`; the engine turns a drag into the two fields.
Space is the dash, so the host's next-round key is Enter (`nextKey`).

## Snapshot

Declared in `SNAPSHOT`; the engine derives the binary codec and the deltas.
125 bytes in full at eight players.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick within the round |
| `over` | bool | The round has ended |
| `ph` | uint8 | Phase: 0 arming, 1 live, 2 overtime, 3 blast aftermath, 4 done |
| `t` | uint8 | Ticks left in the arming, overtime or aftermath phase |
| `holder` | int8 | Seat that holds the bomb, −1 for nobody |
| `fuse`, `fuseMax` | uint16 | Visible fuse ticks left and at lighting; the bar is their ratio |
| `x`, `y` | fixed, one decimal, per player | Position, interpolated on guests |
| `alive` | bool per player | False for a ghost |
| `stun`, `safe`, `dashing` | bool per player | Dazed receiver, shielded passer, mid-dash |
| `cd` | uint8 per player | Dash (or BOO) cooldown ticks left |
| `bx`, `by`, `bAge` | uint16, uint16, uint8 | Last blast position and its age in ticks (255 for none); drives the explosion, the shake and the scorch mark |
| `pAge` | uint8 | Ticks since the last pass (255 for none); drives the pass flash |
| `d` | player list | Event: who popped this tick |
| `pass` | player list | Event: who received the bomb this tick |
| `arm` | player list | Event: who a newly lit bomb landed on |
| `dash`, `boo` | player lists | Events: who dashed, which ghost shoved |
| `tk`, `hot` | player lists | Events: a fuse tick (the interval shrinks from 28 to 4 ticks) and an overtime tick; they carry the holder |

Everything that is drawn comes from these fields. Effects that outlive one
tick read an age (`bAge`, `pAge`, `cd`). The event lists drive `audioMap`,
and `ctx.events("d")` leaves one scorch mark per pop. The scoreboard hook
reads `alive` and `holder`, so its rows follow the round as it is played.

## Round lifecycle

`startRound()` adds one to `round`, resets the tick, puts every player who has
not left on a ring around the centre at a seeded angle, clears the blast and
pass ages, and lights a bomb on a random player. Scores persist.

Within a round the phases repeat: arming, live, overtime, blast aftermath. If
two or more players are alive after the aftermath, a new bomb is lit.
`roundOver` becomes true when the aftermath ends with fewer than two alive, so
the last explosion is seen before the banner. The host starts the next round
with Enter or the Next round button.

`winner(target)` returns the seat with the unique highest score once it has
reached the target, `5 × players`; a tie at the top plays another round.

`disconnect(index)` removes a player for good: they stay out of later rounds,
and a bomb in their hands is lit again on someone else.

## Commands

```bash
npm test                                # scenarios, budget, replay fixture
RECORD=1 npm test                       # re-record test/replay.ndjson after a rule change
node ../scripts/dev.mjs fuse            # run locally against this checkout's engine
node ../scripts/play.mjs fuse --phone --rounds 3 --shots /tmp/fuse-shots   # test/bot.mjs plays three rounds; screenshots are saved
node ../scripts/conformance.mjs .       # the sub-app contract, every row
```
