"""Observable opt-in gate behavior on isolated Git/source/evidence fixtures."""

import hashlib
import json
import subprocess
import unittest
from unittest.mock import patch
import test_playbook as baseline

PLAYBOOK = baseline.PLAYBOOK
save = baseline.save


class CodeCoverageTests(unittest.TestCase):
    def setUp(self):
        fixture = baseline.PlaybookGatesTest()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.project, self.ledger, self.run_dir = fixture.project, fixture.ledger, fixture.run_dir
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        self.source = self.project / "app.py"
        self.source.write_text("def allowed(expired):\n    if expired:\n        return False\n    return True\n")
        subprocess.run(["git", "-C", str(self.project), "add", "app.py"], check=True)
        subprocess.run(["git", "-C", str(self.project), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"], check=True)
        revision = subprocess.check_output(["git", "-C", str(self.project), "rev-parse", "HEAD"]).decode().strip()
        self.run = json.loads((self.run_dir / "run.json").read_text())
        self.run.update(revision=revision, acceptance_mode="coverage")
        save(self.run_dir / "run.json", self.run)
        review = json.loads((self.run_dir / "review.json").read_text())
        review["revision"] = revision
        review["output_quality"]["checks"].append({"artifact": "code_coverage", "reason": "受控原始计数与范围分开记录，未覆盖处置关联具体分支"})
        save(self.run_dir / "review.json", review)
        self.folder = self.run_dir / "code-coverage"
        self.folder.mkdir()
        raw = self.folder / "raw.json"
        raw.write_text('{"fixture_counters":{"lines":[4,4],"branches":[2,2]}}')
        self.proof = {"path": "code-coverage/raw.json", "sha256": hashlib.sha256(raw.read_bytes()).hexdigest()}
        self.measurement = {
            "status": "measured", "run_id": "run-1", "revision": revision, "ledger_hashes": self.run["ledger_hashes"],
            "environment": "isolated test fixture", "tools": [{"name": "fixture", "version": "1", "command": "fixture capture"}],
            "scope": {"targets": ["app.py"], "exclusions": [], "basis": "entire fixture application"},
            "raw_evidence": [self.proof],
            "sources": [{"path": "app.py", "sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(), "metrics": {"lines": {"covered": 4, "total": 4}, "branches": {"covered": 2, "total": 2}}}],
            "uncovered": [],
        }
        self.coverage_review = {
            "run_id": "run-1", "revision": revision, "ledger_hashes": self.run["ledger_hashes"],
            "reviewer_kind": "independent_ai", "review_reference": "fixture-independent-check", "reason": "fixture source/counters inspected", "status": "sufficient",
            "scope_reviewed": True, "raw_counters_verified": True, "evidence": [self.proof], "recommendations": [], "dispositions": [],
            "state_probes": [{"state": "expired", "plausible_fault": "accepts expired", "failure_signal": "SC-B sees account", "scenario_ids": ["SC-B"]}],
        }
        self.flush()

    def flush(self):
        save(self.folder / "measurement.json", self.measurement)
        self.coverage_review["measurement_sha256"] = hashlib.sha256((self.folder / "measurement.json").read_bytes()).hexdigest()
        save(self.folder / "review.json", self.coverage_review)

    def check(self, **kwargs):
        return PLAYBOOK.validate(self.project, "run-1", **kwargs)

    def assertBlocked(self, fragment):
        report = self.check()
        self.assertEqual(report["status"], "blocked")
        self.assertIn(fragment, " ".join(report["gates"]["code_coverage"]["issues"]))

    def test_standard_does_not_read_existing_malformed_coverage(self):
        self.run["acceptance_mode"] = "standard"
        review = json.loads((self.run_dir / "review.json").read_text())
        review["output_quality"]["checks"] = [v for v in review["output_quality"]["checks"] if v["artifact"] != "code_coverage"]
        save(self.run_dir / "review.json", review)
        save(self.run_dir / "run.json", self.run)
        (self.folder / "measurement.json").write_text("malformed")
        (self.folder / "review.json").write_text("malformed")
        with patch.object(PLAYBOOK, "errors_for_run", side_effect=AssertionError("standard entered enhancement")):
            report = self.check()
        self.assertEqual(report["status"], "passed")
        self.assertEqual(len(report["gates"]), 5)

    def test_enhanced_requires_additional_gate_and_cannot_downgrade(self):
        report = self.check()
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["gates"]["code_coverage"]["status"], "passed")
        downgraded = self.check(coverage_mode="standard")
        self.assertEqual(downgraded["status"], "blocked")
        self.assertIn("mode differs", " ".join(downgraded["gates"]["execution"]["issues"]))
        (self.folder / "measurement.json").unlink()
        self.assertBlocked("missing")

    def test_stale_measurement_review_and_tampered_raw_evidence_block(self):
        self.measurement["environment"] = "changed"
        save(self.folder / "measurement.json", self.measurement)
        self.assertBlocked("stale")
        self.flush()
        (self.folder / "raw.json").write_text("changed")
        self.assertBlocked("sha256 mismatch")

    def test_changed_working_source_or_other_revision_cannot_reuse_counters(self):
        original = self.source.read_bytes()
        self.source.write_text("changed source")
        self.assertBlocked("working source differs")
        self.source.write_bytes(original)
        self.measurement["revision"] = "different"
        self.flush()
        self.assertBlocked("revision mismatch")

    def test_covered_code_still_requires_state_challenge(self):
        self.coverage_review["state_probes"] = []
        self.flush()
        self.assertBlocked("semantic state")

    def test_uncovered_defensive_exit_keeps_denominator_and_needs_disposition(self):
        self.measurement["sources"][0]["metrics"]["branches"]["covered"] = 1
        self.measurement["uncovered"] = [{"id": "U1", "file": "app.py", "kind": "branch", "location": "2:false"}]
        self.flush()
        self.assertBlocked("not every uncovered path")
        self.coverage_review["dispositions"] = [{"path_id": "U1", "decision": "defensive_unreachable", "reason": "fixture-only reachability proof retained"}]
        self.flush()
        self.assertEqual(self.check()["status"], "passed")
        self.assertEqual(self.measurement["sources"][0]["metrics"]["branches"], {"covered": 1, "total": 2})

    def test_deficits_unresolved_recommendations_and_blocked_tools_do_not_pass(self):
        self.measurement["sources"][0]["metrics"]["branches"]["covered"] = 1
        self.flush()
        self.assertBlocked("counter deficits")
        self.measurement["sources"][0]["metrics"]["branches"]["covered"] = 2
        self.coverage_review["recommendations"] = [{"action": "strengthen", "scenario_ids": ["SC-B"]}]
        self.flush()
        self.assertBlocked("unresolved")
        self.coverage_review["recommendations"] = []
        self.measurement["status"] = "blocked"
        self.flush()
        self.assertBlocked("blocked or incomplete")

    def test_current_ledger_changed_after_collection_blocks_acceptance(self):
        data = json.loads((self.ledger / "scenarios.json").read_text())
        data["items"][0]["acceptance"]["description"] = "stronger assertion"
        save(self.ledger / "scenarios.json", data)
        self.assertEqual(self.check()["status"], "blocked")

    def test_source_inventory_and_evidence_escape_block(self):
        self.measurement["scope"]["targets"].append("missing.py")
        self.flush()
        self.assertBlocked("inventory differs")
        self.measurement["scope"]["targets"].pop()
        self.measurement["raw_evidence"] = [{"path": "../run.json", "sha256": "0" * 64}]
        self.flush()
        self.assertBlocked("escapes run directory")

    def test_revision_must_be_immutable_and_cannot_be_git_options(self):
        self.run["revision"] = "--output=unwanted-file"
        save(self.run_dir / "run.json", self.run)
        self.measurement["revision"] = self.coverage_review["revision"] = self.run["revision"]
        self.flush()
        self.assertBlocked("exact full Git revision")
        self.assertFalse((self.project / "unwanted-file:app.py").exists())


if __name__ == "__main__":
    unittest.main()
