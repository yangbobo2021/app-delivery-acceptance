#!/usr/bin/env python3
"""Release a parked scene whose repair explicitly needs a new frozen binding.

This does not create a scene verdict, replay a command, or alter old evidence.
"""
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / 'scripts'))
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
    retirement_path = output / 'contract-rebind-retirement.json'
    prior_owner = load(owner_path)
    if retirement_path.is_file() and (not prior_owner or prior_owner.get('output_dir') != str(output)):
        return load(retirement_path)
    if not prior_owner or prior_owner.get('output_dir') != str(output):
        raise ValueError('parked scene does not own this workspace')
    owner_sha = digest(owner_path)
    with workspace_lease(config, output, scene=True):
        if digest(owner_path) != owner_sha:
            raise ValueError('workspace owner changed while retiring')
        if (output / 'summary.json').exists() or retirement_path.exists():
            raise ValueError('scene already has a terminal record')
        state_path = output / 'state.json'
        state = load(state_path)
        if not state or state.get('config_sha256') != digest(config_path):
            raise ValueError('parked scene configuration changed')
        bound = {name: digest(Path(config[name]).resolve())
                 for name in ('case_input', 'guide', 'template_catalog')}
        if state.get('bindings') != bound:
            raise ValueError('parked scene bindings changed')
        stages = state.get('stages', {})
        if any(item.get('status') == 'running' for item in stages.values()):
            raise ValueError('a scene stage is still running')
        parked = [name for name, item in stages.items() if item.get('status') == 'parked']
        if len(parked) != 1 or not parked[0].startswith('execution-review-'):
            raise ValueError('only a single pre-execution review repair can retire for rebinding')
        stage_dir = output / parked[0]
        if stage_dir.exists():
            raise ValueError('parked execution has output; reconcile its effects first')
        repair_names = sorted(name for name in stages if name.startswith('review-repair-')
                              and stages[name].get('status') == 'completed')
        if not repair_names:
            raise ValueError('no completed repair requests a new binding')
        repair = load(output / repair_names[-1] / 'answer.json')
        if not repair or repair.get('status') != 'needs_contract':
            raise ValueError('last repair did not request a new contract')
        for runner in output.rglob('runner.pid'):
            try:
                pid = int(runner.read_text().strip())
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            except ValueError as error:
                raise ValueError('unreadable runner pid; inspect it first') from error
            else:
                raise ValueError('a scene model runner is still live')
        catalog = load(output / 'catalog.json')
        if not catalog:
            raise ValueError('frozen scene catalog missing')
        verify_frozen_workspace(config, catalog)
        record = {'schema': 'contract-rebind-retirement-v1',
                  'at': datetime.now(timezone.utc).isoformat(),
                  'scene_id': load(config['case_input'])['scene']['id'],
                  'state_path': str(state_path), 'state_sha256': digest(state_path),
                  'owner_sha256': owner_sha, 'parked_stage': parked[0],
                  'repair_answer': str(output / repair_names[-1] / 'answer.json'),
                  'repair_answer_sha256': digest(output / repair_names[-1] / 'answer.json'),
                  'basis': basis.strip(), 'business_verdict': None,
                  'next_action': 'new frozen project preparation and scene attempt'}
        save(retirement_path, record, exclusive=True)
        finish_scene(config, output)
        return record


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[2] != '--basis':
        raise SystemExit('usage: retire_contract_rebind.py config.json --basis inspection-reason')
    print(json.dumps(retire(sys.argv[1], sys.argv[3]), ensure_ascii=False))
