// Generates the first-party shared asset set, its manifest and its licence ledger:
//   node scripts/make-assets.mjs          writes public/assets/<ASSET_SET_VERSION>/
//   node scripts/make-assets.mjs --check  fails when the committed set differs
// Every byte is derived from this file and engine/palette.js, so the set is reproducible.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PLAYER_COLOURS } from '../engine/palette.js';
import { ASSET_SET_VERSION } from '../engine/params.js';
import { seededRng } from '../engine/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 11025;
const TAU = Math.PI * 2;

function wav(samples) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples.length * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2));
  return out;
}

// A note is a decaying tone; `to` glides the pitch, `noise` mixes in seeded hiss.
function render(notes, seed = 1) {
  const rng = seededRng(seed);
  const length = Math.ceil(Math.max(...notes.map((n) => n.at + n.len)) * RATE);
  const samples = new Array(length).fill(0);
  for (const { at, len, hz, to = hz, gain = 0.6, noise = 0, square = 0 } of notes) {
    let phase = 0;
    const count = Math.floor(len * RATE);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      phase += (TAU * (hz + (to - hz) * t)) / RATE;
      const tone = Math.sin(phase) * (1 - square) + Math.sign(Math.sin(phase)) * square;
      const attack = Math.min(1, i / (0.004 * RATE));
      const envelope = attack * (1 - t) ** 2;
      samples[Math.floor(at * RATE) + i] += gain * envelope * (tone * (1 - noise) + (rng.next() * 2 - 1) * noise);
    }
  }
  return wav(samples);
}

const SOUNDS = {
  blip: render([{ at: 0, len: 0.07, hz: 880, square: 0.3, gain: 0.5 }]),
  hit: render([{ at: 0, len: 0.28, hz: 220, to: 55, noise: 0.45, gain: 0.8 }], 7),
  score: render([{ at: 0, len: 0.09, hz: 660 }, { at: 0.08, len: 0.16, hz: 990 }]),
  start: render([{ at: 0, len: 0.1, hz: 440 }, { at: 0.1, len: 0.1, hz: 554 }, { at: 0.2, len: 0.18, hz: 659 }]),
  win: render([
    { at: 0, len: 0.11, hz: 523 }, { at: 0.1, len: 0.11, hz: 659 },
    { at: 0.2, len: 0.11, hz: 784 }, { at: 0.3, len: 0.3, hz: 1047 },
  ]),
};

const CELL = 24;
const ICONS = {
  'sound-on': '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a9 9 0 0 1 0 13" fill="none"/>',
  'sound-off': '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2" fill="none"/><path d="M5 16V6a2 2 0 0 1 2-2h8" fill="none"/>',
  crown: '<path d="M3 18l-1-11 6 5 4-7 4 7 6-5-1 11z"/>',
  left: '<path d="M15 4l-8 8 8 8z"/>',
  right: '<path d="M9 4l8 8-8 8z"/>',
  check: '<path d="M4 12l5 5L20 6" fill="none"/>',
  skull: '<path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z"/>',
};
const names = Object.keys(ICONS);
const SPRITES = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * names.length}" height="${CELL}" viewBox="0 0 ${CELL * names.length} ${CELL}"`
  + ' fill="#e8ecf1" stroke="#e8ecf1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n'
  + names.map((name, i) => `  <g id="${name}" transform="translate(${i * CELL} 0)">${ICONS[name]}</g>\n`).join('')
  + '</svg>\n',
);

const FIRST_PARTY = {
  source: 'Generated in this repository by scripts/make-assets.mjs',
  licence: 'First-party work of the repository owner; no third-party material',
  attribution: 'None required',
};

export function build() {
  const files = {
    'palette.json': Buffer.from(`${JSON.stringify({ players: PLAYER_COLOURS }, null, 2)}\n`),
    'ui-sprites.svg': SPRITES,
  };
  const assets = {
    palette: { path: 'palette.json', type: 'json' },
    'ui-sprites': {
      path: 'ui-sprites.svg', type: 'image', mime: 'image/svg+xml', cell: CELL,
      sprites: Object.fromEntries(names.map((name, i) => [name, i])),
    },
  };
  for (const [name, bytes] of Object.entries(SOUNDS)) {
    files[`sounds/${name}.wav`] = bytes;
    assets[name] = { path: `sounds/${name}.wav`, type: 'audio', mime: 'audio/wav' };
  }
  for (const entry of Object.values(assets)) {
    entry.bytes = files[entry.path].length;
    entry.sha256 = createHash('sha256').update(files[entry.path]).digest('hex');
  }
  const ledger = Object.fromEntries(Object.keys(assets).map((name) => [name, FIRST_PARTY]));
  files[`manifest-${ASSET_SET_VERSION}.json`] = Buffer.from(`${JSON.stringify({ version: ASSET_SET_VERSION, assets }, null, 2)}\n`);
  files[`ledger-${ASSET_SET_VERSION}.json`] = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);
  return files;
}

export const assetDir = (root = ROOT) => path.join(root, 'public/assets', ASSET_SET_VERSION);

export function check(root = ROOT) {
  const dir = assetDir(root);
  const files = build();
  const problems = [];
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) problems.push(`${name} is missing`);
    else if (!fs.readFileSync(file).equals(bytes)) problems.push(`${name} differs from the generator's output`);
  }
  const walk = (sub) => fs.readdirSync(path.join(dir, sub), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(sub, e.name)) : [path.join(sub, e.name)]));
  if (fs.existsSync(dir)) for (const name of walk('')) if (!(name in files)) problems.push(`${name} is not produced by the generator`);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = check();
    if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
    else console.log(`asset set ${ASSET_SET_VERSION}: committed files match the generator`);
  } else {
    const files = build();
    for (const [name, bytes] of Object.entries(files)) {
      const file = path.join(assetDir(), name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
    console.log(`asset set ${ASSET_SET_VERSION}: wrote ${Object.keys(files).length} files`);
  }
}
