"""Keep the files checked by the job identical to the files it publishes."""

import hashlib
import os
from pathlib import Path
import stat

from github import require


def regular_file(root, name):
    path = root / name
    require(path.is_file() and not path.is_symlink()
            and path.resolve().is_relative_to(root.resolve())
            and not any(parent.is_symlink() for parent in path.parents if parent != root),
            "Missing or linked repository file: " + name)
    return path


def snapshot(root):
    result = {}
    for directory, dirs, names in os.walk(root, followlinks=False):
        if Path(directory) == root:
            dirs[:] = [name for name in dirs if name != ".git"]
        for name in names + [name for name in dirs if (Path(directory) / name).is_symlink()]:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            require(stat.S_ISREG(mode) or stat.S_ISLNK(mode), "Unsupported repository file: " + str(path))
            content = os.readlink(path).encode() if stat.S_ISLNK(mode) else path.read_bytes()
            result[str(path.relative_to(root))] = (mode, hashlib.sha256(content).hexdigest())
    return result


def assert_unchanged(root, before):
    after = snapshot(root)
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    require(not changed, "Game checks changed repository files: " + ", ".join(changed))


def stage_checked_files(git, expected):
    # Discard any index edits made by generated code before constructing the commit.
    git("read-tree", "HEAD")
    git("add", "--", *sorted(expected))
    entries = git("ls-files", "--stage", "-z", "--", *sorted(expected), raw=True)
    staged = {}
    for entry in entries.split("\0"):
        if not entry:
            continue
        metadata, name = entry.split("\t", 1)
        mode, oid, stage = metadata.split()
        require(stage == "0", "Unmerged file in the publication index: " + name)
        staged[name] = (mode, oid)
    require(staged.keys() == expected.keys(), "Publication index has missing files")
    for name, content in expected.items():
        oid = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        require(staged[name] == ("100644", oid), "Staged file differs from checked source: " + name)
