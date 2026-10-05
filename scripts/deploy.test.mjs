import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-check-'));
try {
  for (const dir of ['bin', 'public', 'scripts', 'fixture-game']) fs.mkdirSync(path.join(root, dir));
  for (const file of ['deploy.sh', 'scripts/register-game.mjs', 'scripts/sync-engine.mjs']) {
    fs.copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, file));
  }
  const published = path.join(root, 'public/engine/9.9.9');
  const modules = { 'params.js': 'export const ENGINE_VERSION = "9.9.9";\n', 'rng.js': '// rng\n', 'rooms.js': '// rooms\n', 'server.js': '// server\n' };
  for (const dir of [path.join(root, 'engine'), published]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(modules)) fs.writeFileSync(path.join(dir, name), body);
  }
  fs.writeFileSync(path.join(root, 'app.yaml'), 'name: fixture\n');
  fs.writeFileSync(path.join(root, 'fixture-game/app.yaml'), 'name: fixture-game\n');
  fs.writeFileSync(path.join(root, 'wasmer.toml'), '[package]\nname="fixture/root"\n');
  fs.writeFileSync(path.join(root, 'public/games.json'), '[]\n');
  fs.writeFileSync(path.join(root, '.wasmerignore'), '/scripts/\n');
  const stub = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const uploaded = tool === 'wasmer' && args[0] === 'deploy'
  ? {ignore: fs.existsSync('.ignore') ? fs.readFileSync('.ignore', 'utf8') : null, engine: fs.existsSync('engine/server.js')} : {};
fs.appendFileSync(process.env.CHECK_LOG, JSON.stringify({tool,args,...uploaded}) + '\\n');
const out = text => fs.writeSync(1, text + '\\n');
if (tool === 'wasmer') {
  if (args[0] === 'whoami') out('Logged into registry wasmer.io as user fixture');
  else if (args[0] === 'package' && args[1] === 'build') {
    const file = fs.openSync(args[args.indexOf('-o') + 1], 'w');
    fs.ftruncateSync(file, process.env.CHECK_MODE === 'oversize' ? 65*1024*1024 : 1024);
    fs.closeSync(file);
  } else if (args[0] === 'deploy') {
    if (fs.existsSync('wasmer.toml') && !args.includes('--bump')) {
      out('error: The version 0.2.0 already exists for package fixture/root'); process.exit(1);
    }
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
  function run(mode, target = 'super') {
    const log = path.join(root, `${mode}.jsonl`);
    const result = spawnSync('bash', [path.join(root, 'deploy.sh'), target], {
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
  assert.ok(retry.deploys.every(call => call.args.includes('--bump')));
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
  fs.writeFileSync(path.join(root, 'fixture-game/game-entry.json'), JSON.stringify({
    slug: 'fixture-game', source: 'fixture-game/', name: 'Fixture',
    description: 'Deployment test game.', players: '2 to 8',
  }));
  const remote = run('remote', 'fixture-game');
  assert.equal(remote.status, 0, remote.stdout + remote.stderr);
  assert.ok(remote.deploys.every(call => call.args.includes('--build-remote') && !call.args.includes('--bump')));
  assert.ok(remote.deploys.every(call => call.engine === false && call.ignore === null), 'a game without the engine is uploaded as it is');

  // An engine game: the server half is copied in, and whitelisted past .gitignore only for the upload.
  const game = path.join(root, 'fixture-game');
  fs.mkdirSync(path.join(game, 'src'));
  fs.writeFileSync(path.join(game, 'src/server.js'), 'import { serveGame } from "../engine/server.js";\n');
  fs.writeFileSync(path.join(game, '.gitignore'), 'engine/\n');
  const engineGame = run('engine-game', 'fixture-game');
  assert.equal(engineGame.status, 0, engineGame.stdout + engineGame.stderr);
  assert.ok(engineGame.deploys.length > 0);
  assert.ok(engineGame.deploys.every(call => call.engine === true && call.ignore === '!/engine/\n'), JSON.stringify(engineGame.deploys));
  assert.equal(fs.readFileSync(path.join(game, 'engine/server.js'), 'utf8'), modules['server.js']);
  assert.equal(fs.existsSync(path.join(game, '.ignore')), false, 'the upload whitelist is removed after the deploy');
  fs.writeFileSync(path.join(game, '.ignore'), 'notes/\n');
  const hidden = run('engine-hidden', 'fixture-game');
  assert.equal(hidden.status, 1);
  assert.equal(hidden.deploys.length, 0);
  assert.match(hidden.stderr, /\.ignore must contain '!\/engine\/'/);
  fs.writeFileSync(path.join(game, '.ignore'), 'notes/\n!/engine/\n');
  const kept = run('engine-kept', 'fixture-game');
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  assert.equal(fs.readFileSync(path.join(game, '.ignore'), 'utf8'), 'notes/\n!/engine/\n');

  // The superapp upload stops when the published engine is absent or has drifted.
  fs.appendFileSync(path.join(published, 'rng.js'), '// drift\n');
  const drifted = run('drifted');
  assert.equal(drifted.status, 1);
  assert.equal(drifted.deploys.length, 0);
  assert.match(drifted.stderr, /rng\.js differs from engine\/rng\.js/);
  fs.rmSync(published, { recursive: true });
  const absent = run('absent');
  assert.equal(absent.status, 1);
  assert.equal(absent.deploys.length, 0);
  assert.equal(absent.calls.filter(call => call.tool === 'wasmer' && call.args[0] === 'package').length, 0);
  assert.match(absent.stderr, /public\/engine\/9\.9\.9 is missing/);
  console.log('PASS engine server half travels with a game, upload whitelist, and published-engine guard');
  console.log('PASS package version bumps, remote build flags, gateway retries, retry limit, permanent failures, preparation once, and package size guard');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
