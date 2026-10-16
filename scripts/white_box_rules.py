"""Separate code-derived rules from the confirmed business requirement snapshot."""
import hashlib
import json
import design_quality
from pathlib import Path

NAME = 'white_box_rules.json'
STATUSES = ('supported', 'confirmed', 'needs_confirmation')


def read(ledger):
    path = ledger / NAME
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'version': 1, 'items': []}


def rules(ledger):
    value = read(ledger)
    return value.get('items', []) if isinstance(value, dict) and isinstance(value.get('items'), list) else []


def present(value):
    return isinstance(value, str) and bool(value.strip())


def source_errors(project, sources):
    errors = []
    if not isinstance(sources, list) or not sources:
        return ['code sources need at least one actual file and symbol']
    for source in sources:
        try:
            if not isinstance(source, dict) or not all(present(source.get(k)) for k in ('path', 'symbol', 'revision', 'sha256')):
                raise ValueError('code source needs path, symbol, revision and sha256')
            root = Path(source.get('root', str(project)))
            if not root.is_absolute():
                raise ValueError('code source root must be an explicit absolute repository path')
            root = root.resolve()
            relative = Path(source['path'])
            target = (root / relative).resolve()
            if relative.is_absolute() or '..' in relative.parts or not target.is_relative_to(root):
                raise ValueError('code source path escapes its repository')
            if hashlib.sha256(target.read_bytes()).hexdigest() != source['sha256']:
                raise ValueError('code source changed: ' + source['path'])
            if source.get('excerpt') is not None:
                lines = target.read_text().splitlines()
                start, end = source.get('line_start'), source.get('line_end')
                if not isinstance(start, int) or not isinstance(end, int) or not 1 <= start <= end <= len(lines) or source['excerpt'] != '\n'.join(lines[start-1:end]):
                    raise ValueError('code excerpt does not match its actual file and lines')
        except (ValueError, OSError, TypeError) as exc:
            errors.append(str(exc))
    return errors


def definitions_errors(project, ledger, scenarios, requirement_ids, check_design=True):
    value = read(ledger)
    errors, seen = [], set()
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('items'), list):
        return ['white_box_rules.json needs version 1 and items']
    for rule in rules(ledger):
        if not isinstance(rule, dict) or not present(rule.get('id')):
            errors.append('reverse rule needs a stable id'); continue
        rid = rule['id']
        if rid in seen or rid in requirement_ids:
            errors.append('reverse rule id duplicates a rule or confirmed requirement: ' + rid)
        seen.add(rid)
        if not all(present(rule.get(k)) for k in ('title', 'text', 'rationale', 'basis')) or rule.get('status') not in STATUSES:
            errors.append(rid + ' needs readable title, rule, rationale, independent basis and status')
        if rule.get('status') == 'needs_confirmation' and not present(rule.get('question')):
            errors.append(rid + ' needs the precise unresolved business question')
        if rule.get('status') == 'confirmed' and not present(rule.get('confirmation_reference')):
            errors.append(rid + ' needs actual human confirmation reference')
        if rule.get('status') != 'needs_confirmation' and rule.get('basis_kind') not in ('contract', 'invariant', 'confirmed_decision'):
            errors.append(rid + ' cannot use current implementation alone as its judgment basis')
        errors.extend(rid + ': ' + e for e in source_errors(project, rule.get('code_sources')))
    for scene in scenarios:
        refs = scene.get('reverse_rule_ids', [])
        if not isinstance(refs, list) or any(not present(r) or r not in seen for r in refs) or len(set(refs)) != len(refs):
            errors.append(str(scene.get('id')) + ' has invalid reverse_rule_ids')
        if refs and scene.get('kind') != 'white_box':
            errors.append(str(scene.get('id')) + ' black-box scenes cannot derive their baseline from code')
        if scene.get('kind') == 'white_box':
            errors.extend(str(scene.get('id')) + ': ' + e for e in source_errors(project, scene.get('code_sources')))
    document, targets, scene_map = design_contract(ledger, scenarios)
    if check_design and (scene_map or rules(ledger)):
        errors.extend(design_quality.basis_errors(document, targets, scene_map, design_quality.acceptance_map(scene_map)))
    return errors


