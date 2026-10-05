import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(os.environ['GAME_TEST_ROOT']) if 'GAME_TEST_ROOT' in os.environ else Path(__file__).resolve().parents[3]
sys.path.insert(0, os.environ.get('GAME_RUNTIME_ROOT', str(Path(__file__).resolve().parents[1] / 'runtime')))
import game_contract as cron

DAY = "2026-09-10"
BASE = "a" * 40
NODE = '/bin/node' if os.environ.get('WASMER_GIT_TESTS') else shutil.which('node')
TOOLING = ("engine", "public/assets", "scripts")
ROOT_FILES = ("AGENTS.md", "public/games.json", ".wasmerignore")
REPORT = {"ok": True, "engine": "0.0.0", "tests": ["test/game.test.mjs"], "scenarios": 2,
          "conformance": {"tier": "static", "rows": ["pinned"]}}


def tooling():
    return [path for top in TOOLING for path in sorted((ROOT / top).rglob("*"))
            if path.is_file() and "node_modules" not in path.parts]


def is_text(path):
    try:
        path.read_text()
        return True
    except UnicodeDecodeError:
        return False


def repository_files():
    """The text slice of the repository the generator needs in its clone."""
    files = {str(path.relative_to(ROOT)): path.read_text() for path in tooling() if is_text(path)}
    files.update({name: (ROOT / name).read_text() for name in ROOT_FILES})
    # Publish in the fixture, so a stale public/engine in a working tree cannot fail these tests.
    files.update({f"public/engine/{engine_version()}/{path.name}": path.read_text()
                  for path in sorted((ROOT / "engine").glob("*.js"))})
    return files


def copy_binary_tooling(work):
    copied = set()
    for path in tooling():
        if not is_text(path):
            target = work / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            copied.add(str(path.relative_to(ROOT)))
    return copied


def engine_version():
    return cron.engine_version((ROOT / cron.ENGINE_PARAMS).read_text())


GAME_JS = """// Fixture sprint: hold right to reach the far wall first.
const SPEED = 2;

export class Simulation {
  constructor(playerCount, opts, rng) {
    this.n = playerCount;
    this.w = opts.arena.w;
    this.rng = rng;
    this.scores = new Array(playerCount).fill(0);
    this.round = 0;
    this.tick = 0;
    this.roundOver = true;
    this.x = new Array(playerCount).fill(0);
  }

  startRound() {
    this.round += 1;
    this.tick = 0;
    this.roundOver = false;
    this.x = this.x.map(() => Math.round(__START__));
  }

  step(intents) {
    if (!this.roundOver) {
      this.tick += 1;
      for (let i = 0; i < this.n; i++) {
        this.x[i] = Math.max(0, Math.min(this.w, this.x[i] + 4 + (intents[i]?.move || 0) * SPEED));
      }
      const first = this.x.findIndex((x) => x >= this.w);
      if (first >= 0) { this.scores[first] += 1; this.roundOver = true; }
    }
    return { k: this.tick, over: this.roundOver, x: [...this.x]__EXTRA_VALUES__ };
  }

  __WINNER__(target) {
    const best = Math.max(...this.scores);
    if (best < target) return -1;
    return this.scores.filter((s) => s === best).length === 1 ? this.scores.indexOf(best) : -1;
  }
}

export const Game = Simulation;

export const SNAPSHOT = {
  tickField: "k",
  interpolate: ["x"],
  fields: {
    k: { type: "uint", bits: 32 },
    over: { type: "bool" },
    x: { type: "fixed", scale: 4, bits: 16, per: "player" },__EXTRA_FIELDS__
  },
};

export const INTENT = { move: { min: -1, max: 1, neutral: 0 } };
"""

CLIENT_JS = """import { defineSnapshot, startGame } from "@engine/engine.js";
import { Simulation, INTENT, SNAPSHOT } from "/game.js";

startGame({
  title: "Fixture sprint",
  Simulation,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: { move: { keys: { ArrowLeft: -1, ArrowRight: 1 }, axis: 0 } },
  touchControls: [
    { field: "move", value: -1, label: "◀" },
    { field: "move", value: 1, label: "▶" },
  ],
  audioMap: {},
  draw(surface, snap, ctx) {
    surface.clear("actors");
    snap.x.forEach((x, i) => surface.disc("actors", { x, y: 40 + i * 30, r: 8, colour: ctx.colourFor(i) }));
  },
});
"""

