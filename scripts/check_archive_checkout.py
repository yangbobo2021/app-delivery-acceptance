#!/usr/bin/env python3
"""Check that an acceptance archive can survive a Git checkout."""
import json
from pathlib import Path
import subprocess
import sys


def check_archive(store):
    store = Path(store).resolve()
    if not store.is_dir() or store.name.startswith('.'):
        raise ValueError('acceptance archive directory missing')
    repo = Path(subprocess.check_output(
        ['git', 'rev-parse', '--show-toplevel'], cwd=store, text=True).strip()).resolve()
    if not store.is_relative_to(repo):
        raise ValueError('acceptance archive is outside the Git checkout')
    relative = store.relative_to(repo).as_posix()
    files = sorted(path for path in store.rglob('*') if path.is_file() or path.is_symlink())
    if not files or any(path.is_symlink() or not path.resolve().is_relative_to(store) for path in files):
        raise ValueError('acceptance archive is empty or contains a symlink')
    tracked = set(subprocess.check_output(
        ['git', 'ls-files', '--cached', '-z', '--', relative], cwd=repo).decode().split('\0'))
    missing = [path.relative_to(repo).as_posix() for path in files
               if path.relative_to(repo).as_posix() not in tracked]
    changed = subprocess.run(['git', 'diff', '--quiet', '--', relative], cwd=repo).returncode
    result = {'schema': 'archive-checkout-check-v1', 'archive': str(store),
              'files': len(files), 'missing_from_index': missing,
              'unstaged_changes': changed == 1,
              'status': 'ready' if not missing and changed == 0 else 'incomplete'}
    if changed not in (0, 1):
        raise ValueError('could not compare archive with Git index')
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: check_archive_checkout.py PROJECT/.acceptance/AT-ID')
    result = check_archive(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['status'] == 'ready' else 1)
