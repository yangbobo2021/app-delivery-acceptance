"""Host-owned case identity finalization; no framework or language discovery."""
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

ID = r'TC-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
# Comment syntax, not language/framework selection. The Agent identifies the declaration.
COMMENTS = {'# {id}', '// {id}', '-- {id}', '; {id}', '% {id}', "' {id}",
            '/* {id} */', '<!-- {id} -->', '(* {id} *)', 'REM {id}'}
MARKER = re.compile(r'^\s*(?:#|//|--|;|%|\'|/\*|<!--|\(\*|REM)\s*@case-id:\s*(' + ID + r')\s*(?:\*/|-->|\*\))?\s*$')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def source_path(root, name):
    p = Path(name)
    path = root / p
    if p.is_absolute() or not p.parts or set(p.parts) & {'.git', '.acceptance', '.acceptance-local'}:
        raise ValueError('case identity source outside test workspace')
    if path.is_symlink() or any(x.is_symlink() for x in path.parents if x != root) or not path.resolve().is_relative_to(root) or not path.is_file():
        raise ValueError('case identity source missing or symlinked: ' + name)
    return path


def markers(catalog, selected=()):
    """Search only identity markers in Git-owned/nonignored text, never enumerate tests."""
    root = Path(catalog['project_root']).resolve()
    found = {}
    for prefix in ['', *[c['path'] for c in catalog.get('components', [])]]:
        repo = root / prefix
        p = subprocess.run(['git', 'grep', '--untracked', '-I', '-l', '-z', '-e', '@case-id:'], cwd=repo, capture_output=True)
        if p.returncode not in (0, 1):
            raise ValueError('cannot check existing case ID conflicts: ' + p.stderr.decode(errors='replace'))
        for name in filter(None, p.stdout.decode().split('\0')):
            key = (Path(prefix) / name).as_posix()
            if set(Path(key).parts) & {'.acceptance', '.acceptance-local', '.git'}:
                continue
            roots = catalog.get('write_roots', catalog.get('test_roots', []))
            if roots and not any(Path(key).is_relative_to(Path(r)) for r in roots):
                continue
            path = source_path(root, key)
            for n, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
                m = MARKER.fullmatch(line)
                if key in selected and not m and re.match(r"^\s*(?:#|//|--|;|%|'|/\*|<!--|\(\*|REM)\s*@case-id:", line):
                    raise ValueError('malformed case ID marker: ' + key + ':' + str(n))
                if m:
                    cid = m[1]
                    loc = (key, n)
                    if cid in found and found[cid] != loc:
                        raise ValueError('duplicate case ID: ' + cid)
                    found[cid] = loc
    return found


def rebuilt(patch):
    before = base64.b64decode(patch['before_base64'], validate=True)
    if sha(before) != patch['before_sha256']:
        raise ValueError('identity patch preimage changed')
    bom = b'\xef\xbb\xbf' if before.startswith(b'\xef\xbb\xbf') else b''
    lines = before[len(bom):].splitlines(keepends=True)
    seen = set()
    for insert in sorted(patch['insertions'], key=lambda x: x['line'], reverse=True):
        n = insert['line']
        raw = insert['text'].encode('utf-8')
        if type(n) is not int or not 1 <= n <= len(lines) or n in seen or not MARKER.fullmatch(insert['text'].rstrip('\r\n')) or len(raw.splitlines()) != 1:
            raise ValueError('invalid ID-only insertion')
        seen.add(n)
        lines.insert(n - 1, raw)
    after = bom + b''.join(lines)
    if sha(after) != patch['after_sha256']:
        raise ValueError('identity patch contains non-ID edits')
    return after


def verify(answer, root, *, scene_id=None, acceptance_id=None, receipt_hashes=None):
    """Bind canonical IDs, exact source spans and current bytes; never infer execution."""
    root = Path(root).resolve()
    ref = answer.get('case_identity')
    if not isinstance(ref, dict):
        raise ValueError('case identity report missing')
    path = Path(ref['path'])
    if sha(path.read_bytes()) != ref['sha256']:
        raise ValueError('case identity report hash mismatch')
    report = load(path)
    if sha(path.with_name('answer.agent.json').read_bytes()) != report['raw_answer_sha256']:
        raise ValueError('original Agent answer changed')
    if report.get('schema') != 'case-identities-v1' or report.get('status') != 'finalized':
        raise ValueError('case identity finalization incomplete')
    if scene_id is not None and report['scene_id'] != scene_id or acceptance_id is not None and report['acceptance_id'] != acceptance_id:
        raise ValueError('case identity scene/acceptance mismatch')
    if report['cases'] != answer.get('case_descriptions', []):
        raise ValueError('case identity selection changed')
    for case in report['cases']:
        src = case['source']; path = source_path(root, src['file']); data = path.read_bytes()
        if sha(data) != src['file_sha256']:
            raise ValueError('case identity source changed: ' + src['file'])
        lines = data.decode('utf-8-sig').splitlines()
        line = src['id_line']
        if not 1 <= line < src['line_start'] <= src['line_end'] <= len(lines) or line != src['line_start'] - 1:
            raise ValueError('case ID is not adjacent to its declaration')
        match = MARKER.fullmatch(lines[line - 1])
        if not match or match[1] != case['id']:
            raise ValueError('case ID marker does not match declaration')
        if receipt_hashes is not None and receipt_hashes.get(src['file']) != src['file_sha256']:
            raise ValueError('execution did not bind selected case ID source')
    for name, patch in report['patches'].items():
        path = source_path(root, name)
        if path.stat().st_mode & 0o777 != patch['mode'] or rebuilt(patch) != path.read_bytes():
            raise ValueError('source differs from ID-only patch')
    return report


