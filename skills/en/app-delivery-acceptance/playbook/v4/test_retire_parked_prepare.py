import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / 'scripts')]
from acceptance_store import initialize, read_knowledge, save
from acceptance_workspace import POLICY, workspace_lease, ensure_workspace
from scene_pipeline import digest
from retire_parked_prepare import retire


class PrepareRetirementTests(unittest.TestCase):
    def test_only_prepare_failure_releases_exact_owner_without_changing_state(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder) / 'project'
            project.mkdir()
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=project, text=True).strip()
            git('init', '-q')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'user.name', 'Fixture')
            (project / 'app.txt').write_text('source\n')
            git('add', '.')
            git('commit', '-qm', 'baseline')
            revision = git('rev-parse', 'HEAD')
            aid = 'AT-parked-prepare'
            initialize(project, aid, 'Fixture', 'Tester', {'targets': ['fixture']}, 'fixture')
            binding = read_knowledge(project, aid, [])['acceptance']
            base = {'acceptance': binding, 'workspace_policy': POLICY, 'revision': revision,
                    'test_roots': ['tests']}
            output = project / '.acceptance-local' / aid / 'workflows' / 'scene-1'
            handoff = output.parent / 'handoff-1'
            with workspace_lease(base, output, scene=True):
                workspace = ensure_workspace(base, project, revision)
                catalog = {**base, 'schema': 'portable-project-catalog-v1',
                           'project_root': str(workspace), 'source_hashes': {'app.txt': digest(workspace / 'app.txt')}}
                save(handoff / 'template.json', catalog)
                save(handoff / 'case.json', {'scene': {'id': 'S1'}})
                save(handoff / 'guide.json', {'summary': 'fixture'})
                config = {**base, 'schema': 'isolated-scene-pipeline-v1',
                          'project_root': str(workspace), 'output_dir': str(output),
                          'case_input': str(handoff / 'case.json'), 'guide': str(handoff / 'guide.json'),
                          'template_catalog': str(handoff / 'template.json')}
                save(handoff / 'config.json', config)
                save(output / 'request.frozen.json', {'request': 'frozen'})
                state = {'schema': 'isolated-scene-pipeline-state-v1',
                         'config_sha256': digest(handoff / 'config.json'),
                         'bindings': {key: digest(config[key]) for key in
                                      ('case_input', 'guide', 'template_catalog')},
                         'stages': {'prepare': {'status': 'parked', 'error': 'capability check failed'}}}
                save(output / 'state.json', state)
            config_path = handoff / 'config.json'
            (output / 'unexpected.json').write_text('{}\n')
            with self.assertRaisesRegex(ValueError, 'other effects'):
                retire(config_path, 'inspected')
            (output / 'unexpected.json').unlink()
            state_sha = digest(output / 'state.json')
            receipt = retire(config_path, 'Inspected failed capability check and workspace effects')
            self.assertIsNone(receipt['business_verdict'])
            self.assertEqual(receipt['state_sha256'], state_sha)
            self.assertEqual(digest(output / 'state.json'), state_sha)
            self.assertFalse((project / '.acceptance-local' / aid / 'workspace-owner.json').exists())
            self.assertEqual(retire(config_path, receipt['basis']), receipt)


if __name__ == '__main__':
    unittest.main()
