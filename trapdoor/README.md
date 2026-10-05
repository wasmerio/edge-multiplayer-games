# Trapdoor

Stand on the called shape before the floor drops; shove your rivals into the pit.

Built on the repository's browser game engine (`engine/README.md`). The engine
owns behaviour: the lobby logic, the networking, the loop, the invite link and
`/healthz`. The game owns its page and its stylesheet.

| Path | Role |
|---|---|
| `public/game.js` | The simulation, `SNAPSHOT`, `INTENT`, `ARENA`, `TARGET`, `layout()` and every tuning constant. Headless. |
| `public/client.js` | The `startGame` call: bindings, sound, labels, the live scoreboard and `draw`. |
| `public/index.html` | The page: markup and copy, with `data-engine` roles the engine binds to. |
| `public/style.css` | The look: a cut-paper floor show. Cream paper, ink outlines, six plate colours; red is the pit and nothing else. |
| `src/server.js` | One `serveGame` call. |
| `test/` | Scenario tests, the scripted reference match and its replay fixture. |

## Rules

The floor is a grid of plates, each with one of up to six shapes. A shape is
called and a clock runs. When it runs out, every plate that does not show the
called shape opens for 1.2 s. Whoever has their centre over an open plate
falls. The floor then reshuffles and the next call starts, with a shorter
clock, fewer called plates and more kinds of shape.

| Rule | Value | Why |
|---|---|---|
| Score | +1 to everyone still standing for each rival that falls; +2 to the last one standing | Every fall is felt by everyone, at once |
| Match | First to `3 × (players + 1)` with a clear lead | About three round wins at any player count |
| Clock | `max(45, 126 − 11 × drop)` ticks: 4.2 s down to 1.5 s | Calm first call, frantic eighth |
| Called plates | 34 % of the floor on the first call, down to 8 %, then one fewer per call; never fewer than one per three standing players | Musical chairs: the plates run out |
| Shapes | 4 kinds, 5 from the third call, 6 from the fifth | The search gets harder, not only shorter |
| Dash | 6 ticks at 30 units, 50 ticks of cooldown, on the press edge | The one skill button |
| Shove | A dash that lands knocks the rival about 0.9 of a plate | Enough to clear a plate, or to fill a pit |
| Bodies | Standing players are solid and push each other apart | A crowded plate is a fight |
| Pits | Open for the whole 1.2 s; walking, dashing or being shoved into one is a fall | The drop is the round's big moment, not one tick |
| Fallen | Keep flying over the floor. The button cracks the called plate under you: it opens with the rest. One crack per call, not in the last second, never the last intact called plate | Nobody sits out; survivors must read the floor twice |
| Crown | The match leader wears it and runs 8 % slower | The leader can be caught |
| Board | 6×4 plates for up to 3 players, 7×5 for up to 5, 8×6 for up to 8 | Two have a game; eight fit on a phone |
| Cap | A round ends after 20 drops | A round always ends |

The floor of a call is not in the snapshot. `layout(seed, tiles, nsym, sym, safe)`
rebuilds it on every peer from five snapshot fields, so 48 plates cost 7 bytes.

## Input

Three fields per player per tick, sent only when they change:
`{ mx: -1..1, my: -1..1, act: 0 | 1 }`.

| Field | Meaning | Sources |
|---|---|---|
| `mx`, `my` | Movement direction; a diagonal is normalised | WASD, arrow keys, gamepad axes 0 and 1, the thumb stick on a phone |
| `act` | On the press edge. Standing: dash, in the direction last moved. Fallen: crack the plate underneath | Space, left Shift, X, gamepad button 0, the DASH / CRACK touch button |

Space is an action, so the host's next-round key is Enter.

## Snapshot

Declared in `SNAPSHOT`; the engine derives the binary codec and the deltas.
31 bytes plus 9 per player.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick within the round; advances during the countdown too |
| `over` | bool | The round has ended |
| `phase` | uint8 | 0 countdown, 1 call, 2 drop (pits open), 3 done |
| `ready` | uint8 | Countdown ticks left |
| `t`, `tMax` | uint8 | Ticks left in the call or the drop, and its length: the clock bar |
| `drop` | uint8 | Calls completed this round; raises the pitch of the sounds |
| `seed`, `sym`, `nsym`, `safe` | uint32, uint8 × 3 | The floor of this call: `layout()` input. `sym` is the called shape |
| `last` | int8 | The last one standing, or −1; the round banner reads it |
| `lead` | int8 | The crowned seat for this round, or −1 |
| `x`, `y` | fixed, one decimal, per player | Position, interpolated on guests |
| `st` | uint8 per player | 0 standing, 1 fallen, 2 left the match |
| `fa` | uint8 per player | Age: ticks since the fall (255 = never); the fall animation |
| `ha` | uint8 per player | Age: ticks since shoved (255 = never); the hit flash |
| `cd` | uint8 per player | Dash cooldown ticks left; the cooldown ring and the dash streak |
| `crack` | uint8 per player | The plate this fallen player cracked in this call, or 255 |
| `fell`, `dashed`, `shoved`, `cracked`, `denied`, `pt`, `won` | player lists | Events: fell in; started a dash; was shoved; cracked a plate; a crack was refused; scored for outlasting; is the last one standing |
| `beep`, `go`, `call`, `tk`, `open` | bool | Events: countdown second; round live; a new call; clock tick in the last 1.2 s; the pits open |

Effects that last longer than a tick read `phase`, `t`, `fa`, `ha`, `cd` and
`crack`. One-shot effects and sounds read the event fields.

## Round lifecycle

`startRound()` adds one to `round`, resets the tick, the phase and the drop
count, crowns the unique match leader, and puts every seated player on an
oval around the middle at a seeded angle. A countdown of 75 ticks follows, in
which everybody can already move. Then calls and drops alternate.

`roundOver` becomes true at the end of the drop in which at most one player
is left standing (none, with a single player), or after 20 drops. If a
disconnect leaves one player standing during a call, the round ends on the
next tick and that player takes the bonus.

`winner(target)` returns the seat with the unique highest score once it has
reached the target, `3 × (players + 1)`. The host starts the next round, or
the next match, with Enter or the button.

`disconnect(index)` marks the seat as gone: it stays in every array, does not
move, cannot fall or score, is not drawn, and is not placed in later rounds.

## Design checklist

Every item of `AGENTS.md` section 6 holds. Two notes: the board is the same
landscape grid on every peer, so on a 360 px phone an 8×6 floor has 41 px
plates and 16 px pawns; and with two players nobody haunts, because the first
fall ends the round.

## Commands

```bash
npm test                                # scenarios, budget, replay fixture
RECORD=1 npm test                       # re-record test/replay.ndjson after a rule change
node ../scripts/dev.mjs trapdoor        # run locally against this checkout's engine
node ../scripts/play.mjs trapdoor --phone --rounds 3 --shots /tmp/trapdoor-shots   # test/bot.mjs plays three rounds; screenshots are saved
node ../scripts/conformance.mjs .       # the sub-app contract, every row
```
