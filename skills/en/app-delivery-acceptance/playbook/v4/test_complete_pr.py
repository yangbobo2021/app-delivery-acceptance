import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from run_plan import slug


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class PRCompletionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        project = self.base / "project"
        project.mkdir()
        subprocess.run(["git", "init", "-q", str(project)], check=True)
        subprocess.run(["git", "-C", str(project), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(project), "config", "user.name", "Test"], check=True)
        (project / "app.py").write_text("value=1\n")
        subprocess.run(["git", "-C", str(project), "add", "app.py"], check=True)
        subprocess.run(["git", "-C", str(project), "commit", "-qm", "base"], check=True)
        head = subprocess.check_output(["git", "-C", str(project), "rev-parse", "HEAD"], text=True).strip()
        self.targets = self.base / "targets.json"
        save(self.targets, {"schema": "pr-targets-v1", "targets": [{"key": "BLACK_BOX:R1", "id": "R1"}],
                            "head_revision": head, "change_sha256": "frozen-reverse", "unresolved": []})
        request = {"scenario_kind": "BLACK_BOX", "target_requirement_id": "R1",
                   "project_root": str(project), "requirements": {"items": [{"id": "R1", "text": "x"}]},
                   "analysis": {"business_goal": "x", "confirmed_scope": {}, "requirement_groups": []},
                   "user_constraints": [], "pr_reviewed_reverse_sha256": "frozen-reverse"}
        self.request = self.base / "scenario-request.json"
        save(self.request, request)
        self.run = self.base / "run"
        self.plan = self.base / "plan.json"
        save(self.plan, {"schema": "acceptance-v4-plan-v1", "run_dir": str(self.run),
                         "scenario_requests": [str(self.request)],
                         "case_template": {"source_checkout": str(project)}})
        stem = f"000-{slug('R1')}"
        scenario_dir = self.run / "scenarios" / stem
        frozen = scenario_dir / "request.frozen.json"
        save(frozen, request)
        scene = {"id": "R1-S1", "requirement_id": "R1", "kind": "BLACK_BOX", "title": "x"}
        scenes = scenario_dir / "scenarios.current.json"
        save(scenes, {"scenarios": [scene]})
        save(scenario_dir / "draft-gate.json", {"status": "ready"})
        save(scenario_dir / "terminal.json", {"final_state": "done", "request_sha256": sha(frozen),
                                               "scenarios_sha256": sha(scenes)})
        scene_key = f"{stem}-{slug('R1-S1')}"
        case_dir = self.run / "cases" / scene_key
        save(self.run / "handoffs" / scene_key / "case-input.json",
             {"scene": scene, "scenario_source_sha256": sha(scenes)})
        save(case_dir / "state.json", {"stages": {"execution": {"status": "completed"},
                                                       "review": {"status": "completed"}}})
        save(case_dir / "summary.json", {"scene_id": "R1-S1", "review_status": "passed"})
        receipt = case_dir / "execution" / "execution.json"
        save(receipt, {"head_before": head, "head_after": head, "exit_code": 0})
        save(case_dir / "review" / "answer.json", {"status": "passed"})
        save(case_dir / "review" / "decision-gate.json",
             {"status": "valid", "review_status": "passed", "execution_exit_code": 0})
        save(case_dir / "review-input.json", {"frozen_execution_receipt": str(receipt)})
        save(case_dir / "handoff-gate.json", {"status": "ready_for_review", "receipt_sha256": sha(receipt)})

    def invoke(self):
        output = self.base / "pr-result.json"
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("complete_pr.py")),
                                 str(self.targets), str(self.plan), str(output)],
                                capture_output=True, text=True)
        return result, json.loads(output.read_text())

    def test_all_targets_and_scenes_pass(self):
        process, result = self.invoke()
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(result["results"]), 1)

    def test_unresolved_behavior_blocks_pr_pass(self):
        data = json.loads(self.targets.read_text())
        data["unresolved"] = [{"id": "B1", "reason": "contract unknown"}]
        save(self.targets, data)
        process, result = self.invoke()
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(result["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
