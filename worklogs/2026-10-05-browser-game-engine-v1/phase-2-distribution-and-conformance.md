# Phase 2 — Distribution and conformance

**Status:** In Progress (awaiting the deploy)
[README](README.md)

## Goal

Publish the engine from the superapp origin under a version path, serve it
with correct cache and cross-origin headers, and turn the sub-app contract
into a command that fails.

## Specification

The root `wasmer.toml` keeps its single static mount. The deploy publishes a
copy of `engine/` at `public/engine/<ENGINE_VERSION>/engine.js`, committed, and
a test asserts the copy matches the source byte for byte.

`engine.js` is a facade module re-exporting the engine's public surface, so a
game has one import specifier. Each module stays separately importable from the
same version directory for a game that wants part of it.

The `serve` command's environment gains the cross-origin allowance from the
parameters table. Because the server reflects the requesting origin and omits a
`vary` on it, the published engine and asset responses carry `vary: origin`, or
the allowance is a literal value; the phase picks whichever the server honours
and records which. The superapp's own HTML does not inherit the default
lifetime.

`.wasmerignore` excludes `engine/` so the source tree is not uploaded twice,
and the published copy under `public/` stays included.

### Conformance suite

A command run against a game directory or a deployed origin. Each check is a
row; a game passes only with every row green.

| Check | Mechanism |
|---|---|
| Health endpoint answers JSON with the permissive origin header | HTTP request, header and body assertion |
| Root with the create parameter reaches a room without interaction | Headless browser, invite panel visible |
| Root with a room parameter auto-joins | Headless browser, second context |
| A link back to the superapp exists | HTML parse |
| The engine import is pinned to a version | Source scan for an unpinned specifier |
| The game declares no second accumulator | Source scan |
| Snapshot size stays inside its budget | Codec measurement over a replayed fixture |

### Vendoring escape hatch

A documented command copies the published engine into a game's own directory
and rewrites its import to the local path. A test runs it against a scratch
copy of a game and asserts the game still passes conformance offline.

### Human required

A person confirms the published engine URL loads in a browser from a game's
origin after the first superapp deploy. The agent stops before the deploy and
resumes with the result.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Conformance run against a conforming game | real server process, headless browser | Every row passes, exit status zero | Report written to standard output | No change to the game directory |
| Conformance run against a game with a removed health endpoint | same | That row fails, exit status non-zero, row named | None | Other rows still reported |
| Vendoring command on a scratch game | real file system | Game imports the local copy and passes offline | Files written inside the scratch copy | No network access during the run |
| Engine copy diverges from source | file comparison | Test fails naming both paths | None | None |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| The engine is reachable under its version path | Conformance row against the deployed origin |
| Cross-origin reads succeed from a game origin | Header assertion in the suite |
| Cache headers are the ones the parameters table records | Header assertion in the suite |
| The suite fails a broken contract | Test that removes the health endpoint in a scratch copy |
| The published copy cannot drift | Byte comparison test |
| A vendored game works offline | Vendoring test with the network denied |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Engine version directory missing | Suite reports the unreachable import and names the version | Suite test against a scratch origin |
| Game imports the engine without a version | Suite fails the pinning row | Source-scan test |
| Origin header reflected without a `vary` | Suite fails the header row | Header assertion |
| Published copy absent | Deploy stops before upload naming the missing path | Deploy script test |
| Root package exceeds its size cap | Existing deploy guard stops the upload | Existing deploy test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Conformance: `node scripts/conformance.mjs <game-dir | origin> [--static] [--json] [--offline]`, fifteen rows for a game, seven header rows for the superapp origin. Two tiers per D-20. Headless browser is Chrome over the DevTools protocol with no dependency (`scripts/lib/browser.mjs`).
- Measured with `wasmer run . --net` on the root package: engine and assets answer a literal `*` allow-origin and `vary: Accept-Encoding, Origin` (D-12, both honoured); `/`, `/index.html` and `/games.json` answer `no-cache` (D-13). The rules live in `config/static-web-server.toml`, mounted at `/config`, a fourth mount.
- Finding: a 404 under `/engine/` also inherits the one-year lifetime. Publish a version before any game pins it.
- Finding: the remote-build packager honours `.gitignore` and ignores `.wasmerignore`, so a game's copied `engine/` would not be uploaded. `deploy.sh` syncs the server half, writes a temporary `<game>/.ignore` with `!/engine/`, and removes it on exit. A bare `wasmer deploy` in a game directory no longer works.
- Scaffold: `node scripts/new-game.mjs <slug> --name ... [--root dir]`; local run: `node scripts/dev.mjs <slug> [port]`.
- Verification: `node --test --test-concurrency=1 scripts/*.test.mjs`; conformance against the local `wasmer run` origin passed all seven rows.
- Human required, not done: the first superapp deploy and the check that the engine URL loads from a game origin.

## Review findings

None.
