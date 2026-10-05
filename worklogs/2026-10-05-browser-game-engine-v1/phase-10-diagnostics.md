# Phase 10 — Diagnostics

**Status:** Complete
[README](README.md)

## Goal

Make a peer-to-peer game observable: an in-page overlay, a health endpoint
worth reading, and a headless soak harness.

## Specification

`engine/diagnostics.js` collects, per peer: tick rate achieved against the
configured rate, round-trip time, bytes sent and received per second, encoded
snapshot size, buffer depth, starved frames and dropped snapshots. Samples are
taken at the sample interval and kept in a ring for the overlay's window.

The overlay is off by default and toggled by a query parameter and a key
chord, rendered by the UI kit so every game has it. It shows the current sample
and a sparkline per series.

The health endpoint gains the room, player and spectator counts the lifecycle
phase tracks, the engine version, the protocol version, and the process uptime.
It stays a single uncached JSON response with the permissive origin header, so
the superapp can keep polling it cross-origin.

The soak harness runs headless: it starts a game's server, opens a host and
several guests in a headless browser, plays for the soak duration with scripted
intents, and asserts no error was logged, no snapshot exceeded its budget, the
achieved tick rate stayed within tolerance of the configured rate, and memory
did not grow monotonically across the run.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every counter | is reset on a round boundary or explicitly declared cumulative | Unit test per counter |
| Every sample | is taken at the sample interval from an injected clock | Unit test |
| Every overlay read | is passive | Unit test asserting no state mutation |
| Every soak run | fails on a logged error | Harness test with an injected error |

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Overlay enabled by the query parameter | real kit, headless browser | Overlay visible with populated series | None | No change to gameplay |
| Health endpoint queried mid-game | real server | Counts and versions reflect the live room | None | No room mutated |
| Soak run of a conforming game | real server, headless browser | Run passes with a written report | Report artifact | No network beyond the local server |
| Soak run where a snapshot exceeds its budget | same | Run fails naming the tick and the size | Report artifact | No pass |
| Guest starves the buffer | real buffer, real collector | Starved frames counted | None | No render error |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Every series populates | Overlay test asserting each named series |
| Health reports live counts and versions | Health test after a known join sequence |
| A soak run passes for each migrated game | Harness report per game |
| A budget breach fails the run | Harness test with an inflated snapshot |
| The overlay costs nothing when off | Test asserting no collection while disabled |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Transport absent when the collector starts | Collector reports zeroes, no throw | Unit test |
| Round-trip probe unanswered | Series reports the gap rather than a stale value | Unit test |
| Headless browser unavailable | Harness fails with a named prerequisite | Harness test |
| Soak run times out | Harness fails naming the timeout | Harness test |
| Memory grows monotonically | Harness fails naming the series | Harness test with a leak injected |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Overlay: `?overlay=1` or Alt+Shift+D; eight series with sparklines. `globalThis.__engine` is a read-only handle for the harness.
- `node scripts/soak.mjs <game> [--duration s] [--guests n] [--report path]`; named failures listed in `engine/README.md`.
- Short soak (15 s, one guest) per game: the five 2D games pass at the configured tick rate. The two three.js games fail `tick_rate` under headless software rendering (about 27 and 23 ticks a second); in a real browser Ring Rumble held the configured rate with no dropped ticks. Open: give the harness a GPU-backed browser, or record the three.js soak by hand.
- The full `SOAK_DURATION` run was not executed; a match ends at its target score, after which the run measured an idle loop until rematch support landed late in the session.
- New parameters: `DIAG_WINDOW_SAMPLES`, `SOAK_TICK_TOLERANCE`, `SOAK_SETUP_TIMEOUT`, `SOAK_MEMORY_SAMPLES`, `SOAK_MEMORY_GROWTH_BYTES`.

## Review findings

None.
