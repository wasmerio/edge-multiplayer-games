// The look-at-your-game command: its options, its key table and one real run on a scaffolded game.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { botFile, keyChanges, keyOf, parseArgs, readBot, readScript, runPlay } from './play.mjs';
import { scaffold } from './new-game.mjs';
import { findBrowser } from './lib/live.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'play-test-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('options have defaults, take values and refuse what they do not know', () => {
  const plain = parseArgs(['fuse']);
  assert.deepEqual([plain.game, plain.guests, plain.seconds, plain.frames, plain.phone, plain.late, plain.online], ['fuse', 2, 12, 4, false, true, false]);
  const full = parseArgs(['fuse', '--guests', '3', '--seconds', '5', '--shots', 'out', '--phone', '--keys', 'KeyA, Space', '--no-late', '--frames', '2', '--seed', '7']);
  assert.deepEqual([full.guests, full.seconds, full.shots, full.phone, full.keys, full.late, full.frames, full.seed], [3, 5, 'out', true, ['KeyA', 'Space'], false, 2, 7]);
  assert.throws(() => parseArgs(['fuse', '--fast']), /unknown option --fast/);
  assert.throws(() => parseArgs(['fuse', '--guests']), /--guests needs a value/);
  assert.throws(() => parseArgs(['fuse', '--keys', 'Left']), /unknown key code Left/);
  assert.throws(() => parseArgs(['fuse', '--phone', '--guests', '0']), /--phone needs at least one guest/);
  assert.throws(() => parseArgs(['a', 'b']), /unexpected argument b/);
});

test('--rounds sets a time limit per round unless --seconds gives one', () => {
  assert.equal(parseArgs(['fuse']).rounds, undefined);
  assert.deepEqual([parseArgs(['fuse', '--rounds', '3']).rounds, parseArgs(['fuse', '--rounds', '3']).seconds], [3, 135]);
  assert.equal(parseArgs(['fuse', '--seconds', '20', '--rounds', '3']).seconds, 20);
  assert.throws(() => parseArgs(['fuse', '--rounds', '0']), /--rounds needs a whole number of at least 1/);
  assert.throws(() => parseArgs(['fuse', '--rounds', '1.5']), /--rounds needs a whole number/);
  assert.throws(() => parseArgs(['fuse', '--bot', 'a.mjs', '--no-bot']), /exclude each other/);
});

test('the bot is the one named, else the game\'s own test/bot.mjs; a script or --no-bot outranks it', () => {
  const game = path.join(scratch, 'with-bot');
  fs.mkdirSync(path.join(game, 'test'), { recursive: true });
  assert.equal(botFile(parseArgs([game]), game), null, 'no file, no bot');
  fs.writeFileSync(path.join(game, 'test/bot.mjs'), 'export default () => ({});\n');
  assert.equal(botFile(parseArgs([game]), game), path.join(game, 'test/bot.mjs'));
  assert.equal(botFile(parseArgs([game, '--bot', path.join(scratch, 'other.mjs')]), game), path.join(scratch, 'other.mjs'));
  assert.equal(botFile(parseArgs([game, '--no-bot']), game), null);
  assert.equal(botFile(parseArgs([game, '--script', 's.json']), game), null);
});

test('a bot is one self-contained module with a default export', () => {
  assert.equal(readBot('const a = 1;\nexport default function bot() { return {}; }\n'), 'const a = 1;\nexport default function bot() { return {}; }\n');
  assert.throws(() => readBot('import { x } from "/game.js";\nexport default () => ({});', 'test/bot.mjs'), /test\/bot\.mjs must not import.*info\.game/);
  assert.throws(() => readBot('export const bot = () => ({});'), /needs a default export/);
  assert.doesNotThrow(() => readBot('// import nothing\nexport default () => ({});'));
});

test('the keys a bot names are held, and a key it no longer names is released', () => {
  const held = new Set(['ArrowLeft', 'Space']);
  assert.deepEqual(keyChanges(held, { ArrowLeft: true, ArrowUp: true, Space: false }), { up: ['Space'], down: ['ArrowUp'] });
  assert.deepEqual(keyChanges(held, undefined), { up: ['ArrowLeft', 'Space'], down: [] });
  assert.deepEqual(keyChanges(new Set(), { KeyA: 1, KeyD: 0 }), { up: [], down: ['KeyA'] });
});

