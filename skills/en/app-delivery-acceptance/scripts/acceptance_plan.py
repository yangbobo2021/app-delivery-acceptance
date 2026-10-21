"""Versioned business context, scope admission and recovery checks.

Structure and freshness are deterministic; applicability, completeness and risk
severity still require an independently authored semantic review.
"""
import hashlib
import json
from pathlib import Path

NAME = 'acceptance-plan.json'
REVIEW = 'acceptance-plan-review.json'
DECISIONS = 'scope-decisions.json'
POLICY = 'acceptance-scope-policy.json'
STANDARD = 'acceptance-plan-v2'
RISK_FIELDS = ('failure', 'causal_chain', 'business_impact', 'affected_users',
               'recoverability', 'likelihood_basis', 'grade_basis')
KINDS = ('direct', 'necessary_related', 'affected_regression')


def load(path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, OSError) as error:
        raise ValueError(f'{path.name}: {error}') from error


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def text(value):
    return isinstance(value, str) and bool(value.strip())


def rows(value):
    return value if isinstance(value, list) else []


def ids(value, allowed=None, nonempty=True):
    return (isinstance(value, list) and (bool(value) or not nonempty)
            and all(text(v) for v in value) and len(set(value)) == len(value)
            and (allowed is None or set(value) <= set(allowed)))


def index(values, label, errors):
    result = {}
    for value in rows(values):
        if not isinstance(value, dict) or not text(value.get('id')) or value['id'] in result:
            errors.append(f'{label} needs distinct stable IDs')
        else:
            result[value['id']] = value
    return result


def required(ledger):
    # The marker survives missing/removed plan files. Historical viewing remains read-only.
    return (ledger / POLICY).exists() or (ledger / NAME).exists()


def binding(ledger):
    return {name: file_hash(ledger / name) for name in
            ('requirements.json', NAME, REVIEW, DECISIONS, POLICY, 'source-analysis.json', 'design-progress.json', 'white_box_rules.json', 'design-stage-policy.json')}


def decisions(ledger):
    value = load(ledger / DECISIONS, {'version': 1, 'items': []})
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('items'), list):
        raise ValueError('scope-decisions.json needs version 1 and append-only items')
    history = sorted((ledger / 'decision-history').glob('*.json'))
    if history and digest(load(history[-1])) != digest(value):
        raise ValueError('scope decision history is newer than current file; old decisions cannot be restored')
    return value


def active_decisions(ledger):
    values = decisions(ledger)['items']
    if any(not isinstance(d, dict) or not text(d.get('id')) for d in values):
        raise ValueError('scope decisions need actual objects with stable IDs')
    superseded = {sid for d in values for sid in rows(d.get('supersedes'))}
    return [d for d in values if d.get('id') not in superseded]


