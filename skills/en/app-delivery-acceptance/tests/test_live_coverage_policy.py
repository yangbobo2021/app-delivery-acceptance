"""Policy obligations use actual lifecycle transitions; raw counter units are explicit fixtures."""
import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import execution_coverage as coverage
import scenario_execution as lifecycle
import test_scenario_execution as base

class LiveCoveragePolicyTest(unittest.TestCase):
    def setUp(self):
        self.f=base.ScenarioExecutionTest();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.run['coverage_policy']={'mode':'required'}
        self.f.plan['coverage_policy']={'mode':'required'}
        self.f.save(self.f.folder/'execution-plan.json',self.f.plan)
        self.f.run['ledger_hashes']={'project.json':coverage.digest(self.f.ledger/'project.json')}
        self.ref='evidence/capability.log';p=self.f.folder/self.ref;p.parent.mkdir();p.write_text('explicit synthetic environment: branch collector unsupported, alternative configuration also unsupported')
        self.item={'project_id':'booking','project_label':'预订模块','project_root':str(self.f.project),'revision':self.f.run['revision'],'status':'unavailable','scope':{'targets':['booking.py'],'basis':'原始预订源代码，不计算测试','exclusions':[{'path':'tests','reason':'测试代码'}]},'reason':'隔离测试环境没有可用分支计数能力（合成契约测试）','evidence':[self.ref],'recovery_attempts':[{'action':'检查环境与替代采集配置','result':'合成环境声明不支持分支计数','evidence':[self.ref]}]}
        self.item['unavailability_kind']='runtime_unsupported'
    def prepare(self,item=None):
        f=self.f;f.step('begin');b=f.readable_binding({'mode':'human_simulation','reason':'交互检查真实API返回','cases':[]});b['coverage_collection']={'projects':[item or self.item]};f.step('prepared',b)
    def observe(self):
        f=self.f;f.observe(name='evidence/business.log')
        # Build a fresh observation via lifecycle on a fresh attempt is unnecessary here;
        # observation fixture gathers capability evidence in the original payload below.
    def full_observe(self):
        f=self.f;p=f.folder/'evidence/business.log';p.write_text('book(True) actual False')
        payload=f.readable_observation({'status':'passed','actual':'真实book(True)拒绝重复申请','evidence':['evidence/business.log',self.ref]})
        f.step('observe',payload)
    def assessment(self):
        f=self.f;a=f.readable_assessment('passed',f.run['results'][0]['evidence']);a['execution_coverage']={'status':'verified','projects':[{'project_id':'booking','status':'unavailable','reason':'独立核对合成能力记录，明确范围和尝试；未伪造指标','evidence':[self.ref]}]};return a
    def test_undeclared_extra_receipt_invalidates_completed_scene(self):
        self.prepare();self.full_observe();self.f.verdict(assessment=self.assessment())
        self.f.save(self.f.folder/coverage.NAME, {'receipts':[{'scenario_id':'HIGH','attempt':1,'project_id':'unreviewed'}]})
        errors=lifecycle.completion_errors(self.f.project,self.f.ledger,self.f.folder,self.f.run,identifier='HIGH')
        self.assertTrue(any('未在本场景准备' in error for error in errors))
        value=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,coverage.read(self.f.folder/coverage.NAME))
        self.assertEqual('invalid',next(r for r in value['collection'] if r['scenario_id']=='HIGH')['status'])
        self.assertFalse(value['projects'])

    def test_reviewed_ai_inability_before_preparation_has_visible_reason_without_metrics(self):
        f=self.f;f.step('begin');f.observe('unproven')
        refs=f.run['results'][0]['evidence'];a=f.readable_assessment('execution_error',refs)
        a['execution_coverage']={'status':'not_completed','reason':'合成异常契约：自动化启动与重试均失败，未进入采集准备','evidence':refs}
        f.verdict('execution_error',assessment=a,capability_problem='explicit synthetic automation inability',recovery_attempts=['synthetic launch and retry both unavailable'])
        value=coverage.summarize(f.project,f.ledger,f.folder,f.run,None)
        row=next(r for r in value['collection'] if r['scenario_id']=='HIGH')
        self.assertEqual('not_completed',row['status']);self.assertIn('未进入采集准备',row['reason']);self.assertFalse(value['projects'])

    def test_preparation_rejects_missing_collection(self):
        f=self.f;f.step('begin')
        with self.assertRaisesRegex(ValueError,'采集遗漏'):
            f.step('prepared',f.readable_binding({'mode':'human_simulation','reason':'直接调用API','cases':[]}))
        self.assertEqual('preparing',next(p for p in f.run['progress'] if p['scenario_id']=='HIGH')['phase'])
    def test_policy_cannot_be_dropped_from_run(self):
        self.f.run.pop('coverage_policy')
        with self.assertRaisesRegex(ValueError,'策略已改变'):self.f.step('begin')
    def test_unavailable_requires_remedies_not_missing_tool_alone(self):
        item=copy.deepcopy(self.item);item['recovery_attempts']=[]
        with self.assertRaisesRegex(ValueError,'已尝试解决办法'):self.prepare(item)
    def test_skill_adapter_failure_cannot_be_unavailability_exemption(self):
        for kind in (None, 'adapter_unsupported', 'parser_failed'):
            with self.subTest(kind=kind):
                item=copy.deepcopy(self.item);item['unavailability_kind']=kind
                item['reason']='实际已采集，SKILL不能解析真实Istanbul'
                errors=coverage.collection_errors(self.f.project,self.f.folder,self.f.run,{'coverage_collection':{'projects':[item]}},self.f.scenarios[1])
                self.assertTrue(any('SKILL解析/适配失败' in e for e in errors))

    def test_old_unavailability_claim_is_visible_as_processing_problem(self):
        self.prepare();self.full_observe();self.f.verdict(assessment=self.assessment())
        progress=next(p for p in self.f.run['progress'] if p['scenario_id']=='HIGH')
        progress['binding']['coverage_collection']['projects'][0].pop('unavailability_kind')
        self.f.run['results'][0]['binding']['coverage_collection']['projects'][0].pop('unavailability_kind',None)
        value=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,None)
        row=next(r for r in value['collection'] if r['scenario_id']=='HIGH')
        self.assertEqual('collection_error',row['status']);self.assertFalse(value['projects'])
    def test_final_verdict_requires_independent_coverage_check(self):
        self.prepare();self.full_observe()
        with self.assertRaisesRegex(ValueError,'独立评估必须'):self.f.verdict()
    def test_verified_unavailability_allows_business_result_and_remains_visible(self):
        self.prepare();self.full_observe();self.f.verdict(assessment=self.assessment())
        self.assertEqual([],lifecycle.completion_errors(self.f.project,self.f.ledger,self.f.folder,self.f.run,identifier='HIGH'))
        result=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,None)
        self.assertEqual('unavailable',next(r for r in result['collection'] if r['scenario_id']=='HIGH')['status']);self.assertTrue(next(r for r in result['collection'] if r['scenario_id']=='HIGH')['recovery_attempts']);self.assertFalse(result['projects'])
    def test_available_missing_receipt_cannot_be_excused_as_unavailable(self):
        item=copy.deepcopy(self.item);item.update(status='available',tool={'name':'coverage.py','version':'7.13.1','command':'verified actual command fixture'})
        self.prepare(item);self.full_observe()
        with self.assertRaisesRegex(ValueError,'可采集却未采集'):self.f.verdict(assessment=self.assessment())
        value=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,None)
        self.assertEqual('missing',next(r for r in value['collection'] if r['scenario_id']=='HIGH')['status'])
    def test_recording_gate_repeats_check_instead_of_trusting_passed_label(self):
        self.prepare();self.full_observe();self.f.verdict(assessment=self.assessment())
        self.f.run['scenario_reviews'][0]['assessment'].pop('execution_coverage')
        self.assertTrue(lifecycle.completion_errors(self.f.project,self.f.ledger,self.f.folder,self.f.run,identifier='HIGH'))
    def test_capability_evidence_cannot_change_between_preparation_and_observation(self):
        self.prepare();(self.f.folder/self.ref).write_text('changed capability report');self.full_observe()
        with self.assertRaisesRegex(ValueError,'准备后被修改'):self.f.verdict(assessment=self.assessment())
    def test_available_pending_independent_review_does_not_show_metric(self):
        item=copy.deepcopy(self.item);item.update(status='available',tool={'name':'coverage.py','version':'7.13.1','command':'test fixture command'})
        self.prepare(item)
        value=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,None)
        self.assertEqual('collecting',next(r for r in value['collection'] if r['scenario_id']=='HIGH')['status']);self.assertFalse(value['projects'])


    def test_same_root_components_require_individual_frozen_scopes(self):
        from unittest.mock import patch
        subjects = [dict(project_root=str(self.f.project), project_id=k,
                         revision=self.f.run['revision']) for k in ('booking', 'admin')]
        config = coverage.read(self.f.ledger/'project.json')
        config['coverage_subjects'] = subjects
        self.f.save(self.f.ledger/'project.json', config)
        items = [copy.deepcopy(self.item), dict(copy.deepcopy(self.item), project_id='admin')]
        def errors(values):
            return coverage.collection_errors(self.f.project, self.f.folder, self.f.run,
                    {'coverage_collection': {'projects': values}}, self.f.scenarios[1])
        with patch.object(coverage.coverage_subjects, 'subject', return_value={'booking.py': None}):
            self.assertEqual([], errors(items))
            self.assertTrue(any('遗漏冻结组件' in e for e in errors(items[:1])))
            bad = copy.deepcopy(items); bad[1]['project_id'] = 'unknown'
            self.assertTrue(errors(bad))
            bad = copy.deepcopy(items); bad[1]['revision'] = '0'*40
            self.assertTrue(errors(bad))
            bad = copy.deepcopy(items); bad[1]['scope']['targets'] = ['missing.py']
            self.assertTrue(any('遗漏被测源码' in e for e in errors(bad)))
            bad = copy.deepcopy(items); bad[1]['project_id'] = 'booking'
            self.assertTrue(any('标识不能重复' in e for e in errors(bad)))
            progress = {'binding': {'coverage_collection': {'projects': [dict(v, status='available') for v in items]}}}
            for item in items:
                receipt = {k: item.get(k) for k in ('project_id', 'project_root', 'revision', 'scope', 'tool')}
                coverage.validate_prepared_receipt(self.f.run, progress, receipt)
                receipt['scope'] = dict(receipt['scope'], targets=['missing.py'])
                with self.assertRaisesRegex(ValueError, '范围偏离'):
                    coverage.validate_prepared_receipt(self.f.run, progress, receipt)

if __name__=='__main__':unittest.main()
