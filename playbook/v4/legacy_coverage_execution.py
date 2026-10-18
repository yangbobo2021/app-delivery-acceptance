#!/usr/bin/env python3
"""One reusable, evidence-bound coverage execution entry; never runs a reviewer.

The registered provider creates units and metrics. This host only installs an
isolated test build, invokes the ordinary evidence executor, freezes output and
restores the original source bytes. It refuses to repeat an existing execution.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
PROVIDER = HERE.parents[1] / 'scripts' / 'coverage-istanbul'
sys.path.insert(0, str(HERE.parents[1] / 'scripts'))


def execution_binding(request, active):
    """Enforce an activated acceptance before any mkdir, tool invocation or source write."""
    from acceptance_store import guard, inside, locations, owned_path
    binding = active.get('acceptance') or request.get('acceptance')
    if not binding:
        # Standalone synthetic toolchain probes retain their non-acceptance API.
        # An acceptance checkout may never use that API to escape its store.
        if '.acceptance-local' in Path(request['cwd']).absolute().parts:
            raise ValueError('Acceptance execution requires a bound catalog; prepare/rebind before running')
        return
    if request.get('acceptance') and request['acceptance'] != binding:
        raise ValueError('Coverage request belongs to another acceptance')
    config = {'acceptance': binding, 'source_checkout': request['cwd']}
    guard(config, [request['output'], *request.get('fresh_dirs', [])])
    _, _, local = locations(binding['project_root'], binding['id'])
    if Path(request['cwd']).resolve() != inside(local, 'workspace'):
        raise ValueError('Coverage must use this acceptance workspace')
    # Explicit output env keys are project input; do not infer semantics from names.
    for key in request.get('output_env_dir_keys', []):
        if request.get('env', {}).get(key):
            owned_path(local / 'workflows', request['env'][key])


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def run_coverage(request):
    root = Path(request['cwd']).resolve()
    out = Path(request['output']).resolve()
    prepared = Path(request['prepared']).resolve()
    from coverage_registry import ensure_active, register, project_coverage
    active = project_coverage(root, {'policy':'required','provider':'istanbul-source-v1','prepared':str(prepared)}) or {}
    execution_binding(request, active)
    if (out / 'execution.json').exists() or (out / 'execution-intent.json').exists():
        raise ValueError('Existing execution; use a new explicit attempt, never silently replay')
    if not request.get('scene_id') or not request.get('command'):
        raise ValueError('Coverage needs an exact scene and command binding')
    subprocess.run(['node', str(PROVIDER / 'provider.mjs'), 'verify-preparation', str(prepared)], check=True)
    p = read(prepared / 'prepared.json')
    if not p['spec'].get('registry_path') or not p['spec'].get('inventory_path'):
        raise ValueError('Continuous coverage requires the prepared project registry and inventory')
    ensure_active(prepared)
    frozen_inventory=p['spec']['inventory_path']
    if request.get('inventory_path') and sha(request['inventory_path'])!=sha(frozen_inventory):
        raise ValueError('Scene coverage scope differs from the frozen project inventory')
    if request.get('revision') and subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip() != request['revision']:
        raise ValueError('Product revision changed')
    for name, expected in p['spec']['source_hashes'].items():
        if sha(root / name) != expected:
            raise ValueError('Original product source changed: ' + name)
    original_tests = {}
    modified_tests = {}
    from acceptance_store import inside
    required = active.get('required_test_files', {})
    for name, expected in required.items():
        file = inside(root, name)
        if not file.is_file() or sha(file) != expected:
            raise ValueError('Project coverage fixture changed; prepare a new catalog: ' + name)
    files = list(dict.fromkeys([*request['files'], *required]))
    for name in files:
        if not inside(root, name).is_file():
            raise ValueError('Test file missing: ' + name)
    out.mkdir(parents=True, exist_ok=True)
    raw = out / 'coverage-raw'
    raw.mkdir(exist_ok=False)
    runtime = out / 'coverage-runtime'
    runtime.mkdir()
    for name in ['node-hook.cjs', 'playwright-fixture.ts', 'preload-footer.cjs']:
        shutil.copy2(PROVIDER / name, runtime / name)
    # The fixture resides inside the project so Playwright resolves its own version.
    fixture_relative = request.get('fixture_path', 'e2e/acceptance-coverage-fixture.ts')
    fixture = root / fixture_relative
    if not fixture.resolve().is_relative_to(root):
        raise ValueError('Coverage fixture must remain inside the isolated project')
    fixture.parent.mkdir(parents=True, exist_ok=True)
    if fixture.exists():
        raise ValueError('Coverage fixture destination exists')
    shutil.copy2(runtime / 'playwright-fixture.ts', fixture)
    completed=False
    try:
        for name in files:
            if not name.endswith(('.ts','.tsx','.js','.mjs','.cjs')):
                continue
            path = root / name
            before = path.read_bytes()
            relative = os.path.relpath(fixture, path.parent).replace(os.sep,'/')
            if not relative.startswith('.'):
                relative = './' + relative
            after = re.sub(r"(from\s*)['\"](?:@playwright/test|playwright(?:-core)?|\./coverage-replay-fixture)['\"]",
                           lambda m: m[1] + repr(relative), before.decode()).encode()
            if before != after:
                original_tests[name] = before
                path.write_bytes(after)
                modified_tests[name] = {'original_sha256': hashlib.sha256(before).hexdigest(), 'adapter_sha256': sha(path)}
        for name in p['files']:
            shutil.copy2(prepared / 'instrumented' / name, root / name)
        files = list(dict.fromkeys([*files, fixture_relative, *p['files']]))
        env = dict(request.get('env', {}))
        env['ACCEPTANCE_ISTANBUL_OUTPUT'] = str(raw)
        env['ACCEPTANCE_ISTANBUL_HOOK'] = str(runtime / 'node-hook.cjs')
        # Replace only the superseded coverage hook; preserve other runtime options.
        prior = env.get('NODE_OPTIONS', '')
        prior = re.sub(r'--require=\S*coverage-replay-source-hook\.cjs', '', prior).strip()
        env['NODE_OPTIONS'] = (prior + ' --require=' + str(runtime / 'node-hook.cjs')).strip()
        save(out / 'coverage-request.json', request)
        save(out / 'coverage-build.json', {'schema':'isolated-instrumented-build-v1',
             'fixture_path':fixture_relative,
             'execution_host_sha256':sha(Path(__file__)),
             'business_command_binding':request.get('business_command_binding'),
             'prepared':str(prepared), 'prepared_sha256':sha(prepared / 'prepared.json'),
             'product_files':p['files'], 'test_import_adapters':modified_tests,
             'runtime_files':{n:sha(runtime / n) for n in ['node-hook.cjs','playwright-fixture.ts','preload-footer.cjs']}})
        command = ['python3', str(HERE / 'run_evidence_v2.py'), '--cwd', str(root), '--output', str(out / 'command'), '--coverage-build', str(out / 'coverage-build.json')]
        for name in files:
            command += ['--file', name]
        for fresh in request.get('fresh_dirs', []):
            command += ['--fresh-dir', fresh]
        for key, value in env.items():
            command += ['--env', key + '=' + value]
        command += ['--', *request['command']]
        # Ordinary execution produces receipts even when assertions fail.
        with (out / 'host.log').open('wb') as log:
            execution = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        receipt_path = out / 'command' / 'execution.json'
        if not receipt_path.exists():
            raise RuntimeError('Execution did not produce a receipt; inspect host.log')
        receipt = read(receipt_path)
        receipt['coverage_scene_id'] = request['scene_id']
        receipt['coverage_build_sha256'] = sha(out / 'coverage-build.json')
        receipt['original_source_sha256'] = p['spec']['source_hashes']
        # Keep the executor's frozen receipt intact; the coverage receipt adds bindings.
        receipt['executor_receipt_path'] = str(receipt_path)
        receipt['executor_receipt_sha256'] = sha(receipt_path)
        save(out / 'execution.json', receipt)
        shutil.copy2(out / 'command' / 'execution.log', out / 'execution.log')
        from coverage_collection_check import check_collection
        save(out / 'collection-check.json', check_collection((out / 'execution.log').read_text(errors='replace'), sha(out / 'execution.json')))
        for name, binding in p['files'].items():
            if sha(root / name) != binding['instrumented_sha256']:
                raise RuntimeError('Instrumented product changed during execution: ' + name)
        subprocess.run(['node', str(PROVIDER / 'provider.mjs'), 'finish', str(prepared), str(raw),
                        str(out / 'execution.json'), str(out), frozen_inventory], check=True)
        # Review is a separate workflow stage. A reusable collection entry cannot
        # assume that every caller waived it. Bind neutral workflow metadata
        # before verification/freezing; leave all tool-owned coverage data intact.
        report_path = out / 'coverage-report.json'
        report = read(report_path)
        report['review_note'] = '覆盖率只反映本次执行；验收结论及独立复审状态见场景记录。'
        report['review_note_source'] = 'execution-host'
        save(report_path, report)
        subprocess.run(['node', str(PROVIDER / 'provider.mjs'), 'verify', str(out / 'coverage-report.json')], check=True)
        completed=True
        return execution.returncode
    finally:
        for name in p['files']:
            shutil.copy2(prepared / 'original' / name, root / name)
        for name, before in original_tests.items():
            (root / name).write_bytes(before)
        fixture.unlink(missing_ok=True)
        restored={name:sha(root / name) for name in p['spec']['source_hashes']}
        save(out / 'restored-source.json', restored)
        if restored!=p['spec']['source_hashes']:
            raise ValueError('Original source restoration failed or an unsupported source was modified')
        if completed:
            register(out / 'coverage-report.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('request')
    args = parser.parse_args()
    sys.exit(run_coverage(read(args.request)))
