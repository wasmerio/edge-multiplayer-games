import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = process.env.CAPTURE_MODULE || fileURLToPath(new URL('../runtime/capture.mjs', import.meta.url));
async function run(seconds, limit, command, args) {
  const child = spawn(process.execPath, [runner, String(seconds), String(limit), command, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
let result = await run(5, 1024, '/bin/bash', ['-c', 'printf ok; printf failure >&2; exit 7']);
assert.deepEqual(result, {code: 7, stdout: 'ok', stderr: 'failure'});
result = await run(5, 1024, process.execPath, ['-e', 'require("node:fs").writeSync(1, "x".repeat(100000));']);
assert.equal(result.code, 1);
assert(result.stdout.length <= 1024);
assert(result.stderr.includes('output exceeds limit'));
const started = Date.now();
result = await run(0.1, 1024, '/bin/bash', ['-c', 'sleep 3 & wait']);
assert.equal(result.code, 1);
assert(result.stderr.includes('timed out'));
assert(Date.now() - started < 2000, 'Descendants must not extend the command deadline');
console.log('PASS bounded command capture: output, nonzero exit, output limit, inherited-pipe timeout');
