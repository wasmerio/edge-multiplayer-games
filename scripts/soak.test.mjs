// Phase 10: the soak harness, with short runs and planted faults.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judge, monotonicGrowth, parseArgs } from './soak.mjs';
import { findBrowser } from './lib/browser.mjs';
import { SERIES } from '../engine/diagnostics.js';
import { SNAPSHOT_BUDGET_BYTES, SOAK_DURATION_MS, SOAK_MEMORY_GROWTH_BYTES, SOAK_TICK_TOLERANCE } from '../engine/params.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-test-'));
const noBrowser = findBrowser() ? false : 'no Chrome or Chromium on this machine';

function soak(args, env = {}) {
  const file = path.join(scratch, `report-${Math.random().toString(36).slice(2)}.json`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/soak.mjs', 'achtung', '--report', file, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ code, output, file, report: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null }));
  });
}
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const named = (run, name) => run.report.failures.filter((failure) => failure.name === name);

const page = (extra = {}) => ({
  label: 'host', achievedHz: 30, worst: { bytes: 40, tick: 3 }, breaches: [], heap: [5, 4, 6], errors: [], requests: [], ...extra,
});
const verdict = (pages, extra = {}) => judge({ pages, tickHz: 30, players: 2, origin: 'http://127.0.0.1:1', ...extra }).map((f) => f.name);

test('the default duration is the soak parameter and the flags override it', () => {
  assert.equal(parseArgs(['achtung']).durationMs, SOAK_DURATION_MS);
  assert.deepEqual(
    (({ game, durationMs, guests, report }) => ({ game, durationMs, guests, report }))(parseArgs(['achtung', '--duration', '5', '--guests', '3', '--report', '/tmp/r.json'])),
    { game: 'achtung', durationMs: 5000, guests: 3, report: '/tmp/r.json' },
  );
  assert.throws(() => parseArgs(['achtung', '--inject', 'gremlins']), /--inject takes/);
  assert.throws(() => parseArgs(['achtung', '--bogus']), /unknown option --bogus/);
});

test('a clean set of pages passes', () => {
  assert.deepEqual(verdict([page(), page({ label: 'guest-1' })]), []);
});

test('a logged error on any page fails the run', () => {
  assert.deepEqual(verdict([page(), page({ label: 'guest-1', errors: ['TypeError: boom'] })]), ['logged_error']);
});

test('a snapshot over the budget fails naming the tick and the size', () => {
  const allowance = SNAPSHOT_BUDGET_BYTES * 2;
  assert.deepEqual(verdict([page({ worst: { bytes: allowance, tick: 9 } })]), [], 'exactly the budget is inside it');
  const failures = judge({ pages: [page({ worst: { bytes: allowance + 1, tick: 9 } })], tickHz: 30, players: 2, origin: 'x' });
  assert.equal(failures[0].name, 'snapshot_over_budget');
  assert.match(failures[0].detail, new RegExp(`tick 9 carried ${allowance + 1} bytes`));
  assert.deepEqual(verdict([page({ breaches: [{ tick: 4, bytes: 90, budget: 80 }] })]), ['snapshot_over_budget'], "a breach of the game's own budget counts");
});

test('a tick rate outside the tolerance fails, inside it passes', () => {
  assert.deepEqual(verdict([page({ achievedHz: 30 * (1 - SOAK_TICK_TOLERANCE) + 0.01 })]), []);
  assert.deepEqual(verdict([page({ achievedHz: 30 * (1 - SOAK_TICK_TOLERANCE) - 0.5 })]), ['tick_rate']);
  assert.deepEqual(verdict([page({ achievedHz: 30 * (1 + SOAK_TICK_TOLERANCE) + 0.5 })]), ['tick_rate']);
  assert.deepEqual(verdict([page({ achievedHz: NaN })]), ['tick_rate']);
});

test('memory that grows at every sample past the noise floor fails naming the series', () => {
  const big = SOAK_MEMORY_GROWTH_BYTES;
  assert.equal(monotonicGrowth([1, 2, 3, 4]), false, 'small growth is noise');
  assert.equal(monotonicGrowth([0, big, 2 * big, 3 * big]), true);
  assert.equal(monotonicGrowth([0, big, big - 1, 3 * big]), false, 'one dip means the heap was collected');
  assert.equal(monotonicGrowth([0, 9 * big]), false, 'two samples are not a trend');
  const failures = judge({ pages: [page({ heap: [0, big, 2 * big, 3 * big] })], tickHz: 30, players: 2, origin: 'x' });
  assert.equal(failures[0].name, 'memory_growth');
  assert.match(failures[0].detail, /series heap grew at every one of 4 samples/);
});

