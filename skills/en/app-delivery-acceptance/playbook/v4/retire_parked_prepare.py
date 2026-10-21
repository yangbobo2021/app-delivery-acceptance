#!/usr/bin/env python3
"""Retire an inspected preparation failure before any scene stage has begun."""
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / 'scripts')]
from acceptance_store import guard, save
from acceptance_workspace import workspace_path, workspace_lease, finish_scene, verify_frozen_workspace
from scene_pipeline import digest, load


def retire(config_path, basis):
    config_path = Path(config_path).resolve()
    config = load(config_path)
    if not config or config.get('schema') != 'isolated-scene-pipeline-v1':
        raise ValueError('invalid frozen scene configuration')
    if not isinstance(basis, str) or not basis.strip():
        raise ValueError('retirement requires a concrete inspection basis')
    output = Path(config['output_dir']).resolve()
    guard(config, [output])
    owner_path = workspace_path(config).parent / 'workspace-owner.json'
    receipt_path = output / 'prepare-retirement.json'
    owner = load(owner_path)
    if receipt_path.is_file() and (not owner or owner.get('output_dir') != str(output)):
        return load(receipt_path)
    if not owner or owner.get('output_dir') != str(output):
        raise ValueError('parked scene does not own this workspace')
    owner_sha = digest(owner_path)
    with workspace_lease(config, output, scene=True):
        if digest(owner_path) != owner_sha:
            raise ValueError('workspace owner changed while retiring')
        if receipt_path.exists() or (output / 'summary.json').exists() or (output / 'catalog.json').exists():
            raise ValueError('prepare already has a terminal or catalog record')
        state_path = output / 'state.json'
        state = load(state_path)
        if not state or state.get('config_sha256') != digest(config_path):
            raise ValueError('parked scene configuration changed')
        bindings = {name: digest(Path(config[name]).resolve())
                    for name in ('case_input', 'guide', 'template_catalog')}
        if state.get('bindings') != bindings:
            raise ValueError('parked scene bindings changed')
        stages = state.get('stages', {})
        if set(stages) != {'prepare'} or stages['prepare'].get('status') != 'parked':
            raise ValueError('only a prepare-only parked scene can retire here')
        if not stages['prepare'].get('error'):
            raise ValueError('parked preparation error missing')
        allowed = {'request.frozen.json', 'state.json'}
        if {p.name for p in output.iterdir()} - allowed:
            raise ValueError('prepare output has other effects; reconcile them first')
        for runner in output.rglob('runner.pid'):
            try:
                os.kill(int(runner.read_text().strip()), 0)
            except ProcessLookupError:
                continue
            except ValueError as error:
                raise ValueError('unreadable runner pid; inspect it first') from error
            else:
                raise ValueError('a scene model runner is still live')
        catalog = load(config['template_catalog'])
        if not catalog or catalog.get('schema') != 'portable-project-catalog-v1':
            raise ValueError('frozen project catalog missing')
        verify_frozen_workspace(config, catalog)
        record = {'schema': 'parked-prepare-retirement-v1',
                  'at': datetime.now(timezone.utc).isoformat(),
                  'scene_id': load(config['case_input'])['scene']['id'],
                  'state_path': str(state_path), 'state_sha256': digest(state_path),
                  'owner_sha256': owner_sha, 'error': stages['prepare']['error'],
                  'basis': basis.strip(), 'business_verdict': None,
                  'next_action': 'new frozen scene attempt after project preparation is corrected'}
        save(receipt_path, record, exclusive=True)
        finish_scene(config, output)
        return record


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[2] != '--basis':
        raise SystemExit('usage: retire_parked_prepare.py config.json --basis inspection-reason')
    print(json.dumps(retire(sys.argv[1], sys.argv[3]), ensure_ascii=False))
