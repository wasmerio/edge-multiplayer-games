// Phase 7: the committed asset set is exactly what its generator produces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, check, assetDir } from './make-assets.mjs';
import { ASSET_SET_VERSION } from '../engine/params.js';

test('the committed asset set matches the generator byte for byte', () => {
  assert.deepEqual(check(), []);
});

test('the generator is deterministic', () => {
  const first = build();
  const second = build();
  for (const name of Object.keys(first)) assert.ok(first[name].equals(second[name]), name);
});

test('the set holds a palette, a sprite sheet, five sounds, a manifest and a ledger, and nothing else', () => {
  const files = Object.keys(build()).sort();
  assert.deepEqual(files, [
    `ledger-${ASSET_SET_VERSION}.json`, `manifest-${ASSET_SET_VERSION}.json`, 'palette.json',
    'sounds/blip.wav', 'sounds/hit.wav', 'sounds/score.wav', 'sounds/start.wav', 'sounds/win.wav', 'ui-sprites.svg',
  ]);
  assert.ok(fs.existsSync(path.join(assetDir(), 'ui-sprites.svg')));
});

test('the sprite sheet declares a cell for every sprite the manifest names', () => {
  const manifest = JSON.parse(build()[`manifest-${ASSET_SET_VERSION}.json`]);
  const sheet = String(build()['ui-sprites.svg']);
  const entry = manifest.assets['ui-sprites'];
  for (const [name, column] of Object.entries(entry.sprites)) {
    assert.ok(sheet.includes(`<g id="${name}" transform="translate(${column * entry.cell} 0)">`), name);
  }
});
