# Browser game engine v1.0

## Goal

Replace the copy-paste game template in this repository with a first-party
browser game engine, shipped as v1.0 in one pass and consumed by every game
from one versioned URL on the superapp origin. A new game becomes a
simulation, a renderer and a manifest; everything else is the engine's.
The engine's primary consumer is the daily generator agent, so the public
API is designed for an autonomous author: a small surface, invariants that
fail loudly, and an executable conformance suite in place of a checklist.

## Status board

| # | Phase | Status | Outcome |
|---|---|---|---|
| 0 | [Measure and decide](phase-0-measure-and-decide.md) | In Progress (human spike open) | 2D render backend chosen against a measured engine payload budget |
| 1 | [Engine core](phase-1-engine-core.md) | Complete | Module layout, public API, fixed-tick loop, seeded PRNG, record/replay, all headless |
| 2 | [Distribution and conformance](phase-2-distribution-and-conformance.md) | In Progress (awaiting the deploy) | Engine served from the superapp origin under a version path; conformance suite is a command |
| 3 | [Signaling and room lifecycle](phase-3-signaling-and-room-lifecycle.md) | Complete | One server; rejoin, host departure, spectate and expiry are specified states |
| 4 | [Wire protocol](phase-4-wire-protocol.md) | Complete | Declared snapshot schema, binary codec, delta encoding, negotiated protocol version |
| 5 | [Input](phase-5-input.md) | In Progress (awaiting the phone check) | Intent struct with keyboard, touch and gamepad sources |
| 6 | [Rendering and interpolation](phase-6-rendering-and-interpolation.md) | Complete | 2D render layer plus the guest snapshot buffer; the three.js path preserved |
| 7 | [Asset library](phase-7-asset-library.md) | Complete | Versioned shared assets on the superapp origin with manifest, loader and license ledger |
| 8 | [Audio](phase-8-audio.md) | Complete | WebAudio mixer driven by the snapshot event list |
| 9 | [UI kit](phase-9-ui-kit.md) | Reopened (review 1) | Lobby, invite, scoreboard and banner behaviour bound to each game's own page; default chrome as a fallback (D-23) |
| 10 | [Diagnostics](phase-10-diagnostics.md) | Complete | In-page overlay, richer health endpoint, headless soak harness |
| 11 | [Migrate the games](phase-11-migrate-the-games.md) | Reopened (review 1) | All seven games run on the engine; one copy of the server remains |
| 12 | [Generator contract](phase-12-generator-contract.md) | In Progress (awaiting the first generated PR) | The cron emits engine games; AGENTS.md is the engine recipe |
| 13 | [Quality gate](phase-13-quality-gate.md) | In Progress (awaiting the final deploy) | Formatter, linter, every test level, package and deploy checks green |

Phase 0 is a gate: it produces the render-backend decision and the payload
budget that later phases depend on. After it, build the engine bottom-up —
phases 1, then 3 through 10 — then publish and gate it in phase 2, then
migrate in 11, retarget the generator in 12, and sweep in 13. Phase 2 sits
out of numeric order on purpose: a distribution channel and a conformance
suite can only be proven against an engine that exists and a game that uses
it (D-17).

## Strategy

### Evidence this design rests on

Measured in this repository on 2026-10-05, before any phase started:

| Observation | Value |
|---|---|
| Games whose `src/server.js` is byte-identical (md5 `7e387be909211f99b5cbc61d15641bf9`) | 7 of 7 |
| Games with guest interpolation | 1 of 7 |
| Games with audio | 0 of 7 |
| Games with touch or gamepad input | 0 of 7 |
| Games with a seeded PRNG | 0 of 7 |
| Distinct `public/style.css` files | 7 |
| Games already registered in the catalog | 7 |

The generator copies the reference server verbatim and assembles a client
by splitting the reference client on a literal source string, keeping the
prefix unchanged. The split guard rejects any change to that prefix, so the
engine extraction and the generator contract rewrite are one effort.

