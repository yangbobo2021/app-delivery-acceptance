import contextlib
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/serve_ledger.py"
SPEC = importlib.util.spec_from_file_location("acceptance_viewer", SCRIPT)
VIEWER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VIEWER)
from design_fixture import add_contract


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


class LedgerViewerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        self.selected = Path(self.temp.name) / "外部测试 assets"
        self.source = Path(self.temp.name) / "approved.json"
        save(self.source, {"source": "确认需求", "version": "v1", "items": [{"id": "REQ-1", "text": "过期凭据必须拒绝 <script>window.bad=true</script>", "package": "identity"}]})
        with contextlib.redirect_stdout(io.StringIO()):
            VIEWER.playbook.import_requirements(self.root, self.source, initialize=True, test_dir=self.selected)
        self.assets = self.selected / "delivery-acceptance"
        # Direct viewer fixtures do not model the live scenario loop; opt out
        # explicitly under the new acceptance default.
        save(self.assets / "execution-coverage-policy.json", {"mode": "off"})
        self.scenarios = {"black_box_complete": True, "white_box_complete": False, "items": [{"id": "BB-1", "priority": "P0", "priority_reason": "过期凭据越权修改账户", "kind": "black_box", "title": "Expired token / 过期凭据", "requirement_ids": ["REQ-1"], "expected": "拒绝且无业务变化", "method_ids": ["M-1"]}]}
        self.methods = {"items": [{"id": "M-1", "kind": "acceptance", "description": "实际提交过期凭据，检查拒绝与账户不变", "preconditions": ["已登记联系渠道"], "actions": ["提交过期凭据"], "criteria": ["拒绝过期凭据且账户不变"], "evidence_expected": ["错误状态和账户未改变"]}]}
        save(self.assets / "scenarios.json", self.scenarios)
        save(self.assets / "methods.json", self.methods)
        save(self.assets / "coverage_review.json", {"output_quality": {"version": 1, "status": "passed", "checks": [{"artifact": "scenarios", "record_ids": ["BB-1"], "reason": "标题及预期写明过期凭据拒绝与业务状态不变"}, {"artifact": "methods", "record_ids": ["M-1"], "reason": "前置状态、提交步骤、拒绝判据和状态证据分开可核对"}], "findings": []}, "status": "passed", "basis": "独立反事实审查", "priority_reviews": [{"scenario_id": "BB-1", "priority": "P0", "verdict": "appropriate", "reason": "凭据失效后仍能越权修改属于核心访问风险"}], **VIEWER.playbook.coverage_scope_hashes(self.assets), "items": [{"requirement_id": "REQ-1", "verdict": "sufficient", "reason": "接受过期凭据会被该场景暴露", "operation_modes": ["提交"], "user_states": ["过期"], "fault_probes": [{"mode": "提交", "state": "过期", "plausible_fault": "接受过期凭据", "scenario_ids": ["BB-1"], "failure_signal": "账户被修改"}], "uncovered_paths": []}]})
        review = VIEWER.playbook.read_json(self.assets / "coverage_review.json")
        add_contract(self.scenarios, review, self.methods)
        (self.assets / "methods.json").unlink()
        save(self.assets / "scenarios.json", self.scenarios)
        review.update(VIEWER.playbook.coverage_scope_hashes(self.assets))
        save(self.assets / "coverage_review.json", review)
        save(self.assets / "black-box-gate.json", VIEWER.playbook.validate_black_box(self.root, self.selected))
        self.ledger = VIEWER.Ledger(self.root, self.selected)

    def test_real_checker_and_json_content_load_without_writes(self):
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.assets.rglob("*") if p.is_file()}
        data = self.ledger.snapshot()
        self.assertEqual(data["current_check"]["status"], "black_box_ready")
        self.assertEqual(data["review_freshness"]["status"], "current")
        self.assertEqual(data["documents"]["requirements.json"]["items"][0]["text"], "过期凭据必须拒绝 <script>window.bad=true</script>")
        self.assertEqual(data["documents"]["scenarios.json"]["items"][0]["acceptance"]["actions"], ["提交过期凭据"])
        self.assertEqual(data["errors"], [])
        after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.assets.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_changed_method_does_not_reuse_saved_pass(self):
        self.scenarios["items"][0]["acceptance"]["actions"] = ["修改后的动作"]
        save(self.assets / "scenarios.json", self.scenarios)
        data = self.ledger.snapshot()
        self.assertEqual(data["documents"]["black-box-gate.json"]["status"], "black_box_ready")
        self.assertEqual(data["current_check"]["status"], "blocked")
        self.assertEqual(data["review_freshness"]["status"], "stale")
        self.assertEqual(data["review_freshness"]["mismatched_hashes"], ["scenarios_sha256"])

    def test_unrelated_white_box_draft_does_not_stale_black_box_review(self):
        self.scenarios["items"].append({"id": "WB-1", "kind": "white_box", "title": "草稿", "requirement_ids": ["REQ-1"], "method_ids": ["OTHER"]})
        save(self.assets / "scenarios.json", self.scenarios)
        data = self.ledger.snapshot()
        self.assertEqual(data["review_freshness"]["status"], "current")
        self.assertEqual(data["current_check"]["status"], "black_box_ready")

    def test_bad_and_missing_json_are_reported_not_passed(self):
        for invalid in ['{"items":', '[1,2]', '{"number":NaN}']:
            with self.subTest(invalid=invalid):
                (self.assets / "scenarios.json").write_text(invalid)
                data = self.ledger.snapshot()
                self.assertEqual(data["current_check"]["status"], "unavailable")
                self.assertIsNone(data["documents"]["scenarios.json"])
                self.assertTrue(any(error["file"] == "scenarios.json" for error in data["errors"]))
        (self.assets / "scenarios.json").unlink()
        self.assertEqual(self.ledger.snapshot()["errors"][0]["code"], "missing")

    def test_list_method_values_are_preserved_for_display(self):
        self.scenarios["items"][0]["acceptance"]["preconditions"] = ["前置一", "前置二"]
        save(self.assets / "scenarios.json", self.scenarios)
        data = self.ledger.snapshot()
        self.assertEqual(data["documents"]["scenarios.json"]["items"][0]["acceptance"]["preconditions"], ["前置一", "前置二"])
        # The current schema checker may block legacy array fields; the viewer must still display them.
        self.assertEqual(data["current_check"]["status"], "blocked")

    def test_history_and_run_version_are_not_current_acceptance(self):
        save(self.assets / "review-history/round-1/coverage_review.json", {"status": "gaps", "items": [{"requirement_id": "REQ-1", "verdict": "gap"}]})
        pinned = {name: hashlib.sha256((self.assets / name).read_bytes()).hexdigest() for name in VIEWER.RUN_HASH_FILES}
        save(self.assets / "runs/run-1/run.json", {"revision": "abc", "environment": "test", "ledger_hashes": pinned, "results": [{"scenario_id": "BB-1", "status": "failed", "evidence": ["evidence/error.png"]}]})
        data = self.ledger.snapshot()
        self.assertEqual(data["history"][0]["documents"]["coverage_review.json"]["status"], "gaps")
        self.assertEqual(data["runs"][0]["ledger_match"], "current")
        self.scenarios["items"][0]["acceptance"]["actions"] = ["新的版本"]
        save(self.assets / "scenarios.json", self.scenarios)
        self.assertEqual(self.ledger.snapshot()["runs"][0]["ledger_match"], "stale")

    def test_symlink_escape_is_not_read(self):
        outside = Path(self.temp.name) / "outside.json"
        save(outside, {"private_marker": "do not expose"})
        (self.assets / "scenarios.json").unlink()
        (self.assets / "scenarios.json").symlink_to(outside)
        data = self.ledger.snapshot()
        self.assertIsNone(data["documents"]["scenarios.json"])
        self.assertNotIn("private_marker", json.dumps(data))
        self.assertEqual(data["current_check"]["status"], "unavailable")

    def test_http_viewer_serves_only_view_and_rejects_mutations(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), VIEWER.handler_for(self.ledger))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        port = server.server_address[1]
        def request(path, method="GET", headers=None):
            connection = HTTPConnection("127.0.0.1", port)
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            status, body = response.status, response.read()
            connection.close()
            return status, body
        status, body = request("/api/ledger")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["current_check"]["status"], "black_box_ready")
        for path in ("/", "/viewer.js", "/viewer.css", "/traceability.js"):
            status, body = request(path)
            self.assertEqual(status, 200)
            self.assertTrue(body)
        self.assertEqual(request("/api/ledger", "POST")[0], 405)
        self.assertEqual(request("/../requirements.json")[0], 404)
        self.assertEqual(request("/api/ledger", headers={"Host": "outside.example"})[0], 403)


if __name__ == "__main__":
    unittest.main()
