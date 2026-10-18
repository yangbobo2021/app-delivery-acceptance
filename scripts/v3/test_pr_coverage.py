"""Behavioral checks for PR inventory and switchable coverage denominators."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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

    def test_three_scopes_delegate_reports_and_inventory_to_dedicated_provider(self):
        inventory = {"schema": "change-inventory-v1", "changed_source_paths": ["app.py"],
                     "files": [{"path": "app.py", "changed_lines": [2, 3]}]}
        base = {"project": {"id": "p", "revision": "head", "sources": ["app.py", "other.py"]},
                "change": {"inventory": inventory}, "generated_at": "2026-10-15T01:00:00Z"}
        a = {**base, "scenarios": [{"id": "S1"}], "coverage": {
            "provider": "istanbul-source-v1", "istanbul_path": "/synthetic/a/istanbul.json"}}
        b = {**base, "scenarios": [{"id": "S2"}], "coverage": {
            "provider": "istanbul-source-v1", "istanbul_path": "/synthetic/b/istanbul.json"}}
        # Synthetic provider response: verify delegation and display, not coverage math.
        expected = {name: {"status": "measured", "line": {"covered": n, "total": d},
                          "branch": {"covered": 1, "total": 3}}
                    for name, n, d in [("project", 4, 5), ("changed_files", 3, 3), ("changed_lines", 2, 2)]}
        requests = []
        def provider(args, **kwargs):
            self.assertEqual(args[-3], 'summarize')
            requests.append(json.loads(Path(args[-2]).read_text()))
            Path(args[-1]).write_text(json.dumps({"scopes": expected, "tools": {
                "instrumenter": {"name": "fixture"}, "statistics": {"name": "fixture"}}}))
            return SimpleNamespace(returncode=0)
        with patch('coverage_views.subprocess.run', side_effect=provider):
            self.assertEqual(summarize([a, b])[0]["scopes"], expected)
            self.assertEqual(requests[-1], {"inventory": inventory, "reports": [
                "/synthetic/a/coverage-report.json", "/synthetic/b/coverage-report.json"]})
            b["coverage"] = {"status": "unavailable", "reason": "Missing report"}
            scopes = summarize([a, b])[0]["scopes"]
            self.assertEqual(requests[-1]["reports"], ["/synthetic/a/coverage-report.json"])
            for name, scope in scopes.items():
                self.assertEqual(scope["status"], "incomplete")
                self.assertEqual(scope["scenes_without_line_report"], 1)
                self.assertEqual(scope["line"]["covered"], expected[name]["line"]["covered"])
                self.assertEqual(scope["branch"]["covered"], expected[name]["branch"]["covered"])


if __name__ == "__main__":
    unittest.main()
