"""Behavioral checks for PR inventory and switchable coverage denominators."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from change_inventory import build
from coverage_views import summarize
from portable import parse_change_lines


class PrCoverageTest(unittest.TestCase):
    def test_inventory_and_executable_changed_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / "app.py").write_text("# old\nVALUE = 1\n")
            (root / "other.py").write_text("OTHER = 1\n")
            (root / "test_app.py").write_text("assert True\n")
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Pilot", "-c", "user.email=pilot@example.invalid",
                            "commit", "-qm", "base"], cwd=root, check=True)
            base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            (root / "app.py").write_text("# new\nVALUE = 2\n")
            (root / "test_app.py").write_text("assert 1 == 1\n")
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Pilot", "-c", "user.email=pilot@example.invalid",
                            "commit", "-qm", "change"], cwd=root, check=True)
            head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            request = {"project_root": str(root), "base_revision": base, "head_revision": head,
                       "requirements": {"items": [{"id": "R1"}]}, "pr_requirement_ids": ["R1"],
                       "test_modes": ["BLACK_BOX", "WHITE_BOX"],
                       "source_paths": ["app.py", "other.py"], "test_paths": ["test_app.py"]}
            inventory = build(request)
            self.assertEqual(inventory["target_revision"], base)
            self.assertEqual(inventory["changed_source_paths"], ["app.py"])
            self.assertEqual(inventory["unclassified_paths"], [])
            self.assertEqual(next(x for x in inventory["files"] if x["path"] == "app.py")["changed_lines"], [1, 2])
            report = root / "line.json"
            report.write_text(json.dumps({"files": {"app.py": {"executed_lines": [2], "missing_lines": []}}}))
            line_result = parse_change_lines(root, base, head, ["app.py"], report, "coveragepy-json")
            self.assertEqual(line_result["files"][0]["changed_lines"], [2])
            self.assertEqual(line_result["files"][0]["non_executable_changed_lines"], [1])

    def test_three_denominators_use_union_of_completed_attempts(self):
        inventory = {"schema": "change-inventory-v1", "changed_source_paths": ["app.py"],
                     "files": [{"path": "app.py", "changed_lines": [2, 3]}]}
        base = {"project": {"id": "p", "revision": "head", "sources": ["app.py", "other.py"]},
                "change": {"inventory": inventory}, "generated_at": "2026-10-15T01:00:00Z"}
        a = {**base, "scenarios": [{"id": "S1"}], "coverage": {"status": "measured", "line_files": [
            {"path": "app.py", "executable_lines": [1, 2, 3], "hit_lines": [1, 2]},
            {"path": "other.py", "executable_lines": [1, 2], "hit_lines": []}]}}
        b = {**base, "scenarios": [{"id": "S2"}], "coverage": {"status": "measured", "line_files": [
            {"path": "app.py", "executable_lines": [1, 2, 3], "hit_lines": [2, 3]},
            {"path": "other.py", "executable_lines": [1, 2], "hit_lines": [1]}]}}
        scopes = summarize([a, b])[0]["scopes"]
        self.assertEqual((scopes["project"]["covered"], scopes["project"]["total"]), (4, 5))
        self.assertEqual((scopes["changed_files"]["covered"], scopes["changed_files"]["total"]), (3, 3))
        self.assertEqual((scopes["changed_lines"]["covered"], scopes["changed_lines"]["total"]), (2, 2))
        b["coverage"]["line_files"] = [b["coverage"]["line_files"][0]]
        self.assertEqual(summarize([a, b])[0]["scopes"]["project"]["status"], "measured")
        a["coverage"]["line_files"] = [a["coverage"]["line_files"][0]]
        self.assertEqual(summarize([a, b])[0]["scopes"]["project"]["status"], "incomplete")
        self.assertEqual(summarize([a, b])[0]["scopes"]["changed_lines"]["status"], "measured")


if __name__ == "__main__":
    unittest.main()
