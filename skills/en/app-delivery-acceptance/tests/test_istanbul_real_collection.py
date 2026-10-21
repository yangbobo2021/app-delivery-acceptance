"""Optional real Node/V8 integration, including lifecycle and independent gate.

Run with ACCEPTANCE_COVERAGE_NODE_PACKAGE_ANCHOR pointing to an environment
having ast-v8-to-istanbul, @babel/parser and istanbul-lib-coverage. No installation
or target-project mutation is performed; product and results are temporary.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import execution_coverage as coverage
import scenario_execution as lifecycle
import test_scenario_execution as base


@unittest.skipUnless(os.getenv('ACCEPTANCE_COVERAGE_NODE_PACKAGE_ANCHOR'), 'optional real Node collector environment not supplied')
class RealIstanbulCollectionTest(unittest.TestCase):
    def setUp(self):
        self.f=base.ScenarioExecutionTest();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.project=self.f.project.resolve()
        self.source=self.f.project/'booking.mjs'
        self.source.write_text('export function book(existing) {\n  if (existing) {\n    return false;\n  }\n  return true;\n}\n')
        self.f.git('add','booking.mjs');self.f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','isolated JS product')
        self.f.run['revision']=self.f.git('rev-parse','HEAD').strip()
        lifecycle.initialize(self.f.project,self.f.ledger,self.f.scenarios,self.f.run)
        self.f.run['coverage_policy']={'mode':'required'};self.f.plan['coverage_policy']={'mode':'required'}
        self.f.save(self.f.folder/'execution-plan.json',self.f.plan)
        self.f.run['ledger_hashes']={'project.json':coverage.digest(self.f.ledger/'project.json')}
        self.doc={'version':1,'run_id':'one','ledger_hashes':self.f.run['ledger_hashes'],'receipts':[]}

    def collect(self,sid,input):
        f=self.f;prefix=f'evidence/{sid}'
        capability=prefix+'/capability.log';(f.folder/capability).parent.mkdir(parents=True)
        (f.folder/capability).write_text('Actual installed Node/V8, ast-v8-to-istanbul 1.0.0; direct original ESM source, branch AST conversion. Version/invocation rechecked by independent receipt proof.')
        command=f'node {Path(__file__).with_name("istanbul_real_probe.mjs")} {self.source} {f.folder/prefix} {input}'
        tool={'name':'ast-v8-to-istanbul','version':'1.0.0','command':command}
        item={'project_id':'booking','project_label':'隔离JS模块','project_root':str(f.project),'revision':f.run['revision'],
              'status':'available','format':'istanbul','tool':tool,'reason':'实际环境可采集V8并直接映射原始ESM源码',
              'scope':{'targets':['booking.mjs'],'basis':'隔离真实采集验收，仅此模块','exclusions':[{'path':'booking.py','reason':'Python生命周期夹具不在JS采集范围'}]},'evidence':[capability]}
        f.step('begin',scenario=sid)
        binding=f.readable_binding({'mode':'human_simulation','reason':'实际Node/V8交互调用与计数采集','cases':[]})
        binding['manual_operations'][0].update(tool='Node/V8 inspector',entry_point='booking.mjs:book')
        binding['manual_operations'][0]['procedure']['steps'][0]['action']='调用实际 booking.mjs 的 book(true)，检查返回值；NEXT 同时调用 book(false)'
        binding['coverage_collection']={'projects':[item]};f.step('prepared',binding,sid)
        subprocess.run(['node',str(Path(__file__).with_name('istanbul_real_probe.mjs')),str(self.source),str(f.folder/prefix),input],capture_output=True,check=True)
        proof=coverage.read(f.folder/prefix/'provenance.json');self.assertEqual(proof['actual'],False)
        self.assertEqual(proof['tool'],tool)
        refs=[capability,prefix+'/v8.json',prefix+'/istanbul.json',prefix+'/provenance.json']
        observed=f.readable_observation({'status':'passed','actual':'实际Node/V8调用原始JS，book(true)返回false，保留真实分支数据','evidence':refs})
        f.step('observe',observed,sid)
        result=next(r for r in f.run['results'] if r['scenario_id']==sid)
        receipt={'scenario_id':sid,'attempt':1,'result_sha256':lifecycle.hash_value(result),
                 **{k:item[k] for k in ('project_id','project_label','project_root','revision','scope','tool','format')},
                 'captured_at':proof['captured_at'],'source_sha256':{'booking.mjs':coverage.digest(self.source)},
                 'raw_evidence':{'path':prefix+'/istanbul.json','sha256':coverage.digest(f.folder/prefix/'istanbul.json')},
                 'provenance_evidence':[{'path':ref,'sha256':coverage.digest(f.folder/ref)} for ref in (prefix+'/v8.json',prefix+'/provenance.json')]}
        units=coverage.counters(f.project,f.folder,receipt)['booking.mjs']
        for kind in ('lines','branches'):
            self.assertEqual(len(units[kind]['all']),proof['official_summary'][kind]['total'])
            self.assertEqual(len(units[kind]['hit']),proof['official_summary'][kind]['covered'])
        self.doc['receipts'].append(receipt);f.save(f.folder/coverage.NAME,self.doc)
        pending=coverage.summarize(f.project,f.ledger,f.folder,f.run,self.doc)
        self.assertEqual('pending_review',next(r for r in pending['collection'] if r['scenario_id']==sid)['status'])
        self.assertNotIn(sid,pending['measured_scenario_ids'])
        assessment=f.readable_assessment('passed',refs)
        assessment['execution_coverage']={'status':'verified','projects':[{'project_id':'booking','status':'measured','reason':'独立解析原始V8、调用结果、原始ESM及Istanbul单元；与官方统计逐项相符','evidence':refs}]}
        f.verdict(scenario=sid,assessment=assessment)
        self.assertEqual([],lifecycle.completion_errors(f.project,f.ledger,f.folder,f.run,identifier=sid))
        return units,receipt

    def test_real_v8_to_istanbul_then_independent_union_and_tamper_rejection(self):
        first,_=self.collect('HIGH','true');second,receipt=self.collect('NEXT','both')
        value=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,self.doc)
        self.assertEqual(value['measured_scenario_ids'],['HIGH','NEXT']);self.assertEqual(len(value['projects']),1)
        for kind in ('lines','branches'):
            self.assertEqual(value['projects'][0]['metrics'][kind],{'covered':len(first[kind]['hit']|second[kind]['hit']),'total':len(first[kind]['all'])})
        self.assertGreater(value['projects'][0]['metrics']['branches']['total'],0)
        (self.f.folder/receipt['provenance_evidence'][0]['path']).write_text('{}')
        changed=coverage.summarize(self.f.project,self.f.ledger,self.f.folder,self.f.run,self.doc)
        self.assertNotIn('NEXT',changed['measured_scenario_ids'])


if __name__=='__main__':unittest.main()
