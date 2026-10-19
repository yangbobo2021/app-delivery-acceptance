"""Project coverage protocol regression using a SYNTHETIC tool, not business coverage.

The temporary unknown-language project exercises provenance and presentation only.
Its explicitly fictional native counters cannot certify any application's coverage.
No Agent, network, real project or installed external coverage tool is used.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts/v3"))
from coverage_protocol import PROTOCOL, preparation, sha, verify_report
from coverage_registry import activate
from run_coverage import run_coverage
import coverage_views

SYNTHETIC_ADAPTER = r"""
import sys,json,subprocess,hashlib
from pathlib import Path
op,request,out=sys.argv[1:];r=json.loads(Path(request).read_text());out=Path(out)
def mapped(p):return Path(r.get("artifact_map",{}).get(str(p),{}).get("path",str(p)))
def load(p):return json.loads(mapped(p).read_text())
def sha(p):return hashlib.sha256(mapped(p).read_bytes()).hexdigest()
def write(v):out.write_text(json.dumps(v))
if op=="verify-preparation":write({"status":"valid","synthetic":True})
elif op=="run":
 p=subprocess.run(r["command"],cwd=r["cwd"]);Path(r["output"],"native.json").write_text(json.dumps({"synthetic":True,"covered":2,"total":3}));write({"exit_code":p.returncode});sys.exit(p.returncode)
elif op=="finish":
 q=json.loads(Path(r["request"]).read_text());profile=json.loads(Path(q["prepared"],"prepared.json").read_text());raw=Path(q["output"],"native.json");native=json.loads(raw.read_text())
 write({"schema":"project-tool-coverage-report-v1","protocol":"project-coverage-v1","prepared":q["prepared"],"prepared_sha256":q["prepared_sha256"],"scene_id":q.get("env",{}).get("STUB_SCENE_OVERRIDE",q["scene_id"]),"revision":profile["spec"]["revision"],"source_hashes":profile["spec"]["source_hashes"],"tools":profile["tools"],"collection_relation":"same_run","status":"measured","receipt_path":r["receipt"],"execution_sha256":sha(r["receipt"]),"raw_evidence":[{"path":str(raw),"sha256":sha(raw)}],"components":[{"id":"synthetic-unknown","source_paths":["src/example.unknownlang"],"line":{"status":"measured","covered":native["covered"],"total":native["total"]},"branch":{"status":"unavailable","reason":"synthetic protocol stub supplies no branches"}}]})
elif op=="verify-report":
 report=load(r["report"]);raw=report["raw_evidence"][0];native=load(raw["path"]);ok=sha(raw["path"])==raw["sha256"] and sha(report["receipt_path"])==report["execution_sha256"] and native["covered"]==report["components"][0]["line"]["covered"] and native["total"]==report["components"][0]["line"]["total"];write({"status":"valid" if ok else "invalid"})
elif op=="summarize":
 reports=[load(p) for p in r["reports"]];write({"synthetic":True,"tools":reports[0]["tools"],"scopes":{"project":{"status":"measured","line":{"status":"measured","covered":2,"total":3},"branch":{"status":"unavailable","reason":"synthetic"}},"changed_files":{"status":"unavailable","reason":"synthetic adapter has no diff support"},"changed_lines":{"status":"unavailable","reason":"synthetic adapter has no diff support"}}})
