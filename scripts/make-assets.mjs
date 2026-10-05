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

// A note is a decaying tone; `to` glides the pitch, `noise` mixes in seeded hiss,
// `lp` low-passes it, `attack` is the rise in seconds and `decay` the fall's exponent.
function render(notes, seed = 1) {
  const rng = seededRng(seed);
  const length = Math.ceil(Math.max(...notes.map((n) => n.at + n.len)) * RATE);
  const samples = new Array(length).fill(0);
  for (const { at, len, hz, to = hz, gain = 0.6, noise = 0, square = 0, lp = 0, attack = 0.004, decay = 2 } of notes) {
    let phase = 0;
    let held = 0;
    const count = Math.floor(len * RATE);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      phase += (TAU * (hz + (to - hz) * t)) / RATE;
      const tone = Math.sin(phase) * (1 - square) + Math.sign(Math.sin(phase)) * square;
      const rise = Math.min(1, i / (attack * RATE));
      const envelope = rise * (1 - t) ** decay;
      let value = tone * (1 - noise) + (rng.next() * 2 - 1) * noise;
      if (lp) { held += lp * (value - held); value = held; }
      samples[Math.floor(at * RATE) + i] += gain * envelope * value;
    }
  }
  return wav(samples);
}

// One line per sound: engine/README.md lists the same names with the same descriptions.
export const SOUND_NOTES = {
  blip: 'short high square blip: a tap, a step, a menu move',
  hit: 'noisy falling thump: a collision, a death, damage',
  score: 'two rising notes: a point scored',
  start: 'three rising notes: a round or a bomb starts',
  win: 'four-note rising arpeggio: a match won',
  boom: 'deep explosion with a noisy tail',
  tick: 'dry clock tick: a fuse, a timer',
  whoosh: 'airy swell: a dash, a swing, a fast pass',
  pickup: 'bright rising chirp: a coin, a pellet, an item',
  bounce: 'rubbery upward boing: a wall or a paddle',
  buzz: 'low flat buzzer: refused, wrong, out of ammo',
  beep: 'plain countdown beep: three, two, one',
  go: 'longer high beep that ends a countdown',
  fanfare: 'six-note flourish: a big win',
  pop: 'small bubbly pop: a spawn, a burst, a tag',
  powerup: 'rising sweep of five notes: a buff begins',
  zap: 'fast falling laser: a shot, a spark',
  thud: 'soft low knock: a landing, a block placed',
  lose: 'three falling notes: a round lost',
  click: 'tiny noise click: a UI press, a ratchet',
};

const SOUNDS = {
  blip: render([{ at: 0, len: 0.07, hz: 880, square: 0.3, gain: 0.5 }]),
  hit: render([{ at: 0, len: 0.28, hz: 220, to: 55, noise: 0.45, gain: 0.8 }], 7),
  score: render([{ at: 0, len: 0.09, hz: 660 }, { at: 0.08, len: 0.16, hz: 990 }]),
  start: render([{ at: 0, len: 0.1, hz: 440 }, { at: 0.1, len: 0.1, hz: 554 }, { at: 0.2, len: 0.18, hz: 659 }]),
  win: render([
    { at: 0, len: 0.11, hz: 523 }, { at: 0.1, len: 0.11, hz: 659 },
    { at: 0.2, len: 0.11, hz: 784 }, { at: 0.3, len: 0.3, hz: 1047 },
  ]),
  boom: render([
    { at: 0, len: 0.05, hz: 900, to: 200, noise: 0.9, gain: 0.35, decay: 1 },
    { at: 0, len: 0.75, hz: 120, to: 32, gain: 0.55, decay: 2.5 },
    { at: 0.01, len: 0.8, hz: 60, noise: 1, lp: 0.12, gain: 0.8, decay: 2 },
  ], 11),
  tick: render([{ at: 0, len: 0.012, hz: 3000, noise: 0.8, gain: 0.5, decay: 1 }, { at: 0, len: 0.04, hz: 1500, square: 0.4, gain: 0.4 }], 3),
  whoosh: render([{ at: 0, len: 0.32, hz: 200, noise: 1, lp: 0.22, gain: 2.6, attack: 0.12, decay: 1.5 }], 5),
  pickup: render([{ at: 0, len: 0.06, hz: 988 }, { at: 0.05, len: 0.14, hz: 1319, to: 1480 }]),
  bounce: render([{ at: 0, len: 0.12, hz: 280, to: 560, square: 0.2, gain: 0.6, decay: 1.5 }]),
  buzz: render([{ at: 0, len: 0.3, hz: 110, square: 0.9, gain: 0.4, decay: 0.4 }, { at: 0, len: 0.3, hz: 117, square: 0.9, gain: 0.3, decay: 0.4 }]),
  beep: render([{ at: 0, len: 0.13, hz: 660, gain: 0.5, decay: 0.6 }]),
  go: render([{ at: 0, len: 0.38, hz: 1320, gain: 0.5, decay: 1 }, { at: 0, len: 0.38, hz: 660, gain: 0.25, decay: 1 }]),
  fanfare: render([
    { at: 0, len: 0.12, hz: 523, square: 0.25 }, { at: 0.11, len: 0.12, hz: 659, square: 0.25 },
    { at: 0.22, len: 0.12, hz: 784, square: 0.25 }, { at: 0.33, len: 0.2, hz: 1047, square: 0.25 },
    { at: 0.52, len: 0.12, hz: 784, square: 0.25 }, { at: 0.63, len: 0.5, hz: 1047, square: 0.25, decay: 1.5 },
    { at: 0.63, len: 0.5, hz: 1319, gain: 0.3, decay: 1.5 },
  ]),
  pop: render([{ at: 0, len: 0.06, hz: 380, to: 980, gain: 0.7, decay: 1 }, { at: 0, len: 0.02, hz: 2000, noise: 0.9, gain: 0.3 }], 9),
  powerup: render([
    { at: 0, len: 0.09, hz: 392 }, { at: 0.07, len: 0.09, hz: 523 }, { at: 0.14, len: 0.09, hz: 659 },
    { at: 0.21, len: 0.09, hz: 784 }, { at: 0.28, len: 0.26, hz: 1047, to: 1175 },
  ]),
  zap: render([{ at: 0, len: 0.17, hz: 1900, to: 180, square: 0.5, gain: 0.45, decay: 1.2 }]),
  thud: render([{ at: 0, len: 0.16, hz: 95, to: 48, gain: 0.9 }, { at: 0, len: 0.05, hz: 200, noise: 1, lp: 0.3, gain: 0.5 }], 13),
  lose: render([{ at: 0, len: 0.16, hz: 440, square: 0.2 }, { at: 0.15, len: 0.16, hz: 349, square: 0.2 }, { at: 0.3, len: 0.4, hz: 262, to: 233, square: 0.2, decay: 1.5 }]),
  click: render([{ at: 0, len: 0.014, hz: 2400, noise: 0.85, gain: 0.5, decay: 1 }], 17),
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
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('usage: node scripts/make-assets.mjs [--check]\n\n  (no option)  write public/assets/<ASSET_SET_VERSION>/ from this file\n  --check      fail when the committed set differs from the generator');
  } else if (process.argv.includes('--check')) {
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