def definition_errors(ledger, plan=None):
    published = plan is None
    plan = plan if plan is not None else load(ledger / NAME)
    if not isinstance(plan, dict):
        return ['acceptance-plan.json is missing; organize the complete original requirements first']
    import design_pipeline as pipeline
    errors = pipeline.analysis_errors(ledger)
    analysis = load(ledger / pipeline.ANALYSIS, {})
    project_root = load(ledger / 'project.json', {}).get('project_root')
    if project_root:
        errors.extend(pipeline.current_code_errors(project_root, analysis))
    if plan.get('source_analysis_sha256') != file_hash(ledger / pipeline.ANALYSIS) or plan.get('rules_sha256') != pipeline.rules_digest(ledger):
        errors.append('organization must bind completed analysis and the complete reverse-rule inventory')
    if published:
        if load(ledger / POLICY) != {'standard': STANDARD, 'required': True}:
            errors.append('published acceptance scope policy is missing or changed; cannot downgrade scope')
        if not (ledger / DECISIONS).is_file():
            errors.append('published user scope decisions are missing, even an empty decision ledger must be retained')
        history = [p for p in (ledger / 'plan-history').glob('v*')
                   if p.is_dir() and p.name[1:].isdigit()]
        if history:
            latest = max(history, key=lambda p: int(p.name[1:]))
            if digest(load(latest / NAME, {})) != digest(plan):
                errors.append('formal plan differs from the latest published version; cannot restore old scope')
        else:
            errors.append('formal acceptance plan has no independently published history; use publish-plan')
    req = load(ledger / 'requirements.json', {})
    reqs = index(req.get('items'), 'original requirements', errors)
    selection = plan.get('selection', {'mode': 'full', 'requirement_ids': list(reqs)})
    selected_ids = selection.get('requirement_ids', []) if isinstance(selection, dict) else []
    decision_doc = decisions(ledger)
    active = {d['id']: d for d in active_decisions(ledger)}
    if not isinstance(selection, dict) or selection.get('mode') not in ('full', 'selected') or not ids(selected_ids, reqs):
        errors.append('plan selection must explicitly reference known original requirements')
    elif selection['mode'] == 'full' and set(selected_ids) != set(reqs):
        errors.append('full selection cannot omit original requirements')
    elif selection['mode'] == 'selected':
        decision = active.get(selection.get('decision_id'), {})
        if set(rows(decision.get('selected_requirement_ids'))) != set(selected_ids):
            errors.append('selected requirements need an actual recorded user selection decision')
    if plan.get('standard') != STANDARD or type(plan.get('version')) is not int or plan['version'] < 1:
        errors.append('acceptance plan needs current standard and positive integer version')
    if plan.get('requirements_sha256') != file_hash(ledger / 'requirements.json'):
        errors.append('acceptance plan is stale for the complete original requirements')
    if plan.get('decisions_sha256') != digest(decision_doc):
        errors.append('scope decisions changed; old scope must not resume')
    decision_map = index(active_decisions(ledger), 'scope decisions', errors)
    for value in decision_map.values():
        if not all(text(value.get(k)) for k in ('source_reference', 'source_quote', 'description')):
            errors.append('scope decision requires actual user source, quote and description')
        for key in ('excluded_check_ids', 'excluded_scenario_ids', 'excluded_rule_ids', 'excluded_topics'):
            if not ids(value.get(key), nonempty=False):
                errors.append(f'scope decision needs explicit {key} list')
    goals = plan.get('business_context', {})
    if not isinstance(goals, dict) or not text(goals.get('objective')) or not ids(goals.get('basis')):
        errors.append('business context needs overall objective and original source basis')
        goals = {}
    journeys = index(goals.get('journeys'), 'business journeys', errors)
    if not journeys:
        errors.append('business context needs the actual core/supporting journeys')
    for j in journeys.values():
        if j.get('role') not in ('core', 'supporting', 'experience') or not all(text(j.get(k)) for k in ('title', 'basis')) or not ids(j.get('requirement_ids'), reqs):
            errors.append('journey needs role, title, basis and original requirement links')
    checks = index(plan.get('checks'), 'original requirement checks', errors)
    if not checks:
        errors.append('plan needs original behavior/condition/invariant inventory')
    inventoried = set()
    for cid, c in checks.items():
        rid = c.get('requirement_id')
        source = reqs.get(rid, {}).get('text', '') if c.get('source_field', 'text') == 'text' else req.get('shared_constraints', '')
        if rid not in reqs or not text(source) or not text(c.get('source_quote')) or c['source_quote'] not in source:
            errors.append(f'check {cid} needs an exact original quote and requirement link')
        else:
            inventoried.add(rid)
        if not all(text(c.get(k)) for k in ('behavior', 'reason')) or c.get('disposition') not in ('included', 'excluded', 'context'):
            errors.append(f'check {cid} needs behavior, disposition and reason')
        if c.get('source_field', 'text') not in ('text', 'shared_constraints'):
            errors.append(f'check {cid} has an unknown original source field')
        if c.get('disposition') == 'context' and rid in selected_ids:
            errors.append(f'selected requirement check {cid} cannot silently become background')
        if c.get('disposition') == 'included' and rid not in selected_ids:
            errors.append(f'check {cid} is outside the actual selected requirements')
        if c.get('disposition') == 'excluded' and c.get('decision_id') not in decision_map:
            errors.append(f'excluded check {cid} needs an actual user scope decision')
        elif c.get('disposition') == 'excluded' and cid not in rows(decision_map[c['decision_id']].get('excluded_check_ids')):
            errors.append(f'excluded check {cid} is not covered by its cited user decision')
    if inventoried != set(reqs):
        errors.append('every original requirement needs check inventory, including context/excluded requirements')
    units = index(plan.get('units'), 'acceptance units', errors)
    assigned = set()
    rules = index(load(ledger / 'white_box_rules.json', {}).get('items'), 'reverse rules', errors)
    admitted_rules = {rid for rid,r in rules.items() if r.get('applicability', {}).get('status') == 'in_scope'}
    assigned_rules = set()
    for uid, unit in units.items():
        if not all(text(unit.get(k)) for k in ('title', 'boundary')) or unit.get('role') not in ('core', 'supporting', 'experience'):
            errors.append(f'unit {uid} needs title, business role and concrete boundary')
        if not ids(unit.get('requirement_ids'), reqs, nonempty=False) or not ids(unit.get('check_ids'), checks, nonempty=False) or not ids(unit.get('rule_ids'), rules, nonempty=False) or not (unit.get('check_ids') or unit.get('rule_ids')) or not ids(unit.get('journey_ids'), journeys):
            errors.append(f'unit {uid} needs original requirement, check and journey links')
        if not ids(unit.get('dependencies'), units, nonempty=False) or not ids(unit.get('exclusions'), nonempty=False):
            errors.append(f'unit {uid} needs dependencies and exclusions lists')
        if not set(rows(unit.get('rule_ids'))) <= admitted_rules:
            errors.append(f'unit {uid} includes unconfirmed or out-of-scope reverse rules')
        assigned_rules.update(rows(unit.get('rule_ids')))
        for cid in rows(unit.get('check_ids')):
            check = checks.get(cid, {})
            if check.get('disposition') != 'included' or check.get('requirement_id') not in rows(unit.get('requirement_ids')):
                errors.append(f'unit {uid} links an excluded/context/unrelated check {cid}')
            assigned.add(cid)
    included = {cid for cid, c in checks.items() if c.get('disposition') == 'included'}
    if assigned_rules != admitted_rules:
        errors.append('all and only admitted reverse rules need acceptance-unit ownership before scenarios')
    if (not included and not admitted_rules) or assigned != included:
        errors.append('all and only included checks need acceptance-unit ownership')
    for decision in decision_map.values():
        if set(decision.get('excluded_rule_ids', [])) & assigned_rules:
            errors.append('a user-excluded reverse rule has been reintroduced into organization')
        if set(decision.get('excluded_check_ids', [])) & included:
            errors.append('a user-excluded check has been reintroduced')
    return errors


