"""Observable scope admission, incremental review and recovery regressions."""
import copy
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest

import test_playbook as base
import test_run_workflow as launcher
import acceptance_plan as scope
import priorities
import design_pipeline as pipeline


class AcceptanceOrganizationTest(unittest.TestCase):
    def setUp(self):
        with contextlib.redirect_stdout(io.StringIO()):
            base.PlaybookGatesTest.setUp(self)
        self.original = (self.ledger / 'requirements.json').read_bytes()
        req = json.loads(self.original)
        scope_file = self.ledger / scope.DECISIONS
        if not scope_file.exists():base.save(scope_file, {'version':1,'items':[]})
        analysis = {'standard':pipeline.STANDARD,'status':'complete','stage':'acceptance',
            'source_hashes':pipeline.sources(self.ledger),'requirement_ids':['REQ-1'],'rule_ids':[],
            'original_analysis_basis':'Read complete expiry condition and account constraint',
            'white_box_analysis_basis':'Inspected expiry guard with its no-write consequence',
            'code_inventory':[{'path':'expiry.py','sha256':scope.file_hash(self.project/'expiry.py'),'basis':'Actual expiry branch inspected'}]}
        pipeline.complete_analysis(self.project,self.ledger,analysis)
        self.plan = {
            'standard': scope.STANDARD, 'version': 1,
            'source_analysis_sha256':scope.file_hash(self.ledger/pipeline.ANALYSIS),'rules_sha256':pipeline.rules_digest(self.ledger),
            'requirements_sha256': scope.file_hash(self.ledger / 'requirements.json'),
            'decisions_sha256': scope.digest(scope.decisions(self.ledger)),
            'business_context': {'objective': 'Registration rejects expired codes while valid registration remains available',
                                 'basis': ['team requirements:REQ-1'],
                                 'journeys': [{'id': 'J1', 'role': 'core', 'title': 'Registration', 'requirement_ids': ['REQ-1'], 'basis': req['items'][0]['text']}]},
            'checks': [{'id': 'C1', 'requirement_id': 'REQ-1', 'source_quote': req['items'][0]['text'],
                        'behavior': 'Reject expired input without creating an account', 'disposition': 'included', 'reason': 'Original selected behavior'}],
            'units': [{'id': 'U1', 'title': 'Registration expiry boundary', 'role': 'core',
                       'boundary': 'Only confirmed expired-code behavior and its affected persistence path',
                       'requirement_ids': ['REQ-1'], 'check_ids': ['C1'], 'journey_ids': ['J1'],
                       'rule_ids':[], 'dependencies': [], 'exclusions': ['Unchanged team membership policies']}]}
        self.publish(self.plan)
        scenes = scope.load(self.ledger / 'scenarios.json')
        scenes['design_standard'] = 'design-quality-v4'
        for scene in scenes['items']:
            scene['generation_unit_id']='U1'
            scene['scope'] = {'kind': 'direct', 'unit_ids': ['U1'], 'topics': ['registration_expiry'], 'basis': 'This criterion proves the selected expiry behavior',
                              'criteria': [{'criterion': c, 'check_ids': ['C1'], 'rule_ids': [], 'basis': 'Expired registration must not succeed'} for c in scene['acceptance']['criteria']]}
            scene['risk'] = {'failure': 'Expired code accepted', 'causal_chain': 'Expired code -> account creation -> unauthorized registration',
                             'business_impact': 'Registration credential validity is broken', 'affected_users': 'Applicants using expired codes',
                             'recoverability': 'Existing invalid accounts need removal', 'likelihood_basis': 'Actual expired-input equivalence class; no incident frequency assumed',
                             'grade_basis': 'Admission control protects registration', 'journey_ids': ['J1'],
                             'critical_consequence': 'access_control_failure', 'materiality_basis': 'Invalid applicants can cross the explicitly required credential boundary'}
        base.save(self.ledger / 'scenarios.json', scenes)
        white = scope.load(self.ledger / 'white_box_rules.json'); white['design_standard'] = 'design-quality-v4';base.save(self.ledger / 'white_box_rules.json', white)
        self.review = scope.load(self.ledger / 'coverage_review.json')
        self.review['design_standard'] = 'design-quality-v4'
        self.review['white_box_priority_review']['design_standard'] = 'design-quality-v4'
        resources = scope.load(self.ledger / 'resources.json')
        for r in resources['decisions']:
            r['scope'] = {'status': 'in_scope', 'unit_ids': ['U1'], 'basis': 'This registration test needs the SMS boundary'}
        base.save(self.ledger / 'resources.json', resources)
        self.refresh_scope_review()
        pipeline.start_unit(self.ledger,'U1');pipeline.complete_unit(self.ledger,'U1')

    def publish(self, candidate):
        analysis=scope.load(self.ledger/pipeline.ANALYSIS);analysis['source_hashes']=pipeline.sources(self.ledger);analysis['requirement_ids']=[r['id'] for r in scope.load(self.ledger/'requirements.json')['items']]
        pipeline.complete_analysis(self.project,self.ledger,analysis)
        candidate['source_analysis_sha256']=scope.file_hash(self.ledger/pipeline.ANALYSIS);candidate['rules_sha256']=pipeline.rules_digest(self.ledger)
        review = {'status': 'passed', 'reviewer_kind': 'independent_ai', 'review_reference': 'independent fixture source review',
                  'plan_sha256': scope.digest(candidate), 'rule_ids':[], 'requirement_ids': [r['id'] for r in scope.load(self.ledger / 'requirements.json')['items']]}
        for k in ('original_inventory', 'bidirectional_traceability', 'scope_applicability', 'global_business_context','rule_provenance'):
            review[k] = {'status': 'passed', 'reason': 'Independently read the complete original behavior and unit boundaries'}
        scope.publish_plan(self.ledger, candidate, review, candidate['version'] - 1)

    def refresh_scope_review(self):
        scenes = scope.load(self.ledger / 'scenarios.json')['items']
        self.review['acceptance_scope_review'] = {'status': 'passed', 'reviewer_kind': 'independent_ai', 'review_reference': 'independent scope fixture',
            'plan_sha256': scope.digest(scope.load(self.ledger / scope.NAME)), 'global_priority_calibration': 'Registration admission is critical; persistence branch is important and stays P1',
            'items': [{'scenario_id': s['id'], 'scenario_sha256': scope.digest(s), 'dependencies_sha256': scope.scoped_hash(self.ledger, s),
                       'verdict': 'in_scope', 'scope_reason': 'Proves selected expiry behavior', 'priority_reason': 'Actual credential consequence assessed against registration goal',
                       'causal_chain_review': 'Checked persistence effect and real safeguards'} for s in scenes],
            'resources': [{'dependency_id': r['id'], 'resource_sha256': scope.digest(r), 'verdict': r['scope']['status'], 'reason': 'Needed only for the confirmed registration path'} for r in scope.load(self.ledger / 'resources.json')['decisions']]}
        self.review.update(base.PLAYBOOK.coverage_scope_hashes(self.ledger))
        self.review['white_box_priority_review'].update(priorities.white_box_hashes(self.ledger, scenes))
        base.save(self.ledger / 'coverage_review.json', self.review)

    def problems(self):
        return scope.scenario_errors(self.ledger, scope.load(self.ledger / 'scenarios.json')['items'], scope.load(self.ledger / 'coverage_review.json'))

    def change_scene(self, mutate):
        scenes = scope.load(self.ledger / 'scenarios.json');mutate(scenes['items'][0]);base.save(self.ledger / 'scenarios.json', scenes)

    def decision(self, **extra):
        value = {'id': 'D1', 'description': 'Exclude team authorization from this acceptance', 'source_reference': 'human turn 1',
                 'source_quote': 'Do not test team authorization', 'excluded_check_ids': [], 'excluded_scenario_ids': [],
                 'excluded_rule_ids': [], 'excluded_topics': ['team_authorization']}
        value.update(extra);scope.append_decision(self.ledger, value)
        return value

    def test_reviewed_plan_and_both_design_gates_preserve_original(self):
        self.assertEqual([], self.problems())
        self.assertEqual('black_box_ready', base.PLAYBOOK.validate_black_box(self.project)['status'])
        self.assertEqual('ready_for_run', base.PLAYBOOK.validate(self.project)['status'])
        self.assertEqual(self.original, (self.ledger / 'requirements.json').read_bytes())

    def test_partial_context_requires_real_selection_and_complete_inventory(self):
        req=scope.load(self.ledger/'requirements.json');req['items'].append({'id':'REQ-2','text':'Explain settings in help preview'})
        base.save(self.ledger/'requirements.json',req)
        plan=copy.deepcopy(self.plan);plan['requirements_sha256']=scope.file_hash(self.ledger/'requirements.json')
        self.assertTrue(any('every original' in e for e in scope.definition_errors(self.ledger,plan)))
        plan['checks'].append({'id':'C2','requirement_id':'REQ-2','source_quote':'Explain settings in help preview','behavior':'Settings help preview','disposition':'context','reason':'Only expiry selected'})
        self.assertTrue(any('silently become background' in e for e in scope.definition_errors(self.ledger,plan)))
        self.decision(selected_requirement_ids=['REQ-1'])
        plan['selection']={'mode':'selected','requirement_ids':['REQ-1'],'decision_id':'D1'}
        plan['decisions_sha256']=scope.digest(scope.decisions(self.ledger))
        analysis=scope.load(self.ledger/pipeline.ANALYSIS);analysis['source_hashes']=pipeline.sources(self.ledger);analysis['requirement_ids']=['REQ-1','REQ-2'];pipeline.complete_analysis(self.project,self.ledger,analysis)
        plan['source_analysis_sha256']=scope.file_hash(self.ledger/pipeline.ANALYSIS)
        self.assertEqual([],scope.definition_errors(self.ledger,plan))

    def test_renamed_excluded_scene_is_rejected_by_business_topic(self):
        self.decision();plan=copy.deepcopy(self.plan);plan.update(version=2,decisions_sha256=scope.digest(scope.decisions(self.ledger)));self.publish(plan)
        self.change_scene(lambda s: s.update(id='RENAMED',scope=dict(s['scope'],topics=['team_authorization'])))
        self.refresh_scope_review()
        self.assertTrue(any('confirmed user exclusion' in e for e in self.problems()))

    def test_real_new_decision_invalidates_pinned_run_and_supersedes_append_only(self):
        with contextlib.redirect_stdout(io.StringIO()):base.PLAYBOOK.new_run(self.project,'organized','abc123','isolated',execution_coverage_mode='off')
        run=scope.load(self.ledger/'runs/organized/run.json')
        self.assertTrue((self.ledger/'runs/organized/acceptance-plan.snapshot.json').is_file())
        scope.assert_current(self.ledger,run)
        old=self.decision()
        with self.assertRaisesRegex(ValueError,'decisions changed|cannot resume'):scope.assert_current(self.ledger,run)
        with self.assertRaisesRegex(ValueError,'append-only'):scope.append_decision(self.ledger,dict(old,description='rewrite history'))
        self.decision(id='D2',supersedes=['D1'],description='Resume team scope',source_quote='Now include team scope',excluded_topics=[])
        self.assertEqual(['D2'],[d['id'] for d in scope.active_decisions(self.ledger)])

    def test_core_business_p0_is_admitted_with_post_failure_remediation(self):
        self.change_scene(lambda s:s['risk'].update(
            critical_consequence='core_blocked',
            materiality_basis='The confirmed registration journey cannot deliver its required admission result; this core outcome is essential even for one affected applicant.',
            recoverability='Engineers can patch the guard or repair a valid configuration after failure; no working delivered alternative is established.'))
        self.refresh_scope_review()
        self.assertEqual([], self.problems())

    def test_p0_without_actual_materiality_is_rejected(self):
        self.change_scene(lambda s:s['risk'].pop('materiality_basis'))
        self.refresh_scope_review()
        self.assertTrue(any('materiality' in e for e in self.problems()))

    def test_each_criterion_requires_scope_and_related_regression_requires_impact(self):
        self.change_scene(lambda s:s['acceptance']['criteria'].append('Unrelated owner must have all permissions'))
        self.assertTrue(any('each exact' in e for e in self.problems()))
        self.change_scene(lambda s:s['acceptance']['criteria'].pop())
        for kind,expected in [('necessary_related','omission'),('affected_regression','change/call')]:
            self.change_scene(lambda s:s['scope'].update(kind=kind))
            self.assertTrue(any(expected in e for e in self.problems()))

    def test_existing_contract_does_not_admit_supplemental_rule(self):
        rules=scope.load(self.ledger/'white_box_rules.json');rules['items'].append({'id':'OWNER','status':'supported'})
        base.save(self.ledger/'white_box_rules.json',rules)
        scene=scope.load(self.ledger/'scenarios.json')['items'][1]
        scene['reverse_rule_ids']=['OWNER'];scene['scope']['criteria'][0].update(check_ids=[],rule_ids=['OWNER'])
        scenes=scope.load(self.ledger/'scenarios.json');scenes['items'][1]=scene;base.save(self.ledger/'scenarios.json',scenes)
        self.assertTrue(any('stale' in e or 'inventory' in e for e in self.problems()))

    def test_stale_plan_cannot_replace_newer_version(self):
        updated=copy.deepcopy(self.plan);updated['version']=2;self.publish(updated)
        with self.assertRaisesRegex(ValueError,'version changed'):self.publish(copy.deepcopy(updated))

    def test_deleting_scope_files_cannot_downgrade_or_resume(self):
        with contextlib.redirect_stdout(io.StringIO()):base.PLAYBOOK.new_run(self.project,'organized','abc123','isolated',execution_coverage_mode='off')
        run=scope.load(self.ledger/'runs/organized/run.json')
        (self.ledger/scope.NAME).unlink()
        with self.assertRaisesRegex(ValueError,'missing|binding'):scope.assert_current(self.ledger,run)

    def test_unchanged_review_retained_with_original_provenance_changed_risk_rejected(self):
        refs=scope.archive_reviews(self.ledger)
        self.review['acceptance_scope_review']['items'][0]['retained_from']=refs['SC-B']
        base.save(self.ledger/'coverage_review.json',self.review)
        self.assertEqual([],self.problems())
        self.change_scene(lambda s:s['risk'].update(recoverability='A new workaround changes risk'))
        self.assertTrue(any('fresh independent' in e for e in self.problems()))
        self.review['acceptance_scope_review']['items'][0]['scenario_sha256']=scope.digest(scope.load(self.ledger/'scenarios.json')['items'][0])
        self.review['acceptance_scope_review']['items'][0]['dependencies_sha256']=scope.scoped_hash(self.ledger,scope.load(self.ledger/'scenarios.json')['items'][0])
        base.save(self.ledger/'coverage_review.json',self.review)
        self.assertTrue(any('original review provenance' in e for e in self.problems()))

    def test_representative_first_does_not_upgrade_supporting_scene(self):
        scenes=scope.load(self.ledger/'scenarios.json')['items'];grades=[s['priority'] for s in scenes]
        plan=priorities.make_plan(scenes,priorities.DEFAULT_POLICY,'2026-10-14T00:00:00+00:00',first_scenario_ids=['SC-W'],order_basis={'source_reference':'human request','reason':'First inspect each unit representative'})
        self.assertEqual(['SC-W','SC-B'],plan['ordered_scenario_ids'])
        self.assertEqual(grades,[s['priority'] for s in scenes])
        self.assertEqual([],priorities.execution_errors(plan,scenes,[{'scenario_id':'SC-W','status':'passed'}]))

    def test_unrelated_integration_is_outside_gate_but_still_visible(self):
        resources=scope.load(self.ledger/'resources.json')
        resources['decisions'].append({'id':'unmodified-alert','kind':'third_party','description':'Unmodified alert sender','scope':{'status':'out_of_scope','unit_ids':[],'basis':'No selected change or behavior depends on real alert delivery'}})
        base.save(self.ledger/'resources.json',resources);self.refresh_scope_review()
        self.assertEqual('ready_for_run',base.PLAYBOOK.validate(self.project)['status'])
        self.assertEqual(2,len(scope.load(self.ledger/'resources.json')['decisions']))

    def test_outside_resource_does_not_reenter_per_run_gate(self):
        resources=scope.load(self.ledger/'resources.json')
        resources['decisions'].append({'id':'unmodified-alert','scope':{'status':'out_of_scope','basis':'Unrelated existing alert delivery'}})
        base.save(self.ledger/'resources.json',resources)
        run={'dependency_checks':[{'dependency_id':'sms','status':'passed','evidence':'proof/resource.txt'}]}
        self.assertEqual([],base.PLAYBOOK.lifecycle.dependency_errors(self.ledger,run))

    def test_old_formal_scope_cannot_overwrite_latest_published_plan(self):
        original_plan=scope.load(self.ledger/scope.NAME)
        original_review=scope.load(self.ledger/scope.REVIEW)
        candidate=copy.deepcopy(original_plan);candidate.update(version=2)
        self.publish(candidate)
        base.save(self.ledger/scope.NAME,original_plan);base.save(self.ledger/scope.REVIEW,original_review)
        with self.assertRaisesRegex(ValueError,'latest published'):scope.assert_current(self.ledger)

    def test_old_decision_file_cannot_erase_latest_human_decision(self):
        previous=scope.decisions(self.ledger);self.decision()
        base.save(self.ledger/scope.DECISIONS,previous)
        with self.assertRaisesRegex(ValueError,'history is newer'):scope.decisions(self.ledger)

    def test_recovery_restores_latest_scope_without_reverting_newer_decision(self):
        previous=scope.decisions(self.ledger);self.decision()
        base.save(self.ledger/scope.DECISIONS,previous)
        (self.ledger/scope.NAME).unlink()
        scope.restore_scope(self.ledger)
        self.assertEqual('D1',scope.decisions(self.ledger)['items'][0]['id'])
        with self.assertRaisesRegex(ValueError,'decisions changed'):scope.assert_current(self.ledger)

    def test_display_regrouping_retains_dependency_bound_review(self):
        refs=scope.archive_reviews(self.ledger)
        candidate=copy.deepcopy(self.plan);candidate.update(version=2);candidate['units'][0]['title']='Same checks, clearer display label'
        self.publish(candidate)
        self.review['acceptance_scope_review']['plan_sha256']=scope.digest(candidate)
        for item in self.review['acceptance_scope_review']['items']:
            item['retained_from']=refs[item['scenario_id']]
        self.review.update(base.PLAYBOOK.coverage_scope_hashes(self.ledger))
        self.review['white_box_priority_review'].update(priorities.white_box_hashes(self.ledger,scope.load(self.ledger/'scenarios.json')['items']))
        base.save(self.ledger/'coverage_review.json',self.review)
        self.assertEqual([],self.problems())

    def test_user_excluded_real_integration_remains_unverified(self):
        self.decision(description='Exclude real SMS delivery',source_quote='Verify the mock flow; leave real SMS unverified',excluded_topics=['real_sms_delivery'])
        candidate=copy.deepcopy(self.plan);candidate.update(version=2,decisions_sha256=scope.digest(scope.decisions(self.ledger)));self.publish(candidate)
        resources=scope.load(self.ledger/'resources.json')
        resources['decisions'][0]['scope'].update(integration_scope='excluded',decision_id='D1')
        resources['decisions'][0].pop('integration')
        base.save(self.ledger/'resources.json',resources);self.refresh_scope_review()
        pipeline.start_unit(self.ledger,'U1');pipeline.complete_unit(self.ledger,'U1')
        report=base.PLAYBOOK.validate(self.project)
        self.assertEqual('ready_for_run',report['status'])
        self.assertFalse(report['acceptance_scope']['original_requirements_complete'])
        self.assertEqual('sms',report['acceptance_scope']['unverified_integrations'][0]['dependency_id'])

    def workflow_scope(self,kind,mode='pass'):
        driver=Path(__file__).with_name('workflow_scope_probe.mjs')
        result=subprocess.run(['node',str(driver),str(self.project),str(self.test_dir),kind,mode],capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr)
        return json.loads(result.stdout)

    def test_pure_white_box_design_uses_same_pipeline_without_black_scenes_or_resources(self):
        scenes=scope.load(self.ledger/'scenarios.json')
        scenes['items']=[s for s in scenes['items'] if s['kind']=='white_box']
        scenes['black_box_complete']=False
        base.save(self.ledger/'scenarios.json',scenes)
        analysis=scope.load(self.ledger/pipeline.ANALYSIS);analysis['stage']='white-box'
        pipeline.complete_analysis(self.project,self.ledger,analysis)
        candidate=copy.deepcopy(self.plan);candidate['version']=2;self.publish(candidate)
        self.refresh_scope_review()
        pipeline.start_unit(self.ledger,'U1');pipeline.complete_unit(self.ledger,'U1')
        (self.ledger/'resources.json').unlink()
        report=base.PLAYBOOK.validate_white_box(self.project)
        self.assertEqual('white_box_ready',report['status'],report)
        self.assertNotIn('resources',report['gates'])
        self.assertEqual('not_requested',pipeline.view(self.ledger)['stages'][-1]['status'])

    def test_real_organization_gate_precedes_resources_and_black_box_design(self):
        for kind,entry,target in [('acceptance','entry1','resource1'),('black-box','entry','scenarioDesign')]:
            with self.subTest(kind=kind):
                trace=self.workflow_scope(kind)
                self.assertEqual(target,trace['entered'])
                self.assertEqual([entry,'sourceAnalysis','analysisGate','organizationDesign','organizationReview','organizationGate',target],trace['calls'])
                self.assertEqual([{'stateId':'analysisGate','exitStatus':0},{'stateId':'organizationGate','exitStatus':0}],trace['scripts'])

    def test_false_reviewer_claim_cannot_bypass_missing_scope(self):
        (self.ledger/scope.NAME).unlink()
        for kind in ('acceptance','black-box'):
            with self.subTest(kind=kind):
                trace=self.workflow_scope(kind)
                self.assertEqual('incomplete',trace['state'])
                self.assertEqual(3,trace['reviews'])
                self.assertTrue(all(s['exitStatus']!=0 for s in trace['scripts'] if s['stateId']=='organizationGate'))
                self.assertNotIn('resource1',trace['calls']);self.assertNotIn('scenarioDesign',trace['calls'])

    def test_organization_repair_is_independently_rereviewed_and_bounded(self):
        for kind in ('acceptance','black-box'):
            with self.subTest(kind=kind):
                repaired=self.workflow_scope(kind,'repair')
                self.assertEqual(2,repaired['reviews'])
                self.assertEqual(1,repaired['calls'].count('organizationRepair'))
                rejected=self.workflow_scope(kind,'review-gaps')
                self.assertEqual('incomplete',rejected['state']);self.assertEqual(3,rejected['reviews'])
                self.assertEqual([{'stateId':'analysisGate','exitStatus':0}],rejected['scripts'])


