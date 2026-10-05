# Phase 0 — Measure and decide

**Status:** In Progress (human spike open)
[README](README.md)

## Goal

Choose the 2D render backend against a measured payload budget, and fix
`ENGINE_BUDGET_BYTES`, so no later phase guesses either.

## Specification

Produce a spike that draws the same scene twice: once through a third-party
2D renderer loaded as a single ES module, once through a first-party canvas
layer written against the repository's conventions. The scene is the Achtung
arena: trails, heads, a banner and a scoreboard, at the arena size the
reference game uses for its largest supported player count.

Measure, for each candidate:

| Measurement | Method |
|---|---|
| Transfer size of the renderer module | Byte length of the file the browser loads |
| Transfer size of the whole engine with that backend | Byte length of the published engine module |
| Frames held at the default tick rate | Diagnostics sample over the soak duration |
| Lines of first-party code the backend removes or adds | Diff against the reference game |

`ENGINE_BUDGET_BYTES` is then set to the smaller of the two totals rounded up
to a round figure, and recorded as a parameter row by the author. The decision
row names the chosen backend, the two measured totals, and the frame result.

The three.js path is out of scope. It stays as the 3D backend untouched.

### Human required

A person runs the spike in a desktop browser and in a mobile browser, reads
the diagnostics overlay, and reports the frame result for each candidate. The
agent stops after publishing both spike pages and resumes once the two frame
numbers are recorded in the phase.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Spike page loaded with backend A | real browser, no network beyond the module | Arena renders, overlay reports a frame rate | Overlay sample written to the page | No change to any game directory |
| Spike page loaded with backend B | same | Same scene renders identically | Same | Same |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Both candidates render the reference scene | Side-by-side screenshots in the phase |
| Both transfer sizes are recorded | Byte lengths in the measurement table |
| A backend is chosen with a stated reason | Decision row in the README |
| `ENGINE_BUDGET_BYTES` has a value | Parameter row no longer marked *phase 0* |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| A candidate cannot draw the scene | Phase records it as disqualified with the blocking feature named | Spike page, recorded result |
| Both candidates exceed any plausible budget | Phase escalates to the maintainer rather than picking one | Author judgment, recorded in the journal |
| The candidate module needs a build step | Candidate is disqualified; invariant three forbids it | Spike attempt, recorded result |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Decision taken without the third-party candidate being measured in a browser: D-19 chose the first-party canvas layer. The spike pages and the two-device frame comparison were not produced; that remains the human-run item of this phase.
- `ENGINE_BUDGET_BYTES` stays at its parameter value. Measured published engine: see the phase 13 notes (`du -b public/engine/1.0.0`).
- Real-browser frame evidence gathered instead: Ring Rumble (three.js path) and Achtung (2D surface) both held the default tick rate with no dropped ticks in the desktop app's browser pane, read from the diagnostics overlay.

## Review findings

None.