Measured against `wasmer/static-web-server@1.1.0` on 2026-10-05 with
`SERVER_CACHE_CONTROL_HEADERS=true` and `SERVER_CORS_ALLOW_ORIGINS=*`, which
is the configuration the superapp will run:

| Request | `cache-control` | `access-control-allow-origin` |
|---|---|---|
| `/engine/1.0.0/engine.js` | `public, max-age=31536000` | the request's own origin, reflected |
| `/assets/manifest.json` | `public, max-age=3600` | reflected |
| `/` (`index.html`) | `public, max-age=86400` | reflected |

The server sets `vary: accept-encoding` and no `vary: origin`. Cache lifetime
follows the file extension, not the path, so a version in the path buys
nothing on its own for a JSON manifest.

The signaling server closes a room when its host leaves and keeps no idle
timer, so rejoin, spectating and expiry are new behavior to specify rather
than existing behavior to move.

### Reference evidence

A recorded reference match, committed as a replay fixture: the `(seed,
input log)` pair for a four-player Achtung game of at least three rounds,
stored as newline-delimited JSON, identified by the SHA-256 of its bytes
recorded in the phase that creates it. Every determinism and codec claim is
proven by replaying that fixture headlessly, never by a machine path.

### Non-negotiable invariants

1. The simulation runs headless in Node with no DOM, no network and no
   timers, so every game's rules stay unit-testable.
2. The host browser is the only writer of game state; guests render a
   stream. Star topology over one ordered reliable DataChannel per guest.
3. No bundler and no build step for client code. The engine ships as an ES
   module the browser loads directly.
4. The server holds nothing but the room registry. Losing it must never end
   a game in progress.
5. The sub-app contract holds for every game: `/healthz` as JSON with a
   permissive CORS header, `?create=1` auto-hosting with the invite panel,
   `?room=CODE` auto-joining, and a link back to the superapp.
6. Exactly one copy of the signaling server exists in the repository. A
   deploy-time copy inside a game directory is ignored by git (D-18).
7. Every game pins an engine version explicitly. An unpinned import is a
   conformance failure.

### Shared interfaces between phases

The engine's public surface, settled here so no phase invents it:

```js
// engine/sim.js — headless, Node and browser
export class Simulation {        // a game extends or satisfies this shape
  constructor(playerCount, opts, rng)  // rng: seeded, injected, never global
  startRound()                         // resets per-round state, round += 1
  step(inputs)                         // returns a snapshot object
  winner(target)                       // player index, or -1
  // read by the loop: round, tick, roundOver, scores
}

// engine/schema.js
export function defineSnapshot(spec)   // field names, types, quantisation
                                       // yields encode(), decode(), delta()

// engine/host.js
export function hostGame({ sim, schema, players, tickHz, transport })

// engine/guest.js
export function joinGame({ schema, transport, onSnapshot })

// engine/loop.js
export function fixedTick(hz, onTick)  // one accumulator for the repository

// engine/rng.js
export function seededRng(seed)        // deterministic, serialisable state

// engine/replay.js
export function record(session) / replay(fixture)

// engine/input.js
export function inputSource(bindings)  // keyboard, touch, gamepad to intent

// engine/render2d.js    (backend chosen in phase 0)
// engine/audio.js, engine/ui.js, engine/assets.js, engine/diagnostics.js
// engine/server.js      — signaling, the single copy
```

A game imports from one pinned origin path and nothing else:

```js
import { hostGame } from "https://edge-multiplayer-games.wasmer.app/engine/1.0.0/engine.js";
```

### Severity taxonomy

`blocker` breaks an invariant above or leaves the cron unable to produce a
game. `major` fails an acceptance criterion. `minor` is a specification gap
with a safe default. `note` is a preference with no behavioral consequence.

## Parameters and owners

Every value lives here once. Phase files name the row and never restate a
number. Defaults marked *phase 0* are proposals that phase 0 confirms or
replaces with a measurement.

