# Phase 1 — Engine core

**Status:** Complete
[README](README.md)

## Goal

Create the engine package with its headless core: the fixed-tick loop, the
seeded generator, record and replay, and the version constants, all runnable
in Node with no DOM.

## Specification

Create `engine/` at the repository root with one module per concern, matching
the public surface in the README. This phase delivers `engine/loop.js`,
`engine/rng.js`, `engine/replay.js`, `engine/sim.js` and `engine/params.js`;
the remaining modules are later phases and are not stubbed here.

`engine/params.js` is the engine's single source for every value in the
README's parameters table, including the version and protocol constants. No
other engine module hard-codes any of them, and no game imports a literal.

`engine/loop.js` exports `fixedTick(hz, onTick)`: one accumulator, a monotonic
clock injected so tests can drive it, a guard that caps catch-up work so a
backgrounded tab cannot run an unbounded burst on return, and a `stop()`.

`engine/rng.js` exports `seededRng(seed)` returning a generator with
`next()`, `range(lo, hi)`, `int(lo, hi)`, `pick(array)`, plus `state()` and
`restore(state)` so a replay can resume mid-stream. The generator never reads
the global random source.

`engine/sim.js` exports the `Simulation` shape the README fixes and a
`validateSimulation(candidate)` that asserts the required methods and fields
exist with the right arity. The generator calls this before it writes a game.

`engine/replay.js` exports `record(session)` producing a fixture of the seed,
the tick rate, the player count and one entry per tick holding the input
array, and `replay(fixture, simFactory)` returning the final state. The
fixture format is newline-delimited JSON, one header line then one line per
tick.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every engine module | no `import` of a DOM or network global in the headless set | Static check over the module set |
| Every simulation | randomness arrives through the injected generator | `validateSimulation` rejects a constructor that ignores its generator argument |
| Every loop user | one accumulator implementation exists | Static check that no game defines its own |
| Every replay | same seed and inputs reach the same final state | Replay of the reference fixture |

## Integration contract

Unit-test-only, with one exception: the replay test loads the committed
reference fixture and a real simulation, so it exercises the fixture format
and the simulation shape together.

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Replay the reference fixture | real simulation, real generator | Final scores and round count match the fixture header | None | No file writes, no clock reads |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| The core runs in Node with no DOM | Node test suite for the engine passes with no browser shim |
| The loop cannot burst unboundedly | Test drives the injected clock past the catch-up cap and counts ticks |
| The generator is reproducible and resumable | Test compares two runs from one seed, and a resumed run against an uninterrupted one |
| A malformed simulation is rejected | Test asserts each missing method and field is named in the error |
| Replay is deterministic | Reference fixture replays to its recorded final state |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Tick rate above the maximum | Constructor throws naming the parameter | Unit test |
| Seed is absent or not finite | `seededRng` throws rather than falling back to the global source | Unit test |
| Fixture header and tick count disagree | `replay` throws naming the mismatch | Unit test |
| Fixture holds a tick whose input length differs from the player count | `replay` throws | Unit test |
| Simulation mutates the input array | Replay detects the divergence and throws | Unit test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Implemented by the previous session (journal entry "phase 1 complete"). This session added `engine/clock.js` (`workerTimers`), because a hidden host tab throttled the page timer to about one tick a second; the loop now takes its timers from an inline worker and falls back to page timers.
- Verification: `node --test --test-concurrency=1 'engine/test/*.test.mjs'`, all passing.
- Evidence audit: every table row maps to a named test; the missing ones were added in `engine/test/evidence-core.test.mjs` and `scripts/evidence.test.mjs`. `validateSimulation` rejects a constructor that drops the generator argument; a simulation that accepts it and never draws is detected by `simulationUsesInjectedRng`, not rejected, because a game without randomness is legitimate.

## Review findings

None.
