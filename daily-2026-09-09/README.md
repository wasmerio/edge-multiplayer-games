# Vault Tempo

A 2–8 player push-your-luck drilling race (solo practice also works). Drill a volatile vault, cool your tool, and bank your haul before it melts. Everyone shares the same rich-vein timing, but chooses their own risk. No falling objects, trails, or combat.

The game runs on the repository engine (`engine/`, pinned at `1.0.1` in `public/index.html`). The engine owns the lobby, signaling, WebRTC star, tick loop, snapshot codec, guest interpolation, input sources and lobby behaviour. This directory holds the simulation, the snapshot schema, the intent and the renderer.

## Contract

### Input

One intent field, `act`, declared as `INTENT` in `public/game.js`: `-1` bank, `0` cool, `1` drill.

| Source | Mapping |
|---|---|
| Keyboard | `ArrowLeft` banks, `ArrowRight` drills. Both together cancel to cool. |
| Touch | The page's `← Hold to bank` and `Hold to drill →` buttons (`data-engine-touch`), also usable with a mouse. |
| Gamepad | Axis 0. |

The engine sends the intent only on change, re-sends it on an interval, and releases it on blur. The simulation treats any other value as cool.

### Snapshot

Declared as `SNAPSHOT` in `public/game.js` and encoded by the engine codec at 30 Hz. Every frame redraws from one snapshot plus the lobby player table.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint16 | Elapsed round ticks, `0..900`. Tick field. |
| `over` | bool | The shift has closed. |
| `rich` | bool | The rich vein is open. |
| `vein` | uint8 | Ticks until the vein changes. |
| `heat` | uint8 per player | `0..90`. Interpolated on guests; the renderer rounds it for text. |
| `haul` | uint16 per player | Unbanked ore. |
| `bank` | uint8 per player | Deposit progress, `0..24`. |
| `lock` | uint8 per player | Meltdown lockout ticks left. |
| `mode` | int8 per player | The intent the rig is acting on. |
| `active` | bool per player | False after the player leaves. |
| `score` | uint16 per player | Banked ore. |
| `ev` | uint8 per player | Event this tick: `0` none, `1` bank, `2` meltdown, `3` closing loss. |
| `amt` | uint16 per player | Ore the event moved or destroyed. |

A rig has at most one event per tick, so the old `[player, type, amount]` event list became the two per-player fields `ev` and `amt`. An eight-player snapshot is 94 bytes, against a budget of 800.

### Round lifecycle

- `startRound()` resets heat, unbanked haul, drilling and banking progress, lockouts and the tick clock. Banked scores and disconnected status persist.
- A shift lasts 900 ticks (30 seconds). In every 180 ticks the last 60 are rich: triple ore, double heat.
- Drilling grants ore every 10 drilling ticks; an interruption resets the fractional progress.
- At 90 heat the rig loses its haul and locks for 45 ticks.
- Cooling removes 2 heat per tick. Banking removes 1 and needs 24 uninterrupted ticks to deposit the whole haul.
- Closing destroys unbanked ore. A bank that completes on the last tick counts.
- `winner(60)` is the unique active leader at or above 60, otherwise `-1`. Ties play another shift.
- The host advances with Space or the Next round button. `disconnect(index)` forfeits that rig's haul and keeps it inactive.

The simulation uses no randomness. The injected generator is stored and never read.

## Look and feel

The page (`public/index.html`) and the stylesheet (`public/style.css`) are the game's own: the vault ledger, the shift clock (`#clock`), the event line (`#event`) and the hold-to-bank / hold-to-drill buttons. The engine binds behaviour to the elements marked `data-engine="<role>"` and injects no layout or theme. `client.js` passes the game's player colours (`COLORS` in `game.js`) as `palette` and its banner and next-control copy as `labels`; `draw` paints the canvas with the game's palette and updates the page's own elements by id.

## Changes from the pre-engine version

The engine lobby replaced the per-game lobby, so the optional second local player (A/D) and the display-size selector are gone. After a match win the host's next control starts a new match.

## Local checks

```bash
npm test
```

This runs the four original scenarios, the engine shape check, the snapshot budget at eight players, an exact codec round trip, the committed replay fixture `test/replay.ndjson` (four players, three shifts, seed `20260909`), and a determinism check.

From the repository root:

```bash
node scripts/dev.mjs daily-2026-09-09 8811
```

Open `http://localhost:8811/?create=1` and open the invite link in a second tab.

## Registration and deployment

`game-entry.json` supplies the catalog metadata. From the repository root:

```bash
node scripts/sync-engine.mjs game daily-2026-09-09
./deploy.sh daily-2026-09-09 super
```

The first command copies the engine's server modules into `engine/` (ignored by git); `src/server.js` imports them. The deploy script reads the deployed URL from Wasmer, updates the root catalog, and redeploys the superapp. Do not guess a URL. Production two-browser play remains a human check.
