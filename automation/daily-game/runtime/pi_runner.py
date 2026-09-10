"""Stream Pi activity through the parent process without buffering a whole run."""

import json
import os
from pathlib import Path
import subprocess


def run_pi(work, env, system, prompt, model, seconds=1800):
    control = Path(env["TMPDIR"]) / "pi-control"
    control.mkdir(exist_ok=True)
    input_path = control / "input.txt"
    report_path = control / "report.json"
    input_path.write_text(prompt)
    report_path.unlink(missing_ok=True)
    previous = os.getcwd()
    try:
        os.chdir(work)
        result = subprocess.run(["/bin/node", "/app/run_pi.mjs", str(report_path),
                                 str(system), str(input_path), model, str(seconds)],
                                env=env, timeout=seconds + 60, check=False)
    finally:
        os.chdir(previous)
    if result.returncode != 0 or not report_path.is_file():
        raise RuntimeError("Pi failed; see the live output above")
    report = json.loads(report_path.read_text())
    if not report.get("ok") or report.get("successfulBashCalls", 0) == 0:
        raise RuntimeError("Pi did not complete with a successful Bash tool invocation")
    return report
