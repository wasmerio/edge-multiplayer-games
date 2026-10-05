// Keeps the complete example in engine/README.md identical to what the scaffold writes:
//   node scripts/sync-example.mjs          rewrites the example blocks from scripts/scaffold/
//   node scripts/sync-example.mjs --check  fails when a block differs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplates, defaultDescription } from './new-game.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = 'engine/README.md';
export const EXAMPLE = { slug: 'pellet-rush', name: 'Pellet Rush' };
export const EXAMPLE_FILES = ['public/game.js', 'public/client.js', 'public/index.html', 'public/style.css'];
const LANGUAGE = { '.js': 'js', '.html': 'html', '.css': 'css' };

// The example names the version by its constant, so a version bump does not touch the guide.
export function exampleFiles(root = ROOT) {
  const origin = fs.readFileSync(path.join(root, 'engine/params.js'), 'utf8').match(/SUPERAPP_ORIGIN *= *"([^"]+)"/)[1];
  return renderTemplates({ ...EXAMPLE, description: defaultDescription(EXAMPLE.name), version: '<ENGINE_VERSION>', origin });
}

// A block is the fence that follows <!-- example:<path> -->.
export function syncGuide(text, files) {
  let out = text;
  const missing = [];
  for (const rel of EXAMPLE_FILES) {
    const marker = `<!-- example:${rel} -->`;
    const at = out.indexOf(marker);
    if (at < 0) { missing.push(rel); continue; }
    const open = out.indexOf('```', at);
    const bodyStart = out.indexOf('\n', open) + 1;
    const close = out.indexOf('\n```', bodyStart - 1);
    if (open < 0 || close < 0) { missing.push(rel); continue; }
    out = `${out.slice(0, open)}\`\`\`${LANGUAGE[path.extname(rel)]}\n${files[rel].replace(/\n$/, '')}${out.slice(close)}`;
  }
  return { text: out, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('usage: node scripts/sync-example.mjs [--check]\n\n  (no option)  rewrite the example blocks of engine/README.md from scripts/scaffold/\n  --check      fail when a block differs from the scaffold');
  } else {
    const file = path.join(ROOT, GUIDE);
    const before = fs.readFileSync(file, 'utf8');
    const { text, missing } = syncGuide(before, exampleFiles());
    if (missing.length) { console.error(`${GUIDE} has no example block for: ${missing.join(', ')}`); process.exitCode = 1; }
    else if (args.includes('--check')) {
      if (text !== before) { console.error(`${GUIDE}: the example differs from scripts/scaffold/; run node scripts/sync-example.mjs`); process.exitCode = 1; }
      else console.log(`${GUIDE}: the example matches the scaffold`);
    } else {
      if (text !== before) fs.writeFileSync(file, text);
      console.log(`${GUIDE}: ${text === before ? 'already in sync' : 'example blocks rewritten'}`);
    }
  }
}
