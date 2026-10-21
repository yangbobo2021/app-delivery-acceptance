import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import scenario_execution as execution
import playbook
import priorities


class ScenarioExecutionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / 'project'
        self.project.mkdir()
        self.ledger = Path(self.temp.name) / 'results' / 'delivery-acceptance'
        self.ledger.mkdir(parents=True)
        (self.project / 'tests').mkdir()
        (self.project / '.gitignore').write_text('__pycache__/\n')
        (self.project / 'booking.py').write_text('def book(existing):\n    return not existing\n')
        (self.project / 'tests' / 'test_booking.py').write_text('import booking\nassert not booking.book(True)\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial')
        self.scenarios = [{'id': sid, 'priority': p, 'acceptance': {'description': 'Reject overlapping bookings', 'preconditions': ['Existing booking'], 'actions': ['Submit overlap'], 'criteria': ['Reject and preserve booking'], 'evidence_expected': ['Request and state']}} for sid, p in [('LOW', 'P2'), ('HIGH', 'P0'), ('NEXT', 'P1')]]
        self.save(self.ledger / 'resources.json', {'decisions': []})
        self.save(self.ledger / 'project.json', {'test_layout': {'paths': ['tests'], 'basis': 'Project tests/test_booking.py convention'}})
        self.folder = self.ledger / 'runs' / 'one'
        self.folder.mkdir(parents=True)
        self.save(self.folder / 'scenarios.snapshot.json', {'items': self.scenarios})
        self.plan = priorities.make_plan(self.scenarios, priorities.DEFAULT_POLICY, datetime.now(timezone.utc).isoformat())
        self.run = {'results': [], 'revision': self.git('rev-parse', 'HEAD').strip(), 'dependency_checks': []}
        execution.initialize(self.project, self.ledger, self.scenarios, self.run)
        self.save(self.folder / 'run.json', self.run)

    def save(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        execution.atomic_json(path, data)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.project), *args], capture_output=True, text=True, check=True).stdout

    def step(self, action, payload=None, scenario='HIGH'):
        return execution.advance(self.project, self.ledger, self.folder, self.run, self.plan, scenario, action, payload or {})

    def test_case_origin_cannot_mislabel_this_run(self):
        case = {'name': '检查重复申请被拒绝', 'origin': 'new_case', 'path': 'tests/test_booking.py', 'selector': 'module assertions', 'command': 'python3 tests/test_booking.py', 'sha256': hashlib.sha256((self.project / 'tests/test_booking.py').read_bytes()).hexdigest()}
        binding = self.readable_binding({'mode': 'existing_case', 'reason': '读取已有冲突用例后直接运行', 'cases': [case]})
        errors = execution.binding_errors(self.project, self.ledger, self.run, binding)
        self.assertIn('case origin conflicts with this run execution choice', errors)
        case['origin'] = 'unknown'
        self.assertIn('case origin must be existing_case or new_case', execution.binding_errors(self.project, self.ledger, self.run, binding))
        case['origin'] = 'existing_case'
        self.assertEqual([], execution.binding_errors(self.project, self.ledger, self.run, binding))

    def mixed_binding(self):
        case = {'path': 'tests/test_booking.py', 'selector': 'existing conflict check', 'command': 'python3 tests/test_booking.py', 'sha256': hashlib.sha256((self.project / 'tests/test_booking.py').read_bytes()).hexdigest(), 'origin': 'existing_case'}
        added = dict(case, selector='new recovery check', origin='new_case')
        return self.readable_binding({'mode': 'combined', 'reason': '组合已有冲突检查和新增恢复检查', 'cases': [case, added], 'manual_operations': []})

    def test_combined_allows_existing_and_new_cases_without_manual_tasks(self):
        binding = self.mixed_binding()
        self.assertEqual([], execution.binding_errors(self.project, self.ledger, self.run, binding))
        del binding['manual_operations']
        self.assertEqual([], execution.binding_errors(self.project, self.ledger, self.run, binding))
        self.step('begin')
        self.step('prepared', binding)
        self.assertEqual('executing', next(p for p in self.run['progress'] if p['scenario_id'] == 'HIGH')['phase'])

    def test_combined_without_manual_requires_both_case_origins(self):
        binding = self.mixed_binding()
        for origin in ('existing_case', 'new_case'):
            for case in binding['cases']:
                case['origin'] = origin
            self.assertIn('combined needs mixed case origins or manual_operations', execution.binding_errors(self.project, self.ledger, self.run, binding))

    def test_combined_still_allows_automated_and_manual_work(self):
        binding = self.mixed_binding()
        binding['cases'] = binding['cases'][:1]
        del binding['manual_operations']
        binding = self.readable_binding(binding)
        self.assertEqual([], execution.binding_errors(self.project, self.ledger, self.run, binding))
        del binding['manual_operations'][0]['procedure']
        self.assertIn('each case/manual operation needs its own structured procedure', execution.binding_errors(self.project, self.ledger, self.run, binding))

    def test_combined_still_requires_cases_and_valid_origins(self):
        binding = self.mixed_binding()
        binding['cases'][1]['origin'] = 'unknown'
        self.assertIn('case origin must be existing_case or new_case', execution.binding_errors(self.project, self.ledger, self.run, binding))
        binding['cases'] = []
        self.assertIn('case execution needs precise project case references', execution.binding_errors(self.project, self.ledger, self.run, binding))

    def test_individual_procedure_cannot_be_replaced_by_scene_plan(self):
        binding = self.readable_binding({'mode': 'existing_case', 'reason': '检查真实用例', 'cases': [{'path': 'tests/test_booking.py', 'selector': 'module assertions', 'command': 'python3 tests/test_booking.py', 'sha256': hashlib.sha256((self.project / 'tests/test_booking.py').read_bytes()).hexdigest()}]})
        del binding['cases'][0]['procedure']
        self.assertIn('each case/manual operation needs its own structured procedure', execution.binding_errors(self.project, self.ledger, self.run, binding))
        manual = self.readable_binding({'mode': 'human_simulation', 'reason': '使用实际交互检查', 'cases': []})
        del manual['manual_operations']
        self.assertIn('human simulation needs individually described manual_operations', execution.binding_errors(self.project, self.ledger, self.run, manual))

    def test_procedure_scope_uses_exact_current_frozen_criterion(self):
        binding = self.readable_binding({'mode': 'human_simulation', 'reason': '使用实际交互检查', 'cases': []})
        checks = binding['manual_operations'][0]['procedure']['scenario_checks']
        self.assertEqual([], execution.procedure_reference_errors(binding, self.scenarios, 'HIGH'))
        checks[:] = [{'scenario_id': 'NEXT', 'criterion': 'Reject and preserve booking', 'scope': '只检查下一场景'}]
        self.assertIn('case/manual procedure must state its scope in the current scenario', execution.procedure_reference_errors(binding, self.scenarios, 'HIGH'))
        checks[:] = [{'scenario_id': 'HIGH', 'criterion': 'Invented additional business rule', 'scope': '不能引入未冻结规则'}]
        self.assertIn('procedure criterion must exactly reference a frozen scenario acceptance criterion', execution.procedure_reference_errors(binding, self.scenarios, 'HIGH'))

    def test_expected_result_and_action_cannot_be_bundled_in_a_string(self):
        binding = self.readable_binding({'mode': 'human_simulation', 'reason': '使用实际交互检查', 'cases': []})
        binding['manual_operations'][0]['procedure']['steps'] = ['调用后预期拒绝']
        self.assertIn('procedure steps need action and expected result separately', execution.binding_errors(self.project, self.ledger, self.run, binding))

    def readable_binding(self, value):
        value = dict(value)
        value.setdefault('summary', '对已有预订再次提交申请，检查冲突拒绝与原记录。')
        value.setdefault('operation_plan', {'objective': '验证已有预订时冲突申请被拒绝', 'preconditions': ['存在相同时间的预订'], 'steps': ['提交重叠时间的预订申请'], 'criteria': ['返回拒绝，原预订保持不变'], 'evidence_expected': ['拒绝返回值及预订记录'], 'technical': {'tool': 'python', 'entry_point': 'booking.book'}})
        procedure = {'objective': '检查现有预订的重复申请被拒绝', 'preconditions': ['当前已有预订'], 'test_data': ['book(existing=True)'], 'steps': [{'action': '调用真实 booking.book(True)', 'expected': '返回 False 表示拒绝'}], 'scenario_checks': [{'scenario_id': sid, 'criterion': 'Reject and preserve booking', 'scope': '合成生命周期夹具的冲突返回值检查', 'covered_point_ids':['check'], 'step_numbers':[1]} for sid in ('LOW', 'HIGH', 'NEXT')]}
        for case in value.get('cases', []):
            case.setdefault('name', '现有预订时拒绝重复申请')
            case.setdefault('origin', value['mode'])
            case.setdefault('procedure', copy.deepcopy(procedure))
        if value['mode'] in ('human_simulation', 'combined'):
            value.setdefault('manual_operations', [{'id': 'direct-conflict', 'name': '交互检查重复申请返回值', 'tool': 'Python console', 'entry_point': 'booking.book', 'procedure': procedure}])
        value.setdefault('case_design',{'standard':'case-design-v1','items':[{'criterion':'Reject and preserve booking','check_points':[{'id':'check','text':'合成夹具冲突返回值'}]}]})
        return value

    def readable_observation(self, value):
        value = dict(value)
        value.setdefault('summary', value['actual'])
        value.setdefault('step_results', [{'step': '调用预订并检查返回', 'actual': value['actual'], 'evidence': value['evidence']}])
        value.setdefault('evidence_details', [{'path': ref, 'name': '本次预订输出', 'step': '调用预订并检查返回', 'criterion': '核对冲突拒绝及预订状态', 'captured_at': execution.stamp()} for ref in value['evidence']])
        binding=next((p.get('binding') for p in self.run['progress'] if p.get('binding')),None)
        if binding:
            value.setdefault('case_results',[{'association_key':key,'status':value['status'],'summary':value['actual'],'evidence':value['evidence'],'step_results':[{'step_number':1,'actual':value['actual'],'evidence':value['evidence']}]} for key in execution.case_design.associations(binding)])
        return value

    def readable_assessment(self, status, refs):
        value = {'scope': ['本场景的实际预订结果'], 'checks': [{'criterion': '冲突拒绝行为及执行可用性', 'expected': '冲突被拒绝，记录不变', 'actual': '打开本次日志核对预订返回值', 'status': 'passed' if status == 'passed' else 'failed' if status == 'failed' else 'unproven', 'evidence': refs}], 'basis': ['独立读取本次证据内容'], 'limitations': ['这是受控生命周期测试，不证明真实应用整体通过'], 'output_quality': {'version': 1, 'status': 'passed', 'checks': [{'artifact': name, 'reason': reason} for name, reason in [('operation_plan', '预订状态和冲突操作分项保存，技术入口单独记录'), ('execution', '返回值记录与步骤结果对应，未混入计划操作'), ('evidence', '日志具备本次引用及采集时间，关联拒绝判据')]], 'findings': []}}

        binding=next((p.get('binding') for p in self.run['progress'] if p.get('binding')),None)
        if binding:
            value['case_coverage']={'standard':'case-design-v1','status':'sufficient','items':[{'criterion':'Reject and preserve booking','status':'covered','reason':'实际检查夹具返回值，与唯一判据对应','contributions':[{'association_key':key,'covered_point_ids':['check'],'step_numbers':[1],'reason':'读取实际代码或操作，步骤1检查冲突返回值'} for key in execution.case_design.associations(binding)]}]}
        value.update(self.judgment_fields(status, refs, value['checks']))
        return value

    def judgment_fields(self, status, refs, checks):
        audit = {'status': 'passed', 'issues': [], 'checks': [{'aspect': aspect, 'status': 'passed', 'subject': subject, 'finding': finding, 'evidence': refs} for aspect, subject, finding in [
            ('scenario_alignment', '本场景重复预订及M方法', '输入存在已有预订，实际book(True)覆盖冲突路径'),
            ('test_implementation', 'booking.py及tests/test_booking.py', '已检查输入与拒绝断言，直接调用实际booking模块'),
            ('execution_authenticity', '本次Python命令及stdout', '实际子进程调用book(True)，证据来自当前尝试'),
            ('evidence_sufficiency', '本次输出文件', '逐项读取返回值并核对绑定，范围仅为生命周期夹具')]]}
        explanation = {'conclusion': '重复申请的实际返回支持冲突路径的判定。', 'requirements': [{'id': 'R', 'text': '存在预订时重复申请必须拒绝', 'source': '生命周期测试夹具的合成需求'}], 'preconditions': ['存在相同预订'], 'actions': ['实际调用booking.book(True)并读取返回值'], 'reasoning': ['本次返回值与冲突判据对照，已检查调用和断言未使用其他对象'], 'decisive_evidence': [{'path': refs[0], 'locator': '文件全文的返回值', 'observation': '实际返回False，与所核查冲突返回对应', 'supports': [c['criterion'] for c in checks]}]}
        return {'execution_audit': audit, 'explanation': explanation}

    def prepare(self, scenario='HIGH', case=False):
        self.step('begin', scenario=scenario)
        if case:
            path = self.project / 'tests/test_booking.py'
            binding = {'mode': 'existing_case', 'reason': 'Existing case exercises reservation conflict', 'cases': [{'path': 'tests/test_booking.py', 'selector': 'module assertions', 'command': 'PYTHONPATH=. python3 tests/test_booking.py', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}]}
        else:
            binding = {'mode': 'human_simulation', 'reason': 'Direct action validates observable booking result', 'operation': 'Run booking.book(True) and inspect result', 'cases': []}
        self.step('prepared', self.readable_binding(binding), scenario)

    def observe(self, status='passed', scenario='HIGH', name=None):
        progress = next(p for p in self.run['progress'] if p['scenario_id'] == scenario)
        relative = name or f'evidence/{scenario}-{progress["attempt"]}.txt'
        path = self.folder / relative
        path.parent.mkdir(exist_ok=True)
        result = subprocess.run([sys.executable, '-c', 'import booking; print(booking.book(True))'], cwd=self.project, capture_output=True, text=True, check=True)
        path.write_text(result.stdout)
        return self.step('observe', self.readable_observation({'status': status, 'actual': 'Conflicting reservation returns ' + result.stdout.strip(), 'evidence': [relative]}), scenario)

    def verdict(self, status='passed', scenario='HIGH', **extra):
        progress = next(p for p in self.run['progress'] if p['scenario_id'] == scenario)
        record = next(r for r in self.run['results'] if r['scenario_id'] == scenario)
        default = self.readable_assessment(status, record['evidence'])
        assessment = extra.get('assessment', default)
        if isinstance(assessment, dict):
            assessment.setdefault('output_quality', default['output_quality'])
            if 'case_coverage' in default: assessment.setdefault('case_coverage',default['case_coverage'])
            for key, value in self.judgment_fields(status, record['evidence'], assessment.get('checks', [])).items(): assessment.setdefault(key, value)
        return self.step('evaluate', {'status': status, 'summary': extra.get('reason', '独立核对冲突返回与本次证据，判断预订拒绝行为。'), 'assessment': assessment, 'reason': 'Opened evidence and inspected rejection behavior', 'evidence': record['evidence'], 'reviewer_kind': 'independent_ai', 'review_reference': 'fixture-independent-review', 'result_sha256': progress['result_sha256'], **extra}, scenario)

    def test_final_judgment_requires_credible_execution_and_complete_bound_argument(self):
        self.prepare(); self.observe()
        record = self.run['results'][0]
        progress = next(p for p in self.run['progress'] if p['scenario_id'] == 'HIGH')
        payload = {'status': 'passed', 'summary': '实际重复申请被拒绝，符合冲突返回判据。', 'reason': '独立读取本次返回并核对真实调用', 'evidence': record['evidence'], 'reviewer_kind': 'independent_ai', 'review_reference': 'fixture-review', 'result_sha256': progress['result_sha256'], 'assessment': self.readable_assessment('passed', record['evidence'])}
        mutations = [
            (lambda a: a.pop('execution_audit'), 'execution_audit is required'),
            (lambda a: a.pop('explanation'), 'explanation is required'),
            (lambda a: a['execution_audit']['checks'].pop(), 'exactly once'),
            (lambda a: a['execution_audit'].update(status='repair_required', issues=['断言检查遗漏']), 'repair testing problems'),
            (lambda a: a['explanation']['decisive_evidence'][0].update(path='invented.txt'), 'bound path'),
            (lambda a: a['explanation']['decisive_evidence'][0].update(supports=['其他场景判据']), 'identify assessed criteria'),
            (lambda a: a['explanation']['requirements'][0].pop('text'), 'original text'),
            (lambda a: a['explanation']['decisive_evidence'][0].pop('locator'), 'precise locator'),
        ]
        for change, message in mutations:
            value = copy.deepcopy(payload); change(value['assessment'])
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message): self.step('evaluate', value)
        self.assertEqual(progress['phase'], 'evaluating')
        self.step('evaluate', payload)
        self.assertEqual(self.run['scenario_reviews'][0]['assessment']['explanation'], payload['assessment']['explanation'])

    def test_bug_cannot_be_declared_without_a_failed_business_criterion(self):
        self.prepare(); self.observe('failed')
        assessment = self.readable_assessment('passed', self.run['results'][0]['evidence'])
        with self.assertRaisesRegex(ValueError, 'failed acceptance criterion'):
            self.verdict('failed', assessment=assessment, bug_description='产品接受了冲突申请')

    def test_new_preparation_cannot_omit_readable_plan_or_use_status_as_summary(self):
        self.step('begin')
        for payload, fragment in [
            ({'mode': 'human_simulation', 'reason': '检查冲突', 'operation': '运行并读取返回', 'cases': []}, 'substantive'),
            ({**self.readable_binding({'mode': 'human_simulation', 'reason': '检查冲突', 'cases': []}), 'summary': '测试通过'}, 'substantive')]:
            with self.assertRaisesRegex(ValueError, fragment): self.step('prepared', payload)
        self.assertEqual(self.run['progress'][1]['phase'], 'preparing')

    def test_new_observation_cannot_omit_summary_steps_or_evidence_names(self):
        self.prepare()
        ref = 'evidence/new.txt'; (self.folder / ref).parent.mkdir(exist_ok=True); (self.folder / ref).write_text('False')
        valid = self.readable_observation({'status': 'passed', 'actual': '冲突申请实际返回False', 'evidence': [ref]})
        for field in ('summary', 'step_results', 'evidence_details'):
            payload = dict(valid); payload.pop(field)
            with self.assertRaises(ValueError): self.step('observe', payload)
            self.assertEqual(self.run['progress'][1]['phase'], 'executing')
        self.step('observe', valid)

    def test_pass_needs_independent_output_quality_review(self):
        self.prepare(); self.observe()
        assessment = self.readable_assessment('passed', self.run['results'][0]['evidence'])
        assessment['output_quality']['checks'].pop()
        with self.assertRaisesRegex(ValueError, 'missing artifact evidence'): self.verdict(assessment=assessment)
        self.assertEqual(self.run['progress'][1]['phase'], 'evaluating')
        assessment['output_quality'] = {'version': 1, 'status': 'repair_required', 'checks': self.readable_assessment('passed', self.run['results'][0]['evidence'])['output_quality']['checks'], 'findings': ['执行摘要未说明冲突提示与记录变化']}
        with self.assertRaisesRegex(ValueError, 'requires correction'): self.verdict(assessment=assessment)
        self.verdict('repair_required', assessment=assessment, problem_kind='execution', summary='执行说明缺少记录前后变化，需重新核对并分项保存。', reason='摘要缺少关键状态变化，补充实际操作和证据后重新评估')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        self.assertFalse(self.run['issues'])
        self.assertEqual(self.run['progress'][1]['phase'], 'preparing')

    def test_record_gate_rejects_removed_quality_data_despite_matching_hashes(self):
        self.prepare(); self.observe(); self.verdict()
        self.run['scenario_reviews'][0]['assessment'].pop('output_quality')
        errors = execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH')
        self.assertTrue(any('output quality' in v for v in errors))
        with self.assertRaisesRegex(ValueError, 'recording needs repair'): self.step('begin', scenario='NEXT')

    def test_pending_and_actual_execution_are_visible_before_run_end(self):
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        self.prepare(case=True)
        self.observe()
        disk = json.loads((self.folder / 'run.json').read_text())
        self.assertEqual(disk['lifecycle'], 'running')
        self.assertEqual([p['phase'] for p in disk['progress']], ['pending', 'evaluating', 'pending'])
        self.assertEqual(disk['results'][0]['binding']['cases'][0]['path'], 'tests/test_booking.py')
        self.assertFalse(disk['scenario_reviews'])

    def test_structured_preparation_and_evidence_metadata_survive_observation(self):
        self.step('begin')
        plan = {'objective': '验证预订冲突', 'preconditions': ['已有预订'], 'steps': ['重复预订'], 'criteria': ['拒绝冲突'], 'evidence_expected': ['实际拒绝输出'], 'technical': {'tool': 'python', 'entry_point': 'booking.book', 'commands': ['python test_booking.py']}}
        binding = {'mode': 'human_simulation', 'reason': '验证实际冲突', 'summary': '已有预订时拒绝重复预订', 'operation_plan': plan, 'cases': []}
        self.step('prepared', self.readable_binding(binding))
        evidence = 'evidence/HIGH/attempt-1/result.log'
        (self.folder / evidence).parent.mkdir(parents=True)
        (self.folder / evidence).write_text('False')
        detail = {'path': evidence, 'name': '拒绝结果', 'step': '1', 'captured_at': '2026-10-10T05:00:00Z', 'criterion': '拒绝冲突'}
        self.step('observe', self.readable_observation({'status': 'passed', 'actual': '拒绝冲突', 'evidence': [evidence], 'evidence_details': [detail]}))
        self.assertEqual(self.run['results'][0]['binding']['operation_plan'], plan)
        self.assertEqual(self.run['results'][0]['evidence_details'], [detail])
        self.verdict()

    def test_incomplete_plan_and_invented_evidence_metadata_are_rejected(self):
        self.step('begin')
        with self.assertRaisesRegex(ValueError, 'operation_plan'):
            self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'reason', 'operation_plan': {'objective': 'objective'}, 'cases': []}))
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'reason', 'operation': 'Legacy remains readable', 'cases': []}))
        with self.assertRaisesRegex(ValueError, 'uniquely reference'):
            self.step('observe', self.readable_observation({'status': 'passed', 'actual': 'observed', 'evidence': ['real.log'], 'evidence_details': [{'path': 'invented.log'}]}))

    def test_structured_independent_assessment_is_saved_without_changing_verdict(self):
        self.prepare(); self.observe()
        evidence = self.run['results'][0]['evidence']
        assessment = {'scope': ['重复预订冲突'], 'checks': [{'criterion': '拒绝冲突', 'expected': 'False', 'actual': '实际返回 False', 'status': 'passed', 'evidence': evidence}], 'basis': ['已读取本轮输出'], 'limitations': ['仅覆盖已有预订冲突']}
        self.verdict(summary='重复预订被拒绝，符合冲突判据。', assessment=assessment)
        saved = json.loads((self.folder / 'run.json').read_text())['scenario_reviews'][0]
        self.assertEqual(saved['assessment'], assessment)
        self.assertEqual(saved['status'], 'passed')
        self.assertFalse(execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'))

    def test_structured_assessment_rejects_invented_evidence_and_unproven_pass(self):
        self.prepare(); self.observe()
        check = {'criterion': '拒绝冲突', 'expected': 'False', 'actual': 'False', 'status': 'passed', 'evidence': ['invented.txt']}
        assessment = {'scope': ['冲突'], 'checks': [check], 'basis': ['真实输出'], 'limitations': ['仅为当前生命周期夹具返回值检查']}
        with self.assertRaisesRegex(ValueError, 'cite evidence'):
            self.verdict(summary='已读取冲突返回值，拒绝行为符合判据。', assessment=assessment)
        self.assertEqual(self.run['progress'][1]['phase'], 'evaluating')
        check['evidence'] = self.run['results'][0]['evidence']
        check['status'] = 'unproven'
        with self.assertRaisesRegex(ValueError, 'cannot contain'):
            self.verdict(summary='已读取冲突返回值，拒绝行为符合判据。', assessment=assessment)
        check['status'] = 'passed'
        with self.assertRaisesRegex(ValueError, 'short summary'):
            self.verdict(summary=None, assessment=assessment)
        self.verdict(summary='已读取冲突返回值，拒绝行为符合判据。', assessment=assessment)
        self.run['scenario_reviews'][0]['assessment']['checks'][0]['evidence'] = ['invented.txt']
        self.assertTrue(any('cite evidence' in e for e in execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH')))

    def test_structured_step_observations_preserve_actual_and_bind_same_evidence(self):
        self.prepare()
        ref = 'evidence/HIGH/attempt-1/result.log'
        (self.folder / ref).parent.mkdir(parents=True)
        (self.folder / ref).write_text('False')
        steps = [{'step': '重复预订', 'action': '调用冲突预订', 'actual': '实际返回 False', 'evidence': [ref]}]
        self.step('observe', self.readable_observation({'status': 'passed', 'actual': '完整原始结果', 'summary': '冲突预订被拒绝。', 'step_results': steps, 'evidence': [ref]}))
        self.assertEqual(self.run['results'][0]['step_results'], steps)
        self.assertEqual(self.run['results'][0]['actual'], '完整原始结果')
        self.verdict()
        self.assertFalse(execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'))

    def test_step_observations_reject_invented_references_and_missing_summary(self):
        self.prepare()
        ref = 'evidence/real.log'
        (self.folder / ref).parent.mkdir(parents=True)
        (self.folder / ref).write_text('False')
        payload = {'status': 'passed', 'actual': 'False', 'summary': '拒绝冲突。', 'evidence': [ref], 'step_results': [{'step': '重复预订', 'actual': 'False', 'evidence': ['invented.log']}]}
        with self.assertRaisesRegex(ValueError, 'cite this observation'):
            self.step('observe', self.readable_observation(payload))
        self.assertEqual(self.run['progress'][1]['phase'], 'executing')
        payload['step_results'][0]['evidence'] = [ref]
        del payload['summary']
        with self.assertRaisesRegex(ValueError, 'short execution summary'):
            self.step('observe', payload)
        payload['summary'] = '拒绝冲突。'
        self.step('observe', self.readable_observation(payload))
        self.verdict()

    def test_evidence_problem_retries_same_scenario_then_passes(self):
        self.prepare(); self.observe()
        self.verdict('repair_required', problem_kind='evidence', reason='Need persisted booking count, not only return value')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        self.assertEqual(self.run['progress'][1]['phase'], 'preparing')
        self.assertEqual(len(self.run['attempt_history']), 1)
        self.assertFalse(self.run['scenario_reviews'])
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'Inspect rejection and count', 'operation': 'Read return and storage', 'cases': []}))
        self.observe(); self.verdict()
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'NEXT')
        self.assertEqual(self.run['scenario_reviews'][0]['status'], 'passed')
        self.assertEqual(len(self.run['execution_repairs']), 1)

    def test_invalid_case_failure_is_repaired_and_original_retained(self):
        self.prepare(); self.observe('failed')
        self.verdict('repair_required', problem_kind='test_design', reason='Assertion had wrong boundary; requirement rejects existing reservations')
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'Use correct conflict criterion', 'operation': 'Inspect existing conflict', 'cases': []}))
        self.observe(); self.verdict()
        self.assertEqual(self.run['attempt_history'][0]['observation']['status'], 'failed')
        self.assertEqual(self.run['scenario_reviews'][0]['status'], 'passed')
        self.assertFalse(self.run['issues'])

    def test_actual_invalid_assertion_is_corrected_and_rerun_before_next_scene(self):
        case = self.project / 'tests/test_booking.py'
        case.write_text('import booking\nassert booking.book(True), "wrongly expects conflict accepted"\n')
        self.git('add', 'tests/test_booking.py')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'incorrect case fixture')
        self.prepare(case=True)
        def execute_attempt():
            progress = next(p for p in self.run['progress'] if p['scenario_id'] == 'HIGH')
            observed = subprocess.run([sys.executable, '-c', case.read_text()], cwd=self.project, capture_output=True, text=True)
            ref = f'evidence/actual-assertion-{progress["attempt"]}.log'
            (self.folder / ref).parent.mkdir(exist_ok=True)
            (self.folder / ref).write_text(f'exit={observed.returncode}\n' + observed.stdout + observed.stderr)
            self.step('observe', self.readable_observation({'status': 'passed' if observed.returncode == 0 else 'failed', 'actual': 'Actual assertion exit ' + str(observed.returncode), 'evidence': [ref]}))
            return observed
        first = execute_attempt()
        self.assertNotEqual(first.returncode, 0)
        self.assertIn('wrongly expects conflict accepted', first.stderr)
        self.verdict('repair_required', problem_kind='test_design', reason='Case asserts conflict acceptance; requirement and unchanged product reject conflicts')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        case.write_text('import booking\nassert not booking.book(True), "conflict must be rejected"\n')
        self.git('add', 'tests/test_booking.py')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'correct scenario assertion')
        self.step('prepared', self.readable_binding({'mode': 'new_case', 'reason': 'Correct criterion from scenario intent', 'cases': [{'path': 'tests/test_booking.py', 'selector': 'module assertions', 'command': 'PYTHONPATH=. python3 tests/test_booking.py', 'sha256': hashlib.sha256(case.read_bytes()).hexdigest()}]}))
        self.assertEqual(execute_attempt().returncode, 0)
        self.verdict()
        execution.verify_product(self.project, self.run)
        self.assertEqual(len(self.run['attempt_history']), 1)
        self.assertEqual(self.run['attempt_history'][0]['observation']['status'], 'failed')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'NEXT')

    def test_bug_is_recorded_and_next_scenario_continues_without_product_change(self):
        self.prepare(); self.observe('failed'); self.verdict('failed', bug_description='Product accepted conflicting reservation')
        self.assertEqual(self.run['issues'][0]['kind'], 'bug')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'NEXT')
        self.assertFalse(execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'))

    def test_ai_exception_needs_recovery_evidence_and_is_distinct(self):
        self.step('begin'); self.observe('unproven')
        with self.assertRaisesRegex(ValueError, 'capability'):
            self.verdict('execution_error')
        self.verdict('execution_error', capability_problem='Automation service cannot launch', recovery_attempts=['Restarted automation service; connection still fails'])
        self.assertEqual(self.run['issues'][0]['kind'], 'ai_execution_error')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'NEXT')

    def test_blocked_unproven_are_not_final_verdicts(self):
        self.prepare(); self.observe('unproven')
        for status in ('blocked', 'unproven'):
            with self.assertRaisesRegex(ValueError, 'evaluation'):
                self.verdict(status)

    def test_cannot_prepare_lower_priority_or_advance_before_review(self):
        with self.assertRaisesRegex(ValueError, 'preceding'):
            self.step('begin', scenario='LOW')
        self.prepare(); self.observe()
        with self.assertRaisesRegex(ValueError, 'preceding'):
            self.step('begin', scenario='NEXT')
        self.assertEqual(execution.next_item(self.plan, self.run)['phase'], 'evaluating')

    def test_failed_observation_cannot_be_promoted_to_pass(self):
        self.prepare(); self.observe('failed')
        with self.assertRaisesRegex(ValueError, 'promote'):
            self.verdict()

    def test_bug_cannot_be_inferred_from_unproven_execution(self):
        self.prepare(); self.observe('unproven')
        with self.assertRaisesRegex(ValueError, 'BUG'):
            self.verdict('failed', bug_description='unknown')

    def test_changed_product_is_rejected_even_if_uncommitted(self):
        self.prepare()
        (self.project / 'booking.py').write_text('def book(existing): return True\n')
        with self.assertRaisesRegex(ValueError, 'product files changed'):
            self.observe()

    def test_added_untracked_product_file_is_rejected(self):
        (self.project / 'new_product.py').write_text('production = True\n')
        with self.assertRaisesRegex(ValueError, 'product files changed'):
            self.step('begin')

    def test_case_inside_results_is_rejected(self):
        self.step('begin')
        with self.assertRaisesRegex(ValueError, 'test locations'):
            self.step('prepared', self.readable_binding({'mode': 'new_case', 'reason': 'case', 'cases': [{'path': 'booking.py', 'selector': 'x', 'command': 'python booking.py', 'sha256': 'bad'}]}))

    def test_changed_evidence_and_review_hash_are_rejected(self):
        self.prepare(); self.observe()
        with self.assertRaisesRegex(ValueError, 'observation hash'):
            self.verdict(result_sha256='bad')
        (self.folder / 'evidence/HIGH-1.txt').write_text('rewritten')
        with self.assertRaisesRegex(ValueError, 'evidence changed'):
            self.verdict()

    def test_old_attempt_evidence_cannot_be_overwritten_on_retry(self):
        self.prepare(); self.observe()
        self.verdict('repair_required', problem_kind='execution')
        (self.folder / 'evidence/HIGH-1.txt').write_text('hidden')
        with self.assertRaisesRegex(ValueError, 'archived attempt evidence'):
            self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'retry', 'operation': 'retry', 'cases': []}))

    def test_shared_case_can_grow_in_later_test_only_commit(self):
        self.prepare(case=True); self.observe(); self.verdict()
        with (self.project / 'tests/test_booking.py').open('a') as stream:
            stream.write('assert booking.book(False)\n')
        self.git('add', 'tests/test_booking.py')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'next case')
        self.assertFalse(execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'))

    def test_missing_progress_or_changed_final_verdict_is_rejected(self):
        self.prepare(); self.observe(); self.verdict()
        review = {'results': [{'scenario_id': 'HIGH', 'status': 'failed'}]}
        self.assertTrue(execution.completion_errors(self.project, self.ledger, self.folder, self.run, review, 'HIGH'))
        self.run['progress'].pop()
        self.assertIn('progress must retain every pinned scenario exactly once', execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'))

    def test_active_retry_can_finish_after_deadline_but_next_cannot_start(self):
        self.plan['deadline_at'] = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
        self.prepare(); self.observe(); self.verdict('repair_required', problem_kind='evidence')
        self.plan['deadline_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'retry', 'operation': 'retry', 'cases': []}))
        self.observe(); self.verdict()
        self.assertEqual(execution.next_item(self.plan, self.run)['reason'], 'time_limit')

    def test_missing_per_run_dependency_blocks_scenario_start(self):
        self.save(self.ledger / 'resources.json', {'decisions': [{'id': 'python'}]})
        with self.assertRaisesRegex(ValueError, 'dependency check'):
            self.step('begin')
        proof = self.ledger / 'python.txt'
        proof.write_text('Python imported fixture')
        self.run['dependency_checks'] = [{'dependency_id': 'python', 'status': 'passed', 'evidence': 'python.txt'}]
        self.assertEqual(self.step('begin')['phase'], 'preparing')

    def test_recording_issue_reopens_only_current_scene_and_retains_verdict(self):
        self.prepare(); self.observe(); self.verdict()
        self.step('reopen', {'reason': 'Record gate requires missing test provenance; rerun exact invocation', 'reviewer_kind': 'independent_ai', 'review_reference': 'recording-gate-review'})
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        self.assertEqual(self.run['attempt_history'][0]['review']['status'], 'passed')
        self.assertEqual(self.run['progress'][1]['phase'], 'preparing')
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'Correct provenance', 'operation': 'repeat exact call', 'cases': []}))
        self.observe(); self.verdict()
        self.step('begin', scenario='NEXT')
        with self.assertRaisesRegex(ValueError, 'current completed'):
            self.step('reopen', {'reason': 'too late', 'reviewer_kind': 'independent_ai', 'review_reference': 'review'})

    def test_missing_evidence_is_repaired_in_same_scene_without_rewriting_history(self):
        self.prepare(); self.observe(); self.verdict()
        original = self.run['results'][0]
        (self.folder / original['evidence'][0]).unlink()
        with self.assertRaisesRegex(ValueError, 'preceding scenario recording needs repair'):
            self.step('begin', scenario='NEXT')
        self.step('reopen', {'reason': 'Evidence was accidentally lost; preserve the missing state and collect fresh proof', 'reviewer_kind': 'independent_ai', 'review_reference': 'recording-review'})
        self.assertEqual(self.run['attempt_history'][0]['recording_damage']['evidence_state'][original['evidence'][0]], 'missing')
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'Repeat action with fresh evidence', 'operation': 'call and inspect result', 'cases': []}))
        self.observe(); self.verdict()
        self.assertEqual(execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'), [])
        self.assertFalse((self.folder / original['evidence'][0]).exists())
        (self.folder / original['evidence'][0]).write_text('fabricated old evidence')
        self.assertIn('archived damaged recording changed; preserve the discovered state', execution.attempt_errors(self.folder, self.run))

    def test_ai_exception_is_separate_in_priority_report_and_still_blocks_acceptance(self):
        grouped = priorities.summary(self.scenarios, [{'scenario_id': 'HIGH', 'status': 'execution_error'}], [{'scenario_id': 'HIGH', 'status': 'execution_error'}])
        self.assertEqual(grouped['by_priority']['P0']['execution_error'], 1)
        self.assertEqual(grouped['by_priority']['P0']['failed'], 0)
        self.assertEqual(grouped['by_priority']['P0']['unproven'], 0)
        self.assertTrue(grouped['p0_risk_unresolved'])

    def test_evidence_lost_before_independent_review_requires_same_scene_repair(self):
        self.prepare(); self.observe()
        ref = self.run['results'][0]['evidence'][0]
        (self.folder / ref).unlink()
        with self.assertRaisesRegex(ValueError, 'same-scene repair'):
            self.verdict()
        self.verdict('repair_required', problem_kind='evidence', reason='Original file is missing; preserve that fact and repeat the operation with fresh proof')
        self.assertEqual(execution.next_item(self.plan, self.run)['scenario_id'], 'HIGH')
        self.assertEqual(self.run['attempt_history'][0]['recording_damage']['evidence_state'][ref], 'missing')
        self.step('prepared', self.readable_binding({'mode': 'human_simulation', 'reason': 'Repeat operation for fresh proof', 'operation': 'repeat actual conflict check', 'cases': []}))
        self.observe(); self.verdict()
        self.assertEqual(execution.completion_errors(self.project, self.ledger, self.folder, self.run, identifier='HIGH'), [])

    def test_inline_acceptance_passes_design_checks_without_case_choice(self):
        from test_playbook import PlaybookGatesTest, save
        fixture = PlaybookGatesTest()
        fixture.setUp()
        try:
            scenarios = playbook.read_json(fixture.ledger / 'scenarios.json')
            for scenario in scenarios['items']:
                scenario['acceptance'].update(preconditions=['Fresh account'], actions=['Submit expired code'], criteria=['Rejected and no account write'], evidence_expected=['UI and account state'])
            save(fixture.ledger / 'scenarios.json', scenarios)
            review = playbook.read_json(fixture.ledger / 'coverage_review.json')
            review.update(playbook.coverage_scope_hashes(fixture.ledger))
            review['white_box_priority_review'].update(playbook.priorities.white_box_hashes(fixture.ledger, scenarios['items']))
            save(fixture.ledger / 'coverage_review.json', review)
            self.assertEqual(playbook.validate(fixture.project)['status'], 'ready_for_run')
        finally:
            fixture.doCleanups()


if __name__ == '__main__':
    unittest.main()


class ScenarioWorkflowTest(unittest.TestCase):
    def test_real_xstate_transitions_for_scene_repairs_and_final_outcomes(self):
        probe = Path(__file__).with_name('workflow_scenario_loop_probe.mjs')
        result = subprocess.run(['node', str(probe)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(result.stdout)
        self.assertEqual(record['status'], 'passed')
        self.assertEqual(record['cases'], 9)

    def test_legal_context_witnesses_for_compiler_finite_probe_diagnostics(self):
        probe = Path(__file__).with_name('workflow_guard_witness_probe.mjs')
        result = subprocess.run(['node', str(probe)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(result.stdout)
        self.assertEqual(record['status'], 'passed')
        self.assertEqual(record['cases'], 5)
