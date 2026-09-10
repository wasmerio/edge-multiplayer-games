import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pendingGames, registerGame } from './register-game.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-catalog-'));
try {
  fs.mkdirSync(path.join(root, 'public'));
  fs.mkdirSync(path.join(root, 'new-game'));
  const original = { slug: 'existing', name: 'Existing', url: 'https://existing.wasmer.app',
    players: '2 to 8', description: 'Existing game.', source: 'existing/' };
  const metadata = { slug: 'new-game', name: 'New game', players: '2 to 8',
    description: 'A new game.', source: 'new-game/' };
  const catalog = path.join(root, 'public/games.json');
  fs.writeFileSync(catalog, JSON.stringify([original]));
  fs.writeFileSync(path.join(root, '.ignore'), '/scripts/\n');
  fs.writeFileSync(path.join(root, 'new-game/game-entry.json'), JSON.stringify(metadata));
  assert.deepEqual(pendingGames(root), ['new-game']);
  registerGame(root, 'new-game', 'https://actual-deployment.wasmer.app/');
  const expected = [original, { ...metadata, url: 'https://actual-deployment.wasmer.app' }];
  assert.deepEqual(JSON.parse(fs.readFileSync(catalog)), expected);
  assert.deepEqual(pendingGames(root), []);
  const once = fs.readFileSync(catalog, 'utf8');
  registerGame(root, 'new-game', 'https://actual-deployment.wasmer.app');
  assert.equal(fs.readFileSync(catalog, 'utf8'), once);
  assert.equal(fs.readFileSync(path.join(root, '.ignore'), 'utf8'), '/scripts/\n/new-game/\n');
  registerGame(root, 'existing', 'https://updated.wasmer.app');
  assert.equal(JSON.parse(fs.readFileSync(catalog))[0].url, 'https://updated.wasmer.app');
  assert.throws(() => registerGame(root, 'new-game', 'http://invalid.example'), /HTTPS/);
  assert.throws(() => registerGame(root, '../escape', 'https://valid.example'), /slug/);
  assert.throws(() => registerGame(root, 'missing', 'https://valid.example'), /game-entry/);
  fs.writeFileSync(catalog, JSON.stringify([original, { ...metadata, url: null }]));
  assert.deepEqual(pendingGames(root), ['new-game']);
  registerGame(root, 'new-game', 'https://actual-deployment.wasmer.app');
  assert.deepEqual(JSON.parse(fs.readFileSync(catalog)), expected);
  console.log('PASS catalog insertion, URL update, pending entry, preservation, validation, and idempotence');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
