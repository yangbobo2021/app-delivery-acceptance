import contextlib
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
from threading import Thread
import unittest
from unittest.mock import patch

import test_serve_ledger as base_viewer

VIEWER, save = base_viewer.VIEWER, base_viewer.save


class ResultViewerTest(unittest.TestCase):
    setUp = base_viewer.LedgerViewerTest.setUp

    def new_run(self, identifier="run-1", mode="coverage"):
        with contextlib.redirect_stdout(io.StringIO()):
            VIEWER.playbook.new_run(self.root, identifier, "a" * 40, {"runtime": "fixture"}, self.selected, mode)
        return self.assets / "runs" / identifier

    def coverage(self, folder, source="services/worker.go", covered=7, total=10):
        run = json.loads((folder / "run.json").read_text())
        m = {"status": "measured", "run_id": folder.name, "revision": run["revision"], "ledger_hashes": run["ledger_hashes"],
             "environment": run["environment"], "scope": {"targets": [source], "exclusions": [], "basis": "fixture project scope"},
             "tools": [{"name": "native", "version": "1", "command": "fixture only"}], "raw_evidence": [],
             "sources": [{"path": source, "sha256": "b" * 64, "metrics": {"lines": {"covered": covered, "total": total}, "branches": {"covered": 0, "total": 0}}}], "uncovered": []}
        save(folder / "code-coverage/measurement.json", m)
        save(folder / "code-coverage/review.json", {"run_id": folder.name, "revision": run["revision"], "ledger_hashes": run["ledger_hashes"],
             "measurement_sha256": hashlib.sha256((folder / "code-coverage/measurement.json").read_bytes()).hexdigest(),
             "status": "gaps", "reason": "fixture review", "recommendations": [{"id": "GAP-1", "description": "add error recovery", "requirement_ids": ["REQ-1"]}], "state_probes": [], "dispositions": []})

    def server(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), VIEWER.handler_for(self.ledger))
        Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(path, method="GET", headers=None):
            connection = HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            value = response.status, response.read(), dict(response.getheaders())
            connection.close()
            return value
        return request

    def test_new_run_preserves_exact_design_with_hash_and_timestamp(self):
        for mode in ("standard", "coverage"):
            folder = self.new_run(mode, mode)
            run = json.loads((folder / "run.json").read_text())
            self.assertEqual(run["acceptance_mode"], mode)
            self.assertTrue(run["created_at"].endswith("+00:00"))
            for name in ("scenarios",):
                data = (folder / f"{name}.snapshot.json").read_bytes()
                self.assertEqual(data, (self.assets / f"{name}.json").read_bytes())
                self.assertEqual(hashlib.sha256(data).hexdigest(), run["ledger_hashes"][f"{name}.json"])
        self.assertEqual(len(self.ledger.snapshot()["runs"]), 2)

    def test_standard_and_legacy_ignore_malformed_optional_files(self):
        for mode in ("standard", None):
            identifier = "std" if mode else "legacy"
            folder = self.new_run(identifier, "standard")
            if mode is None:
                run = json.loads((folder / "run.json").read_text()); run.pop("acceptance_mode"); save(folder / "run.json", run)
            save(folder / "code-coverage/measurement.json", {})
            (folder / "code-coverage/measurement.json").write_text("bad JSON")
            (folder / "code-coverage/review.json").write_text("bad JSON")
        (self.assets / "code-coverage-resources.json").write_text("bad JSON")
        snapshot = self.ledger.snapshot()
        self.assertEqual(snapshot["errors"], [])
        self.assertNotIn("code-coverage-resources.json", snapshot["documents"])
        self.assertFalse(any("code-coverage/" in f["path"] for f in snapshot["artifacts"]["files"]))
        request = self.server()
        self.assertEqual(request("/artifacts/runs/std/code-coverage/measurement.json")[0], 404)
        self.assertEqual(request("/api/artifact-text/runs/legacy/code-coverage/measurement.json")[0], 404)
        self.assertEqual(request("/artifacts/code-coverage-resources.json")[0], 404)

    def test_enhanced_records_generic_source_names_and_original_reviews(self):
        for name, source in (("web", "client/components/App.tsx"), ("worker", "jobs/queue_consumer.go")):
            self.coverage(self.new_run(name), source)
        snapshot = self.ledger.snapshot()
        self.assertEqual(snapshot["errors"], [])
        for record in snapshot["runs"]:
            self.assertEqual(record["acceptance_mode"], "coverage")
            self.assertEqual(record["documents"]["code-coverage/review.json"]["recommendations"][0]["id"], "GAP-1")
            self.assertEqual(len(record["file_hashes"]["code-coverage/measurement.json"]), 64)
            self.assertTrue(record["read_consistent"])
        self.assertEqual({r["documents"]["code-coverage/measurement.json"]["sources"][0]["path"] for r in snapshot["runs"]}, {"client/components/App.tsx", "jobs/queue_consumer.go"})

    def test_enhanced_invalid_json_remains_missing_and_has_error(self):
        folder = self.new_run()
        (folder / "code-coverage").mkdir()
        (folder / "code-coverage/measurement.json").write_text('{"n": NaN}')
        snapshot = self.ledger.snapshot()
        self.assertIsNone(snapshot["runs"][0]["documents"]["code-coverage/measurement.json"])
        self.assertTrue(any(e["file"].endswith("measurement.json") for e in snapshot["errors"]))

    def test_http_artifacts_are_isolated_read_only_and_unicode_supported(self):
        folder = self.new_run("std", "standard")
        html = '<h1>Raw coverage</h1><script>parent.document.body.textContent="PWNED"</script>'
        (folder / "evidence/报告.html").write_text(html)
        (folder / "acceptance-report.md").write_text("# 验收报告\n失败一项\n")
        (folder / "evidence/check.log").write_text("observed exception")
        (folder / "evidence/raw.bin").write_bytes(b"\x00\x01")
        request = self.server()
        status, body, headers = request("/artifacts/runs/std/evidence/%E6%8A%A5%E5%91%8A.html")
        self.assertEqual(status, 200); self.assertEqual(body.decode(), html)
        self.assertIn("sandbox;", headers["Content-Security-Policy"])
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
        self.assertNotIn("script-src", headers["Content-Security-Policy"])
        status, body, _ = request("/api/artifact-text/runs/std/acceptance-report.md")
        self.assertEqual(status, 200); self.assertIn("失败", json.loads(body)["text"])
        self.assertEqual(request("/artifacts/runs/std/evidence/check.log", "HEAD")[1], b"")
        self.assertEqual(request("/artifacts/runs/std/evidence/check.log", "POST")[0], 405)
        self.assertIn("attachment", request("/artifacts/runs/std/evidence/raw.bin")[2]["Content-Disposition"])
        self.assertIn("attachment", request("/artifacts/runs/std/acceptance-report.md?download=1")[2]["Content-Disposition"])
        for path in ("/results.js", "/coverage.js"):
            self.assertEqual(request(path)[0], 200)

    def test_artifact_traversal_other_project_and_symlinks_are_unavailable(self):
        folder = self.new_run()
        outside = Path(self.temp.name) / "private.txt"; outside.write_text("PRIVATE")
        (folder / "evidence/secret.txt").symlink_to(outside)
        (folder / "evidence/internal.txt").symlink_to(self.assets / "requirements.json")
        request = self.server()
        for path in ("/artifacts/../private.txt", "/artifacts/%2e%2e/private.txt", "/api/artifact-text/%2fprivate.txt", "/artifacts/runs/run-1/evidence/secret.txt", "/artifacts/runs/run-1/evidence/internal.txt", "/artifacts/runs/run-1/evidence/%5c..%5cprivate.txt", "/artifacts/%252e%252e/private.txt"):
            self.assertEqual(request(path)[0], 404, path)
        self.assertEqual(request("/artifacts/requirements.json", headers={"Host": "outside.example"})[0], 403)
        inventory = json.dumps(self.ledger.snapshot()["artifacts"])
        self.assertNotIn("secret.txt", inventory); self.assertNotIn("internal.txt", inventory)

    def test_preview_limits_are_explicit_and_binary_is_not_text(self):
        folder = self.new_run()
        (folder / "evidence/big.log").write_bytes(b"x" * (VIEWER.TEXT_LIMIT + 1))
        (folder / "evidence/blob.bin").write_bytes(b"x")
        request = self.server()
        status, body, _ = request("/api/artifact-text/runs/run-1/evidence/big.log")
        data = json.loads(body)
        self.assertEqual(status, 200); self.assertTrue(data["truncated"])
        self.assertEqual(len(data["text"]), VIEWER.TEXT_LIMIT)
        self.assertEqual(request("/api/artifact-text/runs/run-1/evidence/blob.bin")[0], 415)
        with (folder / "evidence/oversize.bin").open("wb") as stream:
            stream.truncate(VIEWER.MAX_FILE + 1)
        self.assertEqual(request("/artifacts/runs/run-1/evidence/oversize.bin")[0], 413)

    def test_viewing_reports_does_not_change_any_artifact(self):
        folder = self.new_run(); self.coverage(folder)
        (folder / "acceptance-report.md").write_text("# fixture only")
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.assets.rglob("*") if p.is_file()}
        self.ledger.snapshot()
        self.server()("/api/artifact-text/runs/run-1/acceptance-report.md")
        after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.assets.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_selected_assets_cannot_be_relabelled_as_another_project(self):
        other = Path(self.temp.name) / "another-project"
        other.mkdir()
        with self.assertRaisesRegex(ValueError, "different project"):
            VIEWER.Ledger(other, self.selected)

    def test_coverage_file_change_during_snapshot_is_not_consistent(self):
        folder = self.new_run(); self.coverage(folder)
        original_read = self.ledger.read
        changed = False
        def racing_read(relative, errors, hashes, required=False):
            nonlocal changed
            value = original_read(relative, errors, hashes, required)
            if relative.endswith("code-coverage/measurement.json") and not changed:
                changed = True
                path = self.assets / relative
                path.write_text(path.read_text() + "\n")
            return value
        self.ledger.read = racing_read
        snapshot = self.ledger.snapshot()
        self.assertFalse(snapshot["runs"][0]["read_consistent"])
        self.assertTrue(any(e["code"] == "changing" for e in snapshot["errors"]))

    def test_large_history_does_not_hide_selected_run_reports(self):
        folder = self.new_run("latest", "standard")
        (folder / "acceptance-report.md").write_text("# selected run report")
        for i in range(20):
            junk = self.assets / "aaa-history" / f"{i}.log"
            junk.parent.mkdir(exist_ok=True)
            junk.write_text("historical evidence")
        request = self.server()
        with patch.object(VIEWER, "INVENTORY_LIMIT", 12):
            all_files = json.loads(request("/api/artifacts")[1])
            self.assertTrue(all_files["notices"])
            self.assertFalse(any(f["path"].endswith("acceptance-report.md") for f in all_files["files"]))
            selected = json.loads(request("/api/artifacts?run=latest")[1])
            self.assertTrue(any(f["path"].endswith("acceptance-report.md") for f in selected["files"]))
            self.assertTrue(all(f["run_id"] == "latest" for f in selected["files"]))
            self.assertEqual(selected["notices"], [])
        self.assertEqual(request("/api/artifacts?run=../private")[0], 404)
        self.assertEqual(request("/api/artifacts?run=missing")[0], 404)


if __name__ == "__main__":
    unittest.main()