def design_contract(ledger, scenarios):
    """Share the black-box quality contract without changing confirmed requirements."""
    document = read(ledger)
    scene_map = {s['id']: dict(s, requirement_ids=list(dict.fromkeys(r for field in ('requirement_ids', 'reverse_rule_ids') for r in design_quality.records(s.get(field)) if present(r))))
                 for s in scenarios if isinstance(s, dict) and s.get('kind') == 'white_box' and present(s.get('id'))}
    targets = {rid: {} for s in scene_map.values() for rid in s['requirement_ids'] if isinstance(rid, str)}
    targets.update({r['id']: r for r in rules(ledger) if isinstance(r, dict) and present(r.get('id')) and r.get('applicability', {}).get('status', 'in_scope') == 'in_scope'})
    return document, targets, scene_map


def review_errors(ledger, scenarios, record, require_resolved=True):
    errors, seen = [], set()
    record = record if isinstance(record, dict) else {}
    rule_map = {r['id']: r for r in rules(ledger) if isinstance(r, dict) and present(r.get('id'))}
    judgments = record.get('rule_reviews', []) if isinstance(record, dict) else []
    if not isinstance(judgments, list):
        return ['reverse rules need independent rule_reviews']
    for item in judgments:
        rid = item.get('rule_id') if isinstance(item, dict) else None
        if rid not in rule_map or rid in seen:
            errors.append('reverse rule review is duplicated or unknown: ' + str(rid)); continue
        seen.add(rid); rule = rule_map[rid]
        expected = 'needs_confirmation' if rule.get('status') == 'needs_confirmation' else 'accepted'
        if item.get('verdict') not in (expected, 'gap') or not present(item.get('reason')):
            errors.append(rid + ' lacks a reasoned independent rule judgment')
        if require_resolved and rule.get('applicability', {}).get('status', 'in_scope') == 'in_scope' and item.get('verdict') == 'gap':
            errors.append(rid + ' has unresolved independent rule findings')
        if require_resolved and rule.get('applicability', {}).get('status', 'in_scope') == 'in_scope' and rule.get('status') == 'needs_confirmation':
            errors.append(rid + ' is awaiting business confirmation; no pass or BUG baseline exists')
    for rid in rule_map.keys() - seen:
        errors.append(rid + ' has no independent reverse rule review')
    document, targets, scene_map = design_contract(ledger, scenarios)
    if scene_map or rule_map:
        design_reviews = record.get('design_reviews') if isinstance(record, dict) else None
        if not isinstance(design_reviews, list) or len(design_reviews) != len(targets) or {r.get('requirement_id') for r in design_reviews if isinstance(r, dict)} != set(targets):
            errors.append('white-box design_reviews must assess exactly the linked requirements and reverse rules')
        errors.extend(design_quality.review_errors({'design_standard': record.get('design_standard'), 'items': design_reviews}, document, targets, scene_map))
        if require_resolved and any(r.get('verdict') != 'sufficient' for r in design_quality.records(design_reviews) if isinstance(r, dict)):
            errors.append('white-box check items are not completely covered or have unresolved design findings')
    return errors


def execution_errors(ledger, scenario, project=None):
    pending = {r['id'] for r in rules(ledger) if isinstance(r, dict) and r.get('status') == 'needs_confirmation'}
    errors = [rid + ' must be confirmed before this scenario can execute or receive a product verdict'
            for rid in scenario.get('reverse_rule_ids', []) if rid in pending]

    if project is not None:
        errors.extend(source_errors(project, scenario['code_sources']) if scenario.get('code_sources') else [])
        for rule in rules(ledger):
            if rule.get('id') in scenario.get('reverse_rule_ids', []):
                errors.extend(source_errors(project, rule.get('code_sources')))
    return errors
