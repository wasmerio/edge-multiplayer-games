import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import rewritePattern from 'regexpu-core';

const root = fileURLToPath(new URL('./node_modules/@earendil-works/pi-coding-agent/dist/bundle/', import.meta.url));
const samples = ['', 'hello', ' ', '\t', '\n', '\u0000', '\u0301', '\u093e', '\u1734',
  '\u302e', '\u065f', '\u0f7f', '\u102b', '\ud800', '\ufe0f', '漢', '😀', '❤️', '👩‍💻', '🇫🇮'];
let converted = 0;

function convert(pattern, flags) {
  const output = rewritePattern(pattern, flags, {
    unicodeSetsFlag: 'transform', unicodePropertyEscapes: 'transform',
  });
  const outputFlags = flags.replace('v', 'u');
  const before = new RegExp(pattern, flags);
  const after = new RegExp(output, outputFlags);
  for (const sample of samples) {
    before.lastIndex = after.lastIndex = 0;
    assert.deepEqual(after.exec(sample), before.exec(sample), `Regex conversion changed ${JSON.stringify(sample)}`);
  }
  converted += 1;
  return `new RegExp(${JSON.stringify(output)},${JSON.stringify(outputFlags)})`;
}

async function prepare(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) { await prepare(path); continue; }
    if (!entry.name.endsWith('.js')) continue;
    let source = await readFile(path, 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const edits = [];
    const pending = [ast];
    while (pending.length) {
      const node = pending.pop();
      if (node.type === 'Literal' && node.regex?.flags.includes('v')) {
        edits.push([node.start, node.end, convert(node.regex.pattern, node.regex.flags)]);
      } else if ((node.type === 'NewExpression' || node.type === 'CallExpression') &&
          node.callee.type === 'Identifier' && node.callee.name === 'RegExp' &&
          node.arguments.length === 2 && node.arguments.every(arg => typeof arg.value === 'string') &&
          node.arguments[1].value.includes('v')) {
        edits.push([node.start, node.end, convert(node.arguments[0].value, node.arguments[1].value)]);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) pending.push(...value.filter(item => item?.type));
        else if (value?.type) pending.push(value);
      }
    }
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
      source = source.slice(0, start) + replacement + source.slice(end);
    }
    if (edits.length) await writeFile(path, source);
  }
}

await prepare(root);
console.log(`Prepared Pi for QuickJS: converted ${converted} Unicode-set expressions; matching checks passed.`);
