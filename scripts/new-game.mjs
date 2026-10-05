// Scaffolds a complete minimal engine game that passes its own tests and the
// conformance suite: node scripts/new-game.mjs <slug> --name "<Display name>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `usage: node scripts/new-game.mjs <slug> --name "<Display name>" [options]

  <slug>                 directory and app name: lowercase letters, digits, inner hyphens
  --name <text>          display name shown in the page title and the catalog
  --description <text>   one sentence for the catalog card
  --root <dir>           checkout to scaffold into (default: this repository)
  --help

Writes <root>/<slug>/ with src/server.js, public/{index.html,style.css,client.js,game.js},
test/{game.test.mjs,reference.mjs,bot.mjs,replay.ndjson}, package.json, .gitignore,
app.yaml, game-entry.json and README.md. Then:

  (cd <slug> && npm test)
  node scripts/conformance.mjs <slug>`;

const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error(`template names unknown value ${key}`);
  return values[key];
});

const SERVER = `import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveGame } from "../engine/server.js";

serveGame({ publicDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public") });
`;

// The scaffold's files live beside this script as real files; {{name}} marks what is filled in.
export const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scaffold');
export const TEMPLATES = ['public/index.html', 'public/style.css', 'public/client.js', 'public/game.js',
  'test/reference.mjs', 'test/game.test.mjs', 'test/bot.mjs', 'README.md'];
const template = (rel) => fs.readFileSync(path.join(TEMPLATE_DIR, rel), 'utf8');

// The authored files for one set of values; the engine guide prints the same files as its example.
export function renderTemplates({ slug, name, description, version, origin }) {
  const values = {
    slug, name, description, version, origin, seed: String(seedOf(slug)), pellets: '5', ready: '45',
    nameHtml: escapeHtml(name), descriptionHtml: escapeHtml(description), nameJson: JSON.stringify(name),
  };
  return Object.fromEntries(TEMPLATES.map((rel) => [rel, fill(template(rel), values)]));
}
export const defaultDescription = (name) => `${name}: race to the pellet; a boost gets you there first.`;

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function seedOf(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619) >>> 0;
  return (h % 2000000000) + 1;
}

export async function scaffold({ slug, name, description, root = REPO }) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug || '')) {
    throw new Error(`slug ${JSON.stringify(slug)} must be lowercase letters, digits and inner hyphens`);
  }
  if (!name || !name.trim()) throw new Error('--name "<Display name>" is required');
  const base = path.resolve(root);
  const paramsFile = path.join(base, 'engine/params.js');
  if (!fs.existsSync(paramsFile)) throw new Error(`${base} has no engine/params.js; pass --root <checkout>`);
  const params = fs.readFileSync(paramsFile, 'utf8');
  const version = params.match(/ENGINE_VERSION *= *"([^"]+)"/)?.[1];
  const origin = params.match(/SUPERAPP_ORIGIN *= *"([^"]+)"/)?.[1];
  if (!version || !origin) throw new Error('engine/params.js does not declare ENGINE_VERSION and SUPERAPP_ORIGIN');
  const dir = path.join(base, slug);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);

  const text = description?.trim() || defaultDescription(name.trim());
  const files = {
    'src/server.js': SERVER,
    ...renderTemplates({ slug, name: name.trim(), description: text, version, origin }),
    '.gitignore': 'node_modules/\n.anybuild/\n.shipit/\nengine/\npublic/engine/\n',
    'package.json': `${JSON.stringify({
      name: slug, version: '0.1.0', private: true, description: text, type: 'module',
      engines: { node: '>=22' },
      scripts: { start: 'node src/server.js', test: 'node --test test/*.test.mjs' },
      dependencies: { ws: '^8.20.1' },
    }, null, 2)}\n`,
    'app.yaml': `kind: wasmer.io/App.v0\nname: ${slug}\nowner: wasmer-playground\npackage: .\nlocality:\n  regions:\n  - fr-roub1\n`,
    'game-entry.json': `${JSON.stringify({ slug, name: name.trim(), description: text, players: '2 to 8', source: `${slug}/` }, null, 2)}\n`,
  };
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  // The fixture is recorded from the game just written, so it cannot disagree with it.
  const reference = await import(pathToFileURL(path.join(dir, 'test/reference.mjs')).href);
  fs.writeFileSync(path.join(dir, 'test/replay.ndjson'), reference.playReference());
  return { dir, version, files: [...Object.keys(files), 'test/replay.ndjson'] };
}

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (['--name', '--description', '--root'].includes(arg)) {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      out[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else out.positional.push(arg);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(USAGE); process.exit(0); }
    if (args.positional.length !== 1) { console.error(USAGE); process.exit(2); }
    const made = await scaffold({ slug: args.positional[0], name: args.name, description: args.description, root: args.root });
    console.log(`${args.positional[0]}: wrote ${made.files.length} files on engine ${made.version} at ${made.dir}`);
    console.log(`next: (cd ${made.dir} && npm test) && node scripts/conformance.mjs ${made.dir}`);
  } catch (error) {
    console.error(`new-game: ${error.message}`);
    process.exitCode = 1;
  }
}
