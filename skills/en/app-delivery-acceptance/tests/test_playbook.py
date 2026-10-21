import importlib.util
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "playbook.py"
WORKFLOW_GATE_PROBE = Path(__file__).resolve().parent / "workflow_gate_probe.mjs"
WORKFLOW_REPAIR_PROBE = Path(__file__).resolve().parent / "workflow_repair_probe.mjs"
WORKFLOW_BLACK_BOX_PROBE = Path(__file__).resolve().parent / "workflow_black_box_probe.mjs"
SPEC = importlib.util.spec_from_file_location("acceptance_playbook", SCRIPT)
PLAYBOOK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PLAYBOOK)
from design_fixture import add_contract, white_contract


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def proof(path, content="observed expected behavior"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def quality_review(artifacts):
    return {'version': 1, 'status': 'passed', 'checks': [{'artifact': key, 'record_ids': sorted(value) if value is not None else [], 'reason': '独立核对过期验证码的条件、拒绝结果及证据定位，内容分项表达且可对应当前记录。'} for key, value in artifacts.items()], 'findings': []}


class PlaybookGatesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "app"
        self.project.mkdir()
        self.test_dir = self.project / "tests" if not getattr(self, "external_storage", False) else Path(self.temp.name) / "test results [custom]'"
        selection = patch.dict(os.environ, {"DELIVERY_ACCEPTANCE_TEST_DIR": str(self.test_dir)})
        selection.start()
        self.addCleanup(selection.stop)
        approved = Path(self.temp.name) / "approved.json"
        save(approved, {"source": "team requirements", "version": "v1", "items": [{"id": "REQ-1", "text": "Expired code is rejected"}]})
        PLAYBOOK.import_requirements(self.project, approved, initialize=True)
        self.ledger = self.test_dir / "delivery-acceptance"
        proof(self.ledger / "proof" / "resource.txt")
        proof(self.ledger / "proof" / "integration.txt")
        save(self.ledger / "resources.json", {
            "discovery_complete": True,
            "discovery_basis": "Inspected app configuration and SMS adapter",
            "decisions": [{
                "id": "sms", "kind": "third_party", "description": "SMS gateway",
                "mock_available": True, "mode": "mock", "reason": "Full flow can use a faithful gateway double",
                "mock_ref": "test/sms-fake.js",
                "verification": {"status": "passed", "evidence": "proof/resource.txt"},
                "integration": {"status": "passed", "tested_version": "sms-adapter-v1", "evidence": "proof/integration.txt"}
            }]
        })
        save(self.ledger / "methods.json", {"items": [
            {"id": "M-1", "kind": "acceptance", "description": "核对过期分支不创建账户", "preconditions": ["验证码已过期"], "actions": ["提交注册请求"], "criteria": ["不写入账户"], "evidence_expected": ["注册前后账户数据"]},
            {"id": "M-2", "kind": "acceptance", "description": "提交过期验证码，核对拒绝提示与账户不变", "preconditions": ["尚未注册的用户和已过期验证码"], "actions": ["输入过期验证码并提交注册"], "criteria": ["显示过期提示，未创建账户"], "evidence_expected": ["错误提示截图与账户查询结果"]}
        ]})
        save(self.ledger / "scenarios.json", {"black_box_complete": True, "white_box_complete": True, "items": [
            {"id": "SC-B", "priority": "P0", "priority_reason": "过期凭据被接受会破坏访问控制", "kind": "black_box", "title": "Expired code rejection", "requirement_ids": ["REQ-1"], "expected": "Registration is rejected", "method_ids": ["M-2"]},
            {"id": "SC-W", "priority": "P1", "priority_reason": "过期分支写入会产生无效账户", "kind": "white_box", "title": "Expiry branch", "requirement_ids": ["REQ-1"], "target_condition": "expiry timestamp is before now", "expected": "No account write", "method_ids": ["M-1"]}
        ]})
        save(self.ledger / "coverage_review.json", {
            "output_quality": quality_review({"scenarios": {"SC-B"}, "methods": {"M-2"}}),
            "status": "passed", "basis": "Independently challenged the confirmed expiry requirement against user-visible code submission",
            **PLAYBOOK.coverage_scope_hashes(self.ledger),
            "priority_reviews": [{"scenario_id": "SC-B", "priority": "P0", "verdict": "appropriate", "reason": "访问控制失败应优先验证"}],
            "white_box_priority_review": {"output_quality": quality_review({"scenarios": {"SC-W"}, "methods": {"M-1"}}), "status": "passed", "basis": "独立检查过期分支及其用户后果",
                **PLAYBOOK.priorities.white_box_hashes(self.ledger, PLAYBOOK.items(PLAYBOOK.read_json(self.ledger / "scenarios.json"))),
                "items": [{"scenario_id": "SC-W", "priority": "P1", "verdict": "appropriate", "reason": "该写入分支影响账户正确性"}]},
            "items": [{"requirement_id": "REQ-1", "verdict": "sufficient",
                       "reason": "An expired code accepted in the stated state would fail SC-B",
                       "operation_modes": ["enter code"], "user_states": ["expired code"],
                       "fault_probes": [{"mode": "enter code", "state": "expired code",
                                          "plausible_fault": "App accepts an expired code",
                                          "failure_signal": "SC-B observes an account instead of rejection",
                                          "scenario_ids": ["SC-B"]}], "uncovered_paths": []}]
        })
        proof(self.project / 'expiry.py', 'def expired(deadline, now):\n    return deadline < now\n')
        scenes = PLAYBOOK.read_json(self.ledger / "scenarios.json")
        scenes['items'][1]['code_sources'] = [{'path':'expiry.py', 'symbol':'expired', 'revision':'controlled-test-source-v1', 'sha256':hashlib.sha256((self.project/'expiry.py').read_bytes()).hexdigest()}]
        design_review = PLAYBOOK.read_json(self.ledger / "coverage_review.json")
        add_contract(scenes, design_review, PLAYBOOK.read_json(self.ledger / "methods.json"))
        white_document, white_review = white_contract(scenes["items"])
        save(self.ledger / "white_box_rules.json", white_document)
        design_review["white_box_priority_review"].update(white_review)
        (self.ledger / "methods.json").unlink()
        design_review["white_box_priority_review"].update(PLAYBOOK.priorities.white_box_hashes(self.ledger, scenes["items"]))
        save(self.ledger / "scenarios.json", scenes)
        design_review.update(PLAYBOOK.coverage_scope_hashes(self.ledger))
        save(self.ledger / "coverage_review.json", design_review)
        save(self.ledger / "execution-coverage-policy.json", {"mode": "off"})
        # These structural fixtures do not exercise the scenario-loop collector;
        # opt out explicitly now that acceptance runs default to live coverage.
        PLAYBOOK.new_run(self.project, "run-1", "abc123", "test", execution_coverage_mode="off")
        self.run_dir = self.ledger / "runs" / "run-1"
        self.assertFalse((self.run_dir / "methods.snapshot.json").exists())
        self.assertTrue(all(s.get("acceptance") for s in PLAYBOOK.read_json(self.run_dir / "scenarios.snapshot.json")["items"]))
        proof(self.ledger / "proof" / "run-preflight.txt")
        proof(self.run_dir / "evidence" / "screen.txt")
        proof(self.run_dir / "evidence" / "tests.txt")
        run_template = json.loads((self.run_dir / "run.json").read_text())
        save(self.run_dir / "run.json", {
            **run_template,
            "revision": "abc123", "environment": "test",
            "ledger_hashes": run_template["ledger_hashes"],
            "dependency_checks": [{"dependency_id": "sms", "status": "passed", "evidence": "proof/run-preflight.txt"}],
            "results": [
                {"scenario_id": "SC-B", "status": "passed", "method_ids": ["M-2"], "actual": "Error visible and no account", "evidence": ["evidence/screen.txt"]},
                {"scenario_id": "SC-W", "status": "passed", "method_ids": ["M-1"], "actual": "Expiry branch rejected write", "evidence": ["evidence/tests.txt"]}
            ]
        })
        save(self.run_dir / "review.json", {
            "revision": "abc123", "reviewer_kind": "independent_ai", "review_reference": "local-review-1",
            "summary": "过期验证码被拒绝且未创建账户，已核对界面与写入分支。",
            "scope": {"included": ["过期验证码注册拒绝与账户写入分支"], "excluded": ["其他验证码状态"], "limitations": ["受控门禁测试记录"]}, "recommendations": [],
            "output_quality": quality_review(dict.fromkeys(("project", "resources", "execution", "evidence", "issues"))),
            "coverage": {"status": "passed", "reason": "Normal and exception paths assessed", "requirements_reviewed": ["REQ-1"], "white_box_basis": "Reviewed registration expiry branch at abc123", "uncovered_branches": []},
            "results": [
                {"scenario_id": "SC-B", "status": "passed", "reason": "Screen and state match expectation", "evidence": ["evidence/screen.txt"]},
                {"scenario_id": "SC-W", "status": "passed", "reason": "Assertion verifies no write", "evidence": ["evidence/tests.txt"]}
            ]
        })

    def test_design_rejects_contentless_scenario_and_unstructured_methods(self):
        scenes = PLAYBOOK.read_json(self.ledger / 'scenarios.json'); scenes['items'][0]['expected'] = '符合预期'
        save(self.ledger / 'scenarios.json', scenes)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertTrue(any('expected must state' in v for v in report['gates']['black_box_scenarios']['issues']))
        scenes['items'][0]['acceptance']['actions'] = '提交过期验证码'
        save(self.ledger / 'scenarios.json', scenes)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertTrue(any('actions needs a nonempty list' in v for v in report['gates']['black_box_scenarios']['issues']))

    def test_design_review_must_cover_all_artifact_record_ids(self):
        review = PLAYBOOK.read_json(self.ledger / 'coverage_review.json')
        review['output_quality']['checks'][0]['record_ids'] = []
        save(self.ledger / 'coverage_review.json', review)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertTrue(any('enumerate exactly' in v for v in report['gates']['coverage_review']['issues']))

    def test_final_readability_cannot_pass_with_placeholder_summary(self):
        review = PLAYBOOK.read_json(self.run_dir / 'review.json'); review['summary'] = '测试通过'
        save(self.run_dir / 'review.json', review)
        report = PLAYBOOK.validate(self.project, 'run-1')
        self.assertTrue(any('substantive short summary' in v for v in report['gates']['review']['issues']))

    def test_report_displays_business_results_and_limits_huge_evidence_lists(self):
        run = PLAYBOOK.read_json(self.run_dir / 'run.json'); review = PLAYBOOK.read_json(self.run_dir / 'review.json')
        run['results'][0].update(summary='页面显示过期提示，账户查询未发现新增记录。', evidence=[f'evidence/file-{i}.json' for i in range(2000)])
        review['results'][0]['summary'] = '提示与账户状态一致，符合拒绝过期验证码判据。'
        report = PLAYBOOK.validate(self.project, 'run-1')
        text = PLAYBOOK.render_markdown(report, run, PLAYBOOK.read_json(self.ledger / 'scenarios.json'), review)
        self.assertIn('页面显示过期提示', text); self.assertIn('提示与账户状态一致', text)
        self.assertIn('Expired code rejection', text); self.assertIn('2000份', text)
        self.assertNotIn('file-1999.json', text)

    def test_complete_trace_passes(self):
        report = PLAYBOOK.validate(self.project, "run-1")
        self.assertEqual(report["status"], "passed")
        self.assertTrue(all(gate["status"] == "passed" for gate in report["gates"].values()))

    def test_white_box_basis_accepts_detailed_list(self):
        path = self.run_dir / "review.json"
        review = json.loads(path.read_text())
        review["coverage"]["white_box_basis"] = ["Inspected expiry branch at abc123", "Inspected registration assertions"]
        save(path, review)
        self.assertEqual(PLAYBOOK.validate(self.project, "run-1")["gates"]["review"]["status"], "passed")

        review["coverage"]["white_box_basis"].append(" ")
        save(path, review)
        self.assertEqual(PLAYBOOK.validate(self.project, "run-1")["gates"]["review"]["status"], "blocked")

    def test_missing_evidence_blocks_execution(self):
        (self.run_dir / "evidence" / "screen.txt").unlink()
        report = PLAYBOOK.validate(self.project, "run-1")
        self.assertEqual(report["gates"]["execution"]["status"], "blocked")
        self.assertIn("missing or empty", " ".join(report["gates"]["execution"]["issues"]))

    def test_real_e2e_rejected_when_mock_is_viable(self):
        path = self.ledger / "resources.json"
        record = json.loads(path.read_text())
        record["decisions"][0]["mode"] = "real"
        record["decisions"][0]["credential_reusable"] = True
        record["decisions"][0]["credential_ref"] = "keychain:sms-test"
        save(path, record)
        report = PLAYBOOK.validate(self.project, "run-1")
        self.assertEqual(report["gates"]["resources"]["status"], "blocked")
        self.assertIn("viable Mock", " ".join(report["gates"]["resources"]["issues"]))

    def test_real_e2e_allowed_without_mock_with_reusable_credential(self):
        path = self.ledger / "resources.json"
        record = json.loads(path.read_text())
        decision = record["decisions"][0]
        decision["mock_available"] = False
        decision["mode"] = "real"
        decision["reason"] = "Provider behavior cannot be reproduced by a local double"
        decision["credential_reusable"] = True
        decision["credential_ref"] = "keychain:dedicated-test-token"
        save(path, record)
        report = PLAYBOOK.validate(self.project, "run-1")
        self.assertEqual(report["gates"]["resources"]["status"], "passed")
        self.assertEqual(report["gates"]["execution"]["status"], "blocked")

    def test_requirement_change_invalidates_scenario_review(self):
        source = Path(self.temp.name) / "approved-v2.json"
        save(source, {"source": "team requirements", "version": "v2", "items": [{"id": "REQ-1", "text": "Expired code is rejected"}, {"id": "REQ-2", "text": "Wrong code is rejected"}]})
        PLAYBOOK.import_requirements(self.project, source)
        report = PLAYBOOK.validate(self.project)
        self.assertEqual(report["gates"]["scenarios"]["status"], "blocked")
        self.assertIn("REQ-2", " ".join(report["gates"]["scenarios"]["issues"]))

    def test_black_box_stage_needs_no_app_resources_or_white_box(self):
        save(self.ledger / "resources.json", {"discovery_complete": False, "discovery_basis": "", "decisions": []})
        path = self.ledger / "scenarios.json"
        record = json.loads(path.read_text())
        record["white_box_complete"] = False
        record["items"] = [item for item in record["items"] if item["kind"] == "black_box"]
        save(path, record)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertEqual(report["status"], "black_box_ready")
        self.assertEqual(set(report["gates"]), {"requirements", "black_box_scenarios", "coverage_review"})
        self.assertEqual(PLAYBOOK.validate(self.project)["gates"]["resources"]["status"], "blocked")

        result = subprocess.run(["node", str(WORKFLOW_BLACK_BOX_PROBE), str(self.project)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = json.loads(result.stdout)
        self.assertEqual(trace["state"], "scenariosReady", trace)
        self.assertNotIn("resourceCheck", trace["calls"])
        self.assertEqual(trace["scripts"], [{"stateId": "blackBoxGate", "exitStatus": 0}])

    def test_black_box_stage_requires_every_confirmed_requirement(self):
        path = self.ledger / "scenarios.json"
        record = json.loads(path.read_text())
        record["items"] = [item for item in record["items"] if item["kind"] == "white_box"]
        save(path, record)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertEqual(report["status"], "blocked")
        self.assertIn("REQ-1", " ".join(report["gates"]["black_box_scenarios"]["issues"]))

    def test_black_box_review_rejects_unprobed_mode(self):
        path = self.ledger / "coverage_review.json"
        record = json.loads(path.read_text())
        record["items"][0]["operation_modes"].append("voice")
        save(path, record)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertEqual(report["gates"]["coverage_review"]["status"], "blocked")
        self.assertIn("voice", " ".join(report["gates"]["coverage_review"]["issues"]))

    def test_black_box_review_cannot_survive_scenario_change(self):
        path = self.ledger / "scenarios.json"
        record = json.loads(path.read_text())
        record["items"][0]["expected"] = "An expired code may create an account"
        save(path, record)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertIn("stale", " ".join(report["gates"]["coverage_review"]["issues"]))

    def test_black_box_review_must_challenge_every_scenario(self):
        path = self.ledger / "scenarios.json"
        record = json.loads(path.read_text())
        record["items"].append({"id": "SC-EXTRA", "kind": "black_box", "title": "Expired code on retry",
                                "requirement_ids": ["REQ-1"], "expected": "No account is created", "method_ids": ["M-2"]})
        save(path, record)
        review_path = self.ledger / "coverage_review.json"
        review = json.loads(review_path.read_text())
        review.update(PLAYBOOK.coverage_scope_hashes(self.ledger))
        save(review_path, review)
        report = PLAYBOOK.validate_black_box(self.project)
        self.assertIn("SC-EXTRA", " ".join(report["gates"]["coverage_review"]["issues"]))

    def test_black_box_stage_ignores_unrelated_white_box_drafts(self):
        scenarios_path = self.ledger / "scenarios.json"
        scenarios = json.loads(scenarios_path.read_text())
        scenarios["items"][1]["acceptance"] = {"description": "尚未完成的验收说明"}
        save(scenarios_path, scenarios)
        self.assertEqual(PLAYBOOK.validate_black_box(self.project)["status"], "black_box_ready")
        self.assertEqual(PLAYBOOK.validate(self.project)["gates"]["scenarios"]["status"], "blocked")

    def test_scenario_change_cannot_reuse_old_run(self):
        path = self.ledger / "scenarios.json"
        record = json.loads(path.read_text())
        record["items"][0]["expected"] = "Registration is rejected and audit event is written"
        save(path, record)
        report = PLAYBOOK.validate(self.project, "run-1")
        self.assertEqual(report["gates"]["execution"]["status"], "blocked")
        self.assertIn("changed after run creation", " ".join(report["gates"]["execution"]["issues"]))

    def test_cli_writes_gate_record_without_extra_report(self):
        command = [sys.executable, str(SCRIPT), "check", str(self.project), "--run", "run-1"]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.run_dir / "gate-report.json").read_text())["status"], "passed")
        self.assertFalse((self.run_dir / "acceptance-report.md").exists())

    def workflow_probe(self):
        result = subprocess.run(["node", str(WORKFLOW_GATE_PROBE), str(self.project), "run-1"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_current_workflow_refuses_legacy_passing_record(self):
        result = self.workflow_probe()
        self.assertEqual(result["state"], "incomplete")
        self.assertEqual(result["scripts"][0], {"stateId": "scenario4", "exitStatus": 0})
        self.assertTrue(all(s["exitStatus"] != 0 for s in result["scripts"][1:]))

    def test_workflow_blocks_false_scenario_reviewer_claim(self):
        path = self.ledger / "scenarios.json"
        record = json.loads(path.read_text())
        record["items"][0]["method_ids"] = ["unknown-method"]
        save(path, record)
        result = self.workflow_probe()
        self.assertEqual(result["state"], "incomplete")
        self.assertNotIn("execution1", result["calls"])
        self.assertTrue(all(script["exitStatus"] != 0 for script in result["scripts"]))

    def test_workflow_blocks_false_execution_reviewer_claim(self):
        (self.run_dir / "evidence" / "screen.txt").unlink()
        result = self.workflow_probe()
        self.assertEqual(result["state"], "incomplete")
        self.assertIn("execution1", result["calls"])
        self.assertEqual(result["scripts"][0], {"stateId": "scenario4", "exitStatus": 0})
        self.assertTrue(all(script["exitStatus"] != 0 for script in result["scripts"][1:]))

    def test_incomplete_report_preserves_exact_failure_after_generic_captain(self):
        result = subprocess.run(["node", str(WORKFLOW_GATE_PROBE), str(self.project), "run-1", "product-failed"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = json.loads(result.stdout)
        self.assertEqual(trace["state"], "incomplete")
        self.assertIn("SC-B failed", trace["response"])
        self.assertIn("run-1", trace["response"])
        self.assertNotIn("execution3", trace["calls"])
        self.assertIn("completion1", trace["calls"])
        if os.environ.get("ACCEPTANCE_FAILURE_TRACE_OUT"):
            save(Path(os.environ["ACCEPTANCE_FAILURE_TRACE_OUT"]), trace)

    def test_incomplete_report_cannot_mix_a_later_run_with_terminal_failure(self):
        result = subprocess.run(["node", str(WORKFLOW_GATE_PROBE), str(self.project), "run-1", "product-failed-new-run"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = json.loads(result.stdout)
        self.assertEqual(trace["state"], "incomplete")
        self.assertIn("SC-B failed", trace["response"])
        self.assertIn("run-1", trace["response"])
        self.assertNotIn("run-2", trace["response"])
        self.assertIn("completion1", trace["calls"])

    def test_legacy_metadata_repair_cannot_certify_current_workflow(self):
        PLAYBOOK.new_run(self.project, "run-2", "abc123", "test", execution_coverage_mode="off")
        second = self.ledger / "runs" / "run-2"
        for name in ("screen.txt", "tests.txt"):
            proof(second / "evidence" / name, f"fresh run-2 observation: {name}")
        first_data = json.loads((self.run_dir / "run.json").read_text())
        second_data = json.loads((second / "run.json").read_text())
        second_data["dependency_checks"] = first_data["dependency_checks"]
        second_data["results"] = first_data["results"]
        save(second / "run.json", second_data)
        save(second / "review.json", json.loads((self.run_dir / "review.json").read_text()))

        result = subprocess.run(["node", str(WORKFLOW_REPAIR_PROBE), str(self.project)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = json.loads(result.stdout)
        self.assertEqual(trace["state"], "incomplete", trace)
        self.assertEqual(trace["scripts"][:2], [
            {"stateId": "scenario4", "exitStatus": 2},
            {"stateId": "scenario4", "exitStatus": 0},
        ])
        self.assertTrue(all(s["exitStatus"] != 0 for s in trace["scripts"][2:]))
        self.assertEqual(trace["calls"].count("scenario5"), 1)
        self.assertEqual(trace["calls"].count("execution5"), 2)
        old_run = PLAYBOOK.validate(self.project, "run-1")
        new_run = PLAYBOOK.validate(self.project, "run-2")
        self.assertEqual(old_run["status"], "blocked")
        self.assertEqual(new_run["status"], "passed")
        if os.environ.get("ACCEPTANCE_TRACE_OUT"):
            save(Path(os.environ["ACCEPTANCE_TRACE_OUT"]), {"trace": trace, "old_run": old_run, "new_run": new_run})


class ExternalDirectoryGatesTest(PlaybookGatesTest):
    external_storage = True

    def test_all_assets_stay_in_selected_directory(self):
        result = PLAYBOOK.validate(self.project, "run-1")
        self.assertEqual(result["status"], "passed")
        self.assertEqual(Path(result["assets"]), self.ledger.resolve())
        self.assertFalse((self.project / "tests").exists())
        self.assertFalse((self.project / ".delivery-acceptance").exists())
        command = [sys.executable, str(SCRIPT), "check", str(self.project), "--test-dir", str(self.test_dir), "--run", "run-1"]
        checked = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertTrue((self.run_dir / "gate-report.json").is_file())
        self.assertFalse((self.run_dir / "acceptance-report.md").exists())

    def test_assets_cannot_be_reused_for_another_project(self):
        other = Path(self.temp.name) / "other-app"
        other.mkdir()
        with self.assertRaisesRegex(ValueError, "different project"):
            PLAYBOOK.validate_black_box(other, self.test_dir)

    def test_resource_evidence_cannot_escape_selected_assets(self):
        outside = Path(self.temp.name) / "outside-proof.txt"
        proof(outside)
        resource = json.loads((self.ledger / "resources.json").read_text())
        resource["decisions"][0]["verification"]["evidence"] = str(outside)
        save(self.ledger / "resources.json", resource)
        result = PLAYBOOK.validate(self.project)
        self.assertEqual(result["gates"]["resources"]["status"], "blocked")
        self.assertIn("escapes", " ".join(result["gates"]["resources"]["issues"]))


if __name__ == "__main__":
    unittest.main()
