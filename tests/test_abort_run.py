"""Superseded runs close without fabricating observations, verdicts or issues."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import scenario_execution as lifecycle
import test_scenario_execution as base


class AbortRunTest(unittest.TestCase):
    def setUp(self):
        self.f=base.ScenarioExecutionTest();self.f.setUp();self.addCleanup(self.f.doCleanups)

    def test_aborts_preparing_run_and_preserves_every_scene_record(self):
        self.f.step('begin');before=copy.deepcopy(self.f.run)
        result=lifecycle.abort_run(self.f.folder,self.f.run,'被新运行替代，原始取证保留')
        self.assertEqual(result['status'],'aborted')
        for key in before:
            if key not in ('lifecycle','updated_at'):
                self.assertEqual(self.f.run[key],before[key])
        self.assertEqual(json.loads((self.f.folder/'run.json').read_text())['lifecycle'],'aborted')
        with self.assertRaisesRegex(ValueError,'closed run'):self.f.step('prepared',{})

    def test_requires_reason_and_cannot_rewrite_closed_run(self):
        for reason in ('',None):
            with self.assertRaises(ValueError):lifecycle.abort_run(self.f.folder,self.f.run,reason)
        lifecycle.abort_run(self.f.folder,self.f.run,'停止旧运行')
        before=(self.f.folder/'run.json').read_bytes()
        with self.assertRaises(ValueError):lifecycle.abort_run(self.f.folder,self.f.run,'改写旧原因')
        self.assertEqual((self.f.folder/'run.json').read_bytes(),before)

    def test_cli_closes_running_records_even_when_previous_evidence_needs_repair(self):
        self.f.step('begin');self.f.run['coverage_policy']={'mode':'required'}
        self.f.save(self.f.folder/'run.json',self.f.run)
        out=subprocess.run([sys.executable,'-B',str(Path(__file__).resolve().parents[1]/'scripts/playbook.py'),
            'abort-run',str(self.f.project),'--test-dir',str(self.f.ledger.parent),'--run','one','--reason','切换到新运行，不认证旧覆盖率'],capture_output=True,text=True)
        self.assertEqual(out.returncode,0,out.stderr)
        self.assertEqual(json.loads(out.stdout)['status'],'aborted')
        value=json.loads((self.f.folder/'run.json').read_text())
        self.assertEqual(value['results'],[]);self.assertEqual(value['issues'],[])
        self.assertEqual(next(p for p in value['progress'] if p['scenario_id']=='HIGH')['phase'],'preparing')


if __name__=='__main__':unittest.main()
