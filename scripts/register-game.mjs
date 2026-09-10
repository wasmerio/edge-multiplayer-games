import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

export function pendingGames(root) {
  const games = read(path.join(root, 'public/games.json'));
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(dir => dir.isDirectory() && fs.existsSync(path.join(root, dir.name, 'game-entry.json')))
    .map(dir => dir.name)
    .filter(slug => !games.find(game => game.slug === slug)?.url);
}

export function registerGame(root, slug, address) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid game slug');
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Expected an HTTPS app origin from Wasmer');
  }
  const catalogPath = path.join(root, 'public/games.json');
  const games = read(catalogPath);
  const matches = games.filter(game => game.slug === slug);
  if (matches.length > 1) throw new Error(`Duplicate catalog entries for ${slug}`);
  const metadataPath = path.join(root, slug, 'game-entry.json');
  const metadata = fs.existsSync(metadataPath) ? read(metadataPath) : matches[0];
  if (!metadata) throw new Error(`${slug}: create game-entry.json before deployment`);
  if (metadata.slug !== slug || metadata.source !== `${slug}/`) throw new Error('Game metadata does not match its directory');
  for (const key of ['name', 'description', 'players']) {
    if (typeof metadata[key] !== 'string' || !metadata[key].trim()) throw new Error(`Missing game ${key}`);
  }
  const entry = { slug, name: metadata.name, url: url.origin, players: metadata.players,
    description: metadata.description, source: metadata.source };
  const index = games.findIndex(game => game.slug === slug);
  if (index < 0) games.push(entry);
  else games[index] = { ...games[index], ...entry };
  const ignorePath = path.join(root, '.wasmerignore');
  const ignore = fs.readFileSync(ignorePath, 'utf8');
  save(catalogPath, games);
  if (!ignore.split(/\r?\n/).includes(`/${slug}/`)) {
    fs.writeFileSync(ignorePath, `${ignore.trimEnd()}\n/${slug}/\n`);
  }
  return entry;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, slug, url] = process.argv.slice(2);
    if (slug === '--pending') {
      for (const game of pendingGames(root)) console.log(game);
    } else {
      const entry = registerGame(root, slug, url);
      console.log(`${entry.slug}: registered ${entry.url} in public/games.json`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
