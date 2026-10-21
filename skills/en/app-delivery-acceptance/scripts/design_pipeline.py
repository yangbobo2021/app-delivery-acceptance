"""Ordered source analysis, complete organization and per-unit scenario generation.

Progress is written only by these commands. Gates recompute hashes and coverage;
an agent's claimed completion is never sufficient to advance or execute.
"""
from pathlib import Path
import acceptance_plan as scope

ANALYSIS = 'source-analysis.json'
PROGRESS = 'design-progress.json'
STANDARD = 'design-pipeline-v1'
STAGES = ('black-box', 'white-box', 'acceptance')


def rules_digest(ledger):
    value = scope.load(ledger / 'white_box_rules.json', {'version': 1, 'items': []})
    return scope.digest({'version': value.get('version'), 'items': value.get('items')})


def sources(ledger):
    return {'requirements.json': scope.file_hash(ledger / 'requirements.json'),
            'white_box_rules.json': rules_digest(ledger),
            scope.DECISIONS: scope.digest(scope.decisions(ledger)),
            'design-stage-policy.json':scope.file_hash(ledger/'design-stage-policy.json')}


def analysis_errors(ledger, value=None):
    value = value if value is not None else scope.load(ledger / ANALYSIS, {})
    if not isinstance(value, dict):
        return ['source analysis must be an object']
    errors = []
    if value.get('standard') != STANDARD or value.get('status') != 'complete' or value.get('stage') not in STAGES:
        errors.append('complete current source analysis is required before organization')
    if value.get('source_hashes') != sources(ledger):
        errors.append('source analysis is stale for requirements, reverse rules or user decisions')
    reqs = scope.rows(scope.load(ledger / 'requirements.json', {}).get('items'))
    rules = scope.rows(scope.load(ledger / 'white_box_rules.json', {}).get('items'))
    if not scope.ids(value.get('requirement_ids'), {r['id'] for r in reqs}) or set(value.get('requirement_ids', [])) != {r['id'] for r in reqs}:
        errors.append('source analysis must inspect every original requirement')
    if not scope.ids(value.get('rule_ids'), {r['id'] for r in rules}, nonempty=False) or set(value.get('rule_ids', [])) != {r['id'] for r in rules}:
        errors.append('source analysis must inventory every discovered reverse rule')
    if not scope.text(value.get('original_analysis_basis')) or not scope.text(value.get('white_box_analysis_basis')):
        errors.append('source analysis needs substantive original and white-box analysis bases')
    fixed_stage = scope.load(ledger/'design-stage-policy.json', {}).get('stage')
    if fixed_stage is not None and fixed_stage != value.get('stage'):
        errors.append('source analysis cannot change the fixed workflow stage')
    if value.get('stage') == 'black-box' and rules:
        errors.append('black-box-only analysis cannot silently include reverse rules')
    inventory = value.get('code_inventory', [])
    if not isinstance(inventory, list):
        errors.append('source analysis needs explicit inspected code inventory')
    elif value.get('stage') != 'black-box' and not inventory:
        errors.append('white-box analysis needs actual inspected code inventory, even when no new rules are found')
    for source in scope.rows(inventory):
        if not isinstance(source, dict) or not all(scope.text(source.get(k)) for k in ('path', 'sha256', 'basis')):
            errors.append('inspected code inventory needs actual path/hash/analysis basis')
    for rule in rules:
        applicability = rule.get('applicability', {})
        if not isinstance(applicability, dict) or applicability.get('status') not in ('in_scope', 'out_of_scope', 'pending') or not scope.text(applicability.get('basis')):
            errors.append(f'rule {rule.get("id")} needs applicability before organization')
        elif applicability['status'] == 'in_scope':
            if rule.get('status') not in ('confirmed', 'supported'):
                errors.append(f'unresolved rule {rule.get("id")} cannot enter active organization')
            if applicability.get('kind') not in scope.KINDS or not scope.ids(applicability.get('topics')):
                errors.append(f'admitted rule {rule.get("id")} needs scope kind and explicit business topics')
            if applicability.get('kind') == 'necessary_related' and not scope.text(applicability.get('omission_counterexample')):
                errors.append('necessary related rule needs an omission counterexample')
            if applicability.get('kind') == 'affected_regression' and not scope.ids(applicability.get('change_refs')):
                errors.append('regression rule needs actual change-impact references')
            for d in scope.active_decisions(ledger):
                if rule.get('id') in scope.rows(d.get('excluded_rule_ids')) or set(scope.rows(applicability.get('topics'))) & set(scope.rows(d.get('excluded_topics'))):
                    errors.append(f'admitted rule {rule.get("id")} violates a confirmed exclusion')
    return errors


