import json
from pathlib import Path
import re
import urllib.request

root = "https://api.github.com/repos/wasmerio/edge-multiplayer-games"
def get(path):
    request = urllib.request.Request(root + path, headers={"User-Agent": "wasmer-daily-game-verification", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

record = json.loads(Path("/output/daily-2026-09-10.json").read_text())
pulls = get("/pulls?state=open&head=wasmerio%3Adaily-game%2F2026-09-10&base=main")
assert len(pulls) == 1, "Expected exactly one open PR"
pr = pulls[0]
assert pr["draft"] and pr["base"]["ref"] == "main"
assert pr["head"]["ref"] == "daily-game/2026-09-10"
expected = {}
for section in Path("/output/daily-2026-09-10.patch").read_text().split("diff --git ")[1:]:
    path = section.splitlines()[0].split(" b/", 1)[1]
    expected[path] = re.search(r"^index [0-9a-f]+\.\.([0-9a-f]+)", section, re.M)[1]
files = get(f"/pulls/{pr['number']}/files?per_page=100")
assert {file["filename"] for file in files} == set(expected), "PR file list differs from saved patch"
assert all(file["sha"].startswith(expected[file["filename"]]) for file in files), "PR file blobs differ from saved patch"
commit = get("/commits/" + pr["head"]["sha"])
assert [p["sha"] for p in commit["parents"]] == [record["base_sha"]], "Unexpected commit parent"
result = {"url": pr["html_url"], "draft": pr["draft"], "base": pr["base"]["ref"],
          "head": pr["head"]["ref"], "commit": pr["head"]["sha"], "files": len(files),
          "matches_saved_pi_patch": True, "game_checks": record["checks"]}
Path("/output/pr-verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
