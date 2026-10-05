# Phase 5 — Input

**Status:** In Progress (awaiting the phone check)
[README](README.md)

## Goal

One input layer that turns keyboard, touch and gamepad activity into a game's
declared intent, sent only when it changes.

## Specification

`engine/input.js` exports `inputSource({ intent, bindings })`. `intent`
declares the fields a game reads per player and their ranges, matching the
schema vocabulary. `bindings` maps each field to its sources.

Three source kinds, all optional per binding:

| Source | Shape |
|---|---|
| Keyboard | A list of key codes per field value, with a held-set and a blur reset |
| Touch | A named control: a directional pad, a thumbstick or a button, placed by the UI kit |
| Gamepad | An axis or a button index, polled once per frame |

The source emits an intent object, compares it to the last emitted one, and
calls back only on change. A guest sends on change and re-sends at the resend
interval so a dropped message cannot leave a stuck input. The host reads the
local intent directly.

Touch controls are created only when the device reports a touch pointer, and
they are positioned by the UI kit rather than by the game.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every source | emits only values inside the declared intent ranges | Unit test per source kind |
| Every guest | re-sends its last intent at the resend interval | Unit test with an injected clock |
| Every window blur | clears the held set and emits a neutral intent | Unit test |
| Every binding | names a field the intent declares | Constructor rejects an unknown field |

### Human required

A person opens a migrated game on a phone, plays a round with the touch
controls, and confirms the intent reaches the host. The agent stops after the
first game is migrated and resumes with the result.

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Key pressed then released | real source, fake clock | Two intent emissions, the second neutral | None | No emission while held |
| Touch pad dragged across a boundary | real source, synthetic pointer events | One emission per crossed value | None | No emission per pointer move |
| Gamepad axis crosses the dead zone | real source, fake gamepad snapshot | One emission | None | No emission inside the dead zone |
| Guest holds an input past the resend interval | real source, fake clock, fake transport | A duplicate intent is sent | None | No change of intent value |
| Window blurs while a key is held | real source | Neutral intent emitted | Held set cleared | No stuck value |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Keyboard, touch and gamepad all produce intents | One test per source kind |
| Emissions happen on change only | Test counting emissions over a held input |
| A dropped message cannot stick an input | Resend test with an injected clock |
| Touch controls appear only on touch devices | Test with the pointer capability toggled |
| A phone can play a round | Human-required result recorded here |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Binding names an undeclared intent field | Constructor throws naming the field | Unit test |
| Two bindings claim the same key code | Constructor throws naming the collision | Unit test |
| Gamepad disappears mid-game | Source falls back to the remaining kinds, neutral intent emitted | Unit test |
| Touch control released outside its element | Neutral intent emitted | Unit test |
| Intent value outside the declared range | Source throws rather than sending | Unit test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Keys typed into form fields are no longer captured by the input source; without this a game binding letter keys made the name field untypeable.
- `ctx.intent(field, value)` feeds fields the bindings cannot express (mouse look).
- Touch buttons sat under the canvases and could not be tapped in any game; fixed in the kit stylesheet with a stacking test (`engine/test/ui-stacking.test.mjs`).
- Human required, not done: a round played on a phone with the touch controls.

## Review findings

None.
