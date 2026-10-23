import copy
import json
from pathlib import Path
import tempfile
import unittest

from project_view import ProjectView
from acceptance_store import digest, save
from case_presentations import attach_case_presentations, case_description, static_evaluation
from progress_views import collect
from project_statistics import project_state
from test_project_statistics import item


class CasePresentationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.scene = item('S1')['scenarios'][0]
        self.shared = self.root / 'shared'
        self.folder = self.shared / 'records/descriptions/S1'
        self.associations = {'tests': [{'id': 'T1', 'file_sha256': 'a' * 64}]}
        save(self.folder / 'static-input.json', {'scene': self.scene, 'definition_binding_sha256': 'current'})
        save(self.folder / 'static-associations.json', {'associated_tests': self.associations['tests']})
        self.report = {'schema': 'case-evaluation-description-v1', 'advisory_only': True,
                       'status': 'available', 'binding': {
                           'input_sha256': digest(self.folder / 'static-input.json'),
                           'answer_sha256': digest(self.folder / 'static-associations.json')},
                       'description': {'summary': 'Independent opinion', 'coverage': 'partial',
                                       'gaps': ['missing error branch']}}
        save(self.folder / 'case-evaluation.json', self.report)

    def test_static_evaluation_is_bound_to_scene_and_exact_case_group(self):
        load = lambda scene=self.scene, a=self.associations, sha='current': static_evaluation(self.shared, scene, a, sha)
        self.assertEqual(load()['status'], 'available')
        self.assertEqual(load({**self.scene, 'title': 'changed'})['status'], 'stale')
        self.assertEqual(load(sha='changed')['status'], 'stale')
        self.assertEqual(load(a={'tests': []})['status'], 'stale')
        (self.folder / 'static-associations.json').write_text('{}')
        self.assertEqual(load()['status'], 'stale')

    def test_missing_and_corrupt_advisory_do_not_erase_cases_or_results(self):
        row = item('S1', 'passed', True)
        row['bindings'] = []
        row['static_case_associations'] = {'S1': {'tests': [{'id': 'T1', 'title': 'existing',
            'input_and_operation': 'do work', 'assertions': 'check work', 'mock_boundary': 'unit only'}]}}
        before = copy.deepcopy(row['judgment'])
        (self.folder / 'case-evaluation.json').write_text('bad JSON')
        attach_case_presentations([row], self.shared)
        presentation = row['case_presentations']['S1']
        self.assertEqual(presentation['evaluation']['status'], 'unavailable')
        self.assertEqual(presentation['cases'][0]['method'], 'do work')
        self.assertEqual(row['judgment'], before)

    def test_static_and_generated_descriptions_share_fields_without_inventing_checks(self):
        old = case_description({'id': 'old', 'title': 'Existing', 'input_and_operation': 'prepare and act',
                               'assertions': 'actual check', 'mock_boundary': 'mocked dependency'}, 'existing')
        new = case_description({'id': 'new', 'name': 'Generated', 'method': 'prepare and act',
                               'assertions': 'actual check', 'boundary': 'mocked dependency',
                               'source': {'origin': 'generated'}})
        self.assertEqual(set(old), set(new))
        for key in ['method', 'assertions', 'boundary']:
            self.assertEqual(old[key], new[key])
        self.assertEqual(case_description({'title': 'Historical', 'observations': ['ran successfully']})['assertions'], '')

    def test_display_name_keeps_original_title_and_requires_matching_source(self):
        row = item('S1')
        row['static_case_associations'] = {'S1': {'tests': [
            {'id': 'T1', 'title': 'original English title', 'file_sha256': 'a' * 64}]}}
        name = {'id': 'T1', 'name': '配置被手动修改后，重复同步保留修改内容',
                'source_title': 'original English title', 'file_sha256': 'a' * 64}
        value = {'schema': 'acceptance-case-display-v1', 'acceptance_id': self.shared.name, 'cases': [name]}
        save(self.shared / 'case-display.json', value)
        attach_case_presentations([row], self.shared)
        case = row['case_presentations']['S1']['cases'][0]
        self.assertEqual(case['name'], name['name'])
        self.assertEqual(case['source']['title'], 'original English title')
        self.assertEqual(row['judgment']['status'], 'not_run')
        save(self.shared / 'case-display.json', {**value, 'cases': [{**name, 'file_sha256': 'b' * 64}]})
        attach_case_presentations([row], self.shared)
        self.assertEqual(row['case_presentations']['S1']['cases'][0]['name'], 'original English title')
        save(self.shared / 'case-display.json', {**value, 'acceptance_id': 'AT-other'})
        attach_case_presentations([row], self.shared)
        self.assertTrue(row['case_presentations']['S1']['title_warning'])
        self.assertEqual(len(row['case_presentations']['S1']['cases']), 1)

    def test_native_case_output_and_independent_evaluation_appear_before_execution(self):
        for origin in ['existing', 'generated']:
            with self.subTest(origin=origin):
                folder = self.root / origin
                save(folder / 'request.frozen.json', {'progress_schema': 'single-agent-scene-v1',
                    'project': {'id': origin, 'root': str(self.root)}, 'scene': self.scene,
                    'case_catalog': [], 'requirements': []})
                save(folder / 'state.json', {'stages': {'case': {'status': 'completed'}}})
                answer = {'test_files': ['tests/one.py'], 'test_command': ['fixture-command'],
                          'case_descriptions': [{'id': 'T1', 'name': 'Real code check',
                          'method': 'prepare and act', 'assertions': 'actual assertion',
                          'boundary': 'unit only', 'source': {'origin': origin, 'file': 'tests/one.py'}}]}
                save(folder / 'case/answer.json', answer)
                report = {**self.report, 'binding': {'answer_sha256': digest(folder / 'case/answer.json')}}
                save(folder / 'case-evaluation.json', report)
                state = project_state([], collect([], [], request_paths=[folder / 'request.frozen.json']))
                attach_case_presentations(state['traces'])
                row = next(t for t in state['traces'] if t['scenarios'])
                p = row['case_presentations']['S1']
                self.assertEqual(p['cases'][0]['source']['origin'], origin)
                self.assertEqual(p['cases'][0]['command'], ['fixture-command'])
                self.assertEqual(p['evaluation']['description']['summary'], 'Independent opinion')
                self.assertEqual(state['projects'][0]['executed_count'], 0)
                self.assertEqual(row['judgment']['status'], 'not_run')
                save(folder / 'case/answer.json', {**answer, 'reason': 'new answer'})
                progress = collect([], [], request_paths=[folder / 'request.frozen.json'])
                self.assertEqual(progress['previews'][0]['case_evaluation']['status'], 'stale')


if __name__ == '__main__':
    unittest.main()
