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
PLACEHOLDER = "Weekly game"
PLACEHOLDER_DESCRIPTION = "A weekly multiplayer game on the Wasmer Edge game engine."
# The model authors these and anything under test/; every other scaffold file is the coordinator's.
AUTHORED = ("README.md", "public/game.js", "public/client.js", "public/index.html", "public/style.css",
            "game-entry.json")
MUST_CHANGE = ("public/game.js", "public/client.js")
PAGE = "public/index.html"
STYLE = "public/style.css"
# The roles the engine binds in a page that owns its chrome; the invite link carries the sub-app contract.
REQUIRED_ROLES = ("arena", "name", "create", "code", "join", "start", "invite-link")
MODULE_SCRIPT = '<script type="module" src="/client.js"></script>'
STYLE_LINK = '<link rel="stylesheet" href="/style.css">'
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


def verify_page(page, scaffold_page, version):
    """The page is the model's; the engine pin, the entry script, the roles and the way home are not."""
    pinned = import_map(page)
    require(pinned is not None and pinned == import_map(scaffold_page), "Engine import map differs from the scaffold")
    require(f'"{engine_pin(version)}"' in pinned,
            f"Engine pin is not {engine_pin(version)}; the generator ran against engine {version}")
    markup = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    require(PLACEHOLDER not in markup and PLACEHOLDER_DESCRIPTION not in markup,
            "Page still carries the scaffold's placeholder copy")
    require(markup.count(MODULE_SCRIPT) == 1, "Page does not load /client.js as its one module script")
    require(len(re.findall(r"<script\b", markup)) == 2, "Page has a script besides the import map and /client.js")
    require(markup.count(STYLE_LINK) == 1, "Page does not link /style.css")
    require(re.search(r'<a\b[^>]*\bhref="' + re.escape(SUPERAPP) + r'/?"', markup) is not None,
            "Page has no link back to " + SUPERAPP)
    roles = re.findall(r'\bdata-engine="([^"]*)"', markup)
    missing = [role for role in REQUIRED_ROLES if role not in roles]
    require(not missing, "Page is missing data-engine role: " + ", ".join(missing))
    repeated = sorted({role for role in roles if roles.count(role) > 1})
    require(not repeated, "Page repeats data-engine role: " + ", ".join(repeated))


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

    verify_page(candidate[PAGE].decode(), scaffold[PAGE].decode(), version)
    for path in MUST_CHANGE:
        require(candidate[path] != scaffold[path], "Scaffold placeholder was not replaced: " + path)
    require(STYLE in candidate and candidate[STYLE].strip(), "Stylesheet is missing or empty: " + STYLE)
    require(candidate[STYLE] != scaffold.get(STYLE),
            "Stylesheet is the scaffold's default theme: " + STYLE + "; the game needs its own visual identity")
    require(candidate[PAGE] != scaffold[PAGE], "Scaffold placeholder was not replaced: " + PAGE)

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
