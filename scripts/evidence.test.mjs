// Repository-wide evidence for engine phases 1, 3 and 4: one loop, one server, every game in budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runConformance, stripSource } from './conformance.mjs';
import { engineVersion } from './sync-engine.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = engineVersion(REPO);
// Every published version: the current one mirrors engine/, earlier ones are frozen (D-24).
const PUBLISHED = fs.readdirSync(path.join(REPO, 'public/engine')).filter((name) => /^\d+\.\d+\.\d+$/.test(name)).sort();
const withCopies = (name) => [`engine/${name}`, ...PUBLISHED.map((version) => `public/engine/${version}/${name}`)].sort();
const catalog = JSON.parse(fs.readFileSync(path.join(REPO, 'public/games.json'), 'utf8'));
const games = (Array.isArray(catalog) ? catalog : catalog.games).map((entry) => entry.slug);

// Every file git would track: committed or new, never an ignored deploy-time copy.
const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
const sources = listed.stdout.split('\n')
  .filter((file) => /\.m?js$/.test(file) && fs.existsSync(path.join(REPO, file)))
  .filter((file) => !/(^|\/)test\//.test(file) && !/\.test\.m?js$/.test(file));
const code = (file) => stripSource(fs.readFileSync(path.join(REPO, file), 'utf8')).text;

test('the catalog lists the games this scan covers', () => {
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(games.length >= 7, `${games.length} games`);
  for (const slug of games) assert.ok(fs.existsSync(path.join(REPO, slug, 'public/game.js')), slug);
});

test('one signaling server implementation exists, plus its published copies', () => {
  assert.ok(PUBLISHED.includes(VERSION), `engine ${VERSION} is not published`);
  const serving = sources.filter((file) => /\bhttp\.createServer\s*\(|\.handleUpgrade\s*\(|new\s+WebSocketServer\s*\(/.test(code(file)));
  assert.deepEqual(serving.sort(), withCopies('server.js'));
  assert.ok(
    fs.readFileSync(path.join(REPO, 'engine/server.js')).equals(fs.readFileSync(path.join(REPO, `public/engine/${VERSION}/server.js`))),
    'the published copy is the source, byte for byte',
  );
});

test('a frozen engine version is exactly what git last recorded for it', () => {
  for (const version of PUBLISHED.filter((each) => each !== VERSION)) {
    const dirty = spawnSync('git', ['status', '--porcelain', '--', `public/engine/${version}`], { cwd: REPO, encoding: 'utf8' });
    assert.equal(dirty.stdout.trim(), '', `public/engine/${version} is frozen; ship a fix as a new version directory`);
  }
});

test('a deploy-time copy of the server inside a game is ignored by git', () => {
  for (const slug of games) {
    const ignored = spawnSync('git', ['check-ignore', '-q', `${slug}/engine/server.js`], { cwd: REPO });
    assert.equal(ignored.status, 0, `${slug}/engine/server.js would be tracked`);
  }
});

for (const slug of games) {
  test(`${slug}: the server entry is one serveGame call and nothing else`, () => {
    const entry = code(`${slug}/src/server.js`);
    const imports = [...entry.matchAll(/^import .* from (.*);$/gm)].map((m) => m[1]);
    assert.equal(imports.length, 3);
    assert.equal((entry.match(/\bserveGame\s*\(/g) || []).length, 1);
    assert.doesNotMatch(entry, /createServer|WebSocket|listen\s*\(|setInterval/);
  });
}

test('the fixed-tick accumulator exists once among the sources', () => {
  const accumulating = sources.filter((file) => /\bacc(umulator)?\s*[-+]=/.test(code(file)));
  assert.deepEqual(accumulating.sort(), withCopies('loop.js'));
});

for (const slug of games) {
  test(`${slug}: no loop or server of its own, a fixture that replays, and snapshots inside the budget at the player cap`, async () => {
    const result = await runConformance(path.join(REPO, slug), { static: true });
    const rows = Object.fromEntries(result.rows.map((row) => [row.id, row]));
    for (const id of ['accumulator', 'server', 'netcode', 'simulation', 'fixture', 'budget']) {
      assert.equal(rows[id].status, 'pass', `${slug} ${id}: ${rows[id].detail}`);
    }
  });
}