test('a request beyond the local server fails the run', () => {
  const origin = 'http://127.0.0.1:1';
  assert.deepEqual(verdict([page({ requests: [`${origin}/client.js`, 'data:image/png;base64,AA=='] })], { origin }), []);
  assert.deepEqual(verdict([page({ requests: ['https://cdn.example/lib.js'] })], { origin }), ['external_request']);
});

test('a missing browser fails with a named prerequisite and still writes a report', async () => {
  const run = await soak(['--duration', '1'], { CHROME_BIN: path.join(scratch, 'no-such-chrome') });
  assert.equal(run.code, 1);
  assert.equal(run.report.pass, false);
  assert.match(named(run, 'browser_unavailable')[0].detail, /prerequisite missing/);
  assert.match(run.output, /FAIL browser_unavailable/);
});

test('with no report path the report goes to the OS temp directory, never the repository', async () => {
  const child = spawn(process.execPath, ['scripts/soak.mjs', 'achtung', '--duration', '1'], { cwd: ROOT, env: { ...process.env, CHROME_BIN: '/no/such/chrome' } });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  await new Promise((resolve) => child.on('exit', resolve));
  const file = output.match(/report (\S+)/)[1];
  assert.ok(file.startsWith(os.tmpdir()) && !file.startsWith(ROOT));
  fs.rmSync(file);
});

let clean;
let faulty;
before(async () => {
  if (noBrowser) return;
  clean = await soak(['--duration', '4', '--guests', '1', '--port', '8861']);
  faulty = await soak(['--duration', '4', '--guests', '1', '--port', '8862', '--inject', 'error,leak', '--budget-bytes', '1']);
}, { timeout: 120_000 });

test('a soak run of a conforming game passes and writes its report', { skip: noBrowser }, () => {
  assert.equal(clean.code, 0, clean.output);
  assert.equal(clean.report.pass, true);
  assert.deepEqual(clean.report.failures, []);
  assert.deepEqual(clean.report.pages.map((p) => p.label), ['host', 'guest-1']);
  assert.equal(clean.report.players, 2);
  assert.match(clean.output, /PASS soak achtung/);
});

test('the run reports a tick rate within tolerance, driven by the worker clock', { skip: noBrowser }, () => {
  const host = clean.report.pages[0];
  assert.ok(Math.abs(host.achievedHz - clean.report.tickHz) / clean.report.tickHz <= SOAK_TICK_TOLERANCE, `host achieved ${host.achievedHz}`);
  assert.equal(clean.report.workerLoop, true);
});

test('the overlay enabled by the query parameter shows every series on every peer', { skip: noBrowser }, () => {
  for (const peer of clean.report.pages) {
    assert.deepEqual(peer.overlaySeries, SERIES, peer.label);
    assert.ok(peer.samples > 0, `${peer.label} sampled`);
    assert.ok(peer.worst.bytes > 0 && peer.worst.bytes <= SNAPSHOT_BUDGET_BYTES * clean.report.players, `${peer.label} measured its snapshots`);
    assert.ok(peer.outPerSec > 0 && peer.inPerSec > 0, `${peer.label} counted bytes both ways`);
    assert.ok(peer.rttMs !== null && peer.rttMs >= 0, `${peer.label} measured a round trip`);
  }
  assert.ok(clean.report.pages.slice(1).every((peer) => peer.bufferDepth > 0), 'every guest holds a snapshot buffer');
});

test('the run reaches nothing beyond the local server', { skip: noBrowser }, () => {
  assert.deepEqual(named(clean, 'external_request'), []);
  assert.ok(clean.report.pages.every((peer) => peer.requests > 0));
});

test('an injected error fails the run', { skip: noBrowser }, () => {
  assert.equal(faulty.code, 1);
  assert.equal(faulty.report.pass, false);
  assert.match(named(faulty, 'logged_error')[0].detail, /soak: injected error/);
});

test('a snapshot over the asserted budget fails the run naming the tick and the size', { skip: noBrowser }, () => {
  const failure = named(faulty, 'snapshot_over_budget')[0];
  assert.match(failure.detail, /tick \d+ carried \d+ bytes, over the 2 byte budget/);
  assert.ok(fs.existsSync(faulty.file), 'the report is written on failure too');
});

test('an injected leak fails the run naming the memory series', { skip: noBrowser }, () => {
  const failure = named(faulty, 'memory_growth')[0];
  assert.equal(failure.page, 'host');
  assert.match(failure.detail, /series heap grew/);
});

test('a run that cannot reach a started game in time fails naming the timeout', { skip: noBrowser }, async () => {
  const run = await soak(['--duration', '1', '--guests', '1', '--port', '8863', '--timeout', '0.001']);
  assert.equal(run.code, 1);
  assert.match(named(run, 'timeout')[0].detail, /timed out after 1 ms while /);
});
