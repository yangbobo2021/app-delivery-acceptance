import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from reconcile_pipeline import reconcile, recover_interrupted_agent


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

    def interrupted_agent(self):
        self.state["stages"]["review-repair-1"] = {"status": "parked", "error": "review repair Agent incomplete: transport error"}
        events = [{"type": "init", "sessionId": "saved-session"},
                  {"type": "error", "payload": {"message": "model at capacity"}},
                  {"type": "done", "payload": {"status": "error"}}]
        (self.repair / "agent.jsonl").write_text("\n".join(json.dumps(e) for e in events))
        (self.repair / "metrics.json").write_text(json.dumps({"status": "error"}))

    def test_transport_interruption_resumes_saved_session_once(self):
        self.interrupted_agent()
        event = recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(event["session_id"], "saved-session")
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "resume_ready")
        self.assertEqual(self.state["stages"]["review-repair-1"]["agent_interruption_resumes"], 1)
        self.state["stages"]["review-repair-1"]["status"] = "parked"
        self.assertIsNone(recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save))

    def test_completed_case_failure_is_not_transport_interruption(self):
        self.interrupted_agent()
        events = [{"type": "init", "sessionId": "saved-session"},
                  {"type": "done", "payload": {"status": "success"}}]
        (self.repair / "agent.jsonl").write_text("\n".join(json.dumps(e) for e in events))
        self.assertIsNone(recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save))
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "parked")

    def test_continuation_budget_survives_a_second_stage_failure(self):
        from scene_pipeline import stage
        self.interrupted_agent()
        recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save)
        def fails_again():
            raise RuntimeError("review repair Agent incomplete: second interruption")
        with self.assertRaisesRegex(RuntimeError, "second interruption"):
            stage(self.output / "state.json", self.state, "review-repair-1", fails_again)
        self.assertEqual(self.state["stages"]["review-repair-1"]["agent_interruption_resumes"], 1)
        self.assertIsNone(recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save))

    def test_live_local_debug_child_prevents_transport_resume(self):
        import os
        self.interrupted_agent()
        intent = self.repair / "debug/manual-run/execution/execution-intent.json"
        intent.parent.mkdir(parents=True)
        intent.write_text(json.dumps({"child_pid": os.getpid()}))
        with self.assertRaisesRegex(RuntimeError, "debug child is still alive"):
            recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "parked")

    def test_read_only_reviewer_requires_unchanged_frozen_tests(self):
        self.interrupted_agent()
        review = self.output / "review"
        review.mkdir()
        for name in ("agent.jsonl", "metrics.json"):
            (review / name).write_bytes((self.repair / name).read_bytes())
        log = self.output / "execution.log"
        log.write_text("frozen execution\n")
        receipt = self.output / "execution.json"
        receipt.write_text(json.dumps({"head_before": self.revision, "head_after": self.revision,
            "log_sha256": sha(log), "test_file_sha256_after": {"tests/test_app.py": sha(self.root / "tests/test_app.py")}}))
        (self.output / "review-input.json").write_text(json.dumps({"frozen_execution_receipt": str(receipt)}))
        (review / "input.json").write_bytes((self.output / "review-input.json").read_bytes())
        self.state = {"stages": {"review": {"status": "parked", "error": "review Agent incomplete: transport error"}}}
        (self.root / "tests/test_app.py").write_text("changed after execution\n")
        self.catalog["project_root"] = str(self.root.resolve())
        with self.assertRaisesRegex(ValueError, "test file changed"):
            recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(self.state["stages"]["review"]["status"], "parked")

    def test_changed_binding_keeps_interrupted_agent_parked(self):
        self.interrupted_agent()
        (self.base / "feedback.json").write_text('{"changed":true}')
        with self.assertRaisesRegex(RuntimeError, "input or scope changed"):
            recover_interrupted_agent(self.config, self.output, self.state, self.catalog, self.save)
        self.assertEqual(self.state["stages"]["review-repair-1"]["status"], "parked")


if __name__ == "__main__":
    unittest.main()