def selected_requirements(ledger, requirement_map):
    if not required(ledger):
        return requirement_map
    plan = load(ledger / NAME, {})
    selected = {c.get('requirement_id') for c in rows(plan.get('checks'))
                if isinstance(c, dict) and c.get('disposition') == 'included'}
    return {rid: r for rid, r in requirement_map.items() if rid in selected}


def plan_review_errors(ledger, plan=None, review=None):
    published = plan is None
    plan = plan if plan is not None else load(ledger / NAME, {})
    review = review if review is not None else load(ledger / REVIEW, {})
    errors = definition_errors(ledger) if published else definition_errors(ledger, plan)
    if not isinstance(review, dict):
        return errors + ['independent acceptance-plan review is missing']
    if review.get('status') != 'passed' or review.get('reviewer_kind') not in ('playbook', 'independent_ai') or not text(review.get('review_reference')):
        errors.append('acceptance organization requires independent passed review and identity')
    if published and isinstance(plan, dict) and type(plan.get('version')) is int:
        archived = load(ledger / 'plan-history' / f'v{plan["version"]}' / REVIEW)
        if archived is not None and archived != review:
            errors.append('formal plan review differs from its published independent original')
    if review.get('plan_sha256') != digest(plan):
        errors.append('acceptance-plan review is stale')
    for key in ('original_inventory', 'bidirectional_traceability', 'scope_applicability', 'global_business_context', 'rule_provenance'):
        judgment = review.get(key, {})
        if not isinstance(judgment, dict) or judgment.get('status') != 'passed' or not text(judgment.get('reason')):
            errors.append(f'independent plan review needs substantive {key} judgment')
    if set(rows(review.get('requirement_ids'))) != {r['id'] for r in rows(load(ledger / 'requirements.json', {}).get('items'))}:
        errors.append('plan reviewer must inspect the complete original requirement set')
    if set(rows(review.get('rule_ids'))) != {r['id'] for r in rows(load(ledger / 'white_box_rules.json', {}).get('items'))}:
        errors.append('organization reviewer must inspect all reverse rules including out-of-scope candidates')
    return errors


