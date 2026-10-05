import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAssets, manifestUrl, auditLedger } from "../assets.js";
import { createMixer } from "../audio.js";
import { createCollector } from "../diagnostics.js";
import { colourFor, PLAYER_COLOURS } from "../palette.js";
import { seededRng } from "../rng.js";
import { MAX_PLAYERS_PER_ROOM, ASSET_SET_VERSION, DIAG_SAMPLE_INTERVAL_MS, SUPERAPP_ORIGIN } from "../params.js";

const manifest = {
  assets: {
    palette: { path: "palette.json", type: "json", bytes: 11 },
    pop: { path: "pop.bin", type: "binary", bytes: 4 },
    broken: { path: "missing.bin", type: "binary" },
    weird: { path: "weird.xyz", type: "hologram" },
  },
};
const url = manifestUrl(SUPERAPP_ORIGIN, ASSET_SET_VERSION);
const fakeFetch = (overrides = {}) => async (target) => {
  const body = {
    [url]: JSON.stringify(manifest),
    [`${SUPERAPP_ORIGIN}/assets/${ASSET_SET_VERSION}/palette.json`]: '{"ok":true}',
    [`${SUPERAPP_ORIGIN}/assets/${ASSET_SET_VERSION}/pop.bin`]: "abcd",
    [`${SUPERAPP_ORIGIN}/assets/${ASSET_SET_VERSION}/weird.xyz`]: "x",
    ...overrides,
  }[target];
  if (body === undefined) return { ok: false, status: 404 };
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
};

test("a manifest URL carries its version in the filename", () => {
  assert.match(url, new RegExp(`/assets/${ASSET_SET_VERSION}/manifest-${ASSET_SET_VERSION}\\.json$`));
});

test("an unversioned manifest URL is refused before any request", async () => {
  let called = false;
  await assert.rejects(
    () => loadAssets(`${SUPERAPP_ORIGIN}/assets/manifest.json`, ["palette"], { fetch: () => { called = true; } }),
    /must carry its version/,
  );
  assert.equal(called, false);
});

test("named assets load and report progress", async () => {
  const progress = [];
  const result = await loadAssets(url, ["palette", "pop"], { fetch: fakeFetch(), onProgress: (p) => progress.push(p) });
  assert.deepEqual(result.assets.palette, { ok: true });
  assert.equal(result.assets.pop.byteLength, 4);
  assert.deepEqual(result.failures, {});
  assert.equal(progress.length, 2);
});

test("one missing asset leaves the batch usable", async () => {
  const result = await loadAssets(url, ["palette", "broken"], { fetch: fakeFetch() });
  assert.deepEqual(result.assets.palette, { ok: true });
  assert.match(result.failures.broken, /answered 404/);
});

test("a byte length that disagrees with the manifest fails that asset only", async () => {
  const result = await loadAssets(url, ["pop", "palette"], {
    fetch: fakeFetch({ [`${SUPERAPP_ORIGIN}/assets/${ASSET_SET_VERSION}/pop.bin`]: "abcdefgh" }),
  });
  assert.match(result.failures.pop, /manifest declares 4/);
  assert.ok(result.assets.palette);
});

test("an unsupported asset type fails by name", async () => {
  const result = await loadAssets(url, ["weird"], { fetch: fakeFetch() });
  assert.match(result.failures.weird, /type hologram is not supported/);
});

test("a missing manifest is rejected", async () => {
  await assert.rejects(() => loadAssets(url, ["palette"], { fetch: async () => ({ ok: false, status: 503 }) }), /answered 503/);
});

test("a manifest that is not JSON is rejected", async () => {
  await assert.rejects(
    () => loadAssets(url, ["palette"], { fetch: async () => ({ ok: true, json: async () => { throw new Error("bad"); } }) }),
    /not JSON/,
  );
});

test("the ledger audit names assets without a row and rows without an asset", () => {
  const audit = auditLedger(manifest, { palette: { licence: "CC0" }, ghost: { licence: "CC0" }, pop: {} });
  assert.deepEqual(audit.missingLedgerRow, ["broken", "weird"]);
  assert.deepEqual(audit.orphanLedgerRow, ["ghost"]);
  assert.deepEqual(audit.missingLicence, ["pop"]);
});

const fakeContext = () => {
  const started = [];
  return {
    started,
    play: (voice) => { started.push(voice); return { stop() { voice.stopped = true; } }; },
  };
};

test("a snapshot event starts one voice per listed player", () => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context });
  mixer.unlock();
  assert.equal(mixer.onSnapshot({ d: [0, 1] }), 2);
  assert.equal(context.started.length, 2);
});

