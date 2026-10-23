"""Real renderer/record invariants, with no application or model execution."""
import copy
import json
import shutil
import subprocess
import unittest

from case_presentations import attach_case_presentations
from project_statistics import project_state
from project_view import project_html
from test_project_statistics import item


@unittest.skipUnless(shutil.which('node'), 'Node needed for actual viewer script')
class TraceabilityViewsTests(unittest.TestCase):
    def run_view(self, rows, actions=''):
        script = project_html().split('<script>')[-1].split('</script>')[0]
        script = script[:script.index('let selectedCoverageKey=')]
        harness = """const nodes={};const document={
          querySelector:k=>nodes[k]??(nodes[k]={value:'',innerHTML:'',textContent:''}),
          querySelectorAll:()=>[]};
        """
        code = harness + script + '\nrender(' + json.dumps(rows) + ');' + actions
        code += """console.log(JSON.stringify({nodes,objects:[...requirementCards.values()],
           details:[...requirementCards.values()].map(x=>({key:x.key,...traceContent(x)}))}));"""
        result = subprocess.run(['node', '-e', code], text=True, capture_output=True)
        if result.returncode:
            self.fail(result.stderr[-2500:])
        return json.loads(result.stdout)

    def test_filter_keeps_full_graph_and_denominator_with_shared_case_contexts(self):
        rows = [item('S1'), item('S2'), item('S3')]
        for row in rows[:2]:
            row['case_descriptions'] = [{'id': 'shared', 'name': '拒绝余额不足的取款',
                                         'method': '唯一操作描述', 'assertions': '检查余额'}]
        state = project_state(rows, {})
        attach_case_presentations(state['traces'])
        result = self.run_view(state['traces'], "traceSearch='S1';renderTraceTable(traceGroups.reqs,traceGroups.grouped);")
        html = result['nodes']['#rows']['innerHTML']
        self.assertIn('显示 1/3', result['nodes']['#traceShown']['textContent'])
        self.assertIn('已执行 0/3', html)
        self.assertNotIn('唯一操作描述', html)
        scenes = [o for o in result['objects'] if o['type'] == 'scene']
        self.assertEqual({o['entry']['scene']['id'] for o in scenes}, {'S1', 'S2', 'S3'})
        shared = [o for o in result['objects'] if o['type'] == 'case']
        self.assertEqual(len(shared), 2)
        self.assertNotEqual(shared[0]['key'], shared[1]['key'])
        req = next(d for d in result['details'] if d['kind'] == '需求')
        self.assertIn('S3', req['tabs'][1][1])
        self.assertIn('尚无结论', html)

    def test_latest_execution_and_confirmed_source_remain_distinct(self):
        old = item('S1', 'passed', True, attempt_id='attempt-1')
        new = item('S1', 'pending_review', True, attempt_id='attempt-2',
                   at='2026-02-01T00:00:00Z', project={'id': 'project', 'revision': 'v2'},
                   provisional=True)
        new['case_results'][0]['status'] = 'error'
        original = copy.deepcopy([old, new])
        state = project_state([old], {'previews': [new]})
        row = next(t for t in state['traces'] if t['scenarios'])
        self.assertEqual([r['attempt_id'] for r in row['execution_history']], ['attempt-2', 'attempt-1'])
        self.assertEqual(row['judgment_record']['project']['revision'], 'v1')
        self.assertEqual(row['judgment_record']['attempt_id'], 'attempt-1')
        self.assertEqual([old, new], original)
        attach_case_presentations(state['traces'])
        result = self.run_view(state['traces'])
        html = result['nodes']['#rows']['innerHTML']
        self.assertIn('通过', html)
        self.assertIn('待重新验证', html)
        self.assertIn('2 条执行记录', html)
        execution = next(d for d in result['details'] if d['kind'] == '执行')
        self.assertIn('执行错误', execution['tabs'][0][1])
        verdict = next(d for d in result['details'] if d['kind'] == '结论')
        self.assertIn('attempt-1', verdict['tabs'][1][1])
        self.assertIn('v1', verdict['tabs'][2][1])
        self.assertEqual(state['projects'][0]['passed'], 1)
        self.assertEqual(state['projects'][0]['executed_count'], 1)

    def test_group_receipt_never_invents_per_case_results(self):
        row = item('S1', 'pending_review', True)
        row['case_descriptions'] = [{'id': 'C1', 'name': '保存合法请求'},
                                    {'id': 'C2', 'name': '拒绝非法请求'}]
        row['bindings'] = [{'id': 'command-group', 'scenario_id': 'S1', 'title': '已有组合入口'}]
        row['case_results'] = [{'binding_id': 'command-group', 'status': 'passed'}]
        state = project_state([row], {})
        attach_case_presentations(state['traces'])
        result = self.run_view(state['traces'])
        execution = next(d for d in result['details'] if d['kind'] == '执行')
        self.assertIn('未提供逐用例对应结果', execution['tabs'][1][1])
        self.assertIn('保存合法请求', execution['tabs'][1][1])
        self.assertIn('拒绝非法请求', execution['tabs'][1][1])
        self.assertIn('等待确认', result['nodes']['#rows']['innerHTML'])

    def test_stale_evaluation_and_unexecuted_cases_are_not_passes(self):
        row = item('S1')
        row['case_descriptions'] = [{'id': 'C1', 'name': '保存合法请求',
                                    'source': {'origin': 'generated'}}]
        row['case_evaluation'] = {'status': 'stale', 'reason': '用例已变化'}
        state = project_state([row], {})
        attach_case_presentations(state['traces'])
        result = self.run_view(state['traces'])
        html = result['nodes']['#rows']['innerHTML']
        self.assertIn('保存合法请求', html)
        self.assertIn('评估待更新', html)
        self.assertIn('未执行', html)
        self.assertIn('尚无结论', html)
        self.assertNotIn('支持充分', html)
        evaluation = next(d for d in result['details'] if d['kind'] == '评估')
        self.assertIn('用例已变化', evaluation['tabs'][0][1])

    def test_incomplete_catalog_suppresses_requirement_ratios_and_unsafe_links(self):
        row = item('S1', 'passed', True)
        row['current_links'] = {'bad': 'javascript:alert(1)', 'good': '/api/evidence?id=1'}
        row['judgment']['reason'] = '<script>unsafe()</script>'
        state = project_state([row], {})
        attach_case_presentations(state['traces'])
        result = self.run_view(state['traces'], 'traceComplete=false;renderTraceTable(traceGroups.reqs,traceGroups.grouped);')
        html = result['nodes']['#rows']['innerHTML']
        self.assertIn('非完整清单', html)
        self.assertNotIn('已执行 1/1', html)
        verdict = next(d for d in result['details'] if d['kind'] == '结论')
        text = ''.join(tab[1] for tab in verdict['tabs'])
        self.assertNotIn('href="javascript:', text)
        self.assertIn('href="/api/evidence?id=1"', text)
        self.assertIn('&lt;script&gt;unsafe()', text)
        self.assertNotIn('<script>unsafe()', text)


if __name__ == '__main__':
    unittest.main()
