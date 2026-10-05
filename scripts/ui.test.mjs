// Phases 8 to 10 in a real headless browser against the reference game:
// the kit's contract, phone width, both colour schemes, the overlay and sound.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, findBrowser, startGameServer } from './lib/live.mjs';
import { publish, verifyPublished, SERVER_SIDE } from './sync-engine.mjs';
import { SERIES } from '../engine/diagnostics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noBrowser = findBrowser() ? false : 'no Chrome or Chromium on this machine';
const PHONE = { width: 360, height: 740, deviceScaleFactor: 2, mobile: true };
const SHOTS = process.env.UI_TEST_SHOTS;

let server;
let browser;
const open = async (query, setup = async () => {}) => {
  const page = await browser.newPage();
  await setup(page);
  await page.goto(`${server.origin}/${query}`);
  return page;
};
const state = (page) => page.evaluate(() => globalThis.__engine.state());
const room = (page) => page.waitFor(() => globalThis.__engine?.state().room);
const press = async (page, code, key, vk, modifiers = 0) => {
  await page.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key, windowsVirtualKeyCode: vk, modifiers });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk, modifiers });
};
const start = (page) => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Start').click());
// Everything a layout check needs, measured in the page.
const layout = (page) => page.evaluate(() => {
  const visible = [...document.querySelectorAll('.engine-root button, .engine-root input, .engine-root a')]
    .filter((n) => n.getClientRects().length > 0);
  return {
    viewport: innerWidth, scroll: document.documentElement.scrollWidth,
    outside: visible.filter((n) => n.getBoundingClientRect().right > innerWidth + 0.5 || n.getBoundingClientRect().left < -0.5).map((n) => n.textContent),
    controls: visible.length,
  };
});
const colours = (page) => page.evaluate(() => {
  const root = document.querySelector('.engine-root');
  const field = document.querySelector('.engine-root input');
  return {
    bg: getComputedStyle(root).backgroundColor, ink: getComputedStyle(root).color,
    field: getComputedStyle(field).backgroundColor, body: getComputedStyle(document.body).margin,
  };
});
const luminance = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const shot = async (page, name) => {
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  return data;
};

