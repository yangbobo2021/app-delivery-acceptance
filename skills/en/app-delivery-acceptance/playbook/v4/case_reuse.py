"""Same-session reuse evidence: lazy Git preimages, discovery checkpoint, final choices."""
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from case_discovery_contract import validate as validate_discovery


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo, stderr=subprocess.PIPE)


def inventory(catalog):
    """Do not read/hash every clean source file: retain its immutable index blob."""
    root = Path(catalog['project_root']).resolve()
    files = {}
    for prefix in ['', *[x['path'] for x in catalog.get('components', [])]]:
        repo = root / prefix
        dirty = set(git(repo, 'diff', '--name-only', '-z').decode().split('\0'))
        tracked = {}
        for row in git(repo, 'ls-files', '--stage', '-z').decode().split('\0'):
            if not row:
                continue
            meta, name = row.split('\t', 1)
            mode, blob, stage = meta.split()
            if mode == '160000':
                continue
            if stage != '0':
                raise ValueError('Resolve test/source merge conflicts before reuse discovery')
            tracked[name] = {'repo': prefix, 'blob': blob, 'mode': mode}
        untracked = set(git(repo, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')) - {''}
        for name in set(tracked) | untracked:
            path = repo / name
            key = (Path(prefix) / name).as_posix()
            if name not in dirty and name in tracked and not path.is_symlink():
                files[key] = tracked[name]
            elif path.is_file() and path.resolve().is_relative_to(root):
                files[key] = {'bytes': base64.b64encode(path.read_bytes()).decode(),
                              'mode': path.stat().st_mode & 0o777}
            else:
                files[key] = {'unavailable': True}
    return {'root': str(root), 'files': files}


def original_bytes(baseline, name):
    item = baseline['files'].get(name)
    if not item or item.get('unavailable'):
        raise ValueError('Reuse source was not an available file at Agent startup: ' + name)
    if 'bytes' in item:
        return base64.b64decode(item['bytes'])
    return git(Path(baseline['root']) / item['repo'], 'cat-file', 'blob', item['blob'])


def checkpoint(answer, input_value, catalog, baseline, output):
    """Called once before edits/debug. Reuses the finder validator and schema."""
    output, root = Path(output), Path(catalog['project_root']).resolve()
    if inventory(catalog) != baseline:
        raise ValueError('Reuse discovery checkpoint must precede project/test edits')
    candidate = deepcopy(answer)
    candidate.update(status='not_executed', observations=[], evidence_paths=[])
    d = candidate.get('case_discovery', {})
    names = set(candidate.get('test_files', []))
    names.update(x.get('file', '') for x in d.get('evidence', []))
    names.update(x.get('file', '') for x in d.get('excluded_candidates', []))
    for scope in d.get('search_scope', []):
        p = root / scope.get('path', '')
        if p.is_file():
            names.add(scope['path'])
    # Validate current source against its true pre-session bytes, then retain
    # just referenced source files for checks after legitimate modifications.
    hashes = {name: {'sha256': sha(original_bytes(baseline, name))} for name in names}
    canonical = validate_discovery(candidate, input_value, root, {'files': hashes}, discovery_only=True)
    snapshot = output / 'reuse-sources'
    for name in names:
        target = snapshot / name
        if not target.resolve().is_relative_to(snapshot.resolve()):
            raise ValueError('Reuse source path escapes snapshot')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(original_bytes(baseline, name))
    for scope in d['search_scope']:
        relative = Path(scope['path'])
        if relative.is_absolute() or not (snapshot / relative).resolve().is_relative_to(snapshot.resolve()):
            raise ValueError('Reuse scope escapes snapshot')
        if (root / relative).is_dir():
            (snapshot / relative).mkdir(parents=True, exist_ok=True)
    snapshot.mkdir(parents=True, exist_ok=True)
    return {'schema': 'case-reuse-checkpoint-v1', 'discovery': canonical,
            'source_hashes': hashes}


def span(root, case):
    loc = case['source']
    path = (Path(root) / loc['file']).resolve()
    if Path(loc['file']).is_absolute() or not path.is_relative_to(Path(root).resolve()) or not path.is_file():
        raise ValueError('Final case source is outside workspace or missing')
    lines = path.read_text().splitlines()
    start, end = loc.get('line_start'), loc.get('line_end')
    if type(start) is not int or type(end) is not int or not 1 <= start <= end <= len(lines):
        raise ValueError('Final case needs its actual source range')
    body = '\n'.join(lines[start-1:end])
    if not isinstance(loc.get('title'), str) or not loc['title'] or not (loc['title'] in body or loc['title'] in (loc['file'], path.name)):
        raise ValueError('Final case title is not in its source range')
    return body


def validate(answer, input_value, catalog, captured, output):
    output = Path(output)
    root = Path(catalog['project_root']).resolve()
    # Recheck the stored pre-edit quotations, not the subsequently edited file.
    original = validate_discovery(captured['discovery'], input_value, output / 'reuse-sources',
                                  {'files': captured['source_hashes']}, discovery_only=True)
    existing = {c['id']: c for c in original['case_descriptions']}
    obligations = {o['id'] for o in original['case_discovery']['obligations']}
    plan = answer.get('case_reuse')
    if not isinstance(plan, dict) or plan.get('schema') != 'case-reuse-plan-v1':
        raise ValueError('Missing mandatory case reuse decisions')
    cases = answer.get('case_descriptions', [])
    if not isinstance(cases, list) or any(not isinstance(c, dict) or not c.get('id') for c in cases):
        raise ValueError('Invalid final case descriptions')
    final = {c['id']: c for c in cases}
    if len(final) != len(cases):
        raise ValueError('Duplicate final case IDs')
    decisions, unused, limits = plan.get('decisions'), plan.get('not_selected'), plan.get('limitations')
    if not isinstance(decisions, list) or not isinstance(unused, list) or not isinstance(limits, list):
        raise ValueError('Reuse decisions, not_selected and limitations must be lists')
    if any(not isinstance(x, str) or not 0 < len(x) <= 600 for x in limits) or len(limits) > 10:
        raise ValueError('Invalid reuse limitations')
    seen, selected = set(), set()
    for choice in decisions:
        cid = choice.get('case_id')
        if cid not in final or cid in seen or choice.get('action') not in ('reuse', 'extend', 'new'):
            raise ValueError('Each final case needs exactly one valid reuse decision')
        seen.add(cid)
        targets, prior = choice.get('obligation_ids'), choice.get('existing_case_ids')
        if not isinstance(targets, list) or not targets or len(set(targets)) != len(targets) or not set(targets) <= obligations:
            raise ValueError('Reuse decision refers to an unknown/current-scene target')
        if not isinstance(prior, list) or len(set(prior)) != len(prior) or not set(prior) <= set(existing):
            raise ValueError('Reuse decision refers to an unknown existing case')
        reason = choice.get('reason')
        if not isinstance(reason, str) or not 0 < len(reason.strip()) <= 600:
            raise ValueError('Reuse/new decision requires a concrete reason')
        case = final[cid]
        source = case.get('source', {})
        body = span(root, case)
        if source['file'] not in answer.get('test_files', []):
            raise ValueError('Final case file missing from test_files')
        if choice['action'] == 'new':
            if prior or source.get('origin') != 'generated':
                raise ValueError('New tests must be generated, with no invented existing identity')
        else:
            if not prior or source.get('origin') != 'existing':
                raise ValueError('Reuse/extend must retain actual existing case identities')
            for pid in prior:
                old = existing[pid]
                if source['file'] != old['source']['file'] or source['title'] != old['source']['title']:
                    raise ValueError('Reuse/extend changed existing declaration identity')
                if choice['action'] == 'reuse' and body.strip() != span(output / 'reuse-sources', old).strip():
                    raise ValueError('Changed test body must not be labelled unchanged reuse')
            selected.update(prior)
    if seen != set(final):
        raise ValueError('Final case list and reuse decisions differ')
    if answer.get('status') in ('passed_local', 'product_failure', 'host_ready') and not final:
        raise ValueError('Ready implementation must describe its actual adopted cases')
    excluded = set()
    for row in unused:
        cid = row.get('case_id')
        if cid not in existing or cid in excluded or cid in selected or not isinstance(row.get('reason'), str) or not row['reason'].strip():
            raise ValueError('Found but unselected cases need unique reasons')
        excluded.add(cid)
    if selected | excluded != set(existing):
        raise ValueError('Existing associated cases disappeared without a selection reason')
    return {'schema': 'case-reuse-description-v1', 'status': 'available',
            'discovery': original['case_discovery'], 'existing_cases': original['case_descriptions'],
            'decisions': deepcopy(decisions), 'not_selected': deepcopy(unused),
            'limitations': deepcopy(limits)}


def cli(mode, catalog_path, input_path, output_path, request_path=None):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
    from acceptance_store import guard, owned_path
    from acceptance_workspace import require_scene_lease
    from acceptance_definitions import verify_case
    catalog, input_value = read(catalog_path), read(input_path)
    output = Path(output_path).resolve()
    guard(catalog, [output])
    require_scene_lease(catalog)
    verify_case(input_value)
    identity = {'input_sha256': sha(Path(input_path).read_bytes()),
                'catalog_sha256': sha(Path(catalog_path).read_bytes())}
    baseline_path, captured_path = output / 'reuse-baseline.json', output / 'case-reuse-discovery.json'
    if mode == 'start':
        if baseline_path.exists():
            value = read(baseline_path)
            if value.get('binding') != identity:
                raise ValueError('Reuse startup binding changed')
        else:
            value = {**inventory(catalog), 'binding': identity}
            save(baseline_path, value)
        return {'schema': 'case-reuse-tools-v1', 'checkpoint': [sys.executable, str(Path(__file__).resolve()),
            'checkpoint', str(Path(catalog_path).resolve()), str(Path(input_path).resolve()), str(output)],
            'request_path': str(output / 'reuse-discovery-request.json'),
            'record_path': str(captured_path)}
    baseline = read(baseline_path)
    if baseline.pop('binding') != identity:
        raise ValueError('Reuse startup binding differs')
    if mode == 'checkpoint':
        request_path = owned_path(output, request_path)
        request_sha = sha(request_path.read_bytes())
        if captured_path.exists():
            previous = read(captured_path)
            if previous.get('binding') != identity or previous.get('request_sha256') != request_sha:
                raise ValueError('Reuse checkpoint is frozen; preserve it instead of replacing it')
            return {'status': 'already_captured', 'record_path': str(captured_path)}
        value = checkpoint(read(request_path), input_value, catalog, baseline, output)
        value.update(binding=identity, request_sha256=request_sha)
        save(captured_path, value)
        return {'status': 'captured', 'record_path': str(captured_path),
                'existing_cases': len(value['discovery']['case_descriptions'])}
    if mode == 'verify':
        answer_path = output / 'answer.json'
        answer = read(answer_path)
        if not captured_path.exists() and answer.get('status') in ('blocked', 'needs_contract'):
            report = {'schema': 'case-reuse-description-v1', 'status': 'unavailable',
                      'reason': '用例阶段未就绪，未完成已有用例检查。'}
        else:
            captured = read(captured_path)
            if captured.get('binding') != identity:
                raise ValueError('Reuse checkpoint input/catalog changed')
            report = validate(answer, input_value, catalog, captured, output)
        report['binding'] = {**identity, 'answer_sha256': sha(answer_path.read_bytes())}
        save(output / 'case-reuse.json', report)
        return {'status': report['status'], 'record_path': str(output / 'case-reuse.json')}
    raise ValueError('Expected start, checkpoint or verify')


if __name__ == '__main__':
    print(json.dumps(cli(*sys.argv[1:]), ensure_ascii=False))
