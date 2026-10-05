import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runConformance, stripSource } from './conformance.mjs';
import { engineVersion, publish, vendorGame, verifyPublished } from './sync-engine.mjs';
import { scaffold } from './new-game.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = engineVersion(REPO);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// A checkout in miniature: the engine, the published tree and one copy of the reference game.
function checkout(name, { game = 'achtung' } = {}) {
  const root = path.join(scratch, name);
  fs.cpSync(path.join(REPO, 'engine'), path.join(root, 'engine'), { recursive: true, filter: (src) => !src.includes(`${path.sep}test`) });
  fs.cpSync(path.join(REPO, 'public'), path.join(root, 'public'), { recursive: true });
  if (game) {
    const skip = new Set(['node_modules', 'engine', '.anybuild', '.shipit']);
    fs.cpSync(path.join(REPO, game), path.join(root, game), { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
    linkModules(path.join(root, game));
  }
  return root;
}
const linkModules = (dir) => fs.symlinkSync(path.join(REPO, 'achtung/node_modules'), path.join(dir, 'node_modules'));
const byId = (result) => Object.fromEntries(result.rows.map((row) => [row.id, row]));
const failed = (result) => result.rows.filter((row) => row.status === 'fail').map((row) => `${row.id}: ${row.detail}`);
const edit = (file, from, to) => {
  const before = fs.readFileSync(file, 'utf8');
  assert.ok(before.includes(from), `${file} no longer contains ${from}`);
  fs.writeFileSync(file, before.replace(from, to));
};
const ROWS = ['healthz', 'create', 'join', 'link', 'pinned', 'published', 'server', 'accumulator', 'netcode',
  'simulation', 'schema', 'fixture', 'budget', 'readme', 'ledger'];

test('the reference game passes every row against its own server and a headless browser', async () => {
  const root = checkout('conforming');
  const tracked = fs.readdirSync(path.join(root, 'achtung/public')).join(',');
  const result = await runConformance(path.join(root, 'achtung'), { port: 8840 });
  assert.deepEqual(failed(result), []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((row) => row.id), ROWS);
  assert.match(byId(result).create.detail, /\?room=[A-Z0-9]{4}/);
  assert.equal(fs.readdirSync(path.join(root, 'achtung/public')).join(','), tracked, 'the run wrote into public/');
});

test('the static tier passes the reference game from source alone and prints JSON', () => {
  const root = checkout('static');
  const run = spawnSync(process.execPath, [path.join(REPO, 'scripts/conformance.mjs'), path.join(root, 'achtung'), '--static', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.tier, 'static');
  assert.deepEqual(result.rows.map((row) => row.id), ROWS);
  assert.ok(result.rows.every((row) => row.status === 'pass'), run.stdout);
  assert.match(byId(result).create.detail, /source proof/);
  assert.equal(fs.existsSync(path.join(root, 'achtung/engine')), false, 'the static tier copied the server half');
});

test('the static tier and the scaffold depend on nothing but fs, path and url', () => {
  for (const file of ['conformance.mjs', 'new-game.mjs']) {
    const source = fs.readFileSync(path.join(REPO, 'scripts', file), 'utf8');
    const statics = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    assert.deepEqual(statics.sort(), ['node:fs', 'node:path', 'node:url'], file);
  }
});

test('a removed health endpoint fails that row by name and the other rows are still reported', async () => {
  const root = checkout('no-health');
  edit(path.join(root, 'engine/server.js'), 'pathname === "/healthz"', 'pathname === "/healthz-gone"');
  const result = await runConformance(path.join(root, 'achtung'), { port: 8841 });
  const rows = byId(result);
  assert.equal(result.ok, false);
  assert.equal(rows.healthz.status, 'fail');
  assert.match(rows.healthz.detail, /\/healthz answered 404/);
  assert.deepEqual(result.rows.map((row) => row.id), ROWS);
  assert.equal(rows.create.status, 'pass', rows.create.detail);
  assert.equal(rows.fixture.status, 'pass');

  const cli = spawnSync(process.execPath, [path.join(REPO, 'scripts/conformance.mjs'), path.join(root, 'achtung'), '--port', '8841'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /FAIL\s+healthz/);
  assert.match(cli.stdout, /PASS\s+create/);
  assert.match(cli.stdout, /conformance: FAIL \(healthz/);
});

test('an unpinned engine import fails the pinning row', async () => {
  const root = checkout('unpinned');
  const page = path.join(root, 'achtung/public/index.html');
  edit(page, `/engine/${VERSION}/`, '/engine/');
  let rows = byId(await runConformance(path.join(root, 'achtung'), { static: true }));
  assert.equal(rows.pinned.status, 'fail');
  assert.match(rows.pinned.detail, /unpinned engine specifier/);
  assert.equal(rows.create.status, 'fail', 'an unpinned page cannot prove the contract from source');

  edit(page, '/engine/"', '/engine/latest/"');
  rows = byId(await runConformance(path.join(root, 'achtung'), { static: true }));
  assert.match(rows.pinned.detail, /unpinned engine specifier/);

  edit(page, /"@engine\/": "[^"]*"/.exec(fs.readFileSync(page, 'utf8'))[0], '"@other/": "x"');
  rows = byId(await runConformance(path.join(root, 'achtung'), { static: true }));
  assert.match(rows.pinned.detail, /no "@engine\/" import map entry/);
});

test('a missing engine version directory is reported with the version', async () => {
  const root = checkout('unpublished');
  fs.rmSync(path.join(root, 'public/engine', VERSION), { recursive: true });
  const result = await runConformance(path.join(root, 'achtung'), { port: 8842 });
  const rows = byId(result);
  assert.equal(rows.published.status, 'fail');
  assert.ok(rows.published.detail.includes(`engine ${VERSION} is not published`), rows.published.detail);
  assert.ok(rows.published.detail.includes(`public/engine/${VERSION}/engine.js`), rows.published.detail);
  assert.equal(rows.create.status, 'fail', 'the page cannot load an engine that is not there');
  assert.equal(rows.healthz.status, 'pass');
});

test('the source scans name a second loop, own netcode, an own server and an impure simulation', async () => {
  const root = checkout('scans');
  const dir = path.join(root, 'achtung');
  fs.appendFileSync(path.join(dir, 'public/client.js'), '\nrequestAnimationFrame(() => {});\nconst ws = new WebSocket("wss://x");\nnew URLSearchParams(location.search).get("room");\n// setInterval in a comment is fine\n');
  fs.appendFileSync(path.join(dir, 'src/server.js'), '\nimport http from "node:http";\nhttp.createServer(() => {}).listen(1);\n');
  fs.appendFileSync(path.join(dir, 'public/game.js'), '\nexport const roll = () => Math.random();\n');
  fs.rmSync(path.join(dir, 'test/replay.ndjson'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Game\n\n## Input\n');
  const rows = byId(await runConformance(dir, { static: true }));
  assert.match(rows.accumulator.detail, /client\.js:\d+ requestAnimationFrame/);
  assert.doesNotMatch(rows.accumulator.detail, /setInterval/);
  assert.match(rows.netcode.detail, /new WebSocket/);
  assert.match(rows.netcode.detail, /reads the room\/create parameter/);
  assert.match(rows.server.detail, /imports node:http/);
  assert.equal(rows.healthz.status, 'fail');
  assert.match(rows.simulation.detail, /Math\.random/);
  assert.match(rows.fixture.detail, /replay\.ndjson is missing/);
  assert.equal(rows.budget.status, 'fail');
  assert.match(rows.readme.detail, /snapshot, round lifecycle/);
  assert.equal(rows.schema.status, 'pass');
});

test('a snapshot over budget and an asset without a ledger row fail their rows', async () => {
  const root = checkout('budget');
  edit(path.join(root, 'engine/params.js'), /SNAPSHOT_BUDGET_BYTES = \d+/.exec(fs.readFileSync(path.join(root, 'engine/params.js'), 'utf8'))[0], 'SNAPSHOT_BUDGET_BYTES = 2');
  const assets = fs.readFileSync(path.join(root, 'engine/params.js'), 'utf8').match(/ASSET_SET_VERSION = "([^"]+)"/)[1];
  const ledger = path.join(root, 'public/assets', assets, `ledger-${assets}.json`);
  const rowsOf = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  const dropped = Object.keys(rowsOf)[0];
  delete rowsOf[dropped];
  rowsOf.orphan = { source: 'nowhere', licence: 'none' };
  fs.writeFileSync(ledger, JSON.stringify(rowsOf));
  let rows = byId(await runConformance(path.join(root, 'achtung'), { static: true }));
  assert.equal(rows.budget.status, 'fail');
  assert.ok(rows.ledger.detail.includes(`asset ${dropped} has no ledger row`), rows.ledger.detail);
  assert.match(rows.ledger.detail, /ledger row orphan has no asset/);

  fs.rmSync(path.join(root, 'public/assets'), { recursive: true });
  rows = byId(await runConformance(path.join(root, 'achtung'), { static: true }));
  assert.match(rows.ledger.detail, /not present/);
});

test('a missing browser is a named prerequisite, not a crash', async () => {
  const root = checkout('no-browser');
  const before = process.env.CHROME_BIN;
  process.env.CHROME_BIN = path.join(scratch, 'no-such-browser');
  try {
    const rows = byId(await runConformance(path.join(root, 'achtung'), { port: 8843 }));
    assert.match(rows.create.detail, /prerequisite missing: no Chrome or Chromium/);
    assert.equal(rows.join.status, 'fail');
    assert.equal(rows.healthz.status, 'pass');
    assert.equal(rows.link.status, 'pass');
  } finally {
    if (before === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = before;
  }
});

test('the published engine matches its source byte for byte, and drift names both paths', () => {
  assert.deepEqual(verifyPublished(REPO).problems, [], 'run: node scripts/sync-engine.mjs publish');
  const root = checkout('drift', { game: null });
  assert.deepEqual(verifyPublished(root).problems, []);
  fs.appendFileSync(path.join(root, 'public/engine', VERSION, 'loop.js'), '\n// drift\n');
  assert.deepEqual(verifyPublished(root).problems, ['loop.js differs from engine/loop.js']);
  fs.rmSync(path.join(root, 'public/engine', VERSION, 'rng.js'));
  assert.ok(verifyPublished(root).problems.includes('rng.js is not published'));
  fs.rmSync(path.join(root, 'public/engine', VERSION), { recursive: true });
  assert.deepEqual(verifyPublished(root).problems, [`public/engine/${VERSION} is missing`]);
  publish(root);
  assert.deepEqual(verifyPublished(root).problems, []);
});

test('a vendored game passes conformance offline from its own copy of the engine', async () => {
  const root = checkout('vendored');
  const dir = path.join(root, 'achtung');
  vendorGame('achtung', root);
  assert.match(fs.readFileSync(path.join(dir, 'public/index.html'), 'utf8'), /"@engine\/": "\/engine\/"/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /public\/engine/);
  // Nothing outside the game may be served: the published tree is gone and the browser has no network.
  fs.rmSync(path.join(root, 'public/engine'), { recursive: true });
  const inherited = process.env.SUPERAPP_LOCAL_DIR;
  process.env.SUPERAPP_LOCAL_DIR = path.join(REPO, 'public');
  try {
    const result = await runConformance(dir, { port: 8844, offline: true });
    assert.deepEqual(failed(result), []);
    assert.match(byId(result).pinned.detail, new RegExp(`vendored copy of ${VERSION.replaceAll('.', '\\.')}`));
    assert.match(byId(result).published.detail, /served at \/engine\/engine\.js/);
  } finally {
    if (inherited === undefined) delete process.env.SUPERAPP_LOCAL_DIR; else process.env.SUPERAPP_LOCAL_DIR = inherited;
  }
});

test('a scaffolded game passes its own tests and conformance out of the box', async () => {
  const root = checkout('scaffold', { game: null });
  const made = await scaffold({ slug: 'pellet-chase', name: 'Pellet Chase', root });
  for (const file of ['src/server.js', 'public/index.html', 'public/client.js', 'public/game.js', 'test/game.test.mjs',
    'test/replay.ndjson', 'package.json', '.gitignore', 'app.yaml', 'game-entry.json', 'README.md']) {
    assert.ok(fs.existsSync(path.join(made.dir, file)), file);
  }
  const app = fs.readFileSync(path.join(made.dir, 'app.yaml'), 'utf8');
  assert.match(app, /^name: pellet-chase$/m);
  assert.doesNotMatch(app, /app_id|annotations/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(made.dir, 'game-entry.json'), 'utf8')).source, 'pellet-chase/');
  assert.ok(fs.readFileSync(path.join(made.dir, 'public/index.html'), 'utf8').includes(`/engine/${VERSION}/`));

  const tests = spawnSync('npm', ['test'], { cwd: made.dir, encoding: 'utf8' });
  assert.equal(tests.status, 0, tests.stdout + tests.stderr);

  const statics = await runConformance(made.dir, { static: true });
  assert.deepEqual(failed(statics), []);
  linkModules(made.dir);
  const full = await runConformance(made.dir, { port: 8845 });
  assert.deepEqual(failed(full), []);

  await assert.rejects(scaffold({ slug: 'pellet-chase', name: 'Again', root }), /already exists/);
  await assert.rejects(scaffold({ slug: 'Bad_Slug', name: 'X', root }), /lowercase/);
  const help = spawnSync(process.execPath, [path.join(REPO, 'scripts/new-game.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: node scripts\/new-game\.mjs <slug> --name/);
  const cli = spawnSync(process.execPath, [path.join(REPO, 'scripts/new-game.mjs'), 'second-game', '--name', 'Second', '--root', root], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(fs.existsSync(path.join(root, 'second-game/test/replay.ndjson')));
});

// A stand-in for the superapp origin whose headers each case chooses.
async function superapp(port, { reflect = false, vary = 'Accept-Encoding, Origin', indexCache = 'no-cache', engine = true } = {}) {
  const assets = fs.readFileSync(path.join(REPO, 'engine/params.js'), 'utf8').match(/ASSET_SET_VERSION = "([^"]+)"/)[1];
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const shared = /^\/(engine|assets)\//.test(pathname);
    const file = path.join(REPO, 'public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory() || (!engine && pathname.startsWith('/engine/'))) {
      res.writeHead(404); return res.end();
    }
    const headers = {
      'content-type': pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.json') ? 'application/json' : 'text/html',
      'cache-control': shared ? `public, max-age=${pathname.endsWith('.json') ? 3600 : 31536000}` : indexCache,
      vary: shared ? vary : 'accept-encoding',
    };
    if (req.headers.origin) headers['access-control-allow-origin'] = reflect ? req.headers.origin : '*';
    res.writeHead(200, headers);
    return res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const result = await runConformance(`http://127.0.0.1:${port}`, {});
  await new Promise((resolve) => server.close(resolve));
  assert.equal(result.kind, 'superapp-origin');
  assert.ok(fs.existsSync(path.join(REPO, 'public/assets', assets)), 'the asset set is not in the tree');
  return result;
}

test('the superapp header rows pass a literal allowance and a reflected origin that varies', async () => {
  assert.deepEqual(failed(await superapp(8846)), []);
  assert.deepEqual(failed(await superapp(8846, { reflect: true })), []);
});

test('a reflected origin without vary: origin fails its row (D-12)', async () => {
  const rows = byId(await superapp(8847, { reflect: true, vary: 'accept-encoding' }));
  assert.equal(rows['cors-vary'].status, 'fail');
  assert.match(rows['cors-vary'].detail, /origin reflected with vary: accept-encoding/);
  assert.equal(rows.cors.status, 'pass');
});

test('an index that inherits a long lifetime fails its row (D-13)', async () => {
  const rows = byId(await superapp(8848, { indexCache: 'public, max-age=86400' }));
  assert.equal(rows['index-lifetime'].status, 'fail');
  assert.match(rows['index-lifetime'].detail, /cached for 86400 s/);
});

test('an origin without the engine version names the version', async () => {
  const rows = byId(await superapp(8849, { engine: false }));
  assert.equal(rows['engine-reachable'].status, 'fail');
  assert.ok(rows['engine-reachable'].detail.includes(`engine ${VERSION} is unreachable`), rows['engine-reachable'].detail);
  assert.equal(rows['engine-cache'].status, 'fail');
});

test('the scanner ignores comments and string contents', () => {
  const { code, text } = stripSource('const a = "setInterval"; // requestAnimationFrame\n/* new WebSocket */ go();\n');
  assert.doesNotMatch(code, /setInterval|requestAnimationFrame|WebSocket/);
  assert.match(text, /"setInterval"/);
  assert.match(code, /go\(\)/);
});
