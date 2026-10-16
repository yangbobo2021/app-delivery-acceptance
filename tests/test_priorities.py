import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_playbook as base

P, save = base.PLAYBOOK, base.save


class PriorityGatesTest(unittest.TestCase):
    setUp = base.PlaybookGatesTest.setUp

    def scenarios(self):
        return P.read_json(self.ledger / 'scenarios.json')

    def test_both_scenario_kinds_require_grade_and_consequence(self):
        original = self.scenarios()
        for index in (0, 1):
            for grade, reason in ((None, '业务受损'), ('P4', '业务受损'), ('P0', ' ')):
                with self.subTest(index=index, grade=grade, reason=reason):
                    record = json.loads(json.dumps(original))
                    record['items'][index].update(priority=grade, priority_reason=reason)
                    save(self.ledger / 'scenarios.json', record)
                    self.assertEqual(P.validate(self.project)['gates']['scenarios']['status'], 'blocked')
                    if index == 0:
                        self.assertEqual(P.validate_black_box(self.project)['gates']['black_box_scenarios']['status'], 'blocked')

    def test_missing_or_disagreeing_independent_grading_blocks_design(self):
        path = self.ledger / 'coverage_review.json'
        original = P.read_json(path)
        for value in (None, [], [{'scenario_id':'SC-B','priority':'P1','verdict':'appropriate','reason':'不同等级'}],
                      [{'scenario_id':'SC-B','priority':'P0','verdict':'gap','reason':'缺少理由'}],
                      original['priority_reviews'] * 2):
            with self.subTest(value=value):
                review = dict(original, priority_reviews=value)
                save(path, review)
                self.assertEqual(P.validate_black_box(self.project)['gates']['coverage_review']['status'], 'blocked')

    def test_white_box_grade_review_is_required_before_execution(self):
        path = self.ledger / 'coverage_review.json'
        review = P.read_json(path)
        review.pop('white_box_priority_review')
        save(path, review)
        self.assertEqual(P.validate_black_box(self.project)['status'], 'black_box_ready')
        self.assertEqual(P.validate(self.project)['gates']['scenarios']['status'], 'blocked')

    def test_grade_and_reason_changes_stale_review_and_run(self):
        original = self.scenarios()
        for index in (0, 1):
            for field, value in (('priority','P2'), ('priority_reason','变更后的风险判断')):
                with self.subTest(index=index, field=field):
                    record = json.loads(json.dumps(original))
                    record['items'][index][field] = value
                    save(self.ledger / 'scenarios.json', record)
                    report = P.validate(self.project, 'run-1')
                    self.assertIn('stale', ' '.join(report['gates']['scenarios']['issues']))
                    self.assertIn('changed after run creation', ' '.join(report['gates']['execution']['issues']))

    def test_priority_order_is_stable_and_lower_grade_cannot_skip_high_grade(self):
        scenarios = [{'id':str(i), 'priority':p} for i,p in enumerate(('P2','P0','P1','P0','P3'))]
        now = datetime.now(timezone.utc).isoformat()
        plan = P.priorities.make_plan(scenarios, P.priorities.DEFAULT_POLICY, now)
        self.assertEqual(plan['ordered_scenario_ids'], ['1','3','2','0','4'])
        self.assertEqual(P.priorities.next_scenario(plan,[])['scenario_id'],'1')
        self.assertTrue(P.priorities.execution_errors(plan, scenarios, [{'scenario_id':'0','status':'passed'}]))
        self.assertEqual(P.priorities.execution_errors(plan, scenarios, [{'scenario_id':'1','status':'blocked'}]), [])

    def scoped_run(self, grade='P0', minutes=None, old=False):
        save(self.ledger / 'execution-policy.json', {'max_priority':grade,'time_limit_minutes':minutes})
        if old:
            with patch.object(P, 'datetime', wraps=datetime) as clock:
                clock.now.return_value = datetime.now(timezone.utc) - timedelta(hours=1)
                P.new_run(self.project,'limited','abc123','test')
        else:
            P.new_run(self.project,'limited','abc123','test')
        folder = self.ledger / 'runs/limited'
        run = P.read_json(folder / 'run.json')
        run['dependency_checks'] = P.read_json(self.run_dir / 'run.json')['dependency_checks']
        save(folder / 'run.json',run)
        return folder,run

    def test_explicit_selection_freezes_scope_in_priority_order(self):
        scenes = [{'id':'LOW','priority':'P2'}, {'id':'HIGH','priority':'P0'}, {'id':'OTHER','priority':'P0'}]
        now = datetime.now(timezone.utc).isoformat()
        plan = P.priorities.make_plan(scenes, P.priorities.DEFAULT_POLICY, now, ['LOW','HIGH'])
        self.assertEqual(plan['ordered_scenario_ids'], ['HIGH','LOW'])
        for invalid in ([], ['MISSING'], ['HIGH','HIGH']):
            with self.assertRaises(ValueError):
                P.priorities.make_plan(scenes, P.priorities.DEFAULT_POLICY, now, invalid)
        errors = P.priorities.execution_errors(plan, scenes, [{'scenario_id':'OTHER','status':'not_run','not_run_reason':'outside_scenario_scope','reason':'Not selected by user','evidence':[]}])
        self.assertEqual(errors, ['selected scenario scope is partial; it cannot establish full acceptance'])
        errors = P.priorities.execution_errors(plan, scenes, [{'scenario_id':'HIGH','status':'not_run','not_run_reason':'outside_scenario_scope','reason':'Wrong exclusion','evidence':[]}])
        self.assertTrue(any('not outside' in error for error in errors))

    def test_explicit_run_cannot_expand_selection_and_finish_records_exclusion(self):
        sid = self.scenarios()['items'][0]['id']
        P.new_run(self.project, 'explicit', 'abc123', 'test', scenario_ids=[sid])
        folder = self.ledger / 'runs/explicit'
        run = P.read_json(folder / 'run.json')
        plan = P.priorities.load_plan(folder, run, self.scenarios()['items'], self.ledger)
        self.assertEqual(plan['ordered_scenario_ids'], [sid])
        with self.assertRaises(ValueError):
            P.priorities.load_plan(folder, dict(run, selected_scenario_ids=None), self.scenarios()['items'], self.ledger)
        run['results'] = [dict(P.read_json(self.run_dir / 'run.json')['results'][0])]
        save(folder / 'run.json', run)
        P.execution_step(self.project, 'explicit', finish=True)
        results = P.read_json(folder / 'run.json')['results']
        self.assertEqual(results[1]['not_run_reason'], 'outside_scenario_scope')
        self.assertEqual(len(self.scenarios()['items']), 2)

    def test_scoped_run_preserves_untested_scenarios_and_never_accepts(self):
        folder,run = self.scoped_run()
        result = dict(P.read_json(self.run_dir / 'run.json')['results'][0])
        result['evidence'] = ['evidence/screen.txt']
        base.proof(folder / 'evidence/screen.txt')
        run['results'] = [result]
        save(folder / 'run.json',run)
        next_step = P.execution_step(self.project,'limited')
        self.assertIsNone(next_step['scenario_id'])
        P.execution_step(self.project,'limited',finish=True)
        run = P.read_json(folder / 'run.json')
        self.assertEqual(run['results'][1]['status'],'not_run')
        self.assertEqual(run['results'][1]['not_run_reason'],'outside_priority_scope')
        save(folder / 'review.json', P.read_json(self.run_dir / 'review.json'))
        report = P.validate(self.project,'limited')
        self.assertEqual(report['status'],'blocked')
        self.assertIn('scope is partial', ' '.join(report['gates']['execution']['issues']))
        self.assertEqual(report['priority_summary']['by_priority']['P1']['not_run'],1)
        self.assertEqual(len(self.scenarios()['items']),2)
        markdown = P.render_markdown(report,run,self.scenarios(),P.read_json(folder/'review.json'))
        self.assertIn('P1',markdown)
        self.assertIn('剩余风险',markdown)
        self.assertIn('过期分支写入',markdown)

    def test_finish_run_refuses_unexpired_pending_scenarios(self):
        self.scoped_run('P3',30)
        with self.assertRaisesRegex(ValueError,'remain within'):
            P.execution_step(self.project,'limited',finish=True)

    def test_time_limit_stops_next_start_and_records_untested_reason(self):
        folder,run = self.scoped_run('P3',1,old=True)
        value = P.execution_step(self.project,'limited')
        self.assertEqual(value['reason'],'time_limit')
        P.execution_step(self.project,'limited',finish=True)
        results = P.read_json(folder/'run.json')['results']
        self.assertTrue(all(r['status']=='not_run' and r['not_run_reason']=='time_limit' for r in results))
        report = P.validate(self.project,'limited')
        self.assertEqual(report['status'],'blocked')
        self.assertTrue(report['priority_summary']['p0_risk_unresolved'])

    def test_deadline_is_checked_between_actions_and_late_starts_cannot_pass(self):
        start = datetime.now(timezone.utc)
        plan = P.priorities.make_plan([{'id':'X','priority':'P0'}],{'max_priority':'P3','time_limit_minutes':1},start.isoformat())
        self.assertEqual(P.priorities.next_scenario(plan,[],start)['scenario_id'],'X')
        self.assertIsNone(P.priorities.next_scenario(plan,[],start+timedelta(minutes=1))['scenario_id'])
        for late in (None,(start+timedelta(minutes=2)).isoformat()):
            self.assertTrue(P.priorities.execution_errors(plan,[{'id':'X','priority':'P0'}],[{'scenario_id':'X','status':'passed','started_at':late}]))
        self.assertEqual(P.priorities.execution_errors(plan,[{'id':'X','priority':'P0'}],[{'scenario_id':'X','status':'passed','started_at':start.isoformat()}]),[])

    def test_policy_and_plan_cannot_be_dropped_to_downgrade_scope(self):
        folder,run = self.scoped_run()
        run.pop('execution_plan_sha256')
        save(folder/'run.json',run)
        self.assertIn('binding',' '.join(P.validate(self.project,'limited')['gates']['execution']['issues']))
        (folder/'execution-plan.json').unlink()
        self.assertIn('cannot downgrade',' '.join(P.validate(self.project,'limited')['gates']['execution']['issues']))

    def test_changed_plan_or_policy_blocks_run(self):
        folder,run = self.scoped_run()
        path=folder/'execution-plan.json'
        plan=P.read_json(path); plan['policy']['max_priority']='P3'; save(path,plan)
        self.assertIn('execution plan changed',' '.join(P.validate(self.project,'limited')['gates']['execution']['issues']))

    def test_not_run_cannot_claim_executed_methods_evidence_or_observations(self):
        scenario = {'id':'S','priority':'P2'}
        plan = P.priorities.make_plan([scenario], {'max_priority':'P0','time_limit_minutes':None}, datetime.now(timezone.utc).isoformat())
        original = {'scenario_id':'S','status':'not_run','not_run_reason':'outside_priority_scope','reason':'范围之外','method_ids':[],'evidence':[]}
        for field,value in (('evidence',['proof.txt']),('actual','没有真实执行的伪造观察')):
            with self.subTest(field=field):
                errors=P.priorities.execution_errors(plan,[scenario],[dict(original,**{field:value})])
                self.assertIn('empty evidence', ' '.join(errors))

    def test_remaining_risks_do_not_disappear_when_review_proof_is_missing(self):
        path=self.run_dir/'review.json';review=P.read_json(path);review['results'][0]['evidence']=[];save(path,review)
        report=P.validate(self.project,'run-1')
        self.assertEqual(report['priority_summary']['by_priority']['P0']['reviewed'],0)
        self.assertTrue(report['priority_summary']['p0_risk_unresolved'])

    def test_real_state_machine_settles_partial_runs_without_retry_or_acceptance(self):
        import subprocess
        folder,run=self.scoped_run()
        base.proof(folder/'evidence/screen.txt')
        run['results']=[P.read_json(self.run_dir/'run.json')['results'][0]];save(folder/'run.json',run)
        P.execution_step(self.project,'limited',finish=True)
        for mode,style in (('standard','partial'),('coverage','partial'),('standard','false-full'),('standard','false-review')):
            with self.subTest(mode=mode,style=style):
                result=subprocess.run(['node',str(Path(__file__).parent/'workflow_priority_probe.mjs'),str(self.project),'limited',mode,style],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                trace=json.loads(result.stdout)
                self.assertNotEqual((trace.get('output') or {}).get('status'),'accepted')

    def test_unclassified_history_does_not_silently_gain_a_grade(self):
        scenarios=self.scenarios();scenarios['items'][0].pop('priority');save(self.ledger/'scenarios.json',scenarios)
        self.assertEqual(P.validate_black_box(self.project)['status'],'blocked')
        self.assertNotIn('priority',P.read_json(self.ledger/'scenarios.json')['items'][0])


if __name__=='__main__':
    unittest.main()
