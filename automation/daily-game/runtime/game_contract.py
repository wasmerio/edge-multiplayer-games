"""Assemble and validate the multiplayer game file contract."""

from html.parser import HTMLParser
import json
from pathlib import Path
import re
from github import require

CATALOG = "automation/daily-game/catalog.json"
REFERENCE = ("AGENTS.md", "public/games.json", "achtung/package.json",
             "achtung/package-lock.json", "achtung/src/server.js",
             "achtung/public/game.js", "achtung/public/client.js",
             "achtung/public/index.html", "achtung/public/style.css")
SPLIT = "function applyMessage(msg) {"
PENDING = ("\n\n## Automated check status\n\n"
           "The Wasmer job ran JavaScript syntax, Game interface, and simulation scenario checks.\n"
           "Two-browser gameplay, invite behavior, and production deployment remain pending.\n"
           "The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.\n"
           "Complete the repository AGENTS.md checklist before calling this game done.\n")


def json_text(value):
    return json.dumps(value, indent=2) + "\n"


class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.ids = set()
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.ids.update(value for key, value in attrs if key == "id")


def assemble(candidate, context):
    refs, slug = context["files"], context["slug"]
    require(0 < len(candidate["name"]) <= 80 and "\n" not in candidate["name"], "Invalid game name")
    require(0 < len(candidate["description"]) <= 300, "Invalid game description")
    require(not any(game["name"].casefold() == candidate["name"].casefold()
                    for game in context["existing_games"]), "Game name already exists")
    require(candidate["client_tail"].lstrip().startswith(SPLIT), "Client tail must start with applyMessage")
    prefix, separator, _ = refs["achtung/public/client.js"].partition(SPLIT)
    require(bool(separator), "Reference client boundary changed")
    client = prefix + candidate["client_tail"].lstrip()
    ids = Elements(candidate["index_html"]).ids
    required_ids = set(re.findall(r'\$\([\'"]([^\'"]+)[\'"]\)', client))
    require(required_ids <= ids, "Missing client element IDs: " + ", ".join(sorted(required_ids - ids)))
    require("https://edge-multiplayer-games.wasmer.app" in candidate["index_html"], "Missing superapp link")
    require(all(section in candidate["readme"].lower()
                for section in ("input", "snapshot", "round lifecycle")), "README contract sections are missing")
    pkg = json.loads(refs["achtung/package.json"])
    pkg.update(name=slug, description=candidate["description"])
    pkg["scripts"] = {"start": "node src/server.js", "test": "node test/run.mjs"}
    lock = json.loads(refs["achtung/package-lock.json"])
    lock["name"] = slug
    lock["packages"][""]["name"] = slug
    entry = {"slug": slug, "name": candidate["name"], "description": candidate["description"],
             "players": "2 to 8", "source": slug + "/"}
    files = {"README.md": candidate["readme"] + PENDING,
             "package.json": json_text(pkg), "package-lock.json": json_text(lock),
             "app.yaml": json_text({"kind": "wasmer.io/App.v0", "name": slug, "owner": "wasmer",
                                     "package": ".", "locality": {"regions": ["fr-roub1"]}}),
             ".gitignore": "node_modules/\n.anybuild/\n.shipit/\n",
             "src/server.js": refs["achtung/src/server.js"], "public/game.js": candidate["game_js"],
             "public/client.js": client, "public/index.html": candidate["index_html"],
             "public/style.css": candidate["style_css"], "test/scenarios.js": candidate["scenarios_js"],
             "test/run.mjs": Path(__file__).with_name("run.mjs").read_text(),
             "game-entry.json": json_text(entry)}
    require(all(isinstance(value, str) and "\x00" not in value and len(value) <= 500000
                for value in files.values()), "Invalid source content")
    return files, entry
