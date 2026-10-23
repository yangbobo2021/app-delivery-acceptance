"""Read-only project statistics: execution facts and confirmed results are separate."""
from copy import deepcopy
import json
from datetime import datetime, timezone

CONFIRMED = {'passed', 'product_bug', 'accepted_risk', 'repair_required', 'blocked', 'inconclusive'}
CATEGORIES = ('passed', 'product_bug', 'accepted_risk', 'needs_attention', 'pending_review')


def timestamp(value):
    try:
        instant = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return (instant if instant.tzinfo else instant.replace(tzinfo=timezone.utc)).timestamp()
    except (ValueError, TypeError):
        return 0


def execution_happened(trace, scene_id):
    if trace.get('execution_records_by_scene', {}).get(scene_id):
        return True
    if scene_id in trace.get('executed_scene_ids', []):
        return True
    bindings = {b['id'] for b in trace.get('bindings', []) if b.get('scenario_id') == scene_id}
    return any(r.get('binding_id') in bindings and r.get('status') in
               {'passed', 'failed', 'executed', 'error', 'aborted'}
               for r in trace.get('case_results', []))


def confirmed_result(trace):
    judgment = trace.get('judgment') or {}
    if judgment.get('status') not in CONFIRMED:
        return False
    # A draft/provisional Reviewer answer is not a confirmed result.
    return not trace.get('provisional') or trace.get('judgment_confirmed') is True


def viewer_record(trace, scene_id):
    """Copy actual record fields for reading; never infer per-test execution."""
    bindings = [b for b in trace.get('bindings', []) if b.get('scenario_id') == scene_id]
    ids = {b['id'] for b in bindings}
    fields = ('project', 'attempt_id', 'generated_at', 'stage', 'judgment', 'current_links',
              'definition_binding_sha256', 'judgment_confirmed_at', 'progress_folder')
    record = {key: deepcopy(trace[key]) for key in fields if key in trace}
    record['bindings'] = deepcopy(bindings)
    record['case_results'] = deepcopy([r for r in trace.get('case_results', []) if r.get('binding_id') in ids])
    record['execution_records'] = deepcopy(trace.get('execution_records_by_scene', {}).get(scene_id, []))
    return record