before(async () => {
  if (noBrowser) return;
  if (verifyPublished(ROOT).problems.length) publish(ROOT);
  server = await startGameServer({ dir: path.join(ROOT, 'achtung'), root: ROOT, port: 8860, modules: SERVER_SIDE });
  assert.ok(server.ok, server.detail);
  browser = await launch({ offline: true, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
}, { timeout: 60_000 });
after(async () => { await browser?.close(); await server?.stop(); });

test('the reference game carries no contract code and no stylesheet of its own', () => {
  const dir = path.join(ROOT, 'achtung/public');
  const sources = ['client.js', 'index.html'].map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /URLSearchParams|location\.search|[?&]create=|[?&]room=|clipboard|healthz|localStorage/);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.css')), []);
  assert.doesNotMatch(sources, /<style|rel="stylesheet"/);
});

test('the create parameter hosts a room and shows the invite panel with no click', { skip: noBrowser }, async () => {
  const page = await open('?create=1');
  const code = await room(page);
  const seen = await page.evaluate(() => {
    const link = document.querySelector('.engine-invite');
    return { search: location.search, link: link.textContent, shown: link.getClientRects().length > 0, name: localStorage.getItem('engine-name') };
  });
  assert.equal(seen.search, `?room=${code}`, 'the room code is in the address bar');
  assert.equal(seen.link, `${server.origin}/?room=${code}`);
  assert.equal(seen.shown, true);
  assert.match(seen.name, /^player-/, 'the generated name is persisted');
  assert.deepEqual(page.errors.filter((e) => !/favicon/.test(e)), []);
  await page.close();
});

test('the room parameter joins without a click and the peer list shows the open channel', { skip: noBrowser }, async () => {
  const host = await open('?create=1');
  const code = await room(host);
  const guest = await open(`?room=${code}`);
  await guest.waitFor(() => globalThis.__engine?.state().room);
  assert.equal((await state(guest)).isHost, false);
  const row = await host.waitFor(() => [...document.querySelectorAll('.engine-scores li')].map((n) => n.textContent).find((t) => / · open$/.test(t)));
  assert.match(row, /^player-\w+ · open$/);
  assert.match(await guest.evaluate(() => localStorage.getItem('engine-name')), /^player-/);
  await guest.close();
  await host.close();
});

test('a malformed room parameter is refused with the server\'s named code on screen', { skip: noBrowser }, async () => {
  const page = await open('?room=%3Cnope%3E');
  const text = await page.waitFor(() => (/error: \w+/.exec(document.body.innerText) || [])[0]);
  assert.equal(text, 'error: no_such_room');
  assert.equal((await state(page)).room, null);
  await page.close();
});

test('a page whose storage is denied still hosts a room under a generated name', { skip: noBrowser }, async () => {
  const page = await open('?create=1', (p) => p.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });`,
  }));
  await room(page);
  assert.match(await page.evaluate(() => document.querySelector('.engine-scores li').textContent), /^player-/);
  assert.deepEqual(page.errors.filter((e) => !/favicon/.test(e)), []);
  await page.close();
});

test('at phone width neither the lobby nor the game scrolls sideways and every control is reachable', { skip: noBrowser }, async () => {
  const page = await open('?create=1', (p) => p.cdp('Emulation.setDeviceMetricsOverride', PHONE));
  await room(page);
  const lobby = await layout(page);
  await shot(page, 'phone-lobby');
  assert.equal(lobby.viewport, PHONE.width);
  assert.ok(lobby.scroll <= lobby.viewport, `lobby is ${lobby.scroll}px wide in a ${lobby.viewport}px viewport`);
  assert.deepEqual(lobby.outside, []);
  assert.ok(lobby.controls >= 5);
  await start(page);
  await page.waitFor(() => globalThis.__engine.state().round >= 1);
  const game = await layout(page);
  await shot(page, 'phone-game');
  assert.ok(game.scroll <= game.viewport, `game is ${game.scroll}px wide in a ${game.viewport}px viewport`);
  assert.deepEqual(game.outside, []);
  const arena = await page.evaluate(() => document.querySelector('.engine-arena').getBoundingClientRect().width);
  assert.ok(arena > 0 && arena <= PHONE.width, `arena is ${arena}px wide`);
  await page.close();
});

test('light and dark both render, each with its own themed background, ink and fields', { skip: noBrowser }, async () => {
  const seen = {};
  for (const scheme of ['light', 'dark']) {
    const page = await open('?create=1', (p) => p.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }));
    await room(page);
    seen[scheme] = { ...(await colours(page)), png: await shot(page, `scheme-${scheme}`) };
    await page.close();
  }
  for (const scheme of ['light', 'dark']) {
    const { bg, ink, field } = seen[scheme];
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', `${scheme}: the container sets an explicit background`);
    assert.ok(Math.abs(luminance(bg) - luminance(ink)) > 0.5, `${scheme}: ink ${ink} is readable on ${bg}`);
    assert.ok(Math.abs(luminance(field) - luminance(ink)) > 0.5, `${scheme}: ink ${ink} is readable in a field ${field}`);
    assert.equal(seen[scheme].body, '0px', 'no unthemed margin frames the page');
    assert.ok(seen[scheme].png.length > 1000);
  }
  assert.ok(luminance(seen.light.bg) > 0.8 && luminance(seen.dark.bg) < 0.2);
  assert.notEqual(seen.light.png, seen.dark.png);
});

test('the overlay is hidden by default, shown by the key chord, and populated without touching the game', { skip: noBrowser }, async () => {
  const page = await open('?create=1');
  await room(page);
  await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  const shown = () => page.evaluate(() => getComputedStyle(document.querySelector('.engine-overlay')).display !== 'none');
  assert.equal(await shown(), false);
  assert.equal(await page.evaluate(() => globalThis.__engine.diagnostics.enabled()), false, 'nothing is collected while it is off');
  await start(page);
  await page.waitFor(() => globalThis.__engine.state().round >= 1);
  await press(page, 'KeyD', 'D', 68, 1 | 8);
  assert.equal(await shown(), true);
  const rows = await page.waitFor(() => {
    const found = [...document.querySelectorAll('.engine-overlay [data-series]')].map((n) => [n.dataset.series, n.textContent]);
    return found.length && globalThis.__engine.diagnostics.samples().length >= 2 ? found : null;
  });
  assert.deepEqual(rows.map(([name]) => name), SERIES);
  assert.match(rows[0][1], /tickHz\s+\d+ [▁-█]+/, 'a current value and a sparkline');
  const before = await state(page);
  await press(page, 'KeyD', 'D', 68, 1 | 8);
  assert.equal(await shown(), false);
  assert.equal(await page.evaluate(() => globalThis.__engine.diagnostics.enabled()), false);
  assert.equal((await state(page)).round, before.round, 'toggling the overlay changes nothing in the game');
  await page.close();
});

test('the reference game sounds a death from the shared asset set, on the host and on a guest', { skip: noBrowser }, async () => {
  const host = await open('?create=1');
  const code = await room(host);
  const guest = await open(`?room=${code}`);
  await host.waitFor(() => globalThis.__engine.state().peers.some((p) => p.channel === 'open'));
  for (const page of [host, guest]) await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  assert.equal((await state(host)).audio.context, 'idle', 'no audio context before a gesture');
  await start(host);
  // The first key is the gesture that unlocks audio; holding a turn ends the round quickly.
  for (const page of [host, guest]) await page.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  for (const page of [host, guest]) {
    const audio = await page.waitFor(() => { const a = globalThis.__engine.state().audio; return a.started > 0 ? a : null; }, { timeout: 60_000 });
    assert.deepEqual(audio.loaded, ['hit']);
    assert.deepEqual(audio.failures, {});
    assert.equal(audio.context, 'running');
    assert.ok(audio.started <= 2, `one voice per death, not one per frame (${audio.started})`);
    assert.ok(page.requests.some((url) => url.startsWith(`${server.origin}/assets/`) && url.endsWith('/sounds/hit.wav')));
    assert.deepEqual(page.errors.filter((e) => !/favicon/.test(e)), []);
  }
  await guest.close();
  await host.close();
});
