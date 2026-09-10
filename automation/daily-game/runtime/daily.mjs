import { spawn } from 'node:child_process';

const child = spawn('/bin/python', ['/app/daily_game.py', ...process.argv.slice(2)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', data => process.stdout.write(data));
child.stderr.on('data', data => process.stderr.write(data));
child.on('error', error => {
  console.error(`Cannot start daily game generation: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', code => { process.exitCode = code ?? 1; });
