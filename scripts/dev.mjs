// Runs one game locally against the engine in this checkout:
//   node scripts/dev.mjs <game> [port]
// The game keeps its pinned superapp import; the server repoints it at public/.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish, syncGame } from './sync-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function prepare(slug, root = ROOT) {
  const dir = path.join(root, slug);
  if (!fs.existsSync(path.join(dir, 'src/server.js'))) throw new Error(`${slug}: no src/server.js; is this a game directory?`);
  publish(root);
  syncGame(slug, root);
  if (!fs.existsSync(path.join(dir, 'node_modules/ws'))) {
    const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
    if (installed.status !== 0) throw new Error(`${slug}: npm install failed`);
  }
  return dir;
}

export function start(slug, port = 8765, root = ROOT) {
  const dir = prepare(slug, root);
  return spawn(process.execPath, ['src/server.js'], {
    cwd: dir, stdio: 'inherit',
    env: { ...process.env, PORT: String(port), SUPERAPP_LOCAL_DIR: path.join(root, 'public') },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [slug, port] = process.argv.slice(2);
  if (!slug || slug === '--help') {
    console.log('usage: node scripts/dev.mjs <game> [port]\n\nServes the game on http://localhost:<port> (default 8765) until Ctrl+C or a kill of this process.');
    process.exit(slug ? 0 : 1);
  }
  try {
    const child = start(slug, Number(port || 8765));
    child.on('exit', (code) => process.exit(code ?? 0));
    // Ctrl+C or a kill of this process stops the server too, so the port is free again.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
