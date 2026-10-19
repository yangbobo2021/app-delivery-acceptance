#!/usr/bin/env python3
"""Retire a parked case whose model never started after a knowledge handoff failure."""
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / 'scripts')]
from acceptance_store import guard, save
from acceptance_workspace import workspace_path, workspace_lease, finish_scene, verify_frozen_workspace
from scene_pipeline import digest, load


def retire(config_path, current_knowledge_receipt, basis):
    config_path = Path(config_path).resolve()
    config = load(config_path)
    if not config or config.get('schema') != 'isolated-scene-pipeline-v1':
        raise ValueError('invalid frozen scene configuration')
    if not basis.strip():
        raise ValueError('concrete inspection basis required')
    # A stale receipt cannot authorize new execution. A freshly read receipt
    # authorizes only this no-execution retirement after all effects are checked.
    current = {**config, 'acceptance': {**config['acceptance'],
               'knowledge_receipt': str(Path(current_knowledge_receipt).resolve())}}
    output = Path(config['output_dir']).resolve()
    guard(current, [output])
    owner_path = workspace_path(config).parent / 'workspace-owner.json'
    receipt_path = output / 'pre-agent-case-retirement.json'
    owner = load(owner_path)
    if receipt_path.is_file() and (not owner or owner.get('output_dir') != str(output)):
        return load(receipt_path)
    if not owner or owner.get('output_dir') != str(output):
        raise ValueError('parked scene does not own workspace')
    owner_sha = digest(owner_path)
    with workspace_lease(current, output, scene=True):
        if digest(owner_path) != owner_sha or receipt_path.exists() or (output / 'summary.json').exists():
            raise ValueError('workspace owner or terminal state changed')
        state_path = output / 'state.json'
        state = load(state_path)
        if not state or state.get('config_sha256') != digest(config_path):
            raise ValueError('frozen scene config changed')
        bindings = {name: digest(Path(config[name]).resolve())
                    for name in ('case_input', 'guide', 'template_catalog')}
        if state.get('bindings') != bindings:
            raise ValueError('frozen scene bindings changed')
        stages = state.get('stages', {})
        if (set(stages) != {'prepare', 'case'} or stages['prepare'].get('status') != 'completed' or
                stages['case'].get('status') != 'parked' or
                'knowledge changed or was not read' not in stages['case'].get('error', '')):
            raise ValueError('only a knowledge-blocked, pre-Agent case can retire here')
        allowed = {'request.frozen.json', 'catalog.json', 'state.json', 'case-stage.log'}
        if {item.name for item in output.iterdir()} - allowed:
            raise ValueError('case output has other effects; reconcile first')
        catalog = load(output / 'catalog.json')
        if not catalog:
            raise ValueError('prepared catalog missing')
        verify_frozen_workspace(config, catalog)
        record = {'schema': 'pre-agent-case-retirement-v1',
                  'at': datetime.now(timezone.utc).isoformat(),
                  'scene_id': load(config['case_input'])['scene']['id'],
                  'state_path': str(state_path), 'state_sha256': digest(state_path),
                  'owner_sha256': owner_sha, 'current_knowledge_receipt': current['acceptance']['knowledge_receipt'],
                  'error': stages['case']['error'], 'basis': basis.strip(),
                  'business_verdict': None, 'next_action': 'rebind to current project catalog and retry'}
        save(receipt_path, record, exclusive=True)
        finish_scene(current, output)
        return record


if __name__ == '__main__':
    if len(sys.argv) != 6 or sys.argv[2] != '--knowledge-receipt' or sys.argv[4] != '--basis':
        raise SystemExit('usage: retire_pre_agent_case.py config.json --knowledge-receipt current.json --basis reason')
    print(json.dumps(retire(sys.argv[1], sys.argv[3], sys.argv[5]), ensure_ascii=False))
