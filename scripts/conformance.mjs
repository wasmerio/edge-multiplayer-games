// The sub-app contract as a command. Every row is always reported; any failing
// row makes the exit status non-zero. See engine/README.md, "Conformance".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SEMVER = /^\d+\.\d+\.\d+$/;
const ENGINE_CACHE_MAX_AGE = 31536000;
const ASSET_JSON_MAX_AGE = 3600;
const INDEX_MAX_AGE_CEILING = 300;
const SERVER_MODULES = ['params.js', 'rng.js', 'rooms.js', 'server.js'];
const PROBE_ORIGIN = 'https://conformance-probe.example';

const USAGE = `usage: node scripts/conformance.mjs <game-dir | https://origin> [options]

  <game-dir>        full tier: source rows, then the game's own server on a free
                    port and a headless browser for the contract rows
  <https://origin>  a deployed game, or the superapp origin (header rows)

  --static          source rows only; needs no browser, server or child process
  --json            print one JSON document instead of the table
  --root <dir>      checkout holding engine/ and public/ (default: the game's parent)
  --offline         deny the browser every non-loopback request and fail on an attempt
  --port <n>        port for the game's server (default: a free one)
  --engine-version <v>   version to expect on a superapp origin (default: engine/params.js)
  --help`;

// Removes comments; `code` also blanks string contents so a scan cannot match prose.
export function stripSource(source) {
  let code = '';
  let text = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') { code += '\n'; text += '\n'; }
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      code += c; text += c; i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') { text += source[i] + (source[i + 1] ?? ''); code += '  '; i += 2; continue; }
        text += source[i];
        code += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      code += c; text += c; i += 1;
      continue;
    }
    code += c; text += c; i += 1;
  }
  return { code, text };
}

const specifiersOf = (text) => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\1/g)].map((m) => m[2]);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function walk(dir, skip, out = [], base = dir) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (skip(rel, entry)) continue;
    if (entry.isDirectory()) walk(full, skip, out, base);
    else out.push(rel);
  }
  return out;
}

// Vendored libraries and a vendored engine are not the game's own code.
const gameScripts = (publicDir) => walk(publicDir, (rel, entry) => (
  entry.isDirectory() ? /^(engine|vendor)$/.test(rel) : !/\.m?js$/.test(rel) || /\.min\.m?js$/.test(rel)
));

const LOADING_RELS = /\b(stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch|icon|apple-touch-icon|manifest)\b/i;

// Every url(...) and @import target of a stylesheet, comments removed.
export function cssLoads(css) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/gi)) found.push(m[2]);
  for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) found.push(m[2].trim());
  return [...new Set(found)];
}

