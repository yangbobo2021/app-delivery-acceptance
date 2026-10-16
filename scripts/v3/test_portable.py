"""Behavioral checks for the portable acceptance boundary."""
import json
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import portable
import coverage_views


class PortableAcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        self.out = Path(self.temp.name) / "attempt"
        (self.root / "app.py").write_text("VALUE = 1\n")
        (self.root / "check.py").write_text(
            "import json, sys\n"
            "print('CASE_OK')\n"
            "if len(sys.argv) > 1:\n"
            "  with open(sys.argv[1], 'w') as f:\n"
            "    json.dump({'files': {'app.py': {'lines': {'covered': 1, 'total': 2}, "
            "'branches': {'covered': 0, 'total': 1}}}}, f)\n"
        )
        self.manifest = {
            "schema": portable.SCHEMA,
            "project": {"id": "sample", "root": str(self.root), "revision_mode": "declared",
                        "revision": "artifact-1", "revision_provenance": "signed build label",
                        "sources": ["app.py"]},
            "requirements": [{"id": "R1", "text": "Value can be checked", "source": "spec"}],
            "scenarios": [{"id": "S1", "requirement_id": "R1", "title": "Check value",
                           "description": "Run a bounded check", "priority": "P1"}],
            "bindings": [{"id": "C1", "scenario_id": "S1", "kind": "automated", "title": "Check",
                          "test_file": "check.py", "command": [sys.executable, "check.py"],
                          "success_markers": ["CASE_OK"]}],
            "coverage": {"policy": "required", "parser": "normalized-json", "source_paths": ["app.py"],
                         "case_binding_ids": ["C1"], "collection_relation": "replay_same_cases",
                         "run_command": [sys.executable, "check.py", "{artifacts}/coverage.json"],
                         "report_path": "{artifacts}/coverage.json"},
        }
        self.path = Path(self.temp.name) / "manifest.json"
        self.write_manifest()

    def write_manifest(self):
        self.path.write_text(json.dumps(self.manifest))

    def test_external_contract_snapshot_requires_declared_git_blob(self):
        repo = Path(self.temp.name) / "contract-repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        (repo / "api.txt").write_text("response has analysis_id\n")
        subprocess.run(["git", "-C", str(repo), "add", "api.txt"], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                        "commit", "-qm", "contract"], check=True)
        revision = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        snapshot = Path(self.temp.name) / "snapshot.txt"
        snapshot.write_text("response has analysis_id\n")
        descriptor = {"path": str(snapshot), "sha256": portable.sha(snapshot.read_bytes()),
                      "source_repo": str(repo), "source_ref": revision, "source_path": "api.txt"}
        self.assertEqual(portable.frozen_contract(self.root, descriptor), snapshot)
        snapshot.write_text("response has analysis_uuid\n")
        with self.assertRaisesRegex(ValueError, "contract drift"):
            portable.frozen_contract(self.root, descriptor)

    def test_prepared_to_measured_trace(self):
        portable.prepare(self.path, self.out)
        portable.project(self.path, self.out)
        self.assertEqual(portable.load(self.out / "trace.json")["stage"], "prepared")
        portable.execute(self.path, self.out)
        portable.project(self.path, self.out)
        trace = portable.load(self.out / "trace.json")
        self.assertEqual(trace["case_results"][0]["status"], "passed")
        self.assertEqual(trace["coverage"]["files"][0]["lines"], {"covered": 1, "total": 2})
        self.assertEqual(trace["judgment"]["status"], "pending_review")
        before = (self.out / "trace.json").read_bytes()
        portable.project(self.path, self.out)
        self.assertEqual((self.out / "trace.json").read_bytes(), before)

    def test_failed_selected_case_can_keep_its_real_coverage_report(self):
        (self.root / "check.py").write_text(
            "import json, sys\n"
            "print('CASE_OK')\n"
            "if len(sys.argv) > 1:\n"
            "  with open(sys.argv[1], 'w') as f:\n"
            "    json.dump({'files': {'app.py': {'lines': {'covered': 1, 'total': 2}, "
            "'branches': {'covered': 0, 'total': 1}}}}, f)\n"
            "raise SystemExit(1)\n"
        )
        self.manifest["coverage"]["accept_failed_case_exit"] = True
        self.write_manifest()
        portable.prepare(self.path, self.out)
        portable.execute(self.path, self.out)
        portable.project(self.path, self.out)
        trace = portable.load(self.out / "trace.json")
        self.assertEqual(trace["case_results"][0]["status"], "failed")
        self.assertEqual(trace["coverage"]["status"], "measured")
        self.assertEqual(trace["coverage"]["collection_exit_code"], 1)
        self.assertEqual(trace["coverage"]["files"][0]["lines"], {"covered": 1, "total": 2})

    def test_unavailable_coverage_has_reason_and_is_distinct_from_off(self):
        self.manifest["coverage"] = {"policy": "unavailable", "reason": "Original source has no reliable line collector"}
        self.write_manifest()
        portable.prepare(self.path, self.out)
        portable.execute(self.path, self.out)
        portable.project(self.path, self.out)
        trace = portable.load(self.out / "trace.json")
        self.assertEqual(trace["coverage"], {"status": "unavailable", "reason": self.manifest["coverage"]["reason"]})
        summary = coverage_views.summarize([trace])[0]["scopes"]["project"]
        self.assertEqual(summary["status"], "unavailable")
        self.assertEqual(summary["unavailable_reasons"], [self.manifest["coverage"]["reason"]])
        self.manifest["coverage"] = {"policy": "off"}
        self.write_manifest()
        other = Path(self.temp.name) / "off-attempt"
        portable.prepare(self.path, other)
        portable.execute(self.path, other)
        portable.project(self.path, other)
        self.assertEqual(coverage_views.summarize([portable.load(other / "trace.json")])[0]["scopes"]["project"]["status"], "off")

    def test_unavailable_coverage_requires_explanation(self):
        self.manifest["coverage"] = {"policy": "unavailable", "reason": "  "}
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "requires a reason"):
            portable.prepare(self.path, self.out)

    def test_cumulative_scope_is_incomplete_if_one_scene_lacks_line_report(self):
        project = {"id": "sample", "revision": "frozen", "sources": ["app.py"]}
        measured = {"project": project, "scenarios": [{"id": "S1"}], "generated_at": "1",
                    "coverage": {"status": "measured", "line_files": [
                        {"path": "app.py", "executable_lines": [1], "hit_lines": [1]}]}}
        unavailable = {"project": project, "scenarios": [{"id": "S2"}], "generated_at": "1",
                       "coverage": {"status": "unavailable", "reason": "No trustworthy collector"}}
        result = coverage_views.summarize([measured, unavailable])[0]["scopes"]["project"]
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["scenes_without_line_report"], 1)
        self.assertEqual(result["unavailable_reasons"], ["No trustworthy collector"])

    def test_cumulative_scope_waits_when_no_scene_exists(self):
        trace = {"project": {"id": "sample", "revision": "frozen", "sources": []}, "scenarios": []}
        self.assertEqual(coverage_views.summarize([trace])[0]["scopes"]["project"]["status"], "pending")

    def test_test_code_change_invalidates_preparation(self):
        portable.prepare(self.path, self.out)
        (self.root / "check.py").write_text("print('CASE_OK')\n")
        with self.assertRaisesRegex(ValueError, "preparation binding changed"):
            portable.execute(self.path, self.out)

    def test_evidence_change_invalidates_projection(self):
        portable.prepare(self.path, self.out)
        portable.execute(self.path, self.out)
        (self.out / "coverage.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "coverage evidence changed"):
            portable.project(self.path, self.out)

    def test_stale_review_cannot_approve(self):
        portable.prepare(self.path, self.out)
        portable.execute(self.path, self.out)
        portable.save(self.out / "assessment.json", {"status": "passed", "reviewer": "other role",
                                                     "reason": "Checked assertions and evidence",
                                                     "execution_sha256": "wrong"})
        with self.assertRaisesRegex(ValueError, "assessment binding invalid"):
            portable.project(self.path, self.out)

    def test_uncertain_execution_is_not_replayed(self):
        portable.prepare(self.path, self.out)
        portable.save(self.out / "execute-intent.json", {"manifest_sha256": "frozen"})
        with self.assertRaisesRegex(ValueError, "uncertain effects"):
            portable.execute(self.path, self.out)

    def test_source_free_manual_black_box_is_visible_but_not_passed(self):
        self.manifest["project"]["sources"] = []
        self.manifest["scenarios"] = []
        self.manifest["bindings"] = []
        self.manifest["coverage"] = {"policy": "off"}
        self.write_manifest()
        portable.prepare(self.path, self.out)
        portable.project(self.path, self.out)
        trace = portable.load(self.out / "trace.json")
        self.assertEqual(len(trace["requirements"]), 1)
        self.assertEqual(trace["scenarios"], [])
        with self.assertRaisesRegex(ValueError, "execution requires one scenario"):
            portable.execute(self.path, self.out)

    def test_manual_observation_requires_real_evidence(self):
        self.manifest["project"]["sources"] = []
        self.manifest["bindings"] = [{"id": "C1", "scenario_id": "S1", "kind": "manual",
                                      "title": "Visual operation", "procedure": "Open and inspect"}]
        self.manifest["coverage"] = {"policy": "off"}
        self.write_manifest()
        portable.prepare(self.path, self.out)
        portable.save(self.out / "manual-results.json", [{"binding_id": "C1", "status": "passed",
                                                         "actual": "Observed the expected result",
                                                         "evidence_path": str(self.out / "missing.png")}])
        with self.assertRaisesRegex(ValueError, "manual result lacks actual observation"):
            portable.execute(self.path, self.out)
        evidence = self.out / "observation.txt"
        evidence.write_text("Actual UI observation")
        portable.save(self.out / "manual-results.json", [{"binding_id": "C1", "status": "passed",
                                                         "actual": "Observed the expected result",
                                                         "evidence_path": str(evidence)}])
        portable.execute(self.path, self.out)
        portable.project(self.path, self.out)
        self.assertEqual(portable.load(self.out / "trace.json")["case_results"][0]["status"], "passed")

    def test_reviewed_commit_rule_and_changed_line_hits_are_bound(self):
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

        git("init", "-q")
        (self.root / "contract.txt").write_text("Value must be two.\n")
        git("add", "app.py", "contract.txt")
        git("-c", "user.name=Pilot", "-c", "user.email=pilot@example.invalid", "commit", "-qm", "base")
        base = git("rev-parse", "HEAD")
        (self.root / "app.py").write_text("VALUE = 2\n")
        git("add", "app.py")
        git("-c", "user.name=Pilot", "-c", "user.email=pilot@example.invalid", "commit", "-qm", "change")
        head = git("rev-parse", "HEAD")
        source_hash = hashlib.sha256((self.root / "app.py").read_bytes()).hexdigest()
        rule = {"id": "W1", "title": "Value rule", "text": "Value must be two.",
                "status": "supported", "basis_kind": "contract", "basis": "written contract",
                "contract_source": "contract.txt", "contract_quote": "Value must be two.",
                "code_sources": [{"path": "app.py", "revision": head, "sha256": source_hash}]}
        approved_path = Path(self.temp.name) / "approved.json"
        portable.save(approved_path, {"schema": "commit-reverse-v1", "status": "approved",
                                      "review": {"status": "approved", "rule_reviews": [
                                          {"rule_id": "W1", "verdict": "accepted"}]},
                                      "change": {"base_revision": base, "head_revision": head,
                                                 "diff_sha256": "frozen-diff"},
                                      "draft": {"reverse_rules": [rule], "impacts": []}})
        self.manifest["project"] = {"id": "sample", "root": str(self.root), "revision": head,
                                    "sources": ["app.py"]}
        self.manifest["reverse_rules"] = [rule]
        self.manifest["change"] = {"base_revision": base, "head_revision": head,
                                   "diff_sha256": "frozen-diff", "reviewed_reverse_path": str(approved_path),
                                   "reviewed_reverse_sha256": hashlib.sha256(approved_path.read_bytes()).hexdigest()}
        self.manifest["scenarios"][0].update({"requirement_id": "W1", "kind": "WHITE_BOX"})
        self.manifest["coverage"] = {"policy": "off"}
        self.write_manifest()
        portable.prepare(self.path, self.out)
        line_report = Path(self.temp.name) / "lcov.info"
        line_report.write_text("SF:app.py\nDA:1,2\nend_of_record\n")
        result = portable.parse_change_lines(self.root, base, head, ["app.py"], line_report)
        self.assertEqual(result["files"][0]["hit_lines"], [1])
        py_report = Path(self.temp.name) / "coverage.json"
        py_report.write_text(json.dumps({"files": {"app.py": {"executed_lines": [1], "missing_lines": []}}}))
        py_result = portable.parse_change_lines(self.root, base, head, ["app.py"], py_report, "coveragepy-json")
        self.assertEqual(py_result["files"][0]["hit_lines"], [1])
        (self.root / "contract.txt").write_text("Value may be three.\n")
        with self.assertRaisesRegex(ValueError, "independent contract does not match"):
            portable.project(self.path, self.out)

    def test_black_box_pr_requirement_is_bound_without_importing_reverse_rules(self):
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()
        git("init", "-q")
        git("add", "app.py")
        git("-c", "user.name=Pilot", "-c", "user.email=pilot@example.invalid", "commit", "-qm", "base")
        base = git("rev-parse", "HEAD")
        (self.root / "app.py").write_text("VALUE = 2\n")
        git("add", "app.py")
        git("-c", "user.name=Pilot", "-c", "user.email=pilot@example.invalid", "commit", "-qm", "head")
        head = git("rev-parse", "HEAD")
        source_hash = hashlib.sha256((self.root / "app.py").read_bytes()).hexdigest()
        inventory = {"schema": "change-inventory-v1", "base_ref": base, "target_revision": base,
                     "base_revision": base, "head_revision": head, "source_paths": ["app.py"],
                     "source_hashes": {"app.py": source_hash}, "pr_requirement_ids": ["R1"],
                     "test_modes": ["BLACK_BOX", "WHITE_BOX"], "unclassified_paths": [],
                     "changed_source_paths": ["app.py"], "files": [{"path": "app.py", "kind": "source"}]}
        change = {"base_revision": base, "head_revision": head, "diff_sha256": "frozen",
                  "inventory": inventory, "changed_files": [{"path": "app.py", "sha256": source_hash}], "contract_files": []}
        approved_path = Path(self.temp.name) / "approved-pr.json"
        portable.save(approved_path, {"schema": "commit-reverse-v1", "status": "approved",
                                      "review": {"status": "approved", "rule_reviews": []},
                                      "change": change, "draft": {"reverse_rules": [], "impacts": []}})
        self.manifest["project"] = {"id": "sample", "root": str(self.root), "revision": head,
                                    "sources": ["app.py"]}
        self.manifest["scenarios"][0]["kind"] = "BLACK_BOX"
        self.manifest["change"] = {**change, "reviewed_reverse_path": str(approved_path),
                                   "reviewed_reverse_sha256": hashlib.sha256(approved_path.read_bytes()).hexdigest()}
        self.manifest["coverage"] = {"policy": "off"}
        self.write_manifest()
        portable.prepare(self.path, self.out)
        self.manifest["requirements"].append({"id": "R2", "text": "Another requirement", "source": "spec"})
        self.manifest["scenarios"][0]["requirement_id"] = "R2"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "black-box PR scene is not a confirmed PR requirement"):
            portable.prepare(self.path, self.out)

    def test_single_agent_reverse_result_requires_frozen_trace_and_gate(self):
        folder = Path(self.temp.name) / "reverse"
        folder.mkdir()
        draft = {"reverse_rules": [], "impacts": []}
        portable.save(folder / "draft.current.json", draft)
        portable.save(folder / "draft-gate.json", {"status": "ready", "errors": []})
        (folder / "agent-selfcheck.jsonl").write_text('{"type":"done"}\n')
        digest = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
        artifact = {"schema": "commit-reverse-selfcheck-v1", "status": "completed", "draft": draft,
                    "self_check": {"method": "single_agent_internal",
                                   "draft_sha256": digest("draft.current.json"),
                                   "gate_sha256": digest("draft-gate.json"),
                                   "agent_trace_sha256": digest("agent-selfcheck.jsonl")}}
        result = folder / "result.json"
        portable.save(result, artifact)
        self.assertTrue(portable.reverse_ready(portable.load(result), result))
        (folder / "agent-selfcheck.jsonl").write_text('{"type":"changed"}\n')
        self.assertFalse(portable.reverse_ready(portable.load(result), result))


if __name__ == "__main__":
    unittest.main()
