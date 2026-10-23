from copy import deepcopy
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from case_reuse import checkpoint, inventory, original_bytes, validate
import test_case_discovery_contract as discovery_tests


class ReuseTests(unittest.TestCase):
    def setUp(self):
        self.fixture = discovery_tests.DiscoveryContractTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.output = self.root.parent / (self.root.name + '-out')
        self.output.mkdir()
        import shutil
        self.addCleanup(shutil.rmtree, self.output)
        for args in [('init', '-q'), ('add', '.'), ('-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')]:
            subprocess.run(['git', *args], cwd=self.root, check=True)
        self.catalog = {'project_root': str(self.root), 'components': []}
        self.baseline = inventory(self.catalog)
        self.answer = deepcopy(self.fixture.answer)
        self.input = self.fixture.input

    def capture(self, answer=None):
        return checkpoint(answer or self.answer, self.input, self.catalog, self.baseline, self.output)

    def final(self, action='reuse'):
        value = deepcopy(self.answer)
        value['status'] = 'host_ready'
        value['case_reuse'] = {'schema': 'case-reuse-plan-v1', 'decisions': [
            {'case_id': 'C1', 'action': action, 'existing_case_ids': ['C1'],
             'obligation_ids': ['O1'], 'reason': '保留已有的原记录断言。'}],
             'not_selected': [], 'limitations': []}
        return value

    def test_clean_repository_uses_lazy_index_instead_of_reading_all_source(self):
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('must use Git objects')):
            value = inventory(self.catalog)
        self.assertIn('blob', value['files']['verification/arbitrary.fixture'])
        self.assertEqual(original_bytes(value, 'verification/arbitrary.fixture'), self.fixture.path.read_bytes())

    def test_existing_uncommitted_and_untracked_tests_keep_true_startup_bytes(self):
        self.fixture.path.write_text('changed before Agent\n')
        (self.root / 'other.fixture').write_text('untracked before Agent\n')
        value = inventory(self.catalog)
        self.assertEqual(original_bytes(value, 'verification/arbitrary.fixture'), b'changed before Agent\n')
        self.assertEqual(original_bytes(value, 'other.fixture'), b'untracked before Agent\n')

    def test_existing_cases_can_be_reused_with_zero_edits(self):
        captured = self.capture()
        final = self.final()
        raw = deepcopy(final)
        report = validate(final, self.input, self.catalog, captured, self.output)
        self.assertEqual(report['decisions'][0]['action'], 'reuse')
        self.assertEqual(final, raw)

    def test_checkpoint_rejects_edit_before_search_is_frozen(self):
        self.fixture.path.write_text('changed after Agent startup\n')
        with self.assertRaisesRegex(ValueError, 'precede'):
            self.capture()

    def test_checkpoint_rejects_new_test_before_search_is_frozen(self):
        (self.root / 'new.fixture').write_text('new test\n')
        with self.assertRaisesRegex(ValueError, 'precede'):
            self.capture()

    def test_final_checks_pre_edit_source_when_extending_existing_test(self):
        captured = self.capture()
        self.fixture.path.write_text(self.fixture.path.read_text().replace('observe unchanged', 'observe unchanged and reject'))
        report = validate(self.final('extend'), self.input, self.catalog, captured, self.output)
        self.assertEqual(report['decisions'][0]['action'], 'extend')
        with self.assertRaisesRegex(ValueError, 'Changed test body'):
            validate(self.final(), self.input, self.catalog, captured, self.output)

    def test_found_cases_cannot_silently_disappear(self):
        captured = self.capture()
        final = self.final();final['status'] = 'blocked'
        final['case_descriptions'] = [];final['case_reuse']['decisions'] = []
        with self.assertRaisesRegex(ValueError, 'disappeared'):
            validate(final, self.input, self.catalog, captured, self.output)
        final['case_reuse']['not_selected'] = [{'case_id': 'C1', 'reason': '同一贡献由另一已有测试承担。'}]
        validate(final, self.input, self.catalog, captured, self.output)

    def test_new_case_requires_generated_origin_and_real_source(self):
        candidate = deepcopy(self.answer)
        candidate['case_descriptions'] = [];candidate['test_files'] = []
        candidate['case_discovery'].update(associations=[], excluded_candidates=[], evidence=[])
        candidate['case_discovery']['obligations'][0].update(status='not_found', case_ids=[], reason='未找到测试。')
        captured = self.capture(candidate)
        path = self.root / 'verification/new.fixture'
        path.write_text('case new\n observe rejected\n')
        final = self.final('new')
        final['test_files'] = ['verification/new.fixture']
        final['case_descriptions'][0]['source'].update(origin='generated', file='verification/new.fixture', title='new', line_start=1, line_end=2)
        final['case_reuse']['decisions'][0].update(existing_case_ids=[])
        validate(final, self.input, self.catalog, captured, self.output)
        final['case_descriptions'][0]['source']['origin'] = 'existing'
        with self.assertRaisesRegex(ValueError, 'New tests'):
            validate(final, self.input, self.catalog, captured, self.output)

    def test_final_scene_target_and_existing_identity_cannot_be_invented(self):
        captured = self.capture()
        for update in [{'obligation_ids': ['O99']}, {'existing_case_ids': ['C99']}, {'reason': ''}]:
            final = self.final();final['case_reuse']['decisions'][0].update(update)
            with self.assertRaises(ValueError):
                validate(final, self.input, self.catalog, captured, self.output)


if __name__ == '__main__':
    unittest.main()
