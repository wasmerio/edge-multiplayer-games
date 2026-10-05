# Phase 13 — Quality gate

**Status:** In Progress (awaiting the final deploy)
[README](README.md)

## Goal

Run every gate the repository has over the finished engine and the migrated
games, and close the documentation and catalog contracts the change touches.

## Specification

Run, from the repository root, and fix what they report:

| Gate | Scope |
|---|---|
| The script test suite | Registration, deploy and superapp scripts |
| Every game's own suite | Simulation scenarios per game |
| The engine suite | Engine modules, headless |
| The conformance suite | Every catalog entry and the deployed origins |
| The soak harness | Every catalog entry |
| The package build and size guard | Root package before upload |
| Documentation checks | Every command cited in `AGENTS.md` and in the engine's own readme |

Maintenance contracts closed in this phase: the catalog carries every game with
a live URL, the licence ledger covers every shipped asset, the engine's readme
documents its public surface, and this worklog's status board reflects the
final state.

The superapp's own cache lifetime is confirmed changed, because a stale page
hides a new game from returning visitors.

### Human required

A person performs the final two-browser game against each deployed URL and
confirms the superapp lists every game. The agent stops after the final deploy
and resumes with the result.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Full gate run on a clean tree | every suite above | All green | Reports written | No source change during the run |
| Gate run with one game's conformance broken | same | That gate fails naming the game | Reports written | No other gate skipped |
| Superapp fetched after deploy | real origin | Catalog lists every game with a URL | None | No stale page served |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Every gate passes | Report per gate |
| The catalog is complete and live | Fetch of the deployed catalog |
| Every asset has a licence row | Conformance row |
| The engine surface is documented | Documentation test |
| The worklog reflects reality | Status board and journal entries |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| A gate is unavailable in the environment | Phase stops and records the blocker rather than skipping | Journal entry |
| A deployed game regresses after its migration commit | That game reverts to its vendored engine copy while the engine is fixed | Conformance run |
| The catalog carries an entry without a URL | Deploy fills it or the phase reports the undeployed game | Registration suite |
| The superapp still serves a stale page | Phase reports the cache setting as unchanged | Header assertion |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Gates run this session, serially: engine suite; `node --test --test-concurrency=1 scripts/*.test.mjs`; each game's `npm test`; full-tier conformance per game; a short soak per game; generator suite; `wasmer package build .` for the root (21 MiB).
- Not run: the full-duration soak, conformance against deployed origins, the deploy size guard through `./deploy.sh`.
- Human required, not done: the final deploy, two-browser play per deployed URL, the superapp listing.

## Review findings

None.
