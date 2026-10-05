// Phase 8: the mixer's event binding, the presentation pairing and the WebAudio backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMixer, createWebAudio } from "../audio.js";
import { createBuffer } from "../interp.js";
import { defineSnapshot } from "../schema.js";
import { seededRng } from "../rng.js";
import { AUDIO_MAX_VOICES } from "../params.js";

const fakeContext = () => {
  const started = [];
  const gains = [];
  return {
    started, gains,
    setMasterGain: (value) => gains.push(value),
    play: (voice) => { started.push(voice); return { stop() { voice.stopped = true; voice.onEnded?.(); } }; },
  };
};
const mixerWith = (map, extra = {}) => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { hit: "HIT", score: "SCORE" }, map, context, ...extra });
  mixer.unlock();
  return { mixer, context };
};

test("an audio map binds each snapshot event field to its sound", () => {
  const { mixer, context } = mixerWith({ d: "hit", pickups: { sound: "score", gain: 0.5 } });
  assert.equal(mixer.onSnapshot({ d: [2], pickups: [0, 1], other: [9] }), 3);
  assert.deepEqual(context.started.map((v) => [v.sound, v.gain]), [["HIT", 1], ["SCORE", 0.5], ["SCORE", 0.5]]);
});

test("a flag field sounds once while set and an empty list is silent", () => {
  const { mixer } = mixerWith({ boom: "hit", d: "hit" });
  assert.equal(mixer.onSnapshot({ boom: true, d: [] }), 1);
  assert.equal(mixer.onSnapshot({ boom: false, d: [] }), 0);
  assert.equal(mixer.onSnapshot({ boom: 3 }), 0, "a number is a quantity, not an event");
});

test("a binding may name the snapshot field it listens to", () => {
  const { mixer } = mixerWith({ crash: { sound: "hit", field: "d" } });
  assert.equal(mixer.onSnapshot({ d: [0, 1] }), 2);
});

test("a direct play call is refused: sound originates from a snapshot event", () => {
  const { mixer, context } = mixerWith({ d: "hit" });
  assert.throws(() => mixer.play("d"), /not callable/);
  assert.equal(context.started.length, 0);
});

test("more events in one tick than the default cap stop the oldest and leak no voice", () => {
  const { mixer, context } = mixerWith({ d: "hit" });
  const burst = Array.from({ length: AUDIO_MAX_VOICES + 3 }, (_, i) => i);
  assert.equal(mixer.onSnapshot({ d: burst }), burst.length);
  assert.equal(mixer.voices(), AUDIO_MAX_VOICES);
  assert.equal(context.started.filter((v) => v.stopped).length, 3);
  assert.equal(context.started[0].stopped, true, "the oldest voice goes first");
});

test("a voice that ends is released", () => {
  const { mixer, context } = mixerWith({ d: "hit" });
  mixer.onSnapshot({ d: [0, 1] });
  context.started[0].onEnded();
  assert.equal(mixer.voices(), 1);
  assert.equal(mixer.started(), 2);
});

test("mute brings the master gain to silence without stopping a playing voice", () => {
  const box = {};
  const storage = { getItem: (k) => box[k] ?? null, setItem: (k, v) => { box[k] = v; } };
  const { mixer, context } = mixerWith({ d: "hit" }, { storage });
  mixer.onSnapshot({ d: [0] });
  mixer.setMuted(true);
  assert.equal(context.gains.at(-1), 0);
  assert.equal(context.started[0].stopped, undefined);
  assert.equal(mixer.voices(), 1);
  mixer.setMuted(false);
  assert.equal(context.gains.at(-1), 1);
  assert.equal(box["engine-muted"], "0");
});

test("events before the first gesture make no sound when the gesture comes", () => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { hit: "HIT" }, map: { d: "hit" }, context });
  assert.equal(mixer.onSnapshot({ d: [0, 1, 2] }), 0);
  mixer.unlock();
  assert.equal(context.started.length, 0);
  assert.equal(mixer.onSnapshot({ d: [0] }), 1);
});

test("a sound that loads later is accepted by name and silent until it arrives", () => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { hit: "HIT" }, names: ["score"], map: { d: "hit", pickups: "score" }, context });
  mixer.unlock();
  assert.equal(mixer.onSnapshot({ d: [0], pickups: [0] }), 1, "the loaded sound plays, the missing one is silent");
  mixer.addAssets({ score: "SCORE" });
  assert.equal(mixer.onSnapshot({ pickups: [0] }), 1);
  assert.throws(() => createMixer({ assets: {}, names: ["score"], map: { d: "typo" } }), /missing sound typo/);
});

test("a gain or pitch outside its range is refused naming the event", () => {
  assert.throws(() => createMixer({ assets: { hit: 1 }, map: { d: { sound: "hit", gain: -0.1 } } }), /event d gain -0.1/);
  assert.throws(() => createMixer({ assets: { hit: 1 }, map: { d: { sound: "hit", pitch: [1.2, 0.8] } } }), /event d pitch/);
});

test("pitch is drawn from the generator it is given and from nowhere else", () => {
  const run = (seed) => {
    const { mixer, context } = mixerWith({ d: { sound: "hit", pitch: [0.9, 1.1] } });
    mixer.onSnapshot({ d: [0, 1, 2, 3] }, { rng: seededRng(seed) });
    return context.started.map((v) => v.pitch);
  };
  assert.deepEqual(run(11), run(11));
  assert.notDeepEqual(run(11), run(12));
  assert.ok(run(11).every((pitch) => pitch >= 0.9 && pitch <= 1.1));
  const { mixer, context } = mixerWith({ d: { sound: "hit", pitch: [0.9, 1.1] } });
  mixer.onSnapshot({ d: [0] });
  assert.equal(context.started[0].pitch, 1, "without a generator the pitch is flat");
});