def project_state(traces, progress):
    """Return one scene row per stable ID, plus a disjoint result partition.

    Progress collectors retain case_history before filtering active stages.
    Callers must supply the project's complete scenario catalog and history.
    """
    items = [*progress.get('case_history', []), *progress.get('previews', []), *traces]
    catalogs = {t['project']['id']: t for t in sorted(items, key=lambda t: timestamp(t.get('generated_at')))
                if t.get('definition_catalog')}
    groups, requirements, rules, bases = {}, {}, {}, {}
    for order, trace in enumerate(items):
        project_id = trace['project']['id']
        bases[project_id] = trace
        requirements.setdefault(project_id, {}).update({r['id']: r for r in trace.get('requirements', [])})
        rules.setdefault(project_id, {}).update({r['id']: r for r in trace.get('reverse_rules', [])})
        for scene in trace.get('scenarios', []):
            if project_id in catalogs and scene['id'] not in catalogs[project_id]['definition_bindings']:
                continue  # Retired scenes remain in raw history, outside this baseline's denominator.
            groups.setdefault((project_id, scene['id']), []).append((trace, scene, order))
    for pid, catalog in catalogs.items():
        requirements[pid] = {r['id']: r for r in catalog.get('requirements', [])}
        rules[pid] = {r['id']: r for r in catalog.get('reverse_rules', [])}
    projected, totals = [], {}
    for (project_id, scene_id), candidates in groups.items():
        by_execution = [c for c in candidates if execution_happened(c[0], scene_id)]
        confirmed = [c for c in candidates if confirmed_result(c[0])]
        key = lambda c: (timestamp(c[0].get('generated_at')), c[2])
        displayed = max(by_execution or candidates, key=key)
        chosen = max(confirmed, key=lambda c: (timestamp(c[0].get('judgment_confirmed_at') or
                                                         c[0]['judgment'].get('confirmed_at') or
                                                         c[0].get('generated_at')), c[2])) if confirmed else None
        if chosen and not by_execution and chosen[0]['judgment']['status'] in {'passed', 'product_bug', 'accepted_risk'}:
            chosen = None
        trace, scene, _ = displayed
        row = deepcopy(trace)
        row['scenarios'] = [deepcopy(max(candidates, key=key)[1])]
        if project_id in catalogs:
            current = catalogs[project_id]
            row['scenarios'] = [deepcopy(next(s for s in current['scenarios'] if s['id'] == scene_id))]
            row['requirements'] = deepcopy(current['requirements'])
            row['reverse_rules'] = deepcopy(current['reverse_rules'])
        row['execution_known'] = bool(by_execution)
        # Preserve the exact attempts behind the aggregate row. Catalog entries
        # and a new preparation are not additional executions.
        history, seen = [], set()
        for candidate, _, _ in sorted(by_execution, key=key, reverse=True):
            record = viewer_record(candidate, scene_id)
            identity = json.dumps(record, sort_keys=True, ensure_ascii=False)
            if identity not in seen:
                seen.add(identity)
                history.append(record)
        row['execution_history'] = history
        row['judgment_record'] = viewer_record(chosen[0], scene_id) if chosen else None
        row['provisional'] = False
        row['judgment'] = deepcopy(chosen[0]['judgment']) if chosen else {
            'status': 'pending_review' if by_execution else 'not_run',
            'reason': '已有用例执行，尚无已确认结论。' if by_execution else '尚无用例执行记录。'}
        if chosen:
            source = chosen[0]
            row['judgment_source'] = {'attempt_id': source.get('attempt_id'),
                                      'revision': source['project'].get('revision'),
                                      'confirmed_at': source.get('judgment_confirmed_at') or
                                      source['judgment'].get('confirmed_at') or source.get('generated_at')}
            if source.get('judgment_source'):
                row['judgment_source'] = deepcopy(source['judgment_source'])
            row['current_links'] = deepcopy(source.get('current_links', {}))
        if project_id in catalogs:
            actual = chosen[0].get('definition_binding_sha256') if chosen else None
            expected = catalogs[project_id]['definition_bindings'][scene_id]
            row['definition_applicability'] = ('matches_current' if actual == expected or
                                               actual in catalogs[project_id].get('definition_legacy_bindings', {}).get(scene_id, []) else
                                               'equivalent_by_assessment' if actual in catalogs[project_id].get('definition_equivalences', {}).get(scene_id, []) else
                                               'needs_revalidation' if actual else 'unknown')
            row['current_definition_sha256'] = expected
        state = row['judgment']['status']
        category = (state if state in {'passed', 'product_bug', 'accepted_risk'} else
                    'needs_attention' if state in {'repair_required', 'blocked', 'inconclusive'} else
                    'pending_review') if by_execution else 'not_run'
        row['result_category'] = category
        projected.append(row)
        counts = totals.setdefault(project_id, {'project_id': project_id, 'scenario_count': 0,
                                  'executed_count': 0, 'not_executed_count': 0,
                                  **{name: 0 for name in CATEGORIES}})
        counts['scenario_count'] += 1
        counts['executed_count' if by_execution else 'not_executed_count'] += 1
        if by_execution:
            counts[category] += 1
    # Keep requirements and unconfirmed rules that do not yet have scenes.
    for project_id, base in bases.items():
        shell = deepcopy(base)
        shell.update(scenarios=[], bindings=[], case_results=[],
                     requirements=list(requirements.get(project_id, {}).values()),
                     reverse_rules=list(rules.get(project_id, {}).values()))
        projected.append(shell)
        counts = totals.setdefault(project_id, {'project_id': project_id, 'scenario_count': 0,
                                  'executed_count': 0, 'not_executed_count': 0,
                                  **{name: 0 for name in CATEGORIES}})
        counts['requirement_count'] = len(requirements.get(project_id, {}))
        counts['admitted_rule_count'] = sum(r.get('status') != 'needs_confirmation'
                                            for r in rules.get(project_id, {}).values())
        counts['pending_rule_count'] = sum(r.get('status') == 'needs_confirmation'
                                           for r in rules.get(project_id, {}).values())
        counts['result_count'] = sum(counts[name] for name in CATEGORIES)
        counts['reconciled'] = (counts['result_count'] == counts['executed_count'] and
                                 counts['scenario_count'] == counts['executed_count'] + counts['not_executed_count'])
        if not counts['reconciled']:
            raise ValueError('Project result counts do not reconcile: ' + project_id)
    return {'schema': 'project-scene-state-v1', 'traces': projected, 'projects': list(totals.values())}
