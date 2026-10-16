import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from reconcile_pipeline import reconcile


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class NestedRepairRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "checkout"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Test"], check=True)
        (self.root / "src").mkdir()
        (self.root / "src/app.py").write_text("value = 1\n")
        subprocess.run(["git", "-C", str(self.root), "add", "src/app.py"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "base"], check=True)
        self.revision = subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"], text=True).strip()
        (self.root / "tests").mkdir()
        (self.root / "tests/test_app.py").write_text("assert 1 == 1\n")
        self.output = self.base / "run"
        self.repair = self.output / "review-repair-1"
        self.repair.mkdir(parents=True)
        evidence = self.base / "feedback.json"
        evidence.write_text("{}\n")
        (self.repair / "binding.json").write_text(json.dumps([{"path": str(evidence), "sha256": sha(evidence)}]))
        self.catalog = {"project_root": str(self.root), "revision": self.revision, "test_roots": ["tests"]}
        self.state = {"stages": {"review-repair-1": {"status": "running"}}}
        self.case_input = self.base / "case-input.json"
        self.case_input.write_text(json.dumps({"local_loopback_required": False}))
        self.config = {"case_input": str(self.case_input)}

    def save(self, path, obj):
        Path(path).write_text(json.dumps(obj))

    def test_interrupted_test_edit_resumes_same_session(self):
        (self.repair / "agent.jsonl").write_text(json.dumps({"type": "init", "sessionId": "session-1"}) + "\n")
        event = reconcile(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(event["action"], "resume_session")
        self.assertEqual(event["test_file_sha256_at_recovery"]["tests/test_app.py"], sha(self.root / "tests/test_app.py"))
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "resume_ready")

    def test_missing_session_stops_without_changing_test(self):
        file = self.root / "tests/test_app.py"
        before = sha(file)
        (self.repair / "agent.jsonl").write_text(json.dumps({"type": "tool_use"}) + "\n")
        with self.assertRaisesRegex(RuntimeError, "no saved session"):
            reconcile(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(sha(file), before)
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "running")

    def test_product_source_change_stops_recovery(self):
        (self.root / "src/app.py").write_text("value = 2\n")
        (self.repair / "agent.jsonl").write_text(json.dumps({"type": "init", "sessionId": "session-1"}) + "\n")
        with self.assertRaisesRegex(RuntimeError, "unbound or missing file"):
            reconcile(self.config, self.output, self.state, self.catalog, self.save)

    def test_uncertain_local_service_effect_stops_resume(self):
        self.case_input.write_text(json.dumps({"local_loopback_required": True}))
        (self.repair / "agent.jsonl").write_text(json.dumps({"type": "init", "sessionId": "session-1"}) + "\n")
        with self.assertRaisesRegex(RuntimeError, "resume safety is not declared"):
            reconcile(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "running")


if __name__ == "__main__":
    unittest.main()
