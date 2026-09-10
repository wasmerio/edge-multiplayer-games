"""Generate, check, and commit a new game from the Edge cron instance."""

import datetime
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error

from generator import Generator
from github import GitHub, require

CATALOG = "automation/daily-game/catalog.json"
REFERENCE = ("AGENTS.md", "public/games.json", "achtung/package.json",
             "achtung/package-lock.json", "achtung/src/server.js",
             "achtung/public/game.js", "achtung/public/client.js",
             "achtung/public/index.html", "achtung/public/style.css")
SPLIT = "function applyMessage(msg) {"
PENDING = ("\n\n## Automated check status\n\n"
           "The Edge cron job ran JavaScript syntax, Game interface, and simulation scenario checks.\n"
           "Two-browser gameplay, invite behavior, production deployment, and catalog registration remain pending.\n"
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


def headless_check(files, command=None):
    command = command or os.environ.get("JS_COMMAND", "/bin/node")
    with tempfile.TemporaryDirectory(prefix="daily-game-") as directory:
        for relative, content in files.items():
            file = Path(directory, relative)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        # Model code receives no API credentials or inherited shell configuration.
        env = {"PATH": "/bin:/usr/bin", "TMPDIR": directory}
        commands = [[command, "--check", "public/client.js"],
                    [command, "test/run.mjs"]]
        result = None
        for args in commands:
            try:
                result = subprocess.run(args, cwd=directory, env=env, capture_output=True,
                                        text=True, timeout=30, check=False)
            except (OSError, subprocess.TimeoutExpired):
                raise RuntimeError("JavaScript runtime could not complete the headless checks") from None
            require(result.returncode == 0, "Headless check failed: " + (result.stderr or result.stdout)[-4000:])
        report = json.loads(result.stdout.strip().splitlines()[-1])
        require(report.get("ok") is True and report.get("interface") is True
                and len(report.get("scenarios", [])) >= 2, "Invalid headless check report")
        return report


def commit_game(gh, files, entry, context, report, response_id):
    base, day, slug = context["base_sha"], context["date"], context["slug"]
    require(gh.request("/git/ref/heads/main")["object"]["sha"] == base,
            "Main changed during generation. No commit was pushed.")
    additions = {slug + "/" + relative: content for relative, content in files.items()}
    additions[".ignore"] = context["ignore"].rstrip() + "\n/" + slug + "/\n"
    record = {**entry, "date": day, "base_sha": base, "response_id": response_id,
              "checks": report, "status": "source-checked", "browser_checks": "pending", "deployment": "pending"}
    additions[CATALOG] = json_text(context["generated_games"] + [record])
    additions[f"automation/daily-game/runs/{day}.json"] = json_text(record)
    tree_base = gh.request("/git/commits/" + base)["tree"]["sha"]
    tree = gh.request("/git/trees", {"base_tree": tree_base, "tree": [
        {"path": path, "mode": "100644", "type": "blob", "content": content}
        for path, content in additions.items()]})
    commit = gh.request("/git/commits", {
        "message": f"Add daily multiplayer game for {day}: {entry['name']}",
        "tree": tree["sha"], "parents": [base]})
    gh.request("/git/refs/heads/main", {"sha": commit["sha"], "force": False}, "PATCH")
    return commit["sha"]


def run(gh, generator, day, check=headless_check):
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", day), "Invalid date")
    datetime.date.fromisoformat(day)
    base = gh.request("/git/ref/heads/main")["object"]["sha"]
    if gh.file(f"automation/daily-game/runs/{day}.json", base) is not None:
        print(f"{day}: already committed", flush=True)
        return
    slug = "daily-" + day
    require(gh.file(slug + "/package.json", base) is None, "Game directory already exists")
    refs = {path: gh.file(path, base) for path in REFERENCE}
    require(all(isinstance(content, str) for content in refs.values()), "Required reference files are missing")
    generated = json.loads(gh.file(CATALOG, base) or "[]")
    context = {"date": day, "slug": slug, "base_sha": base, "files": refs,
               "ignore": gh.file(".ignore", base), "generated_games": generated,
               "existing_games": json.loads(refs["public/games.json"]) + generated}
    require(isinstance(context["ignore"], str), "Root upload filter is missing")
    # Atomic claim prevents overlapping invocations from spending twice for one date.
    gh.request("/git/refs", {"ref": f"refs/tags/daily-game-claims/{day}", "sha": base})
    previous, failure = None, None
    for attempt in range(3):
        print(f"{day}: generation attempt {attempt + 1}", flush=True)
        previous, response_id = generator.generate(context, previous, failure)
        try:
            files, entry = assemble(previous, context)
            report = check(files)
        except (ValueError, KeyError) as error:
            failure = str(error)[:4000]
            continue
        sha = commit_game(gh, files, entry, context, report, response_id)
        print(f"{day}: generated on Edge and committed {sha} to main", flush=True)
        return sha
    raise ValueError("Generated game failed checks after three attempts. Main was not changed.")


if __name__ == "__main__":
    try:
        run(GitHub(os.environ.get("GITHUB_REPOSITORY", "wasmerio/edge-multiplayer-games"),
                   os.environ.get("GITHUB_TOKEN", "")),
            Generator(os.environ.get("OPENAI_API_KEY", ""), os.environ.get("OPENAI_MODEL", "")),
            datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"API request failed: HTTP {error.code}") from None
    except urllib.error.URLError:
        raise SystemExit("API network request failed") from None
    except (ValueError, RuntimeError, TimeoutError):
        raise SystemExit("Daily generation failed. No successful commit was reported.") from None
