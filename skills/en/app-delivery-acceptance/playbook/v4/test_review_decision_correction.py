import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from decision_gate import validate
from review_decision_correction import completed_review, correction_input, recover_parked_review
from scene_pipeline import run_independent_review


def save(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class ReviewDecisionCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "checkout"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=Test", "-c",
                        "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base"], check=True)
        self.revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        self.test_file = self.root / "tests/test_example.py"
        self.test_file.parent.mkdir()
        self.test_file.write_text("# frozen candidate\n")
        self.output = self.base / "run"
        self.output.mkdir()
        self.log = self.output / "execution.log"
        self.log.write_text("one test passed, observation retained\n")
        self.receipt = self.output / "execution.json"
        save(self.receipt, {"exit_code": 0, "head_before": self.revision, "head_after": self.revision,
             "log_sha256": sha(self.log), "test_file_sha256_after": {"tests/test_example.py": sha(self.test_file)}})
        self.input = self.output / "review-input.json"
        save(self.input, {"scene": {"id": "S-1"}, "frozen_execution_receipt": str(self.receipt)})
        save(self.output / "catalog.json", {"project_root": str(self.root), "revision": self.revision})
        self.review = self.output / "review"
        self.answer = {"status": "product_bug", "coverage": "assertion gap", "oracle": "independent requirement",
                       "evidence": "frozen observed text", "summary": "must strengthen assertions",
                       "findings": [{"kind": "product", "reason": "observed classification conflict", "requested_change": "fix classification"},
                                    {"kind": "case_code", "reason": "missing semantic assertion", "requested_change": "assert classification"}]}
        self.write_review(self.review, self.input, self.answer)
        self.original_hashes = {p.name: sha(p) for p in self.review.iterdir()}
        self.state = {"stages": {"review": {"status": "parked", "error":
                      "independent review structure invalid: product BUG needs failed execution and product finding"}}}

    def write_review(self, directory, input_path, answer):
        directory.mkdir(exist_ok=True)
        save(directory / "input.json", json.loads(Path(input_path).read_text()))
        save(directory / "answer.json", answer)
        save(directory / "metrics.json", {"status": "success", "seconds": 1})
        events = [{"type": "init", "sessionId": "read-only-review"},
                  {"type": "text", "payload": {"content": json.dumps(answer)}},
                  {"type": "done", "payload": {"status": "success"}}]
        (directory / "agent.jsonl").write_text("\n".join(json.dumps(e) for e in events))
        save(directory / "decision-gate.json", validate(answer, json.loads(Path(input_path).read_text())))

    def repaired_answer(self):
        return {**self.answer, "status": "repair_required"}

    def fake_runner(self, answer):
        def run(command, **kwargs):
            self.write_review(Path(command[4]), Path(command[3]), answer)
            return {"exit_code": 0}
        return run

    def test_public_recovery_then_one_read_only_correction_preserves_original(self):
        recover_parked_review({}, self.output, self.state, save)
        self.assertEqual(self.state["stages"]["review"]["status"], "retry_ready")
        with patch("scene_pipeline.run", side_effect=self.fake_runner(self.repaired_answer())) as run:
            result = run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
        self.assertEqual(run.call_count, 1)
        self.assertEqual(result["status"], "repair_required")
        self.assertIn("decision-correction-1", result["answer"])
        self.assertEqual(self.original_hashes, {p.name: sha(p) for p in self.review.iterdir()})
        self.assertEqual(json.loads(self.receipt.read_text())["exit_code"], 0)

    def test_invalid_correction_exhausts_budget_without_reopening_agents(self):
        with patch("scene_pipeline.run", side_effect=self.fake_runner(self.answer)) as run:
            with self.assertRaisesRegex(RuntimeError, "bounded limit"):
                run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
            self.assertEqual(run.call_count, 1)
            with self.assertRaisesRegex(RuntimeError, "bounded limit"):
                run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
            self.assertEqual(run.call_count, 1)

    def test_correction_cannot_drop_findings_to_claim_pass(self):
        passed = {**self.answer, "status": "passed", "findings": []}
        with patch("scene_pipeline.run", side_effect=self.fake_runner(passed)) as run:
            with self.assertRaisesRegex(RuntimeError, "retain every original finding"):
                run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
            with self.assertRaisesRegex(RuntimeError, "bounded limit"):
                run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
            self.assertEqual(run.call_count, 1)

    def test_completed_review_without_gate_recovers_from_session_evidence(self):
        (self.review / "decision-gate.json").unlink()
        result, gate = completed_review(self.review, self.input)
        self.assertEqual(gate["status"], "invalid")
        self.assertEqual(json.loads((self.review / "decision-gate.json").read_text()), gate)
        save(self.review / "decision-gate.json", {"status": "valid"})
        with self.assertRaisesRegex(RuntimeError, "gate changed"):
            completed_review(self.review, self.input)

    def test_completed_correction_after_interruption_is_adopted_without_replay(self):
        gate = completed_review(self.review, self.input)[1]
        bound = correction_input(self.review, self.input, gate)
        correction = self.output / "review-decision-correction-1"
        self.write_review(correction, bound, self.repaired_answer())
        self.state["stages"]["review"] = {"status": "running"}
        recover_parked_review({}, self.output, self.state, save)
        with patch("scene_pipeline.run") as run:
            result = run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
        run.assert_not_called()
        self.assertEqual(result["status"], "repair_required")
        self.assertEqual(self.state["recovery_history"][-1]["action"], "resume_review_correction")

    def test_interrupted_correction_keeps_original_session_for_resume(self):
        gate = completed_review(self.review, self.input)[1]
        bound = correction_input(self.review, self.input, gate)
        correction = self.output / "review-decision-correction-1"
        correction.mkdir()
        save(correction / "input.json", json.loads(bound.read_text()))
        (correction / "agent.jsonl").write_text(json.dumps({"type": "init", "sessionId": "same-session"}))
        self.state["stages"]["review"] = {"status": "running"}
        recover_parked_review({}, self.output, self.state, save)
        with patch("scene_pipeline.run", side_effect=self.fake_runner(self.repaired_answer())) as run:
            result = run_independent_review(self.root, self.input, self.review, self.output / "review-stage.log")
        self.assertIn("--resume", run.call_args.args[0])
        self.assertEqual(result["status"], "repair_required")

    def test_changed_frozen_tests_stop_recovery(self):
        self.test_file.write_text("# changed\n")
        with self.assertRaisesRegex(ValueError, "test file changed"):
            recover_parked_review({}, self.output, self.state, save)
        self.assertEqual(self.state["stages"]["review"]["status"], "parked")

    def test_changed_answer_or_input_cannot_be_adopted(self):
        save(self.review / "answer.json", self.repaired_answer())
        with self.assertRaisesRegex(RuntimeError, "differs from session"):
            completed_review(self.review, self.input)
        save(self.review / "answer.json", self.answer)
        save(self.input, {"frozen_execution_receipt": str(self.receipt), "scene": {"id": "other"}})
        with self.assertRaisesRegex(RuntimeError, "input changed"):
            completed_review(self.review, self.input)

    def test_live_reviewer_stops_recovery(self):
        (self.review / "runner.pid").write_text(str(os.getpid()))
        with self.assertRaisesRegex(RuntimeError, "still alive"):
            recover_parked_review({}, self.output, self.state, save)

    def test_unrelated_parked_failure_is_not_retried(self):
        self.state["stages"]["review"]["error"] = "review Agent incomplete"
        recover_parked_review({}, self.output, self.state, save)
        self.assertEqual(self.state["stages"]["review"]["status"], "parked")


if __name__ == "__main__":
    unittest.main()
