"""Keep each persistent attempt separate, including failed attempts."""

from contextlib import contextmanager
import json
from pathlib import Path
import tempfile


@contextmanager
def run_workspace(root, day):
    if not root:
        with tempfile.TemporaryDirectory(prefix="edge-daily-", ignore_cleanup_errors=True) as directory:
            yield Path(directory)
        return
    base = Path(root)
    if not base.is_dir():
        raise RuntimeError("Work root is missing; mount the volume before running: " + str(base))
    directory = Path(tempfile.mkdtemp(prefix=f"daily-{day}-", dir=base))
    status_path = directory / "status.json"

    def status(state):
        status_path.write_text(json.dumps({"date": day, "status": state}) + "\n")

    status("running")
    print("Run files: " + str(directory), flush=True)
    try:
        yield directory
    except BaseException:
        status("failed")
        raise
    else:
        status("completed")
