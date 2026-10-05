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

Writes <root>/<slug>/ with src/server.js, public/{index.html,client.js,game.js},
test/{game.test.mjs,reference.mjs,replay.ndjson}, package.json, .gitignore,
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

const INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{nameHtml}}</title>
  <meta name="description" content="{{descriptionHtml}}">
  <script type="importmap">
    { "imports": { "@engine/": "{{origin}}/engine/{{version}}/" } }
  </script>
</head>
<body>
  <div id="game"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>
`;

const CLIENT = `import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, INTENT, SNAPSHOT } from "/game.js";

startGame({
  title: {{nameJson}},
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: { turn: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "turn", value: -1, label: "◀" },
    { field: "turn", value: 1, label: "▶" },
  ],
  draw(surface, snap, ctx) {
    surface.clear("actors");
    surface.disc("actors", { x: snap.px, y: snap.py, r: 8, colour: "#ffd54a" });
    snap.x.forEach((x, i) => {
      surface.disc("actors", { x, y: snap.y[i], r: 10, colour: ctx.colourFor(i) });
    });
  },
});
`;

const GAME = `// {{name}}: steer a drifting dot onto the pellet before anyone else does.
// No DOM, no network, no timers: it runs headless in Node.
const SPEED = 3;
const TURN = 0.08;
const REACH = 14;
const MARGIN = 40;
export const PELLETS_PER_ROUND = 5;

export class Game {
  constructor(playerCount, opts, rng) {
    const { w, h } = opts.arena;
    this.n = playerCount;
    this.rng = rng;
    this.w = w;
    this.h = h;
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.left = 0;
    this.pellet = { x: w / 2, y: h / 2 };
    this.ships = Array.from({ length: playerCount }, () => ({ x: w / 2, y: h / 2, a: 0 }));
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.left = PELLETS_PER_ROUND;
    this.ships = Array.from({ length: this.n }, () => ({
      x: this.rng.range(MARGIN, this.w - MARGIN),
      y: this.rng.range(MARGIN, this.h - MARGIN),
      a: this.rng.range(0, Math.PI * 2),
    }));
    this.placePellet();
  }

  placePellet() {
    this.pellet = {
      x: Math.round(this.rng.range(MARGIN, this.w - MARGIN)),
      y: Math.round(this.rng.range(MARGIN, this.h - MARGIN)),
    };
  }

  step(intents) {
    const taken = [];
    if (!this.roundOver) {
      this.tick += 1;
      for (let i = 0; i < this.n; i++) {
        const ship = this.ships[i];
        const turn = Math.max(-1, Math.min(1, intents[i]?.turn || 0));
        ship.a += turn * TURN;
        ship.x = Math.max(0, Math.min(this.w, ship.x + Math.cos(ship.a) * SPEED));
        ship.y = Math.max(0, Math.min(this.h, ship.y + Math.sin(ship.a) * SPEED));
        if (Math.hypot(ship.x - this.pellet.x, ship.y - this.pellet.y) < REACH) taken.push(i);
      }
      if (taken.length) {
        for (const i of taken) this.scores[i] += 1;
        this.left -= 1;
        if (this.left <= 0) this.roundOver = true;
        else this.placePellet();
      }
    }
    return {
      k: this.tick,
      over: this.roundOver,
      x: this.ships.map((ship) => Math.round(ship.x * 10) / 10),
      y: this.ships.map((ship) => Math.round(ship.y * 10) / 10),
      px: this.pellet.x,
      py: this.pellet.y,
      d: taken,
    };
  }

