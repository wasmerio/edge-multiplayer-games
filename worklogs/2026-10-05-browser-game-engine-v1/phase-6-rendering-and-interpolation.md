# Phase 6 — Rendering and interpolation

**Status:** Complete
[README](README.md)

## Goal

Give every game a 2D render layer and the guest snapshot buffer that makes a
remote game look like the host's, while leaving the three.js path intact.

## Specification

`engine/render2d.js` wraps the backend chosen in phase 0 behind a surface that
hides it: a canvas pair sized from the lobby message, a camera or arena
transform, and draw primitives for a line trail, a sprite, a filled shape and
text. A game draws through this surface and names no backend.

`engine/interp.js` holds the guest buffer. Snapshots enter stamped with their
tick. The renderer reads the buffer at render time for a presentation tick a
fixed number of ticks behind the newest arrival, and interpolates each
interpolatable field between the two bracketing snapshots. Fields a game marks
as discrete are taken from the older bracket without blending.

The host renders from its own authoritative state with no buffer, so the host
sees no added latency.

The arena sizing currently done per game moves into the surface: it sets canvas
dimensions and the container aspect ratio from the lobby message so every peer
draws the same geometry.

The three.js games keep their own renderer modules and consume the interpolated
snapshot stream from `engine/interp.js`, so interpolation is shared even where
the 2D surface is not.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every guest render | reads through the buffer, never the raw arrival | Unit test rejecting a direct render call |
| Every discrete field | is never blended | Unit test per field kind |
| Every host render | bypasses the buffer | Unit test asserting zero added delay |
| Every canvas | is sized from the lobby message | Unit test over a changed arena size |

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Two snapshots bracket the presentation tick | real buffer, fake clock | Interpolated values lie between the brackets | None | No extrapolation past the newer snapshot |
| Snapshot arrives late, buffer empty | same | Last known snapshot held, nothing blended | Diagnostics records a starved frame | No jump to a future state |
| Round boundary passes through the buffer | real buffer | Buffer clears, the full snapshot becomes the only bracket | None | No blending across the boundary |
| Arena size changes between lobbies | real surface, real canvas | Canvas and aspect ratio follow the new size | None | No stale dimensions |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| A guest renders smoothly between ticks | Interpolation test over a known two-snapshot bracket |
| Discrete fields never blend | Test per discrete field |
| A starved buffer degrades visibly, not wrongly | Starvation test asserting held values |
| The host adds no latency | Host render test |
| Every migrated game interpolates | Diagnostics row per game in the migration phase |
| The 3D games still draw | Their own scenario tests pass unchanged in behavior |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Snapshot arrives with a tick older than the presentation tick | Dropped, diagnostics counts it | Unit test |
| Snapshot arrives with a duplicate tick | Ignored | Unit test |
| Buffer grows past its depth | Oldest entries dropped, newest retained | Unit test |
| Field marked interpolatable holds a non-numeric value | Surface throws naming the field | Unit test |
| Canvas element absent from the page | Surface throws naming the expected element | Unit test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- The buffer now advances its presentation tick between arrivals from an injected clock, so motion blends every frame; before this the presentation tick was always an integer and nothing was ever blended. An exact hit is no longer counted as a starved frame.
- `buffer.settle()` on the `over` message shows the final frame; guests used to stay behind forever after a round ended.
- A guest drops a frame whose tick repeats, so a game's tick field must advance during countdowns. Four games gained a per-round step counter as their tick field. Documented in `engine/README.md`.
- `startGame({ mount })` (`engine/stage.js`) mounts a game's own renderer; both three.js games use it and read the interpolated stream. Surface gained `poly`, `ellipse`, `arc`, and text `weight`/`maxWidth`.
- Verification: engine suite; real-browser check of Ring Rumble on host and guest.
- Evidence audit: rows proven in `engine/test/evidence-render.test.mjs`. The canvas rows use the real surface against a stand-in canvas element; the real-canvas proof is the browser run above.

## Review findings

None.