test('a key code becomes what the DevTools protocol wants', () => {
  assert.deepEqual(keyOf('ArrowLeft'), { code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  assert.deepEqual(keyOf('KeyJ'), { code: 'KeyJ', key: 'j', windowsVirtualKeyCode: 74 });
  assert.deepEqual(keyOf('Space'), { code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  assert.deepEqual(keyOf('Digit3'), { code: 'Digit3', key: '3', windowsVirtualKeyCode: 51 });
  assert.throws(() => keyOf('space'), /unknown key code space/);
});

test('a script is sorted by time and refused when a step is malformed', () => {
  const steps = readScript('[{ "at": 2, "page": "host", "tap": "Space" }, { "at": 0.5, "page": "all", "down": "KeyA" }, { "at": 1, "shot": "mid" }]');
  assert.deepEqual(steps.map((step) => step.at), [0.5, 1, 2]);
  assert.throws(() => readScript('{}'), /JSON list/);
  assert.throws(() => readScript('[{ "page": "host", "tap": "Space" }]'), /needs "at"/);
  assert.throws(() => readScript('[{ "at": 1, "tap": "Space", "down": "KeyA" }]'), /exactly one of/);
  assert.throws(() => readScript('[{ "at": 1, "tap": "Jump" }]'), /unknown key code Jump/);
});

test('--help prints the usage, and a missing game is a usage error', () => {
  const help = spawnSync(process.execPath, [path.join(REPO, 'scripts/play.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  for (const flag of ['--guests', '--seconds', '--rounds', '--shots', '--phone', '--bot', '--no-bot', '--keys', '--script', '01-lobby-desktop', 'roundsEnded']) assert.ok(help.stdout.includes(flag), flag);
  assert.equal(spawnSync(process.execPath, [path.join(REPO, 'scripts/play.mjs')], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [path.join(REPO, 'scripts/play.mjs'), path.join(scratch, 'nowhere')], { encoding: 'utf8' }).status, 2);
});

test('a scaffolded game is played by a host, a touch phone and a late spectator, with labelled screenshots', { skip: findBrowser() ? false : 'no Chrome or Chromium' }, async () => {
  fs.rmSync(path.join(REPO, 'play-probe'), { recursive: true, force: true });
  const made = await scaffold({ slug: 'play-probe', name: 'Play Probe', root: REPO });
  after(() => fs.rmSync(made.dir, { recursive: true, force: true }));
  fs.symlinkSync(path.join(REPO, 'achtung/node_modules'), path.join(made.dir, 'node_modules'));
  const shots = path.join(scratch, 'shots');
  const script = path.join(scratch, 'script.json');
  fs.writeFileSync(script, JSON.stringify([
    { at: 1.8, page: 'host', down: 'ArrowRight' }, { at: 2.2, page: 'host', tap: 'Space' }, { at: 2.6, shot: 'scripted' }, { at: 3, page: 'host', up: 'ArrowRight' },
  ]));
  const summary = await runPlay({ ...parseArgs([made.dir, '--guests', '1', '--seconds', '5', '--frames', '2', '--phone', '--port', '8871', '--shots', shots, '--script', script]) });
  assert.deepEqual(summary.problems, []);
  assert.equal(summary.ok, true);
  assert.equal(summary.bot, null, 'a script outranks the game\'s bot');
  assert.deepEqual([summary.stopped, summary.final.round, summary.final.over], ['seconds', 1, false]);
  const names = fs.readdirSync(shots).sort();
  assert.deepEqual(names, [
    '01-lobby-desktop.png', '02-lobby-phone.png', '03-room-guest-1.png', '03-room-host.png',
    '04-game-guest-1-01.png', '04-game-guest-1-02.png', '04-game-guest-1-scripted.png',
    '04-game-host-01.png', '04-game-host-02.png', '04-game-host-scripted.png', '06-spectator.png',
  ]);
  for (const name of names) assert.equal(fs.readFileSync(path.join(shots, name)).subarray(1, 4).toString(), 'PNG', name);
  const [host, phone] = summary.pages;
  assert.equal(host.label, 'host');
  assert.equal(host.state.isHost, true);
  assert.equal(host.state.players, 2);
  assert.ok(host.snapshot.k > 30, 'the summary carries the snapshot on screen');
  assert.ok(host.snapshot.x[0] > host.snapshot.x[1] - 2000 && typeof host.hud === 'string');
  assert.equal(phone.phone, true);
  assert.equal(phone.touch, 'on');
  assert.equal(phone.viewport.width, 360);
  assert.equal(phone.scrollsSideways, false);
  assert.ok(phone.arena.width <= 360);
  assert.equal(summary.spectator.state.spectator, true);
  assert.equal(summary.lobbyPhone.scrollsSideways, false);
});

test('the scaffold\'s own bot plays whole rounds, and every round gets its screenshots', { skip: findBrowser() ? false : 'no Chrome or Chromium' }, async () => {
  fs.rmSync(path.join(REPO, 'play-probe-bot'), { recursive: true, force: true });
  const made = await scaffold({ slug: 'play-probe-bot', name: 'Play Probe Bot', root: REPO });
  after(() => fs.rmSync(made.dir, { recursive: true, force: true }));
  fs.symlinkSync(path.join(REPO, 'achtung/node_modules'), path.join(made.dir, 'node_modules'));
  const shots = path.join(scratch, 'bot-shots');
  const summary = await runPlay({ ...parseArgs([made.dir, '--guests', '1', '--rounds', '2', '--frames', '1', '--phone', '--no-late', '--port', '8872', '--shots', shots]) });
  assert.deepEqual(summary.problems, []);
  assert.equal(summary.bot, path.join(made.dir, 'test/bot.mjs'));
  assert.deepEqual([summary.roundsEnded, summary.stopped, summary.final.round, summary.final.over], [2, 'rounds', 2, true]);
  assert.ok(summary.final.scores.reduce((sum, score) => sum + score, 0) >= 10, 'five pellets a round were taken');
  const names = fs.readdirSync(shots);
  for (const name of ['04-game-host-r1-01.png', '04-game-guest-1-r2-01.png', '05-over-host.png', '05-over-guest-1.png', '05-over-host-r2.png', '05-over-guest-1-r2.png']) {
    assert.ok(names.includes(name), `${name} in ${names.join(' ')}`);
  }
  for (const page of summary.pages) assert.ok(page.bot.calls > 20 && page.bot.error === null, `${page.label}: ${JSON.stringify(page.bot)}`);
  assert.equal(summary.pages[1].phone, true);

  // A bot that throws is a problem with its page's name on it, not a silent idle player.
  const broken = path.join(scratch, 'broken-bot.mjs');
  fs.writeFileSync(broken, 'export default (snapshot, info) => { if (info.seat === 1) throw new Error("no plan"); return {}; };\n');
  const failed = await runPlay({ ...parseArgs([made.dir, '--guests', '1', '--seconds', '3', '--frames', '0', '--no-late', '--port', '8872', '--bot', broken]) });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.problems, ['guest-1: the bot threw: Error: no plan']);
});
