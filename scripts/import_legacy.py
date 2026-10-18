#!/usr/bin/env python3
"""Copy frozen legacy data without executing it or rewriting any embedded path."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from acceptance_store import inside, save

EXCLUDE = {'checkout', 'worktrees', 'node_modules', '.git', '__pycache__', '.venv'}


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if sha(source) != sha(target):
            raise ValueError('Existing import differs; never overwrite frozen evidence')
        return 'retained'
    if sys.platform == 'darwin':
        library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        clone = getattr(library, 'clonefile', None)
        if clone:
            clone.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
            clone.restype = ctypes.c_int
            if clone(os.fsencode(source), os.fsencode(target), 0) == 0:
                shutil.copystat(source, target)
                return 'independent_copy_on_write'
    if source.stat().st_size > shutil.disk_usage(target.parent).free:
        raise ValueError('Insufficient space for an independent evidence copy')
    shutil.copy2(source, target)
    return 'independent_copy'


def copy_tree(source, target, inventory):
    source, target = Path(source).resolve(), Path(target).resolve()
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError('Legacy source and import destination must be separate trees')
    files, excluded = {}, []
    size = 0
    for folder, directories, names in os.walk(source, followlinks=False):
        for name in list(directories):
            path = Path(folder) / name
            if name in EXCLUDE or path.is_symlink():
                excluded.append({'path': str(path), 'reason': 'retained original isolated checkout/dependency/cache/link; never executed or deleted'})
                directories.remove(name)
        directories.sort()
        for name in sorted(names):
            path = Path(folder) / name
            if path.is_symlink():
                excluded.append({'path': str(path), 'reason': 'retained original symbolic link'})
                continue
            relative = path.relative_to(source).as_posix()
            dest = inside(target, relative)
            expected = sha(path)
            mode = copy_file(path, dest)
            if sha(dest) != expected or sha(path) != expected:
                raise ValueError('Evidence changed during import: ' + str(path))
            files[str(path)] = {'path': relative, 'sha256': expected, 'size': path.stat().st_size, 'copy_mode': mode}
            size += path.stat().st_size
            if len(files) % 10000 == 0:
                print(json.dumps({'copied_files': len(files), 'logical_bytes': size}), flush=True)
    result = {'schema': 'legacy-evidence-copy-v1', 'source': str(source), 'destination': str(target),
              'files': files, 'excluded': excluded, 'count': len(files), 'bytes': size,
              'originals_unchanged': True, 'test_execution': False}
    save(inventory, result, exclusive=True)
    return {'inventory': str(inventory), 'files': len(files), 'logical_bytes': size, 'excluded': len(excluded)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--inventory', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(copy_tree(args.source, args.destination, args.inventory)), flush=True)
