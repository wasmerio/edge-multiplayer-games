// Two real browsers against a running server: node test/browser.mjs http://localhost:8801
// Start the server with `node scripts/dev.mjs ring-rumble 8801` from the repository root.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://localhost:8801';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
async function page(name, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  p.on('console', message => { if (message.type() === 'error') errors.push(`${name} console: ${message.text()}`); });
  await p.addInitScript(value => localStorage.setItem('engine-name', value), name);
  return p;
}
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 20000 });
// Renders once and reads the frame back, so a blank WebGL canvas cannot pass.
const colours = p => p.evaluate(() => {
  const view = window.rumble.view.renderer();
  view.render();
  const gl = view.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const seen = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 97) seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  return seen.size;
});
try {
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), '*');
  assert.equal((await health.json()).ok, true);
  for (const [path, status] of [['/', 200], ['/ws', 426], ['/../etc/passwd', 404], ['/vendor/three.module.min.js', 200]]) {
    assert.equal((await fetch(base + path)).status, status, path);
  }
  console.log('PASS server health, CORS, index, upgrade response, traversal, vendored three.js');

  const host = await page('Host');
  await host.goto(`${base}/?create=1`);
  await host.locator('#invite-link').waitFor({ state: 'visible' });
  const invite = await host.locator('#invite-link').getAttribute('href');
  assert.match(invite, /\?room=[A-Z2-9]{4}$/);
  assert.ok(await colours(host) > 10, 'the lobby preview renders');
  assert.equal(await host.locator('#start').isDisabled(), true, 'a lone host cannot start');
  assert.equal(await host.locator('#mapinfo').innerText(), '1 / 8 fighters ready');

  const guest = await page('Guest');
  await guest.goto(invite);
  await wait(host, () => window.rumble.peers().some(p => p.channel === 'open' && p.connection === 'connected'));
  await wait(guest, () => window.rumble.peers().some(p => p.channel === 'open'));
  console.log('PASS ?create=1 shows the invite with no click, ?room=CODE joins, DataChannel open, start needs two fighters');

  await host.locator('#start').click();
  await wait(guest, () => window.rumble.state.client?.sample()?.f === 0);
  assert.equal(await guest.locator('#hero-copy').isVisible(), false);
  assert.equal(await guest.locator('#round-number').innerText(), 'ROUND 01');
  assert.match(await guest.locator('#scores').innerText(), /Guest\s*YOU/);
  assert.ok(await colours(host) > 10, 'the host scene renders');
  assert.ok(await colours(guest) > 10, 'the guest scene renders');
  assert.equal(await guest.evaluate(() => window.rumble.view.renderer().fighters.length), 2);
  assert.ok(await guest.evaluate(() => window.rumble.state.client.stats().pushed > 30), 'the guest buffers the snapshot stream');
  assert.match(await guest.locator('#dash-status').innerText(), /Dash ready/);

  const before = await host.evaluate(() => window.rumble.state.sim.fighters[1].x);
  await guest.keyboard.down('ArrowLeft');
  await wait(host, x => window.rumble.state.sim.fighters[1].x < x - 0.3, before);
  await guest.keyboard.up('ArrowLeft');
  await guest.keyboard.down('d');
  await wait(host, () => window.rumble.state.sim.fighters[1].previous === 2);
  await guest.evaluate(() => window.dispatchEvent(new Event('blur')));
  await wait(host, () => window.rumble.state.sim.fighters[1].previous === 0);
  await guest.keyboard.up('d');
  console.log('PASS 3D scene on both, guest movement reaches the host, blur releases held keys');

  // Arrange combat on the host; the guest's punch travels over the real DataChannel.
  await host.evaluate(() => {
    const g = window.rumble.state.sim;
    Object.assign(g.fighters[0], { x: 0, z: 0, a: Math.PI / 2, vx: 0, vz: 0, damage: 0 });
    Object.assign(g.fighters[1], { x: 1.2, z: 0, a: -Math.PI / 2, vx: 0, vz: 0, damage: 0 });
  });
  await guest.keyboard.down('j');
  await wait(host, () => window.rumble.state.sim.fighters[0].damage > 0);
  await guest.keyboard.up('j');
  await wait(guest, () => window.rumble.state.client.sample().dmg[0] > 0);
  const round = await host.evaluate(() => window.rumble.state.sim.round);
  await guest.keyboard.down('ArrowRight');
  await wait(host, () => window.rumble.state.sim.roundOver);
  await guest.keyboard.up('ArrowRight');
  await wait(guest, () => /wins the round!/.test(document.querySelector('#banner').textContent));
  await wait(guest, () => window.rumble.state.client.sample().over === true);
  assert.equal(await host.evaluate(() => window.rumble.state.sim.scores.reduce((a, b) => a + b, 0)), 1);
  await host.keyboard.press('Space');
  await wait(guest, () => window.rumble.state.client.sample()?.f > 0);
  assert.equal(await host.evaluate(() => window.rumble.state.sim.round), round + 1);
  console.log('PASS guest punch damages the host, ring-out scores, banner names the winner, Space advances the round');

  const solo = await page('Typist');
  await solo.goto(base);
  await solo.locator('#name').fill('');
  await solo.locator('#name').pressSequentially('wasdjk');
  assert.equal(await solo.locator('#name').inputValue(), 'wasdjk', 'bound keys still type into the name field');
  const mobile = await page('Mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await mobile.goto(base);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await mobile.locator('[data-engine-touch]').count(), 6);
  console.log('PASS name field accepts bound letters, phone layout has six touch controls and no horizontal overflow');

  assert.deepEqual(errors, []);
  console.log('PASS no page or console errors');
} catch (error) {
  console.error('browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