  winner(target) {
    const best = Math.max(...this.scores);
    if (best < target) return -1;
    return this.scores.filter((score) => score === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x", "y"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 10, bits: 16, per: "player" },
    y: { type: "fixed", scale: 10, bits: 16, per: "player" },
    px: { type: "uint", bits: 16 },
    py: { type: "uint", bits: 16 },
    d: { type: "players" },
  },
};

export const INTENT = { turn: { min: -1, max: 1, neutral: 0 } };
`;

const REFERENCE = `// The reference match behind test/replay.ndjson. Re-record after a rule change:
//   RECORD=1 npm test
import { Game } from "../public/game.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { record } from "../../engine/replay.js";

export const SEED = {{seed}};
export const PLAYERS = 4;
export const build = (n, opts, rng) => new Game(n, opts?.arena ? opts : { arena: arenaFor(n) }, rng);

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const rec = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 3; round++) {
    rec.round();
    game.startRound();
    for (let tick = 0; tick < 400 && !game.roundOver; tick++) {
      const intents = Array.from({ length: PLAYERS }, (_, seat) => ({ turn: ((Math.floor(tick / 20) + seat) % 3) - 1 }));
      rec.tick(intents);
      game.step(intents);
    }
  }
  return rec.finish(game);
}
`;

const TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game, SNAPSHOT, INTENT, PELLETS_PER_ROUND } from "../public/game.js";
import { validateSimulation } from "../../engine/sim.js";
import { defineSnapshot } from "../../engine/schema.js";
import { seededRng } from "../../engine/rng.js";
import { arenaFor } from "../../engine/render2d.js";
import { replay } from "../../engine/replay.js";
import { MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } from "../../engine/params.js";
import { build, playReference } from "./reference.mjs";

const schema = defineSnapshot(SNAPSHOT);
const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
const neutral = (n) => Array.from({ length: n }, () => ({ turn: 0 }));

if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Game, { arena: arenaFor(2) }), true);
});

test("a straight run reaches the pellet at a predictable tick", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  game.ships[0] = { x: 100, y: 100, a: 0 };
  game.pellet = { x: 160, y: 100 };
  const taken = [];
  for (let i = 0; i < 30; i++) {
    const snap = game.step(neutral(1));
    if (snap.d.length) taken.push(snap.k);
    if (taken.length) break;
  }
  // Three pixels a tick from x=100; the pellet at x=160 is in reach inside 14 pixels.
  assert.deepEqual(taken, [16]);
  assert.equal(game.scores[0], 1);
});

test("a round ends after its pellets are taken", () => {
  const game = build(1, {}, seededRng(5));
  game.startRound();
  for (let taken = 0; taken < PELLETS_PER_ROUND; taken++) {
    assert.equal(game.roundOver, false);
    game.ships[0] = { x: game.pellet.x - 3, y: game.pellet.y, a: 0 };
    game.step(neutral(1));
  }
  assert.equal(game.roundOver, true);
  assert.equal(game.scores[0], PELLETS_PER_ROUND);
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3];
  assert.equal(game.winner(3), -1);
  game.scores = [4, 3];
  assert.equal(game.winner(3), 0);
});

test("a snapshot fits its budget at the player cap and round-trips", () => {
  const game = build(MAX_PLAYERS_PER_ROOM, {}, seededRng(4));
  game.startRound();
  let snap;
  for (let i = 0; i < 100; i++) snap = game.step(neutral(MAX_PLAYERS_PER_ROOM));
  const bytes = schema.encode(snap, MAX_PLAYERS_PER_ROOM);
  assert.ok(bytes.byteLength <= SNAPSHOT_BUDGET_BYTES * MAX_PLAYERS_PER_ROOM, bytes.byteLength + " bytes");
  const back = schema.decode(bytes, MAX_PLAYERS_PER_ROOM);
  assert.equal(back.px, snap.px);
  assert.deepEqual(back.d, snap.d);
  back.x.forEach((value, i) => assert.ok(Math.abs(value - snap.x[i]) <= 1 / 20));
});

test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 3, "played " + reached.round + " rounds");
});

test("two runs from one seed reach the same state", () => {
  assert.equal(playReference(), playReference());
});

test("the intent declares only what the game reads", () => {
  assert.deepEqual(Object.keys(INTENT), ["turn"]);
});
`;

const README = `# {{name}}

{{description}}

Built on the repository's browser game engine (\`engine/README.md\`). The page is
a container and a pinned engine import; the engine owns the lobby, the
networking, the loop, the invite panel and \`/healthz\`.

| Path | Role |
|---|---|
| \`public/game.js\` | The simulation, \`SNAPSHOT\` and \`INTENT\`. Headless. |
| \`public/client.js\` | One \`startGame\` call: bindings and \`draw\`. |
| \`src/server.js\` | One \`serveGame\` call. |
| \`test/\` | Scenario tests, the reference match and its replay fixture. |

## Input

One field per player per tick, sent only when it changes:
\`{ turn: -1 | 0 | 1 }\`. Arrow keys, the two touch buttons and gamepad axis 0
all feed it.

## Snapshot

Declared in \`SNAPSHOT\`; the engine derives the binary codec and the deltas.

| Field | Type | Meaning |
|---|---|---|
| \`k\` | uint32 | Tick within the round |
| \`over\` | bool | The round has ended |
| \`x\`, \`y\` | fixed, one decimal, per player | Dot position, interpolated on guests |
| \`px\`, \`py\` | uint16 | Pellet position |
| \`d\` | player list | Event list: who took a pellet this tick |

## Round lifecycle

\`startRound()\` places every dot and the first pellet from the seeded
generator. A dot that reaches the pellet scores one point and a new pellet
appears. The round is over after {{pellets}} pellets. The host starts the next
round with Space or the Next round button; the match ends when one player
holds the target score with a clear lead.

## Commands

\`\`\`bash
npm test                                # scenarios, budget, replay fixture
RECORD=1 npm test                       # re-record test/replay.ndjson after a rule change
node ../scripts/dev.mjs {{slug}}        # run locally against this checkout's engine
node ../scripts/conformance.mjs .       # the sub-app contract, every row
\`\`\`
`;

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

  const text = description?.trim() || `${name.trim()}: steer onto the pellet before anyone else does.`;
  const values = {
    slug, name: name.trim(), description: text, version, origin, seed: String(seedOf(slug)), pellets: '5',
    nameHtml: escapeHtml(name.trim()), descriptionHtml: escapeHtml(text), nameJson: JSON.stringify(name.trim()),
  };
  const files = {
    'src/server.js': SERVER,
    'public/index.html': fill(INDEX, values),
    'public/client.js': fill(CLIENT, values),
    'public/game.js': fill(GAME, values),
    'test/reference.mjs': fill(REFERENCE, values),
    'test/game.test.mjs': TEST,
    'README.md': fill(README, values),
    '.gitignore': 'node_modules/\n.anybuild/\n.shipit/\nengine/\npublic/engine/\n',
    'package.json': `${JSON.stringify({
      name: slug, version: '0.1.0', private: true, description: text, type: 'module',
      engines: { node: '>=22' },
      scripts: { start: 'node src/server.js', test: 'node --test test/*.test.mjs' },
      dependencies: { ws: '^8.20.1' },
    }, null, 2)}\n`,
    'app.yaml': `kind: wasmer.io/App.v0\nname: ${slug}\nowner: wasmer\npackage: .\nlocality:\n  regions:\n  - fr-roub1\n`,
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
