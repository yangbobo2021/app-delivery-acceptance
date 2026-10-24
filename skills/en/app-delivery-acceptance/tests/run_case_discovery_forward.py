#!/usr/bin/env python3
"""Opt-in native Agent regression; fixtures/gold stay outside model workspaces.

ACCEPTANCE_AGENT and ACCEPTANCE_MODEL must identify the caller's actual runtime.
This is deliberately not collected by unittest: every scene makes a real model call.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

SKILL = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'playbook/v4')]
from acceptance_store import initialize, read_knowledge, publish_catalog, read, save, digest, finish_acceptance
from acceptance_definitions import binding, scene_input
from acceptance_workspace import workspace_lease, finish_scene
from case_discovery_contract import validate
from case_identity import verify as verify_identity, MARKER
from existing_case_policy import verify as verify_policy


def identity_checks(answer, expected, workspace):
    """Only association identity/status; never grade semantic prose with keywords."""
    cases = answer['case_descriptions']
    associations = {a['case_id']: a for a in answer['case_discovery']['associations']}

    def matches(wanted):
        result = []
        for case in cases:
            source = case['source']
            if source['file'] != wanted['file']:
                continue
            body = '\n'.join((workspace / source['file']).read_text().splitlines()[
                source['line_start'] - 1:source['line_end']])
            token = wanted['symbol']
            if re.search(r'(?<!\w)' + re.escape(token) + r'(?!\w)', source['title'] + '\n' + body):
                result.append(case)
        return result

    errors = []
    if expected.get('no_match') and cases:
        errors.append('Expected no associated cases')
    for wanted in expected.get('required', []):
        found = matches(wanted)
        if not found:
            errors.append('Missing association: ' + wanted['file'] + '::' + wanted['symbol'])
        elif wanted.get('availability') and not any(
                associations[c['id']]['availability'] == wanted['availability'] for c in found):
            errors.append('Wrong availability: ' + wanted['symbol'])
    for group in expected.get('one_of', []):
        if not any(matches(wanted) for wanted in group):
            errors.append('Missing alternative association group')
    for unwanted in expected.get('excluded', []):
        if matches(unwanted):
            errors.append('Unexpected association: ' + unwanted['symbol'])
    return errors


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()


def run_bounded(argv, cwd, log, env, timeout):
    with log.open('w') as stream:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            return 'timeout'


def run_project(spec, gold, output, mode):
    fixture = SKILL / 'tests/fixtures/case_discovery' / spec['directory']
    root = output / spec['id']
    root.mkdir()
    for name, expected in spec['source_hashes'].items():
        source = fixture / name
        if digest(source) != expected:
            raise ValueError('Frozen fixture changed: ' + spec['id'] + '/' + name)
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, '-c', 'user.name=Finder fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '-qm', 'Frozen discovery regression source')
    at = 'AT-finder-' + spec['id']
    store = initialize(root, at, '用例查找前向验证：' + spec['id'], 'host',
                       {'purpose': 'native finder regression', 'mode': mode},
                       'Explicit forward-test invocation in isolated fixture')
    acceptance = read_knowledge(root, at, [])['acceptance']
    local = Path(store['local'])
    workspace = local / 'workspace'
    git(root, 'clone', '-q', str(root), str(workspace))
    definitions = {'schema': 'acceptance-catalog-v2', 'project': {'id': spec['id']},
        'context': {'business_goal': '按当前场景查找已有业务测试，准确说明关联与边界。'},
        'basis': 'Frozen source-only regression scenarios; expected answers remain outside the model workspace',
        'requirements': [], 'reverse_rules': [], 'scenarios': [
            {'id': s['id'], 'title': s['text'], 'description': s['text'], 'priority': 'P1',
             'priority_reason': 'Controlled association regression', 'related_refs': [],
             'origin': {'kind': 'fixture', 'reference': 'forward-test suite'}, 'external_refs': [],
             'check': {'method': 'host-authored controlled scene', 'basis': 'gold frozen before native call'}}
            for s in spec['scenarios']]}
    publish_catalog(root, at, definitions)
    config = {'acceptance': acceptance, 'definitions': binding(root, at),
              'workspace_policy': 'single-acceptance-v1', 'source_checkout': str(root)}
    catalog = {'schema': 'portable-project-catalog-v1', **config, 'project_root': str(workspace),
        'revision': git(workspace, 'rev-parse', 'HEAD'), 'components': [], 'test_roots': [],
        'source_roots': [], 'write_roots': sorted({str(Path(p).parent) for p in spec['source_hashes'] if str(Path(p).parent) != '.'}), 'coverage': {'policy': 'off'},
        'source_hashes': spec['source_hashes'], 'runner_hints': []}
    save(local / 'catalog.json', catalog)
    save(local / 'guide.json', {'summary': 'Discover test locations and commands from the project itself.',
                              'existing_test_examples': [], 'uncertainties': []})
    rows = []
    for scene in spec['scenarios']:
        folder = local / 'workflows' / scene['id']
        folder.parent.mkdir(exist_ok=True)
        value = {**config, **scene_input(config, scene['id']), 'case_strategy': 'existing_only',
                 'coverage': {'policy': 'off'}}
        if mode == 'discovery':
            value['existing_case_mode'] = 'discover_only'
        input_path = local / (scene['id'] + '-input.json')
        save(input_path, value)
        row = {'project': spec['id'], 'scene': scene['id'], 'mode': mode, 'output': str(folder),
               'semantic_review': 'required; identity checks do not judge prose or completeness'}
        env = {**os.environ, **spec.get('environment', {}), 'ACCEPTANCE_WORKSPACE_LEASE': str(folder)}
        with workspace_lease(config, folder, scene=True):
            started = time.monotonic()
            row['exit_code'] = run_bounded(['node', str(SKILL / 'playbook/v4/run_existing_case_v1.mjs'),
                str(input_path), str(local / 'catalog.json'), str(local / 'guide.json'), str(folder)],
                workspace, local / (scene['id'] + '.log'), env, 600)
            row['seconds'] = round(time.monotonic() - started, 2)
            try:
                metrics = read(folder / 'metrics.json')
                if row['exit_code'] != 0 or metrics.get('status') != 'success' or not metrics.get('discovery_validated'):
                    raise ValueError('Native finder did not return a validated result')
                canonical = read(folder / 'answer.json')
                verify_policy(catalog, read(folder / 'existing-files.json'), canonical)
                verify_identity(canonical, workspace, scene_id=scene['id'], acceptance_id=at)
                canonical = validate(canonical, value, workspace, discovery_only=mode == 'discovery')
                row['identity_errors'] = identity_checks(canonical, gold[spec['id']][scene['id']], workspace)
                row['source_unchanged'] = all(hashlib.sha256(b''.join(line for line in (workspace / p).read_bytes().splitlines(keepends=True) if not MARKER.fullmatch(line.decode('utf-8').rstrip('\r\n')))).hexdigest() == sha for p, sha in spec['source_hashes'].items())
                row['case_ids'] = [c['id'] for c in canonical['case_descriptions']]
                row['checks_passed'] = not row['identity_errors'] and row['source_unchanged']
                row['runtime'] = metrics['agent_runtime']
            except (ValueError, OSError, KeyError) as error:
                row.update(checks_passed=False, error=str(error))
            save(local / (scene['id'] + '-result.json'), row)
            finish_scene(config, folder)
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    save(Path(store['shared']) / 'finder-regression.json', {'rows': rows, 'mode': mode})
    finish_acceptance(root, at)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New absolute directory outside an existing acceptance project')
    parser.add_argument('--only', nargs='+', help='Fixture IDs; default all')
    parser.add_argument('--mode', choices=['discovery', 'debug'], default='discovery')
    args = parser.parse_args()
    if not os.environ.get('ACCEPTANCE_AGENT') or not os.environ.get('ACCEPTANCE_MODEL'):
        parser.error('Pass the calling Agent and actual model through ACCEPTANCE_AGENT and ACCEPTANCE_MODEL')
    if not args.output.is_absolute() or args.output.exists():
        parser.error('--output must be a new absolute directory; previous evidence is never overwritten')
    suite_root = SKILL / 'tests/fixtures/case_discovery'
    suite, gold = read(suite_root / 'suite.json'), read(suite_root / 'expectations.json')
    specs = [s for s in suite['projects'] if not args.only or s['id'] in args.only]
    if not specs or args.only and set(args.only) - {s['id'] for s in specs}:
        parser.error('Unknown fixture ID')
    args.output.mkdir(parents=True)
    implementation = {str(p.relative_to(SKILL)): digest(p) for p in [
        SKILL / 'playbook/v4/run_case_guided_v6.mjs', SKILL / 'playbook/v4/case_discovery_contract.py',
        SKILL / 'playbook/v4/case_identity.py', SKILL / 'playbook/v4/existing_case_policy.py',
        SKILL / 'references/case-discovery-contract.md', SKILL / 'references/case-display-contract.md',
        SKILL / 'references/case-search-guidance.md']}
    metadata = {'implementation': implementation, 'suite_sha256': digest(suite_root / 'suite.json'),
                'gold_sha256': digest(suite_root / 'expectations.json'), 'rows': []}
    save(args.output / 'results.json', metadata)
    subprocess.run([sys.executable, str(SKILL / 'scripts/ensure_runtime.py')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['node', str(SKILL / 'playbook/agent-preflight.mjs')], check=True,
                   stdout=(args.output / 'preflight.json').open('w'))
    for spec in specs:
        metadata['rows'] += run_project(spec, gold, args.output, args.mode)
        save(args.output / 'results.json', metadata)
    metadata['implementation_unchanged'] = all(digest(SKILL / p) == sha for p, sha in implementation.items())
    save(args.output / 'results.json', metadata)
    return 0 if metadata['implementation_unchanged'] and all(r['checks_passed'] for r in metadata['rows']) else 1


if __name__ == '__main__':
    sys.exit(main())
