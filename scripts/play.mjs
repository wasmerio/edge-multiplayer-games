// Plays one game headlessly so you can look at it: a host and guests join a
// room, start a match and play, while labelled screenshots are saved.
//   node scripts/play.mjs <game-dir> [--guests N] [--seconds S] [--rounds N] [--shots <dir>] [--phone] [--bot <file>]
// Exit status 0 when the match ran with no page error, 1 otherwise, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, findBrowser, startGameServer } from './lib/live.mjs';
import { publish, verifyPublished, SERVER_SIDE } from './sync-engine.mjs';
import { seededRng } from '../engine/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 360, height: 740 };
const STEP_MS = 200;
const BOT_MS = 50;
const SECONDS_PER_ROUND = 45;
export const DEFAULT_BOT = 'test/bot.mjs';
const SETUP_MS = 30000;
const DEFAULT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space'];
// Offline name resolution cannot answer mDNS candidates, so peers exchange plain loopback addresses.
const LOOPBACK_RTC = ['--disable-features=WebRtcHideLocalIpsWithMdns'];
const IGNORED_ERRORS = /\/favicon\.ico\)?$/;

export const USAGE = `usage: node scripts/play.mjs <game-dir> [options]

Starts the game against this checkout's engine, opens a host and guests in a
headless browser, starts a match, plays it and tears everything down.

  --guests <n>     guests beside the host (default 2)
  --seconds <s>    seconds of play after Start (default 12; with --rounds, ${SECONDS_PER_ROUND} for each round)
  --rounds <n>     keep playing, the host starting each next round, until <n> rounds have
                   ended or --seconds have passed
  --shots <dir>    save PNG screenshots there
  --frames <n>     in-game screenshots per page (default 4); with --rounds, per page and round
  --phone          open guest-1 as a ${PHONE.width}x${PHONE.height} touch phone and play it by touch
  --bot <file>     a module that plays the game: its default export is
                   (snapshot, info) => ({ ArrowLeft: true, Space: false }), the keys to hold now.
                   It runs in every seated page, every ${BOT_MS} ms while a round is on.
                   Default: <game-dir>/${DEFAULT_BOT} when that file exists
  --no-bot         random players even when ${DEFAULT_BOT} exists
  --keys <list>    key codes the random players choose from, comma separated
                   (default ${DEFAULT_KEYS.join(',')})
  --script <file>  a JSON list of timed inputs instead of a bot or random play:
                   [{ "at": 0.5, "page": "host", "down": "ArrowLeft" }, { "at": 1.2, "page": "host", "up": "ArrowLeft" },
                    { "at": 2, "page": "all", "tap": "Space" }, { "at": 3, "shot": "after-dash" }]
  --seed <n>       seed of the random players (default 1)
  --no-late        do not add the late-joining spectator
  --online         let the pages reach other origins (default: denied, as in the soak run)
  --port <n>       port for the game's server (default: a free one)
  --json <file>    also write the summary there
  --help

Screenshots, in order: 01-lobby-desktop, 02-lobby-phone, 03-room-<page>,
04-game-<page>-<n> (with --rounds 04-game-<page>-r<round>-<n>), 05-over-<page>
for the first round that ended and 05-over-<page>-r<round> for each later one,
06-spectator. The summary on stdout is one JSON document: roundsEnded (how many
rounds ended during the run), final (the host's round, over, winner and scores
when the run stopped), and per page its errors, requests to other origins,
__engine.state(), the snapshot on screen, the HUD, banner and scoreboard text,
and whether the page scrolls sideways.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A KeyboardEvent.code as the three values the DevTools protocol wants.
export function keyOf(code) {
  const named = {
    Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8],
    ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
    ShiftLeft: ['Shift', 16], ShiftRight: ['Shift', 16], ControlLeft: ['Control', 17], ControlRight: ['Control', 17],
    AltLeft: ['Alt', 18], AltRight: ['Alt', 18],
  };
  if (named[code]) return { code, key: named[code][0], windowsVirtualKeyCode: named[code][1] };
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return { code, key: letter[1].toLowerCase(), windowsVirtualKeyCode: letter[1].charCodeAt(0) };
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return { code, key: digit[1], windowsVirtualKeyCode: digit[1].charCodeAt(0) };
  throw new Error(`unknown key code ${code}; use KeyboardEvent.code values such as ArrowLeft, KeyA, Space`);
}

export function parseArgs(argv) {
  const options = { guests: 2, seconds: 12, frames: 4, seed: 1, phone: false, late: true, online: false, keys: [...DEFAULT_KEYS] };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    const value = () => { if (!rest.length) throw new Error(`${arg} needs a value`); return rest.shift(); };
    const number = () => { const n = Number(value()); if (!Number.isFinite(n) || n < 0) throw new Error(`${arg} needs a non-negative number`); return n; };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--guests') options.guests = number();
    else if (arg === '--seconds') { options.seconds = number(); options.secondsGiven = true; }
    else if (arg === '--rounds') options.rounds = number();
    else if (arg === '--bot') options.bot = value();
    else if (arg === '--no-bot') options.noBot = true;
    else if (arg === '--frames') options.frames = number();
    else if (arg === '--seed') options.seed = number();
    else if (arg === '--port') options.port = number();
    else if (arg === '--shots') options.shots = value();
    else if (arg === '--json') options.json = value();
    else if (arg === '--script') options.script = value();
    else if (arg === '--keys') options.keys = value().split(',').map((name) => name.trim()).filter(Boolean);
    else if (arg === '--phone') options.phone = true;
    else if (arg === '--no-late') options.late = false;
    else if (arg === '--online') options.online = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (!options.game) options.game = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  options.keys.forEach(keyOf);
  if (options.phone && options.guests < 1) throw new Error('--phone needs at least one guest');
  if (options.rounds !== undefined && (!Number.isInteger(options.rounds) || options.rounds < 1)) throw new Error('--rounds needs a whole number of at least 1');
  if (options.bot && options.noBot) throw new Error('--bot and --no-bot exclude each other');
  if (options.rounds && !options.secondsGiven) options.seconds = SECONDS_PER_ROUND * options.rounds;
  return options;
}

// A script is a list of steps sorted by time; each names a page or "all".
export function readScript(text) {
  const steps = JSON.parse(text);
  if (!Array.isArray(steps)) throw new Error('a script is a JSON list of steps');
  for (const step of steps) {
    if (!Number.isFinite(step.at) || step.at < 0) throw new Error(`script step ${JSON.stringify(step)} needs "at" in seconds`);
    const verbs = ['down', 'up', 'tap', 'shot'].filter((verb) => step[verb] !== undefined);
    if (verbs.length !== 1) throw new Error(`script step ${JSON.stringify(step)} needs exactly one of down, up, tap, shot`);
    if (verbs[0] !== 'shot') keyOf(step[verbs[0]]);
  }
  return [...steps].sort((a, b) => a.at - b.at);
}

// A bot is one self-contained module: it is loaded into the page from a blob, where an import cannot resolve.
export function readBot(text, file = 'the bot') {
  if (/^\s*import\b[^(]/m.test(text)) throw new Error(`${file} must not import: it runs inside the page; info.game holds the exports of public/game.js`);
  if (!/^\s*export\s+default\b/m.test(text)) throw new Error(`${file} needs a default export: (snapshot, info) => ({ KeyCode: true })`);
  return text;
}

// Which bot plays: the one named, else the game's own test/bot.mjs, else none. A script outranks both.
export function botFile(options, dir) {
  if (options.script || options.noBot) return null;
  if (options.bot) return path.resolve(options.bot);
  const own = path.join(dir, DEFAULT_BOT);
  return fs.existsSync(own) ? own : null;
}

// The keys a bot wants held, as the changes to make: a key it no longer names is released.
export function keyChanges(held, wanted) {
  const want = new Set(Object.entries(wanted ?? {}).filter(([, down]) => down).map(([code]) => code));
  return { up: [...held].filter((code) => !want.has(code)), down: [...want].filter((code) => !held.has(code)) };
}

// Runs in the page: calls the bot on a timer and turns its answer into key events the engine's bindings read.
const INSTALL_BOT = async (source, period, changes) => {
  const keyChanges = new Function(`return (${changes})`)();
  const bot = (await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))).default;
  if (typeof bot !== 'function') throw new Error('the default export of the bot is not a function');
  const game = await import('/game.js').catch(() => ({}));
  const tickField = game.SNAPSHOT?.tickField ?? 'k';
  const held = new Set();
  const status = { calls: 0, error: null };
  const apply = (wanted) => {
    const { up, down } = keyChanges(held, wanted);
    for (const code of up) { held.delete(code); document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, cancelable: true })); }
    for (const code of down) { held.add(code); document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true })); }
  };
  globalThis.__bot = status;
  setInterval(() => {
    const engine = globalThis.__engine;
    const state = engine.state();
    const snapshot = engine.snapshot?.() ?? null;
    if (status.error || !snapshot || state.seat < 0 || state.over) { apply({}); return; }
    try {
      apply(bot(snapshot, {
        seat: state.seat, players: engine.players(), scores: state.scores, round: state.round, target: state.target,
        isHost: state.isHost, tick: snapshot[tickField], step: status.calls, game,
      }));
      status.calls += 1;
    } catch (error) { status.error = String(error?.stack || error); apply({}); }
  }, period);
  return true;
};

// What a page shows right now, read through the engine's own debug handle and the page's roles.
const READ_PAGE = () => {
  const text = (role) => document.querySelector(`[data-engine="${role}"]`)?.innerText?.replace(/\s+/g, ' ').trim() ?? null;
  const shown = (role) => { const node = document.querySelector(`[data-engine="${role}"]`); return Boolean(node && node.getClientRects().length); };
  const arena = document.querySelector('[data-engine="arena"], .engine-arena')?.getBoundingClientRect();
  const engine = globalThis.__engine;
  return {
    engine: engine?.version ?? null,
    state: engine?.state() ?? null,
    snapshot: engine?.snapshot?.() ?? null,
    hud: text('hud'), banner: shown('banner') ? text('banner') : null, scores: text('scores'), status: text('status'),
    next: shown('next') ? text('next') : null,
    touch: (document.querySelector('[data-touch]')?.dataset.touch) ?? null,
    bot: globalThis.__bot ? { ...globalThis.__bot } : null,
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    arena: arena ? { width: Math.round(arena.width), height: Math.round(arena.height) } : null,
    scrollsSideways: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

// A game is named by a path, or by its directory name in this checkout from anywhere.
export const resolveGame = (name) => (fs.existsSync(path.resolve(name)) ? path.resolve(name) : path.join(ROOT, name));

export async function runPlay(options) {
  const dir = resolveGame(options.game);
  const summary = { game: path.basename(dir), ok: false, problems: [], shots: [], roundsEnded: 0, matchesWon: 0, stopped: null, final: null, bot: null, pages: [] };
  const problem = (text) => { summary.problems.push(text); return summary; };
  const closers = [];
  const shotDir = options.shots ? path.resolve(options.shots) : null;
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const script = options.script ? readScript(fs.readFileSync(options.script, 'utf8')) : null;
  const botPath = botFile(options, dir);
  let bot = null;
  if (botPath) {
    try { bot = readBot(fs.readFileSync(botPath, 'utf8'), path.relative(process.cwd(), botPath) || botPath); } catch (error) { return problem(error.message); }
    summary.bot = botPath;
  }

  try {
    const executable = findBrowser();
    if (!executable) return problem('prerequisite missing: no Chrome or Chromium found; install one or set CHROME_BIN');
    if (verifyPublished(ROOT).problems.length) publish(ROOT);
    const server = await startGameServer({ dir, root: ROOT, port: options.port, modules: SERVER_SIDE });
    if (!server.ok) return problem(server.detail);
    closers.push(server.stop);
    summary.origin = server.origin;

    const browser = await launch({ executable, offline: !options.online, args: LOOPBACK_RTC });
    closers.push(() => browser.close());

    const open = async (label, url, { phone = false } = {}) => {
      const page = await browser.newPage();
      const size = phone ? PHONE : DESKTOP;
      await page.cdp('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
      if (phone) await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      // Without this a page behind another one stops rendering frames.
      await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
      await page.goto(url);
      return { label, page, phone, held: null, finger: false };
    };
    const shoot = async (entry, name) => {
      if (!shotDir) return;
      const { data } = await entry.page.cdp('Page.captureScreenshot', { format: 'png' });
      const file = path.join(shotDir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      summary.shots.push(file);
    };
    const key = (entry, type, code) => entry.page.cdp('Input.dispatchKeyEvent', { type, ...keyOf(code) });
    const tap = async (entry, code) => { await key(entry, 'rawKeyDown', code); await key(entry, 'keyUp', code); };

    for (const [name, phone] of [['01-lobby-desktop', false], ['02-lobby-phone', true]]) {
      const plain = await open('lobby', `${server.origin}/`, { phone });
      await plain.page.waitFor(() => globalThis.__engine, { timeout: SETUP_MS });
      await sleep(400);
      await shoot(plain, name);
      if (phone) summary.lobbyPhone = await plain.page.evaluate(READ_PAGE);
      await plain.page.close();
    }

    const host = await open('host', `${server.origin}/?create=1`);
    const pages = [host];
    const room = await host.page.waitFor(() => globalThis.__engine?.state().room, { timeout: SETUP_MS });
    summary.room = room;
    for (let i = 1; i <= options.guests; i++) {
      pages.push(await open(`guest-${i}`, `${server.origin}/?room=${room}`, { phone: options.phone && i === 1 }));
    }
    try {
      await host.page.waitFor((n) => globalThis.__engine.state().peers.filter((p) => p.channel === 'open').length === n, { timeout: SETUP_MS, args: [options.guests] });
    } catch { return problem(`only some of ${options.guests} guest channel(s) opened within ${SETUP_MS} ms`); }
    await sleep(300);
    for (const entry of pages) await shoot(entry, `03-room-${entry.label}`);

    await host.page.evaluate(() => (document.querySelector('[data-engine="start"]') ?? [...document.querySelectorAll('button')].find((b) => b.textContent === 'Start')).click());
    try {
      for (const entry of pages) await entry.page.waitFor(() => globalThis.__engine.state().players > 0 && globalThis.__engine.snapshot?.() !== null, { timeout: 10000 });
    } catch {
      const status = await host.page.evaluate(() => document.querySelector('[data-engine="status"]')?.textContent ?? '');
      return problem(`the match did not start (status: ${status || 'none'}); a game with minPlayers needs --guests`);
    }

    // A phone is played by touch: a drag on the stick, or presses on the touch buttons.
    const controls = (entry) => entry.page.evaluate(() => {
      const box = (node) => { const b = node.getBoundingClientRect(); return b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 } : null; };
      return {
        stick: [...document.querySelectorAll('[data-engine-stick]')].map(box).find(Boolean) ?? null,
        buttons: [...document.querySelectorAll('[data-engine-touch]')].map(box).filter(Boolean),
      };
    });
    const touch = (entry, type, points) => entry.page.cdp('Input.dispatchTouchEvent', { type, touchPoints: points });
    const rng = seededRng(options.seed);
    const playPhone = async (entry, step) => {
      const { stick, buttons } = await controls(entry);
      if (stick && step % 6 !== 5) {
        const angle = rng.range(0, Math.PI * 2);
        const point = { x: Math.round(stick.x + Math.cos(angle) * stick.r * 0.8), y: Math.round(stick.y + Math.sin(angle) * stick.r * 0.8), id: 1 };
        await touch(entry, entry.finger ? 'touchMove' : 'touchStart', [point]);
        entry.finger = true;
        return;
      }
      if (entry.finger) { await touch(entry, 'touchEnd', []); entry.finger = false; }
      if (!buttons.length) return;
      const button = rng.pick(buttons);
      await touch(entry, 'touchStart', [{ x: Math.round(button.x), y: Math.round(button.y), id: 2 }]);
      await sleep(60);
      await touch(entry, 'touchEnd', []);
    };
    const playKeys = async (entry) => {
      if (entry.held) await key(entry, 'keyUp', entry.held);
      entry.held = rng.next() < 0.8 ? rng.pick(options.keys) : null;
      if (entry.held) await key(entry, 'rawKeyDown', entry.held);
    };
    const byLabel = (label) => (label === 'all' || label === undefined ? pages : pages.filter((entry) => entry.label === label));
    const runStep = async (step) => {
      if (step.shot !== undefined) { for (const entry of byLabel(step.page)) await shoot(entry, `04-game-${entry.label}-${step.shot}`); return; }
      for (const entry of byLabel(step.page)) {
        if (step.down) await key(entry, 'rawKeyDown', step.down);
        if (step.up) await key(entry, 'keyUp', step.up);
        if (step.tap) await tap(entry, step.tap);
      }
    };
    const advance = async () => {
      const clicked = await host.page.evaluate(() => {
        const next = document.querySelector('[data-engine="next"]');
        if (!next || !next.getClientRects().length) return false;
        next.click();
        return true;
      });
      if (!clicked) await tap(host, 'Space');
    };

    if (bot) {
      try { for (const entry of pages) await entry.page.evaluate(INSTALL_BOT, bot, BOT_MS, String(keyChanges)); } catch (error) { return problem(`${summary.bot}: ${error.message.split('\n')[0]}`); }
    }

    const began = Date.now();
    const total = options.seconds * 1000;
    const shotEvery = total / Math.max(1, options.frames);
    const wanted = options.rounds ?? Infinity;
    let frame = 0;
    let step = 0;
    let counted = false;
    let roundBegan = began;
    let spectator = null;
    const pending = script ? [...script] : null;
    while (Date.now() - began < total && summary.roundsEnded < wanted) {
      const elapsed = Date.now() - began;
      if (pending) {
        while (pending.length && pending[0].at * 1000 <= elapsed) await runStep(pending.shift());
      } else if (!bot) {
        for (const entry of pages) await (entry.phone ? playPhone(entry, step) : playKeys(entry));
      }
      if (options.late && !spectator && elapsed > Math.min(2500, total / 3)) {
        spectator = await open('spectator', `${server.origin}/?room=${room}`);
        await spectator.page.waitFor(() => globalThis.__engine?.state().players > 0, { timeout: 10000 }).catch(() => {});
        await sleep(600);
        await shoot(spectator, '06-spectator');
        summary.spectator = { ...(await spectator.page.evaluate(READ_PAGE)), errors: spectator.page.errors.filter((text) => !IGNORED_ERRORS.test(text)) };
        await spectator.page.close();
      }
      const over = await host.page.evaluate(() => { const state = globalThis.__engine.state(); return state.over ? { winner: state.winner } : null; });
      const round = summary.roundsEnded + 1;
      if (over && !counted) {
        counted = true;
        summary.roundsEnded += 1;
        if (over.winner >= 0) summary.matchesWon += 1;
        await sleep(700);
        for (const entry of pages) await shoot(entry, round === 1 ? `05-over-${entry.label}` : `05-over-${entry.label}-r${round}`);
      } else if (!over && counted) {
        counted = false;
        roundBegan = Date.now();
        if (options.rounds) frame = 0;
      } else if (!over && frame < options.frames) {
        // With --rounds every round gets its frames, the n-th n x (n + 1) seconds into it; else they spread over the run.
        const due = options.rounds ? Date.now() - roundBegan >= (frame + 1) * (frame + 2) * 1000 : elapsed >= frame * shotEvery + shotEvery / 2;
        if (due) {
          frame += 1;
          const name = `${options.rounds ? `r${round}-` : ''}${String(frame).padStart(2, '0')}`;
          for (const entry of pages) await shoot(entry, `04-game-${entry.label}-${name}`);
        }
      }
      if (over && summary.roundsEnded < wanted) { await advance(); await sleep(300); }
      await sleep(STEP_MS);
      step += 1;
    }
    summary.stopped = summary.roundsEnded >= wanted ? 'rounds' : 'seconds';
    summary.final = await host.page.evaluate(() => { const { round, over, winner, scores, target } = globalThis.__engine.state(); return { round, over, winner, scores, target }; });

    for (const entry of pages) {
      if (entry.held) await key(entry, 'keyUp', entry.held).catch(() => {});
      const read = await entry.page.evaluate(READ_PAGE);
      const foreign = entry.page.requests.filter((url) => /^(https?|wss?):/.test(url) && !url.startsWith(server.origin));
      summary.pages.push({
        label: entry.label, phone: entry.phone, ...read,
        errors: entry.page.errors.filter((text) => !IGNORED_ERRORS.test(text)),
        requestsToOtherOrigins: [...new Set(foreign)],
      });
    }
    for (const page of summary.pages) {
      for (const text of page.errors) summary.problems.push(`${page.label}: ${text.split('\n')[0]}`);
      for (const url of page.requestsToOtherOrigins) summary.problems.push(`${page.label}: requested ${url}`);
      if (page.scrollsSideways) summary.problems.push(`${page.label}: the page scrolls sideways at ${page.viewport.width} px`);
      if (page.phone && page.touch !== 'on') summary.problems.push(`${page.label}: a touch device shows no touch controls (data-touch is ${page.touch})`);
      if (page.bot?.error) summary.problems.push(`${page.label}: the bot threw: ${page.bot.error.split('\n')[0]}`);
      else if (page.bot && page.bot.calls === 0) summary.problems.push(`${page.label}: the bot was never called; it needs a seat and an engine with __engine.snapshot()`);
    }
    if (summary.lobbyPhone?.scrollsSideways) summary.problems.push(`lobby: the page scrolls sideways at ${PHONE.width} px`);
    for (const text of summary.spectator?.errors ?? []) summary.problems.push(`spectator: ${text.split('\n')[0]}`);
    summary.ok = summary.problems.length === 0;
    return summary;
  } catch (error) {
    return problem(`harness error: ${error.stack || error}`);
  } finally {
    for (const close of closers.reverse()) await close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exit(2); }
  if (options.help || !options.game) { console.log(USAGE); process.exit(options.help ? 0 : 2); }
  if (!fs.existsSync(resolveGame(options.game))) { console.error(`play: ${options.game} is not a directory`); process.exit(2); }
  const summary = await runPlay(options);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (options.json) { fs.mkdirSync(path.dirname(path.resolve(options.json)), { recursive: true }); fs.writeFileSync(options.json, text); }
  process.stdout.write(text);
  for (const line of summary.problems) console.error(`PROBLEM ${line}`);
  const end = summary.final ? `, stopped in round ${summary.final.round} (${summary.final.over ? 'over' : 'running'})` : '';
  console.error(`${summary.ok ? 'PASS' : 'FAIL'} play ${summary.game}: ${summary.roundsEnded} round(s) ended${end}, ${summary.shots.length} screenshot(s)${options.shots ? ` in ${path.resolve(options.shots)}` : ''}`);
  process.exit(summary.ok ? 0 : 1);
}
