"""Protect existing tests and source bytes while the finder runs and debugs."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def snapshot(catalog):
    root = Path(catalog['project_root']).resolve()
    files, revisions = {}, {}
    for prefix in ['', *[x['path'] for x in catalog.get('components', [])]]:
        repo = root / prefix
        revisions[prefix] = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
        names = subprocess.check_output(
            ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=repo)
        for name in set(names.decode().split('\0')) - {''}:
            path = repo / name
            key = (Path(prefix) / name).as_posix()
            if path.is_symlink():
                files[key] = {'symlink': str(path.readlink())}
            elif path.is_file():
                files[key] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                              'mode': path.stat().st_mode & 0o777}
            elif not path.exists():
                files[key] = {'missing': True}
    return {'root': str(root), 'revisions': revisions, 'files': files}


def verify(catalog, baseline, answer=None):
    expected = json.loads(json.dumps(baseline))
    if answer is not None and answer.get('case_identity'):
        from case_identity import verify as verify_identity
        report = verify_identity(answer, catalog['project_root'])
        for name, patch in report['patches'].items():
            item = expected['files'].get(name)
            if not item or item.get('sha256') != patch['before_sha256'] or item.get('mode') != patch['mode']:
                raise ValueError('ID annotation does not match finder startup bytes/mode')
            item['sha256'] = patch['after_sha256']
    if snapshot(catalog) != expected:
        raise ValueError('existing_only forbids source/test changes, additions or deletions')
    if answer is not None:
        for name in answer.get('test_files', []):
            item = baseline['files'].get(name)
            if not item or item.get('missing'):
                raise ValueError('existing_only test file was not present at startup: ' + name)


def verify_debug(output, answer):
    if answer.get('status') not in ('passed_local', 'product_failure'):
        return
    receipts = [json.loads(p.read_text()) for p in (Path(output) / 'debug').rglob('execution.json')]
    if not receipts or (answer['status'] == 'passed_local' and not any(r.get('exit_code') == 0 for r in receipts)):
        raise ValueError('existing_only local observations require an actual debug execution receipt')


def main():
    mode, catalog_path, output = sys.argv[1:]
    catalog = json.loads(Path(catalog_path).read_text())
    output = Path(output)
    path = output / 'existing-files.json'
    if mode == 'start':
        if path.exists():
            verify(catalog, json.loads(path.read_text()))
        else:
            path.write_text(json.dumps(snapshot(catalog), ensure_ascii=False, indent=2) + '\n')
    elif mode == 'verify':
        answer = output / 'answer.json'
        value = json.loads(answer.read_text()) if answer.exists() else None
        verify(catalog, json.loads(path.read_text()), value)
        if value is not None:
            verify_debug(output, value)
    else:
        raise ValueError('expected start or verify')


if __name__ == '__main__':
    main()