def scenario_errors(ledger, scenarios, review=None, require_review=True, stage='acceptance'):
    plan = load(ledger / NAME, {})
    errors = plan_review_errors(ledger) if require_review else definition_errors(ledger)
    if errors:
        return errors
    units = {u['id']: u for u in rows(plan.get('units')) if isinstance(u, dict) and text(u.get('id'))}
    checks = {c['id']: c for c in rows(plan.get('checks')) if isinstance(c, dict) and text(c.get('id'))}
    journeys = {j['id'] for j in rows(plan.get('business_context', {}).get('journeys')) if isinstance(j, dict) and text(j.get('id'))}
    decisions_doc = decisions(ledger)
    excluded_scenes, excluded_rules, excluded_topics = set(), set(), set()
    for d in active_decisions(ledger):
        excluded_scenes.update(rows(d.get('excluded_scenario_ids')))
        excluded_rules.update(rows(d.get('excluded_rule_ids')))
        excluded_topics.update(rows(d.get('excluded_topics')))
    rule_map = {r['id']: r for r in rows(load(ledger / 'white_box_rules.json', {}).get('items')) if isinstance(r, dict) and text(r.get('id'))}
    covered = set()
    design = load(ledger / 'scenarios.json', {})
    if design.get('design_standard') != 'design-quality-v4':
        errors.append('organized scenario generation requires design-quality-v4')
    if require_review and (review or {}).get('design_standard') != 'design-quality-v4':
        errors.append('organized independent design review requires design-quality-v4')
    scope_review = (review or {}).get('acceptance_scope_review', {})
    judgments_list = [j for j in rows(scope_review.get('items')) if isinstance(j, dict)
                      and (stage != 'black-box' or j.get('scenario_id') in {s.get('id') for s in scenarios})]
    judgments = {j.get('scenario_id'): j for j in judgments_list}
    if require_review:
        if scope_review.get('status') != 'passed' or scope_review.get('plan_sha256') != digest(plan):
            errors.append('independent scenario scope review is missing or stale')
        if not text(scope_review.get('global_priority_calibration')):
            errors.append('independent review needs cross-unit global priority calibration')
        if scope_review.get('reviewer_kind') not in ('independent_ai', 'playbook') or not text(scope_review.get('review_reference')):
            errors.append('scope review needs independent reviewer identity and reference')
        if len(judgments) != len(judgments_list) or set(judgments) != {s.get('id') for s in scenarios}:
            errors.append('scope review must uniquely cover this exact scenario set')
    for scene in scenarios:
        if not isinstance(scene, dict):
            errors.append('scenario scope requires an actual scenario object'); continue
        sid = scene.get('id')
        design_stage = load(ledger/'source-analysis.json',{}).get('stage')
        expected_kind = {'black-box':'black_box','white-box':'white_box'}.get(design_stage)
        if expected_kind and scene.get('kind') != expected_kind:
            errors.append(f'scenario {sid} changes the fixed design stage')
        admission = scene.get('scope', {})
        if not isinstance(admission, dict):
            errors.append(f'scenario {sid} needs scope admission'); continue
        unit_ids = admission.get('unit_ids', [])
        if scene.get('generation_unit_id') not in units or scene.get('generation_unit_id') not in rows(unit_ids):
            errors.append(f'scenario {sid} needs its actual generation unit owner')
        if admission.get('kind') not in KINDS or not ids(unit_ids, units) or not text(admission.get('basis')):
            errors.append(f'scenario {sid} needs admitted kind, units and applicability basis')
        if not ids(admission.get('topics')):
            errors.append(f'scenario {sid} needs explicit business topics for exclusion review')
        if sid in excluded_scenes or excluded_rules & set(rows(scene.get('reverse_rule_ids'))) or excluded_topics & set(rows(admission.get('topics'))):
            errors.append(f'scenario {sid} violates a confirmed user exclusion')
        if admission.get('kind') == 'necessary_related' and not text(admission.get('omission_counterexample')):
            errors.append(f'scenario {sid} must explain how omission could falsely pass the selected requirement')
        if admission.get('kind') == 'affected_regression' and not ids(admission.get('change_refs')):
            errors.append(f'scenario {sid} needs concrete change/call/data impact references')
        acceptance = scene.get('acceptance', {})
        if not isinstance(acceptance, dict):
            errors.append(f'scenario {sid} needs structured acceptance before scope admission'); continue
        criteria = rows(acceptance.get('criteria'))
        mappings = rows(admission.get('criteria'))
        if len(mappings) != len(criteria) or [m.get('criterion') if isinstance(m, dict) else None for m in mappings] != criteria:
            errors.append(f'scenario {sid} must admit each exact acceptance criterion')
        for mapping in mappings:
            if not isinstance(mapping, dict):
                errors.append(f'scenario {sid} has malformed criterion admission'); continue
            cids, rids = mapping.get('check_ids'), mapping.get('rule_ids')
            if not ids(cids, checks, nonempty=False) or not ids(rids, rule_map, nonempty=False) or not (cids or rids) or not text(mapping.get('basis')):
                errors.append(f'scenario {sid} criterion needs source checks/rules and specific basis'); continue
            allowed = {cid for uid in rows(unit_ids) for cid in rows(units.get(uid, {}).get('check_ids'))}
            for cid in cids:
                if checks[cid].get('disposition') != 'included' or cid not in allowed or checks[cid]['requirement_id'] not in rows(scene.get('requirement_ids')):
                    errors.append(f'scenario {sid} criterion links an out-of-scope or unrelated original check {cid}')
                else:
                    covered.add(cid)
            for rid in rids:
                r = rule_map[rid]
                a = r.get('applicability', {})
                if rid not in rows(scene.get('reverse_rule_ids')) or rid in excluded_rules or r.get('status') not in ('supported', 'confirmed') or a.get('status') != 'in_scope' or not text(a.get('basis')) or not any(rid in rows(units.get(uid, {}).get('rule_ids')) for uid in rows(unit_ids)):
                    errors.append(f'supplemental rule {rid} has no independently supported current-scope applicability')
        risk = scene.get('risk', {})
        if not isinstance(risk, dict) or any(not text(risk.get(k)) for k in RISK_FIELDS) or not ids(risk.get('journey_ids'), journeys):
            errors.append(f'scenario {sid} needs global business risk, actual causal chain, exposure and recovery assessment')
        if not isinstance(risk, dict):
            risk = {}
        unit_journeys = {jid for uid in rows(unit_ids) for jid in rows(units.get(uid, {}).get('journey_ids'))}
        if not set(rows(risk.get('journey_ids'))) <= unit_journeys:
            errors.append(f'scenario {sid} risk links an unrelated global business journey')
        if scene.get('priority') == 'P0' and (risk.get('critical_consequence') not in ('core_blocked', 'serious_financial_loss', 'serious_data_damage', 'access_control_failure', 'secret_exposure') or not text(risk.get('materiality_basis'))):
            errors.append(f'P0 scenario {sid} needs concrete critical consequence and materiality basis')
        if require_review:
            judgment = judgments.get(sid, {})
            if judgment.get('scenario_sha256') != digest(scene) or judgment.get('dependencies_sha256') != scoped_hash(ledger, scene) or judgment.get('verdict') != 'in_scope' or not all(text(judgment.get(k)) for k in ('scope_reason', 'priority_reason', 'causal_chain_review')):
                errors.append(f'scenario {sid} lacks fresh independent scope and global-risk review')
            if judgment.get('retained_from'):
                ref = judgment['retained_from']
                path = (ledger / ref.get('path', '')).resolve() if isinstance(ref, dict) else ledger
                old = load(path, {}) if path.is_relative_to(ledger.resolve()) and path.is_file() else {}
                current_item = {k: v for k, v in judgment.items() if k != 'retained_from'}
                if not isinstance(ref, dict) or file_hash(path) != ref.get('sha256') or old.get('item') != current_item or old.get('reviewer_kind') not in ('independent_ai', 'playbook') or not text(old.get('review_reference')):
                    errors.append(f'scenario {sid} retained judgment has no immutable original review provenance')
    included = {cid for cid, c in checks.items() if c.get('disposition') == 'included'}
    if included - covered:
        errors.append('included original checks lack actual scenario criterion mappings: ' + ', '.join(sorted(included - covered)))
    return errors


