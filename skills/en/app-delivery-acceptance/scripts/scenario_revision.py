"""Deterministic handoffs for the existing scenario workflow's create/edit modes."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

DESIGN_FIELDS = {'id', 'title', 'description', 'priority', 'priority_reason'}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def sha_text(text):
    return hashlib.sha256(text.encode()).hexdigest()


def materialize(request):
    from acceptance_definitions import load_binding
    request = deepcopy(request)
    value = load_binding(request)
    mode = request.setdefault('mode', 'create')
    if mode not in {'create', 'edit'}:
        raise ValueError('scenario mode must be create or edit')
    if not value:
        if mode == 'edit':
            raise ValueError('scenario edit requires current and previous frozen definitions')
        return request
    request.update(requirements={'items': value['requirements'],
        'shared_constraints': value['context'].get('shared_constraints', '')},
        reverse_rules=value['reverse_rules'],
        analysis={**request.get('analysis', {}), **value['context']},
        user_constraints=value['context'].get('user_constraints', []))
    target = request['target_requirement_id']
    scenes = [deepcopy(s) for s in value['scenarios'] if s.get('requirement_id') == target]
    request['all_existing_scenarios'] = deepcopy(value['scenarios'])
    admitted = next((r for group in ('requirements', 'reverse_rules') for r in value[group]
                     if r['id'] == target), None)
    if not admitted or admitted.get('status') == 'needs_confirmation':
        raise ValueError('scenario target is absent or still needs confirmation')
    if request.get('scenario_kind') not in {'BLACK_BOX', 'WHITE_BOX'}:
        raise ValueError('invalid scenario kind')
    if mode == 'create':
        if scenes:
            raise ValueError('target already has scenes; use edit mode to preserve their identities and edits')
        return request
    if not request.get('previous_definitions'):
        raise ValueError('scenario edit needs previous_definitions from before the requirement change')
    previous = load_binding({**request, 'definitions': request['previous_definitions']},
                            current=False, required=True)
    request['previous_target'] = next((deepcopy(r) for group in ('requirements', 'reverse_rules')
        for r in previous[group] if r['id'] == target), None)
    request['previous_context'] = deepcopy(previous['context'])
    request['previous_scenarios'] = [deepcopy(s) for s in previous['scenarios']
                                     if s.get('requirement_id') == target]
    request['existing_scenarios'] = scenes
    # The baseline is the CURRENT adopted set, including any later human edits.
    # The older snapshot explains the requirement change, not a replacement set.
    request['scenario_base_text'] = encoded({'requirement_id': target,
        'kind': request['scenario_kind'], 'scenarios': scenes})
    request['scenario_base_sha256'] = sha_text(request['scenario_base_text'])
    request['reserved_definition_ids'] = [r['id'] for group in
        ('requirements', 'reverse_rules', 'scenarios') for r in value[group]]
    return request


def apply_patch(request, patch):
    """Apply only declared design changes; keep untouched objects byte-for-byte in JSON value."""
    if request.get('mode') != 'edit':
        raise ValueError('scenario patch requires edit mode')
    base_text = request['scenario_base_text']
    if sha_text(base_text) != request['scenario_base_sha256'] or \
            patch.get('base_sha256') != request['scenario_base_sha256']:
        raise ValueError('scenario patch base changed')
    base = json.loads(base_text)
    if base['scenarios'] != request['existing_scenarios']:
        raise ValueError('scenario base differs from current adopted scenes')
    if not isinstance(patch.get('upsert'), list) or not isinstance(patch.get('remove_ids'), list):
        raise ValueError('edit must return upsert and remove_ids, not a replacement list')
    if not isinstance(patch.get('change_summary'), list) or not patch['change_summary'] or \
            not all(isinstance(x, str) and x.strip() for x in patch['change_summary']):
        raise ValueError('scenario change_summary required')
    old = {s['id']: s for s in base['scenarios']}
    removed = patch['remove_ids']
    if not all(isinstance(x, str) for x in removed) or len(set(removed)) != len(removed) or set(removed) - old.keys():
        raise ValueError('invalid retired scene IDs')
    reasons = patch.get('change_reasons', {})
    updates = {}
    for scene in patch['upsert']:
        if not isinstance(scene, dict) or set(scene) - DESIGN_FIELDS:
            raise ValueError('scene patch may change only complete design fields, not origins or references')
        if not all(isinstance(scene.get(k), str) and scene[k].strip() for k in DESIGN_FIELDS):
            raise ValueError('scene patch needs all five complete design fields')
        sid = scene['id']
        if sid in updates or sid in removed:
            raise ValueError('duplicate or contradictory scene patch ID')
        if scene['priority'] not in {'P0', 'P1', 'P2', 'P3'}:
            raise ValueError('invalid scene priority')
        if sid not in old and sid in request['reserved_definition_ids']:
            raise ValueError('new scene ID collides with another frozen definition')
        if sid in old and all(scene[k] == old[sid].get(k) for k in DESIGN_FIELDS):
            raise ValueError('unchanged scenes must be retained, not rewritten in upsert')
        updates[sid] = scene
    changed = set(updates) | set(removed)
    if not isinstance(reasons, dict) or set(reasons) != changed or \
            not all(isinstance(x, str) and x.strip() for x in reasons.values()):
        raise ValueError('every updated/new/retired scene needs its change reason')
    merged = []
    for scene in base['scenarios']:
        sid = scene['id']
        if sid in removed:
            continue
        item = deepcopy(scene)
        if sid in updates:
            item.update(updates[sid])
            item.pop('version', None)
            item.pop('content_sha256', None)
        merged.append(item)
    for sid, scene in updates.items():
        if sid not in old:
            merged.append({**deepcopy(scene), 'requirement_id': request['target_requirement_id'],
                           'kind': request['scenario_kind']})
    return {'requirement_id': request['target_requirement_id'], 'kind': request['scenario_kind'],
            'scenarios': merged, 'change_summary': patch['change_summary'],
            'change_reasons': reasons, 'retired_scene_ids': removed,
            'base_sha256': patch['base_sha256']}


def gate(request, folder):
    from acceptance_store import read, save
    folder = Path(folder)
    base = folder / 'scenarios.base.json'
    if base.read_text() != request['scenario_base_text']:
        raise ValueError('frozen scenario baseline changed')
    result = apply_patch(request, read(folder / 'draft.candidate.json'))
    save(folder / 'scenarios.current.json', result)
    save(folder / 'scenarios.round-1.json', result)
    save(folder / 'draft-gate.json', {'stage': 'draft', 'status': 'ready', 'errors': [],
        'semantic_review': 'not_performed', 'mode': 'edit'})
    return result


def candidate(request_path, folder):
    """Return a complete candidate for Agent adoption; never freeze or backfill implicitly."""
    from acceptance_store import read, digest
    from acceptance_definitions import load_binding, validate_definitions
    raw = read(request_path)
    request = materialize(raw)
    current = load_binding(request, required=True)
    folder = Path(folder)
    frozen = read(folder / 'request.frozen.json')
    terminal = read(folder / 'terminal.json')
    if any(frozen.get(k) != request.get(k) for k in ('acceptance', 'definitions', 'mode',
            'target_requirement_id', 'scenario_kind', 'previous_definitions', 'scenario_base_sha256')):
        raise ValueError('scenario result belongs to another current request/baseline')
    if terminal.get('final_state') != 'done' or \
            terminal.get('request_sha256') != digest(folder / 'request.frozen.json') or \
            terminal.get('scenarios_sha256') != digest(folder / 'scenarios.current.json') or \
            read(folder / 'draft-gate.json').get('status') != 'ready':
        raise ValueError('scenario result is incomplete or changed')
    result = read(folder / 'scenarios.current.json')
    if request['mode'] == 'edit':
        if terminal.get('delta_sha256') != digest(folder / 'draft.candidate.json') or \
                apply_patch(request, read(folder / 'draft.candidate.json')) != result:
            raise ValueError('scene delta/result changed')
    old = {s['id']: s for s in request.get('existing_scenarios', [])}
    target = request['target_requirement_id']
    related = sorted({rid for g in current['context'].get('requirement_groups', [])
        if target in g['requirement_ids'] for rid in g['requirement_ids']} - {target})
    adopted = []
    for scene in result['scenarios']:
        sid = scene['id']
        if sid in old and scene == old[sid]:
            adopted.append(deepcopy(scene))
            continue
        item = deepcopy(scene) if sid in old else {k: scene[k] for k in DESIGN_FIELDS}
        if sid not in old:
            item.update(requirement_id=target, kind=request['scenario_kind'])
            item['origin'] = {'kind': 'skill_generated_internal_self_check',
                             'reference': str(folder / 'scenarios.current.json') + '#' + sid}
            item['external_refs'] = []
        if sid not in old:
            item['related_refs'] = related
        if sid not in old or item['description'] != old[sid]['description']:
            item['check'] = {'method': 'internal_self_check', 'basis':
                str(folder / 'terminal.json') + ': ' + result.get('change_reasons', {}).get(sid,
                    '; '.join(result['change_summary']))}
        item.pop('version', None)
        item.pop('content_sha256', None)
        adopted.append(item)
    replaced = {s['id']: s for s in adopted}
    if set(replaced) & {s['id'] for s in current['scenarios'] if s.get('requirement_id') != target}:
        raise ValueError('generated scene ID collides with an unrelated adopted scene')
    merged, inserted = [], set()
    for scene in current['scenarios']:
        if scene.get('requirement_id') != target:
            merged.append(deepcopy(scene))
        elif scene['id'] in replaced:
            merged.append(replaced[scene['id']]); inserted.add(scene['id'])
    merged.extend(s for s in adopted if s['id'] not in inserted)
    current['scenarios'] = merged
    current['scenario_revision'] = {'request': str(folder / 'request.frozen.json'),
        'request_sha256': terminal['request_sha256'], 'result_sha256': terminal['scenarios_sha256'],
        'mode': request['mode'], 'change_reasons': result.get('change_reasons', {}),
        'retired_scene_ids': result.get('retired_scene_ids', [])}
    validate_definitions(current)
    return current
