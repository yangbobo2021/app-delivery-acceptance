"""The live view must not turn old review artifacts into current judgments."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from progress_views import collect
from coverage_views import summarize
from serve import coverage_inputs


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False))


class ProgressViewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = {'id': 'test-project', 'label': 'Test project', 'root': str(self.root)}
        self.requirement = {'id': 'REQ-1', 'text': 'Add a task'}
        self.scene = {'id': 'SC-1', 'requirement_id': 'REQ-1', 'title': 'Add task',
                      'description': 'The task is saved', 'priority': 'P0'}

    def test_frozen_input_and_scenario_review_freshness(self):
        analysis = self.root / 'analysis'
        save(analysis / 'request.frozen.json', {'project': self.project, 'mode': 'create',
                                                'requirements': [self.requirement]})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][0]['state'], 'queued')
        self.assertEqual(progress['previews'][0]['requirements'], [self.requirement])
        save(analysis / 'terminal.json', {'state': 'blocked', 'reason': 'Missing requirement decision'})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][0]['state'], 'blocked')
        self.assertEqual(progress['stages'][0]['blocker'], 'Missing requirement decision')
        self.assertTrue(progress['stages'][0]['finished'])

        scenario = self.root / 'scenario'
        save(scenario / 'request.frozen.json', {'project': self.project,
             'target_requirement_id': 'REQ-1', 'scenario_kind': 'BLACK_BOX',
             'requirements': [self.requirement]})
        source = scenario / 'scenarios.current.json'
        save(source, {'scenarios': [self.scene]})
        save(scenario / 'review.current.json', {'status': 'approved',
             'scenarios_sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][1]['state'], 'done')
        self.assertEqual(progress['previews'][1]['stage'], 'scenario_approved')
        save(source, {'scenarios': [{**self.scene, 'description': 'Changed before re-review'}]})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][1]['state'], 'running')
        self.assertEqual(progress['previews'][1]['judgment']['status'], 'not_run')

    def test_new_attempt_waits_for_its_own_review(self):
        folder = self.root / 'case'
        save(folder / 'request.frozen.json', {'project': self.project, 'scene': self.scene,
             'requirements': [self.requirement], 'case_catalog': [
                 {'id': 'CASE-1', 'title': 'Existing test', 'kind': 'automated'}]})
        save(folder / 'plan.current.json', {'cases': [{'catalog_id': 'CASE-1'}]})
        first = folder / 'attempt-1' / 'execution.json'
        save(first, {'case_results': [{'binding_id': 'CASE-1', 'status': 'failed'}]})
        save(folder / 'review.current.json', {'status': 'repair_required',
             'execution_sha256': hashlib.sha256(first.read_bytes()).hexdigest(),
             'reason': 'The test oracle is insufficient'})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][0]['state'], 'repair')
        self.assertFalse(progress['stages'][0]['finished'])
        self.assertEqual(progress['previews'][0]['judgment']['status'], 'repair_required')

        second = folder / 'attempt-2' / 'execution.json'
        save(second, {'case_results': [{'binding_id': 'CASE-1', 'status': 'passed'}]})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][0]['state'], 'running')
        self.assertEqual(progress['stages'][0]['attempt'], 2)
        self.assertEqual(progress['previews'][0]['judgment']['status'], 'pending_review')
        self.assertEqual(progress['previews'][0]['attempt_id'], '第 2 次尝试')

        save(folder / 'review.current.json', {'status': 'passed',
             'execution_sha256': hashlib.sha256(second.read_bytes()).hexdigest()})
        progress = collect([self.root], [])
        self.assertEqual(progress['previews'][0]['judgment']['status'], 'passed')

    def test_cumulative_coverage_waits_for_new_attempt(self):
        project = {**self.project, 'revision': 'v1', 'sources': ['app.py']}
        old = {'project': project, 'scenarios': [self.scene], 'attempt_id': 'attempt-1',
               'generated_at': '2026-01-01T00:00:00+00:00',
               'coverage': {'status': 'measured', 'line_files': [
                   {'path': 'app.py', 'executable_lines': [1], 'hit_lines': [1]}]}}
        current = {'project': project, 'scenarios': [self.scene], 'attempt_number': 2,
                   'progress_kind': 'case', 'attempt_id': '第 2 次尝试',
                   'generated_at': '2026-01-01T00:00:00+00:00',
                   'progress_updated_at': '2026-01-01T00:01:00+00:00',
                   'coverage': {'status': 'pending'}}
        rows = coverage_inputs([old], {'previews': [current]})
        self.assertEqual(rows[-1]['coverage']['status'], 'pending')
        self.assertEqual(summarize(rows)[0]['scopes']['project']['status'], 'unavailable')
        final = {**old, 'attempt_id': 'attempt-2',
                 'generated_at': '2026-01-01T00:02:00+00:00'}
        rows = coverage_inputs([old, final], {'previews': [current]})
        self.assertEqual(rows[-1]['attempt_id'], 'attempt-2')
        # These old hand-authored counters are not a verified provider report.
        self.assertEqual(summarize(rows)[0]['scopes']['project']['status'], 'unavailable')
        copied = {**current, 'attempt_number': 1, 'progress_folder': '/old-run'}
        rows = coverage_inputs([old], {'previews': [copied]}, ['/old-run'])
        self.assertEqual(len(rows), 1)
        restarted = {**current, 'attempt_number': 1, 'progress_folder': '/new-run'}
        rows = coverage_inputs([old], {'previews': [restarted]}, ['/old-run'])
        self.assertEqual(rows[-1]['coverage']['status'], 'pending')

    def test_published_trace_shows_completed_stage(self):
        folder = self.root / 'case'
        save(folder / 'request.frozen.json', {'project': self.project, 'scene': self.scene,
             'requirements': [self.requirement], 'case_catalog': []})
        save(folder / 'attempt-1' / 'trace.json', {'schema': 'delivery-trace-v1',
             'judgment': {'status': 'passed'}})
        progress = collect([self.root], [])
        self.assertEqual(progress['stages'][0]['state'], 'done')

    def test_terminal_repair_result_is_finished(self):
        folder = self.root / 'case'
        save(folder / 'request.frozen.json', {'project': self.project, 'scene': self.scene,
             'requirements': [self.requirement], 'case_catalog': []})
        save(folder / 'attempt-1' / 'trace.json', {'schema': 'delivery-trace-v1',
             'judgment': {'status': 'repair_required', 'reason': 'Test evidence needs repair'}})
        save(folder / 'terminal.json', {'state': 'repair_required'})
        stage = collect([self.root], [])['stages'][0]
        self.assertEqual(stage['state'], 'repair')
        self.assertTrue(stage['finished'])

    def test_v4_final_review_is_finished(self):
        folder = self.root / 'case'
        save(folder / 'request.frozen.json', {'project': self.project, 'scene': self.scene,
             'requirements': [self.requirement], 'case_catalog': [],
             'progress_schema': 'single-agent-scene-v1'})
        save(folder / 'summary.json', {'review_status': 'blocked',
             'review_completion_reason': 'Needs a reliable environment'})
        stage = collect([self.root], [])['stages'][0]
        self.assertEqual(stage['state'], 'blocked')
        self.assertTrue(stage['finished'])


if __name__ == '__main__':
    unittest.main()
