import json
from pathlib import Path
import subprocess
import tempfile
import unittest


GATE = Path(__file__).resolve().parents[1] / 'v3' / 'scenarios' / 'scripts' / 'gate.mjs'


class ScenarioSelfcheckGateTests(unittest.TestCase):
    def run_gate(self, candidate, required=True):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = {'scenario_kind': 'BLACK_BOX', 'target_requirement_id': 'REQ-1',
                       'requirements': {'items': [{'id': 'REQ-1', 'text': '输入合法时保存。输入为空时拒绝并显示错误。'}]}}
            if required:
                request['scenario_selfcheck_protocol'] = 'v4-target-check-v1'
            source = root / 'request.json'
            source.write_text(json.dumps(request, ensure_ascii=False))
            (root / 'draft.candidate.json').write_text(json.dumps(candidate, ensure_ascii=False))
            process = subprocess.run(['node', str(GATE), str(source), str(root), 'draft', '1'],
                                     capture_output=True, text=True)
            artifacts = {name: json.loads((root / name).read_text())
                         for name in ['draft-gate.json', 'scenarios.current.json', 'selfcheck.current.json']
                         if (root / name).exists()}
            return process.returncode, artifacts

    def candidate(self):
        return {'scenarios': [{'id': 'REQ-1-S01', 'title': '拒绝空输入', 'priority': 'P1',
                              'priority_reason': '用户收到错误反馈', 'description': '输入为空时提交；应拒绝并显示错误。'}],
                'change_summary': ['覆盖输入拒绝'],
                'selfcheck': {'obligations': [
                    {'quote': '输入为空时拒绝并显示错误', 'scene_ids': ['REQ-1-S01']}],
                    'scene_checks': [{'scene_id': 'REQ-1-S01', 'owner_quote': '输入为空时拒绝并显示错误',
                                      'distinguishing_failure': '静默拒绝',
                                      'observable_result': '提交后显示错误且未保存',
                                      'failure_impact': '特殊输入得不到规定反馈，属 P1'}]}}

    def test_writes_separate_bound_selfcheck_without_expanding_scene_format(self):
        code, files = self.run_gate(self.candidate())
        self.assertEqual(code, 0, files['draft-gate.json'])
        self.assertEqual(files['selfcheck.current.json']['requirement_id'], 'REQ-1')
        self.assertNotIn('selfcheck', files['scenarios.current.json'])

    def test_rejects_unmapped_or_non_target_obligation(self):
        candidate = self.candidate()
        candidate['selfcheck']['obligations'][0]['quote'] = '另一条需求'
        code, files = self.run_gate(candidate)
        self.assertNotEqual(code, 0)
        self.assertIn('Invalid target obligation mapping', files['draft-gate.json']['errors'])

    def test_legacy_v3_output_still_accepted_without_selfcheck(self):
        candidate = self.candidate()
        del candidate['selfcheck']
        code, files = self.run_gate(candidate, required=False)
        self.assertEqual(code, 0, files['draft-gate.json'])

    def test_v4_gap_only_target_is_retained_as_incomplete(self):
        candidate = self.candidate()
        candidate['scenarios'] = []
        candidate['selfcheck'] = {'obligations': [
            {'quote': '输入为空时拒绝并显示错误', 'scene_ids': [],
             'gap_reason': '没有可执行的输入入口，无法观察反馈。'}], 'scene_checks': []}
        code, files = self.run_gate(candidate)
        self.assertEqual(code, 0, files['draft-gate.json'])
        self.assertEqual(files['scenarios.current.json']['scenarios'], [])
        self.assertEqual(files['selfcheck.current.json']['obligations'][0]['scene_ids'], [])

    def test_permissive_clause_is_not_an_uncovered_obligation(self):
        candidate = self.candidate()
        candidate['selfcheck']['obligations'].append(
            {'quote': '输入合法时保存', 'scene_ids': [],
             'not_required_reason': '此测试只核对许可片段的记录形式。'})
        code, files = self.run_gate(candidate)
        self.assertEqual(code, 0, files['draft-gate.json'])
        self.assertEqual(files['selfcheck.current.json']['obligations'][-1]['not_required_reason'],
                         '此测试只核对许可片段的记录形式。')

    def test_empty_mapping_requires_exactly_one_gap_kind(self):
        candidate = self.candidate()
        candidate['selfcheck']['obligations'][0] = {
            'quote': '输入为空时拒绝并显示错误', 'scene_ids': [],
            'gap_reason': '缺入口', 'not_required_reason': '不必测试'}
        code, files = self.run_gate(candidate)
        self.assertNotEqual(code, 0)
        self.assertIn('Invalid target obligation mapping', files['draft-gate.json']['errors'])


if __name__ == '__main__':
    unittest.main()
