"""Reject untraceable advisory claims without introducing a product gate."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from case_evaluation_contract import context, validate
from case_evaluation import describe


class ContractTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / 'test.mjs').write_text('test("withdraw", () => {\n  assert.equal(withdraw(100, 30), 70);\n});\n')
        self.input = {'scene': {'description': '取款30，返回70。'},
                      'requirements': [{'text': '必须写入审计日志。'}]}
        self.answer = {'case_descriptions': [{'id': 'original', 'name': '取款成功', 'source': {
            'file': 'test.mjs', 'title': 'withdraw', 'line_start': 1, 'line_end': 3,
            'file_sha256': hashlib.sha256((self.root / 'test.mjs').read_bytes()).hexdigest()}}]}
        self.value = {'schema': 'case-evaluation-v2', 'coverage': 'sufficient', 'summary': '关键断言支持场景。',
            'obligations': [{'id': 'O1', 'quote': '取款30，返回70。', 'status': 'supported',
                             'assessment': '调用后检查固定预期。', 'evidence_ids': ['E1']}],
            'findings': [], 'case_assessments': [{'case_id': 'C1', 'role': 'essential',
                'contribution': '固定输入和预期支持该场景。', 'compared_with': [], 'evidence_ids': ['E1']}],
            'selection_advice': '保留C1。', 'limitations': ['静态评估，未执行。'],
            'evidence': [{'id': 'E1', 'file': 'test.mjs', 'line_start': 2, 'line_end': 2,
                          'quote': '  assert.equal(withdraw(100, 30), 70);'}]}

    def check(self, value=None):
        return validate(value or self.value, self.input, self.answer, self.root)

    def test_both_case_origins_get_same_ids_and_verified_quotations(self):
        original = deepcopy(self.value)
        checked = self.check()
        self.assertEqual(self.value, original)
        self.assertEqual(checked['evidence'][0]['file_sha256'], self.answer['case_descriptions'][0]['source']['file_sha256'])
        self.assertEqual(checked['cases'][0]['original_id'], 'original')
        existing = {'associated_tests': [{'id': 'original', **self.answer['case_descriptions'][0]['source']}]}
        self.assertEqual(context(self.input, existing), context(self.input, self.answer))
        self.input['scene']['ui_acceptance'] = None
        self.assertEqual(context(self.input, self.answer)['scene_texts'], ['取款30，返回70。'])

    def test_bad_quote_path_line_reference_and_foreign_obligation_are_rejected(self):
        for mutate in [
            lambda v: v['evidence'][0].update(quote='assert.equal(withdraw(100, 30), 90);'),
            lambda v: v['evidence'][0].update(file='../outside'),
            lambda v: v['evidence'][0].update(file=str(self.root / 'test.mjs')),
            lambda v: v['evidence'][0].update(line_start=99, line_end=99),
            lambda v: v['evidence'][0].update(line_start=True),
            lambda v: v['obligations'][0].update(evidence_ids=['unknown']),
            lambda v: v['obligations'][0].update(quote='必须写入审计日志。'),
            lambda v: v['case_assessments'][0].update(case_id='unknown'),
            lambda v: v['obligations'][0].update(evidence_ids=[]),
        ]:
            with self.subTest(mutate=mutate):
                value = deepcopy(self.value);mutate(value)
                with self.assertRaises(ValueError):
                    self.check(value)

    def test_changed_source_and_symlink_escape_are_rejected(self):
        (self.root / 'test.mjs').write_text((self.root / 'test.mjs').read_text() + '// changed\n')
        with self.assertRaisesRegex(ValueError, '已变化'):
            self.check()
        (self.root / 'escape').symlink_to(self.root.parent)
        value = deepcopy(self.value);value['evidence'][0]['file'] = 'escape/outside'
        with self.assertRaisesRegex(ValueError, '工作区内'):
            self.check(value)

    def test_unique_exact_quote_can_resolve_only_one_missing_end_line(self):
        e = self.value['evidence'][0]
        e.update(line_start=1, line_end=1, quote=(self.root / 'test.mjs').read_text().split('});')[0].rstrip('\n'))
        checked = self.check()['evidence'][0]
        self.assertEqual((checked['line_start'], checked['line_end']), (1, 2))
        self.assertEqual(checked['reported_line_end'], 1)
        self.assertEqual(checked['quote'], e['quote'])
        self.assertEqual(e['line_end'], 1)  # Raw Agent answer stays immutable.
        e.update(line_start=2, line_end=2)
        with self.assertRaises(ValueError):
            self.check()
        e.update(line_start=1, line_end=1)
        (self.root / 'test.mjs').write_text(((self.root / 'test.mjs').read_text()) * 2)
        with self.assertRaises(ValueError):
            self.check()  # Ambiguous repeated source cannot be relocated.

    def test_duplicate_requires_actual_counterpart_evidence(self):
        (self.root / 'other.mjs').write_text('assert.equal(withdraw(100, 30), 70);\n')
        self.answer['case_descriptions'].append({'source': {'file': 'other.mjs'}})
        self.value['case_assessments'].append({'case_id': 'C2', 'role': 'duplicate',
            'contribution': '与C1条件、操作和断言相同。', 'compared_with': ['C1'], 'evidence_ids': ['E2']})
        self.value['evidence'].append({'id': 'E2', 'file': 'other.mjs', 'line_start': 1, 'line_end': 1,
            'quote': 'assert.equal(withdraw(100, 30), 70);'})
        with self.assertRaisesRegex(ValueError, '对照用例证据'):
            self.check()
        self.value['case_assessments'][1]['evidence_ids'].append('E1')
        self.check()

    def test_summary_cannot_call_necessary_gap_sufficient(self):
        self.value['findings'] = [{'id': 'F1', 'kind': 'gap', 'obligation_ids': ['O1'],
            'statement': '缺少关键断言。', 'impact': '可能放过错误返回值。', 'recommendation': '补断言。',
            'evidence_ids': ['E1']}]
        with self.assertRaisesRegex(ValueError, '冲突'):
            self.check()

    def test_empty_group_can_explain_gap_without_redundant_findings_or_fake_citations(self):
        self.answer = {'associated_tests': [], 'test_files': []}
        self.value.update(coverage='gap', summary='当前关联为空，无法支持场景。', case_assessments=[],
                          selection_advice='补足当前关联；无法据此推断仓库内其他测试。', evidence=[])
        self.value['obligations'][0].update(status='unsupported', assessment='当前没有关联用例。', evidence_ids=[])
        self.check()

    def test_new_evaluations_require_cited_per_target_checks_and_keep_legacy_readable(self):
        self.check()  # Historical v2 descriptions retain their original meaning.
        with self.assertRaisesRegex(ValueError, '逐目标核验'):
            validate(self.value, self.input, self.answer, self.root, require_target_checks=True)
        self.value['case_assessments'][0]['checks'] = [{'target': '成功取款返回值',
            'assessment': '固定账户和输入已给定，直接断言本次调用返回70。',
            'counterexample': '若本次返回0，固定预期70的严格相等断言不成立。', 'evidence_ids': ['E1']}]
        checked = validate(self.value, self.input, self.answer, self.root, require_target_checks=True)
        self.assertEqual(checked['case_assessments'][0]['checks'][0]['target'], '成功取款返回值')
        self.value['case_assessments'][0]['checks'][0]['evidence_ids'] = ['missing']
        with self.assertRaisesRegex(ValueError, '未知标识'):
            validate(self.value, self.input, self.answer, self.root, require_target_checks=True)

    def test_invalid_citation_is_unavailable_and_reused_without_retry(self):
        for name, value in [('input', self.input), ('answer', self.answer), ('catalog', {'project_root': str(self.root)})]:
            (self.root / (name + '.json')).write_text(json.dumps(value))
        self.value['evidence'][0]['quote'] = 'invented assertion'
        def native(command, **kwargs):
            out = Path(command[-1]);out.mkdir()
            (out / 'metrics.json').write_text(json.dumps({'status': 'success'}))
            (out / 'answer.json').write_text(json.dumps(self.value))
        cfg = {'case_input': str(self.root / 'input.json')}
        prepared = {'catalog': str(self.root / 'catalog.json')}
        first = describe(cfg, self.root, prepared, self.root / 'answer.json', native)
        self.assertEqual(first['status'], 'unavailable')
        self.assertNotIn('description', first)
        self.assertEqual(first, describe(cfg, self.root, prepared, self.root / 'answer.json',
                                       lambda *a, **k: self.fail('must not retry')))

    def test_existing_legacy_report_is_not_rewritten_or_rerun(self):
        for name, v in [('input', self.input), ('answer', self.answer), ('catalog', {'project_root': str(self.root)})]:
            (self.root / (name + '.json')).write_text(json.dumps(v))
        sha = lambda name: hashlib.sha256((self.root / (name + '.json')).read_bytes()).hexdigest()
        legacy = {'schema': 'case-evaluation-description-v1', 'advisory_only': True, 'status': 'available',
                  'binding': {'input_sha256': sha('input'), 'answer_sha256': sha('answer'), 'catalog_sha256': sha('catalog')},
                  'description': {'summary': '旧描述', 'coverage': 'partial', 'gaps': ['旧缺口']}}
        p = self.root / 'case-evaluation.json';p.write_text(json.dumps(legacy));before = p.read_bytes()
        result = describe({'case_input': str(self.root / 'input.json')}, self.root,
                          {'catalog': str(self.root / 'catalog.json')}, self.root / 'answer.json',
                          lambda *a, **k: self.fail('legacy must not trigger new model'))
        self.assertEqual(result, legacy)
        self.assertEqual(p.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
