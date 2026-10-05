# Phase 7 — Asset library

**Status:** Complete
[README](README.md)

## Goal

A shared, versioned asset library on the superapp origin that any game can load
by name, with provenance recorded for every file.

## Specification

Assets live at `public/assets/<ASSET_SET_VERSION>/` beside the engine, with a
manifest whose filename carries the same version, because a stable manifest
name would be cached past an update.

The manifest maps a logical name to a path, a type, a byte length and a
content hash. `engine/assets.js` exports `loadAssets(manifestUrl, names)`
returning decoded images, audio buffers and JSON keyed by logical name, with a
progress callback and a per-asset failure that does not fail the batch.

A licence ledger sits beside the manifest: one row per asset giving its source,
its licence and the attribution text a game must show. The ledger is checked by
the conformance suite: an asset in the manifest with no ledger row fails.

The first asset set is deliberately small: the shared colour palette the games
currently each hard-code, a UI sprite sheet for the kit, and a short sound set
for the audio phase. Game-specific art stays in the game.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every asset | has a ledger row with a licence | Conformance row over the manifest |
| Every manifest | carries its version in its filename | Loader rejects an unversioned manifest URL |
| Every load | verifies the declared byte length | Loader test with a truncated file |
| Every failed asset | leaves the batch usable | Loader test with one missing file |

### Human required

A person confirms the licence of any asset not produced in this repository
before it enters the ledger. The agent stops before adding a third-party file
and resumes with the licence text.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Load a named set | real HTTP server, real decoders | Decoded assets keyed by logical name | Progress callback invoked per asset | No request outside the manifest's version directory |
| One asset missing | same | Batch resolves, the missing name reports its failure | Progress still completes | No throw that loses the loaded assets |
| Asset byte length differs from the manifest | same | That asset fails with a named mismatch | None | No silent acceptance |
| Manifest URL without a version | real loader | Throws naming the requirement | None | No request issued |
| Cross-origin load from a game origin | real server | Succeeds with the permissive header | None | No credentialled request |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| A game loads shared assets cross-origin | Loader integration test against a real server |
| Every asset has provenance | Conformance row over manifest and ledger |
| A partial failure is survivable | Missing-asset test |
| An updated asset set is visible immediately | Test asserting a new version directory and manifest name |
| The palette is shared, not copied | Source scan finds no per-game palette after migration |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Manifest absent | Loader throws naming the URL | Unit test |
| Manifest malformed | Loader throws naming the parse failure | Unit test |
| Asset type unsupported | Loader throws naming the type | Unit test |
| Audio decode fails | That asset fails, the batch survives | Unit test |
| Ledger row missing for a manifest entry | Conformance fails naming the asset | Conformance test |
| Ledger row present for an absent asset | Conformance fails naming the row | Conformance test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- First asset set is first-party only and reproducible: `node scripts/make-assets.mjs --check`. Palette JSON, one SVG sprite sheet, five WAV sounds, manifest and ledger under `public/assets/1.0.0/`.
- The loader also verifies a SHA-256 content hash and refuses a path outside the version directory.
- The kit does not yet draw from the sprite sheet; labels are text.
- For a person to confirm: the ledger's licence wording (the repository has no LICENSE file), and a listening check of the sounds.
- Verification: `node --test --test-concurrency=1 scripts/assets.test.mjs`, `engine/test/assets.test.mjs`.

## Review findings

None.
