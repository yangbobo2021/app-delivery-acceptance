#!/usr/bin/env python3
"""Prepare the Skill's own locked npm dependencies; never install into a project/global prefix."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

PACKAGE_ROOT = Path(__file__).resolve().parents[1] / 'playbook'


def ensure_runtime(node=None):
    if os.name != 'posix':
        raise ValueError('The current Skill requires macOS or Linux (Python fcntl); native Windows is not supported.')
    import fcntl
    node = shutil.which(node or 'node')
    npm = shutil.which('npm')
    if not node or not npm:
        raise ValueError('Node.js >=22 and npm are required; install them before running this Skill.')
    node = str(Path(node).resolve())
    env = dict(os.environ)
    env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
    # Do not allow inherited npm global/prefix settings to redirect this install.
    env.pop('NODE_PATH', None)
    for key in tuple(env):
        if key.lower() in {'npm_config_prefix', 'npm_config_global', 'npm_config_package_lock', 'npm_config_omit'}:
            env.pop(key)
    identity = json.loads(subprocess.check_output([node, '-p', 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})'], text=True, env=env))
    if int(identity['node'].lstrip('v').split('.')[0]) < 22:
        raise ValueError(f"Node.js >=22 required; found {identity['node']} at {node}")
    if not shutil.which('git'):
        raise ValueError('Git is required for frozen revisions and the acceptance workspace.')
    npm_version = subprocess.check_output([npm, '--version'], text=True, env=env).strip()
    package = PACKAGE_ROOT / 'package.json'
    lock = PACKAGE_ROOT / 'package-lock.json'
    if not lock.is_file():
        raise ValueError('Skill package-lock.json is missing; restore the complete Skill distribution.')
    if (PACKAGE_ROOT / 'node_modules').is_symlink():
        raise ValueError('Skill node_modules must be a local directory, not a link to another environment.')
    fingerprint = hashlib.sha256(package.read_bytes() + b'\0' + lock.read_bytes() + b'\0' + json.dumps({**identity, 'node_path': node, 'npm': npm_version}, sort_keys=True).encode()).hexdigest()
    receipt = PACKAGE_ROOT / 'node_modules' / '.acceptance-runtime.json'
    with (PACKAGE_ROOT / '.runtime-install.lock').open('a+') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            saved = json.loads(receipt.read_text())
        except (OSError, ValueError):
            saved = {}
        def probe():
            return json.loads(subprocess.check_output([node, str(PACKAGE_ROOT / 'verify-runtime.mjs')], cwd=PACKAGE_ROOT, env=env, stderr=subprocess.PIPE, text=True, timeout=60))
        if saved.get('fingerprint') == fingerprint:
            try:
                return {**saved, 'package_root': str(PACKAGE_ROOT), 'status': 'reused', 'probe': probe()}
            except (subprocess.SubprocessError, ValueError, OSError):
                pass
        receipt.unlink(missing_ok=True)
        print(f'[acceptance-runtime] Installing locked dependencies into {PACKAGE_ROOT / "node_modules"}', file=sys.stderr, flush=True)
        subprocess.run([npm, 'ci', '--prefix', str(PACKAGE_ROOT), '--global=false', '--include=dev', '--include=optional', '--include=peer', '--no-audit', '--no-fund'], cwd=PACKAGE_ROOT, env=env, stdout=sys.stderr, stderr=sys.stderr, check=True, timeout=900)
        checked = probe()
        value = {'fingerprint': fingerprint, 'install_id': uuid.uuid4().hex, 'installed_at': time.time(), 'package_root': str(PACKAGE_ROOT), 'environment': {**identity, 'node_path': node, 'npm': npm_version}, 'probe': checked}
        temporary = receipt.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, indent=2) + '\n')
        temporary.replace(receipt)
        return {**value, 'status': 'installed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', help='Use the Node executable already running the workflow')
    args = parser.parse_args()
    try:
        print(json.dumps(ensure_runtime(args.node), ensure_ascii=False))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f'[acceptance-runtime] Preparation failed: {error}', file=sys.stderr)
        detail = getattr(error, 'stderr', None)
        if detail:
            print(detail.decode(errors='replace') if isinstance(detail, bytes) else detail, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
