import json
from pathlib import Path
import tempfile
import unittest

from workspace import run_workspace


class WorkspaceTests(unittest.TestCase):
    def test_failed_attempt_survives_and_retry_is_separate(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, "agent stopped"):
                with run_workspace(root, "2026-09-09") as failed:
                    (failed / "candidate.js").write_text("partial source")
                    raise RuntimeError("agent stopped")
            self.assertEqual((failed / "candidate.js").read_text(), "partial source")
            self.assertEqual(json.loads((failed / "status.json").read_text())["status"], "failed")
            with run_workspace(root, "2026-09-09") as retry:
                self.assertNotEqual(failed, retry)
            self.assertEqual(json.loads((retry / "status.json").read_text())["status"], "completed")
            self.assertTrue(failed.is_dir())

    def test_missing_volume_fails_without_creating_directory(self):
        with tempfile.TemporaryDirectory() as root:
            missing = Path(root) / "missing"
            with self.assertRaisesRegex(RuntimeError, "mount the volume"):
                with run_workspace(missing, "2026-09-09"):
                    self.fail("Missing work root was accepted")
            self.assertFalse(missing.exists())

    def test_default_workspace_is_still_temporary(self):
        with run_workspace(None, "2026-09-09") as directory:
            self.assertTrue(directory.is_dir())
        self.assertFalse(directory.exists())
