#!/usr/bin/env python3
"""Bound local debugging: fresh state, the shared collector, and no new verdict."""
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'scripts'))
from acceptance_store import guard, owned_path, inside, digest, read, save
from acceptance_workspace import require_scene_lease


def create(catalog_path, input_path, contract_path):
    catalog, scene = read(catalog_path), read(input_path)
    contract_path = Path(contract_path).resolve()
    guard(catalog, [contract_path])
    require_scene_lease(catalog)
    value = {'schema': 'acceptance-debug-contract-v1', 'acceptance': catalog['acceptance'],
             'project_root': catalog['project_root'], 'workspace_policy': catalog['workspace_policy'],
             'revision': catalog['revision'], 'scene_id': scene['scene']['id'],
             'catalog_path': str(Path(catalog_path).resolve()), 'catalog_sha256': digest(catalog_path),
             'input_path': str(Path(input_path).resolve()), 'input_sha256': digest(input_path),
             'debug_root': str(contract_path.parent / 'debug'),
             'coverage': catalog.get('coverage', scene.get('coverage', {})),
             'environment': scene.get('debug_environment', {})}
    if contract_path.exists():
        if read(contract_path) != value:
            raise ValueError('Debug contract changed; preserve it and create a new bound attempt')
    else:
        save(contract_path, value, exclusive=True)
    return {'entry': [sys.executable, str(HERE / 'debug_case.py'), 'run', str(contract_path)],
            'request_root': value['debug_root'], 'required_test_files': value['coverage'].get('required_test_files', {})}


def run(contract_path, request_path):
    contract = read(contract_path)
    if contract.get('schema') != 'acceptance-debug-contract-v1':
        raise ValueError('Invalid debug contract')
    guard(contract, [contract['debug_root']])
    require_scene_lease(contract)
    for key in ['catalog', 'input']:
        if digest(contract[key + '_path']) != contract[key + '_sha256']:
            raise ValueError('Debug ' + key + ' binding changed')
    create(contract['catalog_path'], contract['input_path'], contract_path)
    request_path = owned_path(contract['debug_root'], request_path)
    request = read(request_path)
    # No caller can substitute another source/profile or choose an unbound output.
    if set(request) - {'command', 'files', 'env', 'output'}:
        raise ValueError('Debug request accepts only command, files, env and optional output')
    if not request.get('command') or not request.get('files'):
        raise ValueError('Debug request needs exact business command and test files')
    output = owned_path(contract['debug_root'], request.get('output') or
                        str(Path(contract['debug_root']) / ('attempt-' + uuid4().hex)))
    if output == Path(contract['debug_root']) or output.exists():
        raise ValueError('Debug output must be a new attempt beneath debug_root')
    env = dict(request.get('env', {}))
    settings = contract['environment']
    state = output / 'state'
    if settings.get('fresh_env_root_key'):
        env[settings['fresh_env_root_key']] = str(state)
    for key, relative in settings.get('fresh_env_paths', {}).items():
        env[key] = str(inside(state, relative))
    for key in settings.get('evidence_env_dir_keys', []):
        if env.get(key):
            owned_path(output, env[key])
    bound = {'acceptance': contract['acceptance'], 'cwd': contract['project_root'],
             'revision': contract['revision'], 'scene_id': contract['scene_id'],
             'output': str(output / 'execution'), 'files': request['files'],
             'command': request['command'], 'env': env, 'fresh_dirs': [str(state)],
             'output_env_dir_keys': settings.get('evidence_env_dir_keys', [])}
    guard(contract, [bound['output'], *bound['fresh_dirs']])
    if contract['coverage'].get('policy') == 'required':
        from run_coverage import run_coverage
        coverage = contract['coverage']
        return run_coverage({**bound, 'prepared': coverage['prepared'],
                             'inventory_path': coverage['inventory_path'],
                             'fixture_path': coverage.get('fixture_path', 'e2e/acceptance-coverage-fixture.ts')})
    command = [sys.executable, str(HERE / 'run_evidence_v2.py'), '--cwd', bound['cwd'],
               '--output', bound['output'], '--fresh-dir', str(state)]
    for name in bound['files']:
        command += ['--file', name]
    for key, value in env.items():
        command += ['--env', key + '=' + value]
    return subprocess.call([*command, '--', *bound['command']])


if __name__ == '__main__':
    if sys.argv[1:2] == ['create'] and len(sys.argv) == 5:
        print(json.dumps(create(*sys.argv[2:]), ensure_ascii=False))
    elif sys.argv[1:2] == ['run'] and len(sys.argv) == 4:
        sys.exit(run(*sys.argv[2:]))
    else:
        raise SystemExit('usage: debug_case.py create catalog input contract | run contract request')
