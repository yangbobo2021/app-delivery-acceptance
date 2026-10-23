import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import case_evaluation
import existing_case_policy
import scene_pipeline
import review_repair_loop


class ExistingCasesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for args in [('init', '-q'), ('config', 'user.email', 'test@example.invalid'),
                     ('config', 'user.name', 'Test')]:
            subprocess.run(['git', *args], cwd=self.root, check=True)
        (self.root / 'test.py').write_text('assert 1 + 1 == 2\n')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'fixture'], cwd=self.root, check=True)
        self.catalog = {'project_root': str(self.root)}
        self.baseline = existing_case_policy.snapshot(self.catalog)

    def test_existing_test_can_really_run_without_changing_source(self):
        subprocess.run(['python3', 'test.py'], cwd=self.root, check=True)
        existing_case_policy.verify(self.catalog, self.baseline, {'test_files': ['test.py']})

    def test_rejects_changed_existing_test(self):
        (self.root / 'test.py').write_text('assert True\n')
        with self.assertRaisesRegex(ValueError, 'forbids'):
            existing_case_policy.verify(self.catalog, self.baseline)

    def test_rejects_added_test(self):
        (self.root / 'new_test.py').write_text('assert True\n')
        with self.assertRaisesRegex(ValueError, 'forbids'):
            existing_case_policy.verify(self.catalog, self.baseline)

    def test_rejects_deleted_test(self):
        (self.root / 'test.py').unlink()
        with self.assertRaisesRegex(ValueError, 'forbids'):
            existing_case_policy.verify(self.catalog, self.baseline)

    def test_rejects_nonexistent_returned_file(self):
        with self.assertRaisesRegex(ValueError, 'not present'):
            existing_case_policy.verify(self.catalog, self.baseline, {'test_files': ['new.py']})

    def test_component_test_changes_are_also_protected(self):
        component = self.root / 'component'
        component.mkdir()
        subprocess.run(['git', 'init', '-q'], cwd=component, check=True)
        (component / 'test.py').write_text('assert True\n')
        catalog = {**self.catalog, 'components': [{'path': 'component'}]}
        # A component checkout with the same commit may still have test edits.
        for args in [('config', 'user.email', 'test@example.invalid'), ('config', 'user.name', 'Test'),
                     ('add', '.'), ('commit', '-qm', 'component')]:
            subprocess.run(['git', *args], cwd=component, check=True)
        baseline = existing_case_policy.snapshot(catalog)
        (component / 'test.py').write_text('assert False\n')
        with self.assertRaisesRegex(ValueError, 'forbids'):
            existing_case_policy.verify(catalog, baseline)

    def test_original_and_existing_route_to_different_entrypoints(self):
        self.assertEqual(scene_pipeline.case_runner({}), 'run_case_guided_v6.mjs')
        self.assertEqual(scene_pipeline.case_runner({'case_strategy': 'existing_only'}),
                         'run_existing_case_v1.mjs')
        with self.assertRaises(ValueError):
            scene_pipeline.case_runner({'case_strategy': 'silent_fallback'})

    def test_finder_cannot_claim_local_pass_without_a_debug_run(self):
        with self.assertRaisesRegex(ValueError, 'actual debug'):
            existing_case_policy.verify_debug(self.root, {'status': 'passed_local'})
        output = self.root / 'debug/attempt-1/execution'
        output.mkdir(parents=True)
        (output / 'execution.json').write_text(json.dumps({'exit_code': 0}))
        existing_case_policy.verify_debug(self.root, {'status': 'passed_local'})

    def test_host_ready_retains_unexecuted_limit_without_fabricated_debug_receipt(self):
        existing_case_policy.verify_debug(self.root, {'status': 'host_ready'})

    def test_existing_only_does_not_start_review_repairs(self):
        review = {'status': 'repair_required', 'answer': 'review.json'}
        with patch.object(review_repair_loop, 'stage', side_effect=AssertionError('must not repair')):
            result = review_repair_loop.continue_after_review(
                {'case_strategy': 'existing_only'}, self.root, None, {}, {}, {}, self.root, {}, review)
        self.assertEqual(result['status'], 'repair_required')
        self.assertEqual(result['review'], review)


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'input.json').write_text(json.dumps({'scene': {'description': '余额不足时拒绝取款，余额不变。'}}))
        (self.root / 'catalog.json').write_text(json.dumps({'project_root': str(self.root)}))
        (self.root / 'case-answer.json').write_text('{}')
        self.config = {'case_input': str(self.root / 'input.json')}
        self.prepared = {'catalog': str(self.root / 'catalog.json')}
        self.answer = self.root / 'case-answer.json'

    def evaluate(self, run, config=None):
        return case_evaluation.describe(config or self.config, self.root, self.prepared, self.answer, run)

    def fake_agent(self, coverage='gap'):
        def run(command, **kwargs):
            output = Path(command[-1]);output.mkdir()
            (output / 'metrics.json').write_text(json.dumps({'status': 'success'}))
            (output / 'answer.json').write_text(json.dumps({'schema': 'case-evaluation-v2',
                'summary': '当前关联为空，无法验证余额不变。', 'coverage': coverage,
                'obligations': [{'id': 'O1', 'quote': '余额不足时拒绝取款，余额不变。',
                    'status': 'unsupported', 'assessment': '当前无关联用例。', 'evidence_ids': []}],
                'findings': [{'id': 'F1', 'kind': 'gap', 'obligation_ids': ['O1'],
                    'statement': '当前关联为空。', 'impact': '扣款后再拒绝的错误无法识别。',
                    'recommendation': '关联能检查余额不变的用例。', 'evidence_ids': []}],
                'case_assessments': [], 'selection_advice': '补足当前场景关联。',
                'limitations': ['仅评估当前关联。'], 'evidence': []}))
            return {'exit_code': 0}
        return run

    def test_gap_is_description_not_a_verdict_or_gate(self):
        result = self.evaluate(self.fake_agent())
        self.assertEqual(result['status'], 'available')
        self.assertTrue(result['advisory_only'])
        self.assertEqual(result['description']['coverage'], 'gap')
        self.assertNotIn('review_status', result)
        self.assertTrue((self.root / 'case-evaluation.md').is_file())
        self.assertEqual(self.answer.read_text(), '{}')

    def test_resume_reuses_description_without_another_model_call(self):
        first = self.evaluate(self.fake_agent())
        second = self.evaluate(lambda *a, **kw: self.fail('unexpected model call'))
        self.assertEqual(first, second)

    def test_timeout_does_not_block(self):
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired('evaluation', 300)
        self.assertEqual(self.evaluate(timeout)['status'], 'unavailable')

    def test_malformed_answer_does_not_block(self):
        def broken(command, **kwargs):
            p = Path(command[-1]);p.mkdir()
            (p / 'metrics.json').write_text('{')
        self.assertEqual(self.evaluate(broken)['status'], 'unavailable')

    def test_off_does_not_launch_agent(self):
        result = self.evaluate(lambda *a, **kw: self.fail('must not call'),
                               {**self.config, 'case_evaluation': False})
        self.assertEqual(result['status'], 'off')

    def test_unexpected_evaluation_exception_is_not_a_workflow_error(self):
        with patch.object(case_evaluation, 'describe', side_effect=ValueError('broken advisory')):
            result = scene_pipeline.evaluate_case(self.config, self.root, self.prepared, self.answer)
        self.assertEqual(result['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
