"""Synthetic follow-up projects: no product cases or historical evidence writes."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SKILL = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SKILL/'scripts'), str(SKILL/'scripts/v3'), str(SKILL/'playbook/v4')]
from acceptance_store import initialize, read_knowledge, read, save, archive, publish_catalog, finish_acceptance
from acceptance_workspace import workspace_lease
from prepare_project import prepare
from debug_case import create, run
from run_coverage import run_coverage
from project_view import ProjectView


class FollowupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)/'project'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        initialize(self.root, 'AT-tools', 'Synthetic toolchain', 'Tester', {'targets':['fixture']}, 'Fixture only')
        (self.root/'src.js').write_text('export const value = 1;\n')
        (self.root/'e2e').mkdir()
        (self.root/'e2e/owner.ts').write_text("import {test} from '@playwright/test';\n")
        self.git('add', '.gitignore', 'src.js', 'e2e/owner.ts')
        self.git('commit', '-qm', 'synthetic fixture')
        self.binding = read_knowledge(self.root, 'AT-tools', [])['acceptance']
        self.local = self.root/'.acceptance-local/AT-tools'
        self.work = self.local/'workflows'
        self.spec = {'schema':'portable-project-prep-v1', 'acceptance':self.binding,
                     'project_root':str(self.root), 'revision':self.git('rev-parse','HEAD'),
                     'test_roots':['e2e'], 'source_paths':['src.js'], 'coverage_test_files':['e2e/owner.ts']}
        self.work.mkdir(parents=True)
        save(self.work/'prep.json', self.spec)
        with workspace_lease(self.spec, self.work/'prep'):
            prepare(self.work/'prep.json', self.work/'prep', self.spec, (self.work/'prep.json').read_bytes())
        self.catalog_path = self.work/'prep/catalog.json'
        self.catalog = read(self.catalog_path)
        self.workspace = Path(self.catalog['project_root'])

    def git(self, *args):
        return subprocess.check_output(['git',*args],cwd=self.root,text=True).strip()

    def scene(self):
        scene = self.work/'scene'
        save(scene/'input.json', {'scene':{'id':'S1'}, 'debug_environment':{
            'fresh_env_root_key':'FIXTURE_STATE', 'fresh_env_paths':{'FIXTURE_EVIDENCE':'evidence'},
            'evidence_env_dir_keys':['FIXTURE_EVIDENCE']}})
        return scene

    def test_preparation_binds_project_fixture_and_rejects_product_overlap(self):
        self.assertEqual(self.catalog['coverage_test_files'], {'e2e/owner.ts':hashlib.sha256((self.workspace/'e2e/owner.ts').read_bytes()).hexdigest()})
        spec = {**self.spec, 'coverage_test_files':['src.js']}
        with workspace_lease(spec, self.work/'bad-prep'):
            with self.assertRaisesRegex(ValueError, 'declared test roots'):
                prepare(self.work/'prep.json', self.work/'bad-prep', spec, b'fixture')
        self.assertFalse((self.work/'bad-prep').exists())
        (self.workspace/'e2e/owner.ts').write_text('// changed synthetic fixture\n')
        with workspace_lease(self.spec, self.work/'prep'):
            with self.assertRaisesRegex(ValueError, 'catalog is immutable'):
                prepare(self.work/'prep.json', self.work/'prep', self.spec, (self.work/'prep.json').read_bytes())

    def test_debug_rejects_tmp_other_id_and_stale_binding_without_effect(self):
        scene = self.scene()
        with workspace_lease(self.catalog, scene, scene=True):
            contract = create(self.catalog_path, scene/'input.json', scene/'case/debug-contract.json')
            root = Path(contract['request_root'])
            for output in [self.root.parent/'escaped', self.root/'.acceptance-local/AT-other/workflows/attempt']:
                save(root/'request.json', {'command':[sys.executable,'-c','raise Exception("must not run")'],
                                         'files':['e2e/owner.ts'], 'output':str(output)})
                with self.assertRaisesRegex(ValueError, 'another acceptance'):
                    run(scene/'case/debug-contract.json', root/'request.json')
                self.assertFalse(output.exists())
            save(scene/'outside.json', {'command':['not-run'], 'files':['e2e/owner.ts']})
            with self.assertRaisesRegex(ValueError, 'another acceptance'):
                run(scene/'case/debug-contract.json', scene/'outside.json')
            (scene/'input.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'input binding changed'):
                run(scene/'case/debug-contract.json', root/'request.json')

    def test_debug_runs_exact_command_with_fresh_bound_state_and_preserves_failure(self):
        scene = self.scene()
        with workspace_lease(self.catalog, scene, scene=True):
            contract = create(self.catalog_path, scene/'input.json', scene/'case/debug-contract.json')
            root = Path(contract['request_root'])
            command = [sys.executable, '-c',
                'import os,pathlib; p=pathlib.Path(os.environ["FIXTURE_EVIDENCE"]); p.mkdir(); (p/"observed").write_text("synthetic only"); raise SystemExit(7)']
            save(root/'request.json', {'command':command, 'files':['e2e/owner.ts']})
            self.assertEqual(run(scene/'case/debug-contract.json', root/'request.json'), 7)
            self.assertEqual(run(scene/'case/debug-contract.json', root/'request.json'), 7)
            attempts = list(root.glob('attempt-*'))
            self.assertEqual(len(attempts), 2)
            for attempt in attempts:
                receipt = read(attempt/'execution/execution.json')
                self.assertEqual(receipt['command'], command)
                self.assertEqual(receipt['exit_code'], 7)
                self.assertEqual((attempt/'state/evidence/observed').read_text(), 'synthetic only')
            self.assertFalse((scene/'summary.json').exists())

    def test_low_level_collection_rejects_escape_even_when_request_omits_acceptance(self):
        out = self.root.parent/'escaped'
        request = {'cwd':str(self.workspace), 'output':str(out), 'prepared':str(self.work/'prepared'),
                   'scene_id':'S1','command':['must-not-run'],'files':['e2e/owner.ts']}
        active = {'acceptance':self.binding}
        with patch('coverage_registry.project_coverage',return_value=active), patch('run_coverage.subprocess.run',wraps=subprocess.run) as tool:
            with self.assertRaisesRegex(ValueError,'workflow output'):
                run_coverage(request)
            self.assertTrue(all(call.args[0][0] == 'git' for call in tool.call_args_list))
            self.assertFalse(out.exists())
            finish_acceptance(self.root, 'AT-tools')
            with self.assertRaisesRegex(ValueError,'no current'):
                run_coverage({**request, 'output':str(self.work/'allowed')})
            self.assertTrue(all(call.args[0][0] == 'git' for call in tool.call_args_list))

    def test_collector_auto_binds_owning_fixture_and_restores_it_on_executor_failure(self):
        prepared = self.work/'prepared'
        save(prepared/'prepared.json', {'files':{}, 'spec':{'source_hashes':{},
             'registry_path':str(self.work/'registry.json'),'inventory_path':str(self.work/'inventory.json')}})
        save(self.work/'inventory.json', {})
        fixture = self.workspace/'e2e/owner.ts'; original = fixture.read_bytes()
        active = {'acceptance':self.binding,'required_test_files':{'e2e/owner.ts':hashlib.sha256(original).hexdigest()}}
        (self.workspace/'e2e/case.ts').write_text('// selected synthetic case\n')
        invoked = []
        def executor(command, **kwargs):
            if '--coverage-build' in command:
                invoked.append(command)
                self.assertIn('e2e/owner.ts', command)
                self.assertIn('acceptance-coverage-fixture.ts', fixture.read_text())
                build = read(Path(command[command.index('--coverage-build')+1]))
                self.assertIn('e2e/owner.ts', build['test_import_adapters'])
            return subprocess.CompletedProcess(command, 0)
        request = {'cwd':str(self.workspace),'output':str(self.work/'execution'),'prepared':str(prepared),
                   'scene_id':'S1','command':['synthetic-executor'],'files':['e2e/case.ts']}
        with patch('coverage_registry.project_coverage',return_value=active), patch('coverage_registry.ensure_active'), patch('run_coverage.subprocess.run',side_effect=executor):
            with self.assertRaisesRegex(RuntimeError,'did not produce a receipt'):
                run_coverage(request)
        self.assertEqual(len(invoked), 1)
        self.assertEqual(fixture.read_bytes(), original)
        self.assertFalse((self.workspace/'e2e/acceptance-coverage-fixture.ts').exists())

    def frozen_scene(self):
        source = self.work/'v4'
        inventory = {'source_hashes':{'src.js':'synthetic'}, 'changed_source_paths':[], 'files':[]}
        save(source/'request.frozen.json', {'acceptance':self.binding,'progress_schema':'single-agent-scene-v1',
             'project':{'id':'p','root':str(self.workspace),'revision':'frozen'},'requirements':[{'id':'R1','text':'Synthetic'}],
             'case_catalog':[],'scene':{'id':'S1','requirement_id':'R1','title':'Fixture','priority':'P1'},'change':{'inventory':inventory}})
        save(source/'case/answer.json', {'test_files':['e2e/case.ts'],'test_command':['never-executed-fixture']})
        save(source/'execution/execution.json', {'command':['never-executed-fixture'],'exit_code':0,'start_utc':'2026-01-01T00:00:00Z','end_utc':'2026-01-01T00:00:01Z'})
        (source/'execution/execution.log').write_text('Synthetic archive fixture; no business was run')
        save(source/'review/answer.json', {'status':'passed','summary':'Synthetic read-only review fixture'})
        save(source/'review/input.json', {'frozen_execution_receipt':str(source/'execution/execution.json')})
        save(source/'review/decision-gate.json', {'status':'valid','review_status':'passed'})
        save(source/'review/metrics.json', {'finished_at':'2026-01-01T00:00:02Z'})
        save(source/'state.json', {'stages':{'review':{'status':'completed','finished_at':'2026-01-01T00:00:02Z'}}})
        save(source/'summary.json', {'review_status':'passed'})
        save(source/'coverage-report.json', {'provider':'istanbul-source-v1','status':'incomplete',
             'istanbul_path':str(source/'coverage/istanbul.json'),'capture_end':'2026-01-01T00:00:01Z'})
        publish_catalog(self.root,'AT-tools',{'schema':'acceptance-catalog-v1','project':{'id':'p'},
            'requirements':[{'id':'R1'}],'reverse_rules':[],'scenarios':[{'id':'S1','requirement_id':'R1'}]})
        return source

    def test_partial_v4_archive_cannot_shadow_live_coverage_or_confirmation_time(self):
        source = self.frozen_scene()
        archive(self.root,'AT-tools',source,['request.frozen.json','summary.json','review/answer.json'], 'Synthetic partial archive')
        with patch('project_view.summarize',return_value=[]) as summarize:
            data = ProjectView(self.root).snapshot('AT-tools')
        self.assertFalse(data['warnings'])
        self.assertEqual(data['project_state']['projects'][0]['passed'],1)
        cases = [r for r in data['progress']['previews'] if r['progress_kind']=='case']
        self.assertEqual(len(cases),1)
        self.assertEqual(cases[0]['generated_at'],'2026-01-01T00:00:02Z')
        row = next(r for r in summarize.call_args.args[0] if r.get('bindings'))
        self.assertEqual(row['coverage']['provider'],'istanbul-source-v1')
        self.assertEqual(row['change']['inventory']['source_hashes'], {'src.js':'synthetic'})
        self.assertFalse((self.local/'project-context.json').exists())

    def test_full_v4_archive_keeps_result_when_local_stage_is_removed(self):
        source = self.frozen_scene()
        archive(self.root,'AT-tools',source,[], 'Synthetic reviewed v4 metadata profile', v4_result=True)
        shutil.rmtree(source)
        with patch('project_view.summarize',return_value=[]):
            data = ProjectView(self.root).snapshot('AT-tools')
        self.assertEqual(data['project_state']['projects'][0]['passed'],1)
        self.assertFalse(data['warnings'])
        case = next(r for r in data['progress']['previews'] if r['progress_kind']=='case')
        self.assertEqual(case['generated_at'],'2026-01-01T00:00:02Z')
        self.assertIn('inventory',case['change'])

    def test_v4_archive_profile_rejects_incomplete_or_external_review_before_copy(self):
        source = self.frozen_scene()
        before = list((self.root/'.acceptance/AT-tools/records').iterdir())
        (source/'review/input.json').unlink()
        with self.assertRaises(FileNotFoundError):
            archive(self.root,'AT-tools',source,[], 'Synthetic invalid archive', v4_result=True)
        save(source/'summary.json', {'review_status':'passed','review_path':'/tmp/foreign-review.json'})
        with self.assertRaisesRegex(ValueError,'another acceptance'):
            archive(self.root,'AT-tools',source,[], 'Synthetic invalid archive', v4_result=True)
        self.assertEqual(list((self.root/'.acceptance/AT-tools/records').iterdir()), before)

    def test_existing_requirement_only_v4_recovers_only_hash_bound_inventory(self):
        source = self.frozen_scene()
        request = read(source/'request.frozen.json')
        inventory = request.pop('change')['inventory']
        save(source/'request.frozen.json', request)
        prepared = self.work/'coverage-prepared'
        save(prepared/'inventory.json', inventory)
        save(prepared/'prepared.json', {'spec':{'inventory_path':str(prepared/'inventory.json')}})
        coverage = read(source/'coverage-report.json')
        coverage.update(prepared=str(prepared), prepared_sha256=hashlib.sha256((prepared/'prepared.json').read_bytes()).hexdigest())
        save(source/'coverage-report.json', coverage)
        with patch('project_view.summarize',return_value=[]):
            data = ProjectView(self.root).snapshot('AT-tools')
        case = next(r for r in data['progress']['previews'] if r['progress_kind']=='case')
        self.assertEqual(case['change']['inventory'], inventory)
        self.assertFalse((self.local/'project-context.json').exists())
        save(prepared/'prepared.json', {'spec':{'inventory_path':str(prepared/'inventory.json')}, 'changed':True})
        with patch('project_view.summarize',return_value=[]):
            data = ProjectView(self.root).snapshot('AT-tools')
        case = next(r for r in data['progress']['previews'] if r['progress_kind']=='case')
        self.assertNotIn('inventory', case.get('change', {}))

    def test_final_review_selects_its_exact_repaired_execution_and_coverage(self):
        source = self.frozen_scene()
        save(source/'execution-review-10/execution.json', {'exit_code':7, 'end_utc':'2026-01-01T00:00:10Z'})
        (source/'execution-review-10/execution.log').write_text('Synthetic final repair fixture')
        save(source/'coverage-review-10-report.json', {'status':'incomplete','provider':'synthetic-final'})
        save(source/'case-repaired/answer.json', {'test_files':['e2e/final.ts'],'test_command':['final-fixture']})
        save(source/'review-10/answer.json', {'status':'risk','summary':'Synthetic final repair review'})
        save(source/'review-10/input.json', {
            'frozen_execution_receipt':str(source/'execution-review-10/execution.json'),
            'coverage_result_path':str(source/'coverage-review-10-report.json'),
            'agent_result_path':str(source/'case-repaired/answer.json')})
        save(source/'summary.json', {'review_status':'risk','review_path':str(source/'review-10/answer.json')})
        save(source/'review-10/metrics.json', {'finished_at':'2026-01-01T00:00:11Z'})
        save(source/'review-10/decision-gate.json', {'status':'valid','review_status':'risk'})
        record = archive(self.root,'AT-tools',source,[], 'Synthetic reviewed final repair metadata', v4_result=True)
        names = read(Path(record['record'])/'record.json')['files']
        self.assertIn('case-repaired/answer.json', names)
        self.assertIn('execution-review-10/execution.json', names)
        self.assertNotIn('execution/execution.json', names)
        with patch('project_view.summarize',return_value=[]):
            data = ProjectView(self.root).snapshot('AT-tools')
        case = next(r for r in data['progress']['previews'] if r['progress_kind']=='case')
        self.assertEqual(case['bindings'][0]['test_file'], 'e2e/final.ts')
        self.assertEqual(case['case_results'][0]['status'], 'failed')
        self.assertEqual(case['coverage']['provider'], 'synthetic-final')
        self.assertEqual(case['judgment']['status'], 'risk')


if __name__ == '__main__':
    unittest.main()
