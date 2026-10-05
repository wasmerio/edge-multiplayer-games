// Two real browsers against a running server: node test/browser.mjs http://localhost:8802
// Start the server with `node scripts/dev.mjs counterstrike 8802` from the repository root.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://localhost:8802';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
async function page(name, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  p.on('console', message => { if (message.type() === 'error') errors.push(`${name} console: ${message.text()}`); });
  await p.addInitScript(value => localStorage.setItem('engine-name', value), name);
  return p;
}
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 25000 });
const sim = (p, fn) => p.evaluate(fn);
async function capture(p) {
  await p.bringToFront();
  await p.locator('#scene').click();
  await wait(p, () => document.pointerLockElement === document.getElementById('scene'));
}
const look = (p, x, y) => p.evaluate(([dx, dy]) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy })), [x, y]);
// Renders once and reads the frame back, so a blank WebGL canvas cannot pass.
const colours = p => p.evaluate(() => {
  const view = window.breach.view.renderer();
  view.render(performance.now(), window.breach.view.local().look, false);
  const gl = view.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const seen = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 97) seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  return seen.size;
});
const fov = p => p.evaluate(() => window.breach.view.renderer().camera.fov);
try {
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), '*');
  assert.equal((await health.json()).ok, true);
  for (const [path, status] of [['/', 200], ['/ws', 426], ['/../etc/passwd', 404], ['/vendor/three.module.min.js', 200]]) {
    assert.equal((await fetch(base + path)).status, status, path);
  }
  console.log('PASS server health, CORS, index, upgrade response, traversal, vendored three.js');

  const host = await page('Viper');
  await host.goto(`${base}/?create=1`);
  await host.locator('#invite-link').waitFor({ state: 'visible' });
  const invite = await host.locator('#invite-link').getAttribute('href');
  assert.match(invite, /\?room=[A-Z2-9]{4}$/);
  const guest = await page('Ghost');
  await guest.goto(invite);
  await wait(host, () => window.breach.peers().some(p => p.channel === 'open' && p.connection === 'connected'));
  await host.locator('#start').click();
  await guest.locator('#buy-menu').waitFor({ state: 'visible' });
  assert.equal(await guest.evaluate(() => window.breach.view.renderer().camera.isPerspectiveCamera), true);
  assert.ok(await colours(host) > 10, 'the host scene renders');
  assert.ok(await colours(guest) > 10, 'the guest scene renders');
  assert.ok(await guest.evaluate(() => window.breach.state.client.stats().pushed > 5), 'the guest buffers the snapshot stream');
  assert.ok(await sim(host, () => window.breach.state.sim.freeze > 0 && window.breach.state.sim.freeze <= 450));
  assert.deepEqual([await host.locator('#attack-score').innerText(), await host.locator('#defend-score').innerText()], ['0', '0']);
  assert.match(await host.locator('#scores').innerText(), /Viper \(you\)/);
  console.log('PASS ?create=1 invite with no click, ?room=CODE join, DataChannel open, 3D scene on both, team scoreboard');

  // Extend only this run's buy period to inspect every purchase path.
  await sim(host, () => { window.breach.state.sim.freeze = 1800; });
  assert.equal(await guest.locator('[data-item="rifle"]').isDisabled(), true);
  await guest.locator('[data-item="kit"]').click();
  await wait(host, () => window.breach.state.sim.players[1].kit);
  assert.equal(await sim(host, () => window.breach.state.sim.players[1].money), 400);
  await host.locator('[data-item="armor"]').click();
  assert.equal(await sim(host, () => window.breach.state.sim.players[0].money), 150);
  // A guest that bypasses its disabled button still buys only for its own seat, and only what it can pay for.
  await guest.evaluate(() => { const b = document.querySelector('[data-item="rifle"]'); b.disabled = false; b.click(); });
  await wait(guest, () => document.getElementById('buy-feedback').textContent === 'Not enough money.');
  assert.equal(await sim(host, () => window.breach.state.sim.players[0].money), 150);
  assert.equal(await sim(host, () => window.breach.state.sim.players[1].weapon), 0);
  await sim(host, () => { for (const p of window.breach.state.sim.players) p.money = 6000; });
  await wait(guest, () => !document.querySelector('[data-item="rifle"]').disabled);
  await guest.locator('[data-item="rifle"]').click();
  await wait(host, () => window.breach.state.sim.players[1].weapon === 2);
  await wait(guest, () => window.breach.view.local().raw.money[1] === 3300);
  await guest.locator('[data-item="armor"]').click();
  await wait(host, () => window.breach.state.sim.players[1].armor === 100);
  await host.locator('[data-item="smg"]').click();
  assert.equal(await sim(host, () => window.breach.state.sim.players[0].weapon), 1);
  console.log('PASS host and guest purchases through the command hook, balance checks, seat taken from the connection');

  await guest.keyboard.press('b');
  assert.equal(await guest.locator('#buy-menu').isVisible(), false);
  await capture(guest);
  await look(guest, 100, -50);
  await wait(host, () => window.breach.state.sim.players[1].a === 194 && window.breach.state.sim.players[1].pitch === 7);
  await look(guest, -100, 50);
  await guest.keyboard.press('b');
  await guest.locator('#buy-menu').waitFor({ state: 'visible' });
  assert.equal(await guest.evaluate(() => document.pointerLockElement), null);
  await guest.keyboard.press('b');
  await capture(guest);
  await sim(host, () => { window.breach.state.sim.freeze = 0; });
  await wait(guest, () => window.breach.view.local().raw.freeze === 0);
  const before = await sim(host, () => window.breach.state.sim.players[1].x);
  await guest.keyboard.down('w');
  await wait(host, x => window.breach.state.sim.players[1].x < x - 20, before);
  await guest.keyboard.up('w');
  await guest.keyboard.down('a');
  const strafed = await sim(host, () => window.breach.state.sim.players[1].y);
  await wait(host, y => window.breach.state.sim.players[1].y !== y, strafed);
  await guest.evaluate(() => window.dispatchEvent(new Event('blur')));
  await guest.waitForTimeout(300);
  const rested = await sim(host, () => window.breach.state.sim.players[1].y);
  await guest.waitForTimeout(300);
  assert.equal(await sim(host, () => window.breach.state.sim.players[1].y), rested, 'blur releases held keys');
  await guest.keyboard.up('a');
  await wait(host, () => window.breach.state.sim.players[1].a === 180, null);
  console.log('PASS pointer lock, mouse look, B releases the mouse, movement follows yaw, blur release, aim restored after blur');

  // Overlapping mouse buttons: sights are local, fire is intent.
  const ammo = () => sim(host, () => window.breach.state.sim.players[1].ammo);
  await capture(guest);
  await guest.mouse.down({ button: 'right' });
  await wait(guest, () => window.breach.view.renderer().camera.fov === 55);
  await guest.mouse.down({ button: 'left' });
  await wait(host, () => window.breach.state.sim.players[1].ammo < 30);
  assert.equal(await fov(guest), 55);
  await guest.mouse.up({ button: 'left' });
  await wait(guest, () => (window.breach.view.local().look[0] & 16) === 0);
  assert.equal(await fov(guest), 55, 'releasing fire keeps the sights');
  await guest.mouse.up({ button: 'right' });
  await wait(guest, () => window.breach.view.renderer().camera.fov === 80);
  await guest.mouse.down({ button: 'left' });
  await guest.mouse.down({ button: 'right' });
  await wait(guest, () => window.breach.view.renderer().camera.fov === 55 && (window.breach.view.local().look[0] & 16) !== 0);
  await guest.evaluate(() => document.exitPointerLock());
  await wait(guest, () => window.breach.view.renderer().camera.fov === 80 && (window.breach.view.local().look[0] & 16) === 0);
  await guest.mouse.up({ button: 'right' });
  await guest.mouse.up({ button: 'left' });
  await guest.waitForTimeout(300);
  const spent = await ammo();
  await guest.waitForTimeout(300);
  assert.equal(await ammo(), spent, 'losing the mouse stops the fire');
  console.log('PASS fire and sights overlap, releasing one keeps the other, losing mouse capture clears both');

  await sim(host, () => {
    const g = window.breach.state.sim;
    Object.assign(g.players[0], { x: 100, y: 100, armor: 0 });
    Object.assign(g.players[1], { x: 300, y: 100, ammo: 30, reload: 0 });
  });
  await wait(guest, () => window.breach.view.local().raw.x[1] === 300);
  await capture(guest);
  await guest.mouse.down();
  await wait(host, () => window.breach.state.sim.roundOver);
  await guest.mouse.up();
  await wait(guest, () => /Defenders win the round/.test(document.querySelector('#banner-title').textContent) && !document.querySelector('#banner').hidden);
  assert.match(await guest.locator('#banner-subtitle').innerText(), /Attackers eliminated/);
  assert.deepEqual(await sim(host, () => window.breach.state.sim.scores), [0, 1]);
  assert.equal(await sim(host, () => window.breach.state.sim.players[1].money), 6200);
  await wait(guest, () => document.querySelector('#defend-score').textContent === '1');
  await host.bringToFront();
  await host.keyboard.press('Space');
  await wait(guest, () => window.breach.view.local().round === 2 && window.breach.view.local().raw?.freeze > 0);
  assert.equal(await sim(host, () => window.breach.state.sim.players[1].weapon), 2);
  assert.equal(await sim(host, () => window.breach.state.sim.players[0].weapon), 0);
  console.log('PASS guest rifle elimination, rewards, team score, winner banner, Space advances the round, equipment rules');

  await sim(host, () => { const g = window.breach.state.sim; g.freeze = 0; Object.assign(g.players[0], { x: 910, y: 160 }); });
  await wait(host, () => window.breach.view.local().raw.freeze === 0);
  await capture(host);
  await host.keyboard.down('e');
  await wait(guest, () => window.breach.view.local().raw.bm === 1);
  await host.keyboard.up('e');
  await sim(host, () => { Object.assign(window.breach.state.sim.players[1], { x: 940, y: 160 }); });
  await capture(guest);
  await guest.keyboard.down('e');
  await wait(host, () => window.breach.state.sim.bomb[0] === 2);
  await guest.keyboard.up('e');
  assert.deepEqual(await sim(host, () => window.breach.state.sim.scores), [0, 2]);
  console.log('PASS host plant and guest kit defuse over the DataChannel');

  const mobile = await page('Mobile', { width: 390, height: 844 });
  await mobile.goto(base);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS narrow lobby has no horizontal overflow; no page or console errors');
} catch (error) {
  console.error('browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