TEST_MJS = """import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Simulation, SNAPSHOT } from "../public/game.js";
import { arenaFor, defineSnapshot, replay, seededRng, validateSimulation } from "../../engine/engine.js";
import { build, playReference } from "./reference.mjs";

const fixtureUrl = new URL("./replay.ndjson", import.meta.url);
if (process.env.RECORD === "1") fs.writeFileSync(fixtureUrl, playReference());

test("the simulation satisfies the engine shape", () => {
  assert.equal(validateSimulation(Simulation, { arena: arenaFor(2) }), true);
});

test("holding right reaches the wall first and scores once", () => {
  const game = build(2, { arena: { w: 200, h: 100 } }, seededRng(3));
  game.startRound();
  game.x = [10, 10];
  while (!game.roundOver) game.step([{ move: 1 }, { move: 0 }]);
  assert.deepEqual(game.scores, [1, 0]);
  assert.equal(game.tick, 32);
  assert.ok(!process.env.OPENAI_API_KEY && !process.env.GH_TOKEN, "no inherited secrets");
});

test("a winner needs the target and a clear lead", () => {
  const game = build(2, {}, seededRng(3));
  game.scores = [3, 3];
  assert.equal(game.winner(3), -1);
  game.scores = [4, 3];
  assert.equal(game.winner(3), 0);
});

test("a snapshot fits its budget at the player cap", () => {
  const schema = defineSnapshot(SNAPSHOT);
  const game = build(8, {}, seededRng(4));
  game.startRound();
  assert.ok(schema.encode(game.step(new Array(8).fill(0)), 8).byteLength <= schema.budgetBytes * 8);
});

test("the committed fixture replays to its recorded state", () => {
  const reached = replay(fs.readFileSync(fixtureUrl, "utf8"), build);
  assert.ok(reached.round >= 2);
});
"""

REFERENCE_MJS = """// The reference match behind test/replay.ndjson.
import { Simulation } from "../public/game.js";
import { arenaFor, record, seededRng } from "../../engine/engine.js";

export const SEED = 20260910;
export const PLAYERS = 3;
export const build = (n, opts, rng) => new Simulation(n, opts?.arena ? opts : { arena: arenaFor(n) }, rng);

export function playReference() {
  const game = build(PLAYERS, {}, seededRng(SEED));
  const session = record({ seed: SEED, tickHz: 30, players: PLAYERS });
  for (let round = 0; round < 2; round++) {
    session.round();
    game.startRound();
    for (let tick = 0; tick < 400 && !game.roundOver; tick++) {
      const intents = Array.from({ length: PLAYERS }, (_, seat) => ({ move: ((tick >> 4) + seat) % 3 - 1 }));
      session.tick(intents);
      game.step(intents);
    }
  }
  return session.finish(game);
}
"""


STYLE_CSS = """/* Fixture sprint: a cinder track under sodium lamps. */
:root { --track: #2b1d16; --lane: #f4e9d8; --lamp: #ff7a1a; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--track); color: var(--lane); font: 16px/1.5 Georgia, serif; }
h1 { color: var(--lamp); letter-spacing: 0.2em; text-transform: uppercase; }
[data-engine="arena"] { position: relative; max-width: 100%; border: 2px dashed var(--lane); }
[data-touch="on"] .touch { display: flex; }
"""


def page_html(scaffold_page, name="Fixture sprint"):
    """The scaffold's page as the model would leave it: own copy, touch buttons for its own intent."""
    return (scaffold_page.replace(cron.PLACEHOLDER_DESCRIPTION, "Hold right and reach the far wall first.")
            .replace(cron.PLACEHOLDER, name).replace('data-engine-stick="mx,my"', 'data-engine-stick="move,move"')
            .replace('data-engine-touch="boost=1"', 'data-engine-touch="move=1"')
            .replace("Create room", "Open a lane").replace("Start game", "Fire the pistol"))


def game_js(winner="winner", start="this.rng.range(10, 50)", fat=False):
    extra = range(30) if fat else ()
    return (GAME_JS.replace("__WINNER__", winner).replace("__START__", start)
            .replace("__EXTRA_VALUES__", "".join(f", f{i}: this.x" for i in extra))
            .replace("__EXTRA_FIELDS__", "".join(f'\n    f{i}: {{ type: "uint", bits: 32, per: "player" }},' for i in extra)))


def candidate():
    return {
        "name": "Fixture sprint", "description": "A fixture for the Pi coordinator.", "players": "2 to 8",
        "readme": "# Fixture sprint\n\n## Input\nOne `move` field.\n\n## Snapshot\nTick, over, and x per player.\n\n"
                  "## Round lifecycle\nA round ends at the far wall.\n",
        "game_js": game_js(), "client_js": CLIENT_JS, "test_mjs": TEST_MJS, "style_css": STYLE_CSS,
        "reference_mjs": REFERENCE_MJS}


def write_candidate(work, slug, env=None, **overrides):
    """Author the canned game over the scaffold the way the model would, fixture included."""
    c = {**candidate(), **overrides}
    game = work / slug
    (game / "README.md").write_text(c["readme"])
    (game / "public/game.js").write_text(c["game_js"])
    (game / "public/client.js").write_text(c["client_js"])
    (game / "public/style.css").write_text(c["style_css"])
    (game / "public/index.html").write_text(c.get("page_html") or page_html((game / "public/index.html").read_text()))
    (game / "test/game.test.mjs").write_text(c["test_mjs"])
    (game / "test/reference.mjs").write_text(c["reference_mjs"])
    entry = json.loads((game / "game-entry.json").read_text())
    entry.update(name=c["name"], description=c["description"], players=c["players"])
    (game / "game-entry.json").write_text(json.dumps(entry))
    environment = {**(env or {"PATH": os.environ.get("PATH", "/bin:/usr/bin")}), "RECORD": "1"}
    previous = os.getcwd()
    try:
        os.chdir(game)
        # A broken candidate still records; the coordinator is what must reject it.
        subprocess.run([NODE, "test/game.test.mjs"], env=environment, check=False, capture_output=True)
    finally:
        os.chdir(previous)
    return c
