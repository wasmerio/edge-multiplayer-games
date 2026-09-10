import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { terminateChild } from './terminate_child.mjs';

const [seconds, limit, command, ...args] = process.argv.slice(2);
const timeout = Number(seconds) * 1000;
const maxBytes = Number(limit);
if (!command || !Number.isFinite(timeout) || timeout <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
  throw new Error('Expected timeout, output limit, and command');
}
const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let bytes = 0;
let failed = false;
function stop(message) {
  if (failed) return;
  failed = true;
  writeSync(2, message + '\n');
  terminateChild(child);
}
const timer = setTimeout(() => stop('Command timed out'), timeout);
function forward(chunk, fd) {
  if (failed) return;
  bytes += chunk.length;
  if (bytes > maxBytes) stop('Command output exceeds limit');
  else writeSync(fd, chunk);
}
child.stdout.on('data', chunk => forward(chunk, 1));
child.stderr.on('data', chunk => forward(chunk, 2));
child.on('error', error => { failed = true; writeSync(2, error.message + '\n'); });
child.on('close', code => {
  clearTimeout(timer);
  process.exitCode = failed ? 1 : (code ?? 1);
});
