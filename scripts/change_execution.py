"""Choose work from user intent and existing execution facts, never from a pass label."""
from pathlib import Path
import sys


def execution_history(config):
    """Reuse the viewer's receipt/history readers without computing coverage or running tools."""
    from acceptance_store import locations, read, digest
    sys.path.insert(0, str(Path(__file__).parent / 'v3'))
    from project_view import ProjectView, files_under, workflow_requests
    from project_statistics import execution_happened
    from progress_views import collect
    at = config['acceptance']
    root, shared, local = locations(at['project_root'], at['id'])
    view = ProjectView(root, at['id'])
    roots = view.roots(at['id'])
    paths = files_under(roots, 'trace.json')
    traces = []
    for path in paths:
        trace = read(path)
        if trace.get('schema') != 'delivery-trace-v1' or \
                trace.get('acceptance', {}).get('id', at['id']) != at['id']:
            raise ValueError('invalid or foreign execution history')
        traces.append(trace)
    requests, origins = workflow_requests(roots, local)
    progress = collect([], traces, request_paths=requests,
        artifact_resolver=lambda path, name: view.resolve_evidence(path, name, at['id']),
        request_origins=origins)
    rows = [*traces, *progress.get('case_history', []), *progress.get('previews', [])]
    executed = {s['id'] for row in rows for s in row.get('scenarios', [])
                if execution_happened(row, s['id'])}
    return {'executed_scene_ids': sorted(executed),
            'sources': [{'path': str(p), 'sha256': digest(p)} for p in [*paths, *requests]]}


def select_scenes(plan, value, history=None):
    from acceptance_definitions import compare, load_binding, refs
    intent = plan.get('execution_intent')
    if intent is None and not plan.get('changed_only'):
        if 'scene_ids' not in plan:
            raise ValueError('declare execution_intent or explicit scene_ids; updated definitions alone do not authorize execution')
        selected = plan['scene_ids']
        mode, basis = 'explicit_selection', plan.get('scope_note', 'Existing declared execution selection')
    else:
        intent = intent or {'mode': 'follow_history', 'basis': 'Changed-only plan: revise already executed scenes'}
        mode, basis = intent.get('mode'), intent.get('basis')
        if mode not in {'complete_change_acceptance', 'follow_history', 'design_only'} or \
                not isinstance(basis, str) or not basis.strip():
            raise ValueError('execution_intent needs a supported mode and actual user/task basis')
        selected = None
    base = plan.get('previous_definitions')
    if plan.get('execution_intent') and mode != 'design_only' and not base:
        raise ValueError('change execution needs previous_definitions from before all dependent revisions')
    report = compare(load_binding({**plan, 'definitions': base}, current=False, required=True), value,
                     plan.get('change_review', {}).get('assessment')) if base else value['change']
    scenes = value['scenarios']; known = {s['id'] for s in scenes}
    affected = set(report['rerun_scene_ids'])
    changed_targets = {c['ref'].split(':', 1)[1] for c in report['changes']
                       if c['classification'] == 'definition' and not c['ref'].startswith('scenarios:')}
    if report['execution_context_changed']:
        changed_targets.update(r['id'] for g in ('requirements', 'reverse_rules') for r in value[g]
                               if r.get('status') != 'needs_confirmation')
    additional = plan.get('change_review', {}).get('affected_target_ids', [])
    targets = {r['id'] for g in ('requirements', 'reverse_rules') for r in value[g]
               if r.get('status') != 'needs_confirmation'}
    if not isinstance(additional, list) or set(additional) - targets:
        raise ValueError('unknown or pending affected target')
    if additional and not plan.get('change_review', {}).get('basis'):
        raise ValueError('additional target impact needs an Agent basis')
    changed_targets.update(additional)
    affected.update(s['id'] for s in scenes if refs(s) & set(additional))
    required = affected | {s['id'] for s in scenes if refs(s) & changed_targets}
    history = history if history is not None else execution_history(plan)
    executed = set(history['executed_scene_ids'])
    if mode == 'complete_change_acceptance':
        missing = set(report['missing_scenario_target_ids']) & changed_targets
        if missing:
            raise ValueError('complete change acceptance still lacks scenarios for: ' + ', '.join(sorted(missing)))
        selected = plan.get('scene_ids', sorted(required))
        if not isinstance(selected, list) or required - set(selected):
            raise ValueError('complete change acceptance cannot omit affected requirement scenes, including new/unexecuted scenes')
    elif mode == 'follow_history':
        selected = plan.get('scene_ids', sorted(affected & executed))
    elif mode == 'design_only':
        if plan.get('scene_ids'):
            raise ValueError('design_only cannot launch scenes')
        selected = []
    if not isinstance(selected, list) or not all(isinstance(x, str) for x in selected) or \
            len(set(selected)) != len(selected) or set(selected) - known:
        raise ValueError('plan contains duplicate/unknown scene IDs')
    return {'mode': mode, 'basis': basis, 'previous_definitions': base,
            'change': report, 'selected_scene_ids': selected,
            'affected_scene_ids': sorted(affected), 'affected_target_ids': sorted(changed_targets),
            'required_scene_ids': sorted(required) if mode == 'complete_change_acceptance' else [],
            'deferred_scene_ids': sorted(required - set(selected)),
            'historically_executed_scene_ids': sorted(executed), 'history_sources': history['sources']}
