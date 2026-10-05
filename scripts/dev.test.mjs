// The local dev server: stopping the command must stop the game's server and free the port.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffold } from './new-game.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8875;
const answers = () => fetch(`http://127.0.0.1:${PORT}/healthz`).then((response) => response.ok, () => false);
const until = async (wanted, ms) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    if (await answers() === wanted) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} to dev.mjs stops the server it started`, async () => {
    const slug = `dev-probe-${signal.toLowerCase()}`;
    fs.rmSync(path.join(REPO, slug), { recursive: true, force: true });
    const made = await scaffold({ slug, name: 'Dev Probe', root: REPO });
    after(() => fs.rmSync(made.dir, { recursive: true, force: true }));
    fs.symlinkSync(path.join(REPO, 'achtung/node_modules'), path.join(made.dir, 'node_modules'));
    const dev = spawn(process.execPath, [path.join(REPO, 'scripts/dev.mjs'), slug, String(PORT)], { stdio: 'ignore' });
    const exited = new Promise((resolve) => dev.once('exit', resolve));
    try {
      assert.equal(await until(true, 10000), true, 'the game answers /healthz');
      dev.kill(signal);
      await exited;
      assert.equal(await until(false, 5000), true, 'the port is free again');
    } finally {
      dev.kill('SIGKILL');
    }
  });
}
