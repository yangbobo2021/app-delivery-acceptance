#!/usr/bin/env python3
"""Close an inspected failed attempt without editing its inputs, facts or verdicts."""
import argparse
from pathlib import Path
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from acceptance_store import guard, read, save, digest
from acceptance_workspace import workspace_lease, verify_frozen_workspace, finish_scene
from reconcile_pipeline import alive


def supersede(config_path, basis):
    if not basis.strip():
        raise ValueError('actual inspection and replacement basis required')
    config_path = Path(config_path).resolve()
    config = read(config_path)
    output = Path(config['output_dir']).resolve()
    guard(config, [output])
    marker = output / 'superseded.json'
    if marker.exists():
        raise ValueError('attempt already superseded; create a new frozen attempt')
    with workspace_lease(config, output, scene=True):
        state_path = output / 'state.json'
        state = read(state_path)
        if state.get('config_sha256') != digest(config_path):
            raise ValueError('attempt input changed')
        if (output / 'summary.json').exists():
            raise ValueError('completed judgment cannot be superseded as a failed attempt')
        stages = state.get('stages', {})
        if not stages or any(x.get('status') == 'running' for x in stages.values()):
            raise ValueError('running/uncertain stage must be reconciled first')
        blocked = any(x.get('status') == 'parked' for x in stages.values())
        for path in [output / 'case/answer.json', output / 'case-repair/answer.json']:
            if path.is_file() and read(path).get('status') in {'blocked', 'needs_contract'}:
                blocked = True
        if not blocked:
            raise ValueError('only an inspected failed/blocked attempt may be superseded')
        for pid_path in output.rglob('runner.pid'):
            if alive(pid_path.read_text().strip()):
                raise ValueError('Agent runner still alive')
        for path in output.rglob('execution-intent.json'):
            if alive(read(path).get('child_pid')):
                raise ValueError('test child still alive')
        catalog_path = output / 'catalog.json'
        verify_frozen_workspace(config, read(catalog_path))
        record = {'schema': 'acceptance-superseded-attempt-v1',
                  'created_at': datetime.now(timezone.utc).isoformat(),
                  'basis': basis, 'config': str(config_path),
                  'config_sha256': digest(config_path), 'state_sha256': digest(state_path),
                  'catalog_sha256': digest(catalog_path),
                  'definitions': config.get('definitions'),
                  'disposition': 'Failed attempt retained unchanged; new bound attempt required. No product judgment created.'}
        save(marker, record, exclusive=True)
        finish_scene(config, output)
        return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('config')
    parser.add_argument('--basis', required=True)
    args = parser.parse_args()
    import json
    print(json.dumps(supersede(args.config, args.basis), ensure_ascii=False))
