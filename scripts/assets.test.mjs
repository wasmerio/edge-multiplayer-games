// Phase 7: the committed asset set is exactly what its generator produces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, check, assetDir, SOUND_NOTES } from './make-assets.mjs';
import { SOUND_NAMES } from '../engine/assets.js';
import { ASSET_SET_VERSION } from '../engine/params.js';

test('the committed asset set matches the generator byte for byte', () => {
  assert.deepEqual(check(), []);
});

test('the generator is deterministic', () => {
  const first = build();
  const second = build();
  for (const name of Object.keys(first)) assert.ok(first[name].equals(second[name]), name);
});

test('the set holds a palette, a sprite sheet, one WAV per sound name, a manifest and a ledger, and nothing else', () => {
  const files = Object.keys(build()).sort();
  assert.deepEqual(files, [
    `ledger-${ASSET_SET_VERSION}.json`, `manifest-${ASSET_SET_VERSION}.json`, 'palette.json',
    ...[...SOUND_NAMES].sort().map((name) => `sounds/${name}.wav`), 'ui-sprites.svg',
  ]);
  assert.ok(fs.existsSync(path.join(assetDir(), 'ui-sprites.svg')));
  assert.deepEqual(Object.keys(SOUND_NOTES).sort(), [...SOUND_NAMES].sort(), 'every sound has a one-line description');
});

test('every sound is audible, unclipped and short', () => {
  const files = build();
  for (const name of SOUND_NAMES) {
    const wav = files[`sounds/${name}.wav`];
    let peak = 0;
    for (let at = 44; at < wav.length; at += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(at)));
    assert.ok(peak > 6000 && peak < 32767, `${name} peaks at ${peak}`);
    assert.ok(wav.length < 30000, `${name} is ${wav.length} bytes`);
  }
});

test('an earlier published set stays on disk for the engine versions that load it', () => {
  const frozen = path.join(assetDir(), '..', '1.0.0');
  for (const name of ['blip', 'hit', 'score', 'start', 'win']) assert.ok(fs.existsSync(path.join(frozen, 'sounds', `${name}.wav`)), name);
  assert.ok(fs.existsSync(path.join(frozen, 'manifest-1.0.0.json')));
});

test('the sprite sheet declares a cell for every sprite the manifest names', () => {
  const manifest = JSON.parse(build()[`manifest-${ASSET_SET_VERSION}.json`]);
  const sheet = String(build()['ui-sprites.svg']);
  const entry = manifest.assets['ui-sprites'];
  for (const [name, column] of Object.entries(entry.sprites)) {
    assert.ok(sheet.includes(`<g id="${name}" transform="translate(${column * entry.cell} 0)">`), name);
  }
});