const schema = defineSnapshot({ fields: { k: { type: "uint", bits: 32 }, d: { type: "players" } } });

// The engine's guest path: sound each buffered frame once, when the screen reaches its tick.
const present = (buffer, mixer, cursor) => {
  const shown = buffer.sample();
  if (!shown) return 0;
  let started = 0;
  for (const frame of buffer.between(cursor.tick, shown.k)) started += mixer.onSnapshot(frame);
  if (shown.k > cursor.tick) cursor.tick = shown.k;
  return started;
};

test("sound follows the presentation tick, not the arrival tick, and never repeats a frame", () => {
  const { mixer } = mixerWith({ d: "hit" });
  const buffer = createBuffer({ schema, depth: 2 });
  const cursor = { tick: -Infinity };
  buffer.push({ k: 1, d: [] });
  buffer.push({ k: 2, d: [] });
  buffer.push({ k: 3, d: [0] });
  assert.equal(present(buffer, mixer, cursor), 0, "the event has arrived but is not on screen yet");
  buffer.push({ k: 4, d: [] });
  assert.equal(present(buffer, mixer, cursor), 0);
  buffer.push({ k: 5, d: [] });
  assert.equal(present(buffer, mixer, cursor), 1, "the screen reached the event's tick");
  for (let i = 0; i < 5; i++) assert.equal(present(buffer, mixer, cursor), 0, "another animation frame on the same tick is silent");
});

test("an event in a frame the buffer discarded makes no sound", () => {
  const { mixer } = mixerWith({ d: "hit" });
  const buffer = createBuffer({ schema, depth: 1 });
  const cursor = { tick: -Infinity };
  buffer.push({ k: 1, d: [0] });
  for (let k = 2; k <= 8; k++) buffer.push({ k, d: [] });
  assert.ok(buffer.stats().dropped > 0);
  assert.equal(present(buffer, mixer, cursor), 0);
  buffer.settle();
  assert.equal(present(buffer, mixer, cursor), 0);
});

test("the final frame's event sounds once the stream has settled", () => {
  const { mixer } = mixerWith({ d: "hit" });
  const buffer = createBuffer({ schema, depth: 2 });
  const cursor = { tick: -Infinity };
  for (const k of [1, 2, 3]) buffer.push({ k, d: k === 3 ? [1] : [] });
  assert.equal(present(buffer, mixer, cursor), 0);
  buffer.settle();
  assert.equal(present(buffer, mixer, cursor), 1);
  assert.equal(present(buffer, mixer, cursor), 0);
});

class FakeAudioContext {
  static made = 0;
  constructor() { FakeAudioContext.made += 1; this.state = "suspended"; this.destination = { name: "out" }; this.sources = []; this.nodes = []; }
  createGain() { const node = { gain: { value: 1 }, to: null, connect(t) { node.to = t; }, disconnect() { node.to = null; } }; this.nodes.push(node); return node; }
  createBufferSource() {
    const source = { playbackRate: { value: 1 }, started: false, stopped: false, to: null, connect(t) { source.to = t; }, start() { source.started = true; }, stop() { source.stopped = true; source.onended?.(); } };
    this.sources.push(source);
    return source;
  }
  async resume() { this.state = "running"; }
  async decodeAudioData(bytes) { return { decoded: bytes.byteLength }; }
}

test("the WebAudio backend creates its context lazily and routes a voice through the master gain", async () => {
  FakeAudioContext.made = 0;
  const audio = createWebAudio({ AudioContext: FakeAudioContext });
  assert.equal(FakeAudioContext.made, 0, "no context before first use");
  assert.equal(audio.state(), "idle");
  await audio.resume();
  assert.equal(audio.state(), "running");
  assert.deepEqual(await audio.decode(new ArrayBuffer(8)), { decoded: 8 });
  let ended = 0;
  const voice = audio.play({ sound: "BUF", gain: 0.5, pitch: 1.2, onEnded: () => { ended += 1; } });
  assert.equal(FakeAudioContext.made, 1);
  voice.stop();
  assert.equal(ended, 1);
});

test("the mixer drives the WebAudio backend end to end", async () => {
  const audio = createWebAudio({ AudioContext: FakeAudioContext });
  const mixer = createMixer({ assets: { hit: "BUF" }, map: { d: { sound: "hit", gain: 0.4 } }, context: audio, maxVoices: 2 });
  mixer.unlock();
  await audio.resume();
  assert.equal(mixer.onSnapshot({ d: [0, 1, 2] }), 3);
  assert.equal(mixer.voices(), 2);
  mixer.setMuted(true);
  assert.equal(mixer.onSnapshot({ d: [0] }), 0);
  assert.equal(mixer.voices(), 2, "muting stops no voice");
});

test("without WebAudio the backend is absent and the mixer stays a silent no-op", () => {
  assert.equal(createWebAudio({ AudioContext: null }), null);
  const mixer = createMixer({ assets: { hit: 1 }, map: { d: "hit" }, context: createWebAudio({ AudioContext: null }) });
  mixer.unlock();
  assert.equal(mixer.onSnapshot({ d: [0] }), 0);
});

test("a store that throws on access leaves mute working for the session", () => {
  const storage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const { mixer } = mixerWith({ d: "hit" }, { storage });
  assert.equal(mixer.setMuted(true), true);
  assert.equal(mixer.muted(), true);
  assert.equal(mixer.setMuted(false), false);
  assert.equal(mixer.onSnapshot({ d: [0] }), 1);
});