| Parameter | Default | Owner |
|---|---|---|
| `ENGINE_VERSION` | `1.0.1` | phase-1 |
| `PROTOCOL_VERSION` | `1` | phase-4 |
| `DEFAULT_TICK_HZ` | 30 | phase-1 |
| `MAX_TICK_HZ` | 60 | phase-1 |
| `MAX_PLAYERS_PER_ROOM` | 8 | phase-3 |
| `MAX_SPECTATORS_PER_ROOM` | 8 | phase-3 |
| `ROOM_CODE_LENGTH` | 4 | phase-3 |
| `ROOM_CODE_ALPHABET_SIZE` | 32 | phase-3 |
| `ROOM_IDLE_TTL` | 15 min | phase-3 |
| `REJOIN_GRACE` | 60 s | phase-3 |
| `SIGNAL_PING_INTERVAL` | 20 s | phase-3 |
| `WS_MAX_PAYLOAD` | 64 KiB | phase-3 |
| `PLAYER_NAME_MAX_CHARS` | 16 | phase-3 |
| `SNAPSHOT_BUDGET_BYTES` | 100 B per player per tick | phase-4 |
| `INPUT_RESEND_INTERVAL` | 1 s | phase-5 |
| `INTERP_BUFFER_TICKS` | 3 | phase-6 |
| `ENGINE_CACHE_MAX_AGE` | 31536000 s, inherited from the static server | phase-2 |
| `ASSET_SET_VERSION` | `1.0.0` | phase-7 |
| `ASSET_CACHE_MAX_AGE` | 31536000 s for media, 3600 s for JSON, inherited | phase-7 |
| `CORS_ALLOW_ORIGINS` | `*` | phase-2 |
| `SUPERAPP_ORIGIN` | `https://edge-multiplayer-games.wasmer.app` | phase-2 |
| `ROOT_PACKAGE_SIZE_CAP` | 64 MiB | phase-2 |
| `ENGINE_BUDGET_BYTES` | 262144 | phase-2 |
| `AUDIO_MAX_VOICES` | 16 | phase-8 |
| `DIAG_SAMPLE_INTERVAL` | 1 s | phase-10 |
| `SOAK_DURATION` | 10 min | phase-10 |
| `SOAK_TICK_TOLERANCE` | 10 % | phase-10 |
| `SOAK_SETUP_TIMEOUT` | 30 s | phase-10 |
| `SOAK_MEMORY_SAMPLES` | 10 | phase-10 |
| `SOAK_MEMORY_GROWTH_BYTES` | 4 MiB | phase-10 |
| `DIAG_WINDOW_SAMPLES` | 60 | phase-10 |
| `MAX_CATCHUP_TICKS` | 5 | phase-1 |

## Readiness checklist

The author runs every line before requesting validation and records the
outcome in the session journal.

1. No numerals in phase files outside integration-contract oracle rows:
   
   ```bash
   grep -nE '(^|[^=])\b[0-9]+([.,][0-9]+)? ?(s|ms|B|KiB|MiB|Hz|%)\b' phase-*.md
   ```
2. Every test name is declared in exactly one phase and one file list.
3. Every config field, flag and injectable field has one owner in the
   parameters table.
4. Every invariant and limit in a phase is a table with a test per row.
5. Every phase mentioning listening, manual, paid or two-browser play has a
   `Human required` subsection.
6. No phase references text scheduled for deletion, in particular the
   `applyMessage` split string in the generator contract.
7. New conventions do not contradict existing ones. Cite the file checked;
   `AGENTS.md` section 6 is the current convention of record.
8. Every parameter marked *phase 0* is resolved before phase 1 starts.

## Decisions log

