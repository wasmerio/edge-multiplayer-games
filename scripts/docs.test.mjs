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

// ---- the reference must be true of the code ---------------------------------

const GUIDE = read('engine/README.md');
const source = (file) => read(`engine/${file}`);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text under one heading, down to the next heading of the same or a higher level.
function section(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^#{1,6} +\`?${escapeRe(title)}\`?\\s*$`).test(line));
  assert.ok(start >= 0, `no heading "${title}"`);
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const found = lines[i].match(/^(#+) /);
    // A line that starts with # inside a code fence is not a heading.
    if (found && found[1].length <= level && (lines.slice(start, i).join('\n').split('```').length % 2 === 1)) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}
// The backticked names in the first column of every table row.
const firstColumn = (text) => text.split('\n').filter((line) => /^\| *`/.test(line))
  .flatMap((line) => [...line.split('|')[1].matchAll(/`([^`]+)`/g)].map((found) => found[1]));
const bare = (name) => name.replace(/\(.*$/, '').trim();
const same = (documented, real, what) => {
  assert.deepEqual([...new Set(documented)].sort(), [...new Set(real)].sort(), `${what}: the guide and the code disagree`);
};

test('the example in the engine guide is the scaffold, byte for byte', async () => {
  const { syncGuide, exampleFiles, EXAMPLE_FILES } = await import('./sync-example.mjs');
  const { text, missing } = syncGuide(GUIDE, exampleFiles());
  assert.deepEqual(missing, []);
  assert.equal(text, GUIDE, 'run node scripts/sync-example.mjs');
  for (const rel of EXAMPLE_FILES) assert.ok(GUIDE.includes(`<!-- example:${rel} -->`));
  assert.ok(GUIDE.includes('startGame({') && GUIDE.includes('data-engine-stick="mx,my"') && GUIDE.includes('ctx.events("took")'));
});

test('every startGame option is documented, and every documented option exists', () => {
  const engine = source('engine.js');
  const head = engine.slice(engine.indexOf('export function startGame(config) {'), engine.indexOf('} = config;'));
  const destructured = [...head.slice(head.indexOf('const {')).matchAll(/(?:^|[,{]\s*)([A-Za-z]\w*)(?=\s*(?:=|,|$))/gm)].map((found) => found[1]);
  const viaConfig = [...engine.matchAll(/\bconfig\.(\w+)/g)].map((found) => found[1]);
  const real = [...new Set([...destructured, ...viaConfig])];
  const part = section(GUIDE, 'startGame(config)');
  const table = firstColumn(part.slice(0, part.indexOf('Seams for tests')));
  const seams = [...part.match(/Seams for tests[^\n]*\n[^\n]*/)[0].matchAll(/`(\w+)`/g)].map((found) => found[1]);
  same([...table, ...seams], real, 'startGame options');
  for (const name of ['ctx', 'intent', 'ui', 'surface', 'view', 'peers', 'signal', 'state', 'diagnostics', 'input', 'mixer', 'engineVersion']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(engine.slice(engine.lastIndexOf('  return {'))), `startGame returns no ${name}`);
    assert.ok(part.includes(name), `the guide does not list ${name} in what startGame returns`);
  }
});

test('the draw context table lists exactly the members of ctx', () => {
  const engine = source('engine.js');
  const body = engine.slice(engine.indexOf('  const context = {'), engine.indexOf('  // A scoreboard hook lets a team game'));
  const real = [...body.matchAll(/^ {4}(\w+)[:,(]/gm)].map((found) => found[1]);
  assert.ok(real.includes('events') && real.includes('hud'));
  same(firstColumn(section(GUIDE, 'Draw context `ctx`')).map(bare), real, 'ctx members');
});

test('the surface table lists exactly the methods of the surface', async () => {
  const saved = globalThis.document;
  globalThis.document = { createElement: () => ({ dataset: {}, style: {}, getContext: () => ({}) }) };
  const { createSurface, arenaFor, TEXT_FAMILY } = await import('../engine/render2d.js');
  const surface = createSurface({ container: { appendChild() {}, style: {} } });
  globalThis.document = saved;
  const real = Object.keys(surface).filter((name) => name !== 'setArena');
  const part = section(GUIDE, 'Surface');
  same(firstColumn(part.slice(0, part.indexOf('Every drawing call also takes'))).map(bare), real, 'surface methods');
  const render = source('render2d.js');
  for (const option of ['alpha', 'glow', 'outline', 'family', 'baseline', 'italic', 'maxWidth', 'weight', 'align', 'dash', 'closed', 'stroke', 'linear', 'radial', 'stops', 'radius', 'rotate', 'spacing']) {
    assert.ok(new RegExp(`\\b${option}\\b`).test(render), `render2d.js has no ${option}`);
    assert.ok(new RegExp(`\`?\\b${option}\\b`).test(part), `the Surface section does not document ${option}`);
  }
  assert.ok(part.includes(TEXT_FAMILY));
  const sizes = section(GUIDE, 'Arena and screen');
  for (let players = 1; players <= 8; players++) {
    const { w, h } = arenaFor(players);
    assert.ok(sizes.includes(`${w}×${h}`), `the arena table lacks ${w}×${h} for ${players} players`);
  }
  for (const name of ['--arena-w', '--arena-h']) assert.ok(render.includes(name) && sizes.includes(name), name);
});

test('the sound table is the shared set, with the generator\'s descriptions', async () => {
  const { SOUND_NAMES } = await import('../engine/assets.js');
  const { SOUND_NOTES } = await import('./make-assets.mjs');
  const part = section(GUIDE, 'Sound');
  const rows = part.split('\n').filter((line) => /^\| `\w+` \| /.test(line) && !/\| (string|0 to 1|`\[lo)/.test(line));
  const table = Object.fromEntries(rows.map((line) => line.split('|').slice(1, 3).map((cell) => cell.trim().replace(/`/g, ''))));
  for (const name of SOUND_NAMES) assert.equal(table[name], SOUND_NOTES[name], `sound ${name}`);
  const options = firstColumn(part.slice(part.indexOf('| Option |'), part.indexOf('| Field value |'))).filter((name) => name !== '(key)');
  same(options, ['sound', 'field', 'gain', 'pitch', 'only'], 'audioMap options');
  const audio = source('audio.js');
  for (const option of options) assert.ok(new RegExp(`\\.${option}\\b`).test(audio), `audio.js reads no ${option}`);
  const client = read('scripts/scaffold/public/client.js');
  const mapped = client.slice(client.indexOf('audioMap: {'), client.indexOf('  labels: {'));
  assert.ok(mapped.includes('sound:'));
  for (const sound of [...mapped.matchAll(/sound: "(\w+)"|: "(\w+)",\n/g)].map((found) => found[1] ?? found[2])) {
    assert.ok(SOUND_NAMES.includes(sound), `the scaffold maps unknown sound ${sound}`);
  }
});

test('intent, binding, schema and rng tables match the code', async () => {
  const input = source('input.js');
  const part = section(GUIDE, 'Intent and bindings');
  const bindingOptions = firstColumn(part.slice(part.indexOf('| Binding option |')));
  same(bindingOptions, [...new Set([...input.matchAll(/\bbinding\.(\w+)/g)].map((found) => found[1]))], 'binding options');
  same(firstColumn(part.slice(part.indexOf('| Intent option |'), part.indexOf('// client.js'))).flatMap((cell) => cell.split(',')).map((name) => name.trim()),
    [...new Set([...input.matchAll(/\bspec\.(\w+)/g)].map((found) => found[1]))], 'intent options');
  const types = [...source('schema.js').matchAll(/case "(\w+)":/g)].map((found) => found[1]);
  const schemaPart = section(GUIDE, 'Snapshot schema');
  same(firstColumn(schemaPart.slice(schemaPart.indexOf('| `type` |'), schemaPart.indexOf('| Shape |'))).filter((name) => name !== 'type'), types, 'schema types');
  const { seededRng } = await import('../engine/rng.js');
  const sim = section(GUIDE, 'The simulation (`public/game.js`)');
  same(firstColumn(sim.slice(sim.indexOf('| Method |'))).map((cell) => bare(cell.replace(/^rng\./, ''))), Object.keys(seededRng(1)), 'rng methods');
  for (const hook of source('stage.js').match(/const HOOKS = \[([^\]]+)\]/)[1].matchAll(/"(\w+)"/g)) {
    assert.ok(section(GUIDE, 'startGame(config)').includes(`\`${hook[1]}`) || hook[1] === 'draw', `mount hook ${hook[1]} is not documented`);
  }
});

test('labels, scoreboard rows and the debug handle are documented as they are', () => {
  const engine = source('engine.js');
  const ui = source('ui.js');
  same(firstColumn(section(GUIDE, 'Labels')), [...ui.slice(ui.indexOf('export const labelsWith'), ui.indexOf('...labels,')).matchAll(/^ {2}(\w+):/gm)].map((found) => found[1]), 'labels');
  const info = engine.slice(engine.indexOf('const info = () => ({'), engine.indexOf('// A label that returns nothing'));
  const infoKeys = [...info.matchAll(/\b(\w+):/g)].map((found) => found[1]);
  const documentedInfo = section(GUIDE, 'Labels').match(/`info` is `\{ ([^}]+) \}`/)[1].split(',').map((name) => name.trim());
  same(documentedInfo, infoKeys, 'label info');

  const rowKeys = [...ui.match(/JSON\.stringify\(players\.map\(\(p\) => \[([^\]]+)\]/)[1].matchAll(/p\.(\w+)/g)].map((found) => found[1]);
  const board = section(GUIDE, 'Scoreboard');
  same(firstColumn(board.slice(board.indexOf('| Row field |'))).flatMap((cell) => cell.split(',')).map((name) => name.trim()), rowKeys, 'score row fields');
  for (const name of ['swatch', 'name', 'score', 'note', 'dead', 'you', 'host', 'data-state']) {
    assert.ok(ui.includes(`"${name}"`) || ui.includes(`class: "${name}"`), `ui.js writes no ${name}`);
    assert.ok(board.includes(name), `the Scoreboard section does not show ${name}`);
  }

  const handle = engine.slice(engine.indexOf('globalThis.__engine = {'), engine.indexOf('onReady?.(context);'));
  same(firstColumn(section(GUIDE, 'The debug handle')).map(bare), [...handle.matchAll(/^ {4}(\w+):/gm)].map((found) => found[1]), '__engine members');
  const stateKeys = [...handle.slice(handle.indexOf('state: () => ({'), handle.indexOf('audio: {')).matchAll(/\b(\w+):/g)].map((found) => found[1]).filter((name) => name !== 'state');
  const documentedState = section(GUIDE, 'The debug handle').match(/`state\(\)` \| `\{ ([^}]+) \}`/)[1].split(',').map((name) => name.trim());
  same(documentedState, [...stateKeys, 'audio'], '__engine.state() keys');
});

test('every attribute and custom property the guide names is one the kit reads or writes', () => {
  const ui = source('ui.js');
  const guide = `${section(GUIDE, 'Page slots')}`;
  for (const name of ['data-engine-touch', 'data-engine-stick', 'data-stick-mode', 'data-stick-dead', 'data-pressed', 'data-active', 'data-state', 'data-kind',
    'data-channel', '--stick-x', '--stick-y', '8way', 'analog']) {
    assert.ok(ui.includes(name), `ui.js does not know ${name}`);
    assert.ok(guide.includes(name), `the guide does not document ${name}`);
  }
  for (const [attribute, code] of [['data-touch', 'dataset.touch'], ['data-overlay', 'dataset.overlay']]) {
    assert.ok(ui.includes(code) && guide.includes(attribute), attribute);
  }
  for (const kind of ['round', 'over', 'win', 'note']) assert.ok(new RegExp(`"${kind}"`).test(source('engine.js') + ui), `no banner kind ${kind}`);
});

// Capitalised names in the guides that are exports or environment variables, not engine tunables.
const NOT_TUNABLES = ['SOUND_NAMES', 'PLAYER_COLOURS', 'CHROME_BIN', 'SERVER_CORS_ALLOW_ORIGINS', 'SERVER_CACHE_CONTROL_HEADERS'];

test('every tunable the guides cite exists, with the value they give', async () => {
  const params = await import('../engine/params.js');
  for (const file of ['AGENTS.md', 'engine/README.md', '.claude/skills/make-game/SKILL.md']) {
    const text = read(file);
    for (const found of text.matchAll(/`(?:params\.)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`(?: \((\d+(?:\.\d+)?)\b)?/g)) {
      if (NOT_TUNABLES.includes(found[1])) continue;
      assert.ok(found[1] in params, `${file} cites ${found[1]}, which engine/params.js does not declare`);
      if (found[2] !== undefined) assert.equal(Number(found[2]), params[found[1]], `${file} gives ${found[1]} as ${found[2]}`);
    }
  }
});

test('the conformance rows, the failure table and the play command match their tools', async () => {
  const { TITLES } = await import('./conformance.mjs');
  const rows = section(GUIDE, 'Conformance');
  same(firstColumn(rows.slice(rows.indexOf('| Row |'), rows.indexOf('A game may pin any published'))), Object.keys(TITLES), 'conformance rows');
  const soak = read('scripts/soak.mjs');
  const agents = read('AGENTS.md');
  const failures = section(agents, '3.8 Conformance and soak');
  for (const line of failures.split('\n').filter((each) => /^\| (soak )?`/.test(each))) {
    const cell = line.split('|')[1];
    for (const found of cell.matchAll(/`([\w-]+)`/g)) {
      if (/^soak /.test(cell.trim()) || /soak `/.test(cell.slice(0, cell.indexOf(found[0])))) assert.ok(soak.includes(`'${found[1]}'`), `the soak run has no failure ${found[1]}`);
      else if (/^[a-z-]+$/.test(found[1]) && !cell.includes('play.mjs') && !cell.includes('naming')) assert.ok(found[1] in TITLES, `conformance has no row ${found[1]}`);
    }
  }
  assert.ok(failures.includes('`origin`'));

  const { USAGE } = await import('./play.mjs');
  const play = read('scripts/play.mjs');
  const look = section(GUIDE, 'Look at your game');
  const flags = [...new Set([...USAGE.matchAll(/^ {2}(--[\w-]+)/gm)].map((found) => found[1]))].filter((flag) => flag !== '--help');
  for (const flag of flags) assert.ok(look.includes(`\`${flag}`), `the guide does not document play.mjs ${flag}`);
  for (const found of look.matchAll(/`(--[\w-]+)/g)) assert.ok(flags.includes(found[1]), `play.mjs has no option ${found[1]}`);
  for (const name of ['01-lobby-desktop', '02-lobby-phone', '03-room-', '04-game-', '05-over-', '06-spectator']) {
    assert.ok(play.includes(name) && look.includes(name), name);
  }
  for (const key of ['requestsToOtherOrigins', 'scrollsSideways', 'errors', 'snapshot', 'hud', 'banner', 'scores', 'touch', 'viewport', 'arena',
    'roundsEnded', 'matchesWon', 'stopped', 'final', 'bot', 'shots', 'pages']) {
    assert.ok(play.includes(key) && look.includes(`\`${key}\``), `summary key ${key}`);
  }
  assert.ok(!/`rounds`/.test(look), 'the summary key is roundsEnded; a bare `rounds` is ambiguous');
  for (const name of ['05-over-<page>-r<round>', 'r<round>-<n>']) assert.ok(look.includes(name), name);

  // The bot contract: the info table is exactly what the harness passes, and the default file is the one it looks for.
  const { DEFAULT_BOT } = await import('./play.mjs');
  const bots = section(GUIDE, 'Bots');
  const passed = play.slice(play.indexOf('apply(bot(snapshot, {'), play.indexOf('status.calls += 1'));
  const infoKeys = [...passed.matchAll(/\b(\w+):/g)].map((found) => found[1]).concat(/\bgame,/.test(passed) ? ['game'] : []);
  same(firstColumn(bots.slice(bots.indexOf('| `info` |'))).filter((name) => name !== 'info'), infoKeys, 'bot info');
  assert.ok(bots.includes(`\`${DEFAULT_BOT}\``) && agents.includes(DEFAULT_BOT), 'the default bot file is named in both guides');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/scaffold', DEFAULT_BOT)), 'the scaffold ships a bot');
  assert.match(bots, /every (\d+) ms/);
  assert.equal(Number(bots.match(/every (\d+) ms/)[1]), Number(play.match(/const BOT_MS = (\d+);/)[1]), 'the bot period');
  assert.equal(Number(look.match(/with `--rounds`, (\d+) for each round/)[1]), Number(play.match(/const SECONDS_PER_ROUND = (\d+);/)[1]), 'seconds per round');

  for (const method of ['newPage', 'goto', 'evaluate', 'waitFor', 'errors', 'requests', 'cdp', 'close']) {
    assert.ok(read('scripts/lib/browser.mjs').includes(method) && look.includes(method), `browser helper ${method}`);
  }
});

test('the engine exports table names every export of engine.js', async () => {
  const saved = globalThis.document;
  const engine = await import('../engine/engine.js');
  globalThis.document = saved;
  const table = section(GUIDE, 'Everything `engine.js` exports');
  for (const name of Object.keys(engine)) assert.ok(new RegExp(`\`${name}\\b`).test(table) || table.includes(`${name}\``), `export ${name} is not in the table`);
});

test('the guides have the sections an author is sent to, and the skill exists', () => {
  const headings = GUIDE.split('\n').filter((line) => /^#{2,4} /.test(line)).map((line) => line.replace(/^#+ +/, '').replace(/`/g, ''));
  for (const needed of ['Complete example', 'The simulation (public/game.js)', 'Snapshot schema', 'Intent and bindings', 'startGame(config)',
    'Draw context ctx', 'Labels', 'Surface', 'Arena and screen', 'Page slots', 'Touch controls', 'Scoreboard', 'Sound', 'How it behaves',
    'The draw lifecycle', 'Host and guests', 'Events and state', 'Rounds and matches', 'Late joiners and spectators', 'A player leaves',
    'Nothing from another origin', 'Game feel cookbook', 'Look at your game', 'The debug handle', 'Typography', 'Conformance']) {
    assert.ok(headings.includes(needed), `engine/README.md has no section "${needed}"`);
  }
  const skill = read('.claude/skills/make-game/SKILL.md');
  assert.match(skill, /^---\nname: make-game\ndescription: \S[^\n]{40,}\n---\n/);
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('.claude/skills/make-game/SKILL.md'), 'AGENTS.md does not mention the skill');
  assert.ok(agents.includes('## 6. Design checklist for a great game'));
  // A quoted section name next to the guide's file name must be a real heading.
  for (const [file, text] of [['SKILL.md', skill], ['AGENTS.md', agents], ['daily-game-system.md', read('automation/daily-game/runtime/daily-game-system.md')]]) {
    for (const line of text.split('\n').filter((each) => /engine\/README\.md|^\| .* \| "/.test(each) || /^- (Read|In engine)/.test(each))) {
      for (const found of line.matchAll(/"([A-Z][^"]{3,40})"/g)) {
        const name = found[1].replace(/`/g, '');
        if (/[.<=]|^(Space|Enter|Start)$/.test(name)) continue;
        assert.ok(headings.some((heading) => heading === name || heading.startsWith(`${name} (`)), `${file} points at section "${name}", which engine/README.md does not have`);
      }
    }
  }
  for (const cited of citedCommands(skill).scripts) assert.ok(fs.existsSync(path.join(ROOT, cited)), `the skill cites ${cited}`);
  for (const game of ['fuse', 'trapdoor']) {
    for (const file of ['README.md', 'public/client.js', 'public/style.css', 'test/bot.mjs']) assert.ok(fs.existsSync(path.join(ROOT, game, file)), `${game}/${file}`);
    assert.ok(agents.includes(`| \`${game}/\` |`), `AGENTS.md lists ${game}/ as a reference game`);
  }
});
