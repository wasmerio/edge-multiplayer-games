# {{name}}

{{description}}

Built on the repository's browser game engine (`engine/README.md`). The engine
owns behaviour: the lobby logic, the networking, the loop, the invite link and
`/healthz`. The game owns its page and its stylesheet.

| Path | Role |
|---|---|
| `public/game.js` | The simulation, `SNAPSHOT` and `INTENT`. Headless. |
| `public/client.js` | The `startGame` call: bindings, sound, labels, scoreboard and `draw`. |
| `public/index.html` | The page: markup and copy, with `data-engine` roles the engine binds to. |
| `public/style.css` | The look. Theme properties are at the top. |
| `src/server.js` | One `serveGame` call. |
| `test/` | Scenario tests, the reference match and its replay fixture, and `bot.mjs`, the bot `play.mjs` plays with. |

## Input

Three fields per player per tick, sent only when they change:
`{ mx: -1..1, my: -1..1, boost: 0 | 1 }`.

| Field | Meaning | Sources |
|---|---|---|
| `mx`, `my` | Movement direction; a diagonal is normalised | WASD, arrow keys, gamepad axes 0 and 1, the thumb stick on a phone |
| `boost` | A short burst, on the press edge, with a cooldown | Space, left Shift, gamepad button 0, the BOOST touch button |

## Snapshot

Declared in `SNAPSHOT`; the engine derives the binary codec and the deltas.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick within the round; advances during the countdown too |
| `over` | bool | The round has ended |
| `ready` | uint8 | Countdown ticks left before players may move |
| `left` | uint8 | Pellets left in the round |
| `x`, `y` | fixed, one decimal, per player | Position, interpolated on guests |
| `cd` | uint8 per player | Boost cooldown ticks left; also drives the boost ring |
| `px`, `py` | uint16 | Pellet position |
| `took` | player list | Event: who took a pellet this tick |
| `boosted` | player list | Event: who started a boost this tick |
| `beep`, `go` | bool | Events: a countdown second starts; the round goes live |

Effects that last longer than one tick read a counter (`cd`, `ready`). One-shot
effects and sounds read the event fields.

## Round lifecycle

`startRound()` adds one to `round`, resets the tick, places every player on a
ring at a seeded angle, places the first pellet and starts a countdown of
{{ready}} ticks. A player that reaches the pellet scores one point and a new
pellet appears. `roundOver` becomes true after {{pellets}} pellets. The host
starts the next round with Enter or the Next round button. `winner(target)`
returns the seat with the unique highest score once it has reached the target.
`disconnect(index)` keeps the seat in every array and stops moving it.

## Commands

```bash
npm test                                # scenarios, budget, replay fixture
RECORD=1 npm test                       # re-record test/replay.ndjson after a rule change
node ../scripts/dev.mjs {{slug}}        # run locally against this checkout's engine
node ../scripts/play.mjs {{slug}} --phone --rounds 3 --shots /tmp/{{slug}}-shots   # test/bot.mjs plays three rounds; screenshots are saved
node ../scripts/conformance.mjs .       # the sub-app contract, every row
```