def finalize(catalog, input_value, output):
    output = Path(output).resolve(); root = Path(catalog['project_root']).resolve()
    answer_path = output / 'answer.json'; raw = load(answer_path)
    at = input_value['acceptance']['id']; scene = input_value['scene']['id']
    if raw.get('case_identity'):
        return verify(raw, root, scene_id=scene, acceptance_id=at)
    if (output / 'case-identities.pending.json').exists() or (output / 'answer.agent.json').exists():
        raise ValueError('interrupted case identity finalization: recover recorded preimages before retry')
    registry_path = Path(input_value['acceptance']['project_root']) / '.acceptance' / 'case-identities.json'
    registry = load(registry_path) if registry_path.exists() else {'schema': 'project-case-identities-v1', 'cases': {}}
    if registry.get('schema') != 'project-case-identities-v1':
        raise ValueError('unsupported project case identity registry')
    existing = markers(catalog, {c.get('source', {}).get('file') for c in raw.get('case_descriptions', [])}); answer = deepcopy(raw)
    if 'case_descriptions' not in answer and answer.get('status') in ('blocked', 'needs_contract'):
        answer['case_descriptions'] = []
    cases = answer.get('case_descriptions')
    if not isinstance(cases, list) or not cases and answer.get('status') in ('passed_local', 'host_ready', 'product_failure'):
        raise ValueError('actual associated cases must be described before ID assignment')
    before = {}; plans = {}; mappings = {}; used = set(); records = []
    for case in cases:
        old = case.get('id'); src = case['source']; name = src['file']; path = source_path(root, name)
        if name not in answer.get('test_files', []):
            raise ValueError('case identity source is not selected test file')
        roots = catalog.get('write_roots', catalog.get('test_roots', []))
        if roots and not any(Path(name).is_relative_to(Path(r)) for r in roots):
            raise ValueError('case identity annotation outside test roots')
        data = before.setdefault(name, path.read_bytes()); lines = data.decode('utf-8-sig').splitlines(keepends=True)
        start, end = src.get('line_start'), src.get('line_end')
        if type(start) is not int or type(end) is not int or not 1 <= start <= end <= len(lines):
            raise ValueError('case identity declaration range invalid')
        body = ''.join(lines[start-1:end]); title = src['title']
        if not title or title not in body and title not in (name, path.name):
            raise ValueError('case identity declaration title not found')
        if any(MARKER.fullmatch(x.rstrip('\r\n')) for x in lines[start-1:end]):
            raise ValueError('source range includes another ID: describe one declaration starting after its marker')
        if old in mappings or not isinstance(old, str) or not old:
            raise ValueError('duplicate or missing local case reference')
        match = MARKER.fullmatch(lines[start-2].rstrip('\r\n')) if start > 1 else None
        logical_start = start - sum(bool(MARKER.fullmatch(x.rstrip('\r\n'))) for x in lines[:start-1])
        fingerprint = sha((name + '\0' + str(logical_start) + '\0' + title + '\0' + body).encode())
        matches = [cid for cid, rec in registry['cases'].items() if fingerprint in rec.get('fingerprints', [])]
        if len(matches) > 1:
            raise ValueError('ambiguous prior case identity')
        if match:
            cid = match[1]
            if matches and matches[0] != cid:
                raise ValueError('source marker conflicts with recorded case identity')
        else:
            cid = matches[0] if matches else 'TC-' + str(uuid.uuid4())
            if cid in existing:
                raise ValueError('recorded case ID already exists at another declaration')
            if start == 1 and lines[0].startswith('#!'):
                raise ValueError('preserve script shebang; locate the business declaration after its header')
            syntax = src.get('id_comment')
            if syntax not in COMMENTS:
                raise ValueError('source.id_comment must specify safe comment syntax with {id}')
            # Insert before the complete declaration, including decorators/attributes.
            indent = re.match(r'[ \t]*', lines[start-1])[0]
            newline = '\r\n' if data.count(b'\r\n') else '\n'
            text = indent + syntax.replace('{id}', '@case-id: ' + cid) + newline
            plans.setdefault(name, []).append({'line': start, 'text': text})
        if cid in used:
            raise ValueError('same test declaration described twice; merge its contributions')
        used.add(cid); mappings[old] = cid; case['id'] = cid
        records.append((cid, fingerprint, name, title))
    patches = {}
    for name, insertions in plans.items():
        data = before[name]
        patch = {'before_base64': base64.b64encode(data).decode(), 'before_sha256': sha(data),
                 'insertions': insertions, 'mode': source_path(root, name).stat().st_mode & 0o777}
        bom = b'\xef\xbb\xbf' if data.startswith(b'\xef\xbb\xbf') else b''
        lines = data[len(bom):].splitlines(keepends=True)
        for item in sorted(insertions, key=lambda x: x['line'], reverse=True):
            lines.insert(item['line']-1, item['text'].encode())
        patch['after_sha256'] = sha(bom + b''.join(lines)); rebuilt(patch); patches[name] = patch
    def relocate(loc):
        name = loc.get('file')
        if name not in before or type(loc.get('line_start')) is not int:
            return
        start, end = loc['line_start'], loc['line_end']
        loc['line_start'] += sum(i['line'] <= start for i in plans.get(name, []))
        loc['line_end'] += sum(i['line'] <= end for i in plans.get(name, []))
        loc['file_sha256'] = patches[name]['after_sha256'] if name in patches else sha(before[name])
        if 'quote' in loc and any(start < i['line'] <= end for i in plans.get(name, [])):
            # Host-expanded quotation includes only the exact inserted ID comments.
            data = rebuilt(patches[name]).decode('utf-8-sig').splitlines()
            loc['quote_before_identity'] = loc['quote']
            loc['quote'] = '\n'.join(data[loc['line_start']-1:loc['line_end']])
    for case in cases:
        relocate(case['source']); case['source']['id_line'] = case['source']['line_start'] - 1
    discovery = answer.get('case_discovery', {})
    for e in discovery.get('evidence', []): relocate(e)
    for a in discovery.get('associations', []): a['case_id'] = mappings[a['case_id']]
    for o in discovery.get('obligations', []): o['case_ids'] = [mappings[x] for x in o['case_ids']]
    for d in answer.get('case_reuse', {}).get('decisions', []): d['case_id'] = mappings[d['case_id']]
    report = {'schema': 'case-identities-v1', 'status': 'finalized', 'acceptance_id': at, 'scene_id': scene,
              'revision': catalog['revision'], 'raw_answer_sha256': sha(answer_path.read_bytes()),
              'cases': cases, 'local_id_map': mappings, 'patches': patches,
              'execution_scope': 'selected cases only; command receipts do not prove individual case execution'}
    report_path = output / 'case-identities.json'
    save(output / 'case-identities.pending.json', report)
    (output / 'answer.agent.json').write_bytes(answer_path.read_bytes())
    try:
        for name, patch in patches.items(): source_path(root, name).write_bytes(rebuilt(patch))
        if input_value.get('case_strategy') == 'existing_only':
            from case_discovery_contract import validate as validate_discovery
            answer = validate_discovery(answer, input_value, root,
                                        discovery_only=input_value.get('existing_case_mode') == 'discover_only')
            report['cases'] = answer['case_descriptions']
        save(report_path, report)
        answer['case_identity'] = {'path': str(report_path), 'sha256': sha(report_path.read_bytes())}
        verify(answer, root, scene_id=scene, acceptance_id=at)
        for cid, fp, name, title in records:
            record = registry['cases'].setdefault(cid, {'fingerprints': [], 'relationships': []})
            if fp not in record['fingerprints']: record['fingerprints'].append(fp)
            relation = {'acceptance_id': at, 'scene_id': scene, 'definitions': input_value.get('definitions'),
                        'revision': catalog['revision'], 'file': name, 'title': title,
                        'artifact_scope': 'isolated_worktree', 'report': str(report_path)}
            if relation not in record['relationships']: record['relationships'].append(relation)
        save(answer_path, answer)
        save(registry_path, registry)
        (output / 'case-identities.pending.json').unlink()
    except Exception:
        for name, data in before.items(): source_path(root, name).write_bytes(data)
        save(answer_path, raw)
        # Keep journal and raw answer for explicit recovery, never silently reallocate.
        raise
    return report


if __name__ == '__main__':
    catalog_path, input_path, output = sys.argv[1:]
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
    from acceptance_store import guard
    from acceptance_workspace import require_scene_lease
    catalog, value = load(catalog_path), load(input_path)
    guard(catalog, [output]); guard(value, [output]); require_scene_lease(catalog)
    from acceptance_definitions import verify_case
    verify_case(value)
    if catalog.get('definitions') != value.get('definitions'):
        raise ValueError('case identity catalog definitions differ')
    print(json.dumps(finalize(catalog, value, output), ensure_ascii=False))