class ScopeRecoveryLauncherTest(unittest.TestCase):
    setUp=launcher.RunnerTests.setUp
    launch=launcher.RunnerTests.launch
    fake_runtime=launcher.RunnerTests.fake_runtime

    def test_same_path_changed_original_is_rejected_before_resume(self):
        env=self.fake_runtime();first=self.launch(env);sid=json.loads(first.stdout)['sessionId']
        req=json.loads(self.requirements.read_text());req['items'][0]['text']='Changed confirmed behavior';self.requirements.write_text(json.dumps(req))
        result=self.launch(env,extra=('--session',sid))
        self.assertNotEqual(0,result.returncode);self.assertIn('requirements content changed',result.stderr)

    def test_latest_scope_decision_and_missing_policy_reject_resume(self):
        env=self.fake_runtime();first=self.launch(env);sid=json.loads(first.stdout)['sessionId'];ledger=self.project/'tests/delivery-acceptance'
        document=scope.decisions(ledger);document['items'].append({'id':'latest-human-turn'});base.save(ledger/scope.DECISIONS,document)
        result=self.launch(env,extra=('--session',sid));self.assertNotEqual(0,result.returncode);self.assertIn('scope or original content changed',result.stderr)
        (ledger/scope.POLICY).unlink()
        result=self.launch(env,extra=('--session',sid));self.assertNotEqual(0,result.returncode)
        self.assertFalse((ledger/scope.POLICY).exists())


if __name__ == '__main__':
    unittest.main()