test("events before the first gesture are discarded, not queued", () => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context });
  assert.equal(mixer.onSnapshot({ d: [0] }), 0);
  mixer.unlock();
  assert.equal(context.started.length, 0);
});

test("the voice cap holds and releases the oldest voice", () => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context, maxVoices: 2 });
  mixer.unlock();
  mixer.onSnapshot({ d: [0, 1, 2, 3] });
  assert.equal(mixer.voices(), 2);
  assert.equal(context.started.length, 4);
});

test("pitch variation comes from the seeded generator", () => {
  const run = () => {
    const context = fakeContext();
    const mixer = createMixer({ assets: { pop: {} }, map: { death: { sound: "pop", pitch: [0.9, 1.1] } }, context });
    mixer.unlock();
    mixer.onSnapshot({ d: [0, 1, 2] }, { rng: seededRng(4) });
    return context.started.map((voice) => voice.pitch);
  };
  assert.deepEqual(run(), run());
  assert.ok(new Set(run()).size > 1);
});

test("mute silences playback and persists per viewer", () => {
  const box = {};
  const storage = { getItem: (k) => box[k] ?? null, setItem: (k, v) => { box[k] = v; } };
  const context = fakeContext();
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context, storage });
  mixer.unlock();
  mixer.setMuted(true);
  assert.equal(mixer.onSnapshot({ d: [0] }), 0);
  assert.equal(box["engine-muted"], "1");
  const again = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context, storage });
  assert.equal(again.muted(), true);
});

test("a blocked store leaves the mixer working", () => {
  const storage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const context = fakeContext();
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context, storage });
  mixer.unlock();
  assert.equal(mixer.muted(), false);
  assert.equal(mixer.setMuted(true), true);
  assert.equal(mixer.onSnapshot({ d: [0] }), 0);
});

test("a missing audio context makes the mixer a silent no-op", () => {
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" } });
  mixer.unlock();
  assert.equal(mixer.onSnapshot({ d: [0, 1] }), 0);
});

test("a mapped sound that is absent is refused at construction", () => {
  assert.throws(() => createMixer({ assets: {}, map: { death: "pop" } }), /missing sound pop/);
  assert.throws(() => createMixer({ assets: { pop: {} }, map: { death: { gain: 2, sound: "pop" } } }), /outside 0 to 1/);
});

test("an unmapped event kind is silent without error", () => {
  const context = fakeContext();
  const mixer = createMixer({ assets: { pop: {} }, map: { death: "pop" }, context });
  mixer.unlock();
  assert.equal(mixer.onSnapshot({ e: [0] }, { eventField: "e", kind: "nothing" }), 0);
});

test("diagnostics collect nothing while disabled", () => {
  const collector = createCollector({ now: () => 0 });
  collector.tick(); collector.sent(50);
  assert.equal(collector.current().ticks, 0);
  assert.equal(collector.sample(), null);
});

test("diagnostics sample at the interval and report a tick rate", () => {
  const clock = { v: 0 };
  const collector = createCollector({ now: () => clock.v, enabled: true });
  for (let i = 0; i < 30; i++) collector.tick();
  collector.sent(80);
  collector.rtt(42);
  clock.v += DIAG_SAMPLE_INTERVAL_MS;
  const row = collector.sample();
  assert.equal(row.ticks, 30);
  assert.equal(row.tickHz, 30);
  assert.equal(row.snapshotBytes, 80);
  assert.equal(row.rtt, 42);
  assert.deepEqual(collector.series("tickHz"), [30]);
});

test("diagnostics fold the interpolation buffer's own counters", () => {
  const collector = createCollector({ now: () => 0, enabled: true });
  collector.buffer({ depth: 3, starved: 2, stale: 1, duplicate: 1 });
  assert.equal(collector.current().bufferDepth, 3);
  assert.equal(collector.current().starved, 2);
  assert.equal(collector.current().staleSnapshots, 2);
});

test("the sample window is bounded", () => {
  const clock = { v: 0 };
  const collector = createCollector({ now: () => clock.v, enabled: true, window: 3 });
  for (let i = 0; i < 10; i++) { clock.v += DIAG_SAMPLE_INTERVAL_MS; collector.sample(); }
  assert.equal(collector.series("at").length, 3);
});

test("the palette is shared and wraps at the player cap", () => {
  assert.equal(colourFor(0), PLAYER_COLOURS[0]);
  assert.equal(colourFor(PLAYER_COLOURS.length), PLAYER_COLOURS[0]);
  assert.ok(PLAYER_COLOURS.length >= MAX_PLAYERS_PER_ROOM, "one colour per seat at the player cap");
});
