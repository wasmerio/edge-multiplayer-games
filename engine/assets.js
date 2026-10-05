// Shared assets live beside the engine on the superapp origin. A manifest
// carries its version in its filename, because JSON inherits a short cache
// lifetime and a stable name would hide an update.
import { ASSET_SET_VERSION, SUPERAPP_ORIGIN } from "./params.js";

export const SOUND_NAMES = ["blip", "hit", "score", "start", "win"];

export function manifestUrl(origin, version) {
  return `${origin}/assets/${version}/manifest-${version}.json`;
}

// The set beside a published engine; a vendored or local module falls back to the superapp.
export function manifestUrlFor(moduleUrl, version = ASSET_SET_VERSION) {
  const published = /^(https?:\/\/[^/]+)\/engine\/[^/]+\/[^/]+$/.exec(String(moduleUrl));
  return manifestUrl(published ? published[1] : SUPERAPP_ORIGIN, version);
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function loadAssets(url, names, deps = {}) {
  if (!/manifest-[^/]+\.json$/.test(String(url))) {
    throw new Error("loadAssets: manifest URL must carry its version in the filename");
  }
  const fetchImpl = deps.fetch || globalThis.fetch;
  const decodeImage = deps.decodeImage || defaultDecodeImage;
  const decodeAudio = deps.decodeAudio || defaultDecodeAudio;
  const onProgress = deps.onProgress || (() => {});

  const digest = deps.digest ?? globalThis.crypto?.subtle?.digest?.bind(globalThis.crypto.subtle);
  const request = { credentials: "omit" };

  const response = await fetchImpl(url, request);
  if (!response.ok) throw new Error(`loadAssets: manifest ${url} answered ${response.status}`);
  let manifest;
  try { manifest = await response.json(); } catch (error) { throw new Error(`loadAssets: manifest is not JSON: ${error.message}`); }

  const base = String(url).replace(/manifest-[^/]+\.json$/, "");
  const wanted = names && names.length ? names : Object.keys(manifest.assets || {});
  const assets = {};
  const failures = {};
  let done = 0;

  for (const name of wanted) {
    const entry = manifest.assets?.[name];
    try {
      if (!entry) throw new Error(`asset ${name} is not in the manifest`);
      if (/^([a-z]+:|\/)|(^|\/)\.\.(\/|$)/i.test(entry.path)) throw new Error(`asset ${name} path ${entry.path} leaves the version directory`);
      const res = await fetchImpl(base + entry.path, request);
      if (!res.ok) throw new Error(`asset ${name} answered ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (entry.bytes !== undefined && bytes.byteLength !== entry.bytes) {
        throw new Error(`asset ${name} is ${bytes.byteLength} bytes, manifest declares ${entry.bytes}`);
      }
      if (entry.sha256 && digest && hex(await digest("SHA-256", bytes)) !== entry.sha256) {
        throw new Error(`asset ${name} does not match its manifest content hash`);
      }
      assets[name] = await decodeOne(entry, bytes, { decodeImage, decodeAudio });
    } catch (error) {
      failures[name] = error.message;
    }
    done += 1;
    onProgress({ done, total: wanted.length, name });
  }
  return { assets, failures, manifest };
}

async function decodeOne(entry, bytes, { decodeImage, decodeAudio }) {
  switch (entry.type) {
    case "json":
      return JSON.parse(new TextDecoder().decode(bytes));
    case "image":
      return decodeImage(bytes, entry);
    case "audio":
      return decodeAudio(bytes, entry);
    case "binary":
      return bytes;
    default:
      throw new Error(`asset type ${entry.type} is not supported`);
  }
}

const defaultDecodeImage = (bytes, entry) => new Promise((resolve, reject) => {
  const blob = new Blob([bytes], { type: entry.mime || "image/png" });
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`asset ${entry.path} could not be decoded as an image`));
  image.src = URL.createObjectURL(blob);
});

const defaultDecodeAudio = async (bytes) => {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error("no audio context available");
  return new Context().decodeAudioData(bytes);
};

export function auditLedger(manifest, ledger) {
  const assets = Object.keys(manifest.assets || {});
  const rows = Object.keys(ledger || {});
  return {
    missingLedgerRow: assets.filter((name) => !rows.includes(name)),
    orphanLedgerRow: rows.filter((name) => !assets.includes(name)),
    missingLicence: rows.filter((name) => !ledger[name]?.licence),
  };
}