else:raise RuntimeError(op)
"""


class ProjectCoverageProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="SYNTHETIC-coverage-protocol-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "project"
        for name in ("src", "tools", "tests"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.source = self.root / "src/example.unknownlang"
        self.source.write_text("SYNTHETIC protocol fixture; not executable application coverage\n")
        (self.root / "tests/case.py").write_text('print("SYNTHETIC case executed")\n')
        self.adapter = self.root / "tools/stub.py"
        self.adapter.write_text(SYNTHETIC_ADAPTER)
        for args in (("init", "-q"), ("config", "user.email", "fixture@example.invalid"),
                     ("config", "user.name", "SYNTHETIC protocol"), ("add", "."),
                     ("commit", "-qm", "SYNTHETIC base")):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        self.revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        self.prepared = self.base / "prepared"
        self.prepared.mkdir()
        self.inventory = self.base / "inventory.json"
        self.inventory.write_text("{}")
        self.probe = self.base / "SYNTHETIC-probe.json"
        self.probe.write_text('{"synthetic":true,"purpose":"protocol-only tool substitute"}')
        self.interpreter = self.base / 'retirable-python'
        self.interpreter.symlink_to(sys.executable)
        self.profile = {
            "schema": "project-coverage-preparation-v1",
            "entry": [str(self.interpreter), str(self.adapter)],
            "adapter_files": {"tools/stub.py": sha(self.adapter)},
            "tools": [{"name": "SYNTHETIC protocol stub", "version": "fixture-1",
                       "role": "protocol regression only, not business coverage"}],
            "spec": {"project_root": str(self.root), "revision": self.revision,
                     "source_hashes": {"src/example.unknownlang": sha(self.source)},
                     "inventory_path": str(self.inventory), "inventory_sha256": sha(self.inventory),
                     "registry_path": str(self.base / "index.json")},
            "source_dispositions": {"src/example.unknownlang": {
                "kind": "measured", "reason": "SYNTHETIC contract fixture only"}},
            "preparation_evidence": [{"path": str(self.probe), "sha256": sha(self.probe)}]}
        self.write(self.prepared / "prepared.json", self.profile)
        self.config = {"policy": "required", "protocol": PROTOCOL,
                       "prepared": str(self.prepared),
                       "prepared_sha256": sha(self.prepared / "prepared.json")}
        activate(self.prepared)
        coverage_views._cache.clear()
        self.addCleanup(coverage_views._cache.clear)

    @staticmethod
    def write(path, value):
        Path(path).write_text(json.dumps(value))

    def request(self, name, scene_override=None):
        return {"cwd": str(self.root), "output": str(self.base / name),
                "coverage": self.config, "prepared": str(self.prepared),
                "scene_id": "SCENE-1", "revision": self.revision,
                "files": ["tests/case.py"], "command": [sys.executable, "tests/case.py"],
                "env": {"STUB_SCENE_OVERRIDE": scene_override} if scene_override else {}}

    def collect(self, name="normal"):
        self.assertEqual(run_coverage(self.request(name)), 0)
        return self.base / name / "coverage-report.json"

    def trace(self, report):
        return {"project": {"id": "SYNTHETIC-project", "revision": self.revision},
                "scenarios": [{"id": "SCENE-1"}],
                "coverage": {**json.loads(report.read_text()), "report_path": str(report),
                             "capture_end": "2026-01-01T00:00:00+00:00"}}

    def test_unregistered_language_uses_frozen_recorder_and_retains_history(self):
        first = self.collect()
        report = verify_report(first)
        receipt = json.loads((first.parent / "execution.json").read_text())
        self.assertEqual(receipt["command"][:len(self.profile["entry"])], self.profile["entry"])
        self.assertEqual(report["scene_id"], "SCENE-1")
        files = [first, first.parent / "native.json", first.parent / "execution.json"]
        original = {path: sha(path) for path in files}
        self.collect("second")
        self.assertEqual({path: sha(path) for path in files}, original)
        index = json.loads((self.base / "index.json").read_text())
        self.assertEqual(len(index["entries"]), 2)
        self.assertEqual(coverage_views.summarize([self.trace(first)])[0]["scopes"]["project"]["status"], "measured")
        with self.assertRaises(FileExistsError):
            run_coverage(self.request("normal"))
        self.assertEqual({path: sha(path) for path in files}, original)

    def test_verified_archive_summary_survives_missing_runtime_module(self):
        from unittest.mock import patch
        report = self.collect()
        trace = self.trace(report)
        live = coverage_views.summarize([trace])[0]
        snapshot = {"tools": live["tools"], "scopes": live["scopes"]}
        coverage_views._cache.clear()
        with patch.object(coverage_views, "summarize_reports",
                          side_effect=ValueError("Cannot find module 'project-tool'")), \
             patch.object(coverage_views, "archived_summary", return_value=snapshot) as archived:
            result = coverage_views.summarize([trace])[0]
        self.assertEqual(result["scopes"]["project"]["status"], "measured")
        self.assertEqual(len(result["verified_reports"]), 1)
        archived.assert_called_once()

    def test_project_declared_run_metadata_is_hash_bound(self):
        report_path = self.collect()
        extra = self.base / 'collector-lifecycle.json'
        extra.write_text('{"status":"finished"}')
        report = json.loads(report_path.read_text())
        report['collector_lifecycle'] = {'path': str(extra), 'sha256': sha(extra)}
        self.write(report_path, report)
        self.assertEqual(verify_report(report_path, run_check=False)['scene_id'], 'SCENE-1')
        extra.write_text('{"status":"changed"}')
        with self.assertRaisesRegex(ValueError, 'bound file missing or changed'):
            verify_report(report_path, run_check=False)

    def test_report_for_another_scene_is_not_registered(self):
        with self.assertRaisesRegex(ValueError, "scene/profile/source"):
            run_coverage(self.request("wrong-scene", "SCENE-OTHER"))
        self.assertEqual(json.loads((self.base / "index.json").read_text())["entries"], [])

    def test_view_rejects_wrong_scene_revision_or_profile(self):
        report = self.collect()
        for kind in ("scene", "revision", "profile"):
            with self.subTest(kind=kind):
                trace = self.trace(report)
                if kind == "scene": trace["scenarios"] = [{"id": "SCENE-OTHER"}]
                if kind == "revision": trace["project"]["revision"] = "OTHER-REVISION"
                if kind == "profile": trace["coverage"]["prepared_sha256"] = "OTHER-PROFILE"
                result = coverage_views.summarize([trace])[0]
                self.assertEqual(result["scopes"]["project"]["status"], "unavailable")
                self.assertFalse(result["verified_reports"])

    def test_adapter_parent_symlink_cannot_escape_project(self):
        outside = self.base / "outside-tools"
        shutil.move(str(self.root / "tools"), outside)
        (self.root / "tools").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "outside project"):
            preparation(self.config, run_check=False)

    def test_component_source_must_belong_to_frozen_inventory(self):
        path = self.collect()
        value = json.loads(path.read_text())
        value["components"][0]["source_paths"] = ["outside-frozen-inventory.random"]
        modified = self.base / "foreign-component.json"
        self.write(modified, value)
        with self.assertRaisesRegex(ValueError, "source inventory"):
            verify_report(modified)

    def test_cache_hits_revalidate_every_frozen_evidence_binding(self):
        report = self.collect()
        trace = self.trace(report)
        for path in (report.parent / "execution.json", report.parent / "coverage-request.json",
                     self.probe, self.inventory):
            with self.subTest(path=path.name):
                coverage_views._cache.clear()
                self.assertEqual(coverage_views.summarize([trace])[0]["scopes"]["project"]["status"], "measured")
                original = path.read_bytes()
                try:
                    path.write_bytes(original + b" ")
                    result = coverage_views.summarize([trace])[0]
                    self.assertEqual(result["scopes"]["project"]["status"], "unavailable")
                    self.assertFalse(result["verified_reports"])
                finally:
                    path.write_bytes(original)

    def test_native_report_counts_and_bytes_are_actually_checked(self):
        path = self.collect()
        raw = path.parent / "native.json"
        original = raw.read_bytes()
        self.write(raw, {"synthetic": True, "covered": 3, "total": 3})
        with self.assertRaisesRegex(ValueError, "bound file"):
            verify_report(path)
        raw.write_bytes(original)
        report = json.loads(path.read_text())
        report["components"][0]["line"]["covered"] = 3
        modified = self.base / "invented-counts.json"
        self.write(modified, report)
        with self.assertRaisesRegex(ValueError, "native coverage report"):
            verify_report(modified)

    def test_unexecuted_catalog_scenes_remain_in_collection_denominator(self):
        trace=self.trace(self.collect())
        catalog={'attempt_id':'catalog','project':{'id':trace['project']['id']},
                 'scenarios':[{'id':'SCENE-1'},{'id':'NOT-YET-EXECUTED'}],
                 'coverage':{'status':'pending'}}
        rows=coverage_views.summarize([trace,catalog])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['scenes'],2)
        self.assertEqual(rows[0]['scenes_with_coverage'],1)
        self.assertEqual(rows[0]['scenes_without_collection'],1)

    def test_report_cannot_omit_a_declared_measured_source_component(self):
        second=self.root/'src/another.unknownlang'
        second.write_text('SYNTHETIC second component requiring native coverage\n')
        self.profile['spec']['source_hashes']['src/another.unknownlang']=sha(second)
        self.profile['source_dispositions']['src/another.unknownlang']={
            'kind':'measured','reason':'SYNTHETIC second runtime component'}
        self.write(self.prepared/'prepared.json',self.profile)
        self.config['prepared_sha256']=sha(self.prepared/'prepared.json')
        activate(self.prepared)
        with self.assertRaisesRegex(ValueError,'omit frozen measured source'):
            self.collect()

    def test_source_adapter_inventory_and_revision_changes_are_rejected(self):
        for file in (self.source, self.adapter, self.inventory):
            with self.subTest(file=file.name):
                original = file.read_bytes()
                try:
                    file.write_bytes(original + b" ")
                    with self.assertRaises(ValueError):
                        run_coverage(self.request("changed-" + file.name))
                finally:
                    file.write_bytes(original)
        report = self.collect()
        value = json.loads(report.read_text())
        value["revision"] = "OTHER-REVISION"
        modified = self.base / "other-version.json"
        self.write(modified, value)
        with self.assertRaisesRegex(ValueError, "source version"):
            verify_report(modified)

    def test_new_runtime_bound_profile_rejects_stale_runtime_without_breaking_legacy(self):
        # Legacy profile above remains valid; only a new runtime-bound profile
        # requires this per-acceptance handoff and its exact bytes.
        runtime = self.base / "runtime.json"
        self.write(runtime, {"schema": "project-runtime-preparation-v1", "status": "ready",
                             "workspace": str(self.root), "revision": self.revision,
                             "acceptance": {"project_root": str(self.root), "id": "SYNTHETIC-ID",
                                            "scope_sha256": "synthetic"}})
        plan = self.base / "probe-plan.json"
        self.write(plan, {"synthetic": True})
        probe = self.base / "probe-report.json"
        ref = {"path": str(self.probe), "sha256": sha(self.probe)}
        self.write(probe, {"schema": "project-coverage-probe-report-v1", "status": "ready",
                           "runtime_sha256": sha(runtime), "workspace": str(self.root),
                           "revision": self.revision, "plan": str(plan), "plan_sha256": sha(plan),
                           "routes": [{"id": "synthetic", "source_paths": ["src/example.unknownlang"],
                                       "probes": {mode: {"status": "passed", "receipts": {"collect": ref},
                                                         "native": [ref]} for mode in ("zero", "nonzero")}}]})
        self.profile["spec"].update(runtime_manifest=str(runtime), runtime_sha256=sha(runtime),
                                     probe_report=str(probe), probe_report_sha256=sha(probe))
        self.profile["preparation_status"] = "ready"
        self.write(self.prepared / "prepared.json", self.profile)
        self.config["prepared_sha256"] = sha(self.prepared / "prepared.json")
        from unittest.mock import patch
        with patch('coverage_preparation.verify_report', return_value={"status": "ready"}):
            self.assertEqual(preparation(self.config, run_check=False)["preparation_status"], "ready")
            with patch('runtime_preparation.validate_runtime', side_effect=ValueError('stale runtime environment')):
                with self.assertRaisesRegex(ValueError, 'stale runtime environment'):
                    preparation(self.config, run_check=True)
        runtime.write_bytes(runtime.read_bytes() + b" ")
        with patch('coverage_preparation.verify_report', return_value={"status": "ready"}):
            with self.assertRaisesRegex(ValueError, "bound file missing or changed"):
                preparation(self.config, run_check=False)

    def test_archived_mapping_keeps_view_usable_after_original_paths_disappear(self):
        report = self.collect()
        trace = self.trace(report)
        archive = self.base / "archive"
        archive.mkdir()
        originals = [p for p in self.base.rglob("*") if p.is_file()
                     and ".git" not in p.relative_to(self.base).parts
                     and "archive" not in p.relative_to(self.base).parts]
        mapping = {}
        for number, original in enumerate(originals):
            target = archive / (str(number) + original.suffix)
            shutil.copy2(original, target)
            mapping[str(original)] = {"path": str(target), "sha256": sha(target)}
        for directory in (self.root, self.prepared, report.parent):
            directory.rename(directory.with_name(directory.name + "-offline"))
        for file in (self.inventory, self.probe):
            file.rename(file.with_suffix(file.suffix + ".offline"))
        # Archive metadata supplies the same immutable mapping as the public view.
        from unittest.mock import patch
        with patch.object(coverage_views, "artifact_mapping", return_value=mapping):
            result = coverage_views.summarize([trace])[0]
        self.assertEqual(result["scopes"]["project"]["status"], "measured", result)
        self.assertEqual(len(result["verified_reports"]), 1)


    def test_repaired_scene_freezes_protocol_native_evidence_then_reaches_real_gate(self):
        """Resume proved execution; run actual evidence/gate, never replay the case."""
        from unittest.mock import patch
        import review_repair_loop as repair_loop
        output = self.base / "repair-loop"
        output.mkdir()
        execution = output / "execution-review-1"
        request = self.request("unused")
        request["output"] = str(execution)
        self.assertEqual(run_coverage(request), 0)
        receipt_path = execution / "execution.json"
        receipt_bytes = receipt_path.read_bytes()
        receipt = json.loads(receipt_bytes)
        native_path = execution / "native.json"
        native_bytes = native_path.read_bytes()
        log_bytes = (execution / "execution.log").read_bytes()
        self.assertIn(b"SYNTHETIC case executed", log_bytes)
        files = sorted(receipt["test_file_sha256_after"])
        catalog = {"project_root": str(self.root), "revision": self.revision,
                   "source_hashes": self.profile["spec"]["source_hashes"],
                   "write_roots": ["tests", "tools"],
                   "coverage_test_files": self.profile["adapter_files"], "components": []}
        catalog_path = output / "catalog.json"
        self.write(catalog_path, catalog)
        repair_dir = output / "review-repair-1"
        repair_dir.mkdir()
        answer_path = repair_dir / "answer.json"
        self.write(answer_path, {"status": "passed_local", "test_files": files,
            "test_command": request["command"], "test_env": {}, "evidence_paths": [],
            "observations": ["SYNTHETIC completed repair fixture only"]})
        prior_path = output / "prior-review.json"
        self.write(prior_path, {"status": "repair_required", "findings": [{
            "kind": "case_code", "reason": "SYNTHETIC previous assertion gap",
            "requested_change": "Use the already completed synthetic repair"}]})
        original = {"requirement": {"id": "REQ-SYNTHETIC", "text": "Protocol-only handoff"},
                    "scene": {"id": "SCENE-1", "requirement_id": "REQ-SYNTHETIC"}}
        case_input = output / "case-input.json"
        self.write(case_input, original)
        guide = output / "guide.json"
        self.write(guide, {"summary": "SYNTHETIC protocol fixture"})
        config = {"case_input": str(case_input), "guide": str(guide),
                  "coverage": self.config, "max_review_repairs": 1}
        # These are existing proved stages, not fabricated execution receipts.
        state = {"stages": {
            "review-repair-1": {"status": "completed", "result": {"answer": str(answer_path)}},
            "execution-review-1": {"status": "completed", "result": {
                "receipt": str(receipt_path), "log": str(execution / "execution.log"),
                "exit_code": receipt["exit_code"], "seconds": receipt["duration_seconds"],
                "test_files": files}}}}
        state_path = output / "state.json"
        self.write(state_path, state)
        real_run = repair_loop.run

        def real_gate_only(argv, **kwargs):
            self.assertEqual(Path(argv[1]).name, "review_handoff_gate_v2.py",
                             "Only the deterministic gate may execute; case/Agent replay is forbidden")
            return real_run(argv, **kwargs)

        def synthetic_model_review(root, input_path, directory, log_path):
            review_input = json.loads(Path(input_path).read_text())
            gate = json.loads(Path(review_input["handoff_gate_path"]).read_text())
            self.assertEqual(gate["status"], "ready_for_review", gate)
            self.assertEqual(gate["receipt_sha256"], sha(receipt_path))
            self.assertEqual(review_input["frozen_execution_receipt"], str(receipt_path))
            self.assertEqual(review_input["previous_review"]["status"], "repair_required")
            directory.mkdir()
            self.write(directory / "answer.json", {"status": "inconclusive",
                "summary": "SYNTHETIC reviewer substitute; no real business verdict"})
            return {"status": "inconclusive", "answer": str(directory / "answer.json")}

        with patch.object(repair_loop, "run", side_effect=real_gate_only) as gate_call, \
             patch.object(repair_loop, "run_independent_review", side_effect=synthetic_model_review) as review_call:
            result = repair_loop.continue_after_review(
                config, output, state_path, state, {"catalog": str(catalog_path)}, catalog,
                self.root, original, {"status": "repair_required", "answer": str(prior_path)})
        self.assertEqual(result["status"], "inconclusive")
        self.assertEqual(gate_call.call_count, 1)
        self.assertEqual(review_call.call_count, 1)
        self.assertEqual(state["stages"]["evidence-review-1"]["status"], "completed")
        self.assertEqual(state["stages"]["gate-review-1"]["status"], "completed")
        self.assertEqual(state["stages"]["review-1"]["status"], "completed")
        manifest = json.loads((output / "frozen-evidence-review-1.json").read_text())
        native = next(item for item in manifest["files"] if item["source"] == str(native_path))
        self.assertNotEqual(Path(native["path"]), native_path)
        self.assertEqual(Path(native["path"]).read_bytes(), native_bytes)
        self.assertEqual(native["sha256"], sha(native_path))
        self.assertEqual(manifest["source_execution_sha256"], sha(receipt_path))
        self.assertEqual(receipt_path.read_bytes(), receipt_bytes)
        self.assertEqual((execution / "execution.log").read_bytes(), log_bytes)
        self.assertEqual(native_path.read_bytes(), native_bytes)
        # The new protocol has no legacy line_raw_path at either interface.
        frozen = json.loads((output / "coverage-review-1-report.json").read_text())
        self.assertEqual(frozen["protocol"], PROTOCOL)
        self.assertEqual(frozen["raw_evidence"][0]["sha256"], native["sha256"])

    def prepare_public_archive(self, *, adapter_alias=True, external_probe=False):
        """Real acceptance-store API; all publication assets explicitly scoped."""
        from acceptance_store import initialize, read_knowledge, publish_catalog, archive
        import copy
        acceptance_id = "AT-SYNTHETIC-protocol"
        initialize(self.root, acceptance_id, "SYNTHETIC protocol", "Regression fixture",
                   {"targets": ["REQ-1"]}, "Explicit synthetic protocol acceptance only")
        binding = read_knowledge(self.root, acceptance_id, [])["acceptance"]
        local = self.root / ".acceptance-local" / acceptance_id
        source = local / "workflows/coverage-capture"
        source.mkdir(parents=True)
        inventory = source / "inventory.json"
        shutil.copy2(self.inventory, inventory)
        probe = self.probe if external_probe else source / "SYNTHETIC-probe.json"
        if not external_probe: shutil.copy2(self.probe, probe)
        prepared = source / "prepared"
        prepared.mkdir()
        frozen = source / "frozen"
        frozen.mkdir()
        shutil.copy2(self.adapter, frozen / "adapter.py")
        shutil.copy2(self.source, frozen / "source.unknownlang")
        profile = copy.deepcopy(self.profile)
        profile["spec"].update(inventory_path=str(inventory), inventory_sha256=sha(inventory),
                               registry_path=str(source / "index.json"))
        profile["preparation_evidence"] = [{"path": str(probe), "sha256": sha(probe)}]
        profile["artifact_aliases"] = {str(self.source): str(frozen / "source.unknownlang")}
        if adapter_alias: profile["artifact_aliases"][str(self.adapter)] = str(frozen / "adapter.py")
        self.write(prepared / "prepared.json", profile)
        config = {"policy": "required", "protocol": PROTOCOL, "prepared": str(prepared),
                  "prepared_sha256": sha(prepared / "prepared.json")}
        activate(prepared)
        request = self.request("unused")
        request.update(output=str(source / "execution"), coverage=config, prepared=str(prepared))
        self.assertEqual(run_coverage(request), 0)
        publish_catalog(self.root, acceptance_id, {
            "schema": "acceptance-catalog-v1", "project": {"id": self.root.name},
            "requirements": [{"id": "REQ-1", "text": "SYNTHETIC fixture only"}],
            "reverse_rules": [], "scenarios": [{"id": "SCENE-1", "requirement_id": "REQ-1",
                "title": "SYNTHETIC scene", "description": "Protocol only", "priority": "P1"}]})
        self.write(local / "project-context.json", {"acceptance": binding,
                   "coverage_registry": str(source / "index.json")})
        business = local / "workflows/business-result"
        business.mkdir()
        (business / "evidence.log").write_text("SYNTHETIC previously confirmed defect\n")
        trace = {"schema": "delivery-trace-v1", "acceptance": {"id": acceptance_id},
                 "project": {"id": self.root.name, "root": str(self.root), "revision": self.revision},
                 "generated_at": "2025-01-01T00:00:00Z", "attempt_id": "original-business-result",
                 "stage": "reviewed", "requirements": [{"id": "REQ-1", "text": "SYNTHETIC fixture"}],
                 "reverse_rules": [], "scenarios": [{"id": "SCENE-1", "requirement_id": "REQ-1",
                                                        "title": "SYNTHETIC scene", "priority": "P1"}],
                 "bindings": [{"id": "case-1", "scenario_id": "SCENE-1", "title": "SYNTHETIC"}],
                 "case_results": [{"binding_id": "case-1", "status": "failed",
                                   "evidence_path": str(business / "evidence.log")}],
                 "judgment": {"status": "product_bug", "reason": "SYNTHETIC preserved independent conclusion"},
                 "coverage": {"status": "unavailable", "reason": "Original run had no collection"}}
        self.write(business / "trace.json", trace)
        record = archive(self.root, acceptance_id, business, ["trace.json", "evidence.log"],
                         "Reviewed SYNTHETIC business-result retention")
        business.rename(self.base / "business-result-offline")
        return acceptance_id, local, source, Path(record["record"]) / "trace.json"

    def test_public_archive_keeps_native_view_and_original_business_judgment(self):
        from acceptance_store import archive
        from project_view import ProjectView
        acceptance_id, local, source, business = self.prepare_public_archive()
        before = business.read_bytes()
        original_time = json.loads(before)["generated_at"]
        published = archive(self.root, acceptance_id, source, [], "Reviewed SYNTHETIC coverage dependencies",
                            coverage_reports=["execution/coverage-report.json"])
        record = Path(published["record"])
        self.assertTrue((record / "record.json").is_file())
        (local / "project-context.json").unlink()
        source.rename(self.base / "coverage-capture-offline")
        self.interpreter.unlink()  # Published results must outlive their runtime.
        # Frozen adapter alias must work even without the mutable project adapter.
        self.adapter.rename(self.adapter.with_suffix(".offline"))
        result = ProjectView(self.root).snapshot(acceptance_id)
        self.assertEqual(business.read_bytes(), before)
        trace = next(t for t in result["traces"] if t.get("attempt_id") == "original-business-result")
        self.assertEqual(trace["judgment"]["status"], "product_bug")
        self.assertEqual(trace["generated_at"], original_time)
        self.assertTrue(any(row["scopes"]["project"]["status"] == "measured"
                            for row in result["coverage"]), result.get("warnings"))
        self.assertTrue(trace["coverage"].get("verified"), trace["coverage"])
        measured = next(row for row in result["coverage"]
                        if row["scopes"]["project"]["status"] == "measured")
        self.assertEqual(measured["revision"], self.revision)
        self.assertEqual(measured["scopes"]["project"]["line"]["covered"], 2)
        self.assertEqual(measured["scopes"]["project"]["line"]["total"], 3)
        self.assertFalse((local / "project-context.json").exists())

    def test_tampered_archive_is_rejected_by_store_integrity_guard(self):
        from acceptance_store import archive, publish_catalog
        from project_view import ProjectView
        acceptance_id, local, source, business = self.prepare_public_archive()
        publish_catalog(self.root, acceptance_id, {
            "schema": "acceptance-catalog-v1", "project": {"id": self.root.name},
            "requirements": [{"id": "REQ-1", "text": "SYNTHETIC fixture only"}],
            "reverse_rules": [], "scenarios": [{"id": sid, "requirement_id": "REQ-1",
                "title": "SYNTHETIC " + sid, "description": "Protocol only", "priority": "P1"}
                for sid in ("SCENE-1", "SCENE-2")]})
        config = {"policy": "required", "protocol": PROTOCOL,
                  "prepared": str(source / "prepared"),
                  "prepared_sha256": sha(source / "prepared/prepared.json")}
        request = self.request("unused")
        request.update(output=str(source / "second-execution"), coverage=config,
                       prepared=str(source / "prepared"), scene_id="SCENE-2")
        self.assertEqual(run_coverage(request), 0)
        archive(self.root, acceptance_id, source, [], "Reviewed SYNTHETIC valid capture",
                coverage_reports=["execution/coverage-report.json"])
        damaged = archive(self.root, acceptance_id, source, [], "Reviewed SYNTHETIC second capture",
                          coverage_reports=["second-execution/coverage-report.json"])
        report = Path(damaged["record"]) / "second-execution/coverage-report.json"
        report.write_bytes(report.read_bytes() + b" ")  # Simulate post-publication corruption.
        (local / "project-context.json").unlink()
        source.rename(self.base / "coverage-capture-offline")
        before = business.read_bytes()
        with self.assertRaisesRegex(ValueError, "archived evidence changed or missing"):
            ProjectView(self.root).snapshot(acceptance_id)
        self.assertEqual(business.read_bytes(), before)

    def test_invalid_runtime_index_entry_does_not_hide_valid_archived_capture(self):
        from acceptance_store import archive
        from project_view import ProjectView
        acceptance_id, local, source, business = self.prepare_public_archive()
        config = {"policy": "required", "protocol": PROTOCOL,
                  "prepared": str(source / "prepared"),
                  "prepared_sha256": sha(source / "prepared/prepared.json")}
        request = self.request("unused")
        request.update(output=str(source / "second-execution"), coverage=config,
                       prepared=str(source / "prepared"), scene_id="SCENE-2")
        self.assertEqual(run_coverage(request), 0)
        archive(self.root, acceptance_id, source, [], "Reviewed SYNTHETIC valid capture",
                coverage_reports=["execution/coverage-report.json"])
        # A stale/invalid runtime index is not part of immutable publication.
        index = json.loads((source / "index.json").read_text())
        index["entries"][-1]["scene_id"] = "UNKNOWN-SCENE"
        runtime_index = local / "workflows/runtime-index.json"
        self.write(runtime_index, index)
        self.write(local / "project-context.json", {"acceptance": {
            "id": acceptance_id, "project_root": str(self.root)},
            "coverage_registry": str(runtime_index)})
        before = business.read_bytes()
        result = ProjectView(self.root).snapshot(acceptance_id)
        self.assertEqual(business.read_bytes(), before)
        verified = [item for row in result["coverage"] for item in row.get("verified_reports", [])]
        self.assertTrue(verified, result.get("warnings"))
        self.assertTrue(any("execution/coverage-report.json" in item["path"] for item in verified))
        self.assertFalse(any("second-execution" in item["path"] for item in verified))
        self.assertTrue(result.get("warnings"), "Invalid index entry must remain visible")

    def test_historical_profiles_resolve_same_adapter_path_by_frozen_hash(self):
        """Both SYNTHETIC adapters must recompute their own fictional counters."""
        from acceptance_store import archive
        from project_view import ProjectView
        import copy
        acceptance_id, local, first, business = self.prepare_public_archive()
        old_profile = json.loads((first / "prepared/prepared.json").read_text())
        old_hash = sha(first / "prepared/prepared.json")
        archive(self.root, acceptance_id, first, [], "Reviewed SYNTHETIC profile-one capture",
                coverage_reports=["execution/coverage-report.json"])
        # Upgrade bytes at exactly the same project entry path, without changing
        # frozen product source/revision. The new synthetic native tool emits 1/3.
        self.adapter.write_text(SYNTHETIC_ADAPTER.replace('"covered":2', '"covered":1'))
        second = local / "workflows/coverage-capture-v2"
        (second / "prepared").mkdir(parents=True)
        (second / "frozen").mkdir()
        shutil.copy2(first / "inventory.json", second / "inventory.json")
        shutil.copy2(first / "SYNTHETIC-probe.json", second / "SYNTHETIC-probe.json")
        shutil.copy2(self.adapter, second / "frozen/adapter.py")
        shutil.copy2(self.source, second / "frozen/source.unknownlang")
        profile = copy.deepcopy(old_profile)
        profile["adapter_files"] = {"tools/stub.py": sha(self.adapter)}
        profile["tools"][0]["version"] = "SYNTHETIC-fixture-2"
        profile["spec"].update(inventory_path=str(second / "inventory.json"),
            inventory_sha256=sha(second / "inventory.json"), registry_path=str(second / "index.json"))
        profile["preparation_evidence"] = [{"path": str(second / "SYNTHETIC-probe.json"),
                                          "sha256": sha(second / "SYNTHETIC-probe.json")}]
        profile["artifact_aliases"] = {str(self.adapter): str(second / "frozen/adapter.py"),
                                      str(self.source): str(second / "frozen/source.unknownlang")}
        self.assertNotEqual(profile["adapter_files"], old_profile["adapter_files"])
        self.write(second / "prepared/prepared.json", profile)
        new_hash = sha(second / "prepared/prepared.json")
        config = {"policy": "required", "protocol": PROTOCOL,
                  "prepared": str(second / "prepared"), "prepared_sha256": new_hash}
        activate(second / "prepared")
        request = self.request("unused")
        request.update(output=str(second / "execution"), coverage=config,
                       prepared=str(second / "prepared"))
        self.assertEqual(run_coverage(request), 0)
        archive(self.root, acceptance_id, second, [], "Reviewed SYNTHETIC profile-two capture",
                coverage_reports=["execution/coverage-report.json"])
        (local / "project-context.json").unlink()
        original_business = business.read_bytes()
        expected = {old_hash: (2, "fixture-1"), new_hash: (1, "SYNTHETIC-fixture-2")}
        for phase in ("mutable-adapter-upgraded", "original-paths-disappeared"):
            with self.subTest(phase=phase):
                if phase == "original-paths-disappeared":
                    first.rename(self.base / "profile-one-offline")
                    second.rename(self.base / "profile-two-offline")
                    self.adapter.rename(self.adapter.with_suffix(".offline"))
                coverage_views._cache.clear()  # Force both native summaries again.
                result = ProjectView(self.root).snapshot(acceptance_id)
                actual = {row.get("profile"): row for row in result["coverage"]}
                self.assertTrue(set(expected).issubset(actual), result.get("warnings"))
                for prepared_hash, (covered, version) in expected.items():
                    row = actual[prepared_hash]
                    self.assertEqual(row["revision"], self.revision)
                    self.assertEqual(row["scopes"]["project"]["status"], "measured", row)
                    self.assertEqual(row["scopes"]["project"]["line"]["covered"], covered)
                    self.assertEqual(row["scopes"]["project"]["line"]["total"], 3)
                    self.assertEqual(row["tools"][0]["version"], version)
                    self.assertEqual(len(row["verified_reports"]), 1)
                trace = next(t for t in result["traces"]
                             if t.get("attempt_id") == "original-business-result")
                self.assertEqual(trace["judgment"]["status"], "product_bug")
                self.assertEqual(business.read_bytes(), original_business)

    def test_v4_scene_publication_selects_final_repair_native_report_offline(self):
        """SYNTHETIC review metadata, real distinct initial/final native captures."""
        from acceptance_store import archive
        from coverage_evidence import freeze_coverage
        from decision_gate import validate as decision_gate
        from project_view import ProjectView
        # One prepared synthetic adapter emits request-specific native counters;
        # its summarizer reads the actual report, so wrong selection is observable.
        adapter = SYNTHETIC_ADAPTER.replace('"covered":2,"total":3',
            '"covered":int(r.get("env",{}).get("SYNTHETIC_COVERED",2)),"total":3', 1)
        adapter = adapter.replace('"covered":2,"total":3',
            '"covered":reports[0]["components"][0]["line"]["covered"],"total":3')
        self.adapter.write_text(adapter)
        self.profile["adapter_files"] = {"tools/stub.py": sha(self.adapter)}
        acceptance_id, local, source, business = self.prepare_public_archive()
        original_business = business.read_bytes()
        scene = source / "case"
        scene.mkdir()
        config = {"policy": "required", "protocol": PROTOCOL,
                  "prepared": str(source / "prepared"),
                  "prepared_sha256": sha(source / "prepared/prepared.json")}
        initial = source / "execution"
        freeze_coverage(config, self.root, initial, initial / "execution.json", scene / "coverage-report")
        final_execution = scene / "execution-review-1"
        request = self.request("unused")
        request.update(output=str(final_execution), coverage=config,
                       prepared=str(source / "prepared"), env={"SYNTHETIC_COVERED": "1"})
        self.assertEqual(run_coverage(request), 0)
        final_coverage, final_wrapper = freeze_coverage(
            config, self.root, final_execution, final_execution / "execution.json",
            scene / "coverage-review-1-report")
        initial_report = json.loads((initial / "coverage-report.json").read_text())
        self.assertEqual(initial_report["components"][0]["line"]["covered"], 2)
        self.assertEqual(final_coverage["components"][0]["line"]["covered"], 1)
        final_receipt = final_execution / "execution.json"
        receipt = json.loads(final_receipt.read_text())
        implementation = scene / "review-repair-1"
        implementation.mkdir()
        answer = implementation / "answer.json"
        self.write(answer, {"status": "passed_local", "test_files": sorted(receipt["test_file_sha256_after"]),
                           "test_command": request["command"],
                           "observations": ["SYNTHETIC repaired implementation metadata only"]})
        reviewer = scene / "review-1"
        reviewer.mkdir()
        review_input = {"scene": {"id": "SCENE-1", "requirement_id": "REQ-1"},
                        "requirement": {"id": "REQ-1", "text": "SYNTHETIC protocol fixture"},
                        "frozen_execution_receipt": str(final_receipt),
                        "frozen_execution_log": str(final_execution / "execution.log"),
                        "coverage_result_path": str(final_wrapper), "agent_result_path": str(answer)}
        self.write(reviewer / "input.json", review_input)
        review = {"status": "passed", "coverage": "SYNTHETIC protocol-only review",
                  "oracle": "Fixture declaration", "evidence": "Synthetic native capture and real receipt",
                  "findings": [], "summary": "SYNTHETIC final review substitute; no real business assertion"}
        self.write(reviewer / "answer.json", review)
        self.write(reviewer / "metrics.json", {"status": "success", "seconds": 0, "synthetic": True})
        self.write(reviewer / "decision-gate.json", decision_gate(review, review_input))
        binding = json.loads((local / "project-context.json").read_text())["acceptance"]
        self.write(scene / "request.frozen.json", {"progress_schema": "single-agent-scene-v1", "case_catalog": [],
            "acceptance": binding, "project": {"id": self.root.name, "label": "SYNTHETIC project",
                "root": str(self.root), "revision": self.revision},
            "requirements": [{"id": "REQ-1", "text": "SYNTHETIC protocol fixture"}],
            "scene": {"id": "SCENE-1", "requirement_id": "REQ-1", "title": "SYNTHETIC repair scene",
                      "priority": "P1", "description": "Protocol-only fixture"}})
        self.write(scene / "state.json", {"stages": {
            "execution-review-1": {"status": "completed", "finished_at": receipt["end_utc"]},
            "review-1": {"status": "completed", "finished_at": receipt["end_utc"]}}})
        self.write(scene / "summary.json", {"scene_id": "SCENE-1", "review_status": "passed",
                   "review_path": str(reviewer / "answer.json"),
                   "review_completion_reason": "SYNTHETIC completed repaired-review fixture"})
        published = archive(self.root, acceptance_id, source, [], "Reviewed SYNTHETIC final scene publication",
                            v4_scenes=["case"])
        record = json.loads((Path(published["record"]) / "record.json").read_text())
        self.assertEqual(record["coverage_reports"], ["case/execution-review-1/coverage-report.json"])
        self.assertNotIn("execution/native.json", record["files"])
        self.assertIn("case/execution-review-1/native.json", record["files"])
        self.assertEqual(record["files"]["case/execution-review-1/execution.json"], sha(final_receipt))
        # Native path/SHA and reviewed receipt must agree even when both attempts
        # belong to the same scene, source version and preparation profile.
        original_wrapper = final_wrapper.read_bytes()
        for mutation in ("wrong-native-hash", "initial-receipt", "wrong-scene", "wrong-version"):
            with self.subTest(mutation=mutation):
                value = json.loads(original_wrapper)
                if mutation == "wrong-native-hash": value["report_path"] = str(initial / "coverage-report.json")
                if mutation == "initial-receipt":
                    value.update(report_path=str(initial / "coverage-report.json"),
                                 report_sha256=sha(initial / "coverage-report.json"),
                                 execution_sha256=initial_report["execution_sha256"])
                if mutation == "wrong-scene": value["scene_id"] = "OTHER-SCENE"
                if mutation == "wrong-version": value["revision"] = "OTHER-REVISION"
                self.write(final_wrapper, value)
                try:
                    with self.assertRaises(ValueError):
                        archive(self.root, acceptance_id, source, [], "SYNTHETIC mismatched final selection",
                                v4_scenes=["case"])
                finally:
                    final_wrapper.write_bytes(original_wrapper)
        (local / "project-context.json").unlink()
        source.rename(self.base / "final-scene-originals-offline")
        self.adapter.rename(self.adapter.with_suffix(".offline"))
        coverage_views._cache.clear()
        result = ProjectView(self.root).snapshot(acceptance_id)
        measured = next(row for row in result["coverage"] if row["scopes"]["project"]["status"] == "measured")
        self.assertEqual(measured["revision"], self.revision)
        self.assertEqual(measured["profile"], config["prepared_sha256"])
        self.assertEqual(measured["scopes"]["project"]["line"]["covered"], 1)
        self.assertEqual(measured["scopes"]["project"]["line"]["total"], 3)
        self.assertEqual(len(measured["verified_reports"]), 1)
        final = next(row for row in result["progress"]["previews"]
                     if row.get("scenarios", [{}])[0].get("id") == "SCENE-1")
        self.assertEqual(final["judgment"]["status"], "passed")
        self.assertEqual(final["coverage"]["execution_sha256"], record["files"]["case/execution-review-1/execution.json"])
        self.assertEqual(business.read_bytes(), original_business)

    def test_public_archive_rejects_external_dependency_before_copying(self):
        from acceptance_store import archive
        acceptance_id, local, source, business = self.prepare_public_archive(external_probe=True)
        shared_records = self.root / ".acceptance" / acceptance_id / "records"
        before = sorted(p.name for p in shared_records.iterdir())
        with self.assertRaises(ValueError):
            archive(self.root, acceptance_id, source, [], "SYNTHETIC external dependency rejection",
                    coverage_reports=["execution/coverage-report.json"])
        self.assertEqual(sorted(p.name for p in shared_records.iterdir()), before)

    def test_public_archive_requires_frozen_adapter_alias(self):
        from acceptance_store import archive
        acceptance_id, local, source, business = self.prepare_public_archive(adapter_alias=False)
        with self.assertRaisesRegex(ValueError, "frozen project adapter"):
            archive(self.root, acceptance_id, source, [], "SYNTHETIC missing frozen adapter rejection",
                    coverage_reports=["execution/coverage-report.json"])


if __name__ == "__main__":
    unittest.main()