| ID | Date | Decision | Rationale | Replaces |
|---|---|---|---|---|
| D-1 | 2026-10-05 | Build a first-party engine rather than adopt Phaser, Babylon, Godot or Unity | An engine that owns the loop and the world state cannot host a headless-testable simulation, and editor-centric exports cost megabytes the daily cron cannot author | — |
| D-2 | 2026-10-05 | Ship v1.0 in one pass across every layer | Maintainer's call; a staged rollout leaves the generator straddling two templates for longer | — |
| D-3 | 2026-10-05 | Distribute as one versioned ES module on the superapp origin | One copy, one cache policy, assets beside it, and a fix reaches every game at once | Per-game vendoring as the primary channel |
| D-4 | 2026-10-05 | Keep vendoring as a documented, tested escape hatch | A game that must be frozen needs a pinned local copy | — |
| D-5 | 2026-10-05 | CORS comes from the existing static server, not new code | `wasmer/static-web-server@1.1.0` exposes `SERVER_CORS_ALLOW_ORIGINS`, verified from its own help output | A second app or a custom proxy |
| D-6 | 2026-10-05 | three.js stays the 3D path | Already vendored and working in two games; replacing it buys nothing this release | — |
| D-7 | 2026-10-05 | The 2D render backend is decided by measurement in phase 0 | The choice between a third-party renderer and a first-party canvas layer turns on payload size against the engine budget, which nobody has measured | An assumed default |
| D-8 | 2026-10-05 | No ECS, no lockstep, no server authority, no physics engine, no npm workspace | Each either contradicts an invariant or adds surface the generator would misuse | — |
| D-9 | 2026-10-05 | The generator contract rewrite is in scope, not deferred | Extracting the netcode trips the reference-boundary guard and stops the cron | — |
| D-10 | 2026-10-05 | The engine path needs no cache configuration | A versioned `.js` path already inherits a one-year lifetime from the static server, measured above | A hand-set cache header |
| D-11 | 2026-10-05 | The asset manifest is addressed by version in its filename, never by a stable name | JSON inherits a one-hour lifetime, so a stable manifest name would hide an asset update for up to an hour | A mutable `manifest.json` |
| D-12 | 2026-10-05 | Engine and asset responses must carry `vary: origin`, or the permissive origin must be literal | The server reflects the requesting origin and omits `vary: origin`, so a shared cache can hand one origin's allow-header to another; a one-year lifetime makes that durable | Relying on the default reflection |
| D-13 | 2026-10-05 | The superapp's own HTML must not inherit the default lifetime | `index.html` inherits a one-day lifetime, so a redeploy stays invisible to returning visitors; this already explains how a merged game can be missing from the live index long after a deploy | Leaving the default in place |
| D-14 | 2026-10-05 | Engine source lives at `engine/`; the deploy publishes a copy at `public/engine/<ENGINE_VERSION>/` | The static mount serves `public/` only, and a committed published copy keeps the deployed artifact reviewable and gives the vendoring hatch something to copy | Serving from a new filesystem mount |
| D-15 | 2026-10-05 | A test asserts the published copy matches `engine/` byte for byte | Two copies drift; the repository already proved that with seven servers | Trusting the deploy script |
| D-16 | 2026-10-05 | The maintainer's goal condition is the README sign-off | The goal text they set states the same objective, scope, invariants, non-goals and success definition this README carries | A separate approval round |
| D-17 | 2026-10-05 | Execution order is 0, 1, 3 through 10, 2, 11, 12, 13 | Publishing and conformance can only be verified against a built engine and a consuming game; the phase files keep their numbers so nothing has to be renumbered | Strict numeric order |
| D-19 | 2026-10-05 | The 2D backend is a first-party canvas layer inside the engine | It adds no transfer bytes to the engine, needs no bundler, and the repository already shows that a third-party renderer can be vendored per game when a game needs one, as the two three.js games do. The desktop and mobile frame comparison against a third-party candidate stays open as a human-run spike; it can replace this decision without touching a game, because games draw through the surface and name no backend | An assumed third-party renderer |
| D-18 | 2026-10-05 | The engine's Node half is copied into each game at deploy time and ignored by git; only the browser half is fetched from the origin | A deployed game's package is uploaded alone, so its server cannot import across the repository, and the origin cannot serve a module to Node before the process starts. One copy still exists in the repository, which is what the invariant protects | Fetching the server half at runtime |
| D-20 | 2026-10-05 | Conformance has two tiers: `--static` (no browser, no server; runs under EdgeJS) and full (headless browser). The cron gates on the static tier | The generation job runs inside Wasmer, where no browser exists. The kit performs the sub-app contract, so a source proof that a page delegates to the pinned kit, plus the engine's own contract tests, covers the browser rows; a full run stays mandatory locally and before deploy | One tier that the cron cannot run |
| D-21 | 2026-10-05 | A game pins the engine through an import map entry `@engine/` in its page; local runs keep the pin and the engine server repoints it at `public/` when `SUPERAPP_LOCAL_DIR` is set (`node scripts/dev.mjs <game>`) | The pinned artifact is what gets tested, with no file rewritten for development and no network needed | Editing the page for local runs |
| D-22 | 2026-10-05 | The generator is weekly. New games are named `weekly-YYYY-MM-DD` on branch `weekly-game/YYYY-MM-DD`; the command and directory keep the name `daily-game`; existing `daily-` games keep their names | Maintainer's call. Keeping the command name leaves the job configured in the Wasmer dashboard working; the schedule itself is a dashboard setting the maintainer changes | A daily cadence |
| D-23 | 2026-10-05 | The engine owns behaviour; each game owns its page markup and its stylesheet. The kit binds to elements the page marks with `data-engine="<role>"` (and `data-engine-touch`), shows and hides them with the `hidden` attribute, and injects no theme; without an arena slot it still builds its default chrome. This replaces the "one stylesheet / one visual identity" reading of phase 9 and the "delete the game's stylesheet" step of phase 11 | The shared chrome erased every game's identity: seven games with seven looks became one look, and the maintainer rejected it. Behaviour is what was duplicated and broken across games; appearance was never the defect | One engine stylesheet themed by custom properties; per-game theme overrides on kit classes |
| D-24 | 2026-10-05 | An engine fix after a deploy ships as a new version directory. `1.0.0` stays frozen in `public/engine/1.0.0/`; `1.0.1` is published beside it and games move their pin | A version path is cached for a year (D-10), so an edit in place reaches some players and not others, and pages already deployed still pin the old path | Editing the published version in place; deleting the old directory |

