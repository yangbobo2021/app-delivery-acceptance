"""The live view must not turn old review artifacts into current judgments."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from progress_views import collect
from coverage_views import summarize
from serve import coverage_inputs
from project_statistics import project_state


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

    def test_explicit_stop_after_evaluation_is_not_displayed_as_running(self):
        folder = self.root / 'stopped-case'
        save(folder / 'request.frozen.json', {'progress_schema': 'single-agent-scene-v1',
             'project': self.project, 'scene': self.scene, 'requirements': [self.requirement], 'case_catalog': []})
        state = {'stopped_after': 'case-evaluation', 'stages': {
            'prepare': {'status': 'completed'}, 'case': {'status': 'completed'}}}
        save(folder / 'state.json', state)
        save(folder / 'case-evaluation.json', {'status': 'unavailable'})
        progress = collect([], [], request_paths=[folder / 'request.frozen.json'])
        self.assertEqual(progress['stages'][0]['state'], 'queued')
        self.assertIn('正式执行未开始', progress['stages'][0]['detail'])
        self.assertEqual(project_state([], progress)['projects'][0]['executed_count'], 0)
        state['stages']['execution'] = {'status': 'running'}
        save(folder / 'state.json', state)
        progress = collect([], [], request_paths=[folder / 'request.frozen.json'])
        self.assertEqual(progress['stages'][0]['state'], 'running')

    def debug_fixture(self, exit_code=0):
        """Synthetic bound receipt only; no project command is executed."""
        folder = self.root / '.acceptance-local/AT-fixture/workflows/case'
        binding = {'project_root': str(self.root), 'id': 'AT-fixture', 'scope_sha256': 'scope'}
        save(folder / 'request.frozen.json', {'acceptance': binding, 'project': self.project,
             'scene': self.scene, 'requirements': [self.requirement], 'case_catalog': [],
             'progress_schema': 'single-agent-scene-v1'})
        save(folder / 'state.json', {'stages': {'case': {'status': 'running'}}})
        catalog, input_path = folder / 'catalog.json', folder / 'input.json'
        save(catalog, {'acceptance': binding, 'project_root': str(self.root), 'revision': 'fixture-v1'})
        save(input_path, {'acceptance': binding, 'scene': self.scene})
        contract = folder / 'case/debug-contract.json'
        debug = contract.parent / 'debug'
        save(contract, {'schema': 'acceptance-debug-contract-v1', 'acceptance': binding,
             'project_root': str(self.root), 'revision': 'fixture-v1', 'scene_id': self.scene['id'],
             'catalog_path': str(catalog), 'catalog_sha256': hashlib.sha256(catalog.read_bytes()).hexdigest(),
             'input_path': str(input_path), 'input_sha256': hashlib.sha256(input_path.read_bytes()).hexdigest(),
             'debug_root': str(debug)})
        receipt = debug / 'attempt-one/execution/execution.json'
        receipt.parent.mkdir(parents=True, exist_ok=True)
        log = receipt.with_name('execution.log')
        log.write_text('Synthetic receipt fixture; no product execution.\n')
        save(receipt, {'schema': 'isolated-test-execution-v1', 'cwd': str(self.root),
             'head_before': 'fixture-v1', 'head_after': 'fixture-v1', 'command': ['fixture-only'],
             'start_utc': '2026-10-17T01:00:00Z', 'end_utc': '2026-10-17T01:00:01Z',
             'exit_code': exit_code, 'test_file_sha256_before': {'tests/fixture.py': 'fixture'},
             'test_file_sha256_after': {'tests/fixture.py': 'fixture'},
             'log_sha256': hashlib.sha256(log.read_bytes()).hexdigest()})
        return folder, contract, receipt

    def test_bound_local_debug_is_executed_but_never_independently_passed(self):
        folder, _, receipt = self.debug_fixture(exit_code=1)
        progress = collect([self.root], [])
        state = project_state([], progress)
        counts = state['projects'][0]
        self.assertEqual((counts['executed_count'], counts['pending_review']), (1, 1))
        self.assertEqual((counts['passed'], counts['product_bug']), (0, 0))
        row = next(t for t in state['traces'] if t['scenarios'])
        self.assertEqual(row['attempt_id'], '本地调试')
        self.assertEqual(row['stage'], 'local_debug_executed')
        self.assertEqual(row['bindings'][0]['command'], ['fixture-only'])
        self.assertEqual(row['case_results'][0]['evidence_path'], str(receipt.with_name('execution.log')))
        self.assertFalse((folder / 'execution/execution.json').exists())

    def test_unbound_or_tampered_debug_is_not_an_execution_fact(self):
        folder, contract, receipt = self.debug_fixture()
        original = json.loads(contract.read_text())
        invalid = [dict(original, scene_id='another-scene'),
                   dict(original, input_sha256='changed'), dict(original, catalog_sha256='changed'),
                   dict(original, acceptance={**original['acceptance'], 'id': 'AT-other'}),
                   dict(original, debug_root=str(self.root / 'unbound'))]
        for value in invalid:
            with self.subTest(value=value):
                save(contract, value)
                self.assertEqual(project_state([], collect([self.root], []))['projects'][0]['executed_count'], 0)
        save(contract, original)
        for malformed in [['not-a-contract'], {**original, 'acceptance': ['not-a-binding']}]:
            save(contract, malformed)
            self.assertEqual(project_state([], collect([self.root], []))['projects'][0]['executed_count'], 0)
        save(contract, original)
        save(folder / 'scene.current.json', {**self.scene, 'id': 'another-scene'})
        self.assertEqual(project_state([], collect([self.root], []))['projects'][0]['executed_count'], 0)
        (folder / 'scene.current.json').unlink()
        receipt.with_name('execution.log').write_text('changed log')
        self.assertEqual(project_state([], collect([self.root], []))['projects'][0]['executed_count'], 0)
        contract.unlink()
        self.assertEqual(project_state([], collect([self.root], []))['projects'][0]['executed_count'], 0)

    def test_debug_intent_alone_does_not_count_and_repeated_debug_counts_once(self):
        folder, _, receipt = self.debug_fixture()
        value = json.loads(receipt.read_text())
        receipt.unlink()
        save(receipt.with_name('execution-intent.json'), value)
        self.assertEqual(project_state([], collect([self.root], []))['projects'][0]['executed_count'], 0)
        save(receipt, value)
        save(folder / 'execution/execution.json', {'command': ['not-started']})
        second = receipt.parents[2] / 'attempt-two/execution/execution.json'
        save(second, {**value, 'end_utc': '2026-10-17T01:00:02Z'})
        second.with_name('execution.log').write_bytes(receipt.with_name('execution.log').read_bytes())
        counts = project_state([], collect([self.root], []))['projects'][0]
        self.assertEqual((counts['executed_count'], counts['pending_review']), (1, 1))

    def test_new_debug_keeps_an_earlier_confirmed_result(self):
        self.debug_fixture()
        old = {'project': {**self.project, 'revision': 'older-product'},
               'requirements': [self.requirement], 'scenarios': [self.scene],
               'generated_at': '2026-01-01T00:00:00Z', 'executed_scene_ids': [self.scene['id']],
               'judgment': {'status': 'passed', 'reason': 'Earlier independent judgment'},
               'case_results': [], 'bindings': []}
        state = project_state([old], collect([self.root], []))
        counts = state['projects'][0]
        self.assertEqual((counts['executed_count'], counts['passed'], counts['pending_review']), (1, 1, 0))
        row = next(t for t in state['traces'] if t['scenarios'])
        self.assertEqual(row['attempt_id'], '本地调试')
        self.assertEqual(row['judgment_source']['revision'], 'older-product')

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
