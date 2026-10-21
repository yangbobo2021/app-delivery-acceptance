"""Exercise real frozen-definition/gate handoffs and real receipt-based scheduling.

Model submissions below are deterministic protocol fixtures, not product verdicts.
"""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest

import test_definition_lifecycle as lifecycle
from test_definition_lifecycle import scenario, SKILL
from acceptance_store import read, save, digest
from acceptance_definitions import load_binding
from scenario_revision import materialize, apply_patch, gate, candidate
from change_execution import select_scenes, execution_history
from unittest.mock import patch


class ScenarioRevisionTests(unittest.TestCase):
    def setUp(self):
        self.f = lifecycle.DefinitionLifecycleTests()
        self.f.setUp(); self.addCleanup(self.f.doCleanups)
        f = self.f
        f.catalog['scenarios'] += [scenario('KEEP', 'Keep this human-edited example exactly', 'R1'),
                                   scenario('RETIRE', 'Old behavior explicitly withdrawn by the revision', 'R1')]
        f.catalog['scenarios'][0]['external_refs'] = [
            {'locator': 'mind-map:node/42', 'revision': 'human-v3', 'text': 'Original source point'}]
        f.freeze(); self.previous = deepcopy(f.binding['definitions'])
        revised = deepcopy(f.catalog)
        revised['requirements'][0]['text'] = 'Return three and preserve the timestamp; the old behavior is withdrawn'
        f.freeze(revised)
        self.raw = {**f.binding, 'mode': 'edit', 'previous_definitions': self.previous,
                    'project_root': str(f.root), 'scenario_kind': 'BLACK_BOX', 'target_requirement_id': 'R1'}
        self.request = materialize(self.raw)

    def delta(self):
        old = self.request['existing_scenarios'][0]
        update = {k: old[k] for k in ('id', 'title', 'description', 'priority', 'priority_reason')}
        update['description'] += '; also preserve the timestamp'
        added = {'id': 'NEW', 'title': 'New state', 'description': 'Exercise the newly admitted state',
                 'priority': 'P1', 'priority_reason': 'The new obligation must hold'}
        return {'base_sha256': self.request['scenario_base_sha256'], 'upsert': [update, added],
                'remove_ids': ['RETIRE'], 'change_summary': ['Update, add and retire for the revised contract'],
                'change_reasons': {'S1': 'New timestamp obligation', 'NEW': 'New admitted state',
                                   'RETIRE': 'The revised requirement withdraws this old obligation'}}

    def submission(self):
        f = self.f; folder = f.local / 'workflows/scenario-edit'
        save(folder / 'request.frozen.json', self.request)
        (folder / 'scenarios.base.json').write_text(self.request['scenario_base_text'])
        save(folder / 'draft.candidate.json', self.delta())
        gate(self.request, folder)
        # Terminal protocol fixture; no model call or independent judgment is claimed.
        save(folder / 'terminal.json', {'final_state': 'done',
             'request_sha256': digest(folder / 'request.frozen.json'),
             'scenarios_sha256': digest(folder / 'scenarios.current.json'),
             'delta_sha256': digest(folder / 'draft.candidate.json')})
        path = f.local / 'workflows/edit-request.json'; save(path, self.raw)
        return path, folder

    def test_current_human_edits_are_the_baseline_and_old_requirement_is_supplied(self):
        f = self.f
        current = load_binding(f.binding)
        current['scenarios'][0]['description'] += '; human added boundary after the requirement update'
        current['scenarios'][0].pop('content_sha256')
        f.freeze(current)
        request = materialize({**self.raw, 'definitions': f.binding['definitions']})
        self.assertIn('human added boundary', request['existing_scenarios'][0]['description'])
        self.assertNotIn('human added boundary', request['previous_scenarios'][0]['description'])
        self.assertEqual(request['previous_target']['text'], 'The result shall be three')
        self.assertEqual(len(request['all_existing_scenarios']), 4)
        self.assertEqual(len(request['requirements']['items']), 3)

    def test_delta_merges_preserving_identity_origins_refs_human_text_and_other_targets(self):
        path, folder = self.submission(); f = self.f
        before = load_binding(f.binding)
        frozen_bytes = Path(f.binding['definitions']['path']).read_bytes()
        merged = candidate(path, folder)
        by_id = {s['id']: s for s in merged['scenarios']}
        self.assertEqual(set(by_id), {'S1', 'S2', 'KEEP', 'NEW'})
        self.assertEqual(by_id['KEEP'], next(s for s in before['scenarios'] if s['id'] == 'KEEP'))
        self.assertEqual(by_id['S2'], before['scenarios'][1])
        self.assertEqual(by_id['S1']['origin'], before['scenarios'][0]['origin'])
        self.assertEqual(by_id['S1']['external_refs'], before['scenarios'][0]['external_refs'])
        self.assertIn('timestamp', by_id['S1']['description'])
        self.assertEqual(by_id['NEW']['external_refs'], [])
        self.assertEqual(by_id['NEW']['origin']['kind'], 'skill_generated_internal_self_check')
        self.assertEqual(Path(f.binding['definitions']['path']).read_bytes(), frozen_bytes)
        # Candidate construction is read-only: adoption remains an explicit freeze.
        self.assertEqual(load_binding(f.binding), before)
        old_version = before['scenarios'][0]['version']
        result = f.freeze(merged)
        after = read(result['history'])
        self.assertEqual(next(s for s in after['scenarios'] if s['id'] == 'S1')['version'], old_version + 1)
        self.assertEqual(next(s for s in after['scenarios'] if s['id'] == 'KEEP')['version'], 1)
        self.assertIn('RETIRE', {s['id'] for s in read(self.previous['path'])['scenarios']})

    def test_public_merge_command_preserves_sources_and_never_freezes_implicitly(self):
        path, folder = self.submission(); f = self.f
        source = f.root / 'source-SPEC.md'; source.write_text('User-owned external agreements\n')
        before = source.read_bytes(); binding_before = deepcopy(f.binding)
        result = subprocess.run([sys.executable, str(SKILL/'scripts/acceptance_definitions.py'),
            'merge-scenarios', str(path), str(folder)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({s['id'] for s in json.loads(result.stdout)['scenarios']}, {'S1','S2','KEEP','NEW'})
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(load_binding(binding_before), load_binding(f.binding))

    def test_patch_rejects_stale_base_wholesale_replacement_foreign_ids_and_origin_changes(self):
        variations = []
        d = self.delta(); d['base_sha256'] = 'stale'; variations.append(d)
        variations.append({'scenarios': self.request['existing_scenarios']})
        d = self.delta(); d['upsert'][1]['id'] = 'S2'; variations.append(d)
        d = self.delta(); d['upsert'][0]['origin'] = {'kind': 'rewritten'}; variations.append(d)
        d = self.delta(); d['remove_ids'] = ['UNKNOWN']; variations.append(d)
        d = self.delta(); d['change_reasons'] = {}; variations.append(d)
        for delta in variations:
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                apply_patch(self.request, delta)

    def test_noop_retains_all_scenes_and_noop_upsert_is_rejected(self):
        d = {'base_sha256': self.request['scenario_base_sha256'], 'upsert': [], 'remove_ids': [],
             'change_reasons': {}, 'change_summary': ['The existing designs already cover the new wording']}
        result = apply_patch(self.request, d)
        self.assertEqual(result['scenarios'], self.request['existing_scenarios'])
        old = self.request['existing_scenarios'][0]
        d['upsert'] = [{k: old[k] for k in ('id','title','description','priority','priority_reason')}]
        d['change_reasons'] = {'S1': 'Not actually changed'}
        with self.assertRaisesRegex(ValueError, 'unchanged scenes'):
            apply_patch(self.request, d)

    def test_existing_target_requires_edit_and_edit_requires_a_real_previous_snapshot(self):
        with self.assertRaisesRegex(ValueError, 'already has scenes'):
            materialize({**self.raw, 'mode': 'create'})
        raw = deepcopy(self.raw); raw.pop('previous_definitions')
        with self.assertRaisesRegex(ValueError, 'previous_definitions'):
            materialize(raw)
        raw['previous_definitions'] = {**self.previous, 'sha256': 'changed'}
        with self.assertRaisesRegex(ValueError, 'frozen definitions changed'):
            materialize(raw)

    def test_completed_result_cannot_be_substituted_after_gate(self):
        path, folder = self.submission()
        patch_doc = read(folder / 'draft.candidate.json'); patch_doc['upsert'][0]['description'] = 'Substituted'
        save(folder / 'draft.candidate.json', patch_doc)
        with self.assertRaisesRegex(ValueError, 'delta/result changed'):
            candidate(path, folder)

    def test_priority_only_revision_does_not_turn_self_check_bookkeeping_into_a_business_change(self):
        path, folder = self.submission()
        old = self.request['existing_scenarios'][0]
        update = {k: old[k] for k in ('id','title','description','priority','priority_reason')}
        update.update(priority='P0',priority_reason='Explicit user priority adjustment')
        save(folder/'draft.candidate.json',{'base_sha256':self.request['scenario_base_sha256'],
            'upsert':[update],'remove_ids':[],'change_reasons':{'S1':'Priority adjustment only'},
            'change_summary':['No behavior changed']})
        gate(self.request,folder)
        terminal=read(folder/'terminal.json');terminal.update(
            scenarios_sha256=digest(folder/'scenarios.current.json'),
            delta_sha256=digest(folder/'draft.candidate.json'));save(folder/'terminal.json',terminal)
        merged=candidate(path,folder);r=self.f.freeze(merged)
        self.assertEqual(r['change']['rerun_scene_ids'],[])
        self.assertEqual(next(s for s in merged['scenarios'] if s['id']=='S1')['check'],old['check'])

    def test_legacy_completed_create_resume_is_read_only_and_does_not_call_a_model(self):
        f=self.f
        raw={**f.binding,'project_root':str(f.root),'scenario_kind':'BLACK_BOX','target_requirement_id':'R3'}
        legacy=materialize(raw);legacy.pop('mode');legacy.pop('all_existing_scenarios')
        folder=f.local/'workflows/legacy-create';path=f.local/'workflows/legacy-create-request.json'
        save(path,raw);save(folder/'request.frozen.json',legacy)
        save(folder/'scenarios.current.json',{'scenarios':[{'id':'R3-ONE','title':'Legacy fixture'}]})
        # Completed-protocol fixture only; this is not a claimed model or business result.
        save(folder/'terminal.json',{'final_state':'done',
            'request_sha256':digest(folder/'request.frozen.json'),
            'scenarios_sha256':digest(folder/'scenarios.current.json')})
        before={p:p.read_bytes() for p in folder.iterdir()}
        r=subprocess.run(['node',str(SKILL/'playbook/v4/run_scenarios.mjs'),str(path),str(folder),'--resume'],
                         text=True,capture_output=True)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertTrue(json.loads(r.stdout)['reused'])
        self.assertEqual(set(folder.iterdir()),set(before))
        self.assertTrue(all(p.read_bytes()==data for p,data in before.items()))


class ChangeExecutionTests(unittest.TestCase):
    def setUp(self):
        self.f = lifecycle.DefinitionLifecycleTests(); self.f.setUp(); self.addCleanup(self.f.doCleanups)
        f = self.f; f.catalog['scenarios'].append(scenario('UNRUN', 'Another R1 boundary', 'R1'))
        f.freeze(); self.previous = deepcopy(f.binding['definitions'])

    def change(self):
        f = self.f; revised = deepcopy(f.catalog)
        revised['requirements'][0]['text'] += '; also preserve time'
        f.freeze(revised)  # Requirement change and scenario adoption are separate freezes.
        revised['scenarios'][0]['description'] += '; verify preserved time'
        revised['scenarios'].append(scenario('NEW', 'New R1 behavior', 'R1'))
        f.freeze(revised)
        return load_binding(f.binding)

    def plan(self, mode):
        return {**self.f.binding, 'previous_definitions': self.previous,
                'execution_intent': {'mode': mode, 'basis': 'User-requested execution scope in this test'}}

    def real_execution(self, scene_id='S1', failing=False):
        f = self.f; f.prepare()
        folder = f.local/'workflows/prior-real-execution'
        scene = next(s for s in read(self.previous['path'])['scenarios'] if s['id']==scene_id)
        save(folder/'request.frozen.json', {'acceptance':f.acceptance, 'progress_schema':'single-agent-scene-v1',
            'project':{'id':'fixture','root':str(f.local/'workspace'),'revision':f.revision},
            'scene':scene,'case_catalog':[],'requirements':f.catalog['requirements']})
        r=subprocess.run([sys.executable,str(SKILL/'playbook/v4/run_evidence_v2.py'),
            '--cwd',str(f.local/'workspace'),'--output',str(folder/'execution'),
            '--file','tests/check.py','--',sys.executable,'-c',
            'raise SystemExit(1)' if failing else "exec(open('tests/check.py').read())"],text=True,capture_output=True)
        self.assertEqual(r.returncode,1 if failing else 0,r.stderr)
        return folder

    def test_follow_history_uses_actual_receipts_even_failed_and_does_not_execute_new_or_unrun(self):
        folder=self.real_execution(failing=True)
        receipt_bytes=(folder/'execution/execution.json').read_bytes()
        value=self.change(); history=execution_history(self.f.binding)
        self.assertEqual(history['executed_scene_ids'],['S1'])
        selection=select_scenes(self.plan('follow_history'),value)
        self.assertEqual(selection['selected_scene_ids'],['S1'])
        self.assertEqual(selection['deferred_scene_ids'],['NEW','UNRUN'])
        self.assertEqual((folder/'execution/execution.json').read_bytes(),receipt_bytes)

    def test_complete_acceptance_includes_new_unrun_and_unchanged_design_of_changed_requirement(self):
        value=self.change(); history={'executed_scene_ids':['S1'],'sources':[]}
        selection=select_scenes(self.plan('complete_change_acceptance'),value,history)
        self.assertEqual(selection['selected_scene_ids'],['NEW','S1','UNRUN'])
        self.assertNotIn('S2',selection['selected_scene_ids'])  # Unrelated R2 is outside this change.
        plan=self.plan('complete_change_acceptance');plan['scene_ids']=['S1']
        with self.assertRaisesRegex(ValueError,'cannot omit'):
            select_scenes(plan,value,history)

    def test_design_only_does_not_prepare_or_launch_even_when_history_exists(self):
        self.real_execution();value=self.change();f=self.f
        plan={**self.plan('design_only'),'schema':'acceptance-v4-plan-v2',
              'run_dir':str(f.local/'workflows/design-only'),
              'change_review':{'basis':'Whole-list impact checked; design-only fixture',
                  'checked_scene_ids':[s['id'] for s in value['scenarios']],
                  'checked_target_ids':['R1','R3']}}
        path=f.local/'workflows/design-only-plan.json';save(path,plan)
        import run_plan
        with patch('run_plan.launch',side_effect=AssertionError('design-only must never launch a tool/model')):
            run_plan.run_definitions_plan(path,plan)
        result=read(Path(plan['run_dir'])/'result.json')
        self.assertEqual(result['selected_scene_ids'],[])
        self.assertEqual(result['execution_intent'],'design_only')
        self.assertFalse((Path(plan['run_dir'])/'cases').exists())

    def test_scene_change_only_has_no_whole_list_analysis_and_unrun_scene_stays_unrun(self):
        f=self.f;revised=deepcopy(f.catalog);revised['scenarios'][2]['description']+='; Unicode input'
        f.freeze(revised);value=load_binding(f.binding)
        selection=select_scenes(self.plan('follow_history'),value,{'executed_scene_ids':['S1'],'sources':[]})
        self.assertFalse(selection['change']['analysis_required'])
        self.assertEqual(selection['selected_scene_ids'],[])
        self.assertEqual(selection['deferred_scene_ids'],['UNRUN'])

    def test_missing_scenarios_block_complete_acceptance_and_old_base_cannot_be_omitted(self):
        f=self.f;revised=deepcopy(f.catalog);revised['requirements'][2]['text']+='; changed new obligation'
        f.freeze(revised);value=load_binding(f.binding)
        with self.assertRaisesRegex(ValueError,'lacks scenarios'):
            select_scenes(self.plan('complete_change_acceptance'),value,{'executed_scene_ids':[],'sources':[]})
        plan=self.plan('follow_history');plan.pop('previous_definitions')
        with self.assertRaisesRegex(ValueError,'previous_definitions'):
            select_scenes(plan,value,{'executed_scene_ids':[],'sources':[]})
        with self.assertRaisesRegex(ValueError,'alone do not authorize'):
            select_scenes(self.f.binding,value,{'executed_scene_ids':[],'sources':[]})

    def test_complete_dispatch_reaches_new_and_previously_unrun_scenes_with_real_commands(self):
        f=self.f;template=f.prepare();value=self.change()
        plan={**self.plan('complete_change_acceptance'),'schema':'acceptance-v4-plan-v2',
            'run_dir':str(f.local/'workflows/complete-dispatch'),'case_template':template,
            'change_review':{'basis':'Dispatch-only fixture checks the complete requirement list',
                'checked_scene_ids':[s['id'] for s in value['scenarios']], 'checked_target_ids':['R1','R3']}}
        path=f.local/'workflows/complete-plan.json';save(path,plan)
        import run_plan
        actual_launch=run_plan.launch;receipts=[]
        def dispatch(argv,log):
            if Path(argv[1]).name!='scene_pipeline.py':return actual_launch(argv,log)
            config=read(argv[2]);case=read(config['case_input']);sid=case['scene']['id']
            out=Path(config['output_dir'])
            r=subprocess.run([sys.executable,str(SKILL/'playbook/v4/run_evidence_v2.py'),
                '--cwd',template['source_checkout'],'--output',str(out/'execution'),
                '--file','tests/check.py','--',sys.executable,'-c',
                "exec(open('tests/check.py').read()); print("+repr(sid)+")"],capture_output=True,text=True)
            self.assertEqual(r.returncode,0,r.stderr);self.assertIn(sid,r.stdout)
            receipts.append(read(out/'execution/execution.json'))
            # This tests host dispatch, not the business contract or model Reviewer.
            save(out/'summary.json',{'scene_id':sid,'review_status':'inconclusive',
                'reason':'Real command dispatch fixture; no independent product review requested'})
        with patch('run_plan.launch',side_effect=dispatch):run_plan.run_definitions_plan(path,plan)
        self.assertEqual(len(receipts),3)
        self.assertEqual(read(Path(plan['run_dir'])/'result.json')['selected_scene_ids'],['NEW','S1','UNRUN'])

    def test_resume_does_not_expand_a_frozen_selection_after_later_execution_history_appears(self):
        f=self.f;revised=deepcopy(f.catalog);revised['scenarios'][0]['description']+='; new input'
        f.freeze(revised)
        plan={**self.plan('follow_history'),'schema':'acceptance-v4-plan-v2',
              'run_dir':str(f.local/'workflows/fixed-selection')}
        path=f.local/'workflows/fixed-plan.json';save(path,plan)
        import run_plan
        with patch('run_plan.launch',side_effect=AssertionError('No execution should be scheduled')):
            run_plan.run_definitions_plan(path,plan)
        result_path=Path(plan['run_dir'])/'result.json';before=result_path.read_bytes()
        self.real_execution()
        self.assertEqual(execution_history(f.binding)['executed_scene_ids'],['S1'])
        with patch('run_plan.launch',side_effect=AssertionError('Resume must retain the original empty selection')):
            run_plan.run_definitions_plan(path,plan)
        self.assertEqual(result_path.read_bytes(),before)

    def test_legacy_frozen_plan_keeps_original_binding_selection_and_result_bytes(self):
        f=self.f;template=f.prepare()
        plan={**f.binding,'schema':'acceptance-v4-plan-v2','scene_ids':['S1'],
              'case_template':template,'run_dir':str(f.local/'workflows/legacy-fixture'),
              'change_review':{'basis':'Controller fixture checks the original complete input',
                  'checked_scene_ids':['S1','S2','UNRUN'],'checked_target_ids':['R1','R2','R3']}}
        path=f.local/'workflows/legacy-plan.json';save(path,plan)
        import run_plan
        actual_launch=run_plan.launch
        def controller_fixture(argv,log):
            if Path(argv[1]).name!='scene_pipeline.py':return actual_launch(argv,log)
            config=read(argv[2]);p=Path(config['output_dir'])/'summary.json'
            if not p.exists():save(p,{'scene_id':'S1','review_status':'inconclusive',
                                     'reason':'Controller fixture, no product verdict'})
        with patch('run_plan.launch',side_effect=controller_fixture):run_plan.run_definitions_plan(path,plan)
        folder=Path(plan['run_dir'])
        # Convert only this temporary controller fixture to the prior protocol.
        b=read(folder/'plan.binding.json');b.pop('selection_sha256');save(folder/'plan.binding.json',b)
        r=read(folder/'result.json');r.pop('execution_intent');r.pop('deferred_scene_ids');save(folder/'result.json',r)
        (folder/'execution-selection.json').unlink()
        before={p:p.read_bytes() for p in [folder/'plan.binding.json',folder/'result.json']}
        with patch('run_plan.launch',side_effect=controller_fixture):run_plan.run_definitions_plan(path,plan)
        self.assertFalse((folder/'execution-selection.json').exists())
        self.assertTrue(all(p.read_bytes()==data for p,data in before.items()))


if __name__=='__main__':unittest.main()