def archive_reviews(ledger):
    """Archive currently valid independent judgments before a local design change."""
    from scenario_execution import atomic_json
    scenes = rows(load(ledger / 'scenarios.json', {}).get('items'))
    review = load(ledger / 'coverage_review.json', {})
    errors = scenario_errors(ledger, scenes, review)
    if errors:
        raise ValueError('; '.join(errors))
    scope = review['acceptance_scope_review']
    refs = {}
    for item in scope['items']:
        original = {k: v for k, v in item.items() if k != 'retained_from'}
        envelope = {'item': original, 'reviewer_kind': scope['reviewer_kind'], 'review_reference': scope['review_reference']}
        relative = f'review-history/scope/{digest(envelope)}.json'
        path = ledger / relative
        if not path.exists():
            atomic_json(path, envelope)
        refs[item['scenario_id']] = {'path': relative, 'sha256': file_hash(path)}
    return refs


def assert_current(ledger, run=None, expected=None):
    if not required(ledger):
        if run and NAME in run.get('ledger_hashes', {}):
            raise ValueError('acceptance scope files disappeared; cannot downgrade the run')
        return
    errors = definition_errors(ledger)
    if expected is not None and expected != binding(ledger):
        errors.append('confirmed scope/content changed since session binding; use a reviewed new session/run')
    if run:
        for name in (NAME, REVIEW, DECISIONS, POLICY, 'source-analysis.json', 'design-progress.json'):
            if run.get('ledger_hashes', {}).get(name) != file_hash(ledger / name):
                errors.append(f'{name} changed or lost its run binding; cannot resume old scope')
    if errors:
        raise ValueError('; '.join(errors))