## Definition of success

| Outcome | Evidence |
|---|---|
| Every game runs on the engine | All seven catalog entries pass the conformance suite |
| One copy of the signaling server | A single file matches the server's md5 across the tree |
| The conformance suite gates merges | CI fails a deliberately broken sub-app contract |
| Every game interpolates | Diagnostics overlay reports a non-empty snapshot buffer in each game |
| An invite link plays on a phone | Human-required two-device check recorded in the migration phase |
| Any daily is reproducible | Replaying the reference fixture reaches a byte-identical final state |
| Snapshots stay inside budget | Codec test asserts the per-player-per-tick budget for each game |
| The cron emits engine games | A dry-run generation produces a game that passes the conformance suite |
| The recipe matches reality | `AGENTS.md` contains no reference to the deleted split string |

## Validation policy

Repository gates, run from the root unless noted: `node --test scripts/*.test.mjs`
for the registration and deploy scripts, `npm test` inside each game for its
simulation scenarios, the new conformance suite for the sub-app contract, and
`./deploy.sh` for the package size guard. The glob form of the test command is
required; the bare directory form fails to resolve.

Two explicit exceptions, each needing a person: two-browser gameplay against a
production URL, and the two-device phone check for touch input. Both are
`Human required` subsections in their phases.

## Feedback index

| Review | Phase | Finding | Status |
|---|---|---|---|
| 1 | [9](phase-9-ui-kit.md) | The kit imposed one look on every game | Open: fix in progress under D-23 |
| 1 | [11](phase-11-migrate-the-games.md) | The migration deleted each game's page and stylesheet | Open: pages being restored under D-23 |

