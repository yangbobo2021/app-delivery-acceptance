from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest

from case_discovery_contract import validate


class DiscoveryContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Deliberately no recognized language, framework, file extension or directory.
        self.path = self.root / 'verification' / 'arbitrary.fixture'
        self.path.parent.mkdir()
        self.path.write_text('case retained\n  invoke subject\n  observe unchanged\ncase wording\n  observe message\n')
        self.input = {'scene': {'description': '拒绝操作且原记录保持不变。'},
                      'requirement': {'text': '审计所有操作与性能。'}}
        self.baseline = {'files': {'verification/arbitrary.fixture': {
            'sha256': hashlib.sha256(self.path.read_bytes()).hexdigest()}}}
        self.answer = {'status': 'not_executed', 'observations': [], 'evidence_paths': [],
            'test_files': ['verification/arbitrary.fixture'], 'test_command': [], 'test_env': {},
            'case_descriptions': [{'id': 'C1', 'name': '拒绝操作后检查原记录',
                'method': '调用被测操作。', 'assertions': '检查原记录不变。', 'boundary': '静态查找。',
                'source': {'origin': 'existing', 'file': 'verification/arbitrary.fixture',
                           'title': 'retained', 'line_start': 1, 'line_end': 3}}],
            'case_discovery': {'schema': 'existing-case-discovery-v1', 'summary': '找到原记录保留测试。',
                'search_scope': [{'path': '.', 'kind': 'tests', 'summary': '读取验证文件。'}],
                'obligations': [{'id': 'O1', 'quote': '原记录保持不变', 'status': 'found', 'case_ids': ['C1'], 'reason': '观察操作后记录。'}],
                'associations': [{'case_id': 'C1', 'obligation_ids': ['O1'], 'contribution': '观察原记录。', 'availability': 'active', 'evidence_ids': ['E1']}],
                'excluded_candidates': [{'file': 'verification/arbitrary.fixture', 'title': 'wording', 'reason': '只检查文案。', 'evidence_ids': ['E2']}],
                'limitations': ['未执行测试。'],
                'evidence': [{'id': 'E1', 'file': 'verification/arbitrary.fixture', 'line_start': 1, 'line_end': 3, 'quote': 'case retained\n  invoke subject\n  observe unchanged'},
                             {'id': 'E2', 'file': 'verification/arbitrary.fixture', 'line_start': 4, 'line_end': 5, 'quote': 'case wording\n  observe message'}]}}

    def check(self, answer=None, baseline=True):
        return validate(answer or self.answer, self.input, self.root, self.baseline if baseline else None, discovery_only=True)

    def test_language_independent_source_binding_without_mutating_raw_answer(self):
        raw = deepcopy(self.answer)
        result = self.check()
        self.assertEqual(self.answer, raw)
        self.assertEqual(result['case_discovery']['citation_check'], 'source_quotes_verified')
        self.assertEqual(result['case_descriptions'][0]['source']['file_sha256'], self.baseline['files']['verification/arbitrary.fixture']['sha256'])

    def test_no_match_is_honest_and_valid(self):
        value = deepcopy(self.answer)
        value['case_descriptions'] = []; value['test_files'] = []
        d = value['case_discovery']; d['associations'] = []
        d['obligations'][0].update(status='not_found', case_ids=[], reason='检索后没有关联测试。')
        d['excluded_candidates'] = []; d['evidence'] = []
        self.check(value)

    def test_parent_requirement_cannot_become_scene_obligation(self):
        self.answer['case_discovery']['obligations'][0]['quote'] = '审计所有操作与性能'
        with self.assertRaisesRegex(ValueError, '当前场景'): self.check()

    def test_fabricated_quote_or_shifted_line_is_rejected(self):
        for update in [{'quote': '  observe persisted'}, {'line_start': 2, 'line_end': 3}, {'line_start': True}]:
            with self.subTest(update=update):
                value = deepcopy(self.answer); value['case_discovery']['evidence'][0].update(update)
                with self.assertRaises(ValueError): self.check(value)

    def test_unknown_and_duplicate_reference_are_rejected(self):
        for ids in [['E99'], ['E1', 'E1']]:
            self.answer['case_discovery']['associations'][0]['evidence_ids'] = ids
            with self.assertRaises(ValueError): self.check()

    def test_association_must_cite_own_body_not_only_other_test(self):
        self.answer['case_discovery']['associations'][0]['evidence_ids'] = ['E2']
        with self.assertRaisesRegex(ValueError, '自身测试'): self.check()

    def test_bidirectional_mapping_is_enforced(self):
        self.answer['case_discovery']['obligations'][0].update(status='not_found', case_ids=[])
        with self.assertRaisesRegex(ValueError, '双向'): self.check()

    def test_not_found_cannot_keep_linked_cases(self):
        self.answer['case_discovery']['obligations'][0]['status'] = 'not_found'
        with self.assertRaisesRegex(ValueError, '冲突'): self.check()

    def test_selected_case_must_be_existing_test_file_with_actual_title(self):
        for update in [{'origin': 'generated'}, {'title': 'invented title'}, {'line_end': 200}]:
            with self.subTest(update=update):
                value = deepcopy(self.answer); value['case_descriptions'][0]['source'].update(update)
                with self.assertRaises(ValueError): self.check(value)

    def test_paths_cannot_escape_or_reference_artifacts(self):
        for name in ['../other', '/etc/passwd', '.git/config', '.acceptance/report.json']:
            with self.subTest(name=name):
                value = deepcopy(self.answer); value['case_discovery']['evidence'][0]['file'] = name
                with self.assertRaises(ValueError): self.check(value)

    def test_symlink_escape_is_rejected(self):
        (self.root / 'escape').symlink_to(self.root.parent, target_is_directory=True)
        self.answer['case_discovery']['search_scope'][0]['path'] = 'escape'
        with self.assertRaisesRegex(ValueError, '越界'): self.check()

    def test_stale_or_new_source_cannot_enter_startup_binding(self):
        self.path.write_text(self.path.read_text() + 'extra\n')
        with self.assertRaisesRegex(ValueError, '字节'): self.check()
        self.baseline['files'].clear()
        with self.assertRaisesRegex(ValueError, '启动'): self.check()

    def test_static_mode_cannot_claim_execution_observations_or_pass(self):
        for update in [{'status': 'passed_local'}, {'observations': ['通过']}, {'evidence_paths': ['run.log']}]:
            with self.subTest(update=update):
                value = deepcopy(self.answer); value.update(update)
                with self.assertRaisesRegex(ValueError, '声称执行'): self.check(value)

    def test_skipped_case_remains_associated_with_explicit_availability_note(self):
        self.answer['case_discovery']['associations'][0]['availability'] = 'skipped'
        with self.assertRaises(ValueError): self.check()
        self.answer['case_discovery']['associations'][0]['availability_note'] = '默认跳过，需按项目既有入口显式启用；尚未执行。'
        self.check()

    def test_compact_output_and_exclusion_evidence_are_enforced(self):
        self.answer['case_discovery']['excluded_candidates'][0]['evidence_ids'] = []
        with self.assertRaises(ValueError): self.check()
        self.answer['case_discovery']['excluded_candidates'] = []
        self.answer['case_discovery']['summary'] = '长' * 181
        with self.assertRaises(ValueError): self.check()


if __name__ == '__main__':
    unittest.main()
