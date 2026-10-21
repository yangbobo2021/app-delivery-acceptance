#!/usr/bin/env python3
"""Retire an inspected evidence-stage failure without rewriting its execution."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / 'scripts')]
from acceptance_store import guard, save
from acceptance_workspace import workspace_path, workspace_lease, finish_scene, verify_frozen_workspace
from reconcile_pipeline import check_receipt
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
    receipt_path = output / 'parked-evidence-retirement.json'
    owner = load(owner_path)
    if receipt_path.is_file() and (not owner or owner.get('output_dir') != str(output)):
        return load(receipt_path)
    if not owner or owner.get('output_dir') != str(output):
        raise ValueError('parked scene does not own this workspace')
    owner_sha = digest(owner_path)
    with workspace_lease(config, output, scene=True):
        if digest(owner_path) != owner_sha:
            raise ValueError('workspace owner changed while retiring')
        if receipt_path.exists() or (output / 'summary.json').exists() or (output / 'review-input.json').exists():
            raise ValueError('scene already reached review or terminal state')
        state_path = output / 'state.json'
        state = load(state_path)
        if not state or state.get('config_sha256') != digest(config_path):
            raise ValueError('parked scene configuration changed')
        bindings = {name: digest(Path(config[name]).resolve())
                    for name in ('case_input', 'guide', 'template_catalog')}
        if state.get('bindings') != bindings:
            raise ValueError('parked scene bindings changed')
        stages = state.get('stages', {})
        if stages.get('evidence', {}).get('status') != 'parked' or any(
                item.get('status') == 'running' for item in stages.values()):
            raise ValueError('only a stopped evidence-stage failure can retire here')
        if any(stages.get(name, {}).get('status') != 'completed' for name in ('prepare', 'case', 'execution')):
            raise ValueError('case and execution must be completed before evidence retirement')
        if any(name in stages for name in ('gate', 'review')):
            raise ValueError('review stages already exist')
        catalog = load(output / 'catalog.json')
        if not catalog:
            raise ValueError('prepared scene catalog missing')
        verify_frozen_workspace(config, catalog)
        execution = Path(stages['execution']['result']['receipt']).resolve()
        check_receipt(execution, catalog)
        for runner in output.rglob('runner.pid'):
            try:
                os.kill(int(runner.read_text().strip()), 0)
            except ProcessLookupError:
                continue
            except ValueError as error:
                raise ValueError('unreadable runner pid; inspect it first') from error
            else:
                raise ValueError('a scene model runner is still live')
        record = {'schema': 'parked-evidence-retirement-v1',
                  'at': datetime.now(timezone.utc).isoformat(),
                  'scene_id': load(config['case_input'])['scene']['id'],
                  'state_path': str(state_path), 'state_sha256': digest(state_path),
                  'owner_sha256': owner_sha,
                  'execution_receipt': str(execution), 'execution_sha256': digest(execution),
                  'basis': basis.strip(), 'business_verdict': None,
                  'next_action': 'new frozen scene attempt after evidence binding and case are corrected'}
        save(receipt_path, record, exclusive=True)
        finish_scene(config, output)
        return record


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[2] != '--basis':
        raise SystemExit('usage: retire_parked_evidence.py config.json --basis inspection-reason')
    print(json.dumps(retire(sys.argv[1], sys.argv[3]), ensure_ascii=False))
