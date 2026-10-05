// The parts of the conformance suite that need a process: the game's own
// server on a local port, and the headless browser.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export { launch, findBrowser } from './browser.mjs';

export const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// Copies only what differs, so a run against an up-to-date game writes nothing.
export function ensureServerHalf(dir, root, modules) {
  for (const name of modules) {
    const from = path.join(root, 'engine', name);
    const to = path.join(dir, 'engine', name);
    const wanted = fs.readFileSync(from);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(wanted)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, wanted);
  }
}

export async function startGameServer({ dir, root, vendored = false, port, modules, startupMs = 10000 }) {
  const failed = (detail) => ({ ok: false, detail, stop: async () => {} });
  if (!fs.existsSync(path.join(dir, 'src/server.js'))) return failed('src/server.js is missing, so the game cannot be started');
  try { ensureServerHalf(dir, root, modules); } catch (error) { return failed(`cannot copy the engine's server half: ${error.message}`); }
  if (!fs.existsSync(path.join(dir, 'node_modules/ws'))) {
    const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
    if (installed.status !== 0) return failed(`prerequisite missing: ws is not installed in ${dir} and npm install failed`);
  }
  const chosen = port || await freePort();
  const env = { ...process.env, PORT: String(chosen), HOST: '127.0.0.1', SUPERAPP_LOCAL_DIR: path.join(root, 'public') };
  if (vendored) delete env.SUPERAPP_LOCAL_DIR;
  const child = spawn(process.execPath, ['src/server.js'], { cwd: dir, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', (chunk) => { log += chunk; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } };
  const origin = `http://127.0.0.1:${chosen}`;
  const deadline = Date.now() + startupMs;
  for (;;) {
    if (child.exitCode !== null) return failed(`the game's server exited with ${child.exitCode}: ${log.trim().split('\n').slice(-3).join(' ')}`);
    try { await fetch(`${origin}/`); return { ok: true, origin, port: chosen, stop }; } catch { /* not listening yet */ }
    if (Date.now() > deadline) { await stop(); return failed(`the game's server did not listen on ${chosen} within ${startupMs} ms`); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
