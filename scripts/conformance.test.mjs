import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runConformance, stripSource, cssLoads, isForeignLoad } from './conformance.mjs';
import { engineVersion, publish, vendorGame, verifyPublished } from './sync-engine.mjs';
import { scaffold } from './new-game.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = engineVersion(REPO);
const ORIGIN = fs.readFileSync(path.join(REPO, 'engine/params.js'), 'utf8').match(/SUPERAPP_ORIGIN *= *"([^"]+)"/)[1];
// A version published earlier and frozen beside the current one (D-24).
const FROZEN = fs.readdirSync(path.join(REPO, 'public/engine')).filter((name) => name !== VERSION).sort()[0] ?? null;
// The reference game pins a published version, which need not be the current one.
const PIN = fs.readFileSync(path.join(REPO, 'achtung/public/index.html'), 'utf8').match(/\/engine\/(\d+\.\d+\.\d+)\//)[1];
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
const ROWS = ['healthz', 'create', 'join', 'link', 'slots', 'stylesheet', 'origin', 'pinned', 'published', 'server', 'accumulator', 'netcode',
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

// The page of a game that leaves its chrome to the kit.
const barePage = (version) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Bare</title>
<script type="importmap">{ "imports": { "@engine/": "${ORIGIN}/engine/${version}/" } }</script>
</head><body><div id="game"></div><script type="module" src="/client.js"></script></body></html>
`;

test('a page that owns its chrome passes with its slots, its stylesheet and its own superapp link', async () => {
  const root = checkout('owned');
  const rows = byId(await runConformance(path.join(root, 'achtung'), { static: true }));
  assert.match(rows.slots.detail, /the page owns its chrome: \d+ slots, 2 touch button/);
  assert.match(rows.stylesheet.detail, /\/style\.css present/);
  assert.equal(rows.link.detail, 'index.html links to the superapp');
});

test('a bare container page passes every row with the kit\'s default chrome', async () => {
  const root = checkout('bare');
  const dir = path.join(root, 'achtung');
  fs.writeFileSync(path.join(dir, 'public/index.html'), barePage(VERSION));
  fs.rmSync(path.join(dir, 'public/style.css'));
  const result = await runConformance(dir, { port: 8830 });
  assert.deepEqual(failed(result), []);
  const rows = byId(result);
  assert.match(rows.slots.detail, /bare #game container/);
  assert.match(rows.stylesheet.detail, /no stylesheet linked/);
  assert.match(rows.create.detail, /\?room=[A-Z0-9]{4}/);
  assert.match(rows.link.detail, /the rendered page links to/);
  assert.match(byId(await runConformance(dir, { static: true })).link.detail, /the kit header carries the link/);
});

test('missing, misspelt and repeated slots, and a touch button for an unknown field, fail the slots row by name', async () => {
  const root = checkout('slots');
  const dir = path.join(root, 'achtung');
  const page = path.join(dir, 'public/index.html');
  const original = fs.readFileSync(page, 'utf8');
  const slots = async (from, to) => {
    assert.ok(original.includes(from), `the reference page no longer contains ${from}`);
    fs.writeFileSync(page, original.replace(from, to));
    return byId(await runConformance(dir, { static: true }));
  };
  let rows = await slots('data-engine="start"', 'data-role="start"');
  assert.equal(rows.slots.status, 'fail');
  assert.match(rows.slots.detail, /missing required slot\(s\): start/);
  rows = await slots('data-engine="peers"', 'data-engine="peer-list"');
  assert.match(rows.slots.detail, /unknown data-engine role\(s\): peer-list/);
  rows = await slots('data-engine="hud"', 'data-engine="status"');
  assert.match(rows.slots.detail, /used more than once: status/);
  rows = await slots('data-engine-touch="turn=1"', 'data-engine-touch="jump=1"');
  assert.match(rows.slots.detail, /unknown intent field jump/);
  rows = await slots('data-engine-touch="turn=1"', 'data-engine-touch="turn"');
  assert.match(rows.slots.detail, /is not <field>=<number>/);
  rows = await slots('data-engine="arena"', 'data-area="arena"');
  assert.match(rows.slots.detail, /roles without an arena slot are ignored/);

  fs.writeFileSync(page, '<!doctype html><script type="module" src="/client.js"></script>');
  rows = byId(await runConformance(dir, { static: true }));
  assert.match(rows.slots.detail, /neither a data-engine="arena" slot nor an element with id "game"/);
});

test('a page that owns its chrome needs its own invite link, superapp link and stylesheet', async () => {
  const root = checkout('owned-gaps');
  const dir = path.join(root, 'achtung');
  const page = path.join(dir, 'public/index.html');
  const original = fs.readFileSync(page, 'utf8');
  fs.writeFileSync(page, original.replace('data-engine="invite-link"', 'data-was="invite-link"'));
  let rows = byId(await runConformance(dir, { static: true }));
  assert.match(rows.create.detail, /no invite-link slot/);
  assert.equal(rows.join.status, 'pass');

  fs.writeFileSync(page, original.replace(`href="${ORIGIN}"`, 'href="https://elsewhere.example"'));
  rows = byId(await runConformance(dir, { static: true }));
  assert.equal(rows.link.status, 'fail');
  assert.match(rows.link.detail, /owns its chrome and has no link/);

  fs.writeFileSync(page, original);
  fs.rmSync(path.join(dir, 'public/style.css'));
  rows = byId(await runConformance(dir, { static: true }));
  assert.equal(rows.stylesheet.status, 'fail');
  assert.match(rows.stylesheet.detail, /missing or empty: public\/style\.css/);

  fs.writeFileSync(page, original.replace(/<link rel="stylesheet"[^>]*>/, ''));
  rows = byId(await runConformance(dir, { static: true }));
  assert.match(rows.stylesheet.detail, /brings no stylesheet/);
});

test('the stylesheet scan finds every url() and @import, and only another origin is foreign', () => {
  const css = '/* url(https://ignored.example/a.png) */ @import url("https://fonts.example/css"); @import \'/local.css\';\n'
    + 'a { background: url( /img/a.png ); } @font-face { src: url(data:font/woff2;base64,AAAA) format("woff2"), url("//cdn.example/f.woff2"); }';
  assert.deepEqual(cssLoads(css), ['https://fonts.example/css', '/local.css', '/img/a.png', 'data:font/woff2;base64,AAAA', '//cdn.example/f.woff2']);
  const foreign = (url) => isForeignLoad(url, ORIGIN);
  assert.deepEqual(cssLoads(css).filter(foreign), ['https://fonts.example/css', '//cdn.example/f.woff2']);
  for (const local of ['/style.css', 'fonts/a.woff2', './a.png', '#gradient', 'data:image/png;base64,AA', 'blob:x', `${ORIGIN}/engine/1.0.0/engine.js`, `${ORIGIN}/assets/1.0.0/sounds/hit.wav`]) {
    assert.equal(foreign(local), false, local);
  }
  assert.equal(foreign(`${ORIGIN}/other.css`), true, 'only the engine and asset paths of the superapp are shared');
  assert.equal(foreign(`${ORIGIN}.evil.example/engine/x.js`), true);
});

test('a page that loads anything from another origin fails the origin row from source alone', async () => {
  const root = checkout('foreign');
  const dir = path.join(root, 'achtung');
  const page = path.join(dir, 'public/index.html');
  const sheet = path.join(dir, 'public/style.css');
  const client = path.join(dir, 'public/client.js');
  const original = { page: fs.readFileSync(page, 'utf8'), sheet: fs.readFileSync(sheet, 'utf8'), client: fs.readFileSync(client, 'utf8') };
  const origin = async () => byId(await runConformance(dir, { static: true })).origin;
  const reset = () => { fs.writeFileSync(page, original.page); fs.writeFileSync(sheet, original.sheet); fs.writeFileSync(client, original.client); };

  assert.equal((await origin()).status, 'pass');

  edit(page, '</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee">\n</head>');
  let row = await origin();
  assert.equal(row.status, 'fail');
  assert.match(row.detail, /index\.html <link href> https:\/\/fonts\.googleapis\.com\/css2\?family=Bungee/);
  assert.match(row.detail, /ship the file under public\//);
  const all = byId(await runConformance(dir, { static: true }));
  assert.equal(all.stylesheet.status, 'pass', 'the stylesheet row alone did not catch it');
  reset();

  fs.appendFileSync(sheet, '\n@import url("https://fonts.googleapis.com/css2?family=Bungee");\n.x { background: url(//cdn.example/tile.png); }\n');
  row = await origin();
  assert.match(row.detail, /public\/style\.css https:\/\/fonts\.googleapis\.com/);
  assert.match(row.detail, /public\/style\.css \/\/cdn\.example\/tile\.png/);
  reset();

  fs.appendFileSync(sheet, '\n/* @import url("https://fonts.example/x"); */\n@font-face { font-family: Own; src: url("/fonts/own.woff2") format("woff2"); }\n.y { background: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); }\n');
  assert.equal((await origin()).status, 'pass', 'a local font file, a data URL and a commented-out import are fine');
  reset();

  edit(page, '<body>', '<body><img src="https://img.example/logo.png" alt=""><a href="https://elsewhere.example/">a link is not a load</a>');
  row = await origin();
  assert.match(row.detail, /<img src> https:\/\/img\.example\/logo\.png/);
  assert.doesNotMatch(row.detail, /elsewhere/);
  reset();

  edit(page, '<script type="module" src="/client.js"></script>', '<script src="https://cdn.example/lib.js"></script><script type="module" src="/client.js"></script>');
  assert.match((await origin()).detail, /<script src> https:\/\/cdn\.example\/lib\.js/);
  reset();

  fs.appendFileSync(client, '\nconst NS = "http://www.w3.org/2000/svg";\nfetch("https://api.example/score");\n');
  row = await origin();
  assert.match(row.detail, /public\/client\.js https:\/\/api\.example\/score/);
  assert.doesNotMatch(row.detail, /w3\.org/);
});

test('a stick must name two intent fields and needs an engine that binds it', async () => {
  const root = checkout('stick');
  const dir = path.join(root, 'achtung');
  const page = path.join(dir, 'public/index.html');
  const button = '<button data-engine-touch="turn=-1" aria-label="Turn left">◀</button>';
  edit(page, `/engine/${PIN}/`, `/engine/${VERSION}/`);
  edit(page, button, `${button}<div data-engine-stick="turn,turn"><i></i></div>`);
  let rows = byId(await runConformance(dir, { static: true }));
  assert.equal(rows.slots.status, 'pass', rows.slots.detail);
  assert.match(rows.slots.detail, /1 stick\(s\)/);

  edit(page, 'data-engine-stick="turn,turn"', 'data-engine-stick="turn,up"');
  rows = byId(await runConformance(dir, { static: true }));
  assert.match(rows.slots.detail, /data-engine-stick names unknown intent field up/);

  edit(page, 'data-engine-stick="turn,up"', 'data-engine-stick="turn"');
  rows = byId(await runConformance(dir, { static: true }));
  assert.match(rows.slots.detail, /is not <field>,<field>/);

  edit(page, 'data-engine-stick="turn"', 'data-engine-stick="turn,turn"');
  edit(page, `/engine/${VERSION}/`, '/engine/1.0.1/');
  rows = byId(await runConformance(dir, { static: true }));
  assert.equal(rows.slots.status, 'fail');
  assert.match(rows.slots.detail, /predates data-engine-stick/);
});

test('a frozen earlier engine version stays usable by a bare page and is refused for page slots', { skip: FROZEN ? false : 'no earlier engine version is published' }, async () => {
  const root = checkout('frozen');
  const dir = path.join(root, 'achtung');
  const page = path.join(dir, 'public/index.html');
  edit(page, `/engine/${PIN}/`, `/engine/${FROZEN}/`);
  let rows = byId(await runConformance(dir, { static: true }));
  assert.equal(rows.pinned.detail, `pinned to ${FROZEN}`);
  assert.equal(rows.published.status, 'pass', rows.published.detail);
  assert.equal(rows.slots.status, 'fail');
  assert.match(rows.slots.detail, /the pinned engine predates page slots/);

  fs.writeFileSync(page, barePage(FROZEN));
  rows = byId(await runConformance(dir, { static: true }));
  assert.equal(rows.slots.status, 'pass', rows.slots.detail);
  assert.equal(rows.published.status, 'pass');
  assert.equal(rows.link.status, 'pass', rows.link.detail);
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
  edit(page, `/engine/${PIN}/`, '/engine/');
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
  fs.rmSync(path.join(root, 'public/engine', PIN), { recursive: true });
  const result = await runConformance(path.join(root, 'achtung'), { port: 8842 });
  const rows = byId(result);
  assert.equal(rows.published.status, 'fail');
  assert.ok(rows.published.detail.includes(`engine ${PIN} is not published`), rows.published.detail);
  assert.ok(rows.published.detail.includes(`public/engine/${PIN}/engine.js`), rows.published.detail);
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
  for (const file of ['src/server.js', 'public/index.html', 'public/style.css', 'public/client.js', 'public/game.js', 'test/game.test.mjs',
    'test/replay.ndjson', 'package.json', '.gitignore', 'app.yaml', 'game-entry.json', 'README.md']) {
    assert.ok(fs.existsSync(path.join(made.dir, file)), file);
  }
  const app = fs.readFileSync(path.join(made.dir, 'app.yaml'), 'utf8');
  assert.match(app, /^name: pellet-chase$/m);
  assert.doesNotMatch(app, /app_id|annotations/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(made.dir, 'game-entry.json'), 'utf8')).source, 'pellet-chase/');
  const page = fs.readFileSync(path.join(made.dir, 'public/index.html'), 'utf8');
  assert.ok(page.includes(`/engine/${VERSION}/`));
  assert.ok(page.includes('<link rel="stylesheet" href="/style.css">'));
  assert.ok(page.includes(`href="${ORIGIN}"`), 'the scaffolded page links back to the superapp');
  for (const role of ['arena', 'name', 'create', 'code', 'join', 'start', 'status', 'mute', 'lobby', 'room-info', 'room-code', 'invite',
    'invite-link', 'copy', 'peers', 'host-controls', 'wait', 'game', 'banner', 'scores', 'next', 'hud']) {
    assert.ok(page.includes(`data-engine="${role}"`), `the scaffolded page has no ${role} slot`);
  }
  assert.match(page, /data-engine-stick="mx,my"[\s\S]*data-engine-touch="boost=1"/);
  const css = fs.readFileSync(path.join(made.dir, 'public/style.css'), 'utf8');
  assert.match(css, /:root \{[^}]*--bg:[^}]*--accent:/, 'theme properties sit at the top');
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /@media \(max-width: \d+px\)/);
  assert.doesNotMatch(css, /\{\{|engine-root/);
  assert.match(css, /--stick-x/);
  const client = fs.readFileSync(path.join(made.dir, 'public/client.js'), 'utf8');
  assert.doesNotMatch(client, /touchControls|\{\{/);
  // The scaffold is the guide's example, so it shows each piece an author will want.
  for (const piece of ['ctx.events("took")', 'surface.shake(', 'audioMap:', 'labels:', 'scoreboard(players, scores, snap)', 'onRound()', 'nextKey:', 'palette:', 'ctx.hud(', 'outline:', 'linear:']) {
    assert.ok(client.includes(piece), `the scaffolded client does not show ${piece}`);
  }
  assert.match(byId(await runConformance(made.dir, { static: true })).slots.detail, /1 touch button\(s\), 1 stick\(s\)/);

  const tests = spawnSync('npm', ['test'], { cwd: made.dir, encoding: 'utf8' });
  assert.equal(tests.status, 0, tests.stdout + tests.stderr);

  const statics = await runConformance(made.dir, { static: true });
  assert.deepEqual(failed(statics), []);
  linkModules(made.dir);
  assert.match(byId(statics).slots.detail, /the page owns its chrome/);
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
