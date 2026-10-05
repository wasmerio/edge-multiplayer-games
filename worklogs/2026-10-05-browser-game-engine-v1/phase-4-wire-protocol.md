# Phase 4 — Wire protocol

**Status:** Complete
[README](README.md)

## Goal

Replace hand-rolled snapshot objects with a declared schema that yields a
binary codec and a delta encoder, and negotiate the protocol version on the
handshake.

## Specification

`engine/schema.js` exports `defineSnapshot(spec)`. A spec names each field, its
type, its shape and its quantisation. Supported types: a signed or unsigned
integer of a declared width, a fixed-point number with a declared scale, a
boolean, a per-player array of any of those, and a variable-length list of
player indices for events.

`defineSnapshot` returns `{ encode, decode, delta, apply, byteLength }`.
`encode` produces an `ArrayBuffer`. `delta(previous, next)` produces a buffer
holding only changed fields with a bitmask. `apply(previous, deltaBuffer)`
reconstructs the next snapshot. A round boundary always sends a full snapshot,
so a guest can render from scratch after it.

`engine/host.js` sends the full snapshot on a round boundary and a delta
otherwise. `engine/guest.js` reconstructs and hands whole snapshots upward, so
a renderer never sees a delta.

The handshake carries `PROTOCOL_VERSION` and a hash of the game's schema. A
guest whose version or schema hash differs from the host's is refused with a
named code and told to reload, rather than admitted into a silent divergence.

### Limits

| Limit | Injectable field | Parameter | How a test reaches it |
|---|---|---|---|
| Encoded snapshot size per player per tick | `budgetBytes` on the schema | `SNAPSHOT_BUDGET_BYTES` | Encode a snapshot at the player cap and assert the measured size |
| Socket payload ceiling | `maxPayload` on the server | `WS_MAX_PAYLOAD` | Send an oversized signaling payload |

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every snapshot on the wire | passes through the schema codec | Transport test rejects a raw object |
| Every round boundary | carries a full snapshot | Host test asserts the first message after a round reset is full |
| Every guest | refuses a mismatched schema hash | Handshake test |
| Every field | round-trips within its declared quantisation | Property test per type |

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Host ticks with an unchanged state | real codec, fake transport | A delta smaller than the full encoding is sent | None | No full snapshot sent off a round boundary |
| Host starts a round | same | A full snapshot is sent | Guest clears its buffer | No delta sent first |
| Guest receives a delta without a prior full snapshot | same | Guest requests a full snapshot, nothing rendered | Named request message | No partial render |
| Guest handshake carries a different protocol version | real server, real host | Join refused with a named code | None | No admission |
| Guest handshake carries a different schema hash | same | Join refused with a named code | None | No admission |
| Replayed reference fixture encoded and decoded | real codec | Decoded stream equals the recorded stream | None | None |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Every field type round-trips | Property test per type with the declared quantisation |
| Deltas are smaller than full snapshots for a static scene | Codec test comparing byte lengths |
| A round boundary is always recoverable | Guest test that drops every message before a round |
| Snapshots stay inside budget at the player cap | Budget test per migrated game |
| Version and schema mismatches are refused | Handshake tests, one per mismatch |
| Fixture encoding is stable | Reference fixture encodes to the same bytes twice |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Spec declares an unknown type | `defineSnapshot` throws naming the field | Unit test |
| Value outside a field's declared range | `encode` throws naming the field and value | Unit test |
| Fixed-point value loses more than its declared scale | `encode` throws | Unit test |
| Buffer truncated in transit | `decode` throws rather than returning a partial snapshot | Unit test |
| Delta applied to a mismatched previous snapshot | `apply` throws | Unit test |
| Event list longer than the player cap | `encode` throws | Unit test |
| Encoded size exceeds the budget | Encode throws naming the budget parameter | Budget test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Schema vocabulary gained `count: n` (fixed-length arrays) for games whose lists do not follow the player count, and `wrap` for angle interpolation. The hash is unchanged for schemas that use neither.
- The host emits a `score` control message whenever `sim.scores` changes, no longer only when the event list `d` is non-empty.
- A discrete guest request outside the intent travels as `{t:"c"}` (`onCommand`); only the sender hears the reply.
- Budget rows are proven per game in each game's own suite and again by the conformance `budget` row over the committed fixture.
- Evidence audit: rows proven in `engine/test/evidence-wire.test.mjs` (property tests per type, fixture stream equality). Added: `maxPayload` injectable on the server, and the schema hash carried on `create` and `join` so the server refuses a mismatched guest with `schema_mismatch`. The handshake rows use a real socket as the host; a real `hostGame` over WebRTC does not exist in Node.

## Review findings

None.
