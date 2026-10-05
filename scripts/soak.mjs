// Headless soak run of one game: a host and several guests play with scripted
// intents while the engine's own diagnostics are read back.
//   node scripts/soak.mjs <game-dir> [--duration <s>] [--guests N] [--report <file>]
// Exit status 0 when every assertion holds, 1 with named failures, 2 on usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, findBrowser, startGameServer } from './lib/live.mjs';
import { publish, verifyPublished, SERVER_SIDE } from './sync-engine.mjs';
import { seededRng } from '../engine/rng.js';
import {
  SNAPSHOT_BUDGET_BYTES, SOAK_DURATION_MS, SOAK_MEMORY_GROWTH_BYTES, SOAK_MEMORY_SAMPLES,
  SOAK_SETUP_TIMEOUT_MS, SOAK_TICK_TOLERANCE,
} from '../engine/params.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `usage: node scripts/soak.mjs <game-dir> [options]

  --duration <s>      seconds of play (default ${SOAK_DURATION_MS / 1000})
  --guests <n>        guests beside the host (default 2)
  --report <file>     where the JSON report goes (default: the OS temp directory)
  --port <n>          port for the game's server (default: a free one)
  --timeout <s>       limit for reaching a started game (default ${SOAK_SETUP_TIMEOUT_MS / 1000})
  --budget-bytes <n>  per-player snapshot budget to assert (default ${SNAPSHOT_BUDGET_BYTES})
  --inject <faults>   error, leak or both (comma separated): plant a fault to prove the run fails on it
  --help`;

// Keys most games bind; a key a game does not claim is ignored by its input layer.
const KEYS = [
  ['ArrowLeft', 'ArrowLeft', 37], ['ArrowRight', 'ArrowRight', 39], ['ArrowUp', 'ArrowUp', 38], ['ArrowDown', 'ArrowDown', 40],
  ['KeyA', 'a', 65], ['KeyD', 'd', 68], ['KeyW', 'w', 87], ['KeyS', 's', 83],
];
const SPACE = ['Space', ' ', 32];
const STEP_MS = 200;
// Offline name resolution cannot answer mDNS candidates, so peers exchange plain loopback addresses.
const LOOPBACK_RTC = ['--disable-features=WebRtcHideLocalIpsWithMdns'];
// A page without an icon is not a game fault.
const IGNORED_ERRORS = /\/favicon\.ico\)?$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (page, type, [code, value, vk]) => page.cdp('Input.dispatchKeyEvent', { type, code, key: value, windowsVirtualKeyCode: vk });

export function parseArgs(argv) {
  const options = { guests: 2, durationMs: SOAK_DURATION_MS, setupTimeoutMs: SOAK_SETUP_TIMEOUT_MS };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    const number = () => { const value = Number(rest.shift()); if (!Number.isFinite(value) || value < 0) throw new Error(`${arg} needs a non-negative number`); return value; };
    if (arg === '--help') options.help = true;
    else if (arg === '--duration') options.durationMs = number() * 1000;
    else if (arg === '--guests') options.guests = number();
    else if (arg === '--port') options.port = number();
    else if (arg === '--timeout') options.setupTimeoutMs = number() * 1000;
    else if (arg === '--budget-bytes') options.budgetBytes = number();
    else if (arg === '--report') options.report = rest.shift();
    else if (arg === '--inject') options.inject = rest.shift();
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (!options.game) options.game = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  options.inject = options.inject ? options.inject.split(',') : [];
  for (const fault of options.inject) if (!['error', 'leak'].includes(fault)) throw new Error(`--inject takes error or leak, not ${fault}`);
  return options;
}

// Growth counts only when every sample rose and the total clears the noise floor.
export function monotonicGrowth(series, floor = SOAK_MEMORY_GROWTH_BYTES) {
  if (series.length < 3) return false;
  const rising = series.every((value, i) => i === 0 || value > series[i - 1]);
  return rising && series.at(-1) - series[0] > floor;
}

export function judge({ pages, tickHz, players, budgetBytes = SNAPSHOT_BUDGET_BYTES, origin }) {
  const failures = [];
  for (const page of pages) {
    for (const text of page.errors) failures.push({ name: 'logged_error', page: page.label, detail: text });
    const allowance = budgetBytes * Math.max(1, players);
    const breach = page.worst.bytes > allowance ? { ...page.worst, budget: allowance } : page.breaches[0];
    if (breach) {
      failures.push({
        name: 'snapshot_over_budget', page: page.label,
        detail: `tick ${breach.tick} carried ${breach.bytes} bytes, over the ${breach.budget} byte budget for ${players} players`,
      });
    }
    if (monotonicGrowth(page.heap)) {
      failures.push({
        name: 'memory_growth', page: page.label,
        detail: `series heap grew at every one of ${page.heap.length} samples, ${page.heap[0]} to ${page.heap.at(-1)} bytes`,
      });
    }
    const foreign = page.requests.filter((url) => /^(https?|wss?):/.test(url) && !url.startsWith(origin));
    if (foreign.length) failures.push({ name: 'external_request', page: page.label, detail: foreign[0] });
  }
  const host = pages.find((page) => page.label === 'host');
  if (host && tickHz) {
    const off = Math.abs(host.achievedHz - tickHz) / tickHz;
    if (!(off <= SOAK_TICK_TOLERANCE)) {
      failures.push({
        name: 'tick_rate', page: 'host',
        detail: `achieved ${host.achievedHz.toFixed(2)} Hz against ${tickHz} Hz configured, outside ${SOAK_TICK_TOLERANCE * 100}%`,
      });
    }
  }
  return failures;
}

export async function runSoak(options) {
  const dir = path.resolve(options.game);
  const game = path.basename(dir);
  const report = {
    game, guests: options.guests, durationMs: options.durationMs, startedAt: new Date().toISOString(),
    pass: false, failures: [], pages: [],
  };
  const fail = (name, detail) => { report.failures.push({ name, detail }); return report; };
  const closers = [];
  try {
    const executable = findBrowser();
    if (!executable) return fail('browser_unavailable', 'prerequisite missing: no Chrome or Chromium found; install one or set CHROME_BIN');
    if (verifyPublished(ROOT).problems.length) publish(ROOT);
    const server = await startGameServer({ dir, root: ROOT, port: options.port, modules: SERVER_SIDE });
    if (!server.ok) return fail('server_failed', server.detail);
    closers.push(server.stop);
    report.origin = server.origin;

    let browser;
    try { browser = await launch({ executable, offline: true, args: LOOPBACK_RTC }); } catch (error) { return fail('browser_unavailable', error.message); }
    closers.push(() => browser.close());

    const deadline = Date.now() + options.setupTimeoutMs;
    const stage = async (name, work) => {
      const left = deadline - Date.now();
      let timer;
      const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('expired')), Math.max(0, left)); });
      try { return await Promise.race([work(Math.max(1, left)), expired]); } catch (error) {
        const timeout = new Error(`timed out after ${options.setupTimeoutMs} ms while ${name}`);
        timeout.code = 'SOAK_TIMEOUT';
        timeout.cause = error;
        throw timeout;
      } finally { clearTimeout(timer); }
    };
    const open = async (label, url, left) => {
      const page = await browser.newPage(url, { timeout: left });
      await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
      return { label, page, heap: [] };
    };

    let pages;
    let setup;
    try {
      const host = await stage('opening the host', (left) => open('host', `${server.origin}/?create=1&overlay=1`, left));
      pages = [host];
      const room = await stage('creating a room', (left) => host.page.waitFor(() => globalThis.__engine?.state().room, { timeout: left }));
      for (let i = 1; i <= options.guests; i++) {
        pages.push(await stage(`opening guest ${i}`, (left) => open(`guest-${i}`, `${server.origin}/?room=${room}&overlay=1`, left)));
      }
      await stage('waiting for every guest channel to open', (left) => host.page.waitFor(
        (n) => globalThis.__engine.state().peers.filter((p) => p.channel === 'open').length === n, { timeout: left, args: [options.guests] },
      ));
      // By role: the page's own start control, or the one the kit built.
      await host.page.evaluate(() => (document.querySelector('[data-engine="start"]') ?? [...document.querySelectorAll('button')].find((b) => b.textContent === 'Start')).click());
      for (const entry of pages) {
        await stage(`waiting for ${entry.label} to enter the game`, (left) => entry.page.waitFor(
          () => globalThis.__engine.state().players > 0 && globalThis.__engine.diagnostics.current().ticks > 0, { timeout: left },
        ));
      }
      setup = await host.page.evaluate(() => globalThis.__engine.state());
    } catch (error) {
      if (error.code !== 'SOAK_TIMEOUT') throw error;
      return fail('timeout', error.message);
    }
    report.room = setup.room;
    report.players = setup.players;
    report.tickHz = setup.tickHz;
    report.workerLoop = setup.workerLoop;

    const host = pages[0];
    if (options.inject.includes('error')) await pages.at(-1).page.evaluate(() => console.error('soak: injected error'));
    if (options.inject.includes('leak')) {
      await host.page.evaluate(() => { globalThis.__soakLeak = []; setInterval(() => globalThis.__soakLeak.push(new Array(131072).fill(Math.random())), 20); });
    }

    const heapOf = async (page) => { await page.cdp('HeapProfiler.collectGarbage'); return (await page.cdp('Runtime.getHeapUsage')).usedSize; };
    const loopOf = () => host.page.evaluate(() => ({ ...globalThis.__engine.state().loop, at: performance.now() }));
    const rng = seededRng(1);
    const held = new Map();
    const began = Date.now();
    const first = await loopOf();
    let nextHeap = 0;
    let rounds = 0;
    while (Date.now() - began < options.durationMs) {
      if (Date.now() - began >= nextHeap) {
        for (const entry of pages) entry.heap.push(await heapOf(entry.page));
        nextHeap += options.durationMs / SOAK_MEMORY_SAMPLES;
      }
      for (const entry of pages) {
        const before = held.get(entry);
        if (before) await key(entry.page, 'keyUp', before);
        const next = rng.next() < 0.75 ? rng.pick(KEYS) : null;
        if (next) await key(entry.page, 'rawKeyDown', next);
        held.set(entry, next);
      }
      if (await host.page.evaluate(() => globalThis.__engine.state().over)) {
        rounds += 1;
        await key(host.page, 'rawKeyDown', SPACE);
        await key(host.page, 'keyUp', SPACE);
      }
      await sleep(STEP_MS);
    }
    const last = await loopOf();
    for (const entry of pages) entry.heap.push(await heapOf(entry.page));

    for (const entry of pages) {
      const read = await entry.page.evaluate(() => ({
        current: globalThis.__engine.diagnostics.current(), worst: globalThis.__engine.diagnostics.worst(),
        breaches: globalThis.__engine.diagnostics.breaches(), samples: globalThis.__engine.diagnostics.samples(),
        state: globalThis.__engine.state(),
        overlay: [...document.querySelectorAll('.engine-overlay [data-series]')].map((n) => n.dataset.series),
      }));
      const series = (name) => read.samples.map((row) => row[name]).filter((v) => v !== null);
      const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
      report.pages.push({
        label: entry.label,
        achievedHz: entry === host ? ((last.ticks - first.ticks) * 1000) / (last.at - first.at) : median(series('tickHz')),
        loop: entry === host ? { ticks: last.ticks - first.ticks, dropped: last.dropped - first.dropped } : null,
        worst: read.worst, breaches: read.breaches,
        rttMs: median(series('rtt')), outPerSec: median(series('outPerSec')), inPerSec: median(series('inPerSec')),
        bufferDepth: median(series('bufferDepth')), starved: read.current.starved, staleSnapshots: read.current.staleSnapshots,
        samples: read.samples.length, overlaySeries: read.overlay,
        audio: read.state.audio, heap: entry.heap,
        errors: entry.page.errors.filter((text) => !IGNORED_ERRORS.test(text)), requests: [...entry.page.requests],
      });
    }
    report.rounds = rounds;
    report.matchOver = (await host.page.evaluate(() => globalThis.__engine.state().over)) && rounds > 0;
    report.failures = judge({ pages: report.pages, tickHz: report.tickHz, players: report.players, budgetBytes: options.budgetBytes, origin: server.origin });
    for (const page of report.pages) page.requests = page.requests.length;
    report.pass = report.failures.length === 0;
    return report;
  } finally {
    for (const close of closers.reverse()) await close().catch(() => {});
    report.finishedAt = new Date().toISOString();
  }
}

export function writeReport(report, file) {
  const target = file ? path.resolve(file) : path.join(os.tmpdir(), `soak-${report.game}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exit(2); }
  if (options.help || !options.game) { console.log(USAGE); process.exit(options.help ? 0 : 2); }
  let report;
  try { report = await runSoak(options); } catch (error) {
    report = { game: path.basename(options.game), pass: false, failures: [{ name: 'harness_error', detail: error.stack || String(error) }], pages: [] };
  }
  const file = writeReport(report, options.report);
  for (const page of report.pages) {
    console.log(`${page.label.padEnd(8)} ${page.achievedHz === null ? '-' : page.achievedHz.toFixed(1)} Hz  worst snapshot ${page.worst.bytes} B  rtt ${page.rttMs ?? '-'} ms  heap ${page.heap.at(0)} -> ${page.heap.at(-1)}`);
  }
  for (const failure of report.failures) console.error(`FAIL ${failure.name}${failure.page ? ` (${failure.page})` : ''}: ${failure.detail}`);
  console.log(`${report.pass ? 'PASS' : 'FAIL'} soak ${report.game}; report ${file}`);
  process.exit(report.pass ? 0 : 1);
}
