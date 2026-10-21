"""Project counters must partition executed scene IDs, across attempts/versions."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from progress_views import collect
from project_statistics import project_state


def item(scene_id, status='not_run', executed=False, at='2026-01-01T00:00:00Z', **fields):
    value = {'project': {'id': 'project', 'revision': 'v1'},
             'requirements': [{'id': 'REQ-1', 'text': 'Requirement'}], 'reverse_rules': [],
             'scenarios': [{'id': scene_id, 'requirement_id': 'REQ-1', 'title': scene_id}],
             'generated_at': at, 'stage': 'reviewed', 'bindings': [], 'case_results': [],
             'judgment': {'status': status, 'reason': status}, 'coverage': {'status': 'unavailable'}}
    if executed:
        value['bindings'] = [{'id': scene_id + '-case', 'scenario_id': scene_id}]
        value['case_results'] = [{'binding_id': scene_id + '-case', 'status': 'failed'}]
    value.update(fields)
    return value


class ProjectStatisticsTests(unittest.TestCase):
    def test_full_denominator_and_exact_reconciliation(self):
        catalog = item('S001')
        catalog['scenarios'] = [item('S%03d' % i)['scenarios'][0] for i in range(1, 109)]
        catalog['requirements'] = [{'id': 'REQ-%d' % i} for i in range(1, 13)]
        catalog['reverse_rules'] = [{'id': 'RULE-1', 'status': 'needs_confirmation'},
                                    {'id': 'RULE-2', 'status': 'needs_confirmation'}]
        executed = [item('S%03d' % i, 'passed', True) for i in range(1, 24)]
        executed += [item('S024', 'accepted_risk', True)]
        # An executed audit counts, even with no completed product path.
        executed += [item('S025', 'inconclusive', executed_scene_ids=['S025'])]
        state = project_state(executed, {'previews': [catalog]})
        counts = state['projects'][0]
        self.assertEqual(counts['scenario_count'], 108)
        self.assertEqual(counts['requirement_count'], 12)
        self.assertEqual(counts['pending_rule_count'], 2)
        self.assertEqual(counts['admitted_rule_count'], 0)
        self.assertEqual(counts['executed_count'], 25)
        self.assertEqual(counts['not_executed_count'], 83)
        self.assertEqual(counts['passed'], 23)
        self.assertEqual(counts['accepted_risk'], 1)
        self.assertEqual(counts['needs_attention'], 1)
        self.assertEqual(counts['result_count'], 25)
        self.assertTrue(counts['reconciled'])

    def test_pending_rerun_preserves_prior_confirmed_result(self):
        passed = item('S1', 'passed', True)
        pending = item('S1', 'pending_review', True, at='2026-02-01T00:00:00Z',
                       project={'id': 'project', 'revision': 'v2'}, provisional=True)
        unreviewed_bug = item('S1', 'product_bug', True, at='2026-03-01T00:00:00Z',
                              provisional=True, stage='awaiting_review', project={'id': 'project', 'revision': 'v2'})
        state = project_state([passed], {'previews': [pending, unreviewed_bug]})
        counts = state['projects'][0]
        self.assertEqual(counts['executed_count'], 1)
        self.assertEqual(counts['passed'], 1)
        self.assertEqual(counts['product_bug'], 0)
        row = next(t for t in state['traces'] if t['scenarios'])
        self.assertEqual(row['judgment_source']['revision'], 'v1')
        self.assertEqual(row['project']['revision'], 'v2')  # Latest execution; the verdict still cites v1.

    def test_new_confirmed_result_and_user_risk_decision_replace_old(self):
        passed = item('S1', 'passed', True)
        bug = item('S1', 'product_bug', True, at='2026-02-01T00:00:00Z')
        risk = item('S1', 'accepted_risk', at='2026-03-01T00:00:00Z',
                    judgment={'status': 'accepted_risk', 'reason': 'Explicit user decision'})
        state = project_state([passed, bug, risk], {})
        counts = state['projects'][0]
        self.assertEqual(counts['passed'], 0)
        self.assertEqual(counts['product_bug'], 0)
        self.assertEqual(counts['accepted_risk'], 1)
        self.assertEqual(counts['result_count'], counts['executed_count'])

    def test_all_categories_are_disjoint_and_unexecuted_blocker_is_excluded(self):
        statuses = ['passed', 'product_bug', 'accepted_risk', 'repair_required', 'blocked', 'inconclusive', 'pending_review']
        inputs = [item('S%d' % i, status, True) for i, status in enumerate(statuses)]
        inputs += [item('not-started', 'blocked'), item('generated-only', 'not_run')]
        counts = project_state(inputs, {})['projects'][0]
        self.assertEqual([counts[k] for k in ['passed', 'product_bug', 'accepted_risk', 'needs_attention', 'pending_review']], [1, 1, 1, 3, 1])
        self.assertEqual(counts['executed_count'], 7)
        self.assertEqual(counts['scenario_count'], 9)
        self.assertEqual(counts['not_executed_count'], 2)

    def test_same_scene_in_two_projects_is_not_deduplicated_across_projects(self):
        a = item('S1', 'passed', True)
        b = copy.deepcopy(a)
        b['project']['id'] = 'other-project'
        self.assertEqual(len(project_state([a, b], {})['projects']), 2)

    def test_confirmation_order_is_not_new_preparation_time(self):
        old = item('S1', 'passed', True, at='2026-04-01T00:00:00Z',
                   judgment_confirmed_at='2026-01-01T00:00:00Z')
        bug = item('S1', 'product_bug', True, at='2026-02-01T00:00:00Z',
                   judgment_confirmed_at='2026-02-01T00:00:00Z')
        self.assertEqual(project_state([old, bug], {})['projects'][0]['product_bug'], 1)

    def test_collector_retains_reviewed_execution_after_new_folder_starts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def save(path, data):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data))
            request = {'project': {'id': 'p', 'root': str(root)}, 'scene': {'id': 'S1', 'requirement_id': 'R1'},
                       'requirements': [{'id': 'R1'}], 'case_catalog': [{'id': 'C1'}]}
            old = root / 'old'
            save(old / 'request.frozen.json', request)
            save(old / 'plan.current.json', {'cases': [{'catalog_id': 'C1'}]})
            receipt = old / 'attempt-1/execution.json'
            save(receipt, {'case_results': [{'binding_id': 'C1', 'status': 'passed'}]})
            save(old / 'review.current.json', {'status': 'passed', 'reason': 'Reviewed',
                                              'execution_sha256': hashlib.sha256(receipt.read_bytes()).hexdigest()})
            save(root / 'new/request.frozen.json', request)
            progress = collect([root], [])
            self.assertEqual(len(progress['previews']), 1)  # Latest active stage only.
            self.assertTrue(progress['case_history'])
            counts = project_state([], progress)['projects'][0]
            self.assertEqual(counts['executed_count'], 1)
            self.assertEqual(counts['passed'], 1)

    def test_invalid_review_does_not_become_confirmed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def save(path, data):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data))
            request = {'progress_schema': 'single-agent-scene-v1',
                       'project': {'id': 'p', 'root': str(root)},
                       'scene': {'id': 'S1', 'requirement_id': 'R1'}, 'requirements': [{'id': 'R1'}], 'case_catalog': []}
            save(root / 'request.frozen.json', request)
            receipt = root / 'execution/execution.json'
            save(receipt, {'command': ['test'], 'start_utc': '2026-01-01T00:00:00Z', 'exit_code': 1})
            save(root / 'review/answer.json', {'status': 'product_bug', 'summary': 'Draft finding'})
            save(root / 'review/decision-gate.json', {'status': 'invalid', 'review_status': 'product_bug'})
            save(root / 'review/input.json', {'frozen_execution_receipt': str(receipt)})
            save(root / 'summary.json', {'review_status': 'product_bug'})
            counts = project_state([], collect([root], []))['projects'][0]
            self.assertEqual(counts['executed_count'], 1)
            self.assertEqual(counts['product_bug'], 0)
            self.assertEqual(counts['pending_review'], 1)


if __name__ == '__main__':
    unittest.main()