// A page may load from its own origin and from the pinned engine and asset paths of the superapp, nothing else.
export function isForeignLoad(url, superappOrigin) {
  const value = String(url).trim();
  if (/^(data|blob|about):/i.test(value) || value.startsWith('#')) return false;
  if (!/^([a-z][a-z0-9+.-]*:)?\/\//i.test(value)) return false;
  return !(value.startsWith(`${superappOrigin}/engine/`) || value.startsWith(`${superappOrigin}/assets/`));
}

const XML_NAMESPACE = /^https?:\/\/www\.w3\.org\//;
// Absolute URLs a script names: an import, a fetch target, an image or a font source.
function scriptLoads(text, superappOrigin) {
  const found = [];
  for (const m of text.matchAll(/(["'`])((?:https?:)?\/\/[^"'`\s]+)\1/g)) {
    if (m[2].startsWith('//') && !/^\/\/[\w-]+(\.[\w-]+)+/.test(m[2])) continue;
    if (XML_NAMESPACE.test(m[2]) || m[2] === superappOrigin || m[2] === `${superappOrigin}/`) continue;
    found.push(m[2]);
  }
  return found;
}

function parsePage(html) {
  const importMap = {};
  let mapError = null;
  const map = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (map) {
    try { Object.assign(importMap, JSON.parse(map[1]).imports || {}); } catch (error) { mapError = error.message; }
  }
  const modules = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => /type=["']module["']/i.test(m[1]))
    .map((m) => ({ src: m[1].match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? null, body: m[2] }));
  const links = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => m[1]);
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const tags = [...markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map((m) => ({ tag: m[1].toLowerCase(), attrs: m[2] }));
  const attr = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
  const roles = tags.map((t) => attr(t.attrs, 'data-engine')).filter((v) => v !== null);
  const touch = tags.map((t) => attr(t.attrs, 'data-engine-touch')).filter((v) => v !== null);
  const sticks = tags.map((t) => attr(t.attrs, 'data-engine-stick')).filter((v) => v !== null);
  // What the browser fetches while it loads the page; a link the player follows is not a load.
  const loads = [];
  for (const t of tags) {
    if (t.tag === 'a' || t.tag === 'base') continue;
    const rel = attr(t.attrs, 'rel') ?? '';
    if (t.tag === 'link' && !LOADING_RELS.test(rel)) continue;
    for (const name of t.tag === 'link' ? ['href'] : ['src', 'poster', 'data']) {
      const value = attr(t.attrs, name);
      if (value) loads.push({ where: `<${t.tag} ${name}>`, url: value });
    }
    for (const part of (attr(t.attrs, 'srcset') ?? '').split(',')) {
      const value = part.trim().split(/\s+/)[0];
      if (value) loads.push({ where: `<${t.tag} srcset>`, url: value });
    }
    for (const found of cssLoads(attr(t.attrs, 'style') ?? '')) loads.push({ where: `<${t.tag} style>`, url: found });
  }
  for (const block of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const found of cssLoads(block[1])) loads.push({ where: '<style>', url: found });
  }
  for (const m of [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b([^>]*)>/gi)]) {
    const value = attr(m[1], 'src');
    if (value) loads.push({ where: '<script src>', url: value });
  }
  const stylesheets = tags.filter((t) => t.tag === 'link' && /\bstylesheet\b/i.test(attr(t.attrs, 'rel') ?? ''))
    .map((t) => attr(t.attrs, 'href')).filter(Boolean);
  const container = tags.some((t) => attr(t.attrs, 'id') === 'game');
  return { importMap, mapError, modules, links, roles, touch, sticks, loads, stylesheets, container, inlineStyle: /<style\b/i.test(markup) };
}

// The roles the kit binds in a page that owns its chrome; see engine/README.md, "Page slots".
export const REQUIRED_SLOTS = ['arena', 'name', 'create', 'code', 'join', 'start'];
export const OPTIONAL_SLOTS = ['copy', 'mute', 'next', 'hud', 'status', 'room-code', 'invite-link', 'peers', 'scores', 'banner',
  'lobby', 'game', 'room-info', 'invite', 'host-controls', 'wait'];

// A page owns its chrome when it has an arena slot; otherwise the kit builds the chrome into #game.
function checkSlots(page, { intent = null, kitBindsSlots = true, kitBindsSticks = true } = {}) {
  const owned = page.roles.includes('arena');
  if (!owned) {
    if (page.roles.length) return { ok: false, detail: `data-engine roles without an arena slot are ignored by the kit: ${[...new Set(page.roles)].join(', ')}` };
    return page.container
      ? { ok: true, detail: 'bare #game container; the kit builds its default chrome' }
      : { ok: false, detail: 'the page has neither a data-engine="arena" slot nor an element with id "game"' };
  }
  const problems = [];
  const missing = REQUIRED_SLOTS.filter((role) => !page.roles.includes(role));
  if (missing.length) problems.push(`missing required slot(s): ${missing.join(', ')}`);
  const unknown = [...new Set(page.roles.filter((role) => !REQUIRED_SLOTS.includes(role) && !OPTIONAL_SLOTS.includes(role)))];
  if (unknown.length) problems.push(`unknown data-engine role(s): ${unknown.join(', ')}`);
  const twice = [...new Set(page.roles.filter((role, i) => page.roles.indexOf(role) !== i))];
  if (twice.length) problems.push(`role(s) used more than once: ${twice.join(', ')}`);
  for (const value of page.touch) {
    const [field, amount, ...rest] = value.split('=');
    if (!field || rest.length || amount === undefined || amount.trim() === '' || !Number.isFinite(Number(amount))) problems.push(`data-engine-touch="${value}" is not <field>=<number>`);
    else if (intent && !(field in intent)) problems.push(`data-engine-touch names unknown intent field ${field}`);
  }
  for (const value of page.sticks) {
    const fields = value.split(',').map((name) => name.trim());
    if (fields.length !== 2 || fields.some((name) => !name)) problems.push(`data-engine-stick="${value}" is not <field>,<field>`);
    else for (const field of fields) if (intent && !(field in intent)) problems.push(`data-engine-stick names unknown intent field ${field}`);
  }
  if (page.sticks.length && !kitBindsSticks) problems.push('the pinned engine predates data-engine-stick; pin a version whose kit binds it');
  if (!kitBindsSlots) problems.push('the pinned engine predates page slots; pin a version whose kit binds data-engine roles');
  if (problems.length) return { ok: false, detail: problems.join('; ') };
  return { ok: true, detail: `the page owns its chrome: ${new Set(page.roles).size} slots, ${page.touch.length} touch button(s)${page.sticks.length ? `, ${page.sticks.length} stick(s)` : ''}` };
}

const isLocalHref = (href) => !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href) && !/^data:/i.test(href);
const FOREIGN_FIX = 'ship the file under public/ (fonts: a system stack, or your own licensed file) and reference it by a local path';
const NO_STYLE = 'the page owns its chrome but brings no stylesheet; the kit injects no theme for it';

// Classifies one place the engine is loaded from.
function classifyEngineUrl(value, superappOrigin) {
  const remote = value.match(/^(https?:\/\/[^/]+)\/engine\/([^/]*)\/?/);
  if (remote) {
    if (remote[1] !== superappOrigin) return { problem: `engine imported from ${remote[1]}, not ${superappOrigin}` };
    if (!SEMVER.test(remote[2])) return { problem: `unpinned engine specifier ${value}` };
    return { version: remote[2], vendored: false };
  }
  if (/^https?:\/\//.test(value)) return { problem: `unpinned engine specifier ${value}` };
  if (/^\/engine\/$/.test(value) || /^\/engine\/[^/]+\.js$/.test(value)) return { vendored: true };
  return { problem: `unpinned engine specifier ${value}` };
}

function pinning({ importMap, mapError, specifiers, superappOrigin, vendoredVersion }) {
  if (mapError) return { ok: false, detail: `import map is not JSON: ${mapError}` };
  const places = [];
  const problems = [];
  if (importMap['@engine/'] !== undefined) places.push(importMap['@engine/']);
  for (const [key, value] of Object.entries(importMap)) {
    if (key !== '@engine/' && /\/engine\//.test(String(value))) places.push(value);
  }
  for (const spec of specifiers) {
    if (spec.startsWith('@engine/')) {
      if (importMap['@engine/'] === undefined) problems.push(`${spec} has no "@engine/" import map entry`);
    } else if (/^https?:\/\/.*\/engine\//.test(spec) || /^\/engine\//.test(spec)) {
      places.push(spec);
    }
  }
  if (places.length === 0 && problems.length === 0) return { ok: false, detail: 'the page does not import the engine' };
  const versions = new Set();
  let vendored = false;
  for (const place of places) {
    const found = classifyEngineUrl(String(place), superappOrigin);
    if (found.problem) problems.push(found.problem);
    else if (found.vendored) {
      vendored = true;
      if (!vendoredVersion) problems.push(`${place} is a local path but public/engine/params.js declares no ENGINE_VERSION`);
      else versions.add(vendoredVersion);
    } else versions.add(found.version);
  }
  if (versions.size > 1) problems.push(`more than one engine version: ${[...versions].join(', ')}`);
  if (problems.length) return { ok: false, detail: problems.join('; ') };
  const version = [...versions][0];
  return { ok: true, version, vendored, detail: vendored ? `vendored copy of ${version}` : `pinned to ${version}` };
}

const FORBIDDEN_LOOPS = [
  [/\brequestAnimationFrame\b/g, 'requestAnimationFrame'],
  [/\bsetInterval\b/g, 'setInterval'],
  [/\bfixedTick\s*\(/g, 'fixedTick'],
];
const FORBIDDEN_NET = [
  [/\bRTCPeerConnection\b/g, 'RTCPeerConnection'],
  [/\bcreateDataChannel\b/g, 'createDataChannel'],
  [/\bnew\s+WebSocket\b/g, 'new WebSocket'],
  [/\bEventSource\b/g, 'EventSource'],
];
const OWN_LOBBY = [
  [/\.(?:get|has)\(\s*["'`](?:room|create)["'`]/g, 'reads the room/create parameter'],
  [/[?&](?:room|create)=/g, 'builds a room/create link'],
];

function scan(files, patterns, pick) {
  const hits = [];
  for (const file of files) {
    for (const [pattern, label] of patterns) {
      const haystack = file[pick];
      for (const match of haystack.matchAll(pattern)) hits.push(`${file.name}:${lineOf(haystack, match.index)} ${label}`);
    }
  }
  return hits;
}

function checkServerSource(source) {
  if (source === null) return { ok: false, detail: 'src/server.js is missing' };
  const { text } = stripSource(source);
  const specs = specifiersOf(text);
  const foreign = specs.filter((s) => !['node:path', 'node:url', '../engine/server.js'].includes(s));
  if (foreign.length) return { ok: false, detail: `src/server.js imports ${foreign.join(', ')}; it may only call the engine` };
  if (!/import\s*\{[^}]*\bserveGame\b[^}]*\}\s*from\s*["']\.\.\/engine\/server\.js["']/.test(text)) {
    return { ok: false, detail: 'src/server.js does not import serveGame from ../engine/server.js' };
  }
  const body = text.replace(/import\s[^;]*;/g, '').trim();
  if (!/^(await\s+)?serveGame\(\s*\{[\s\S]*\}\s*\);?$/.test(body) || /=>|\bfunction\b|\.on\(|\blisten\(|\bcreateServer\b/.test(body)) {
    return { ok: false, detail: 'src/server.js must be exactly one serveGame({ publicDir }) call' };
  }
  return { ok: true, detail: 'src/server.js is the engine call' };
}

function findSimulation(mod) {
  for (const name of ['Simulation', 'Game', 'default']) if (typeof mod[name] === 'function') return { name, Simulation: mod[name] };
  const shaped = Object.entries(mod).filter(([, value]) => typeof value === 'function' && typeof value.prototype?.step === 'function');
  if (shaped.length === 1) return { name: shaped[0][0], Simulation: shaped[0][1] };
  return null;
}

const message = (error) => String(error?.message ?? error).split('\n').slice(0, 3).join(' ').trim();

async function loadEngine(root) {
  const load = (name) => import(pathToFileURL(path.join(root, 'engine', name)).href);
  const [params, schema, sim, replay, render, assets] = await Promise.all(
    ['params.js', 'schema.js', 'sim.js', 'replay.js', 'render2d.js', 'assets.js'].map(load));
  return { params, ...schema, ...sim, ...replay, ...render, ...assets };
}

function resolveRoot(dir, explicit) {
  if (explicit) return path.resolve(explicit);
  const parent = path.dirname(dir);
  return fs.existsSync(path.join(parent, 'engine/params.js')) ? parent : REPO;
}

const readOrNull = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function report() {
  const rows = [];
  const add = (id, title) => { const row = { id, title, status: 'fail', detail: 'not evaluated' }; rows.push(row); return row; };
  const set = (row, ok, detail) => { row.status = ok ? 'pass' : 'fail'; row.detail = String(detail).replace(/\s*\n\s*/g, ' '); return ok; };
  const skip = (row, detail) => { row.status = 'skip'; row.detail = detail; };
  // A row that throws fails alone; the rest are still evaluated.
  const run = async (row, fn) => {
    try { const result = await fn(); if (result) set(row, result.ok, result.detail); }
    catch (error) { set(row, false, message(error)); }
  };
  return { rows, add, set, skip, run };
}

export const TITLES = {
  healthz: 'Health endpoint answers JSON with the permissive origin header',
  create: 'Root with the create parameter reaches a room without interaction',
  join: 'Root with a room parameter auto-joins',
  link: 'A link back to the superapp exists',
  slots: 'The page provides the engine\'s required slots, or a bare container',
  stylesheet: 'Every stylesheet the page links exists',
  origin: 'The page loads nothing from another origin',
  pinned: 'The engine import is pinned to a version',
  published: 'The pinned engine version is reachable at its version path',
  server: 'The game has no server of its own',
  accumulator: 'The game declares no second accumulator',
  netcode: 'The game has no WebRTC, socket or lobby handlers of its own',
  simulation: 'The simulation satisfies the engine shape',
  schema: 'The snapshot schema compiles',
  fixture: 'A committed replay fixture exists and replays',
  budget: 'Snapshot size stays inside its budget',
  readme: 'The README documents input, snapshot and round lifecycle',
  ledger: 'Every shared asset has a ledger row and every row an asset',
};

function auditAssets(engine, root) {
  const version = engine.params.ASSET_SET_VERSION;
  const dir = path.join(root, 'public/assets', version);
  if (!fs.existsSync(dir)) return { ok: false, detail: `asset set ${version} not present at public/assets/${version}` };
  const manifestFile = path.join(dir, `manifest-${version}.json`);
  const ledgerFile = path.join(dir, `ledger-${version}.json`);
  for (const file of [manifestFile, ledgerFile]) {
    if (!fs.existsSync(file)) return { ok: false, detail: `${path.relative(root, file)} not present` };
  }
  return ledgerVerdict(engine, JSON.parse(fs.readFileSync(manifestFile, 'utf8')), JSON.parse(fs.readFileSync(ledgerFile, 'utf8')), version);
}

function ledgerVerdict(engine, manifest, ledger, version) {
  const audit = engine.auditLedger(manifest, ledger);
  const problems = [
    ...audit.missingLedgerRow.map((name) => `asset ${name} has no ledger row`),
    ...audit.orphanLedgerRow.map((name) => `ledger row ${name} has no asset`),
    ...audit.missingLicence.map((name) => `ledger row ${name} has no licence`),
  ];
  if (problems.length) return { ok: false, detail: problems.join('; ') };
  return { ok: true, detail: `asset set ${version}: ${Object.keys(manifest.assets || {}).length} assets, each with a ledger row` };
}

// ---- directory target ------------------------------------------------------

async function checkDirectory(dirArg, options) {
  const dir = path.resolve(dirArg);
  const root = resolveRoot(dir, options.root);
  const tier = options.static ? 'static' : 'full';
  const r = report();
  const row = Object.fromEntries(Object.keys(TITLES).map((id) => [id, r.add(id, TITLES[id])]));
  const result = { target: dir, kind: 'game-directory', tier, root, rows: r.rows };

  let engine = null;
  try { engine = await loadEngine(root); } catch (error) {
    for (const each of r.rows) r.set(each, false, `engine at ${path.join(root, 'engine')} does not load: ${message(error)}`);
    return result;
  }
  const superappOrigin = engine.params.SUPERAPP_ORIGIN;
  const publicDir = path.join(dir, 'public');
  const html = readOrNull(path.join(publicDir, 'index.html'));
  const page = parsePage(html ?? '');
  const files = [
    ...gameScripts(publicDir).map((name) => ({ name: `public/${name}`, ...stripSource(fs.readFileSync(path.join(publicDir, name), 'utf8')) })),
    ...page.modules.filter((m) => m.body.trim()).map((m) => ({ name: 'public/index.html<script>', ...stripSource(m.body) })),
  ];
  const specifiers = files.flatMap((file) => specifiersOf(file.text));
  const vendoredVersion = readOrNull(path.join(publicDir, 'engine/params.js'))?.match(/ENGINE_VERSION *= *"([^"]+)"/)?.[1] ?? null;

  const pin = html === null
    ? { ok: false, detail: 'public/index.html is missing' }
    : pinning({ importMap: page.importMap, mapError: page.mapError, specifiers, superappOrigin, vendoredVersion });
  r.set(row.pinned, pin.ok, pin.detail);

  const engineDir = pin.ok ? (pin.vendored ? path.join(publicDir, 'engine') : path.join(root, 'public/engine', pin.version)) : null;
  const publishedOnDisk = () => {
    if (!pin.ok) return { ok: false, detail: 'no pinned version to look for' };
    const file = path.join(engineDir, 'engine.js');
    if (!fs.existsSync(file)) return { ok: false, detail: `engine ${pin.version} is not published: ${path.relative(pin.vendored ? dir : root, file)} is missing` };
    return { ok: true, detail: `engine ${pin.version} found at ${path.relative(pin.vendored ? dir : root, engineDir)}` };
  };
  await r.run(row.published, publishedOnDisk);

  const serverCheck = checkServerSource(readOrNull(path.join(dir, 'src/server.js')));
  r.set(row.server, serverCheck.ok, serverCheck.detail);

  const loops = scan(files, FORBIDDEN_LOOPS, 'code');
  r.set(row.accumulator, loops.length === 0, loops.length ? loops.join('; ') : `${files.length} script(s) scanned, the engine owns the only loop`);
  const lobby = scan(files, OWN_LOBBY, 'text');
  const net = [...scan(files, FORBIDDEN_NET, 'code'), ...lobby];
  r.set(row.netcode, net.length === 0, net.length ? net.join('; ') : `${files.length} script(s) scanned`);

  // The kit performs the contract, so a page that hands itself to the kit inherits it.
  const delegates = () => {
    const entries = page.modules.map((m) => m.src).filter(Boolean).map((src) => `public/${src.replace(/^\//, '')}`);
    const candidates = files.filter((file) => entries.includes(file.name) || file.name === 'public/index.html<script>');
    const caller = candidates.find((file) => /\bstartGame\s*\(/.test(file.code)
      && /import\s*\{[^}]*\bstartGame\b[^}]*\}\s*from\s*["'](@engine\/|https?:\/\/[^"']*\/engine\/|\/engine\/)[^"']*["']/.test(file.text));
    if (!caller) return { ok: false, detail: 'no module loaded by the page calls startGame imported from the engine' };
    if (!pin.ok) return { ok: false, detail: 'the engine import is not pinned' };
    if (lobby.length) return { ok: false, detail: `own lobby handling: ${lobby.join('; ')}` };
    return { ok: true, detail: `${caller.name} hands the page to startGame from engine ${pin.version}` };
  };
  const kitHasLink = () => {
    const ui = engineDir && readOrNull(path.join(engineDir, 'ui.js'));
    return Boolean(ui && /href:\s*SUPERAPP_ORIGIN/.test(ui));
  };
  const staticLink = () => {
    if (page.links.some((href) => href.startsWith(superappOrigin))) return { ok: true, detail: 'index.html links to the superapp' };
    if (page.roles.includes('arena')) return { ok: false, detail: `the page owns its chrome and has no link to ${superappOrigin}; the kit adds none` };
    const handed = delegates();
    if (handed.ok && kitHasLink()) return { ok: true, detail: 'the kit header carries the link and the page delegates to the kit' };
    return { ok: false, detail: `no link to ${superappOrigin} in index.html, and ${handed.ok ? 'the pinned kit has none' : handed.detail}` };
  };

  let mod = null;
  let found = null;
  let schema = null;
  let build = null;
  await r.run(row.simulation, async () => {
    const file = path.join(publicDir, 'game.js');
    if (!fs.existsSync(file)) return { ok: false, detail: 'public/game.js is missing' };
    mod = await import(pathToFileURL(file).href);
    found = findSimulation(mod);
    if (!found) return { ok: false, detail: 'public/game.js exports no simulation class (export it as Simulation or Game)' };
    const arena = typeof mod.ARENA === 'function' ? mod.ARENA : mod.ARENA ? () => mod.ARENA : engine.arenaFor;
    build = (players, rng) => new found.Simulation(players, { arena: arena(players) }, rng);
    engine.validateSimulation(found.Simulation, { arena: arena(2) });
    const { code } = stripSource(fs.readFileSync(file, 'utf8'));
    const impure = [...code.matchAll(/\bMath\.random\b|\bDate\.now\b|\bsetTimeout\b|\bdocument\b|\bwindow\b/g)].map((m) => `game.js:${lineOf(code, m.index)} ${m[0]}`);
    if (impure.length) return { ok: false, detail: `the simulation must be headless and use the injected rng: ${impure.join('; ')}` };
    return { ok: true, detail: `export ${found.name} validated` };
  });

  await r.run(row.schema, async () => {
    if (!mod) return { ok: false, detail: 'public/game.js did not load' };
    if (!mod.SNAPSHOT) return { ok: false, detail: 'public/game.js does not export SNAPSHOT' };
    if (!mod.INTENT || typeof mod.INTENT !== 'object' || Object.keys(mod.INTENT).length === 0) {
      return { ok: false, detail: 'public/game.js does not export a non-empty INTENT' };
    }
    schema = engine.defineSnapshot(mod.SNAPSHOT);
    const cap = engine.params.MAX_PLAYERS_PER_ROOM;
    return { ok: true, detail: `schema ${schema.hash}, ${schema.byteLength(cap)} B full at ${cap} players` };
  });

  const fixtureFile = path.join(dir, 'test/replay.ndjson');
  const fixture = readOrNull(fixtureFile);
  await r.run(row.fixture, async () => {
    if (fixture === null) return { ok: false, detail: 'test/replay.ndjson is missing' };
    if (!build) return { ok: false, detail: 'no simulation to replay it with' };
    const reached = engine.replay(fixture, (players, _opts, rng) => build(players, rng));
    return { ok: true, detail: `replays to round ${reached.round}, tick ${reached.tick}, scores ${reached.scores.join('/')}` };
  });

  await r.run(row.budget, async () => {
    if (fixture === null) return { ok: false, detail: 'test/replay.ndjson is missing' };
    if (!build || !schema) return { ok: false, detail: 'needs a simulation and a schema' };
    const { header, events } = engine.parseFixture(fixture);
    const { seededRng } = await import(pathToFileURL(path.join(root, 'engine/rng.js')).href);
    const sim = build(header.players, seededRng(header.seed));
    const budget = engine.params.SNAPSHOT_BUDGET_BYTES * header.players;
    let max = 0;
    let ticks = 0;
    let deltaTotal = 0;
    let previous = null;
    for (const event of events) {
      if (event.e === 'r') { sim.startRound(); previous = null; continue; }
      const snapshot = sim.step(Object.freeze([...event.i]));
      const full = schema.encode(snapshot, header.players);
      max = Math.max(max, full.byteLength);
      deltaTotal += schema.delta(previous, snapshot, header.players).buffer.byteLength;
      previous = schema.decode(full, header.players);
      ticks += 1;
    }
    if (ticks === 0) return { ok: false, detail: 'the fixture holds no ticks' };
    const detail = `largest snapshot ${max} B of ${budget} B for ${header.players} players over ${ticks} ticks, mean delta ${(deltaTotal / ticks).toFixed(1)} B`;
    return { ok: max <= budget, detail };
  });

  await r.run(row.readme, () => {
    const readme = readOrNull(path.join(dir, 'README.md'));
    if (readme === null) return { ok: false, detail: 'README.md is missing' };
    const headings = readme.split('\n').filter((line) => /^#{1,6}\s/.test(line)).join('\n');
    const missing = [['input', /\binput\b/i], ['snapshot', /\bsnapshot\b/i], ['round lifecycle', /\bround lifecycle\b/i]]
      .filter(([, pattern]) => !pattern.test(headings)).map(([name]) => name);
    return missing.length
      ? { ok: false, detail: `README.md has no heading for: ${missing.join(', ')}` }
      : { ok: true, detail: 'headings present' };
  });

  await r.run(row.ledger, () => auditAssets(engine, root));

  await r.run(row.slots, () => {
    if (html === null) return { ok: false, detail: 'public/index.html is missing' };
    const ui = engineDir && readOrNull(path.join(engineDir, 'ui.js'));
    return checkSlots(page, { intent: mod?.INTENT ?? null, kitBindsSlots: !ui || /data-engine/.test(ui), kitBindsSticks: !ui || /data-engine-stick/.test(ui) });
  });
  // The soak run denies every other origin, and so does a player's blocker or a train tunnel.
  await r.run(row.origin, () => {
    if (html === null) return { ok: false, detail: 'public/index.html is missing' };
    const foreign = page.loads.filter((load) => isForeignLoad(load.url, superappOrigin)).map((load) => `index.html ${load.where} ${load.url}`);
    for (const [key, value] of Object.entries(page.importMap)) {
      if (key !== '@engine/' && isForeignLoad(String(value), superappOrigin)) foreign.push(`index.html import map "${key}" ${value}`);
    }
    const sheets = walk(publicDir, (rel, entry) => (entry.isDirectory() ? /^(engine|vendor)$/.test(rel) : !/\.css$/.test(rel)));
    for (const name of sheets) {
      for (const url of cssLoads(fs.readFileSync(path.join(publicDir, name), 'utf8'))) {
        if (isForeignLoad(url, superappOrigin)) foreign.push(`public/${name} ${url}`);
      }
    }
    for (const file of files) {
      for (const url of scriptLoads(file.text, superappOrigin)) {
        if (isForeignLoad(url, superappOrigin)) foreign.push(`${file.name} ${url}`);
      }
    }
    if (foreign.length) return { ok: false, detail: `${foreign.join('; ')}: ${FOREIGN_FIX}` };
    return { ok: true, detail: `index.html, ${sheets.length} stylesheet(s) and ${files.length} script(s) name no other origin` };
  });
  await r.run(row.stylesheet, () => {
    if (html === null) return { ok: false, detail: 'public/index.html is missing' };
    const local = page.stylesheets.filter(isLocalHref).map((href) => href.split(/[?#]/)[0]);
    const absent = local.filter((href) => {
      const file = path.join(publicDir, href);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() === '';
    });
    if (absent.length) return { ok: false, detail: `linked but missing or empty: ${absent.map((href) => `public/${href.replace(/^\//, '')}`).join(', ')}` };
    if (page.roles.includes('arena') && !page.stylesheets.length && !page.inlineStyle) return { ok: false, detail: NO_STYLE };
    return { ok: true, detail: page.stylesheets.length ? `${page.stylesheets.join(', ')} present` : page.inlineStyle ? 'inline style' : 'no stylesheet linked; the kit styles its default chrome' };
  });

  if (options.static) {
    await r.run(row.healthz, () => {
      const served = readOrNull(path.join(root, 'engine/server.js')) ?? '';
      if (!serverCheck.ok) return { ok: false, detail: `source proof failed: ${serverCheck.detail}` };
      if (!/["']\/healthz["']/.test(served) || !/["']Access-Control-Allow-Origin["']:\s*["']\*["']/.test(served)) {
        return { ok: false, detail: 'engine/server.js has no /healthz with the permissive origin header' };
      }
      return { ok: true, detail: 'source proof: src/server.js is the engine call and the engine serves /healthz' };
    });
    const handed = delegates();
    const mute = handed.ok && page.roles.includes('arena') && !page.roles.includes('invite-link');
    if (mute) r.set(row.create, false, 'source proof failed: the page owns its chrome but has no invite-link slot, so the invite is never shown');
    else r.set(row.create, handed.ok, `source proof: ${handed.detail}`);
    r.set(row.join, handed.ok, `source proof: ${handed.detail}`);
    await r.run(row.link, staticLink);
    return result;
  }

  const live = await import('./lib/live.mjs');
  const server = await live.startGameServer({ dir, root, vendored: pin.ok && pin.vendored, port: options.port, modules: SERVER_MODULES });
  try {
    if (!server.ok) {
      for (const id of ['healthz', 'create', 'join']) r.set(row[id], false, server.detail);
      await r.run(row.link, staticLink);
      return result;
    }
    const origin = server.origin;
    await r.run(row.healthz, () => checkHealth(origin));
    if (pin.ok && row.published.status === 'pass') {
      await r.run(row.published, async () => {
        const url = `${origin}/engine/${pin.vendored ? '' : `${pin.version}/`}engine.js`;
        const reached = await reachable(url);
        return reached.ok ? { ok: true, detail: `engine ${pin.version} served at ${new URL(url).pathname}` }
          : { ok: false, detail: `engine ${pin.version} is unreachable: ${reached.detail}` };
      });
    }
    await browserRows({ live, origin, row, r, superappOrigin, offline: options.offline, staticLink, healthOrigin: origin });
  } finally {
    await server.stop();
  }
  return result;
}

// ---- HTTP helpers ----------------------------------------------------------

async function reachable(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    await res.arrayBuffer();
    if (res.status !== 200) return { ok: false, detail: `${url} answered ${res.status}`, res };
    return { ok: true, res, detail: `${url} answered 200` };
  } catch (error) {
    return { ok: false, detail: `${url} is unreachable (${message(error.cause ?? error)})` };
  }
}

async function checkHealth(origin) {
  let res;
  try { res = await fetch(`${origin}/healthz`); } catch (error) { return { ok: false, detail: `/healthz is unreachable (${message(error.cause ?? error)})` }; }
  const body = await res.text();
  if (res.status !== 200) return { ok: false, detail: `/healthz answered ${res.status}` };
  let json;
  try { json = JSON.parse(body); } catch { return { ok: false, detail: '/healthz did not answer JSON' }; }
  if (json.ok !== true || !Number.isFinite(json.rooms) || !Number.isFinite(json.players)) {
    return { ok: false, detail: `/healthz JSON lacks ok, rooms or players: ${body.slice(0, 120)}` };
  }
  const allow = res.headers.get('access-control-allow-origin');
  if (allow !== '*') return { ok: false, detail: `/healthz has access-control-allow-origin ${JSON.stringify(allow)}, expected "*"` };
  return { ok: true, detail: `ok, rooms ${json.rooms}, players ${json.players}${json.engine ? `, engine ${json.engine}` : ''}` };
}

const isLoopback = (url) => /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(url) || /^(data|blob|about|chrome):/.test(url);

const pageErrors = (page) => page.errors.filter((text) => !/favicon/.test(text)).slice(0, 2).map((text) => text.split('\n')[0]).join(' | ');

// Waits for the page to show something, but gives up early once it has thrown.
async function settle(page, probe, args = [], limitMs = 15000) {
  const deadline = Date.now() + limitMs;
  let erroredAt = null;
  while (Date.now() < deadline) {
    try { return await page.waitFor(probe, { args, timeout: 500 }); } catch { /* keep waiting */ }
    if (pageErrors(page)) { erroredAt ??= Date.now(); if (Date.now() - erroredAt > 1500) return null; }
  }
  return null;
}

async function browserRows({ live, origin, row, r, superappOrigin, offline, staticLink, healthOrigin }) {
  let browser;
  try { browser = await live.launch({ offline }); } catch (error) {
    for (const id of ['create', 'join']) r.set(row[id], false, message(error));
    if (staticLink) await r.run(row.link, staticLink); else r.set(row.link, false, message(error));
    return;
  }
  try {
    let invite = null;
    let host = null;
    await r.run(row.create, async () => {
      host = await browser.newPage(`${origin}/?create=1`);
      // The invite is the invite-link slot, in the page's markup or the kit's; any visible room link also counts.
      const panel = () => {
        const visible = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
        const room = /https?:\/\/\S*[?&]room=[A-Za-z0-9]+/;
        const shown = (node) => [node.href, node.value, node.textContent].map((text) => (room.exec(String(text ?? '').trim()) || [])[0]).find(Boolean);
        // The link itself first: a panel's text runs the code into its neighbours.
        const pick = (selector) => [...document.querySelectorAll(selector)].filter(visible);
        return [...pick('[data-engine="invite-link"]'), ...pick('a[href]'), ...pick('[data-engine="invite"]')].map(shown).find(Boolean) ?? null;
      };
      invite = await settle(host, panel);
      if (!invite) return { ok: false, detail: `no invite panel with a room link appeared${pageErrors(host) ? `: ${pageErrors(host)}` : ''}` };
      const outside = host.requests.filter((url) => !isLoopback(url));
      if (offline && outside.length) return { ok: false, detail: `the page requested ${outside[0]} while offline` };
      return { ok: true, detail: `invite panel shows ${invite} with no interaction` };
    });

    await r.run(row.link, async () => {
      const found = host && await host.evaluate((prefix) => [...document.querySelectorAll('a[href]')].some((a) => a.href.startsWith(prefix)), superappOrigin).catch(() => false);
      if (found) return { ok: true, detail: `the rendered page links to ${superappOrigin}` };
      return staticLink ? staticLink() : { ok: false, detail: `the rendered page has no link to ${superappOrigin}` };
    });

    await r.run(row.join, async () => {
      if (!invite) return { ok: false, detail: 'no room to join: the create row produced no invite link' };
      const code = new URL(invite).searchParams.get('room');
      const guest = await browser.newPage(`${origin}/?room=${code}`);
      const landed = await settle(guest, (room) => [...document.querySelectorAll('body *')].some((node) => (
        node.children.length === 0 && node.textContent.trim() === room && node.getClientRects().length > 0
      )), [code]);
      if (!landed) return { ok: false, detail: `a second context did not land in room ${code}${pageErrors(guest) ? `: ${pageErrors(guest)}` : ''}` };
      const outside = guest.requests.filter((url) => !isLoopback(url));
      if (offline && outside.length) return { ok: false, detail: `the page requested ${outside[0]} while offline` };
      if (healthOrigin) {
        const health = await fetch(`${healthOrigin}/healthz`).then((res) => res.json()).catch(() => null);
        if (health && health.players < 2) return { ok: false, detail: `the guest shows room ${code} but the server counts ${health.players} player(s)` };
      }
      return { ok: true, detail: `a second context auto-joined room ${code}` };
    });
  } finally {
    await browser.close();
  }
}

// ---- origin targets --------------------------------------------------------

async function checkOrigin(target, options) {
  const origin = new URL(target).origin;
  const root = options.root ? path.resolve(options.root) : REPO;
  const engine = await loadEngine(root);
  const health = await checkHealth(origin);
  if (!health.ok) {
    const catalog = await reachable(`${origin}/games.json`);
    if (catalog.ok) return checkSuperapp(origin, options, engine);
  }
  return checkGameOrigin(origin, options, engine, health);
}

async function checkGameOrigin(origin, options, engine, health) {
  const r = report();
  const row = Object.fromEntries(Object.keys(TITLES).map((id) => [id, r.add(id, TITLES[id])]));
  const result = { target: origin, kind: 'game-origin', tier: 'full', rows: r.rows };
  const superappOrigin = engine.params.SUPERAPP_ORIGIN;
  r.set(row.healthz, health.ok, health.detail);
  for (const id of ['server', 'accumulator', 'netcode', 'simulation', 'schema', 'fixture', 'budget', 'readme', 'ledger']) {
    r.skip(row[id], 'needs a directory target');
  }

  let pin = { ok: false, detail: 'index.html is unreachable' };
  let page = parsePage('');
  let html = null;
  await r.run(row.pinned, async () => {
    const index = await reachable(`${origin}/`);
    if (!index.ok) return { ok: false, detail: index.detail };
    html = await (await fetch(`${origin}/`)).text();
    page = parsePage(html);
    const specifiers = [];
    for (const module of page.modules) {
      const body = module.src ? await (await fetch(new URL(module.src, `${origin}/`))).text() : module.body;
      specifiers.push(...specifiersOf(stripSource(body).text));
    }
    let vendoredVersion = null;
    const local = await reachable(`${origin}/engine/params.js`);
    if (local.ok) vendoredVersion = (await (await fetch(`${origin}/engine/params.js`)).text()).match(/ENGINE_VERSION *= *"([^"]+)"/)?.[1] ?? null;
    pin = pinning({ importMap: page.importMap, mapError: page.mapError, specifiers, superappOrigin, vendoredVersion });
    return pin;
  });
  await r.run(row.published, async () => {
    if (!pin.ok) return { ok: false, detail: 'no pinned version to look for' };
    const url = pin.vendored ? `${origin}/engine/engine.js` : `${superappOrigin}/engine/${pin.version}/engine.js`;
    const reached = await reachable(url, { origin });
    if (!reached.ok) return { ok: false, detail: `engine ${pin.version} is unreachable: ${reached.detail}` };
    const allow = reached.res.headers.get('access-control-allow-origin');
    if (!pin.vendored && allow !== '*' && allow !== origin) return { ok: false, detail: `engine ${pin.version} is not readable from ${origin}: access-control-allow-origin ${JSON.stringify(allow)}` };
    return { ok: true, detail: `engine ${pin.version} answered 200 at ${url}` };
  });

  await r.run(row.slots, () => (html === null ? { ok: false, detail: 'index.html is unreachable' } : checkSlots(page)));
  await r.run(row.stylesheet, async () => {
    if (html === null) return { ok: false, detail: 'index.html is unreachable' };
    const absent = [];
    for (const href of page.stylesheets) {
      const reached = await reachable(new URL(href, `${origin}/`).href);
      if (!reached.ok) absent.push(reached.detail);
    }
    if (absent.length) return { ok: false, detail: absent.join('; ') };
    if (page.roles.includes('arena') && !page.stylesheets.length && !page.inlineStyle) return { ok: false, detail: NO_STYLE };
    return { ok: true, detail: page.stylesheets.length ? `${page.stylesheets.join(', ')} answered 200` : 'no stylesheet linked' };
  });

  await r.run(row.origin, async () => {
    if (html === null) return { ok: false, detail: 'index.html is unreachable' };
    const foreign = page.loads.filter((load) => isForeignLoad(load.url, superappOrigin)).map((load) => `index.html ${load.where} ${load.url}`);
    for (const href of page.stylesheets.filter(isLocalHref)) {
      const sheet = await fetch(new URL(href, `${origin}/`)).then((res) => (res.ok ? res.text() : '')).catch(() => '');
      for (const url of cssLoads(sheet)) if (isForeignLoad(url, superappOrigin)) foreign.push(`${href} ${url}`);
    }
    if (foreign.length) return { ok: false, detail: `${foreign.join('; ')}: ${FOREIGN_FIX}` };
    return { ok: true, detail: 'index.html and its stylesheets name no other origin' };
  });

  const live = await import('./lib/live.mjs');
  const staticLink = () => (page.links.some((href) => href.startsWith(superappOrigin))
    ? { ok: true, detail: 'index.html links to the superapp' }
    : { ok: false, detail: `no link to ${superappOrigin} in the static or the rendered page` });
  await browserRows({ live, origin, row, r, superappOrigin, offline: options.offline, staticLink, healthOrigin: null });
  return result;
}

const SUPERAPP_TITLES = {
  'engine-reachable': 'The engine is reachable under its version path',
  'engine-cache': 'Engine responses carry the recorded cache lifetime',
  cors: 'Cross-origin reads succeed from a game origin',
  'cors-vary': 'A reflected origin is paired with vary: origin (D-12)',
  'index-lifetime': 'The index and the catalog do not inherit a long lifetime (D-13)',
  assets: 'The asset manifest is reachable under its versioned name',
  ledger: TITLES.ledger,
};

const maxAge = (res) => {
  const value = res.headers.get('cache-control') || '';
  if (/no-cache|no-store/.test(value)) return 0;
  const found = value.match(/max-age=(\d+)/);
  return found ? Number(found[1]) : null;
};

async function checkSuperapp(origin, options, engine) {
  const r = report();
  const row = Object.fromEntries(Object.keys(SUPERAPP_TITLES).map((id) => [id, r.add(id, SUPERAPP_TITLES[id])]));
  const result = { target: origin, kind: 'superapp-origin', tier: 'full', rows: r.rows };
  const version = options.engineVersion || engine.params.ENGINE_VERSION;
  const assetVersion = engine.params.ASSET_SET_VERSION;
  const engineUrl = `${origin}/engine/${version}/engine.js`;
  const manifestUrl = `${origin}/assets/${assetVersion}/manifest-${assetVersion}.json`;
  const probe = { origin: PROBE_ORIGIN };

  const engineRes = await reachable(engineUrl, probe);
  const manifestRes = await reachable(manifestUrl, probe);
  r.set(row['engine-reachable'], engineRes.ok && /javascript/.test(engineRes.res.headers.get('content-type') || ''),
    engineRes.ok ? `engine ${version} answered 200 as ${engineRes.res.headers.get('content-type')}` : `engine ${version} is unreachable: ${engineRes.detail}`);

  await r.run(row['engine-cache'], () => {
    if (!engineRes.ok) return { ok: false, detail: `engine ${version} is unreachable` };
    const age = maxAge(engineRes.res);
    return { ok: age === ENGINE_CACHE_MAX_AGE, detail: `cache-control: ${engineRes.res.headers.get('cache-control')} (expected max-age=${ENGINE_CACHE_MAX_AGE})` };
  });

  const shared = [['engine', engineRes], ['asset manifest', manifestRes]].filter(([, each]) => each.ok);
  await r.run(row.cors, () => {
    if (!engineRes.ok) return { ok: false, detail: `engine ${version} is unreachable` };
    const refused = shared.filter(([, each]) => !['*', PROBE_ORIGIN].includes(each.res.headers.get('access-control-allow-origin')));
    return refused.length
      ? { ok: false, detail: refused.map(([name, each]) => `${name}: access-control-allow-origin ${JSON.stringify(each.res.headers.get('access-control-allow-origin'))}`).join('; ') }
      : { ok: true, detail: shared.map(([name, each]) => `${name}: ${each.res.headers.get('access-control-allow-origin')}`).join('; ') };
  });
  await r.run(row['cors-vary'], () => {
    if (!engineRes.ok) return { ok: false, detail: `engine ${version} is unreachable` };
    const unsafe = shared.filter(([, each]) => each.res.headers.get('access-control-allow-origin') !== '*'
      && !/(^|,)\s*origin\s*(,|$)/i.test(each.res.headers.get('vary') || ''));
    return unsafe.length
      ? { ok: false, detail: unsafe.map(([name, each]) => `${name}: origin reflected with vary: ${each.res.headers.get('vary') ?? '(none)'}`).join('; ') }
      : { ok: true, detail: shared.map(([name, each]) => `${name}: allow ${each.res.headers.get('access-control-allow-origin')}, vary ${each.res.headers.get('vary') ?? '(none)'}`).join('; ') };
  });

  await r.run(row['index-lifetime'], async () => {
    const problems = [];
    const seen = [];
    for (const pathname of ['/', '/games.json']) {
      const res = await reachable(origin + pathname);
      if (!res.ok) { problems.push(res.detail); continue; }
      const age = maxAge(res.res);
      seen.push(`${pathname}: ${res.res.headers.get('cache-control') ?? '(none)'}`);
      if (age !== null && age > INDEX_MAX_AGE_CEILING) problems.push(`${pathname} is cached for ${age} s (ceiling ${INDEX_MAX_AGE_CEILING} s)`);
    }
    return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: seen.join('; ') };
  });

  await r.run(row.assets, () => {
    if (!manifestRes.ok) return { ok: false, detail: `asset set ${assetVersion} not present: ${manifestRes.detail}` };
    const age = maxAge(manifestRes.res);
    return { ok: age === ASSET_JSON_MAX_AGE, detail: `cache-control: ${manifestRes.res.headers.get('cache-control')} (expected max-age=${ASSET_JSON_MAX_AGE})` };
  });
  await r.run(row.ledger, async () => {
    if (!manifestRes.ok) return { ok: false, detail: `asset set ${assetVersion} not present` };
    const ledgerUrl = `${origin}/assets/${assetVersion}/ledger-${assetVersion}.json`;
    const ledger = await fetch(ledgerUrl);
    if (ledger.status !== 200) return { ok: false, detail: `${ledgerUrl} not present (${ledger.status})` };
    return ledgerVerdict(engine, await (await fetch(manifestUrl)).json(), await ledger.json(), assetVersion);
  });
  return result;
}

// ---- command ---------------------------------------------------------------

export async function runConformance(target, options = {}) {
  const result = /^https?:\/\//.test(target) ? await checkOrigin(target, options) : await checkDirectory(target, options);
  result.ok = result.rows.every((row) => row.status !== 'fail');
  return result;
}

export function formatReport(result) {
  const width = Math.max(...result.rows.map((row) => row.id.length));
  const lines = result.rows.map((row) => `${row.status.toUpperCase().padEnd(4)}  ${row.id.padEnd(width)}  ${row.title}\n      ${' '.repeat(width)}  ${row.detail}`);
  const failed = result.rows.filter((row) => row.status === 'fail').map((row) => row.id);
  const verdict = result.ok ? `conformance: PASS (${result.rows.length} rows)` : `conformance: FAIL (${failed.join(', ')})`;
  return [`${result.kind} ${result.target} (${result.tier} tier)`, ...lines, verdict].join('\n');
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--static') options.static = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--offline') options.offline = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--engine-version') options.engineVersion = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  return { options, target: positional[0] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n${USAGE}`); process.exit(2); }
  if (parsed.options.help) { console.log(USAGE); process.exit(0); }
  if (!parsed.target) { console.error(USAGE); process.exit(2); }
  if (!/^https?:\/\//.test(parsed.target) && !fs.existsSync(parsed.target)) {
    console.error(`conformance: ${parsed.target} is neither a directory nor an origin`);
    process.exit(2);
  }
  try {
    const result = await runConformance(parsed.target, parsed.options);
    console.log(parsed.options.json ? JSON.stringify(result, null, 2) : formatReport(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`conformance: ${message(error)}`);
    process.exitCode = 2;
  }
}