## Session journal

**2026-10-05, engine 1.0.1 live** — The maintainer deployed the superapp and
all seven games. Conformance against each production origin passes: the
superapp's seven header rows, and for every game the health, create, join,
link, slots and stylesheet rows, with each game reporting engine 1.0.1 and
pinning it. Two deploys of one game failed on backend storage errors and
passed on a rerun; `deploy.sh` now retries those. Still open for a person:
two-browser play per production URL, the phone check, the weekly schedule
in the dashboard, the first generated pull request.

**2026-10-05, review 1** — The maintainer rejected the migrated games: the
shared chrome had replaced every game's page, copy and stylesheet with one
look. Recorded D-23 (the engine owns behaviour, the game owns its page and
stylesheet) and D-24 (a fix after a deploy is a new version directory;
`1.0.0` is frozen), and reopened phases 9 and 11. `mountUi` now binds to a
page's own elements by `data-engine` role and injects no theme when the page
has an arena slot; the engine is `1.0.1`, published beside the frozen
`1.0.0`. The scaffold writes a page with slots and a default `style.css` to
restyle. Conformance gained the `slots` and `stylesheet` rows and tests both
page modes. The generator has the model author the page and the stylesheet,
and rejects the scaffold's theme. `achtung` is the restored reference; the
other six pages are being restored. Nothing is committed or deployed.

**2026-10-05, handoff** — Final serial gate run green: engine suite, script
suite, generator suite, each game's suite, full-tier conformance for all
seven games, published copy matches `engine/`. The maintainer chose to
commit and deploy personally; the agent ran nothing against the cloud or
git. Deploy order that the cache findings require: superapp first, then the
games, then the superapp again. Resume after the deploy with conformance
against each production origin and the human-required checks.

**2026-10-05, phases 2 through 12 implemented, deploys pending** — Found the
tree with engine modules and a half-migrated reference game but a status
board that stopped at phase 1. Verified the reference game in a browser,
then ran the remaining work as parallel subworkers: two pairs of dailies,
the two three.js games, conformance with distribution and the scaffold,
assets with audio, diagnostics and the soak harness, and the generator
contract. Decisions D-20 (two conformance tiers) and D-21 (pin through an
import map, repointed locally) were taken on the way. Fixed afterwards in
the engine: sub-tick interpolation (nothing was being blended), late join,
rematch, angle wrap. Every game passes full-tier conformance and its own
suite. Nothing is committed or deployed. Open items needing a person are
listed per phase under Implementation notes; the three.js soak result under
software rendering is the one automated gate that is not green.

**2026-10-05, phase 1 complete** — `engine/params.js`, `rng.js`, `loop.js`,
`sim.js` and `replay.js` written with a 23-test suite, all green. The loop
caps catch-up work at the parameter and discards the arrears; replay catches
a simulation that writes to its inputs by freezing the array, and catches
divergence by comparing against the recorded final state. Two static checks
enforce the invariants: no browser global in the headless set, and no tunable
stated outside `params.js`. Recorded D-17 on execution order.

**2026-10-05** — Design session with the maintainer settled the four
decisions that span every phase: build first-party (D-1), big bang (D-2),
origin-served versioned module with a vendoring escape hatch (D-3, D-4), and
CORS from the existing static server (D-5). Gathered the measurements in
Strategy from the working tree, read the reference game and the generator
contract, and found the `applyMessage` split coupling that makes the
generator rewrite mandatory (D-9). Wrote this README. Ran the static server locally
to measure its cache and CORS behavior rather than leave it to phase 0,
which resolved two parameters and produced D-10 through D-13; the HTML
lifetime finding also explains the live-index lag seen earlier in the day.
Phase 0 now carries only the render-backend measurement. Took the goal
condition as the sign-off (D-16) and wrote the phase files in the same
session.
