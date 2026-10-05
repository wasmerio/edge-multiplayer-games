# Phase 11 — Migrate the games

**Status:** Reopened (review 1)
[README](README.md)

## Goal

Move all seven games onto the engine, leaving one copy of the server and no
per-game netcode, lobby, stylesheet or accumulator.

## Specification

Migrate in this order, because each step de-risks the next: `achtung` first as
the reference, then the two three.js games whose renderers must keep working,
then the four daily games.

Per game, in one commit each:

| Step | Result |
|---|---|
| Replace `src/server.js` with a call into the engine server | The game's own copy is deleted |
| Declare the snapshot schema from the game's existing snapshot shape | The hand-rolled object is gone |
| Declare the intent and its bindings, adding touch controls | Keyboard behaviour is preserved |
| Replace the lobby and chrome with the kit declaration | `index.html` keeps only its container and metadata |
| Delete the game's stylesheet, keeping any genuine theme override | One stylesheet remains in the engine |
| Pass the simulation its injected generator | No global random call remains |
| Record a replay fixture and commit it | The game is reproducible |
| Run conformance and a soak run | Both green before the next game |

The three.js games keep their own renderer modules and take the interpolated
stream from the engine. Their simulations change only where they read randomness
or define their own loop.

The four daily games are migrated as they stand. Their behaviour is preserved;
a rewrite is out of scope.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every game | imports the engine at a pinned version | Conformance row |
| Every game | has no second accumulator and no own server | Source scan rows in the suite |
| Every game | has a committed replay fixture | Repository scan per catalog entry |
| Every migrated game | keeps the behaviour its scenario tests describe | The game's existing scenario suite passes |

### Human required

A person plays a two-browser game against the deployed URL for each migrated
game, and a two-device game with touch for at least the reference game. The
agent stops after each deploy and resumes with the result.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Conformance run per migrated game | real server, headless browser | Every row passes | Report per game | No change to another game |
| Soak run per migrated game | same | Pass with a report | Report artifact | No budget breach |
| Replay of a game's committed fixture | real simulation | Recorded final state reached | None | No clock or network read |
| A game's existing scenario suite | real simulation | Passes unchanged in behaviour | None | No scenario deleted to make it pass |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Seven games run on the engine | Conformance report per catalog entry |
| One server copy remains | Repository scan |
| No per-game netcode remains | Source scan for the removed handlers |
| Every game interpolates | Diagnostics row per game |
| Every game is reproducible | Fixture replay per game |
| Behaviour is preserved | Each game's scenario suite passes |
| A phone can play | Human-required result recorded here |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| A game's snapshot does not fit the schema vocabulary | Phase stops and proposes a schema extension rather than a per-game codec | Author judgment, recorded here |
| A migrated game's scenarios fail | Migration of that game reverts; the engine gap is fixed first | The game's scenario suite |
| A three.js renderer breaks on the interpolated stream | Interpolation gains the field kind the renderer needs | That game's scenario suite |
| Snapshot exceeds the budget after migration | Schema quantisation is tightened before the game ships | Budget test |
| A game cannot reach the engine origin | Vendoring hatch is used and recorded | Conformance run offline |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- All seven games run on the engine: full-tier conformance passes fifteen rows for each, every game's own suite passes with its scenarios kept, and each has a committed `test/replay.ndjson`.
- One server implementation remains (`engine/server.js`); every `src/server.js` is the same five-line call.
- Not one commit per game: nothing is committed yet, by the maintainer's standing rule on commits.
- Behaviour lost in migration: the second local player and the display-size option (dailies), Ring Rumble's practice bot, Counterstrike's draw-call measurement script. A signaling `leave` now eliminates the player.
- Late join and rematch were lost at first and restored in the engine afterwards (phases 3 and 9 notes).
- Soak: see phase 10 notes for the three.js result.
- Human required, not done: deploys, two-browser play against production, the phone check.

## Review findings

- Review 1 (2026-10-05, maintainer): the migration replaced each game's page, copy and stylesheet with the generic chrome. Rejected. Fix under D-23: restore each game's own `public/index.html` and `public/style.css` on engine `1.0.1` (D-24). The "delete the game's stylesheet" step is withdrawn.
