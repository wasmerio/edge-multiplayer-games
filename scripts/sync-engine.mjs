// Publishes the engine into the superapp's static tree and copies its Node
// half into a game. The browser half is fetched from the published origin; a
// Node process cannot fetch a module before it starts, so the server modules
// travel with the game (see the worklog decision log, D-18).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_SIDE = ['params.js', 'rng.js', 'rooms.js', 'server.js'];

export function engineVersion(root = ROOT) {
  const source = fs.readFileSync(path.join(root, 'engine/params.js'), 'utf8');
  const found = source.match(/ENGINE_VERSION *= *"([^"]+)"/);
  if (!found) throw new Error('engine/params.js does not declare ENGINE_VERSION');
  return found[1];
}

const browserModules = (root) =>
  fs.readdirSync(path.join(root, 'engine'))
    .filter((name) => name.endsWith('.js'))
    .sort();

export function publish(root = ROOT) {
  const version = engineVersion(root);
  const target = path.join(root, 'public/engine', version);
  fs.mkdirSync(target, { recursive: true });
  const copied = [];
  // Written in place: a running dev server may be reading this directory.
  for (const name of browserModules(root)) {
    const source = fs.readFileSync(path.join(root, 'engine', name));
    const published = path.join(target, name);
    if (!fs.existsSync(published) || !fs.readFileSync(published).equals(source)) fs.writeFileSync(published, source);
    copied.push(name);
  }
  for (const name of fs.readdirSync(target)) {
    if (!copied.includes(name)) fs.rmSync(path.join(target, name), { recursive: true, force: true });
  }
  return { version, target, copied };
}

export function verifyPublished(root = ROOT) {
  const version = engineVersion(root);
  const target = path.join(root, 'public/engine', version);
  const problems = [];
  if (!fs.existsSync(target)) return { version, problems: [`public/engine/${version} is missing`] };
  for (const name of browserModules(root)) {
    const published = path.join(target, name);
    if (!fs.existsSync(published)) { problems.push(`${name} is not published`); continue; }
    const a = fs.readFileSync(path.join(root, 'engine', name));
    const b = fs.readFileSync(published);
    if (!a.equals(b)) problems.push(`${name} differs from engine/${name}`);
  }
  for (const name of fs.readdirSync(target)) {
    if (!browserModules(root).includes(name)) problems.push(`${name} is published but no longer in engine/`);
  }
  return { version, problems };
}

export function syncGame(slug, root = ROOT) {
  const target = path.join(root, slug, 'engine');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of SERVER_SIDE) {
    fs.copyFileSync(path.join(root, 'engine', name), path.join(target, name));
  }
  return { target, copied: SERVER_SIDE };
}

export function vendorGame(slug, root = ROOT) {
  const version = engineVersion(root);
  const target = path.join(root, slug, 'public/engine');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of browserModules(root)) {
    fs.copyFileSync(path.join(root, 'engine', name), path.join(target, name));
  }
  const page = path.join(root, slug, 'public/index.html');
  const html = fs.readFileSync(page, 'utf8');
  if (!/"@engine\/": *"[^"]*"/.test(html)) {
    throw new Error(`${slug}: index.html has no @engine import map entry to rewrite`);
  }
  fs.writeFileSync(page, html.replace(/"@engine\/": *"[^"]*"/, '"@engine/": "/engine/"'));
  // A frozen copy is committed and uploaded, so it must stop being ignored.
  const ignore = path.join(root, slug, '.gitignore');
  if (fs.existsSync(ignore)) {
    const kept = fs.readFileSync(ignore, 'utf8').split('\n').filter((line) => line.trim() !== 'public/engine/');
    fs.writeFileSync(ignore, kept.join('\n'));
  }
  return { version, target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, slug] = process.argv.slice(2);
  try {
    if (command === 'publish') {
      const result = publish();
      console.log(`engine ${result.version}: published ${result.copied.length} modules to public/engine/${result.version}`);
    } else if (command === 'verify') {
      const { version, problems } = verifyPublished();
      if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
      else console.log(`engine ${version}: published copy matches engine/`);
    } else if (command === 'game') {
      const result = syncGame(slug);
      console.log(`${slug}: copied ${result.copied.length} server modules`);
    } else if (command === 'vendor') {
      const result = vendorGame(slug);
      console.log(`${slug}: vendored engine ${result.version} and repointed its import map`);
    } else if (command === '--help' || command === '-h') {
      console.log('usage: node scripts/sync-engine.mjs publish | verify | game <slug> | vendor <slug>');
    } else {
      console.error('usage: node scripts/sync-engine.mjs publish | verify | game <slug> | vendor <slug>');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
