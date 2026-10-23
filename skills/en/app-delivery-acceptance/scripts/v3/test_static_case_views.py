"""Viewer-only regression checks; no product test execution or model calls."""
import copy
import json
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from project_view import project_html
from acceptance_store import digest, save
from project_statistics import project_state
from static_case_views import static_case_associations, attach_static_associations
from case_presentations import attach_case_presentations
from test_project_statistics import item


class StaticCaseViewsTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.shared, self.local = self.root / 'shared', self.root / 'local'
        self.file = self.local / 'workspace/tests/sample.test.ts'
        self.file.parent.mkdir(parents=True)
        self.file.write_text('existing test source')
        self.value = {'schema': 'static-existing-tests-v1', 'acceptance_id': 'AT-one',
                      'tests': [{'id': 'T1', 'title': '<script>test</script>',
                                 'file': 'tests/sample.test.ts', 'line_start': 12,
                                 'file_sha256': digest(self.file), 'revision': 'abc',
                                 'contribution': 'Checks retained user edits'}],
                      'scene_mappings': [
                          {'scene_id': 'S1', 'test_ids': ['T1'], 'mapping_basis': 'direct assertion'},
                          {'scene_id': 'S2', 'test_ids': ['T1'], 'mapping_basis': 'direct assertion'},
                          {'scene_id': 'S3', 'test_ids': [], 'missing_or_uncertain': 'read scope only'}]}

    def load(self):
        save(self.shared / 'tests.json', self.value)
        return static_case_associations(self.shared, self.local, 'AT-one', {'S1', 'S2', 'S3'})

    def rows(self, executed=False):
        return project_state([item('S1', 'passed' if executed else 'not_run', executed),
                              item('S2'), item('S3')], {})

    def test_many_to_many_and_empty_associations_do_not_change_execution(self):
        associations = self.load()
        state = self.rows()
        before = copy.deepcopy(state['projects'])
        attach_static_associations(state['traces'], associations)
        self.assertEqual(state['projects'], before)
        self.assertEqual(state['projects'][0]['executed_count'], 0)
        for row in state['traces']:
            if not row['scenarios']:
                continue
            sid = row['scenarios'][0]['id']
            self.assertEqual(row['static_case_associations'][sid]['tests'], associations[sid]['tests'])
            self.assertEqual(row['bindings'], [])
            self.assertEqual(row['case_results'], [])
            self.assertEqual(row['judgment']['status'], 'not_run')

    def test_existing_execution_and_judgment_are_preserved(self):
        state = self.rows(executed=True)
        original = copy.deepcopy(state)
        attach_static_associations(state['traces'], self.load())
        for row in state['traces']:
            row.pop('static_case_associations')
        self.assertEqual(state, original)

    def test_changed_and_missing_sources_keep_historical_associations(self):
        self.assertEqual(self.load()['S1']['tests'][0]['source_verification'], 'matches')
        self.file.write_text('changed')
        self.assertEqual(self.load()['S1']['tests'][0]['source_verification'], 'changed')
        self.file.unlink()
        self.assertEqual(self.load()['S1']['tests'][0]['source_verification'], 'unavailable')

    def test_other_acceptance_unknown_scene_and_unknown_test_are_rejected(self):
        original = copy.deepcopy(self.value)
        for mutate in [lambda v: v.update(acceptance_id='AT-other'),
                       lambda v: v['scene_mappings'][0].update(scene_id='retired'),
                       lambda v: v['scene_mappings'][0].update(test_ids=['missing']),
                       lambda v: v['tests'][0].update(file='../outside')]:
            self.value = copy.deepcopy(original)
            mutate(self.value)
            with self.assertRaises(ValueError):
                self.load()

    def test_optional_absent_and_unrelated_catalogs_do_not_change_legacy_views(self):
        self.assertEqual(static_case_associations(self.shared, self.local, 'AT-one', set()), {})
        self.value['schema'] = 'another-test-catalog'
        self.assertEqual(self.load(), {})

    @unittest.skipUnless(shutil.which('node'), 'Node needed to exercise rendered table')
    def test_structured_evaluation_keeps_issues_distinct_and_citations_navigable(self):
        script = project_html().split('<script>')[-1].split('</script>')[0]
        script = script[:script.index('let selectedCoverageKey=')]
        d = {'schema': 'case-evaluation-v2', 'summary': '拒绝后余额未核对。', 'coverage': 'partial',
             'selection_advice': '保留C1并补足余额断言。', 'limitations': ['静态阅读，未执行。'],
             'obligations': [{'id': 'O1', 'quote': '余额不变', 'status': 'partial',
                              'assessment': '仅检查抛错', 'evidence_ids': ['E1']}],
             'findings': [{'kind': k, 'statement': word, 'impact': '风险', 'recommendation': '建议',
                           'obligation_ids': ['O1'], 'evidence_ids': ['E1']}
                          for k, word in [('gap', '缺少余额断言'), ('enhancement', '更多金额可选')]],
             'cases': [{'case_id': 'C1', 'title': '拒绝取款'}],
             'case_assessments': [{'case_id': 'C1', 'role': 'essential', 'contribution': '检查拒绝',
                                   'compared_with': [], 'evidence_ids': ['E1'], 'checks': [{'target': '取款后的余额', 'assessment': '仅抛错，未核对余额不变。', 'counterexample': '若扣款后抛错，现有断言仍可通过。', 'evidence_ids': ['E1']}]}],
             'evidence': [{'id': 'E1', 'file': 'tests/a.test.ts', 'line_start': 2, 'line_end': 3,
                           'quote': '<script>unsafe()</script>', 'file_sha256': 'abc'}]}
        code = 'const document={querySelector:()=>({value:""})};\n' + script
        code += '\nconst parts=traceEvaluationParts({trace:{case_presentations:{S1:' + json.dumps({'evaluation': {'status': 'available', 'description': d}}) + '}},scene:{id:"S1"}});console.log(parts.overview+parts.related+parts.source);'
        html = subprocess.run(['node', '-e', code], check=True, text=True, capture_output=True).stdout
        class Parser(HTMLParser):
            def __init__(self):
                super().__init__();self.ids=set();self.hrefs=[];self.details=[]
            def handle_starttag(self, tag, attrs):
                a=dict(attrs)
                if 'data-trace-evidence' in a:self.ids.add(a['data-trace-evidence'])
                if 'data-trace-cite' in a:self.hrefs.append(a['data-trace-cite'])
                if tag=='details':self.details.append(a)
        parser=Parser();parser.feed(html)
        self.assertTrue(parser.hrefs)
        self.assertTrue(all(h in parser.ids for h in parser.hrefs))
        self.assertTrue(all('open' not in a for a in parser.details))
        self.assertIn('traceOpenCitation(this)',html)
        self.assertIn('&lt;script&gt;unsafe()&lt;/script&gt;',html)
        self.assertNotIn('<script>unsafe()',html)
        self.assertIn('必要缺口',html)
        self.assertIn('可选增强',html)
        self.assertIn('tests/a.test.ts:2–3',html)
        self.assertIn('SHA-256：abc',html)
        self.assertIn('保留C1并补足余额断言',html)
        self.assertIn('取款后的余额',html)
        self.assertIn('仅抛错，未核对余额不变。',html)
        self.assertIn('若扣款后抛错，现有断言仍可通过。',html)

    @unittest.skipUnless(shutil.which('node'), 'Node needed to exercise rendered table')
    def test_actual_table_shows_associations_and_preserves_execution_columns(self):
        # Run the real project-view render function against a minimal DOM sink.
        script = project_html().split('<script>')[-1].split('</script>')[0]
        script = script[:script.index('let selectedCoverageKey=')]
        state = self.rows(executed=True)
        row = next(t for t in state['traces'] if t['scenarios'] and t['scenarios'][0]['id'] == 'S1')
        row['case_descriptions'] = [{'id': 'new-1', 'name': 'Generated case',
            'method': 'condition and operation', 'assertions': 'actual check', 'boundary': 'mocked transport',
            'source': {'origin': 'generated', 'file': 'tests/new.test.ts'}}]
        row['case_evaluation'] = {'status': 'available', 'description': {
            'summary': 'Independent <opinion>', 'coverage': 'partial', 'gaps': ['missing retry check'],
            'quality_issues': ['weak assertion'], 'redundancy': ['overlapping setup'],
            'test_assessments': [{'test': 'new-1', 'contribution': 'checks success', 'limitations': 'mock only'}]}}
        attach_static_associations(state['traces'], self.load())
        attach_case_presentations(state['traces'])
        harness = '''const nodes={};const document={
          querySelector:k=>nodes[k]??(nodes[k]={value:'',innerHTML:'',textContent:''}),
          querySelectorAll:()=>[]};\n'''
        result = subprocess.run(['node', '-e', harness + script + '\nrender(' +
                                 json.dumps(state['traces']) + ''');console.log(JSON.stringify({nodes,
                                 cases:[...requirementCards.values()].filter(x=>x.type==='case').map(traceContent),
                                 scenes:[...requirementCards.values()].filter(x=>x.type==='scene').map(traceContent),
                                 evaluations:[...requirementCards.values()].filter(x=>x.type==='evaluation').map(traceContent)}));'''],
                                capture_output=True, text=True, check=True)
        rendered = json.loads(result.stdout)
        nodes = rendered['nodes']
        html = nodes['#rows']['innerHTML']
        dialogs = '\n'.join(tab[1] for case in rendered['cases'] for tab in case['tabs'])
        self.assertEqual(html.count('class="case-card"'), 2)
        self.assertIn('&lt;script&gt;test&lt;/script&gt;', html)
        self.assertNotIn('<script>test</script>', html)
        self.assertIn('tests/sample.test.ts:12', dialogs)
        self.assertNotIn('direct assertion', html)
        self.assertIn('direct assertion', '\n'.join(tab[1] for scene in rendered['scenes'] for tab in scene['tabs']))
        self.assertIn('在本轮静态检索范围内未找到关联用例', html)
        self.assertIn('read scope only', '\n'.join(tab[1] for scene in rendered['scenes'] for tab in scene['tabs']))
        self.assertNotIn('尚未准备用例／操作', html)
        self.assertIn('已执行', html)
        self.assertIn('通过', html)
        self.assertIn('未执行', html)
        for label in ['测试方法', '实际验证内容', '验证边界', '文件位置', '用例来源', '未记录']:
            self.assertIn(label, dialogs)
        self.assertIn('设计评估', html)
        self.assertIn('尚未评估', html)
        self.assertIn('尚无结论', html)
        self.assertNotIn('用例依据与限制', html)
        class CaseButtonParser(HTMLParser):
            cards = []
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'button' and '"case"' in attrs.get('data-requirement-key', ''):
                    self.cards.append(attrs)
        parser = CaseButtonParser()
        parser.feed(html)
        self.assertEqual(len(parser.cards), 2)
        self.assertTrue(all(attrs.get('aria-haspopup') == 'dialog' for attrs in parser.cards))
        self.assertEqual(len(rendered['scenes']), 3)
        self.assertEqual({s['id'] for s in rendered['scenes']}, {'S1', 'S2', 'S3'})
        self.assertTrue(all(s['kind'] == '场景' for s in rendered['scenes']))
        for value in ['本轮新增用例', '复用已有用例', 'condition and operation', 'actual check', 'mocked transport']:
            self.assertIn(value, dialogs)
        self.assertNotIn('condition and operation', html)
        self.assertNotIn('actual check', html)
        self.assertNotIn('<script>test</script>', dialogs)
        self.assertIn('设计评估：部分支持', html)
        evaluation_script = '\n'.join(tab[1] for case in rendered['evaluations'] for tab in case['tabs'])
        for value in ['独立评估 Agent', '部分支持', 'Independent &lt;opinion&gt;', 'missing retry check',
                      'weak assertion', 'overlapping setup', '各用例贡献与限制']:
            self.assertIn(value, evaluation_script)
        self.assertIn('＝1 已执行', nodes['#resultBalance']['textContent'])


if __name__ == '__main__':
    unittest.main()
