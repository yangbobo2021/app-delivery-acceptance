#!/usr/bin/env python3
"""Continue a native runtime fixture through real preparation and case handoffs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

SKILL = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'scripts/v3'), str(SKILL / 'playbook/v4'), str(Path(__file__).parent)]
from acceptance_store import read, save, digest, read_knowledge, publish_catalog
from acceptance_definitions import binding
from change_inventory import build as inventory
from run import invoke


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--step', choices=['coverage', 'bind', 'pipeline'], required=True)
    p.add_argument('--attempt', required=True)
    p.add_argument('--coverage-config', type=Path)
    p.add_argument('--prior-attempt', type=Path, action='append', default=[])
    args = p.parse_args()
    root = args.root.resolve(); aid = read(root / '.acceptance-local/current.json')['acceptance_id']
    local = root / '.acceptance-local' / aid; flows = local / 'workflows'
    acceptance = read_knowledge(root, aid, [])['acceptance']
    catalog_path = flows / 'catalog/catalog.json'; catalog = read(catalog_path)
    workspace = Path(catalog['project_root'])
    inputs = flows / ('inputs-' + args.step + '-' + args.attempt)
    inputs.mkdir()
    result = {'schema': 'agent-quality-continuation-v1', 'step': args.step, 'root': str(root),
              'attempt': args.attempt, 'semantic_review': 'requires actual artifact reading'}
    if args.step == 'coverage':
        scope = inventory({'project_root': str(workspace), 'base_revision': catalog['revision'],
            'head_revision': catalog['revision'], 'pr_requirement_ids': [], 'test_modes': ['BLACK_BOX'],
            'requirements': {'items': []}, 'source_paths': list(catalog['source_hashes'])})
        save(inputs / 'inventory.json', scope)
        request = {'schema': 'project-coverage-agent-request-v1', 'acceptance': acceptance,
            'runtime_manifest': catalog['runtime']['manifest'], 'runtime_sha256': catalog['runtime']['sha256'],
            'source_hashes': catalog['source_hashes'], 'test_roots': catalog['test_roots'],
            'inventory_path': str(inputs / 'inventory.json'), 'inventory_sha256': digest(inputs / 'inventory.json'),
            'registry_path': str(inputs / 'coverage-index.json'),
            'expected_measured_sources': list(catalog['source_hashes']),
            'prior_attempts': [str(path.resolve()) for path in args.prior_attempt]}
        save(inputs / 'request.json', request)
        output = flows / ('coverage-' + args.attempt)
        result['agent'] = invoke(['node', str(SKILL / 'playbook/v4/run_coverage_preparation.mjs'),
            str(inputs / 'request.json'), str(output)], root, inputs / 'agent.log', timeout=1200)
        result['handoff'] = str(output / 'handoff.json')
        if (output / 'metrics.json').exists(): result['metrics'] = read(output / 'metrics.json')
    else:
        previous = read(root / '.acceptance' / aid / 'scenarios.json')
        if not previous['scenarios']:
            previous['scenarios'] = [{'id': 'SC1', 'requirement_id': 'R1', 'title': '当前需求的实际验证',
                'description': previous['requirements'][0]['text'], 'priority': 'P1',
                'priority_reason': '核对冻结的预留业务合同。', 'related_refs': [], 'external_refs': [],
                'origin': {'kind': 'user', 'reference': 'controlled native workflow test'},
                'check': {'method': 'adopted user scene', 'basis': 'Exact frozen requirement text'}}]
            # Publish a complete candidate, never mutate the immutable record.
            previous = {k: previous[k] for k in ['schema', 'project', 'context', 'requirements', 'reverse_rules', 'scenarios']}
            previous['basis'] = 'Adopt the user scene for the controlled native chain'
            publish_catalog(root, aid, previous)
        selected_catalog = catalog_path
        coverage = {'policy': 'off'}
        if args.coverage_config:
            coverage = read(args.coverage_config)
            prepared = read(Path(coverage['prepared']) / 'prepared.json')
            spec = read(flows / 'prep-spec.json')
            spec.update(acceptance=acceptance, definitions=binding(root, aid), coverage=coverage,
                        coverage_test_files=list(prepared['adapter_files']))
            save(inputs / 'prep-spec.json', spec)
            selected_catalog = inputs / 'catalog/catalog.json'
            result['catalog'] = invoke([sys.executable, str(SKILL / 'playbook/v4/prepare_project.py'),
                str(inputs / 'prep-spec.json'), str(inputs / 'catalog')], root, inputs / 'catalog.log')
            if result['catalog']['exit_code'] != 0:
                save(inputs / 'result.json', result); print(json.dumps(result, ensure_ascii=False)); return 1
        template = {'acceptance': acceptance, 'definitions': binding(root, aid), 'scene_id': 'SC1',
            'source_checkout': str(workspace), 'template_catalog': str(selected_catalog),
            'guide': str(flows / 'guide/guide.json'), 'case_run_dir': str(flows / ('case-flow-' + args.attempt)),
            'allowed_test_roots': catalog['test_roots'], 'case_strategy': 'implement', 'case_evaluation': True,
            'coverage': coverage, 'local_loopback_required': True,
            'resume_safe_after_local_loopback': True, 'max_review_repairs': 2,
            'scope_note': 'Controlled single-scene Agent verification; no claim of whole-project acceptance.'}
        save(inputs / 'template.json', template)
        handoff = inputs / 'handoff'
        result['binding'] = invoke([sys.executable, str(SKILL / 'playbook/v4/bind_case.py'),
            str(inputs / 'template.json'), str(handoff)], root, inputs / 'binding.log')
        if args.step == 'pipeline' and result['binding']['exit_code'] == 0:
            result['pipeline'] = invoke([sys.executable, str(SKILL / 'playbook/v4/scene_pipeline.py'),
                str(handoff / 'config.json')], root, inputs / 'pipeline.log', timeout=1800)
            summary = flows / ('case-flow-' + args.attempt) / 'summary.json'
            result['summary'] = str(summary)
            if summary.exists(): result['conclusion'] = read(summary)
    save(inputs / 'result.json', result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    steps = [value for value in result.values() if isinstance(value, dict) and 'exit_code' in value]
    return 0 if all(value['exit_code'] == 0 for value in steps) else 1


if __name__ == '__main__':
    sys.exit(main())