def scoped_hash(ledger, scene):
    """Dependencies for honest incremental review, not whole-file re-signing."""
    plan = load(ledger / NAME, {})
    scope = scene.get('scope', {})
    unit_ids = rows(scope.get('unit_ids'))
    checks = {cid for m in rows(scope.get('criteria')) if isinstance(m, dict) for cid in rows(m.get('check_ids'))}
    relevant_decisions = [d for d in active_decisions(ledger)
                          if (set(rows(d.get('excluded_check_ids'))) & checks
                              or scene.get('id') in rows(d.get('excluded_scenario_ids'))
                              or set(rows(scene.get('reverse_rule_ids'))) & set(rows(d.get('excluded_rule_ids'))
                              or set(rows(scope.get('topics'))) & set(rows(d.get('excluded_topics')))))]
    return digest({'scenario': scene, 'requirements': load(ledger / 'requirements.json'),
                   'business_context': plan.get('business_context'), 'decisions': relevant_decisions,
                   'units': [{k: v for k, v in u.items() if k != 'title'} for u in rows(plan.get('units')) if u.get('id') in unit_ids],
                   'checks': [c for c in rows(plan.get('checks')) if c.get('id') in checks],
                   'rules': [r for r in rows(load(ledger / 'white_box_rules.json', {}).get('items')) if r.get('id') in rows(scene.get('reverse_rule_ids'))]})


