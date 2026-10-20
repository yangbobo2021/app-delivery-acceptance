#!/usr/bin/env python3
"""Frozen, project-owned definitions. Agents interpret sources; this module never fetches them."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

SCHEMA = 'acceptance-catalog-v2'
COLLECTIONS = ('requirements', 'reverse_rules', 'scenarios')
GENERATED = {'version', 'content_sha256'}
METADATA = {'title', 'priority', 'priority_reason', 'external_refs'}


def content(item):
    return {k: v for k, v in item.items() if k not in GENERATED}


def index(value):
    return {f'{group}:{item["id"]}': item for group in COLLECTIONS for item in value.get(group, [])}


def refs(scene):
    result = list(scene.get('related_refs', []))
    if scene.get('requirement_id'):
        result.append(scene['requirement_id'])
    return set(result)


def validate_definitions(value):
    from acceptance_store import fingerprint
    if value.get('schema') != SCHEMA or not isinstance(value.get('project'), dict):
        raise ValueError('complete acceptance-catalog-v2 required')
    if not isinstance(value.get('context'), dict) or not value['context'].get('business_goal'):
        raise ValueError('frozen context.business_goal required')
    all_ids = set()
    for group in COLLECTIONS:
        if not isinstance(value.get(group), list):
            raise ValueError('complete definition collection required: ' + group)
        for item in value[group]:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'].strip():
                raise ValueError('definition needs a stable ID')
            if item['id'] in all_ids:
                raise ValueError('duplicate definition ID: ' + item['id'])
            all_ids.add(item['id'])
            field = 'description' if group == 'scenarios' else 'text'
            if not isinstance(item.get(field), str) or not item[field].strip():
                raise ValueError('complete frozen definition missing: ' + item['id'])
            origin = item.get('origin', {})
            if not all(isinstance(origin.get(k), str) and origin[k].strip() for k in ('kind', 'reference')):
                raise ValueError('origin.kind and reference required: ' + item['id'])
            if not isinstance(item.get('external_refs'), list):
                raise ValueError('external_refs must be an array (may be empty)')
            for ref in item['external_refs']:
                if not isinstance(ref, dict) or not all(isinstance(ref.get(k), str) and ref[k].strip()
                                                       for k in ('locator', 'revision', 'text')):
                    raise ValueError('external reference needs locator, revision and frozen text')
            if 'version' in item and (type(item['version']) is not int or item['version'] < 1):
                raise ValueError('invalid definition version')
            if 'content_sha256' in item and item['content_sha256'] != fingerprint(content(item)):
                raise ValueError('frozen definition changed: ' + item['id'])
    targets = {item['id']: item for group in COLLECTIONS[:2] for item in value[group]}
    for rule in value['reverse_rules']:
        sources = rule.get('code_sources')
        if not isinstance(sources, list) or not sources or any(not all(
                isinstance(source.get(k), str) and source[k].strip() for k in ('path', 'revision', 'sha256'))
                for source in sources):
            raise ValueError('reverse rule needs frozen code_sources: path, revision, sha256')
        if rule.get('status') not in {'supported', 'needs_confirmation'}:
            raise ValueError('reverse rule needs supported or needs_confirmation status')
        if rule['status'] == 'supported' and (rule.get('basis_kind') not in
                {'contract', 'invariant', 'confirmed_decision'} or not rule.get('basis')):
            raise ValueError('supported reverse rule needs independent expected-behavior basis')
        if rule['status'] == 'needs_confirmation' and not rule.get('question'):
            raise ValueError('pending reverse rule needs a concrete question')
    for scene in value['scenarios']:
        if scene.get('priority') not in {'P0', 'P1', 'P2', 'P3'} or not scene.get('priority_reason'):
            raise ValueError('scene priority/reason required')
        check = scene.get('check', {})
        if not check.get('method') or not check.get('basis'):
            raise ValueError('adopted/generated scene needs its actual check method and basis')
        if not isinstance(scene.get('related_refs', []), list):
            raise ValueError('related_refs must be an array')
        for target in refs(scene):
            if target not in targets:
                raise ValueError('unknown scene target/context: ' + str(target))
            if targets[target].get('status') == 'needs_confirmation':
                raise ValueError('pending reverse rule cannot enter an executable scene')


def versioned(value, previous=None):
    from acceptance_store import fingerprint
    result = deepcopy(value)
    prior = index(previous or {})
    for group in COLLECTIONS:
        for item in result[group]:
            old = prior.get(f'{group}:{item["id"]}')
            raw = content(item)
            item['version'] = (old.get('version', 1) if old and content(old) == raw else
                               old.get('version', 1) + 1 if old else 1)
            item['content_sha256'] = fingerprint(raw)
    validate_definitions(result)
    return result


def compare(previous, candidate, assessment=None):
    """Mechanical diff plus Agent-declared semantic impact; never infer meaning from text hashes."""
    from acceptance_store import fingerprint
    candidate = deepcopy(candidate)
    for group in COLLECTIONS:
        for item in candidate.get(group, []):
            for key in GENERATED:
                item.pop(key, None)
    validate_definitions(candidate)
    old, new = index(previous or {}), index(candidate)
    changes = []
    affected = set()
    changed_targets = set()
    scenario_checks = set()
    analysis = False
    notes = (assessment or {}).get('changes', {})
    for key in sorted(old.keys() | new.keys()):
        before, after = old.get(key), new.get(key)
        if before and after and content(before) == content(after):
            continue
        fields = sorted(k for k in set(content(before or {})) | set(content(after or {}))
                        if (before or {}).get(k) != (after or {}).get(k))
        metadata = bool(before and after and set(fields) <= METADATA)
        if metadata and 'external_refs' in fields:
            old_texts = {r['text'] for r in before.get('external_refs', [])}
            new_texts = {r['text'] for r in after.get('external_refs', [])}
            own_text = before.get('text', before.get('description'))
            metadata = old_texts == new_texts or (old_texts <= new_texts and new_texts - old_texts <= {own_text})
        note = notes.get(key, {})
        # Rewording equivalence is an Agent judgment with retained reasons, never a heuristic.
        equivalent = note.get('classification') == 'equivalent'
        if equivalent and (not note.get('reason') or not before or not after or
                           (before.get('status') != after.get('status'))):
            raise ValueError('equivalence needs two definitions, unchanged admission and an Agent reason')
        semantic = not metadata and not equivalent
        group, ident = key.split(':', 1)
        changes.append({'ref': key, 'operation': 'added' if not before else 'removed' if not after else 'modified',
                        'fields': fields, 'classification': 'equivalent' if equivalent else
                        'metadata' if metadata else 'definition', 'assessment': note,
                        'before_sha256': fingerprint(content(before)) if before else None,
                        'after_sha256': fingerprint(content(after)) if after else None})
        if semantic and group != 'scenarios':
            analysis = True
            if after and after.get('status') != 'needs_confirmation':
                changed_targets.add(ident)
        if semantic and group == 'scenarios' and after:
            affected.add(ident)
    context_changed = bool(previous and previous.get('context') != candidate.get('context'))
    if context_changed:
        analysis = True
    changed_dependencies = {c['ref'].split(':', 1)[1] for c in changes
                            if c['classification'] == 'definition' and not c['ref'].startswith('scenarios:')}
    for scene in candidate['scenarios']:
        if context_changed or refs(scene) & changed_dependencies:
            affected.add(scene['id'])
        if analysis:
            scenario_checks.add(scene['id'])
    extra = (assessment or {}).get('affected_scene_ids', [])
    known = {s['id'] for s in candidate['scenarios']}
    if not isinstance(extra, list) or set(extra) - known:
        raise ValueError('Agent impact assessment references unknown scenes')
    if extra and not (assessment or {}).get('reason'):
        raise ValueError('additional impact needs an Agent reason')
    affected.update(extra)
    covered = {s.get('requirement_id') for s in candidate['scenarios']}
    pending = [r['id'] for r in candidate['reverse_rules'] if r['status'] == 'needs_confirmation']
    missing = [r['id'] for group in COLLECTIONS[:2] for r in candidate[group]
               if r.get('status') != 'needs_confirmation' and r['id'] not in covered]
    equivalents = {}
    for scene in candidate['scenarios']:
        sid = scene['id']
        if sid not in affected and previous and any(s['id'] == sid for s in previous.get('scenarios', [])):
            old_fingerprint = scene_fingerprint(previous, sid)
            current_fingerprint = scene_fingerprint(candidate, sid)
            inherited = previous.get('change', {}).get('equivalent_bindings', {}).get(sid, [])
            equivalents[sid] = sorted(set([old_fingerprint, *inherited]) - {current_fingerprint})
    return {'schema': 'acceptance-definition-change-v1',
            'base_sha256': fingerprint(previous) if previous else None,
            'candidate_sha256': fingerprint(candidate), 'changes': changes,
            'context_changed': context_changed, 'analysis_required': analysis,
            'coverage_check_scene_ids': sorted(scenario_checks),
            'scenario_target_ids': sorted(changed_targets | set(missing)),
            'rerun_scene_ids': sorted(affected), 'missing_scenario_target_ids': missing,
            'pending_rule_ids': pending, 'assessment': assessment or {},
            'equivalent_bindings': equivalents,
            'decision': 'proposed_only', 'product_revision_policy': 'same-version completion still required'}


def binding(project, acceptance_id):
    from acceptance_store import locations, read, digest
    _, shared, _ = locations(project, acceptance_id)
    latest = read(shared / 'scenarios.json')
    if latest.get('schema') != SCHEMA:
        raise ValueError('publish complete v2 definitions first')
    validate_definitions(latest)
    path = shared / latest['definition_record']
    if read(path) != latest:
        raise ValueError('definition snapshot differs from immutable record')
    return {'path': str(path), 'sha256': digest(path)}


def load_binding(config, current=True, required=False):
    from acceptance_store import locations, read, digest, inside
    supplied = config.get('definitions')
    at = config.get('acceptance', {})
    if not at:
        if required:
            raise ValueError('acceptance binding required')
        return None
    _, shared, _ = locations(at['project_root'], at['id'])
    latest = read(shared / 'scenarios.json') if (shared / 'scenarios.json').exists() else {}
    if not supplied:
        if required or latest.get('schema') == SCHEMA:
            raise ValueError('frozen definitions binding required; create a new stage/plan')
        return None
    path = Path(supplied['path'])
    if not path.is_absolute() or not path.is_relative_to(shared):
        raise ValueError('definitions belong to another acceptance')
    path = inside(shared, path.relative_to(shared))
    if digest(path) != supplied['sha256']:
        raise ValueError('frozen definitions changed')
    value = read(path)
    validate_definitions(value)
    if value.get('acceptance_id') != at['id']:
        raise ValueError('definition identity mismatch')
    if current and (value != latest or value.get('scope_sha256') != at['scope_sha256']):
        raise ValueError('definitions changed; compare inputs and create affected frozen attempts')
    return value


def scene_fingerprint(value, scene_id):
    from acceptance_store import fingerprint
    scene = next((s for s in value['scenarios'] if s['id'] == scene_id), None)
    if scene is None:
        raise ValueError('scene absent from frozen definitions')
    targets = {r['id']: r for group in COLLECTIONS[:2] for r in value[group]}
    target = targets.get(scene.get('requirement_id'))
    related = [targets[i] for i in sorted(refs(scene) - {scene.get('requirement_id')})]
    def execution_content(item):
        result = {k: v for k, v in content(item).items() if k not in METADATA}
        own_text = item.get('text', item.get('description'))
        result['external_basis_texts'] = sorted({r['text'] for r in item.get('external_refs', [])} - {own_text})
        return result
    closure = {'scene': execution_content(scene), 'target': execution_content(target) if target else None,
               'related': [execution_content(r) for r in related], 'context': value['context']}
    return fingerprint(closure)


def scene_input(config, scene_id):
    """Resolve from frozen full definitions, including standalone external scenarios."""
    value = load_binding(config, required=True)
    scene = next((s for s in value['scenarios'] if s['id'] == scene_id), None)
    if scene is None:
        raise ValueError('scene absent from frozen definitions')
    targets = {r['id']: r for group in COLLECTIONS[:2] for r in value[group]}
    target = targets.get(scene.get('requirement_id'))
    related = [targets[i] for i in sorted(refs(scene) - {scene.get('requirement_id')})]
    sources = [source for rule in value['reverse_rules'] if rule['id'] in refs(scene)
               for source in rule['code_sources']]
    return {'definitions': config['definitions'], 'scene': deepcopy(scene),
            'requirement': deepcopy(target), 'related_requirements': deepcopy(related),
            'business_goal': value['context']['business_goal'],
            'confirmed_scope': value['context'].get('confirmed_scope', {}),
            'scenario_self_check': scene['check']['method'],
            'definition_binding_sha256': scene_fingerprint(value, scene_id),
            **({'source_evidence': {'revision': sources[0]['revision'], 'items': sources}} if sources else {})}


def verify_case(config):
    """Reject changed/missing definitions before case, debug, execution or review."""
    value = load_binding(config)
    if value is None:
        if not config.get('scene', {}).get('id') or not config.get('requirement', {}).get('id') or \
                config['scene'].get('requirement_id') != config['requirement']['id']:
            raise ValueError('case input has no bound scene owner')
        return
    expected = scene_input(config, config.get('scene', {}).get('id'))
    for key in ('scene', 'requirement', 'related_requirements', 'business_goal', 'confirmed_scope',
                'scenario_self_check', 'definition_binding_sha256',
                *(['source_evidence'] if expected.get('source_evidence') else [])):
        if config.get(key) != expected[key]:
            raise ValueError('case differs from frozen definitions: ' + key)


def verify_stage(request):
    value = load_binding(request)
    if value is None:
        return
    actual = request.get('requirements', {}).get('items', [])
    expected = value['requirements']
    if (len(actual) != len(expected) or {r['id']: r.get('text') for r in actual} !=
            {r['id']: r['text'] for r in expected}):
        raise ValueError('stage requirements differ from complete frozen definitions')
    if request.get('requirements', {}).get('shared_constraints', '') != value['context'].get('shared_constraints', ''):
        raise ValueError('stage shared constraints differ from frozen context')
    if request.get('base_revision'):
        existing = request.get('existing_rules', [])
        if len(existing) != len(value['reverse_rules']) or {r['id'] for r in existing} != {r['id'] for r in value['reverse_rules']}:
            raise ValueError('reverse stage must retain the complete frozen existing rules')
        for rule in existing:
            frozen = next(r for r in value['reverse_rules'] if r['id'] == rule['id'])
            if any(rule.get(k) != frozen.get(k) for k in ('text', 'status', 'basis_kind', 'basis')):
                raise ValueError('reverse stage rewrote a frozen rule')


def main():
    from acceptance_store import read, publish_catalog, require_current
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('compare', 'freeze', 'binding'):
        p = sub.add_parser(command)
        p.add_argument('project', type=Path)
        p.add_argument('acceptance_id')
        if command != 'binding':
            p.add_argument('--input', type=Path, required=True)
            p.add_argument('--assessment', type=Path)
        if command == 'freeze':
            p.add_argument('--basis', required=True)
    p = sub.add_parser('verify-case'); p.add_argument('input', type=Path)
    p = sub.add_parser('verify-stage'); p.add_argument('input', type=Path)
    p = sub.add_parser('scenario-request'); p.add_argument('input', type=Path)
    args = parser.parse_args()
    if args.command == 'verify-case':
        verify_case(read(args.input)); result = {'status': 'bound'}
    elif args.command == 'verify-stage':
        verify_stage(read(args.input)); result = {'status': 'bound'}
    elif args.command == 'scenario-request':
        request = read(args.input)
        value = load_binding(request)
        if value:
            request = {**request, 'requirements': {'items': value['requirements'],
                'shared_constraints': value['context'].get('shared_constraints', '')},
                'reverse_rules': value['reverse_rules'],
                'analysis': {**request.get('analysis', {}), **value['context']},
                'user_constraints': value['context'].get('user_constraints', [])}
        result = request
    else:
        require_current(args.project, args.acceptance_id)
        if args.command == 'binding':
            result = binding(args.project, args.acceptance_id)
        else:
            from acceptance_store import locations
            _, shared, _ = locations(args.project, args.acceptance_id)
            path = shared / 'scenarios.json'
            previous = read(path) if path.exists() else None
            candidate = read(args.input)
            assessment = read(args.assessment) if args.assessment else None
            if args.command == 'compare':
                result = compare(previous, candidate, assessment)
            else:
                candidate['basis'] = args.basis
                result = publish_catalog(args.project, args.acceptance_id, candidate, assessment=assessment)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({'status': 'blocked', 'reason': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
