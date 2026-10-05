// Phase 7: the committed asset set, its ledger, and the loader against a real server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAssets, manifestUrl, manifestUrlFor, auditLedger, SOUND_NAMES } from "../assets.js";
import { createServer } from "../server.js";
import { PLAYER_COLOURS } from "../palette.js";
import { ASSET_SET_VERSION, SUPERAPP_ORIGIN } from "../params.js";

const require = createRequire(new URL("../../achtung/package.json", import.meta.url));
const { WebSocketServer } = require("ws");

const superappDir = new URL("../../public/", import.meta.url).pathname;
const setDir = path.join(superappDir, "assets", ASSET_SET_VERSION);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(setDir, name), "utf8"));
const manifest = readJson(`manifest-${ASSET_SET_VERSION}.json`);
const ledger = readJson(`ledger-${ASSET_SET_VERSION}.json`);

// Enough of a decoder to prove the bytes are the sound the manifest promises.
const decodeWav = (bytes) => {
  const view = new DataView(bytes);
  const tag = (at) => String.fromCharCode(...new Uint8Array(bytes, at, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  return { sampleRate: view.getUint32(24, true), frames: view.getUint32(40, true) / view.getUint16(32, true) };
};
const decoders = { decodeAudio: decodeWav, decodeImage: (bytes) => new TextDecoder().decode(bytes) };

async function withServer(run) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-assets-"));
  fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>game</title>");
  const app = createServer({ publicDir, superappDir, webSocketServer: WebSocketServer, sweepEvery: 1_000_000 });
  const address = await app.listen(0, "127.0.0.1");
  try { return await run(`http://127.0.0.1:${address.port}`); } finally { await app.close(); }
}

test("the asset set lives in a directory and a manifest both named by its version", () => {
  assert.ok(fs.existsSync(path.join(setDir, `manifest-${ASSET_SET_VERSION}.json`)));
  assert.equal(manifest.version, ASSET_SET_VERSION);
  assert.ok(!fs.existsSync(path.join(superappDir, "assets", "manifest.json")), "no stable manifest name exists");
  const next = manifestUrl(SUPERAPP_ORIGIN, "9.9.9");
  assert.notEqual(next, manifestUrl(SUPERAPP_ORIGIN, ASSET_SET_VERSION));
  assert.match(next, /\/assets\/9\.9\.9\/manifest-9\.9\.9\.json$/, "a new set is a new directory and a new manifest name");
});

test("every manifest entry gives a path, a type, a byte length and a content hash that match the file", () => {
  for (const [name, entry] of Object.entries(manifest.assets)) {
    const bytes = fs.readFileSync(path.join(setDir, entry.path));
    assert.ok(["json", "image", "audio", "binary"].includes(entry.type), `${name} has a known type`);
    assert.equal(entry.bytes, bytes.length, `${name} byte length`);
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"), `${name} content hash`);
  }
});

test("every asset has a ledger row with a source, a licence and an attribution, and no row is orphaned", () => {
  assert.deepEqual(auditLedger(manifest, ledger), { missingLedgerRow: [], orphanLedgerRow: [], missingLicence: [] });
  for (const [name, row] of Object.entries(ledger)) {
    for (const field of ["source", "licence", "attribution"]) assert.ok(row[field], `${name} states its ${field}`);
  }
});

test("the first asset set is first-party only", () => {
  for (const [name, row] of Object.entries(ledger)) assert.match(row.source, /Generated in this repository/, name);
});

test("the palette asset agrees with the engine's palette", () => {
  assert.deepEqual(readJson("palette.json").players, PLAYER_COLOURS);
});

test("the default sound names are exactly the sounds in the manifest, each small", () => {
  const audio = Object.entries(manifest.assets).filter(([, entry]) => entry.type === "audio");
  assert.deepEqual(audio.map(([name]) => name).sort(), [...SOUND_NAMES].sort());
  for (const [name, entry] of audio) assert.ok(entry.bytes < 32 * 1024, `${name} is ${entry.bytes} bytes`);
});

test("the manifest beside a published engine is used, and a vendored engine falls back to the superapp", () => {
  assert.equal(
    manifestUrlFor("http://127.0.0.1:8765/engine/1.0.0/engine.js"),
    manifestUrl("http://127.0.0.1:8765", ASSET_SET_VERSION),
  );
  assert.equal(manifestUrlFor(`${SUPERAPP_ORIGIN}/engine/1.0.0/assets.js`), manifestUrl(SUPERAPP_ORIGIN, ASSET_SET_VERSION));
  assert.equal(manifestUrlFor("https://game.example/engine/engine.js"), manifestUrl(SUPERAPP_ORIGIN, ASSET_SET_VERSION));
  assert.equal(manifestUrlFor("file:///repo/engine/engine.js"), manifestUrl(SUPERAPP_ORIGIN, ASSET_SET_VERSION));
});

test("the whole set loads by name from a real server with real hashing, reporting progress per asset", async () => {
  await withServer(async (origin) => {
    const progress = [];
    const requested = [];
    const fetchSpy = (url, init) => { requested.push([String(url), init]); return fetch(url, init); };
    const result = await loadAssets(manifestUrl(origin, ASSET_SET_VERSION), null, { ...decoders, fetch: fetchSpy, onProgress: (p) => progress.push(p) });
    assert.deepEqual(result.failures, {});
    assert.deepEqual(Object.keys(result.assets).sort(), Object.keys(manifest.assets).sort());
    assert.deepEqual(result.assets.palette.players, PLAYER_COLOURS);
    assert.match(result.assets["ui-sprites"], /^<svg /);
    assert.ok(result.assets.hit.frames > 0 && result.assets.hit.sampleRate > 0);
    assert.equal(progress.length, Object.keys(manifest.assets).length);
    assert.equal(progress.at(-1).done, progress.at(-1).total);
    const inside = `${origin}/assets/${ASSET_SET_VERSION}/`;
    for (const [url, init] of requested) {
      assert.ok(url.startsWith(inside), `${url} stays inside the version directory`);
      assert.equal(init.credentials, "omit", "no credentialled request");
    }
  });
});

test("a shared file answers a cross-origin request with the permissive header and its media type", async () => {
  await withServer(async (origin) => {
    const res = await fetch(`${origin}/assets/${ASSET_SET_VERSION}/sounds/hit.wav`, { headers: { Origin: "https://game.example" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("content-type"), "audio/wav");
    const engine = await fetch(`${origin}/engine/1.0.0/engine.js`);
    assert.equal(engine.headers.get("access-control-allow-origin"), "*");
  });
});

// A real server over a copy of the set, so a test can damage one file.
async function withDamagedSet(damage, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "engine-superapp-"));
  fs.cpSync(setDir, path.join(root, "assets", ASSET_SET_VERSION), { recursive: true });
  damage(path.join(root, "assets", ASSET_SET_VERSION));
  const app = createServer({ publicDir: root, superappDir: root, webSocketServer: WebSocketServer, sweepEvery: 1_000_000 });
  const address = await app.listen(0, "127.0.0.1");
  try { return await run(manifestUrl(`http://127.0.0.1:${address.port}`, ASSET_SET_VERSION)); } finally { await app.close(); }
}

test("a truncated file fails by its byte length and the rest of the batch loads", async () => {
  await withDamagedSet(
    (dir) => fs.truncateSync(path.join(dir, "sounds/hit.wav"), 100),
    async (url) => {
      const progress = [];
      const result = await loadAssets(url, ["hit", "blip", "palette"], { ...decoders, onProgress: (p) => progress.push(p) });
      assert.match(result.failures.hit, /is 100 bytes, manifest declares \d+/);
      assert.ok(result.assets.blip && result.assets.palette);
      assert.equal(progress.length, 3, "progress still completes");
    },
  );
});

test("a file with the right length and the wrong content fails its content hash", async () => {
  await withDamagedSet(
    (dir) => { const file = path.join(dir, "sounds/blip.wav"); const bytes = fs.readFileSync(file); bytes[60] ^= 0xff; fs.writeFileSync(file, bytes); },
    async (url) => {
      const result = await loadAssets(url, ["blip", "palette"], decoders);
      assert.match(result.failures.blip, /does not match its manifest content hash/);
      assert.ok(result.assets.palette);
    },
  );
});

test("a file missing from the server reports its failure and loses nothing already loaded", async () => {
  await withDamagedSet(
    (dir) => fs.rmSync(path.join(dir, "sounds/win.wav")),
    async (url) => {
      const result = await loadAssets(url, ["palette", "win", "score"], decoders);
      assert.match(result.failures.win, /answered 404/);
      assert.deepEqual(Object.keys(result.assets).sort(), ["palette", "score"]);
    },
  );
});

test("a sound that will not decode fails alone", async () => {
  await withServer(async (origin) => {
    const result = await loadAssets(manifestUrl(origin, ASSET_SET_VERSION), ["hit", "palette"], {
      decodeAudio: () => { throw new Error("unable to decode audio data"); },
    });
    assert.match(result.failures.hit, /unable to decode/);
    assert.ok(result.assets.palette);
  });
});

test("an absent manifest is refused naming its URL", async () => {
  await withServer(async (origin) => {
    const url = manifestUrl(origin, "0.0.0");
    await assert.rejects(() => loadAssets(url, ["palette"]), (error) => error.message.includes(url) && /answered 404/.test(error.message));
  });
});

test("a manifest entry that points outside the version directory is refused without a request", async () => {
  for (const escape of ["../../engine/1.0.0/engine.js", "/healthz", "https://elsewhere.example/a.wav"]) {
    const requested = [];
    const url = manifestUrl(SUPERAPP_ORIGIN, ASSET_SET_VERSION);
    const result = await loadAssets(url, ["bad"], {
      fetch: async (target) => {
        requested.push(String(target));
        return { ok: true, status: 200, json: async () => ({ assets: { bad: { path: escape, type: "binary" } } }), arrayBuffer: async () => new ArrayBuffer(1) };
      },
    });
    assert.match(result.failures.bad, /leaves the version directory/);
    assert.deepEqual(requested, [url]);
  }
});
