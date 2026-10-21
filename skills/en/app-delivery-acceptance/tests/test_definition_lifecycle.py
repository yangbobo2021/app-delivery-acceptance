"""Behavioral integration checks of project-owned definitions; no external-system adapters."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SKILL = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'scripts/v3'), str(SKILL / 'playbook/v4')]
from acceptance_store import initialize, read_knowledge, publish_catalog, read, save, digest, validate, guard
from acceptance_definitions import compare, scene_input, verify_case, verify_stage, load_binding, scene_fingerprint
from project_view import ProjectView, catalog_trace
from project_statistics import project_state
from run_plan import run_definitions_plan


def definition(ident, text, external=False):
    return {'id': ident, 'text': text, 'origin': {'kind': 'source' if external else 'user_statement',
            'reference': 'SPEC entry ' + ident if external else 'User turn: acceptance fixture'},
            'external_refs': [{'locator': 'opaque-system:node/' + ident, 'revision': '1', 'text': text}]
                             if external else []}


def scenario(ident, text, target=None):
    return {'id': ident, 'title': ident, 'description': text, 'priority': 'P1',
            'priority_reason': 'Incorrect result breaks this accepted behavior',
            'origin': {'kind': 'existing_scene', 'reference': 'Agent-selected source point ' + ident},
            'external_refs': [], 'check': {'method': 'agent_adopted',
                'basis': 'Checked the supplied condition, action, expected result and scope'},
            **({'requirement_id': target} if target else {})}


class DefinitionLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'project'; self.root.mkdir()
        self.at = 'AT-definition-lifecycle'
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Definition integration test')
        (self.root / 'product.py').write_text('def result():\n    return 3\n')
        (self.root / 'tests').mkdir()
        (self.root / 'tests/check.py').write_text('from product import result\nassert result() == 3\nprint("observed result: 3")\n')
        (self.root / '.gitignore').write_text('__pycache__/\n')
        self.git('add', '.'); self.git('commit', '-qm', 'fixture product and executable test')
        self.revision = self.git('rev-parse', 'HEAD')
        initialize(self.root, self.at, 'Definition lifecycle', 'Tester', {'targets': ['selected subset']}, 'User request')
        self.acceptance = read_knowledge(self.root, self.at, [])['acceptance']
        self.shared = self.root / '.acceptance' / self.at
        self.local = self.root / '.acceptance-local' / self.at
        self.catalog = {'schema': 'acceptance-catalog-v2', 'project': {'id': 'fixture'},
            'basis': 'User selects these definitions for this delivery test',
            'context': {'business_goal': 'Verify the selected fixture behavior', 'shared_constraints': ''},
            'requirements': [definition('R1', 'The result shall be three', True),
                             definition('R2', 'Keep the existing value', True),
                             definition('R3', 'User additionally requires a useful result')],
            'reverse_rules': [], 'scenarios': [scenario('S1', 'Call result and observe three', 'R1'),
                                               scenario('S2', 'Read the existing value', 'R2')]}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def freeze(self, value=None, assessment=None):
        result = publish_catalog(self.root, self.at, value or self.catalog, assessment=assessment)
        self.binding = {'acceptance': self.acceptance, 'definitions': result['definitions']}
        return result

    def test_three_complete_requirements_two_external_one_spoken_and_no_backfill(self):
        external = self.root / 'source.txt'; external.write_text('Ten external requirements remain untouched')
        original = external.read_bytes()
        frozen = self.freeze()
        value = load_binding(self.binding)
        self.assertEqual(len(value['requirements']), 3)
        self.assertEqual([bool(r['external_refs']) for r in value['requirements']], [True, True, False])
        self.assertEqual(value['requirements'][2]['text'], self.catalog['requirements'][2]['text'])
        self.assertEqual(value['requirements'][2]['origin']['kind'], 'user_statement')
        self.assertEqual(external.read_bytes(), original)
        external.unlink()  # Frozen definitions remain readable without the source.
        self.assertEqual(read(frozen['history'])['requirements'][0]['text'], 'The result shall be three')
        self.assertIn('R3', frozen['change']['missing_scenario_target_ids'])

    def prepare(self):
        spec = self.local / 'workflows/prep-input.json'
        save(spec, {'schema': 'portable-project-prep-v1', 'acceptance': self.acceptance,
                    'project_root': str(self.root), 'source_checkout': str(self.root), 'revision': self.revision,
                    'source_paths': ['product.py'], 'test_roots': ['tests'],
                    'coverage': {'policy': 'off', 'reason': 'Explicitly skipped for toolchain integration fixture'}})
        out = self.local / 'workflows/prepared'
        result = subprocess.run([sys.executable, str(SKILL / 'playbook/v4/prepare_project.py'), str(spec), str(out)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        guide = self.local / 'workflows/guide.json'; save(guide, {})
        return {'acceptance': self.acceptance, 'source_checkout': str(self.local / 'workspace'),
                'template_catalog': str(out / 'catalog.json'), 'guide': str(guide),
                'coverage': {'policy': 'off', 'reason': 'Explicit toolchain fixture skip'}}

    def test_existing_standalone_scene_binds_and_executes_without_generation_or_fake_requirement(self):
        value = deepcopy(self.catalog)
        value['requirements'] = []
        value['scenarios'] = [scenario('EXISTING-1', 'Call result and verify three')]
        self.freeze(value)
        template = {**self.prepare(), 'definitions': self.binding['definitions'], 'scene_id': 'EXISTING-1',
                    'case_run_dir': str(self.local / 'workflows/adopted-case')}
        source = self.local / 'workflows/template.json'; save(source, template)
        out = self.local / 'workflows/handoff'
        bound = subprocess.run([sys.executable, str(SKILL / 'playbook/v4/bind_case.py'), str(source), str(out)],
                               capture_output=True, text=True)
        self.assertEqual(bound.returncode, 0, bound.stderr)
        case = read(out / 'case-input.json')
        self.assertIsNone(case['requirement'])
        self.assertNotIn('requirement_id', case['scene'])
        self.assertEqual(case['scenario_self_check'], 'agent_adopted')
        verify_case(case)
        work = self.local / 'workspace'
        run = subprocess.run([sys.executable, str(SKILL / 'playbook/v4/run_evidence_v2.py'),
            '--cwd', str(work), '--output', str(self.local / 'workflows/real-execution'),
            '--file', 'tests/check.py', '--', sys.executable, '-c',
            "exec(open('tests/check.py').read())"], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        receipt = read(self.local / 'workflows/real-execution/execution.json')
        self.assertEqual(receipt['exit_code'], 0)
        self.assertEqual(receipt['head_before'], self.revision)
        self.assertIn('observed result: 3', run.stdout)
        # This is a real execution receipt, deliberately no fabricated independent verdict.
        self.assertFalse((out / 'review/answer.json').exists())

    def test_pending_reverse_rule_is_preserved_but_cannot_own_or_contextualize_scene(self):
        rule = definition('REV1', 'Observed retry behavior')
        rule.update(status='needs_confirmation', basis_kind='candidate', basis='Observed in implementation',
                    question='Should retry be a product obligation?', code_sources=[
                        {'path': 'product.py', 'revision': self.revision, 'sha256': digest(self.root / 'product.py')}])
        self.catalog['reverse_rules'] = [rule]
        self.freeze()
        self.assertEqual(load_binding(self.binding)['reverse_rules'][0]['question'], rule['question'])
        candidate = deepcopy(self.catalog)
        candidate['scenarios'].append(scenario('S-REV', 'Retry must succeed', 'REV1'))
        with self.assertRaisesRegex(ValueError, 'pending reverse rule'):
            self.freeze(candidate)
        candidate['scenarios'][-1].pop('requirement_id')
        candidate['scenarios'][-1]['related_refs'] = ['REV1']
        with self.assertRaisesRegex(ValueError, 'pending reverse rule'):
            self.freeze(candidate)
        with self.assertRaisesRegex(ValueError, 'scene absent'):
            scene_input(self.binding, 'REV1')

    def test_change_retains_old_definition_receipt_and_confirmed_result_but_marks_applicability(self):
        first = self.freeze()
        old = load_binding(self.binding)
        old_case = {'acceptance': self.acceptance, **scene_input(self.binding, 'S1')}
        history_bytes = Path(first['history']).read_bytes()
        trace = {'project': {'id': 'fixture', 'revision': self.revision}, 'generated_at': '2026-10-01T01:00:00Z',
                 'attempt_id': 'attempt-1', 'requirements': old['requirements'], 'reverse_rules': [],
                 'scenarios': [old['scenarios'][0]], 'executed_scene_ids': ['S1'],
                 'bindings': [], 'case_results': [], 'judgment': {'status': 'passed', 'reason': 'Historical fixture conclusion'},
                 'definition_binding_sha256': old_case['definition_binding_sha256']}
        trace_bytes = json.dumps(trace, sort_keys=True)
        candidate = deepcopy(self.catalog); candidate['requirements'][0]['text'] = 'The result shall be four'
        proposed = compare(old, candidate)
        self.assertEqual(proposed['rerun_scene_ids'], ['S1'])
        self.assertEqual(proposed['coverage_check_scene_ids'], ['S1', 'S2'])
        self.assertEqual(load_binding(self.binding), old)  # Comparison does not adopt it.
        second = self.freeze(candidate)
        with self.assertRaisesRegex(ValueError, 'definitions changed'):
            verify_case(old_case)
        self.assertEqual(Path(first['history']).read_bytes(), history_bytes)
        current = read(second['history'])
        self.assertEqual(current['requirements'][0]['version'], 2)
        self.assertEqual(current['requirements'][1]['version'], 1)
        projected = project_state([trace, catalog_trace(self.shared / 'scenarios.json', 'fixture')], {})
        row = next(t for t in projected['traces'] if t.get('scenarios') and t['scenarios'][0]['id'] == 'S1')
        self.assertEqual(row['judgment']['status'], 'passed')
        self.assertEqual(row['definition_applicability'], 'needs_revalidation')
        self.assertEqual(projected['projects'][0]['passed'], 1)
        self.assertEqual(json.dumps(trace, sort_keys=True), trace_bytes)

    def test_changed_plan_dispatches_only_affected_scene_and_requires_global_impact_check(self):
        first = self.freeze()
        template = self.prepare()
        candidate = deepcopy(self.catalog); candidate['scenarios'][0]['description'] += '; also observe the label'
        result = self.freeze(candidate)
        run_dir = self.local / 'workflows/rerun'
        plan = {**self.binding, 'schema': 'acceptance-v4-plan-v2', 'run_dir': str(run_dir),
                'case_template': template, 'changed_only': True,
                'previous_definitions': first['definitions'],
                'execution_intent': {'mode': 'complete_change_acceptance',
                    'basis': 'Dispatcher fixture requests acceptance of the changed scene'}}
        plan_path = self.local / 'workflows/plan.json'; save(plan_path, plan)
        import run_plan
        actual_launch = run_plan.launch
        invoked = []
        def launch(argv, log):
            if Path(argv[1]).name == 'scene_pipeline.py':
                config = read(argv[2]); case = read(config['case_input']); verify_case(case)
                invoked.append(case['scene']['id'])
                # Dispatcher test only. This fixture is not independent product evidence.
                save(Path(config['output_dir']) / 'summary.json', {'scene_id': case['scene']['id'],
                     'review_status': 'inconclusive', 'reason': 'Dispatcher fixture; no reviewer called'})
            else:
                actual_launch(argv, log)
        with patch('run_plan.launch', side_effect=launch):
            run_definitions_plan(plan_path, plan)
        self.assertEqual(invoked, ['S1'])
        self.assertEqual(read(run_dir / 'result.json')['unselected_scene_ids'], ['S2'])
        candidate['requirements'][0]['text'] += '; changed shared business interpretation'
        result = self.freeze(candidate)
        plan.update(definitions=result['definitions'], run_dir=str(self.local / 'workflows/next-rerun'))
        save(plan_path, plan)
        with self.assertRaisesRegex(ValueError, 'Agent must review'):
            run_definitions_plan(plan_path, plan)

    def test_source_reference_backfill_and_priority_do_not_reexecute_behavior(self):
        first = self.freeze()
        previous = load_binding(self.binding)
        candidate = deepcopy(self.catalog)
        candidate['requirements'][2]['external_refs'] = [
            {'locator': 'online-system:item/R3', 'revision': 'adopted-1', 'text': candidate['requirements'][2]['text']}]
        candidate['scenarios'][0]['priority'] = 'P0'
        changed = self.freeze(candidate)
        self.assertEqual(changed['change']['rerun_scene_ids'], [])
        self.assertEqual(scene_fingerprint(previous, 'S1'), scene_fingerprint(load_binding(self.binding), 'S1'))
        self.assertEqual(read(first['history'])['requirements'][2]['external_refs'], [])

    def test_tampering_old_definition_or_missing_binding_cannot_silently_continue(self):
        first = self.freeze()
        candidate = deepcopy(self.catalog); candidate['scenarios'][0]['description'] += ' updated'
        self.freeze(candidate)
        with self.assertRaisesRegex(ValueError, 'binding required'):
            load_binding({'acceptance': self.acceptance})
        old = read(first['history']); old['requirements'][0]['text'] = 'tampered'
        save(first['history'], old)
        with self.assertRaisesRegex(ValueError, 'frozen definition.*changed'):
            validate(self.root, self.at)

    def test_external_expected_text_change_is_not_mistaken_for_a_link_only_edit(self):
        self.freeze()
        old = load_binding(self.binding)
        candidate = deepcopy(self.catalog)
        candidate['requirements'][0]['external_refs'][0].update(revision='2', text='The result shall be four')
        report = compare(old, candidate)
        self.assertTrue(report['analysis_required'])
        self.assertEqual(report['rerun_scene_ids'], ['S1'])
        self.assertNotEqual(scene_fingerprint(old, 'S1'), scene_fingerprint(candidate, 'S1'))

    def test_equivalent_rewording_keeps_explicit_assessment_instead_of_rewriting_old_verdict(self):
        self.freeze()
        old = load_binding(self.binding)
        actual = scene_fingerprint(old, 'S1')
        candidate = deepcopy(self.catalog)
        candidate['requirements'][0]['text'] = 'The returned value shall equal three'
        result = self.freeze(candidate, {'changes': {'requirements:R1':
            {'classification': 'equivalent', 'reason': 'Agent compared both forms: same value and conditions'}}})
        self.assertEqual(result['change']['rerun_scene_ids'], [])
        self.assertIn(actual, result['change']['equivalent_bindings']['S1'])
        trace = {'project': {'id': 'fixture', 'revision': self.revision}, 'generated_at': '2026-10-01T01:00:00Z',
                 'requirements': old['requirements'], 'reverse_rules': [], 'scenarios': [old['scenarios'][0]],
                 'executed_scene_ids': ['S1'], 'judgment': {'status': 'passed'},
                 'definition_binding_sha256': actual}
        view = project_state([trace, catalog_trace(self.shared / 'scenarios.json', 'fixture')], {})
        row = next(t for t in view['traces'] if t.get('scenarios') and t['scenarios'][0]['id'] == 'S1')
        self.assertEqual(row['definition_applicability'], 'equivalent_by_assessment')
        self.assertEqual(row['judgment']['status'], 'passed')

    def test_retired_scene_is_kept_in_history_without_expanding_current_denominator(self):
        first = self.freeze()
        old = load_binding(self.binding)
        candidate = deepcopy(self.catalog); candidate['scenarios'] = [candidate['scenarios'][0]]
        self.freeze(candidate)
        historical = {'project': {'id': 'fixture'}, 'generated_at': '2026-10-01T01:00:00Z',
                      'scenarios': [old['scenarios'][1]], 'requirements': old['requirements'],
                      'executed_scene_ids': ['S2'], 'judgment': {'status': 'passed'}}
        projected = project_state([historical, catalog_trace(self.shared / 'scenarios.json', 'fixture')], {})
        self.assertEqual(projected['projects'][0]['scenario_count'], 1)
        self.assertEqual(read(first['history'])['scenarios'][1]['id'], 'S2')

    def test_definition_adoption_waits_for_safe_stage_boundary(self):
        import fcntl
        first = self.freeze()
        candidate = deepcopy(self.catalog); candidate['requirements'][0]['text'] += ' changed'
        with (self.local / 'workspace.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'safe boundary'):
                self.freeze(candidate)
        self.assertEqual(read(self.shared / 'scenarios.json'), read(first['history']))

    def test_analysis_and_reverse_cannot_substitute_or_omit_frozen_requirements(self):
        self.freeze()
        request = {**self.binding, 'requirements': {'items': self.catalog['requirements']}}
        verify_stage(request)
        wrong = deepcopy(request); wrong['requirements']['items'][0]['text'] = 'silently changed expectation'
        with self.assertRaisesRegex(ValueError, 'stage requirements differ'):
            verify_stage(wrong)
        wrong['requirements']['items'] = wrong['requirements']['items'][1:]
        with self.assertRaisesRegex(ValueError, 'stage requirements differ'):
            verify_stage(wrong)

    def independent_addition(self):
        value = deepcopy(load_binding(self.binding))
        value['requirements'].append(definition('R4', 'Accept an independent input format'))
        value['scenarios'].append(scenario('S4', 'Exercise the independent input format', 'R4'))
        value['context'].update(business_goal='Verify existing behavior and the additional input format',
            confirmed_scope={'included_requirement_ids': ['R1', 'R2', 'R3', 'R4']},
            requirement_groups=[{'id': 'G4', 'requirement_ids': ['R4'], 'reason': 'Independent obligation'}],
            user_constraints=[{'id': 'U4', 'description': 'Accept the additional requirement'}])
        return value

    def test_independent_addition_changes_only_new_target_selection_and_business_binding(self):
        from change_execution import select_scenes
        first = self.freeze(); old = load_binding(self.binding)
        candidate = self.independent_addition(); result = self.freeze(candidate)
        current = load_binding(self.binding); report = result['change']
        self.assertTrue(report['analysis_required'])
        self.assertTrue(report['context_changed'])
        self.assertFalse(report['execution_context_changed'])
        self.assertEqual(report['rerun_scene_ids'], ['S4'])
        self.assertEqual(current['requirements'][:3], old['requirements'])
        self.assertEqual(current['scenarios'][:2], old['scenarios'])
        self.assertEqual(scene_fingerprint(old, 'S1'), scene_fingerprint(current, 'S1'))
        plan = {**self.binding, 'previous_definitions': first['definitions'],
                'execution_intent': {'mode': 'complete_change_acceptance', 'basis': 'Accept new R4'}}
        selection = select_scenes(plan, current, {'executed_scene_ids': ['S1', 'S2'], 'sources': []})
        self.assertEqual(selection['selected_scene_ids'], ['S4'])
        self.assertEqual(selection['affected_target_ids'], ['R4'])
        self.assertEqual(selection['deferred_scene_ids'], [])

    def test_shared_constraints_still_invalidate_all_scene_bindings_and_select_unrun_scenes(self):
        from change_execution import select_scenes
        self.catalog['scenarios'].append(scenario('S3', 'Check the third requirement', 'R3'))
        first = self.freeze(); old = load_binding(self.binding)
        candidate = deepcopy(old)
        candidate['context']['shared_constraints'] = 'Every result must now include an audit timestamp'
        result = self.freeze(candidate); current = load_binding(self.binding)
        self.assertTrue(result['change']['execution_context_changed'])
        self.assertEqual(result['change']['scenario_target_ids'], ['R1', 'R2', 'R3'])
        self.assertEqual(result['change']['rerun_scene_ids'], ['S1', 'S2', 'S3'])
        self.assertNotEqual(scene_fingerprint(old, 'S1'), scene_fingerprint(current, 'S1'))
        plan = {**self.binding, 'previous_definitions': first['definitions'],
                'execution_intent': {'mode': 'complete_change_acceptance', 'basis': 'Accept changed common obligation'}}
        selection = select_scenes(plan, current, {'executed_scene_ids': ['S1'], 'sources': []})
        self.assertEqual(selection['selected_scene_ids'], ['S1', 'S2', 'S3'])

    def test_unknown_context_fields_remain_binding_and_related_requirements_propagate(self):
        self.catalog['scenarios'][0]['related_refs'] = ['R2']
        self.freeze(); old = load_binding(self.binding)
        candidate = deepcopy(old)
        candidate['context']['domain_invariant'] = 'A newly supplied common condition'
        self.assertEqual(compare(old, candidate)['rerun_scene_ids'], ['S1', 'S2'])
        self.assertNotEqual(scene_fingerprint(old, 'S1'), scene_fingerprint(candidate, 'S1'))
        candidate = deepcopy(old)
        candidate['requirements'][1]['text'] += '; changed actual behavior'
        self.assertEqual(compare(old, candidate)['rerun_scene_ids'], ['S1', 'S2'])

    def test_legacy_hashes_remain_current_across_independent_addition_without_rewriting_history(self):
        first = self.freeze(); old = load_binding(self.binding)
        old_bytes = Path(first['history']).read_bytes()
        actual = scene_fingerprint(old, 'S1', legacy_context=True)
        trace = {'project': {'id': 'fixture', 'revision': self.revision},
                 'generated_at': '2026-10-01T01:00:00Z', 'scenarios': [old['scenarios'][0]],
                 'requirements': old['requirements'], 'executed_scene_ids': ['S1'],
                 'judgment': {'status': 'passed', 'reason': 'Existing fixture verdict'},
                 'definition_binding_sha256': actual}
        trace_bytes = json.dumps(trace, sort_keys=True)
        self.freeze(self.independent_addition())
        def row():
            state = project_state([trace, catalog_trace(self.shared / 'scenarios.json', 'fixture')], {})
            return next(t for t in state['traces'] if t.get('scenarios') and t['scenarios'][0]['id'] == 'S1')
        self.assertEqual(row()['definition_applicability'], 'matches_current')
        self.assertEqual(row()['definition_binding_sha256'], actual)
        candidate = deepcopy(load_binding(self.binding))
        candidate['context']['shared_constraints'] = 'An actual new common behavior obligation'
        self.freeze(candidate)
        self.assertEqual(row()['definition_applicability'], 'needs_revalidation')
        self.assertEqual(row()['judgment'], trace['judgment'])
        self.assertEqual(Path(first['history']).read_bytes(), old_bytes)
        self.assertEqual(json.dumps(trace, sort_keys=True), trace_bytes)

    def test_legacy_case_binding_requires_the_same_exact_frozen_snapshot(self):
        self.freeze()
        old = load_binding(self.binding)
        case = {'acceptance': self.acceptance, **scene_input(self.binding, 'S1')}
        case['definition_binding_sha256'] = scene_fingerprint(old, 'S1', legacy_context=True)
        verify_case(case)
        bad = deepcopy(case); bad['definition_binding_sha256'] = 'unproved-hash'
        with self.assertRaisesRegex(ValueError, 'definition_binding_sha256'):
            verify_case(bad)
        self.freeze(self.independent_addition())
        with self.assertRaisesRegex(ValueError, 'definitions changed'):
            verify_case(case)

    def test_pre_v2_ancestor_cannot_supply_unproved_compatibility_bindings(self):
        from acceptance_definitions import legacy_scene_bindings
        self.freeze(); current = load_binding(self.binding)
        legacy = self.shared / 'records/catalog-pre-v2.json'
        save(legacy, {'schema': 'acceptance-catalog-v1', 'acceptance_id': self.at,
                      'scenarios': [{'id': 'S1'}]})
        current['previous_catalog_sha256'] = digest(legacy)
        matches, assessed = legacy_scene_bindings(self.shared / 'scenarios.json', current)
        self.assertEqual(matches['S1'], [scene_fingerprint(current, 'S1', legacy_context=True)])
        self.assertEqual(assessed, {})

    def test_legacy_equivalence_still_needs_the_recorded_semantic_assessment(self):
        self.freeze(); old = load_binding(self.binding)
        trace = {'project': {'id': 'fixture'}, 'generated_at': '2026-10-01T01:00:00Z',
                 'scenarios': [old['scenarios'][0]], 'executed_scene_ids': ['S1'],
                 'judgment': {'status': 'passed'},
                 'definition_binding_sha256': scene_fingerprint(old, 'S1', legacy_context=True)}
        candidate = deepcopy(old); candidate['requirements'][0]['text'] = 'The returned value shall equal three'
        self.freeze(candidate, {'changes': {'requirements:R1': {
            'classification': 'equivalent', 'reason': 'Same expected value and conditions'}}})
        projected = project_state([trace, catalog_trace(self.shared / 'scenarios.json', 'fixture')], {})
        row = next(t for t in projected['traces'] if t.get('scenarios') and t['scenarios'][0]['id'] == 'S1')
        self.assertEqual(row['definition_applicability'], 'equivalent_by_assessment')


if __name__ == '__main__':
    unittest.main()
