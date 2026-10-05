// A headless Chrome driven over the DevTools protocol with Node's built-in
// WebSocket, so the repository needs no browser dependency.
//   const browser = await launch({ offline: false });
//   const page = await browser.newPage(url);          // own context each
//   await page.waitFor(() => document.title, { timeout: 5000 });
//   await page.evaluate((a) => a + 1, 1);  page.errors;  page.requests;
//   await browser.close();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findBrowser(env = process.env) {
  if (env.CHROME_BIN) return fs.existsSync(env.CHROME_BIN) ? env.CHROME_BIN : null;
  for (const candidate of CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  const cache = path.join(env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright'));
  if (!fs.existsSync(cache)) return null;
  const builds = fs.readdirSync(cache).filter((name) => /^chromium(_headless_shell)?-\d+$/.test(name)).sort().reverse();
  for (const build of builds) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const file = path.join(cache, build, rel);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

const expression = (fn, args) => (typeof fn === 'function' ? `(${fn})(...${JSON.stringify(args)})` : String(fn));

export async function launch({ offline = false, args = [], executable = findBrowser(), startupMs = 20000 } = {}) {
  if (!executable) {
    const error = new Error('prerequisite missing: no Chrome or Chromium found; install one or set CHROME_BIN');
    error.code = 'NO_BROWSER';
    throw error;
  }
  if (typeof WebSocket !== 'function') {
    const error = new Error('prerequisite missing: this Node has no built-in WebSocket (Node 22 or newer is required)');
    error.code = 'NO_WEBSOCKET';
    throw error;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-browser-'));
  const flags = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu', '--mute-audio',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // Denies every name lookup, so only loopback literals stay reachable.
    ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'] : []),
    ...args, 'about:blank',
  ];
  const child = spawn(executable, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
  };
  process.once('exit', cleanup);

  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`browser did not start within ${startupMs} ms: ${log.slice(-400)}`)), startupMs);
    child.stderr.on('data', (chunk) => {
      log += chunk;
      const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) { clearTimeout(timer); resolve(found[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`browser exited with ${code}: ${log.slice(-400)}`)); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  }).catch((error) => { cleanup(); throw error; });

  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('cannot reach the browser')); })
    .catch((error) => { cleanup(); throw error; });

  let nextId = 1;
  const pending = new Map();
  const sessions = new Map();
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.sessionId) {
      sessions.get(msg.sessionId)?.(msg);
    }
  };
  socket.onclose = () => { for (const { reject } of pending.values()) reject(new Error('browser connection closed')); pending.clear(); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  async function newPage(url, { timeout = 15000 } = {}) {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    const requests = [];
    sessions.set(sessionId, (msg) => {
      const p = msg.params || {};
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'uncaught exception');
      } else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        errors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Log.entryAdded' && p.entry?.level === 'error') {
        errors.push(`${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`);
      } else if (msg.method === 'Network.requestWillBeSent') {
        requests.push(p.request.url);
      }
    });
    const call = (method, params) => send(method, params, sessionId);
    await Promise.all([call('Runtime.enable'), call('Page.enable'), call('Network.enable'), call('Log.enable')]);

    const evaluate = async (fn, ...fnArgs) => {
      const result = await call('Runtime.evaluate', { expression: expression(fn, fnArgs), awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const waitFor = async (fn, { timeout: limit = timeout, args: fnArgs = [], interval = 100 } = {}) => {
      const deadline = Date.now() + limit;
      let last;
      for (;;) {
        // A navigation destroys the context mid-call; the next poll sees the new one.
        try { const value = await evaluate(fn, ...fnArgs); if (value) return value; } catch (error) { last = error; }
        if (Date.now() > deadline) {
          throw new Error(`timed out after ${limit} ms waiting for ${String(fn).slice(0, 160)}${last ? ` (${last.message.split('\n')[0]})` : ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    };
    const goto = async (target) => {
      const result = await call('Page.navigate', { url: target });
      if (result.errorText) throw new Error(`navigation to ${target} failed: ${result.errorText}`);
      await waitFor(() => document.readyState !== 'loading');
    };
    if (url) await goto(url);
    return {
      goto, evaluate, waitFor, errors, requests,
      // Raw DevTools access for what the helpers above do not cover (viewport, input, heap).
      cdp: call,
      close: async () => {
        sessions.delete(sessionId);
        await send('Target.closeTarget', { targetId }).catch(() => {});
        await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      },
    };
  }

  return {
    executable, newPage,
    close: async () => {
      if (closed) return;
      await Promise.race([send('Browser.close').catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
      try { socket.close(); } catch { /* already closed */ }
      await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 2000); } });
      process.removeListener('exit', cleanup);
      cleanup();
    },
  };
}
