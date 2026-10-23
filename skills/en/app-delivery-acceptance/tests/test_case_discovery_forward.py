import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import run_case_discovery_forward as forward


class ForwardCorpusTests(unittest.TestCase):
    def test_shipped_sources_and_gold_are_complete_and_not_in_model_fixture(self):
        root = Path(__file__).parent / 'fixtures/case_discovery'
        suite = json.loads((root / 'suite.json').read_text())
        gold = json.loads((root / 'expectations.json').read_text())
        self.assertEqual(set(gold), {p['id'] for p in suite['projects']})
        for project in suite['projects']:
            with self.subTest(project=project['id']):
                fixture = root / project['directory']
                self.assertEqual(set(gold[project['id']]), {s['id'] for s in project['scenarios']})
                for name, expected in project['source_hashes'].items():
                    path = (fixture / name).resolve()
                    self.assertTrue(path.is_relative_to(fixture.resolve()))
                    self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected)
                self.assertFalse((fixture / 'expectations.json').exists())
                self.assertFalse((fixture / 'gold.json').exists())


class IdentityChecksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'checks').write_text('test_declined_smoke\n  assert error\ntest_declined\n  assert error and unchanged\n')
        self.answer = {'case_descriptions': [{'id': 'C1', 'source': {
            'file': 'checks', 'title': 'test_declined_smoke', 'line_start': 1, 'line_end': 2}}],
            'case_discovery': {'associations': [{'case_id': 'C1', 'availability': 'active'}]}}
        self.required = {'required': [{'file': 'checks', 'symbol': 'test_declined'}]}

    def test_weak_prefix_named_test_cannot_satisfy_stronger_case_identity(self):
        self.assertTrue(forward.identity_checks(self.answer, self.required, self.root))

    def test_actual_case_declaration_is_matched_without_parsing_a_language(self):
        self.answer['case_descriptions'][0]['source'].update(title='test_declined', line_start=3, line_end=4)
        self.assertEqual([], forward.identity_checks(self.answer, self.required, self.root))

    def test_skip_status_is_checked_separately_from_case_presence(self):
        wanted = {'required': [{'file': 'checks', 'symbol': 'test_declined_smoke', 'availability': 'skipped'}]}
        self.assertTrue(forward.identity_checks(self.answer, wanted, self.root))
        self.answer['case_discovery']['associations'][0]['availability'] = 'skipped'
        self.assertEqual([], forward.identity_checks(self.answer, wanted, self.root))

    def test_no_match_and_excluded_candidates_cannot_be_reported_as_associated(self):
        self.assertTrue(forward.identity_checks(self.answer, {'no_match': True}, self.root))
        self.assertTrue(forward.identity_checks(self.answer, {'excluded': [
            {'file': 'checks', 'symbol': 'test_declined_smoke'}]}, self.root))


if __name__ == '__main__':
    unittest.main()
