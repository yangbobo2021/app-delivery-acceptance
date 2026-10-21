"""Behavioral regressions for analyzed sources -> reviewed units -> scenes -> runs."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import acceptance_plan as scope
import design_pipeline as pipeline
from scenario_execution import atomic_json

class DesignPipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.ledger=self.root/'tests'/'delivery-acceptance';self.ledger.mkdir(parents=True)
        (self.root/'notes.py').write_text('def save(text):\n    return text[:200]\n')
        atomic_json(self.ledger/'project.json',{'project_root':str(self.root)})
        atomic_json(self.ledger/'requirements.json',{'source':'human brief','version':'1','items':[{'id':'R1','text':'Save a note; over 200 characters preserve previous content'},{'id':'R2','text':'Preview selected color without modifying saved content'}]})
        atomic_json(self.ledger/scope.DECISIONS,{'version':1,'items':[]})
        atomic_json(self.ledger/'white_box_rules.json',{'version':1,'items':[]})
        atomic_json(self.ledger/'scenarios.json',{'design_standard':'design-quality-v4','items':[]})
        self.analyze()
        self.plan=self.candidate();self.publish()

    def analyze(self,stage='acceptance'):
        value={'standard':pipeline.STANDARD,'status':'complete','stage':stage,'source_hashes':pipeline.sources(self.ledger),
            'requirement_ids':['R1','R2'],'rule_ids':[r['id'] for r in scope.load(self.ledger/'white_box_rules.json')['items']],
            'original_analysis_basis':'Inspected both original behaviors and their immutable content constraints',
            'white_box_analysis_basis':'Inspected actual save branch and source inventory before organization',
            'code_inventory':[] if stage=='black-box' else [{'path':'notes.py','sha256':scope.file_hash(self.root/'notes.py'),'basis':'Inspected save boundary'}]}
        pipeline.complete_analysis(self.root,self.ledger,value)

    def candidate(self,version=1):
        req=scope.load(self.ledger/'requirements.json')
        return {'standard':scope.STANDARD,'version':version,'requirements_sha256':scope.file_hash(self.ledger/'requirements.json'),
            'source_analysis_sha256':scope.file_hash(self.ledger/pipeline.ANALYSIS),'rules_sha256':pipeline.rules_digest(self.ledger),
            'decisions_sha256':scope.digest(scope.decisions(self.ledger)),
            'business_context':{'objective':'Reliably save notes and preview color','basis':['human brief'],
                'journeys':[{'id':'J1','title':'Edit and preserve notes','role':'core','requirement_ids':['R1','R2'],'basis':'Original save and preservation goals'}]},
            'checks':[{'id':'C'+str(i+1),'requirement_id':r['id'],'source_quote':r['text'],'behavior':r['text'],'disposition':'included','reason':'Confirmed requirement'} for i,r in enumerate(req['items'])],
            'units':[{'id':'U'+str(i+1),'title':r['text'],'role':'core' if i==0 else 'experience','boundary':r['text'],
                'requirement_ids':[r['id']],'check_ids':['C'+str(i+1)],'rule_ids':[],'journey_ids':['J1'],'dependencies':[],'exclusions':[]} for i,r in enumerate(req['items'])]}

    def publish(self,plan=None):
        plan=plan or self.plan
        review={'status':'passed','reviewer_kind':'independent_ai','review_reference':'Independent controlled source/organization fixture',
            'plan_sha256':scope.digest(plan),'requirement_ids':['R1','R2'],
            'rule_ids':[r['id'] for r in scope.load(self.ledger/'white_box_rules.json')['items']]}
        for k in ('original_inventory','bidirectional_traceability','scope_applicability','global_business_context','rule_provenance'):
            review[k]={'status':'passed','reason':'Independently checked original behavior, source contracts and all ownership mappings'}
        scope.publish_plan(self.ledger,plan,review,plan['version']-1)

    def scene(self,uid,cids=None,unit_ids=None):
        n=uid[-1];cids=cids or ['C'+n]
        return {'id':'S'+n,'generation_unit_id':uid,'kind':'black_box','title':'Check note behavior '+n,'requirement_ids':['R'+n],
            'priority':'P2','priority_reason':'Recoverable note behavior failure affects this confirmed task',
            'acceptance':{'description':'Perform the confirmed note operation and inspect retained state','preconditions':['Existing saved note'],
                'actions':['Perform note operation'],'criteria':['Saved state matches the confirmed constraint'],'evidence_expected':['Actual saved state']},
            'scope':{'kind':'direct','unit_ids':unit_ids or [uid],'topics':['notes'],'basis':'Original note behavior',
                'criteria':[{'criterion':'Saved state matches the confirmed constraint','check_ids':cids,'rule_ids':[],'basis':'Exact original state constraint'}]},
            'risk':dict(zip(scope.RISK_FIELDS,['Wrong note state','Operation -> wrong note -> user rework','Recoverable user rework','Note users','Restore original note','Actual boundary class; frequency unknown','Recoverable consequence'])),}

    def add(self,scene):
        doc=scope.load(self.ledger/'scenarios.json');doc['items'].append(scene);atomic_json(self.ledger/'scenarios.json',doc)

    def generate(self,uid):
        pipeline.start_unit(self.ledger,uid);self.add(self.scene(uid));pipeline.complete_unit(self.ledger,uid)

    def test_all_units_exist_before_first_scenario(self):
        view=pipeline.view(self.ledger)
        self.assertEqual(['pending','pending'],[u['status'] for u in view['units']]);self.assertEqual(0,len(scope.load(self.ledger/'scenarios.json')['items']))
        self.assertEqual(['completed','completed','in_progress','pending'],[s['status'] for s in view['stages']])

    def test_missing_source_analysis_prevents_organization(self):
        (self.ledger/pipeline.ANALYSIS).unlink()
        with self.assertRaisesRegex(ValueError,'source analysis|completed analysis'):self.publish(self.candidate(2))
        self.assertFalse((self.ledger/'plan-history'/'v2').exists())

    def test_white_box_requires_inspection_even_without_new_rules(self):
        value=scope.load(self.ledger/pipeline.ANALYSIS);value['code_inventory']=[]
        with self.assertRaisesRegex(ValueError,'actual inspected code inventory'):pipeline.complete_analysis(self.root,self.ledger,value)

    def test_analysis_rechecks_actual_source_bytes(self):
        (self.root/'notes.py').write_text('changed implementation')
        with self.assertRaisesRegex(ValueError,'code changed'):pipeline.start_unit(self.ledger,'U1')

    def test_no_out_of_order_or_concurrent_unit(self):
        with self.assertRaisesRegex(ValueError,'next published'):pipeline.start_unit(self.ledger,'U2')
        pipeline.start_unit(self.ledger,'U1')
        with self.assertRaisesRegex(ValueError,'next published'):pipeline.start_unit(self.ledger,'U2')
        self.assertEqual('U1',scope.load(self.ledger/pipeline.PROGRESS)['current_unit'])

    def test_partial_unit_remains_active_and_cannot_advance(self):
        pipeline.start_unit(self.ledger,'U1');bad=self.scene('U1');bad['scope']['criteria'][0]['check_ids']=[];self.add(bad)
        with self.assertRaisesRegex(ValueError,'lacks exact original'):pipeline.complete_unit(self.ledger,'U1')
        self.assertEqual('U1',pipeline.next_unit(self.ledger)['unit_id'])

    def test_future_unit_scene_insertion_is_rejected(self):
        pipeline.start_unit(self.ledger,'U1');self.add(self.scene('U1'));self.add(self.scene('U2'))
        with self.assertRaisesRegex(ValueError,'another unit'):pipeline.complete_unit(self.ledger,'U1')

    def test_resume_retains_original_protected_baseline(self):
        pipeline.start_unit(self.ledger,'U1');value=scope.load(self.ledger/pipeline.PROGRESS)
        self.add(self.scene('U2'));pipeline.start_unit(self.ledger,'U1')
        self.assertEqual(value['protected_scenarios'],scope.load(self.ledger/pipeline.PROGRESS)['protected_scenarios'])
        self.add(self.scene('U1'))
        with self.assertRaisesRegex(ValueError,'another unit'):pipeline.complete_unit(self.ledger,'U1')

    def test_generation_and_live_view_advance_one_unit_at_a_time(self):
        pipeline.start_unit(self.ledger,'U1');self.add(self.scene('U1'))
        self.assertEqual(['in_progress','pending'],[u['status'] for u in pipeline.view(self.ledger)['units']])
        pipeline.complete_unit(self.ledger,'U1')
        self.assertEqual(['generated','pending'],[u['status'] for u in pipeline.view(self.ledger)['units']])
        self.assertTrue(pipeline.generation_errors(self.ledger));self.generate('U2')
        self.assertEqual([],pipeline.generation_errors(self.ledger));self.assertIsNone(pipeline.next_unit(self.ledger))
        self.assertEqual('completed',pipeline.view(self.ledger)['stages'][2]['status'])
        self.assertEqual('pending',pipeline.view(self.ledger)['stages'][3]['status'])

    def test_shared_scene_does_not_need_duplicate_generation(self):
        pipeline.start_unit(self.ledger,'U1');self.add(self.scene('U1',['C1','C2'],['U1','U2']));pipeline.complete_unit(self.ledger,'U1')
        pipeline.start_unit(self.ledger,'U2');pipeline.complete_unit(self.ledger,'U2')
        self.assertEqual([],pipeline.generation_errors(self.ledger));self.assertEqual(1,len(scope.load(self.ledger/'scenarios.json')['items']))
        self.assertEqual(['S1'],pipeline.view(self.ledger)['units'][1]['scenario_ids'])

    def test_changed_generated_scene_blocks_execution_readiness(self):
        self.generate('U1');self.generate('U2');doc=scope.load(self.ledger/'scenarios.json');doc['items'][0]['acceptance']['criteria'].append('Unreviewed extra behavior');atomic_json(self.ledger/'scenarios.json',doc)
        self.assertTrue(any('changed' in e for e in pipeline.generation_errors(self.ledger)))
        self.assertEqual('stale',pipeline.view(self.ledger)['units'][0]['status'])

    def test_agent_claim_cannot_fabricate_generation_completion(self):
        value=scope.load(self.ledger/pipeline.PROGRESS);value['units'][0]['status']='generated';atomic_json(self.ledger/pipeline.PROGRESS,value)
        self.assertTrue(any('command receipt' in e for e in pipeline.generation_errors(self.ledger)))

    def test_local_repair_preserves_other_units(self):
        self.generate('U1');self.generate('U2');before=scope.load(self.ledger/pipeline.PROGRESS)['units'][1]
        pipeline.reopen_units(self.ledger,['U1']);pipeline.start_unit(self.ledger,'U1');doc=scope.load(self.ledger/'scenarios.json');doc['items'][0]['title']='Clearer note scene';atomic_json(self.ledger/'scenarios.json',doc);pipeline.complete_unit(self.ledger,'U1')
        self.assertEqual(before,scope.load(self.ledger/pipeline.PROGRESS)['units'][1]);self.assertEqual([],pipeline.generation_errors(self.ledger))

    def test_restore_uses_latest_command_receipt_preserving_active_unit(self):
        self.generate('U1');pipeline.start_unit(self.ledger,'U2');before=scope.load(self.ledger/pipeline.PROGRESS);(self.ledger/pipeline.PROGRESS).unlink()
        restored=pipeline.restore_progress(self.ledger);self.assertEqual(before,restored);self.assertEqual('U2',restored['current_unit'])

    def test_new_decision_invalidates_analysis_organization_and_recovery(self):
        scope.append_decision(self.ledger,{'id':'D1','description':'No team deletion tests','source_reference':'human current request','source_quote':'Do not test team deletion','excluded_topics':['team_deletion'],'excluded_check_ids':[],'excluded_scenario_ids':[],'excluded_rule_ids':[]})
        with self.assertRaisesRegex(ValueError,'stale|changed'):pipeline.start_unit(self.ledger,'U1')
        with self.assertRaisesRegex(ValueError,'stale|changed'):pipeline.restore_progress(self.ledger)

    def test_new_reverse_rule_cannot_be_added_during_generation(self):
        value=scope.load(self.ledger/'white_box_rules.json');value['items'].append({'id':'RULE-1','applicability':{'status':'in_scope','basis':'Note contract'}});atomic_json(self.ledger/'white_box_rules.json',value)
        with self.assertRaisesRegex(ValueError,'stale|inventory'):pipeline.start_unit(self.ledger,'U1')

    def test_complete_active_rule_inventory_requires_unit_ownership(self):
        value=scope.load(self.ledger/'white_box_rules.json');value['items'].append({'id':'RULE-1','title':'Reject huge notes','text':'Preserve saved data','rationale':'Avoid accidental loss','basis':'Explicit save contract','basis_kind':'contract','status':'supported','applicability':{'status':'in_scope','basis':'Original save change','kind':'direct','topics':['notes']},'code_sources':[{'path':'notes.py','symbol':'save','revision':'fixture-1','sha256':scope.file_hash(self.root/'notes.py')}]});atomic_json(self.ledger/'white_box_rules.json',value)
        self.analyze();candidate=self.candidate(2)
        self.assertTrue(any('rule' in e and 'ownership' in e for e in scope.definition_errors(self.ledger,candidate)))
        candidate['units'][0]['rule_ids']=['RULE-1'];self.assertEqual([],scope.definition_errors(self.ledger,candidate));self.publish(candidate)
        pipeline.start_unit(self.ledger,'U1');self.add(self.scene('U1'))
        with self.assertRaisesRegex(ValueError,'reverse-rule coverage'):pipeline.complete_unit(self.ledger,'U1')

    def test_more_requires_fresh_completion_and_actual_next_unit(self):
        with self.assertRaisesRegex(ValueError,'newly completed'):pipeline.advance_unit(self.ledger)
        self.generate('U1');self.assertEqual('U2',pipeline.advance_unit(self.ledger)['unit_id'])
        with self.assertRaisesRegex(ValueError,'newly completed'):pipeline.advance_unit(self.ledger)
        self.generate('U2')
        with self.assertRaisesRegex(ValueError,'newly completed'):pipeline.advance_unit(self.ledger)

    def test_native_workflows_enforce_order_and_every_unit_with_real_gates(self):
        # Separate fresh fixture per graph/mode so receipts never leak between tests.
        script=Path(__file__).parent/'workflow_pipeline_probe.mjs'
        for kind in ('acceptance','black-box'):
            for mode in ('pass','missing-analysis','false-completion'):
                with self.subTest(kind=kind,mode=mode):
                    fixture=DesignPipelineTest();fixture.setUp()
                    try:
                        atomic_json(fixture.ledger/'scene-templates.json',[fixture.scene('U1'),fixture.scene('U2')])
                        command=['node',str(script),str(fixture.root),str(fixture.ledger.parent),kind,mode]
                        override=os.environ.get('DELIVERY_ACCEPTANCE_FSM_OVERRIDE_DIR')
                        if override:
                            name='black-box-scenarios' if kind=='black-box' else 'delivery-acceptance'
                            command.append(str(Path(override)/(name+'.playbook')/(name+'.fsm.ts')))
                        result=subprocess.run(command,capture_output=True,text=True)
                        self.assertEqual(0,result.returncode,result.stderr+result.stdout)
                    finally:fixture.doCleanups()

    def test_stage_policy_is_fixed_and_source_bound(self):
        atomic_json(self.ledger/'design-stage-policy.json',{'stage':'white-box'})
        self.assertTrue(pipeline.analysis_errors(self.ledger))
        value=scope.load(self.ledger/pipeline.ANALYSIS);value['source_hashes']=pipeline.sources(self.ledger)
        with self.assertRaisesRegex(ValueError,'fixed workflow stage'):pipeline.complete_analysis(self.root,self.ledger,value)

    def test_white_rule_design_basis_does_not_rewrite_analyzed_rules(self):
        value=scope.load(self.ledger/'white_box_rules.json');value['design_standard']='design-quality-v4';value['design_basis']=[];atomic_json(self.ledger/'white_box_rules.json',value)
        self.assertEqual([],pipeline.analysis_errors(self.ledger))

if __name__=='__main__':unittest.main()
