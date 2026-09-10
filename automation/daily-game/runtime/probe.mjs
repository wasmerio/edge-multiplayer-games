import { spawn } from 'node:child_process';

// Start Edge.js first so Wasmer installs its Wasm C API imports for children.
const child = spawn('/bin/python', [
  '/app/git_pi_probe.py',
  '--pi-cli', '/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js',
  ...process.argv.slice(2),
], { stdio: ['ignore', 'pipe', 'pipe'] });

child.stdout.on('data', data => process.stdout.write(data));
child.stderr.on('data', data => process.stderr.write(data));
child.on('error', error => {
  console.error(`Cannot start the runtime probe: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', code => { process.exitCode = code ?? 1; });