def publish_plan(ledger, candidate, review, expected_version):
    """Compare-and-swap plan publication; archive original bytes and judgments."""
    from scenario_execution import atomic_json, lock
    with lock(ledger):
        previous = load(ledger / NAME)
        version = previous.get('version', 0) if isinstance(previous, dict) else 0
        history_versions = [int(p.name[1:]) for p in (ledger / 'plan-history').glob('v*')
                            if p.is_dir() and p.name[1:].isdigit()]
        if history_versions and version != max(history_versions):
            raise ValueError('formal plan was replaced by old scope; restore the latest published version')
        if version != expected_version or candidate.get('version') != version + 1:
            raise ValueError('plan version changed; reload before publishing, never restore an old plan')
        errors = plan_review_errors(ledger, candidate, review)
        if errors:
            raise ValueError('; '.join(errors))
        for path in (ledger / 'runs').glob('*/run.json'):
            if load(path, {}).get('lifecycle') == 'running':
                raise ValueError('stop workers and abort the running run before changing acceptance scope')
        history = ledger / 'plan-history' / f'v{candidate["version"]}'
        if history.exists():
            raise ValueError('plan history version already exists')
        history.mkdir(parents=True)
        atomic_json(history / NAME, candidate)
        atomic_json(history / REVIEW, review)
        atomic_json(history / DECISIONS, decisions(ledger))
        import design_pipeline as pipeline
        atomic_json(history / pipeline.ANALYSIS, load(ledger / pipeline.ANALYSIS))
        atomic_json(history / 'white_box_rules.json', load(ledger / 'white_box_rules.json'))
        atomic_json(ledger / DECISIONS, decisions(ledger))
        atomic_json(ledger / POLICY, {'standard': STANDARD, 'required': True})
        atomic_json(ledger / NAME, candidate)
        atomic_json(ledger / REVIEW, review)
        pipeline.initialize(ledger, candidate)


def append_decision(ledger, item):
    from scenario_execution import atomic_json, lock
    with lock(ledger):
        doc = decisions(ledger)
        if not isinstance(item, dict) or not text(item.get('id')) or not all(text(item.get(k)) for k in ('description', 'source_reference', 'source_quote')) or any(not ids(item.get(k), nonempty=False) for k in ('excluded_check_ids', 'excluded_scenario_ids', 'excluded_rule_ids', 'excluded_topics')):
            raise ValueError('scope decision needs stable ID, genuine user source/quote and exclusion lists')
        previous = next((d for d in doc['items'] if d['id'] == item['id']), None)
        if previous:
            if previous != item:
                raise ValueError('scope decisions are append-only; record a new decision instead')
            return
        if not ids(item.get('supersedes', []), {d['id'] for d in doc['items']}, nonempty=False):
            raise ValueError('supersedes must reference actual earlier decisions')
        doc['items'].append(item)
        history = ledger / 'decision-history' / f'{len(doc["items"]):08d}.json'
        if history.exists():
            raise ValueError('decision history already contains a newer decision')
        atomic_json(history, doc)
        atomic_json(ledger / POLICY, {'standard': STANDARD, 'required': True})
        atomic_json(ledger / DECISIONS, doc)


