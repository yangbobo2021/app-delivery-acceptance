"""Runtime-bound coverage publication carries the declared probe chain."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "playbook/v4"))
import acceptance_store
import coverage_protocol


class CoverageArchiveDependenciesTests(unittest.TestCase):
    def test_publishes_runtime_and_probe_dependencies_without_folder_sweep(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "workflows"
            source.mkdir()
            def save(name, value):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value) if isinstance(value, dict) else value)
                return path
            def ref(path):
                return {"path": str(path), "sha256": acceptance_store.digest(path)}
            runtime = save("runtime/runtime.json", {"schema": "project-runtime-preparation-v1"})
            plan = save("coverage/plan.json", {"schema": "project-coverage-probe-plan-v1"})
            native = save("coverage/probes/route/zero/raw/native.db", "native")
            stdout = save("coverage/probes/route/zero/adapter/stdout.txt", "{}")
            stderr = save("coverage/probes/route/zero/adapter/stderr.txt", "")
            command = save("coverage/probes/route/zero/adapter/receipt.json",
                           {"stdout": ref(stdout), "stderr": ref(stderr)})
            probe = save("coverage/probes/coverage-probes.json", {"plan": str(plan),
                "plan_sha256": acceptance_store.digest(plan), "routes": [{"probes": {"zero": {
                "status": "passed", "receipts": {"adapter": ref(command)}, "native": [ref(native)]}}}]})
            prepared = save("coverage/prepared/prepared.json", {})
            inventory = save("coverage/inventory.json", {})
            execution = save("scene/execution.json", {})
            save("scene/execution.log", "log")
            session = save("scene/coverage-session.json", {})
            report = save("scene/coverage-report.json", {})
            collector = save("scene/coverage-run.json", {"status": "measured"})
            save("coverage/probes/route/zero/raw/unlisted.txt", "must stay local")
            profile = {"spec": {"inventory_path": str(inventory),
                "runtime_manifest": str(runtime), "runtime_sha256": acceptance_store.digest(runtime),
                "probe_report": str(probe), "probe_report_sha256": acceptance_store.digest(probe)},
                "preparation_evidence": [], "adapter_files": {}, "artifact_aliases": {}}
            frozen_report = {"prepared": str(prepared.parent), "receipt_path": str(execution),
                             "raw_evidence": [], "run_evidence": ref(collector)}
            with patch.object(coverage_protocol, "verify_report", return_value=frozen_report), \
                 patch.object(coverage_protocol, "preparation", return_value=profile):
                with patch.object(acceptance_store, "read", side_effect=lambda path: {
                        "coverage_session_path": str(session)} if Path(path) == execution else
                        json.loads(Path(path).read_text())):
                    selected, _ = acceptance_store.coverage_archive_files(source, [str(report)])
            self.assertIn("runtime/runtime.json", selected)
            self.assertIn("coverage/probes/route/zero/raw/native.db", selected)
            self.assertIn("coverage/probes/route/zero/adapter/stdout.txt", selected)
            self.assertIn("scene/coverage-run.json", selected)
            self.assertNotIn("coverage/probes/route/zero/raw/unlisted.txt", selected)


if __name__ == "__main__":
    unittest.main()
