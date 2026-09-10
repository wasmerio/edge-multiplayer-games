import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const root = '/repository';
const tests = `${root}/automation/daily-game/test`;
const manifest = readFileSync(`${root}/automation/daily-game/wasmer.toml`, 'utf8');
const python = manifest.match(/PYTHONEXECUTABLE=([^"\]]+)/)?.[1];
if (!python) throw new Error('Missing Python executable in the package manifest');
const env = {
  ...process.env, PYTHONEXECUTABLE: python, PYTHONPATH: `/app:${tests}`,
  GAME_TEST_ROOT: root, GAME_RUNTIME_ROOT: '/app', WASMER_GIT_TESTS: '1', BASH_OPERATIONS_MODULE: '/app/bash_operations.mjs',
  CAPTURE_MODULE: '/app/capture.mjs', PI_EVENTS_MODULE: '/app/pi_events.mjs',
};
async function run(command, args) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Test command failed: ${command} (${code})`)));
  });
}
await run('/bin/python', ['-m', 'unittest', 'discover', '-s', tests, '-p', 'test_*.py']);
for (const file of ['test_bash_operations.mjs', 'test_capture.mjs', 'test_pi_events.mjs']) {
  await run('/bin/node', [`${tests}/${file}`]);
}
console.log('PASS Wasmer harness suite');