def current_code_errors(project, value):
    errors = []
    for source in scope.rows(value.get('code_inventory')):
        if not isinstance(source, dict):
            continue
        path = Path(project).resolve() / str(source.get('path', ''))
        if not path.resolve().is_relative_to(Path(project).resolve()) or scope.file_hash(path) != source.get('sha256'):
            errors.append(f'inspected code changed or disappeared: {source.get("path")}')
    return errors


def complete_analysis(project, ledger, value):
    from scenario_execution import atomic_json, lock
    import white_box_rules
    with lock(ledger):
        errors = analysis_errors(ledger, value) + current_code_errors(project, value)
        if value.get('stage') != 'black-box':
            errors += white_box_rules.definitions_errors(Path(project).resolve(), ledger, [], set(value.get('requirement_ids', [])), check_design=False)
        if errors:
            raise ValueError('; '.join(errors))
        for path in (ledger / 'runs').glob('*/run.json'):
            if scope.load(path, {}).get('lifecycle') == 'running':
                raise ValueError('abort active execution before changing analyzed sources')
        atomic_json(ledger / ANALYSIS, value)


def save_progress(ledger, value, event, unit_id=None):
    from scenario_execution import atomic_json
    folder = ledger / 'design-history' / 'events' / f'v{value["plan_version"]}'
    history = sorted(folder.glob('*.json'))
    record = {'sequence': len(history) + 1, 'event': event, 'unit_id': unit_id,
              'previous_sha256': scope.file_hash(history[-1]) if history else None,
              'progress': value}
    destination = folder / f'{record["sequence"]:08d}.json'
    if destination.exists():
        raise ValueError('design progress event already exists; never overwrite history')
    atomic_json(destination, record)
    atomic_json(ledger / PROGRESS, value)


def initialize(ledger, plan):
    """Called inside publish-plan's lock after the entire plan is published."""
    from scenario_execution import atomic_json
    previous = scope.load(ledger / PROGRESS, {})
    if previous:
        atomic_json(ledger / 'design-history' / f'v{previous.get("plan_version", 0)}.json', previous)
    save_progress(ledger, {
        'standard': STANDARD, 'plan_version': plan['version'], 'plan_sha256': scope.digest(plan),
        'source_hashes': sources(ledger), 'analysis_sha256': scope.file_hash(ledger / ANALYSIS),
        'current_unit': None, 'units': [{'unit_id': u['id'], 'status': 'pending', 'scenario_ids': []}
                                    for u in plan['units']]}, 'organization_published')


def progress_errors(ledger, value=None):
    value = value if value is not None else scope.load(ledger / PROGRESS, {})
    plan = scope.load(ledger / scope.NAME, {})
    errors = analysis_errors(ledger)
    if not isinstance(value, dict) or value.get('standard') != STANDARD:
        return errors + ['per-unit design progress is missing']
    history = sorted((ledger / 'design-history' / 'events' / f'v{value.get("plan_version")}').glob('*.json'))
    if not history or scope.load(history[-1], {}).get('progress') != value:
        errors.append('generation progress differs from its latest command receipt; cannot invent completion or restore old progress')
    if value.get('plan_sha256') != scope.digest(plan) or value.get('source_hashes') != sources(ledger) or value.get('analysis_sha256') != scope.file_hash(ledger / ANALYSIS):
        errors.append('design progress is stale; publish reviewed organization before regenerating units')
    items = scope.rows(value.get('units'))
    if [u.get('unit_id') for u in items] != [u.get('id') for u in scope.rows(plan.get('units'))]:
        errors.append('generation queue must contain all published units in order')
    active = [u.get('unit_id') for u in items if u.get('status') == 'in_progress']
    if active != ([value['current_unit']] if value.get('current_unit') else []):
        errors.append('exactly one generation unit may be active')
    for item in items:
        if item.get('status') not in ('pending', 'in_progress', 'generated') or not scope.ids(item.get('scenario_ids'), nonempty=False):
            errors.append('unit generation status or scenario roster is invalid')
    return errors


def next_unit(ledger):
    errors = scope.plan_review_errors(ledger) + progress_errors(ledger)
    if errors:
        raise ValueError('; '.join(errors))
    value = scope.load(ledger / PROGRESS)
    return next((u for u in value['units'] if u['status'] != 'generated'), None)


def advance_unit(ledger):
    from scenario_execution import lock
    with lock(ledger):
        item = next_unit(ledger)
        value = scope.load(ledger / PROGRESS)
        history = sorted((ledger / 'design-history' / 'events' / f'v{value["plan_version"]}').glob('*.json'))
        if item is None or value.get('current_unit') or scope.load(history[-1]).get('event') != 'unit_generated':
            raise ValueError('advance requires a newly completed unit and a next pending unit')
        save_progress(ledger, value, 'unit_advance', item['unit_id'])
        return item


