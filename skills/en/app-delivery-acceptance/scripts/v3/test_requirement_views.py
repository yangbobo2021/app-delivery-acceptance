import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from acceptance_store import save
from requirement_views import attach_requirement_presentations


class RequirementPresentationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.shared = Path(temp.name) / 'AT-example'
        self.req = {'id': 'R1', 'title': '原始标题', 'text': '保留原始约定。\n\n- 条件 A\n- 结果 B'}
        self.trace = {'requirements': [self.req], 'judgment': {'status': 'not_run'}}
        self.item = {'id': 'R1', 'title': '易读标题', 'summary': '满足条件 A 时得到 B。',
                     'rules': ['条件 A', '结果 B'],
                     'text_sha256': hashlib.sha256(self.req['text'].encode()).hexdigest()}
        self.value = {'schema': 'acceptance-requirement-display-v1',
                      'acceptance_id': self.shared.name, 'requirements': [self.item]}

    def test_display_requires_exact_original_text_and_preserves_definitions_and_verdict(self):
        original = copy.deepcopy(self.trace)
        save(self.shared / 'requirement-display.json', self.value)
        attach_requirement_presentations([self.trace], self.shared)
        self.assertEqual(self.trace['requirement_presentations']['R1']['summary'], self.item['summary'])
        self.assertEqual(self.trace['requirements'], original['requirements'])
        self.assertEqual(self.trace['judgment'], original['judgment'])
        self.req['text'] += '\n新的例外'
        attach_requirement_presentations([self.trace], self.shared)
        presentation = self.trace['requirement_presentations']['R1']
        self.assertNotIn('summary', presentation)
        self.assertIn('warning', presentation)

    def test_cross_acceptance_and_malformed_metadata_never_replace_originals(self):
        for value in [{**self.value, 'acceptance_id': 'AT-other'},
                      {**self.value, 'requirements': 'wrong list'},
                      {**self.value, 'requirements': ['wrong item']},
                      {**self.value, 'requirements': [self.item, self.item]},
                      {**self.value, 'requirements': [{**self.item, 'rules': 'not a list'}]}]:
            with self.subTest(value=value):
                save(self.shared / 'requirement-display.json', value)
                attach_requirement_presentations([self.trace], self.shared)
                self.assertNotIn('summary', self.trace['requirement_presentations']['R1'])
                self.assertEqual(self.trace['requirements'][0]['text'], self.req['text'])

    def test_missing_metadata_does_not_invent_summary_from_original_text(self):
        attach_requirement_presentations([self.trace], self.shared)
        self.assertEqual(self.trace['requirement_presentations'], {})


if __name__ == '__main__':
    unittest.main()
