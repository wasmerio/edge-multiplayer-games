import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-check-'));
try {
  for (const dir of ['bin', 'public', 'scripts']) fs.mkdirSync(path.join(root, dir));
  for (const file of ['deploy.sh', 'scripts/register-game.mjs']) {
    fs.copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, file));
  }
  fs.writeFileSync(path.join(root, 'app.yaml'), 'name: fixture\n');
  fs.writeFileSync(path.join(root, 'wasmer.toml'), '[package]\nname="fixture/root"\n');
  fs.writeFileSync(path.join(root, 'public/games.json'), '[]\n');
  fs.writeFileSync(path.join(root, '.wasmerignore'), '/scripts/\n');
  const stub = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CHECK_LOG, JSON.stringify({tool,args}) + '\\n');
const out = text => fs.writeSync(1, text + '\\n');
if (tool === 'wasmer') {
  if (args[0] === 'whoami') out('Logged into registry wasmer.io as user fixture');
  else if (args[0] === 'package' && args[1] === 'build') {
    const file = fs.openSync(args[args.indexOf('-o') + 1], 'w');
    fs.ftruncateSync(file, process.env.CHECK_MODE === 'oversize' ? 65*1024*1024 : 1024);
    fs.closeSync(file);
  } else if (args[0] === 'deploy') {
    const attempts = fs.readFileSync(process.env.CHECK_LOG, 'utf8').trim().split('\\n')
      .map(line => JSON.parse(line)).filter(call => call.args[0] === 'deploy').length;
    if (process.env.CHECK_MODE === 'permanent') { out('Invalid app configuration'); process.exit(1); }
    if (process.env.CHECK_MODE === 'exhausted' || attempts < 3) {
      out('error: Server returned 502 Bad Gateway'); process.exit(1);
    }
  } else if (args[0] === 'app' && args[1] === 'get') out(JSON.stringify({url:'https://fixture.example'}));
  else throw new Error('Unexpected fake Wasmer command');
} else if (tool === 'curl') out('200');
`;
  for (const tool of ['wasmer', 'npm', 'curl', 'sleep']) {
    fs.writeFileSync(path.join(root, 'bin', tool), stub, { mode: 0o755 });
  }
  function run(mode) {
    const log = path.join(root, `${mode}.jsonl`);
    const result = spawnSync('bash', [path.join(root, 'deploy.sh'), 'super'], {
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CHECK_LOG: log, CHECK_MODE: mode },
      encoding: 'utf8', timeout: 15000,
    });
    if (result.error) throw result.error;
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    return { ...result, calls, deploys: calls.filter(call => call.tool === 'wasmer' && call.args[0] === 'deploy') };
  }
  const retry = run('retry');
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(retry.deploys.length, 3);
  assert.ok(retry.deploys.every(call => !call.args.includes('--build-remote')));
  assert.equal(retry.calls.filter(call => call.tool === 'npm' && call.args[0] === 'ci').length, 1);
  assert.deepEqual(retry.calls.filter(call => call.tool === 'sleep').map(call => call.args), [['5'], ['10']]);
  const permanent = run('permanent');
  assert.equal(permanent.status, 1);
  assert.equal(permanent.deploys.length, 1);
  assert.match(permanent.stderr, /failure log saved to/);
  const exhausted = run('exhausted');
  assert.equal(exhausted.status, 1);
  assert.equal(exhausted.deploys.length, 3);
  const oversize = run('oversize');
  assert.equal(oversize.status, 1);
  assert.equal(oversize.deploys.length, 0);
  assert.match(oversize.stderr, /package size check failed before upload/);
  console.log('PASS deployment gateway retries, retry limit, permanent failures, preparation once, and package size guard');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