def start_unit(ledger, unit_id):
    from scenario_execution import atomic_json, lock
    with lock(ledger):
        next_item = next_unit(ledger)
        if next_item is None or next_item['unit_id'] != unit_id:
            raise ValueError('generate only the next published acceptance unit')
        value = scope.load(ledger / PROGRESS)
        if value.get('current_unit') == unit_id:
            return value  # Resume retains the original protected baseline.
        scenes = scope.rows(scope.load(ledger / 'scenarios.json', {}).get('items'))
        value['protected_scenarios'] = {s['id']: scope.digest(s) for s in scenes
                                       if s.get('generation_unit_id') != unit_id}
        value['current_unit'] = unit_id
        next(u for u in value['units'] if u['unit_id'] == unit_id)['status'] = 'in_progress'
        save_progress(ledger, value, 'unit_started', unit_id)
        return value


def unit_errors(ledger, unit_id, scenes):
    plan = scope.load(ledger / scope.NAME, {})
    unit = next((u for u in scope.rows(plan.get('units')) if u.get('id') == unit_id), {})
    owned = [s for s in scenes if s.get('generation_unit_id') == unit_id]
    errors = []
    if not any(unit_id in scope.rows(s.get('scope', {}).get('unit_ids')) for s in scenes):
        errors.append(f'unit {unit_id} has no generated or explicitly shared scenarios')
    covered_checks, covered_rules = set(), set()
    for s in scenes:
        if unit_id not in scope.rows(s.get('scope', {}).get('unit_ids')):
            continue
        for c in scope.rows(s.get('scope', {}).get('criteria')):
            covered_checks.update(scope.rows(c.get('check_ids')))
            covered_rules.update(scope.rows(c.get('rule_ids')))
    if not set(unit.get('check_ids', [])) <= covered_checks:
        errors.append(f'unit {unit_id} lacks exact original check coverage')
    if not set(unit.get('rule_ids', [])) <= covered_rules:
        errors.append(f'unit {unit_id} lacks admitted reverse-rule coverage')
    for s in owned:
        if unit_id not in scope.rows(s.get('scope', {}).get('unit_ids')) or not scope.rows(s.get('acceptance', {}).get('criteria')):
            errors.append(f'scenario {s.get("id")} needs owner admission and complete acceptance')
    return errors


def complete_unit(ledger, unit_id):
    from scenario_execution import atomic_json, lock
    with lock(ledger):
        errors = scope.plan_review_errors(ledger) + progress_errors(ledger)
        value = scope.load(ledger / PROGRESS, {})
        if value.get('current_unit') != unit_id:
            errors.append('unit was not started or another unit is active')
        scenes = scope.rows(scope.load(ledger / 'scenarios.json', {}).get('items'))
        present = {s['id']: scope.digest(s) for s in scenes if s.get('generation_unit_id') != unit_id}
        if present != value.get('protected_scenarios'):
            errors.append('unit generation changed another unit or introduced unowned scenarios')
        errors += unit_errors(ledger, unit_id, scenes)
        if errors:
            raise ValueError('; '.join(errors))
        owned = [s for s in scenes if unit_id in scope.rows(s.get('scope', {}).get('unit_ids'))]
        item = next(u for u in value['units'] if u['unit_id'] == unit_id)
        item.update(status='generated', scenario_ids=[s['id'] for s in owned],
                    scenarios_sha256=scope.digest(owned))
        value['current_unit'] = None
        value.pop('protected_scenarios', None)
        save_progress(ledger, value, 'unit_generated', unit_id)
        return value


def generation_errors(ledger):
    errors = scope.plan_review_errors(ledger) + progress_errors(ledger)
    value = scope.load(ledger / PROGRESS, {})
    scenes = scope.rows(scope.load(ledger / 'scenarios.json', {}).get('items'))
    unit_ids = {u.get('unit_id') for u in scope.rows(value.get('units'))}
    for s in scenes:
        if s.get('generation_unit_id') not in unit_ids:
            errors.append(f'scenario {s.get("id")} was not generated through a published unit')
    for item in scope.rows(value.get('units')):
        owned = [s for s in scenes if item.get('unit_id') in scope.rows(s.get('scope', {}).get('unit_ids'))]
        if item.get('status') != 'generated' or item.get('scenario_ids') != [s['id'] for s in owned] or item.get('scenarios_sha256') != scope.digest(owned):
            errors.append(f'unit {item.get("unit_id")} generation is incomplete or changed; regenerate affected unit')
        errors += unit_errors(ledger, item.get('unit_id'), scenes)
    return list(dict.fromkeys(errors))


