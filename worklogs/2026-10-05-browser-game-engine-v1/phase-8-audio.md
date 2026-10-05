# Phase 8 — Audio

**Status:** Complete
[README](README.md)

## Goal

A mixer that turns the event list already present in every snapshot into sound,
without a game writing audio code.

## Specification

`engine/audio.js` exports `createMixer({ assets, map })`. `map` binds a snapshot
event kind to a sound name from the asset set, with an optional gain and an
optional pitch range taken from the seeded generator so repeated events do not
sound identical.

The mixer reads the snapshot stream the renderer reads, so sound follows the
presentation tick rather than the arrival tick and stays aligned with what the
player sees. Events in a snapshot that the buffer discarded produce no sound.

A voice cap bounds concurrent playback; past the cap the oldest voice is
stopped. A master gain is exposed for the UI kit's mute control, persisted per
viewer in local storage, with every read and write guarded so a blocked store
leaves the mixer working.

Playback starts only after the first user gesture, because a browser refuses
audio before one. Until then the mixer accepts events and discards them.

### Limits

| Limit | Injectable field | Parameter | How a test reaches it |
|---|---|---|---|
| Concurrent voices | `maxVoices` on the mixer | `AUDIO_MAX_VOICES` | Fire more events in one tick than the cap allows |

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every sound | originates from a snapshot event, never from a game call | Unit test rejecting a direct play call |
| Every pitch variation | comes from the seeded generator | Unit test comparing two runs from one seed |
| Every storage access | is wrapped so a blocked store cannot throw | Unit test with storage denied |
| Every event before the first gesture | is discarded, not queued | Unit test |

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Snapshot carrying one event, after a gesture | real mixer, fake audio context | One voice starts with the mapped sound | Voice counted | No sound for unmapped kinds |
| More events in one tick than the voice cap | same | Cap respected, oldest voice stopped | Stopped voice released | No voice leak |
| Event in a snapshot the buffer discarded | real mixer, real buffer | No voice starts | None | No late sound |
| Mute toggled | real mixer, fake storage | Master gain reaches silence | Preference stored | No voice stopped |
| Storage denied | same | Mute works for the session | None | No throw |
| Event before the first gesture | real mixer | No voice, no queue | None | No sound on the first gesture |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| Snapshot events produce sound | Mixer test with a fake audio context |
| The voice cap holds | Cap test |
| Sound follows the presentation tick | Test pairing the buffer and the mixer |
| Mute persists per viewer | Storage test |
| A blocked store does not break audio | Denied-storage test |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Mapped sound absent from the asset set | Mixer throws at construction naming the sound | Unit test |
| Audio context unavailable | Mixer becomes a silent no-op, game unaffected | Unit test |
| Decoded buffer missing for a mapped name | That event is silent, others play | Unit test |
| Event kind absent from the map | Silent, no error | Unit test |
| Gain outside its range | Throws naming the field | Unit test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- `createWebAudio` is the real backend; `startGame` loads only the mapped sounds on the first gesture from the asset set beside the engine module.
- `audioMap` binds any snapshot event field to a sound. `mixer.play()` now throws: sound originates from snapshot events only.
- Pitch variation draws from its own seeded generator; it used to draw from the simulation's, which would have broken replay.
- Round-start and win sounds are left out because they would come from control messages.
- Verification: `engine/test/audio.test.mjs`; browser test "the reference game sounds a death from the shared asset set" in `scripts/ui.test.mjs`.

## Review findings

None.
