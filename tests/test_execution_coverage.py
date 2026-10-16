"""Independent boundary tests for immutable live receipts and reviewed-scene union.

The coverage report fixtures deliberately specify counter units, not percentages.
Scenario execution/evaluation uses the actual lifecycle with hash-bound evidence.
"""
import copy
import json
from pathlib import Path
import sys
import subprocess
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import test_scenario_execution as fixture_module
import execution_coverage as coverage
import scenario_execution as lifecycle


class ExecutionCoverageTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.ScenarioExecutionTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.project = self.fixture.project.resolve()
        self.folder = self.fixture.folder
        self.ledger = self.fixture.ledger
        self.run = self.fixture.run
        self.run['ledger_hashes'] = {'project.json': coverage.digest(self.ledger / 'project.json')}
        self.document = {'version': 1, 'run_id': 'one', 'ledger_hashes': self.run['ledger_hashes'], 'receipts': []}

    def scene(self, sid='HIGH', hit=(1,), missing=(2,), branches=(), missing_branches=()):
        self.fixture.prepare(sid)
        report = {'meta': {'version': '7.13.1', 'branch_coverage': True}, 'files': {'booking.py': {
            'executed_lines': list(hit), 'missing_lines': list(missing),
            'executed_branches': list(branches), 'missing_branches': list(missing_branches),
            'excluded_lines': [], 'summary': {'num_statements': len(hit) + len(missing),
                'covered_lines': len(hit), 'num_branches': len(branches) + len(missing_branches), 'covered_branches': len(branches)}}}}
        ref = f'evidence/{sid}-coverage.json'
        self.fixture.save(self.folder / ref, report)
        executed = subprocess.run([sys.executable, '-B', '-c', 'import booking; print(booking.book(True))'], cwd=self.project, capture_output=True, text=True, check=True)
        self.assertEqual(executed.stdout.strip(), 'False')
        self.fixture.step('observe', self.fixture.readable_observation({
            'status': 'passed', 'actual': '生命周期fixture实际book(True)返回False；JSON为明确声明的合成计数单元。', 'evidence': [ref]}), sid)
        receipt = {'scenario_id': sid, 'attempt': 1, 'result_sha256': lifecycle.hash_value(self.run['results'][-1]),
            'project_id': 'booking', 'project_label': '预订模块', 'project_root': str(self.project),
            'revision': self.run['revision'], 'captured_at': '2026-10-11T11:00:00+08:00',
            'tool': {'name': 'coverage.py', 'version': '7.13.1', 'command': 'python -m coverage run --branch test_booking.py'},
            'scope': {'targets': ['booking.py'], 'basis': '原始预订模块；此夹具用于验证计数绑定，非实际采集声明',
                      'exclusions': [{'path': 'tests', 'reason': '测试夹具不属于产品'}]},
            'raw_evidence': {'path': ref, 'sha256': coverage.digest(self.folder / ref)}}
        self.document['receipts'].append(receipt)
        return receipt

    def complete(self, sid='HIGH'):
        self.fixture.verdict(scenario=sid)

    def summary(self):
        return coverage.summarize(self.project, self.ledger, self.folder, self.run, self.document)

    def test_malformed_raw_report_is_hidden_without_crashing_summary(self):
        receipt = self.scene()
        path = self.folder / receipt['raw_evidence']['path']
        report = json.loads(path.read_text()); report['files'] = []; self.fixture.save(path, report)
        sha = coverage.digest(path); receipt['raw_evidence']['sha256'] = sha
        record = self.run['results'][0]; record['evidence_sha256'][receipt['raw_evidence']['path']] = sha
        bound = lifecycle.hash_value(record); receipt['result_sha256'] = bound
        next(p for p in self.run['progress'] if p['scenario_id'] == 'HIGH')['result_sha256'] = bound
        self.complete()
        self.assertEqual(self.summary()['projects'], [])
        self.assertTrue(self.summary()['issues'])

    def test_no_receipts_or_pending_independent_verdict_exposes_no_code_metric(self):
        self.assertEqual(coverage.summarize(self.project, self.ledger, self.folder, self.run, None)['projects'], [])
        self.scene()
        self.assertEqual(self.summary()['projects'], [])
        self.complete()
        self.assertEqual(self.summary()['projects'][0]['metrics']['lines'], {'covered': 1, 'total': 2})
        self.assertEqual(self.summary()['projects'][0]['metrics']['branches'], {'covered': 0, 'total': 0})

    def test_intent_scope_unions_only_independently_completed_current_scene_units(self):
        document=json.loads((self.ledger/'project.json').read_text())
        document['coverage_subjects']=[{'kind':'files','intent':'验收预订模块','basis':'指定预订模块的全部代码','project_id':'booking','project_label':'预订模块','project_root':str(self.project),'revision':self.run['revision'],'selected_paths':['booking.py'],'source_paths':['booking.py'],'excluded_paths':[]}]
        self.fixture.save(self.ledger/'project.json',document)
        self.run['ledger_hashes']['project.json']=coverage.digest(self.ledger/'project.json')
        self.scene()
        self.assertIsNone(self.summary()['subjects'][0]['metrics'])
        self.complete()
        self.assertEqual(self.summary()['subjects'][0]['metrics']['lines'],{'covered':1,'total':2})
        self.scene('NEXT',hit=(1,2),missing=())
        self.assertEqual(self.summary()['subjects'][0]['metrics']['lines'],{'covered':1,'total':2})
        self.complete('NEXT')
        self.assertEqual(self.summary()['subjects'][0]['metrics']['lines'],{'covered':2,'total':2})
        self.run['results'][1]['summary']='tampered result'
        self.assertEqual(self.summary()['subjects'][0]['scenario_ids'],['HIGH'])
        self.assertEqual(self.summary()['subjects'][0]['metrics']['lines'],{'covered':1,'total':2})

    def test_overlapping_hits_union_once_and_missing_units_stay_in_denominator(self):
        self.scene(hit=(1,), missing=(2,)); self.complete()
        self.scene('NEXT', hit=(1, 2), missing=()); self.complete('NEXT')
        value = self.summary()
        self.assertEqual(value['projects'][0]['metrics']['lines'], {'covered': 2, 'total': 2})
        self.assertEqual(value['measured_scenario_ids'], ['HIGH', 'NEXT'])

    def test_branch_arms_union_without_counting_hits_twice(self):
        self.scene(branches=([2, -1],), missing_branches=([2, 1],)); self.complete()
        self.scene('NEXT', branches=([2, -1], [2, 1]), missing_branches=()); self.complete('NEXT')
        self.assertEqual(self.summary()['projects'][0]['metrics']['branches'], {'covered': 2, 'total': 2})

    def test_raw_file_changed_after_observation_removes_scene(self):
        receipt = self.scene(); self.complete()
        (self.folder / receipt['raw_evidence']['path']).write_text('{}')
        value = self.summary()
        self.assertEqual(value['projects'], [])
        self.assertTrue(any('证据核验' in issue for issue in value['issues']))

    def test_stale_observation_and_previous_attempt_never_contribute(self):
        receipt = self.scene(); self.complete()
        for key, changed in [('attempt', 2), ('result_sha256', '0' * 64)]:
            original = receipt[key]; receipt[key] = changed
            self.assertEqual(self.summary()['projects'], [])
            receipt[key] = original

    def test_duplicate_receipt_is_rejected_instead_of_inflating_count(self):
        receipt = self.scene(); self.complete()
        self.document['receipts'].append(copy.deepcopy(receipt))
        value = self.summary()
        self.assertEqual(value['projects'], [])
        self.assertTrue(any('重复' in issue for issue in value['issues']))

    def test_changed_denominator_cannot_merge(self):
        self.scene(); self.complete()
        self.scene('NEXT', hit=(1,), missing=(2, 3)); self.complete('NEXT')
        value = self.summary()
        self.assertEqual(value['projects'], [])
        self.assertTrue(any('分母不同' in issue for issue in value['issues']))

    def test_project_identity_keeps_independent_groups(self):
        self.scene(); self.complete()
        receipt = self.scene('NEXT'); receipt['project_id'] = 'booking-independent'; self.complete('NEXT')
        value = self.summary()
        self.assertEqual(len(value['projects']), 2)
        self.assertTrue(all(p['metrics']['lines'] == {'covered': 1, 'total': 2} for p in value['projects']))

    def test_receipt_revision_must_match_frozen_product_not_symbolic_head(self):
        receipt = self.scene(); self.complete(); receipt['revision'] = 'HEAD'
        self.assertEqual(self.summary()['projects'], [])
        self.assertTrue(any('版本' in issue for issue in self.summary()['issues']))

    def test_unfrozen_project_root_is_not_displayed(self):
        receipt = self.scene(); self.complete(); receipt['project_root'] = str(self.project.parent)
        self.assertEqual(self.summary()['projects'], [])
        self.assertTrue(any('被测代码来源' in issue for issue in self.summary()['issues']))

    def test_source_bytes_must_match_original_product_revision(self):
        receipt = self.scene(); self.complete()
        (self.project / 'booking.py').write_text('def book(existing):\n    return True\n')
        with self.assertRaisesRegex(ValueError, '源码.*版本'):
            coverage.counters(self.project, self.folder, receipt)
        self.assertEqual(self.summary()['projects'], [])

    def test_bad_units_and_summary_counters_are_rejected(self):
        receipt = self.scene()
        path = self.folder / receipt['raw_evidence']['path']; original = json.loads(path.read_text())
        for mutate in [lambda f: f.update(executed_lines=[1, 1]),
                       lambda f: f.update(missing_lines=[1]),
                       lambda f: f['summary'].update(num_statements=99),
                       lambda f: f.update(excluded_lines=[2]),
                       lambda f: f.update(executed_branches=[[1, '2']])]:
            report = copy.deepcopy(original); mutate(report['files']['booking.py']); self.fixture.save(path, report)
            receipt['raw_evidence']['sha256'] = coverage.digest(path)
            with self.assertRaises(ValueError): coverage.counters(self.project, self.folder, receipt)

    def test_malformed_optional_document_does_not_break_viewer_snapshot(self):
        for document in ([], {'version': 1, 'run_id': 'one', 'ledger_hashes': self.run['ledger_hashes'], 'receipts': [None]}):
            with self.subTest(document=document):
                value = coverage.summarize(self.project, self.ledger, self.folder, self.run, document)
                self.assertEqual(value['projects'], [])
                self.assertTrue(value['issues'])

    def test_capture_timestamp_requires_timezone(self):
        receipt = self.scene(); self.complete(); receipt['captured_at'] = '2026-10-11T11:00:00'
        with self.assertRaisesRegex(ValueError, '时间'):
            coverage.counters(self.project, self.folder, receipt)
        self.assertEqual(self.summary()['projects'], [])
        self.assertTrue(any('时间' in issue for issue in self.summary()['issues']))

    def test_last_capture_uses_instant_across_timezone_offsets(self):
        receipt = self.scene(); receipt['captured_at'] = '2026-10-11T11:00:00+08:00'; self.complete()
        receipt = self.scene('NEXT'); receipt['captured_at'] = '2026-10-11T04:00:00+00:00'; self.complete('NEXT')
        from datetime import datetime, timezone
        self.assertEqual(datetime.fromisoformat(self.summary()['updated_at']).astimezone(timezone.utc).hour, 4)

    def test_design_changed_never_certifies_current_execution_metrics(self):
        self.scene(); self.complete()
        self.fixture.save(self.ledger / 'project.json', {'changed': True})
        self.assertEqual(self.summary()['projects'], [])
        self.assertTrue(any('设计已改变' in issue for issue in self.summary()['issues']))


if __name__ == '__main__':
    unittest.main()