def reopen_units(ledger, unit_ids):
    """Explicit design repair, preserving unaffected units and original reviews."""
    from scenario_execution import atomic_json, lock
    with lock(ledger):
        errors = scope.plan_review_errors(ledger) + progress_errors(ledger)
        value = scope.load(ledger / PROGRESS, {})
        known = {u['unit_id'] for u in value.get('units', [])}
        if not scope.ids(unit_ids, known) or errors or value.get('current_unit'):
            raise ValueError('; '.join(errors) or 'reopen named known units only with no active generation')
        if any(scope.load(p, {}).get('lifecycle') == 'running' for p in (ledger / 'runs').glob('*/run.json')):
            raise ValueError('abort execution before reopening scenario design')
        for u in value['units']:
            if u['unit_id'] in unit_ids:
                u.update(status='pending', scenario_ids=[])
                u.pop('scenarios_sha256', None)
        save_progress(ledger, value, 'units_reopened', unit_ids)
        return value


def restore_progress(ledger):
    from scenario_execution import lock
    with lock(ledger):
        errors = scope.plan_review_errors(ledger)
        plan = scope.load(ledger / scope.NAME, {})
        history = sorted((ledger / 'design-history' / 'events' / f'v{plan.get("version")}').glob('*.json'))
        if errors or not history:
            raise ValueError('; '.join(errors) or 'no current design progress receipt')
        value = scope.load(history[-1]).get('progress')
        if progress_errors(ledger, value):
            raise ValueError('latest generation receipt no longer matches current sources and organization')
        from scenario_execution import atomic_json
        atomic_json(ledger / PROGRESS, value)
        return value


def view(ledger, runs=None):
    """Read-only progress; stale claims never display as completed."""
    plan = scope.load(ledger / scope.NAME, {})
    progress = scope.load(ledger / PROGRESS, {})
    analysis_ok = not analysis_errors(ledger)
    project = scope.load(ledger / 'project.json', {}).get('project_root')
    if project and analysis_ok:
        analysis_ok = not current_code_errors(project, scope.load(ledger / ANALYSIS, {}))
    organization_ok = analysis_ok and not scope.plan_review_errors(ledger)
    progress_ok = organization_ok and not progress_errors(ledger)
    generation_ok = progress_ok and not generation_errors(ledger)
    stages = [{'id': 'analysis', 'title': '需求与白盒规则分析', 'status': 'completed' if analysis_ok else 'in_progress'},
              {'id': 'organization', 'title': '全部验收组织生成与审查', 'status': 'completed' if organization_ok else 'in_progress' if analysis_ok else 'pending'},
              {'id': 'generation', 'title': '逐个验收组织生成场景', 'status': 'completed' if generation_ok else 'in_progress' if organization_ok else 'pending'},
              {'id': 'execution', 'title': '场景执行与独立判定', 'status': 'pending'}]
    if scope.load(ledger / ANALYSIS, {}).get('stage') in ('black-box', 'white-box'):
        stages[-1]['status'] = 'not_requested'
    run_records = [r.get('documents', {}).get('run.json', {}) for r in (runs or []) if r.get('ledger_match') == 'current']
    if generation_ok and run_records:
        latest = max(run_records, key=lambda r: str(r.get('created_at', '')))
        stages[-1]['status'] = 'completed' if latest.get('lifecycle') == 'completed' else 'in_progress' if latest.get('lifecycle') == 'running' else 'incomplete'
    items = {u.get('unit_id'): u for u in scope.rows(progress.get('units'))} if progress_ok else {}
    units = []
    for u in scope.rows(plan.get('units')) if organization_ok else []:
        item = items.get(u['id'], {})
        owned = [s for s in scope.rows(scope.load(ledger / 'scenarios.json', {}).get('items')) if u['id'] in scope.rows(s.get('scope', {}).get('unit_ids'))]
        status = item.get('status', 'pending')
        if status == 'generated' and item.get('scenarios_sha256') != scope.digest(owned):
            status = 'stale'
        units.append({'unit_id': u['id'], 'title': u['title'], 'status': status,
                      'scenario_count': len(owned), 'scenario_ids': [s['id'] for s in owned]})
    return {'stages': stages, 'units': units, 'active_unit': progress.get('current_unit') if progress_ok else None,
            'generated_units': sum(u['status'] == 'generated' for u in units), 'total_units': len(units),
            'issues': ([] if organization_ok else scope.plan_review_errors(ledger))}
