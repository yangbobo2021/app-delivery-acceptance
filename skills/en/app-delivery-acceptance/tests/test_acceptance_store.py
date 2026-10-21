"""Toolchain-only checks: no product cases, services, model calls or coverage reruns."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen
from unittest.mock import patch

SKILL = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SKILL / "scripts"), str(SKILL / "scripts/v3")]
from acceptance_store import (initialize, update_scope, read_knowledge, guard, validate,
                              validate_knowledge, publish_catalog, archive, read, save,
                              read_current, start_acceptance, finish_acceptance)
from project_view import ProjectView, make_server, project_html


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "project"
        self.root.mkdir()
        self.at = "AT-first"
        initialize(self.root, self.at, "First acceptance", "Tester", {"targets": ["PR-1"]}, "User request")
        self.binding = read_knowledge(self.root, self.at, [])["acceptance"]
        self.output = self.root / ".acceptance-local" / self.at / "workflows" / "first"

    def config(self):
        return {"project_root": str(self.root), "acceptance": self.binding, "test_roots": ["e2e"]}

    def test_source_child_cannot_create_read_or_view_its_own_acceptance_store(self):
        child = self.root / '.worktrees' / 'source'
        child.mkdir(parents=True)
        pointer = self.root / '.acceptance-local/current.json'
        before = (pointer.read_bytes(), pointer.stat().st_mtime_ns)
        actions = [lambda: initialize(child, 'AT-wrong', 'Wrong', 'Tester', {'targets':['fixture']}, 'Fixture'),
                   lambda: read_current(child), lambda: start_acceptance(child, self.at),
                   lambda: finish_acceptance(child, self.at), lambda: ProjectView(child),
                   lambda: guard({'acceptance': {**self.binding, 'project_root': str(child)}})]
        for action in actions:
            with self.assertRaisesRegex(ValueError, 'user project root'):
                action()
        self.assertFalse((child / '.acceptance').exists())
        self.assertFalse((child / '.acceptance-local').exists())
        self.assertEqual((pointer.read_bytes(), pointer.stat().st_mtime_ns), before)

    def test_git_worktree_rejected_before_any_store_even_without_ancestor_store(self):
        checkout = Path(self.tmp.name) / 'isolated-source'
        metadata = Path(self.tmp.name) / 'git-metadata' / 'worktrees' / 'source'
        checkout.mkdir(); metadata.mkdir(parents=True)
        (metadata / 'commondir').write_text('../..\n')
        (checkout / '.git').write_text('gitdir: '+str(metadata)+'\n')
        for action in [lambda: initialize(checkout, 'AT-wrong', 'Wrong', 'Tester', {'targets':['fixture']}, 'Fixture'),
                       lambda: read_current(checkout), lambda: ProjectView(checkout)]:
            with self.assertRaisesRegex(ValueError, 'isolated Git worktree'):
                action()
        self.assertFalse((checkout / '.acceptance-local').exists())
        self.assertFalse((checkout / '.acceptance').exists())

    def test_git_submodule_pointer_is_not_mistaken_for_a_linked_worktree(self):
        checkout = Path(self.tmp.name) / 'user-project'
        metadata = Path(self.tmp.name) / 'git-metadata' / 'modules' / 'product'
        checkout.mkdir(); metadata.mkdir(parents=True)
        (checkout / '.git').write_text('gitdir: '+str(metadata)+'\n')
        self.assertIsNone(read_current(checkout))

    def test_new_process_from_source_reports_root_instead_of_no_current_id(self):
        child = self.root / '.worktrees' / 'source'
        child.mkdir(parents=True)
        result = subprocess.run([sys.executable, str(SKILL/'scripts/acceptance_store.py'),
                                 'current', str(child)],capture_output=True,text=True,cwd=child)
        self.assertEqual(result.returncode,2)
        self.assertIn(str(self.root.resolve()),json.loads(result.stderr)['reason'])
        self.assertEqual(result.stdout,'')
        self.assertFalse((child/'.acceptance-local').exists())

    def test_workspace_store_can_use_nested_source_without_duplicate_pointer(self):
        source = self.root / '.worktrees' / 'product'
        source.mkdir(parents=True)
        config = {**self.config(), 'source_checkout': str(source)}
        self.assertEqual(guard(config, [self.output])['project_root'], str(self.root.resolve()))
        self.assertFalse((source / '.acceptance-local').exists())
        linked = self.root / 'linked-source'
        linked.symlink_to(source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            guard({**config, 'source_checkout': str(linked)}, [self.output])
        outside = Path(self.tmp.name) / 'unrelated'
        outside.mkdir()
        with self.assertRaisesRegex(ValueError, 'another project'):
            guard({**config, 'source_checkout': str(outside)}, [self.output])

    def test_current_pointer_is_discoverable_from_a_new_process(self):
        current = self.root / ".acceptance-local/current.json"
        self.assertEqual(read(current), {"acceptance_id": self.at})
        completed = subprocess.run([sys.executable, str(SKILL / "scripts/acceptance_store.py"),
                                    "current", str(self.root)], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout), {"acceptance_id": self.at})
        refreshed = read_knowledge(self.root, None, [])
        self.assertEqual(refreshed["acceptance"]["id"], self.at)

    def test_new_acceptance_cannot_replace_current_or_create_partial_record(self):
        current = self.root / ".acceptance-local/current.json"
        before = current.read_bytes()
        with self.assertRaisesRegex(ValueError, "finish it before creating"):
            initialize(self.root, "AT-other", "Other", "Tester", {"targets": ["PR-2"]}, "Request")
        self.assertEqual(current.read_bytes(), before)
        self.assertFalse((self.root / ".acceptance/AT-other").exists())
        self.assertFalse((self.root / ".acceptance-local/AT-other").exists())

    def test_finish_clears_only_pointer_and_resume_requires_explicit_start(self):
        manifest = self.root / ".acceptance" / self.at / "manifest.json"
        before = manifest.read_bytes()
        finish_acceptance(self.root, self.at)
        self.assertFalse((self.root / ".acceptance-local/current.json").exists())
        self.assertEqual(manifest.read_bytes(), before)
        self.assertTrue(Path(self.binding["knowledge_receipt"]).is_file())
        with self.assertRaisesRegex(ValueError, "no current acceptance"):
            guard(self.config(), [self.output])
        self.assertIsNone(read_current(self.root))
        start_acceptance(self.root, self.at)
        guard(self.config(), [self.output])
        before = (self.root / ".acceptance-local/current.json").read_bytes()
        start_acceptance(self.root, self.at)
        self.assertEqual((self.root / ".acceptance-local/current.json").read_bytes(), before)

    def test_wrong_config_start_or_finish_cannot_switch_active_acceptance(self):
        finish_acceptance(self.root, self.at)
        initialize(self.root, "AT-other", "Other", "Tester", {"targets": ["PR-2"]}, "Request")
        before = (self.root / ".acceptance-local/current.json").read_bytes()
        for action in (lambda: guard(self.config(), [self.output]),
                       lambda: start_acceptance(self.root, self.at),
                       lambda: finish_acceptance(self.root, self.at),
                       lambda: read_knowledge(self.root, self.at, [])):
            with self.assertRaisesRegex(ValueError, "current acceptance is AT-other"):
                action()
        self.assertEqual((self.root / ".acceptance-local/current.json").read_bytes(), before)
        self.assertFalse(self.output.exists())

    def test_invalid_or_symlink_current_pointer_never_falls_back_to_history(self):
        current = self.root / ".acceptance-local/current.json"
        save(current, {"acceptance_id": self.at, "conversation_id": "must-not-bind"})
        with self.assertRaisesRegex(ValueError, "no conversation binding"):
            guard(self.config())
        current.unlink()
        outside = Path(self.tmp.name) / "outside.json"
        save(outside, {"acceptance_id": self.at})
        current.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "symlink"):
            finish_acceptance(self.root, self.at)
        self.assertTrue(outside.exists())

    def test_concurrent_new_processes_can_start_only_one_acceptance(self):
        from concurrent.futures import ThreadPoolExecutor
        finish_acceptance(self.root, self.at)
        scope = Path(self.tmp.name) / "scope.json"
        save(scope, {"targets": ["Synthetic toolchain fixture"]})
        def create(at):
            result = subprocess.run([sys.executable, str(SKILL / "scripts/acceptance_store.py"),
                "init", str(self.root), at, "--title", at, "--owner", "Tester", "--scope", str(scope),
                "--basis", "Synthetic parallel startup"], capture_output=True, text=True)
            return at, result
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(create, ["AT-concurrent-a", "AT-concurrent-b"]))
        passed = [(at, p) for at, p in results if p.returncode == 0]
        blocked = [(at, p) for at, p in results if p.returncode != 0]
        self.assertEqual(len(passed), 1, [p.stderr for _, p in results])
        self.assertEqual(len(blocked), 1)
        self.assertEqual(read_current(self.root), passed[0][0])
        self.assertFalse((self.root / ".acceptance" / blocked[0][0]).exists())

    def test_viewing_history_and_finished_records_never_changes_current_pointer(self):
        self.catalog()
        self.trace(self.at, "passed")
        finish_acceptance(self.root, self.at)
        initialize(self.root, "AT-other", "Other", "Tester", {"targets": ["PR-2"]}, "Request")
        self.catalog("AT-other")
        current = self.root / ".acceptance-local/current.json"
        before = (current.read_bytes(), current.stat().st_mtime_ns)
        view = ProjectView(self.root)
        self.assertEqual(view.snapshot()["acceptance_id"], "AT-other")
        old = view.snapshot(self.at)
        self.assertEqual(old["current_acceptance_id"], "AT-other")
        self.assertEqual(old["project_state"]["projects"][0]["passed"], 1)
        self.assertEqual((current.read_bytes(), current.stat().st_mtime_ns), before)
        finish_acceptance(self.root, "AT-other")
        self.assertIsNone(view.snapshot(self.at)["current_acceptance_id"])
        self.assertFalse(current.exists())

    def test_public_prepare_checks_current_before_any_project_command(self):
        finish_acceptance(self.root, self.at)
        initialize(self.root, "AT-other", "Other", "Tester", {"targets": ["PR-2"]}, "Request")
        spec = self.root / "spec.json"
        save(spec, {**self.config(), "schema": "portable-project-prep-v1",
                    "setup_commands": [["should-never-run"]]})
        result = subprocess.run([sys.executable, str(SKILL / "playbook/v4/prepare_project.py"),
                                 str(spec), str(self.output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("current acceptance is AT-other", result.stderr)
        self.assertFalse(self.output.exists())

    def catalog(self, at=None):
        return publish_catalog(self.root, at or self.at, {
            "schema": "acceptance-catalog-v1", "project": {"id": "project", "label": "Test project"},
            "requirements": [{"id": "REQ-1", "text": "Requirement"}], "reverse_rules": [],
            "scenarios": [{"id": f"S{i}", "requirement_id": "REQ-1", "title": f"Scene {i}",
                           "description": "Fixture only", "priority": "P1"} for i in range(3)]})

    def trace(self, at, status):
        folder = self.root / ".acceptance-local" / at / "workflows" / "case"
        folder.mkdir(parents=True)
        (folder / "evidence.log").write_text(at)
        trace = {"schema": "delivery-trace-v1", "acceptance": {"id": at},
                 "project": {"id": "same-project", "label": "Test project", "revision": "fixture-v1", "root": str(self.root)},
                 "generated_at": "2026-10-17T01:00:00Z", "attempt_id": "attempt-1", "stage": "reviewed",
                 "requirements": [{"id": "REQ-1", "text": "Requirement"}], "reverse_rules": [],
                 "scenarios": [{"id": "S0", "requirement_id": "REQ-1", "title": "Test scene", "priority": "P1"}],
                 "bindings": [{"id": "case-1", "scenario_id": "S0", "title": "Fixture"}],
                 "case_results": [{"binding_id": "case-1", "status": "passed", "evidence_path": str(folder / "evidence.log")}],
                 "judgment": {"status": status, "reason": "Fixture"},
                 "coverage": {"status": "unavailable", "reason": "No test executed by this toolchain check"}}
        save(folder / "trace.json", trace)
        return folder

    def test_workspace_case_locations_do_not_replace_historical_result(self):
        from acceptance_store import digest
        self.catalog();self.trace(self.at, 'passed')
        local=self.root/'.acceptance-local'/self.at
        workspace=local/'workspace';(workspace/'e2e').mkdir(parents=True)
        file=workspace/'e2e/candidate.ts';file.write_text('// synthetic location fixture; never executed\n')
        save(local/'project-context.json', {'acceptance':self.binding,'source_checkout':str(workspace)})
        save(self.root/'.acceptance'/self.at/'case-catalog.json', {
            'schema':'acceptance-workspace-cases-v1','acceptance_id':self.at,
            'source_revision':'fixture-v1','scene_count':1,'file_count':1,
            'integration_status':'collected_in_acceptance_workspace_not_committed','test_execution':False,
            'cases':[{'scene_id':'S0','command':['not-executed'],
                      'files':[{'path':'e2e/candidate.ts','sha256':digest(file)}]}]})
        view=ProjectView(self.root);before=read(self.root/'.acceptance-local/current.json')
        result=view.snapshot(self.at)
        self.assertEqual(result['workspace']['path'],str(workspace.resolve()))
        self.assertEqual(result['workspace']['scene_count'],1)
        self.assertEqual(result['project_state']['projects'][0]['passed'],1)
        self.assertEqual(result['traces'][0]['workspace_case']['scene_id'],'S0')
        self.assertEqual(read(self.root/'.acceptance-local/current.json'),before)
        file.write_text('// altered candidate only; old result remains\n')
        result=view.snapshot(self.at)
        self.assertTrue(any('当前用例位置核对失败' in warning for warning in result['warnings']))
        self.assertEqual(result['project_state']['projects'][0]['passed'],1)

    def test_stable_id_new_scope_and_unchanged_old_snapshot(self):
        first = (self.root / ".acceptance" / self.at / "records/scope-0001.json").read_bytes()
        guard(self.config(), [self.output])
        update_scope(self.root, self.at, {"targets": ["PR-1", "REQ-2"]}, "User extends scope")
        with self.assertRaisesRegex(ValueError, "scope changed"):
            guard(self.config(), [self.output])
        self.binding = read_knowledge(self.root, self.at, [])["acceptance"]
        guard(self.config(), [self.output])
        state = validate(self.root, self.at)
        self.assertEqual(state["scope"]["version"], 2)
        self.assertEqual(state["manifest"]["acceptance_id"], self.at)
        self.assertEqual((self.root / ".acceptance" / self.at / "records/scope-0001.json").read_bytes(), first)

    def test_layered_knowledge_discovery_and_change_invalidation(self):
        base = self.root / ".acceptance/knowledge"
        (base / "scripts").mkdir()
        (base / "scripts/check.py").write_text("print('not run')\n")
        (base / "scripts/INDEX.md").write_text("## 职责\n复用脚本\n\n## 何时读取\n需要检查环境时\n\n[检查](check.py) — 本地检查，已验证\n")
        with self.assertRaisesRegex(ValueError, "unindexed"):
            validate_knowledge(self.root)
        with (base / "INDEX.md").open("a") as stream:
            stream.write("\n[脚本](scripts/INDEX.md) — 环境检查时读取\n")
        with self.assertRaisesRegex(ValueError, "knowledge changed"):
            guard(self.config(), [self.output])
        result = read_knowledge(self.root, self.at, ["scripts/check.py"])
        self.assertEqual(set(result["contents"]), {"INDEX.md", "scripts/INDEX.md", "scripts/check.py"})
        self.binding = result["acceptance"]
        guard(self.config(), [self.output])
        (base / "scripts/check.py").write_text("print('changed')\n")
        with self.assertRaisesRegex(ValueError, "knowledge changed"):
            guard(self.config(), [self.output])

    def test_dangling_index_and_symlink_are_rejected(self):
        base = self.root / ".acceptance/knowledge"
        with (base / "INDEX.md").open("a") as stream:
            stream.write("\n[不存在](missing.md)\n")
        with self.assertRaisesRegex(ValueError, "broken"):
            validate_knowledge(self.root)
        (base / "missing.md").symlink_to(self.root / ".gitignore")
        with self.assertRaisesRegex(ValueError, "symlink"):
            validate_knowledge(self.root)

    def test_scope_history_tampering_is_blocked(self):
        path = self.root / ".acceptance" / self.at / "records/scope-0001.json"
        value = read(path)
        value["basis"] = "changed"
        save(path, value)
        with self.assertRaisesRegex(ValueError, "pointer"):
            validate(self.root, self.at)

    def test_no_missing_identity_wrong_directory_or_hidden_formal_tests(self):
        with self.assertRaisesRegex(ValueError, "binding required"):
            guard({})
        for folder in (self.root / ".acceptance" / self.at / "workflows/x",
                       self.root / ".acceptance-local/AT-other/workflows/x", self.root / "e2e/x"):
            with self.assertRaisesRegex(ValueError, "workflow output"):
                guard(self.config(), [folder])
        bad = self.config()
        bad["test_roots"] = [".acceptance/tests"]
        with self.assertRaisesRegex(ValueError, "test roots"):
            guard(bad, [self.output])
        self.assertFalse(self.output.exists())

    def test_explicit_receipt_refresh_preserves_frozen_config(self):
        old = copy.deepcopy(self.config())
        base = self.root / ".acceptance/knowledge/INDEX.md"
        base.write_text(base.read_text() + "\nUpdated knowledge\n")
        fresh = read_knowledge(self.root, self.at, [])["acceptance"]
        with patch.dict(os.environ, {"ACCEPTANCE_KNOWLEDGE_RECEIPT": fresh["knowledge_receipt"]}):
            self.assertEqual(guard(old)["knowledge_receipt"], fresh["knowledge_receipt"])
        self.assertEqual(old["acceptance"], self.binding)

    def test_two_acceptances_isolate_results_and_complete_denominator(self):
        finish_acceptance(self.root, self.at)
        initialize(self.root, "AT-second", "Second", "Other", {"targets": ["PR-2"]}, "Other request")
        for at, result in [(self.at, "passed"), ("AT-second", "accepted_risk")]:
            self.catalog(at)
            self.trace(at, result)
        view = ProjectView(self.root)
        for at, result in [(self.at, "passed"), ("AT-second", "accepted_risk")]:
            data = view.snapshot(at)
            self.assertEqual(data["acceptance_id"], at)
            self.assertTrue(data["denominator_complete"])
            counts = data["project_state"]["projects"][0]
            self.assertEqual(counts["scenario_count"], 3)
            self.assertEqual(counts["executed_count"], 1)
            self.assertEqual(counts[result], 1)
            self.assertEqual(counts["result_count"], counts["executed_count"])
            self.assertTrue(all(t["acceptance"]["id"] == at for t in data["traces"]))
            self.assertEqual(data["coverage"][0]["scenes"], 1)
            self.assertEqual(data["coverage"][0]["scopes"]["project"]["status"], "unavailable")

    def test_archived_history_retains_bytes_and_evidence_without_local_files(self):
        self.catalog()
        source = self.trace(self.at, "passed")
        original = (source / "trace.json").read_bytes()
        result = archive(self.root, self.at, source, ["trace.json", "evidence.log"], "Explicit sanitized fixture publication")
        import shutil
        shutil.rmtree(source)
        self.assertEqual((Path(result["record"]) / "trace.json").read_bytes(), original)
        data = ProjectView(self.root).snapshot(self.at)
        trace = data["traces"][0]
        path = Path(result["record"]) / "trace.json"
        evidence = ProjectView(self.root).resolve_evidence(path, trace["case_results"][0]["evidence_path"], self.at)
        self.assertEqual(evidence.read_text(), self.at)
        self.assertEqual(data["project_state"]["projects"][0]["passed"], 1)
        evidence.write_text("tampered")
        with self.assertRaisesRegex(ValueError, "archived evidence"):
            ProjectView(self.root).snapshot(self.at)

    def test_v4_archived_request_history_and_receipt_links_are_portable(self):
        self.catalog()
        source = self.root / ".acceptance-local" / self.at / "workflows/v4-fixture"
        receipt = source / "execution/execution.json"
        save(source / "request.frozen.json", {"acceptance": self.binding, "progress_schema": "single-agent-scene-v1",
             "project": {"id": "project", "root": str(self.root), "revision": "fixture"},
             "requirements": [{"id": "REQ-1", "text": "Fixture"}], "case_catalog": [],
             "scene": {"id": "S0", "requirement_id": "REQ-1", "title": "Fixture", "priority": "P1"}})
        save(source / "case/answer.json", {"test_files": ["e2e/fixture.spec.ts"], "test_command": ["fixture-only"]})
        save(receipt, {"start_utc": "2026-10-17T01:00:00Z", "end_utc": "2026-10-17T01:00:01Z",
                      "command": ["fixture-only"], "exit_code": 0})
        (receipt.parent / "execution.log").write_text("Synthetic toolchain fixture; no product command executed")
        save(source / "review/answer.json", {"status": "passed", "summary": "Synthetic review fixture"})
        save(source / "review/input.json", {"frozen_execution_receipt": str(receipt)})
        save(source / "review/decision-gate.json", {"status": "valid", "review_status": "passed"})
        save(source / "summary.json", {"review_status": "passed", "review_path": str(source / "review/answer.json")})
        save(source / "state.json", {"stages": {}})
        files = [p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()]
        archive(self.root, self.at, source, files, "Synthetic fixture publication")
        import shutil
        shutil.rmtree(source)
        view = ProjectView(self.root)
        data = view.snapshot(self.at)
        self.assertEqual(data["project_state"]["projects"][0]["passed"], 1)
        row = next(t for t in data["project_state"]["traces"] if t.get("execution_known"))
        self.assertIn("evidence_url", row["case_results"][0])
        server = make_server(self.root)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            link = row["case_results"][0]["evidence_url"]
            raw = urlopen(f"http://127.0.0.1:{server.server_port}" + link).read().decode()
            self.assertIn("no product command executed", raw)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_bound_debug_updates_cached_view_and_survives_explicit_archive(self):
        self.catalog()
        source = self.output
        scene = {'id': 'S0', 'requirement_id': 'REQ-1', 'title': 'Fixture', 'priority': 'P1'}
        save(source / 'request.frozen.json', {'acceptance': self.binding,
             'progress_schema': 'single-agent-scene-v1',
             'project': {'id': 'project', 'root': str(self.root), 'revision': 'fixture'},
             'scene': scene, 'requirements': [{'id': 'REQ-1', 'text': 'Fixture'}], 'case_catalog': []})
        save(source / 'state.json', {'stages': {'case': {'status': 'running'}}})
        save(source / 'catalog.json', {'acceptance': self.binding,
             'project_root': str(self.root), 'revision': 'fixture'})
        save(source / 'input.json', {'acceptance': self.binding, 'scene': scene})
        contract = source / 'case/debug-contract.json'
        debug = contract.parent / 'debug'
        save(contract, {'schema': 'acceptance-debug-contract-v1', 'acceptance': self.binding,
             'project_root': str(self.root), 'revision': 'fixture', 'scene_id': 'S0',
             'catalog_path': str(source / 'catalog.json'),
             'catalog_sha256': hashlib.sha256((source / 'catalog.json').read_bytes()).hexdigest(),
             'input_path': str(source / 'input.json'),
             'input_sha256': hashlib.sha256((source / 'input.json').read_bytes()).hexdigest(),
             'debug_root': str(debug)})
        view = ProjectView(self.root)
        pointer = (self.root / '.acceptance-local/current.json').read_bytes()
        self.assertEqual(view.snapshot(self.at)['project_state']['projects'][0]['executed_count'], 0)
        receipt = debug / 'attempt-one/execution/execution.json'
        save(receipt, {'schema': 'isolated-test-execution-v1', 'cwd': str(self.root),
             'start_utc': '2026-10-17T01:00:00Z', 'end_utc': '2026-10-17T01:00:01Z',
             'command': ['fixture-only'], 'exit_code': 0, 'head_before': 'fixture', 'head_after': 'fixture',
             'test_file_sha256_before': {'e2e/fixture.py': 'fixture'},
             'log_sha256': hashlib.sha256(b'Synthetic debug; no product execution').hexdigest()})
        receipt.with_name('execution.log').write_bytes(b'Synthetic debug; no product execution')
        live = view.snapshot(self.at)
        self.assertEqual((live['project_state']['projects'][0]['executed_count'],
                          live['project_state']['projects'][0]['pending_review']), (1, 1))
        archive(self.root, self.at, source,
                [p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()],
                'Synthetic toolchain fixture; explicitly retain bound debug metadata')
        import shutil
        shutil.rmtree(source)
        data = view.snapshot(self.at)
        counts = data['project_state']['projects'][0]
        self.assertEqual((counts['executed_count'], counts['pending_review'], counts['passed']), (1, 1, 0))
        row = next(t for t in data['project_state']['traces'] if t.get('execution_known'))
        self.assertEqual(row['attempt_id'], '本地调试')
        self.assertIn('evidence_url', row['case_results'][0])
        self.assertEqual((self.root / '.acceptance-local/current.json').read_bytes(), pointer)

    def test_worktrees_are_not_scanned_and_missing_catalog_is_explicit(self):
        source = self.trace(self.at, "passed")
        (source / "checkout").mkdir()
        save(source / "checkout/trace.json", {"schema": "bad incidental file"})
        data = ProjectView(self.root).snapshot(self.at)
        self.assertEqual(len(data["traces"]), 1)
        self.assertFalse(data["denominator_complete"])
        self.assertTrue(data["warnings"])

    def test_unindexed_new_knowledge_blocks_execution_but_not_history_reading(self):
        self.catalog()
        self.trace(self.at, "passed")
        (self.root / ".acceptance/knowledge/unindexed.md").write_text("New knowledge")
        with self.assertRaisesRegex(ValueError, "unindexed"):
            guard(self.config(), [self.output])
        data = ProjectView(self.root).snapshot(self.at)
        self.assertEqual(data["project_state"]["projects"][0]["passed"], 1)
        self.assertTrue(any("历史记录保持可读" in message for message in data["warnings"]))

    def test_public_prepare_blocks_before_any_project_command(self):
        spec = self.root / "spec.json"
        save(spec, {"schema": "portable-project-prep-v1", "project_root": str(self.root),
                    "setup_commands": [["should-never-run"]]})
        out = self.root / "bad-output"
        result = subprocess.run([sys.executable, str(SKILL / "playbook/v4/prepare_project.py"), str(spec), str(out)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("acceptance binding required", result.stderr)
        self.assertFalse(out.exists())

    def test_preparation_success_keeps_identity_in_catalog(self):
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()
        git("init", "-q")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--allow-empty", "-qm", "Toolchain fixture")
        spec = self.root / "spec.json"
        save(spec, {**self.config(), "schema": "portable-project-prep-v1", "revision": git("rev-parse", "HEAD"), "source_paths": []})
        result = subprocess.run([sys.executable, str(SKILL / "playbook/v4/prepare_project.py"), str(spec), str(self.output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(read(self.output / "catalog.json")["acceptance"], self.binding)

    def test_tracked_local_artifacts_block_workflow(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        file = self.root / ".acceptance-local" / self.at / "raw.log"
        file.write_text("Local fixture")
        subprocess.run(["git", "add", "-f", str(file)], cwd=self.root, check=True)
        with self.assertRaisesRegex(ValueError, "no tracked files"):
            guard(self.config(), [self.output])

    def test_javascript_guard_uses_same_rules_without_models(self):
        helper = (SKILL / "playbook/acceptance-guard.mjs").as_uri()
        code = f"import {{acceptanceGuard}} from {json.dumps(helper)}; acceptanceGuard({{}}, []);"
        result = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("acceptance binding required", result.stderr)

    def test_http_selection_traversal_and_foreign_evidence(self):
        self.catalog()
        self.trace(self.at, "passed")
        finish_acceptance(self.root, self.at)
        initialize(self.root, "AT-second", "Second", "Other", {"targets": ["PR-2"]}, "Request")
        self.catalog("AT-second")
        self.trace("AT-second", "accepted_risk")
        server = make_server(self.root)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            options = json.load(urlopen(origin + "/api/acceptances"))["acceptances"]
            self.assertEqual({x["id"] for x in options}, {self.at, "AT-second"})
            first = json.load(urlopen(origin + "/api/traces?acceptance_id=" + self.at))
            link = first["traces"][0]["case_results"][0]["evidence_url"]
            self.assertEqual(urlopen(origin + link).read().decode(), self.at)
            with self.assertRaises(HTTPError) as caught:
                urlopen(origin + link.replace(self.at, "AT-second"))
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                urlopen(origin + "/api/traces?acceptance_id=../../escape")
            caught.exception.close()
            self.assertIn('id="acceptanceId"', urlopen(origin).read().decode())
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_generated_view_javascript_parses(self):
        import re
        script = '\n'.join(re.findall(r'<script>([\s\S]*?)</script>', project_html()))
        path = Path(self.tmp.name) / "viewer.js"
        path.write_text(script)
        subprocess.run(["node", "--check", str(path)], check=True, capture_output=True)

    def test_acceptance_list_does_not_wait_for_a_locked_result_snapshot(self):
        self.catalog()
        pointer = (self.root / '.acceptance-local/current.json').read_bytes()
        entered, release = threading.Event(), threading.Event()
        failures = []
        def slow_snapshot(view, requested=None):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('fixture release missing')
            return {'progress': {'stages': []}, 'acceptance_id': self.at}
        server = make_server(self.root)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        def results_request():
            try:
                with urlopen(origin + '/api/traces', timeout=6) as response:
                    response.read()
            except Exception as error:
                failures.append(error)
        worker = threading.Thread(target=results_request)
        try:
            with patch.object(ProjectView, '_snapshot', slow_snapshot), patch.object(
                    ProjectView, 'validated_state', side_effect=AssertionError('metadata must not validate evidence')):
                worker.start()
                self.assertTrue(entered.wait(2))
                with urlopen(origin + '/api/acceptances', timeout=2) as response:
                    data = json.load(response)
                self.assertFalse(release.is_set())
                self.assertEqual(data['acceptance_id'], self.at)
                self.assertEqual(data['current_acceptance_id'], self.at)
                self.assertEqual([x['id'] for x in data['acceptances']], [self.at])
                self.assertEqual((self.root / '.acceptance-local/current.json').read_bytes(), pointer)
                release.set()
                worker.join(3)
                self.assertFalse(failures)
        finally:
            release.set()
            if worker.ident is not None:
                worker.join(3)
            server.shutdown();server.server_close();thread.join()

    def test_rendered_switch_updates_results_coverage_and_ignores_stale_responses(self):
        path = Path(self.tmp.name) / "viewer.html"
        path.write_text(project_html())
        completed = subprocess.run(["node", str(SKILL / "tests/acceptance_view_switch.cjs"), str(path)], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)


if __name__ == "__main__":
    unittest.main()
