import assert from 'node:assert/strict';
const { bashOperations, createBashOperations } = await import(process.env.BASH_OPERATIONS_MODULE || '../runtime/bash_operations.mjs');
let output = '';
const options = { onData: data => { output += data.toString(); }, env: process.env };
const result = await bashOperations.exec('printf "%s\\n" "$PWD"; printf "stderr-check\\n" >&2; exit 7', '/tmp', options);
assert.equal(result.exitCode, 7);
assert(output.includes('/tmp'));
assert(output.includes('stderr-check'));
assert.equal((await bashOperations.exec('printf "ok\\n"', '/tmp', options)).exitCode, 0);
const abort = new AbortController();
abort.abort();
await assert.rejects(bashOperations.exec('exit 0', '/tmp', { ...options, signal: abort.signal }), /aborted/);
await assert.rejects(bashOperations.exec('while :; do :; done', '/tmp', { ...options, timeout: 0.1 }), /timed out/);
let started = Date.now();
await assert.rejects(bashOperations.exec('sleep 3 & wait', '/tmp', { ...options, timeout: 0.1 }), /timed out/);
assert(Date.now() - started < 1500, 'Timeout must not wait for descendants holding pipes');
const running = new AbortController();
started = Date.now();
const command = bashOperations.exec('sleep 3 & wait', '/tmp', { ...options, signal: running.signal });
setTimeout(() => running.abort(), 100);
await assert.rejects(command, /aborted/);
assert(Date.now() - started < 1500, 'Active cancellation must not wait for inherited pipes');
let fatalTimeouts = 0;
await assert.rejects(createBashOperations(() => { fatalTimeouts++; }).exec('while :; do :; done', '/tmp', {
  ...options, timeout: 0.1,
}), /timed out/);
assert.equal(fatalTimeouts, 1, 'Pi must receive one fatal timeout notification');
console.log('PASS Wasmer Bash operations: cwd, output, exit status, abort, timeout');
