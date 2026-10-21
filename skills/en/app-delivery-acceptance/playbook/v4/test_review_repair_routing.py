import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / 'scripts')]
from acceptance_store import initialize, read_knowledge, save
from acceptance_workspace import POLICY, workspace_lease, ensure_workspace
from scene_pipeline import digest
import review_repair_loop
from retire_contract_rebind import retire


class RepairRoutingTests(unittest.TestCase):
    def test_needs_contract_cannot_execute_old_profile_even_with_command(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            review = root/'review.json'
            answer = root/'repair.json'
            save(review, {'status': 'repair_required', 'findings': [{'kind': 'evidence'}]})
            save(answer, {'status': 'needs_contract', 'test_command': ['python3', 'tests/old.py'],
                          'reason': 'coverage adapter changed'})
            def stage_only_repair(_path, _state, name, _action):
                self.assertEqual(name, 'review-repair-1')
                return {'answer': str(answer)}
            with patch.object(review_repair_loop, 'stage', side_effect=stage_only_repair), \
                 patch.object(review_repair_loop, 'collect_files', side_effect=AssertionError('must not execute')):
                result = review_repair_loop.continue_after_review(
                    {'max_review_repairs': 2, 'case_input': str(root/'case.json'),
                     'guide': str(root/'guide.json')}, root, root/'state.json', {},
                    {'catalog': str(root/'catalog.json')}, {}, root, {},
                    {'status': 'repair_required', 'answer': str(review)})
            self.assertEqual(result['status'], 'needs_scope_or_contract')
            self.assertIn('newly bound', result['reason'])
            self.assertFalse((root/'execution-review-1').exists())

    def test_retirement_preserves_parked_bytes_and_releases_only_matching_owner(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)/'project'
            project.mkdir()
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=project, text=True).strip()
            git('init', '-q')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'user.name', 'Fixture')
            (project/'app.txt').write_text('source\n')
            git('add', '.'); git('commit', '-qm', 'baseline')
            rev = git('rev-parse', 'HEAD')
            aid = 'AT-rebind'
            initialize(project, aid, 'Fixture', 'Tester', {'targets': ['fixture']}, 'fixture')
            binding = read_knowledge(project, aid, [])['acceptance']
            base = {'acceptance': binding, 'workspace_policy': POLICY, 'revision': rev,
                    'test_roots': ['tests']}
            output = project/'.acceptance-local'/aid/'workflows'/'scene-1'
            with workspace_lease(base, output, scene=True):
                workspace = ensure_workspace(base, project, rev)
                catalog = {**base, 'project_root': str(workspace), 'source_hashes': {}}
                save(output/'catalog.json', catalog)
                save(output/'case.json', {'scene': {'id': 'S1'}})
                save(output/'guide.json', {'summary': 'fixture'})
                save(output/'template.json', {'schema': 'portable-project-catalog-v1'})
                save(output/'review-repair-1/answer.json',
                     {'status': 'needs_contract', 'reason': 'new profile required'})
                config = {**base, 'schema': 'isolated-scene-pipeline-v1',
                          'project_root': str(workspace), 'output_dir': str(output),
                          'case_input': str(output/'case.json'), 'guide': str(output/'guide.json'),
                          'template_catalog': str(output/'template.json')}
                save(output/'config.json', config)
                state = {'schema': 'isolated-scene-pipeline-state-v1',
                         'config_sha256': digest(output/'config.json'),
                         'bindings': {key: digest(config[key]) for key in
                                      ('case_input', 'guide', 'template_catalog')},
                         'stages': {'review-repair-1': {'status': 'completed'},
                                    'execution-review-1': {'status': 'parked',
                                                           'error': 'old adapter hash mismatch'}}}
                save(output/'state.json', state)
            running = json.loads((output/'state.json').read_text())
            running['stages']['execution-review-1']['status'] = 'running'
            save(output/'state.json', running)
            with self.assertRaisesRegex(ValueError, 'still running'):
                retire(output/'config.json', 'must not retire a live stage')
            save(output/'state.json', state)
            (output/'execution-review-1').mkdir()
            with self.assertRaisesRegex(ValueError, 'reconcile its effects'):
                retire(output/'config.json', 'must not discard existing output')
            (output/'execution-review-1').rmdir()
            state_hash = digest(output/'state.json')
            record = retire(output/'config.json', 'Inspected missing execution receipt and changed adapter')
            self.assertEqual(record['business_verdict'], None)
            self.assertEqual(record['state_sha256'], state_hash)
            self.assertEqual(digest(output/'state.json'), state_hash)
            self.assertFalse((project/'.acceptance-local'/aid/'workspace-owner.json').exists())
            self.assertEqual(retire(output/'config.json', record['basis']), record)
            second = output.with_name('scene-2')
            with workspace_lease(base, second, scene=True):
                self.assertTrue((project/'.acceptance-local'/aid/'workspace-owner.json').exists())


if __name__ == '__main__':
    unittest.main()
