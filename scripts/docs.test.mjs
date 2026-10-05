// The recipe must match the tooling: every command a guide cites exists and answers --help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES = ['AGENTS.md', 'engine/README.md'];
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

export function citedCommands(text) {
  const scripts = new Set([...text.matchAll(/\bnode (?:\.\.\/)?(scripts\/[\w./-]+\.mjs)/g)].map((found) => found[1]));
  const shell = new Set([...text.matchAll(/(?:\.\.?\/)(deploy\.sh)\b/g)].map((found) => found[1]));
  return { scripts: [...scripts].sort(), shell: [...shell].sort() };
}

test('the extractor finds node scripts and the deploy script', () => {
  const found = citedCommands('run `node scripts/dev.mjs achtung`, then node ../scripts/soak.mjs . and ./deploy.sh super');
  assert.deepEqual(found, { scripts: ['scripts/dev.mjs', 'scripts/soak.mjs'], shell: ['deploy.sh'] });
});

for (const guide of GUIDES) {
  test(`${guide} cites only commands that exist and answer --help`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, guide)), `${guide} is missing`);
    const { scripts, shell } = citedCommands(read(guide));
    assert.ok(scripts.length > 0, `${guide} cites no node scripts/ command`);
    for (const script of scripts) {
      assert.ok(fs.existsSync(path.join(ROOT, script)), `${guide} cites ${script}, which does not exist`);
      const help = spawnSync(process.execPath, [script, '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
      assert.equal(help.status, 0, `${guide}: node ${script} --help exited ${help.status}: ${help.stderr}`);
      assert.match(help.stdout, /usage/i, `${guide}: node ${script} --help prints no usage`);
    }
    for (const script of shell) {
      // The deploy script has no help flag and a bare run deploys, so it is checked without running it.
      const mode = fs.statSync(path.join(ROOT, script)).mode;
      assert.ok(mode & 0o111, `${guide} cites ./${script}, which is not executable`);
      assert.equal(spawnSync('bash', ['-n', script], { cwd: ROOT }).status, 0, `./${script} does not parse`);
    }
  });
}

test('AGENTS.md is the engine recipe, not the old template', () => {
  const guide = read('AGENTS.md');
  for (const gone of ['applyMessage', 'cp -r achtung', 'broadcastGame', 'hostStart', 'transport prefix', 'element id']) {
    assert.ok(!guide.toLowerCase().includes(gone.toLowerCase()), `AGENTS.md still mentions ${gone}`);
  }
  for (const needed of ['node scripts/new-game.mjs', 'node scripts/conformance.mjs', 'node scripts/dev.mjs',
    'node scripts/sync-engine.mjs vendor', './deploy.sh', 'engine/README.md', 'startGame', 'RECORD=1',
    'The engine owns behaviour, the game owns its page and stylesheet', 'data-engine', 'public/style.css']) {
    assert.ok(guide.includes(needed), `AGENTS.md does not mention ${needed}`);
  }
  assert.equal(fs.readlinkSync(path.join(ROOT, 'CLAUDE.md')), 'AGENTS.md');
});

test('AGENTS.md states the engine version rule without restating the version', () => {
  const version = read('engine/params.js').match(/ENGINE_VERSION *= *"([^"]+)"/)[1];
  assert.ok(!read('AGENTS.md').includes(`/engine/${version}/`), 'AGENTS.md hardcodes the engine version; cite ENGINE_VERSION');
});

test('the engine guide documents every page slot the kit and the conformance suite know', async () => {
  const { REQUIRED_SLOTS, OPTIONAL_SLOTS } = await import('./conformance.mjs');
  const guide = read('engine/README.md');
  const section = guide.slice(guide.indexOf('## Page slots'));
  assert.ok(guide.includes('## Page slots'), 'engine/README.md has no "Page slots" section');
  const kit = read('engine/ui.js');
  for (const role of [...REQUIRED_SLOTS, ...OPTIONAL_SLOTS]) {
    assert.ok(section.includes(`\`${role}\``), `engine/README.md does not document the ${role} slot`);
    assert.ok(new RegExp(`(?:slot|make)\\("${role}"`).test(kit), `engine/ui.js binds no ${role} slot`);
  }
  const bound = [...kit.matchAll(/(?:slot|make)\("([\w-]+)"/g)].map((found) => found[1]);
  for (const role of bound) assert.ok([...REQUIRED_SLOTS, ...OPTIONAL_SLOTS].includes(role), `conformance does not know the ${role} slot`);
  assert.ok(section.includes('data-engine-touch'));
});
