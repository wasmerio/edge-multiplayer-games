// Sound follows the snapshot event list, so a game never writes audio code and
// a discarded snapshot never makes a late noise.
import { AUDIO_MAX_VOICES } from "./params.js";

const STORE_KEY = "engine-muted";
// The original map was keyed by event kind; "death" read the "d" event list.
const LEGACY_FIELDS = { death: "d" };

const soundOf = (binding) => (typeof binding === "string" ? binding : binding?.sound);
// An event list starts one voice per entry; a flag starts one while it is set.
const countOf = (value) => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== false && entry !== null && entry !== undefined).length;
  return value === true ? 1 : 0;
};

export function createMixer({ assets = {}, names, map = {}, context, maxVoices = AUDIO_MAX_VOICES, storage } = {}) {
  for (const [kind, binding] of Object.entries(map)) {
    const name = soundOf(binding);
    if (!name) throw new Error(`createMixer: event ${kind} has no sound name`);
    // `names` lists sounds that load later, so a typo still fails at construction.
    if (!(name in assets) && !names?.includes(name)) throw new Error(`createMixer: event ${kind} names missing sound ${name}`);
    const gain = typeof binding === "object" ? binding.gain : undefined;
    if (gain !== undefined && (gain < 0 || gain > 1)) {
      throw new Error(`createMixer: event ${kind} gain ${gain} is outside 0 to 1`);
    }
    const pitch = typeof binding === "object" ? binding.pitch : undefined;
    if (pitch !== undefined && !(Array.isArray(pitch) && pitch.length === 2 && pitch[0] > 0 && pitch[1] >= pitch[0])) {
      throw new Error(`createMixer: event ${kind} pitch must be a [low, high] range`);
    }
  }
  // Touching the global store can itself throw when storage is blocked.
  let store = storage ?? null;
  if (storage === undefined) { try { store = globalThis.localStorage ?? null; } catch { store = null; } }
  const read = () => { try { return store?.getItem(STORE_KEY) === "1"; } catch { return false; } };
  const write = (value) => { try { store?.setItem(STORE_KEY, value ? "1" : "0"); } catch { /* a blocked store must not break audio */ } };

  let muted = read();
  let unlocked = false;
  const voices = [];
  let started = 0;
  const silent = !context;
  context?.setMasterGain?.(muted ? 0 : 1);

  const stopOldest = () => { const voice = voices.shift(); voice?.stop?.(); };

  const play = (kind, rng) => {
    const binding = map[kind];
    if (!binding) return null;
    if (!unlocked || silent || muted) return null;
    const sound = assets[soundOf(binding)];
    if (!sound) return null;
    while (voices.length >= maxVoices) stopOldest();
    const pitch = typeof binding === "object" && binding.pitch && rng
      ? binding.pitch[0] + rng.next() * (binding.pitch[1] - binding.pitch[0])
      : 1;
    let voice = null;
    const onEnded = () => { const at = voices.indexOf(voice); if (at >= 0) voices.splice(at, 1); };
    voice = context.play({ sound, gain: (typeof binding === "object" ? binding.gain : undefined) ?? 1, pitch, onEnded });
    voices.push(voice);
    started += 1;
    return voice;
  };

  const fieldFor = (kind, snapshot) => {
    const binding = map[kind];
    if (typeof binding === "object" && binding.field) return binding.field;
    return kind in snapshot || !LEGACY_FIELDS[kind] ? kind : LEGACY_FIELDS[kind];
  };

  return {
    unlock() { unlocked = true; },
    unlocked: () => unlocked,
    muted: () => muted,
    // Muting silences the master gain; voices already playing are left to finish.
    setMuted(value) { muted = Boolean(value); write(muted); context?.setMasterGain?.(muted ? 0 : 1); return muted; },
    voices: () => voices.length,
    started: () => started,
    addAssets(more) { Object.assign(assets, more); },
    // Every map key names a snapshot field; `eventField` and `kind` keep the old single-binding call.
    onSnapshot(snapshot, { eventField, kind, rng } = {}) {
      if (!snapshot) return 0;
      let count = 0;
      const fire = (name, value) => { for (let i = countOf(value); i > 0; i--) if (play(name, rng)) count += 1; };
      if (eventField !== undefined || kind !== undefined) {
        fire(kind ?? "death", snapshot[eventField ?? "d"]);
        return count;
      }
      for (const name of Object.keys(map)) fire(name, snapshot[fieldFor(name, snapshot)]);
      return count;
    },
    // Sound originates from a snapshot event, never from a game call.
    play() { throw new Error("mixer: play is not callable; bind a snapshot event field in audioMap instead"); },
  };
}

// The WebAudio backend behind the mixer. The context is created on first use,
// which the caller keeps after a user gesture; without WebAudio this returns null.
export function createWebAudio({ AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  if (!AudioContext) return null;
  let ctx = null;
  let master = null;
  let level = 1;
  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = level;
      master.connect(ctx.destination);
    }
    return ctx;
  };
  return {
    resume: async () => { const c = ensure(); if (c.state === "suspended") await c.resume(); },
    decode: (bytes) => ensure().decodeAudioData(bytes),
    setMasterGain(value) { level = value; if (master) master.gain.value = value; },
    state: () => ctx?.state ?? "idle",
    play({ sound, gain = 1, pitch = 1, onEnded }) {
      const c = ensure();
      const source = c.createBufferSource();
      const volume = c.createGain();
      source.buffer = sound;
      source.playbackRate.value = pitch;
      volume.gain.value = gain;
      source.connect(volume);
      volume.connect(master);
      source.onended = () => { volume.disconnect(); onEnded?.(); };
      source.start();
      return { stop() { try { source.stop(); } catch { /* already ended */ } } };
    },
  };
}
