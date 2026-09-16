import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://localhost:8765';
const browser = await chromium.launch({ headless: true, args: [
  '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
] });
const errors = [];
const wait = (page, fn) => page.waitForFunction(fn, null, { timeout: 8000 });
async function page() {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
try {
  const host = await page(), guest = await page();
  await host.goto(`${base}/?create=1`);
  await host.locator('#invite').waitFor({ state: 'visible' });
  await guest.goto(await host.locator('#invite-link').getAttribute('href'));
  await wait(host, () => [...window.breach.peers.values()].some(p => p.dc?.readyState === 'open'));
  await host.locator('#start').click();
  await guest.locator('#buy-menu').waitFor({ state: 'visible' });
  await host.evaluate(() => {
    const g = window.breach.game;
    g.freeze = 0;
    Object.assign(g.players[1], { weapon: 2, ammo: 30 });
  });
  await guest.locator('#buy-menu').waitFor({ state: 'hidden' });
  await guest.bringToFront();
  await guest.locator('#scene').click();
  await wait(guest, () => document.pointerLockElement === document.getElementById('scene'));

  // Aim first, then fire; releasing fire must preserve aim.
  await guest.mouse.down({ button: 'right' });
  await wait(guest, () => window.breach.view.camera.fov === 55);
  await guest.mouse.down({ button: 'left' });
  await wait(host, () => (window.breach.inputs[1][0] & 16) !== 0);
  await wait(host, () => window.breach.game.players[1].ammo < 30);
  assert.equal(await guest.evaluate(() => window.breach.view.camera.fov), 55);
  await guest.mouse.up({ button: 'left' });
  await wait(host, () => (window.breach.inputs[1][0] & 16) === 0);
  assert.equal(await guest.evaluate(() => window.breach.view.camera.fov), 55);
  await guest.mouse.up({ button: 'right' });
  await wait(guest, () => window.breach.view.camera.fov === 80);
  console.log('PASS aim then fire: guest fires over WebRTC while zoomed; releasing fire preserves aim');

  // Fire first, then aim; releasing aim must preserve fire.
  await guest.mouse.down({ button: 'left' });
  await wait(host, () => (window.breach.inputs[1][0] & 16) !== 0);
  await guest.mouse.down({ button: 'right' });
  await wait(guest, () => window.breach.view.camera.fov === 55);
  await guest.mouse.up({ button: 'right' });
  await wait(guest, () => window.breach.view.camera.fov === 80);
  assert.equal(await host.evaluate(() => window.breach.inputs[1][0] & 16), 16);
  await guest.mouse.up({ button: 'left' });
  await wait(host, () => (window.breach.inputs[1][0] & 16) === 0);
  console.log('PASS fire then aim: both buttons work; releasing aim preserves fire');

  // Losing mouse capture must release both actions, even before button-up events.
  await guest.mouse.down({ button: 'right' });
  await guest.mouse.down({ button: 'left' });
  await wait(guest, () => window.breach.view.camera.fov === 55 && (window.breach.localInput[0] & 16) !== 0);
  await guest.evaluate(() => document.exitPointerLock());
  await wait(host, () => (window.breach.inputs[1][0] & 16) === 0);
  await wait(guest, () => window.breach.view.camera.fov === 80);
  await guest.mouse.up({ button: 'right' });
  await guest.mouse.up({ button: 'left' });
  assert.equal(await guest.evaluate(() => window.breach.localInput[0]), 0);
  assert.deepEqual(errors, []);
  console.log('PASS losing mouse capture clears both actions; no browser errors');
} finally {
  await browser.close();
}
