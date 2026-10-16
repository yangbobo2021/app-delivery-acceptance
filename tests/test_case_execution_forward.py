"""Independent forward probes for case coverage and truthful execution records."""
import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import case_design
import scenario_execution
import test_scenario_execution as lifecycle


class CaseExecutionForwardTests(unittest.TestCase):
    def setUp(self):
        self.fixture = lifecycle.ScenarioExecutionTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_recording_gate_rejects_pass_with_independent_coverage_gap(self):
        f = self.fixture
        f.prepare(); f.observe(); f.verdict()
        self.assertEqual([], scenario_execution.completion_errors(f.project, f.ledger, f.folder, f.run, identifier='HIGH'))
        coverage = f.run['scenario_reviews'][0]['assessment']['case_coverage']
        coverage['status'] = 'gap'
        coverage['items'][0].update(status='gap', reason='独立核查没有证明此检查实际实现', contributions=[])
        self.assertTrue(scenario_execution.completion_errors(f.project, f.ledger, f.folder, f.run, identifier='HIGH'))

    def test_partial_independent_review_repairs_same_scene_and_clears_live_facts(self):
        f = self.fixture
        f.prepare(); f.observe()
        original = copy.deepcopy(f.run['results'][0])
        coverage = f.readable_assessment('passed', original['evidence'])
        coverage['case_coverage']['status'] = 'gap'
        coverage['case_coverage']['items'][0].update(status='gap', reason='实际用例遗漏该判据', contributions=[])
        with self.assertRaisesRegex(ValueError, 'incomplete case coverage'):
            f.verdict(assessment=coverage)
        f.run['progress'][1]['case_results'] = copy.deepcopy(original['case_results'])
        f.verdict('repair_required', assessment=coverage, problem_kind='test_design')
        progress = next(p for p in f.run['progress'] if p['scenario_id'] == 'HIGH')
        self.assertEqual('preparing', progress['phase'])
        self.assertEqual(2, progress['attempt'])
        self.assertNotIn('binding', progress)
        self.assertNotIn('case_results', progress)
        self.assertFalse(f.run['results'])
        self.assertEqual(original, f.run['attempt_history'][0]['observation'])
        self.assertEqual('HIGH', scenario_execution.next_item(f.plan, f.run)['scenario_id'])

    def test_live_case_result_cannot_be_silently_replaced_at_scene_observe(self):
        f = self.fixture
        f.prepare()
        ref = 'evidence/observed.txt'
        (f.folder / ref).parent.mkdir()
        (f.folder / ref).write_text('实际调用返回False')
        payload = f.readable_observation({'status':'passed', 'actual':'实际调用返回False', 'evidence':[ref]})
        f.step('case-result', copy.deepcopy(payload['case_results'][0]))
        with self.assertRaisesRegex(ValueError, 'already recorded'):
            f.step('case-result', copy.deepcopy(payload['case_results'][0]))
        payload['case_results'][0]['step_results'][0]['actual'] = '替换为其他观察'
        with self.assertRaisesRegex(ValueError, 'cannot overwrite'):
            f.step('observe', payload)
        self.assertEqual('executing', f.run['progress'][1]['phase'])

    def test_exception_does_not_require_inventing_unexecuted_later_step(self):
        binding = {'manual_operations':[{'id':'task','procedure':{'steps':[{'action':'打开连接','expected':'可连接'}, {'action':'修改并读取','expected':'内容保存'}]}}]}
        payload = {'status':'execution_error', 'evidence':['unavailable.log'], 'case_results':[{'association_key':'manual:task','status':'execution_error','summary':'连接工具失败，后续修改未执行','evidence':['unavailable.log'],'step_results':[{'step_number':1,'actual':'连接工具报不可恢复错误','evidence':['unavailable.log']}]}]}
        self.assertEqual([], case_design.result_errors(payload, binding))
        payload['status'] = 'passed'; payload['case_results'][0]['status'] = 'passed'
        self.assertTrue(case_design.result_errors(payload, binding))

    def damaged_live_case(self):
        f = self.fixture
        f.prepare()
        ref = 'evidence/growing.log'
        (f.folder / ref).parent.mkdir()
        (f.folder / ref).write_text('实际业务操作完成；清理尚未退出')
        payload = f.readable_observation({'status': 'passed', 'actual': '实际业务操作完成；清理尚未退出', 'evidence': [ref]})
        f.step('case-result', copy.deepcopy(payload['case_results'][0]))
        saved = copy.deepcopy(next(p for p in f.run['progress'] if p['scenario_id'] == 'HIGH')['case_results'][0])
        (f.folder / ref).write_text('实际业务操作完成；清理尚未退出\n追加实际worker退出超时，命令失败')
        return payload, saved, ref

    def test_damaged_live_case_can_only_reach_independent_repair(self):
        f = self.fixture
        payload, saved, ref = self.damaged_live_case()
        for status in ('passed', 'failed', 'execution_error'):
            payload['status'] = status
            with self.assertRaisesRegex(ValueError, 'cannot overwrite'):
                f.step('observe', payload)
        payload['status'] = 'unproven'
        f.step('observe', payload)
        record = copy.deepcopy(f.run['results'][0])
        damage = record['case_recording_damage'][0]
        self.assertEqual(saved, damage['saved_case_result'])
        self.assertNotEqual(saved['evidence_sha256'], damage['evidence_state'])
        self.assertEqual(record['evidence_sha256'], damage['evidence_state'])
        for status in ('passed', 'failed', 'execution_error'):
            with self.assertRaisesRegex(ValueError, 'independent same-scene repair'):
                f.verdict(status)
        f.verdict('repair_required', problem_kind='evidence')
        self.assertEqual(record, f.run['attempt_history'][0]['observation'])
        self.assertEqual([], scenario_execution.attempt_errors(f.folder, f.run))
        current = next(p for p in f.run['progress'] if p['scenario_id'] == 'HIGH')
        self.assertEqual(('preparing', 2), (current['phase'], current['attempt']))
        self.assertFalse(f.run['results'])
        (f.folder / ref).write_text('再次改写旧证据')
        self.assertIn('archived attempt evidence changed; preserve originals', scenario_execution.attempt_errors(f.folder, f.run))

    def test_unproven_cannot_change_immutable_case_facts_or_supply_damage(self):
        f = self.fixture
        payload, saved, ref = self.damaged_live_case()
        payload['status'] = 'unproven'
        payload['case_results'][0]['summary'] = '编造与原记录不同的观察'
        with self.assertRaisesRegex(ValueError, 'cannot overwrite'):
            f.step('observe', payload)
        payload['case_results'][0] = saved
        payload['case_recording_damage'] = []
        with self.assertRaisesRegex(ValueError, 'derived from immutable'):
            f.step('observe', payload)

    def test_blocked_damage_is_disclosed_and_completion_gate_rejects_it(self):
        f = self.fixture
        payload, saved, ref = self.damaged_live_case()
        payload['status'] = 'blocked'
        f.step('observe', payload)
        self.assertIn('HIGH: recorded case evidence was damaged; independent same-scene repair is required',
            scenario_execution.completion_errors(f.project, f.ledger, f.folder, f.run, identifier='HIGH'))

    def test_partial_exception_record_reaches_independent_gate_without_fake_later_facts(self):
        f = self.fixture
        f.step('begin')
        binding = f.readable_binding({'mode':'human_simulation','reason':'合成异常生命周期验证','cases':[]})
        binding['manual_operations'][0]['procedure']['steps'].append({'action':'继续读取状态','expected':'状态可以读取'})
        f.step('prepared',binding)
        ref = 'evidence/capability-failure.log'
        (f.folder / ref).parent.mkdir()
        (f.folder / ref).write_text('合成工具能力异常：实际第二步未执行')
        observation = f.readable_observation({'status':'execution_error','actual':'首步出现能力异常，第二步未执行','evidence':[ref]})
        f.step('observe',observation)
        f.verdict('execution_error',capability_problem='合成隔离夹具的执行能力异常',recovery_attempts=['合成重新连接仍失败'])
        self.assertEqual([],scenario_execution.completion_errors(f.project,f.ledger,f.folder,f.run,identifier='HIGH'))
        self.assertEqual([1],[v['step_number'] for v in f.run['results'][0]['case_results'][0]['step_results']])

    def test_recorded_step_numbers_are_exact_and_never_boolean(self):
        binding = {'manual_operations':[{'id':'task','procedure':{'steps':[{'action':'读状态','expected':'正确'}]}}]}
        row = {'association_key':'manual:task','status':'execution_error','summary':'读状态时工具失败','evidence':['error.log'],'step_results':[{'step_number':1,'actual':'工具失败','evidence':['error.log']}]}
        payload = {'status':'execution_error','evidence':['error.log'],'case_results':[row]}
        self.assertEqual([], case_design.result_errors(payload,binding))
        for steps in ([{'step_number':True,'actual':'错误编号','evidence':['error.log']}], [{'step_number':2,'actual':'越界','evidence':['error.log']}], row['step_results']*2):
            with self.subTest(steps=steps):
                value = copy.deepcopy(payload)
                value['case_results'][0]['step_results'] = steps
                self.assertTrue(case_design.result_errors(value,binding))

    def test_case_step_cannot_borrow_sibling_evidence(self):
        binding = {'manual_operations':[{'id':key,'procedure':{'steps':[{'action':'读'+key,'expected':'状态可读'}]}} for key in ('a','b')]}
        rows = [{'association_key':'manual:'+key,'status':'passed','summary':'实际读取'+key,'evidence':[key+'.json'],'step_results':[{'step_number':1,'actual':'实读'+key,'evidence':[key+'.json']}]} for key in ('a','b')]
        payload = {'status':'passed','evidence':['a.json','b.json'],'case_results':rows}
        self.assertEqual([], case_design.result_errors(payload,binding))
        rows[0]['step_results'][0]['evidence'] = ['b.json']
        self.assertTrue(case_design.result_errors(payload,binding))

    def test_case_summary_is_brief_while_step_facts_can_remain_complete(self):
        binding = {'manual_operations':[{'id':'task','procedure':{'steps':[{'action':'读取记录','expected':'记录保留'}]}}]}
        row = {'association_key':'manual:task','status':'passed','summary':'原记录实际保持，符合本用例预期。','evidence':['state.json'],'step_results':[{'step_number':1,'actual':'逐字段实测事实。'*60,'evidence':['state.json']}]}
        payload = {'status':'passed','evidence':['state.json'],'case_results':[row]}
        self.assertEqual([], case_design.result_errors(payload,binding))
        row['summary'] = '原记录实际保持。'*30
        self.assertGreater(len(row['summary']),180)
        self.assertTrue(case_design.result_errors(payload,binding))

    def test_shared_point_ids_are_scoped_to_each_frozen_criterion(self):
        scene = {'id':'S','acceptance':{'criteria':['拒绝越权','保留记录']}}
        binding = {'case_design':{'standard':case_design.STANDARD,'items':[{'criterion':criterion,'check_points':[{'id':'point','text':criterion}]} for criterion in scene['acceptance']['criteria']]},'manual_operations':[{'id':'reject','procedure':{'steps':[{'action':'尝试越权','expected':'拒绝'}], 'scenario_checks':[{'scenario_id':'S','criterion':'拒绝越权','scope':'拒绝返回','covered_point_ids':['point'],'step_numbers':[1]}]}}]}
        self.assertTrue(case_design.design_errors(binding,scene))
        binding['manual_operations'][0]['procedure']['scenario_checks'].append({'scenario_id':'S','criterion':'保留记录','scope':'重新读回原记录','covered_point_ids':['point'],'step_numbers':[1]})
        self.assertEqual([],case_design.design_errors(binding,scene))

if __name__ == '__main__': unittest.main()
