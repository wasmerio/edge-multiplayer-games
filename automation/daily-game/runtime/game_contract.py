"""Hold a generated engine game to the scaffold it started from."""

import json
import re
from github import require

CATALOG = "automation/daily-game/catalog.json"
CONTEXT = ("AGENTS.md", "public/games.json")
SCAFFOLD = "scripts/new-game.mjs"
CONFORMANCE = "scripts/conformance.mjs"
SYNC = "scripts/sync-engine.mjs"
ENGINE_PARAMS = "engine/params.js"
SUPERAPP = "https://edge-multiplayer-games.wasmer.app"
PLACEHOLDER = "Daily game"
PLACEHOLDER_DESCRIPTION = "A daily multiplayer game on the Wasmer Edge game engine."
# The model authors these and anything under test/; every other scaffold file is the coordinator's.
AUTHORED = ("README.md", "public/game.js", "public/client.js", "public/index.html", "game-entry.json")
MUST_CHANGE = ("public/game.js", "public/client.js")
FIXTURE = "test/replay.ndjson"
SIZE_LIMIT = 500000
PENDING = ("\n\n## Automated check status\n\n"
           "The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,\n"
           "the simulation tests, and the static conformance tier.\n"
           "The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.\n"
           "The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.\n"
           "Complete the repository AGENTS.md checklist before calling this game done.\n")


def json_text(value):
    return json.dumps(value, indent=2) + "\n"


def editable(path):
    return path in AUTHORED or path.startswith("test/")


def engine_version(params_source):
    found = re.search(r'ENGINE_VERSION *= *"([^"]+)"', params_source)
    require(bool(found), ENGINE_PARAMS + " does not declare ENGINE_VERSION")
    return found[1]


def engine_pin(version):
    return f"{SUPERAPP}/engine/{version}/"


def import_map(html):
    found = re.search(r'<script type="importmap">.*?</script>', html, re.S)
    return found[0] if found else None


def finish_readme(readme):
    return readme if readme.endswith(PENDING) else readme + PENDING


def verify(candidate, scaffold, context):
    """Return the catalog entry and the exact files to publish, as bytes by path."""
    slug, version = context["slug"], context["engine_version"]
    missing = sorted(set(scaffold) - set(candidate))
    require(not missing, "Scaffold file is missing: " + ", ".join(missing))
    extra = sorted(path for path in set(candidate) - set(scaffold) if not path.startswith("test/"))
    require(not extra, "Unexpected game file: " + ", ".join(extra))
    for path, content in sorted(candidate.items()):
        require(len(content) <= SIZE_LIMIT, "Game file exceeds size limit: " + path)
        require(b"\x00" not in content, "Invalid source content: " + path)
        if not editable(path):
            require(content == scaffold[path], "Coordinator-owned file differs from the scaffold: " + path)
    require(FIXTURE in candidate, "Fixture is missing: " + FIXTURE)

    page = candidate["public/index.html"].decode()
    pinned = import_map(page)
    require(pinned is not None and pinned == import_map(scaffold["public/index.html"].decode()),
            "Engine import map differs from the scaffold")
    require(f'"{engine_pin(version)}"' in pinned,
            f"Engine pin is not {engine_pin(version)}; the generator ran against engine {version}")
    for path in MUST_CHANGE:
        require(candidate[path] != scaffold[path], "Scaffold placeholder was not replaced: " + path)

    authored = json.loads(candidate["game-entry.json"])
    require(isinstance(authored, dict), "Invalid game-entry.json")
    name, description = authored.get("name"), authored.get("description")
    players = authored.get("players", "2 to 8")
    require(isinstance(name, str) and 0 < len(name) <= 80 and "\n" not in name
            and name != PLACEHOLDER, "Invalid game name")
    require(isinstance(description, str) and 0 < len(description) <= 300
            and description != PLACEHOLDER_DESCRIPTION, "Invalid game description")
    require(isinstance(players, str) and re.fullmatch(r"[1-8]( to [1-8])?", players), "Invalid player count")
    require(not any(game["name"].casefold() == name.casefold()
                    for game in context["existing_games"]), "Game name already exists")
    readme = candidate["README.md"].decode()
    require(all(section in readme.lower() for section in ("input", "snapshot", "round lifecycle")),
            "README contract sections are missing")

    entry = {"slug": slug, "name": name, "description": description,
             "players": players, "source": slug + "/"}
    files = dict(candidate)
    files["README.md"] = finish_readme(readme).encode()
    files["game-entry.json"] = json_text(entry).encode()
    return files, entry
