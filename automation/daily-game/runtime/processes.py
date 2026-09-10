"""Shared subprocess execution for the single-threaded WASIX coordinator."""

import os
from pathlib import Path
import subprocess


def execute(args, cwd, env, timeout=60, strip=True):
    operation = args[3] if len(args) > 3 and args[1:3] == ["-c", "core.hooksPath=/dev/null"] else args[1]
    print(f"RUN {Path(args[0]).name} {operation}", flush=True)
    previous = os.getcwd()
    try:
        os.chdir(cwd)
        result = subprocess.run(args, env=env, capture_output=True,
                                text=True, timeout=timeout, check=False)
    finally:
        os.chdir(previous)
    if result.returncode:
        detail = result.stderr.strip()
        for key, value in env.items():
            if value and any(word in key.upper() for word in ("KEY", "TOKEN", "SECRET", "PASSWORD")):
                detail = detail.replace(value, "[REDACTED]")
            if value.startswith("Authorization: Basic "):
                detail = detail.replace(value.removeprefix("Authorization: Basic "), "[REDACTED]")
        raise RuntimeError(f"{Path(args[0]).name} failed with exit code {result.returncode}: {detail[-4000:]}")
    return result.stdout.strip() if strip else result.stdout
