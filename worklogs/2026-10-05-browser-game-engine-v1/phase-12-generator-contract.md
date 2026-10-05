# Phase 12 — Generator contract

**Status:** In Progress (awaiting the first generated PR)
[README](README.md)

## Goal

Teach the daily generator to author engine games, and make `AGENTS.md` the
engine recipe, so the cron stops producing copies of the old template.

## Specification

The generator currently assembles a client by splitting the reference client on
a literal source string and keeping the prefix, and copies the reference server
verbatim. Both disappear. The reference file list and the split guard are
removed with them.

What the model authors after this phase:

| Artifact | Content |
|---|---|
| The simulation | The game's rules against the engine's simulation shape, taking an injected generator |
| The snapshot schema | A declaration in the schema vocabulary |
| The intent and bindings | Fields and their keyboard, touch and gamepad sources |
| The draw function | Calls into the 2D surface |
| The audio map | Event kinds bound to sound names |
| The page metadata | Title, description and any theme override |
| Scenarios | The simulation's unit scenarios |
| The README | Input, snapshot and round lifecycle, as today |

What the generator supplies: the scaffold from the engine's own command, the
engine import pinned to the current version, the server call, the kit
declaration and the manifest files.

Validation gains, in place of the element-identifier check: the simulation
passes the engine's shape validation, the schema compiles, a recorded fixture
replays, the snapshot fits its budget, and the conformance suite passes against
a locally started server. A candidate that fails any of these is rejected
before a pull request is opened.

`AGENTS.md` is rewritten around the engine: the model in one paragraph, the
engine surface, the scaffold command, the authoring steps, the conformance
command, and the platform constraints that remain true. The copy-and-rename
instruction and the element-identifier rule go.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every generated game | passes conformance before the pull request opens | Generator test with a deliberately broken candidate |
| Every generated game | pins the engine version the generator ran against | Generator test asserting the specifier |
| The generator | references no deleted reference file or split string | Source scan over the runtime |
| `AGENTS.md` | describes only commands that exist | Documentation test running each cited command with its help flag |

### Human required

A person reviews the first generated pull request after the rewrite before it
merges. The agent stops after the dry run and resumes with the verdict.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Dry-run generation with a valid candidate | real scaffold, real validators, no network writes | A complete game directory that passes conformance | Files in a scratch workspace | No pull request, no catalog edit |
| Candidate whose simulation misses a method | same | Rejected naming the method | None | No files written |
| Candidate whose snapshot exceeds its budget | same | Rejected naming the budget | None | No files written |
| Candidate whose fixture does not replay | same | Rejected naming the divergence | None | No files written |
| Generation against an engine version that is not published | real validators | Rejected naming the version | None | No files written |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| A generated game passes conformance | Dry-run test |
| The split string is gone | Source scan over the generator runtime |
| Broken candidates are rejected early | One test per rejection reason |
| `AGENTS.md` matches the tooling | Documentation test |
| The catalog registration still works | Existing registration suite passes |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Scaffold command absent | Generation fails naming the command | Generator test |
| Engine version unpublished | Generation fails before authoring | Generator test |
| Conformance unavailable in the generation environment | Generation fails rather than skipping the gate | Generator test |
| Candidate names a game that already exists | Existing duplicate check rejects it | Existing generator test |
| Candidate content exceeds the size limit | Existing content check rejects it | Existing generator test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- The generator scaffolds with `scripts/new-game.mjs`, lets the model edit the simulation, client, tests, README and metadata, requires every other file byte-identical to the scaffold, and gates on `check_game.mjs` plus `conformance.mjs --static --json` (D-20). The split string, the reference file list and the element-id check are gone.
- `AGENTS.md`, the root README and the automation README are rewritten around the engine; `scripts/docs.test.mjs` runs every cited command with its help flag.
- Verification: `python3 -m unittest discover -s automation/daily-game/test` (45 tests, 4 skipped outside Wasmer); a ten-test subset passed inside Wasmer. The whole suite inside Wasmer was not completed in one clean run.
- The cron cannot run until the engine, scripts and runtime are on `main` and the superapp is redeployed.
- Human required, not done: a paid generation and review of its draft pull request.

## Review findings

None.