def restore_scope(ledger):
    """Repair lost/old formal files only from latest published history.

    Newer human decisions stay newer; an older plan is consequently stale until
    a reviewed next version is published. This does not approve a new scope.
    """
    from scenario_execution import atomic_json, lock
    with lock(ledger):
        versions = [p for p in (ledger / 'plan-history').glob('v*') if p.is_dir() and p.name[1:].isdigit()]
        if not versions:
            raise ValueError('no independently published scope history to restore')
        latest = max(versions, key=lambda p: int(p.name[1:]))
        plan, review = load(latest / NAME), load(latest / REVIEW)
        decision_history = sorted((ledger / 'decision-history').glob('*.json'))
        doc = load(decision_history[-1]) if decision_history else load(latest / DECISIONS)
        if not isinstance(plan, dict) or not isinstance(review, dict) or review.get('plan_sha256') != digest(plan) or not isinstance(doc, dict):
            raise ValueError('published scope history is incomplete or inconsistent')
        atomic_json(ledger / DECISIONS, doc)
        atomic_json(ledger / POLICY, {'standard': STANDARD, 'required': True})
        atomic_json(ledger / NAME, plan)
        atomic_json(ledger / REVIEW, review)
        # Restore missing analyzed sources only; never overwrite a later analysis.
        for name in ('source-analysis.json','white_box_rules.json'):
            if not (ledger/name).exists() and (latest/name).exists():
                atomic_json(ledger/name,load(latest/name))
        return binding(ledger)


def resource_errors(ledger, resources, review):
    plan = load(ledger / NAME, {})
    units = {u['id'] for u in rows(plan.get('units'))}
    decision_ids = {d['id'] for d in active_decisions(ledger)}
    judgments = review.get('acceptance_scope_review', {}).get('resources', [])
    records = {r.get('dependency_id'): r for r in rows(judgments) if isinstance(r, dict)}
    errors = []
    decisions_list = rows(resources.get('decisions'))
    if len(records) != len(rows(judgments)) or set(records) != {d.get('id') for d in decisions_list}:
        errors.append('resource applicability review must cover exactly the discovered resources')
    for resource in decisions_list:
        scope = resource.get('scope', {})
        rid = resource.get('id')
        if not isinstance(scope, dict) or scope.get('status') not in ('in_scope', 'out_of_scope') or not text(scope.get('basis')):
            errors.append(f'resource {rid} needs explicit current-scope applicability'); continue
        if scope['status'] == 'in_scope' and not ids(scope.get('unit_ids'), units):
            errors.append(f'resource {rid} must support actual selected acceptance units')
        if scope.get('integration_scope') == 'excluded' and scope.get('decision_id') not in decision_ids:
            errors.append(f'resource {rid} needs an actual user decision to exclude real integration proof')
        record = records.get(rid, {})
        if record.get('resource_sha256') != digest(resource) or record.get('verdict') != scope['status'] or not text(record.get('reason')):
            errors.append(f'resource {rid} has no independently verified scope admission')
    return errors


def conclusion(ledger):
    plan = load(ledger / NAME, {})
    checks = rows(plan.get('checks'))
    remaining = [c for c in checks if c.get('disposition') != 'included']
    resources = rows(load(ledger / 'resources.json', {}).get('decisions'))
    unverified = [{'dependency_id': r.get('id'), 'description': r.get('description'),
                   'reason': r.get('scope', {}).get('basis'), 'decision_id': r.get('scope', {}).get('decision_id')}
                  for r in resources if r.get('scope', {}).get('status') == 'in_scope'
                  and r.get('scope', {}).get('integration_scope') == 'excluded']
    return {'plan_version': plan.get('version'), 'objective': plan.get('business_context', {}).get('objective'),
            'original_requirements_complete': not remaining and not unverified,
            'unverified_integrations': unverified,
            'selected_requirement_ids': sorted({c['requirement_id'] for c in checks if c.get('disposition') == 'included'}),
            'outside_selected_scope': [{'check_id': c.get('id'), 'requirement_id': c.get('requirement_id'),
                                        'disposition': c.get('disposition'), 'reason': c.get('reason')} for c in remaining]}
