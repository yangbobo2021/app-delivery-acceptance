#!/usr/bin/env python3
"""Independent native reverse/evaluation fixtures; no intended answer in workspace."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import shutil
import sys

SKILL = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'playbook/v4'), str(SKILL / 'tests'), str(Path(__file__).parent)]
from acceptance_store import initialize, read_knowledge, publish_catalog, save, read, digest, finish_acceptance
from acceptance_definitions import binding, scene_input
from acceptance_workspace import workspace_lease, finish_scene
from case_evaluation_contract import validate as validate_evaluation
from run_case_discovery_forward import git
from run import invoke

JOBS = [
    {'id': 'E01', 'stage': 'evaluation', 'fixture': 'javascript-web',
     'scene': '注销时删除服务端会话，返回204，并请求清除名为sid的Cookie。'},
    {'id': 'E02', 'stage': 'evaluation', 'fixture': 'javascript-web',
     'scene': '用户在浏览器点击注销后，服务端会话失效，浏览器中的sid Cookie被清除，随后访问受保护页面需要重新登录。'},
    {'id': 'E03', 'stage': 'evaluation', 'fixture': 'python-ledger',
     'scene': '余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。'},
    {'id': 'E04', 'stage': 'evaluation', 'fixture': 'weak-library',
     'scene': '余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。'},
    {'id': 'B01', 'stage': 'reverse', 'fixture': 'controlled-pricing'},
]


def write_files(root, files):
    for name, text in files.items():
        p = root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)


def commit(root, title):
    git(root, 'add', '.')
    git(root, '-c', 'user.name=Native fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', title)
    return git(root, 'rev-parse', 'HEAD')


def run_job(spec, output):
    root = output / spec['id']; root.mkdir()
    stage = spec['stage']
    if stage == 'evaluation':
        shutil.copytree(SKILL / 'tests/fixtures/case_discovery' / spec['fixture'], root, dirs_exist_ok=True)
    else:
        write_files(root, {'pricing.py': 'def total(amount):\n    return amount + 2\n',
            'api.py': 'from pricing import total\ndef invoice(amount):\n    return {"amount": total(amount)}\n',
            'contract.md': '账单总额应等于有效输入金额加2；金额文本没有额外格式要求。\n'})
    git(root, 'init', '-q'); base = commit(root, 'Original project')
    if stage == 'reverse':
        write_files(root, {'pricing.py': 'def total(amount):\n    return amount + 3\n',
            'api.py': 'from pricing import total\ndef invoice(amount):\n    value = total(amount)\n    return {"amount": value, "display": f"{value:07.2f}"}\n',
            'contract.md': '账单总额应等于有效输入金额加3；金额文本必须使用七位、两位小数格式。\n'})
        commit(root, 'Change pricing and presentation')
    at = 'AT-quality-' + spec['id']
    initialize(root, at, '独立 Agent 产物验证', 'host', {'purpose': 'controlled native role verification'},
               'User-authorized portability and quality evaluation')
    acceptance = read_knowledge(root, at, [])['acceptance']
    local = root / '.acceptance-local' / at; flows = local / 'workflows'; flows.mkdir()
    scene = spec.get('scene', '账单总额应等于有效输入金额加2；金额文本没有额外格式要求。')
    req = {'id': 'R1', 'text': scene, 'title': '当前用户约定',
           'origin': {'kind': 'user', 'reference': 'frozen controlled requirement'}, 'external_refs': []}
    publish_catalog(root, at, {'schema': 'acceptance-catalog-v2', 'project': {'id': spec['id']},
        'context': {'business_goal': '按当前冻结约定进行验证，不扩展范围。'}, 'basis': 'User controlled contract',
        'requirements': [req], 'reverse_rules': [], 'scenarios': [] if stage == 'reverse' else [{
            'id': 'SC1', 'requirement_id': 'R1', 'title': scene, 'description': scene,
            'priority': 'P1', 'priority_reason': '验证明确约定。', 'related_refs': [],
            'origin': {'kind': 'user', 'reference': 'controlled case evaluation request'}, 'external_refs': [],
            'check': {'method': 'adopted scene', 'basis': 'Exact user text'}}]})
    context = {'acceptance': acceptance, 'definitions': binding(root, at)}
    row = {'id': spec['id'], 'stage': stage, 'root': str(root), 'semantic_review': 'pending source and input review'}
    target = flows / 'attempt-1'
    if stage == 'reverse':
        request = {**context, 'project_root': str(root), 'base_revision': base,
            'head_revision': git(root, 'rev-parse', 'HEAD'),
            'requirements': {'version': '1', 'shared_constraints': '', 'items': [req]},
            'analysis': {'business_goal': '保持账单约定正确。',
                         'confirmed_scope': {'included_requirement_ids': ['R1'], 'exclusions': [], 'limitations': []},
                         'requirement_groups': []}, 'contract_files': ['contract.md'], 'existing_rules': [],
            'pr_requirement_ids': ['R1'], 'test_modes': ['BLACK_BOX', 'WHITE_BOX'],
            'source_paths': ['pricing.py', 'api.py'], 'test_paths': [], 'noncode_paths': ['contract.md']}
        save(flows / 'request.json', request)
        row.update(invoke(['node', str(SKILL / 'playbook/v3/reverse/run.mjs'), str(flows / 'request.json'), str(target)],
                         root, flows / 'stage.log'))
        row['artifact'] = str(target / 'result.json')
    else:
        workspace = local / 'workspace'; git(root, 'clone', '-q', str(root), str(workspace))
        if spec['fixture'] == 'javascript-web':
            refs = [('spec/session.test.mjs', 'drops the entry', 5, 10),
                    ('spec/session.test.mjs', 'expires the browser token', 12, 16)]
        else:
            path = workspace / 'checks/test_accounts.py'; lines = path.read_text().splitlines()
            refs = []
            for title in ['test_examples', 'test_declined', 'test_declined_smoke']:
                start = next(i for i, line in enumerate(lines, 1) if 'def ' + title + '(' in line)
                end = start
                while end < len(lines) and lines[end].strip() and not lines[end].lstrip().startswith(('def ', '@')):
                    end += 1
                refs.append(('checks/test_accounts.py', title, start, end))
        catalog = {'schema': 'portable-project-catalog-v1', **context, 'project_root': str(workspace),
            'source_checkout': str(root), 'revision': git(workspace, 'rev-parse', 'HEAD'),
            'workspace_policy': 'single-acceptance-v1', 'components': [], 'test_roots': [], 'write_roots': [],
            'coverage': {'policy': 'off'}}
        case_input = {**context, **scene_input(context, 'SC1'), 'coverage': {'policy': 'off'}}
        answer = {'status': 'not_executed', 'test_files': sorted({r[0] for r in refs}), 'test_command': [],
            'test_env': {}, 'observations': [], 'evidence_paths': [], 'limitations': ['候选列表尚未执行。'],
            'case_descriptions': [{'id': 'prepared-' + str(i), 'name': title, 'method': '待核对的已有测试。',
                'assertions': '待评估实际支持范围。', 'boundary': '尚未执行，依据源码进行评估。',
                'source': {'origin': 'existing', 'file': file, 'title': title, 'line_start': start, 'line_end': end}}
                for i, (file, title, start, end) in enumerate(refs, 1)]}
        save(flows / 'catalog.json', catalog); save(flows / 'input.json', case_input); save(flows / 'cases.json', answer)
        before = git(workspace, 'status', '--porcelain', '--untracked-files=all')
        with workspace_lease(catalog, target, scene=True):
            old = os.environ.get('ACCEPTANCE_WORKSPACE_LEASE'); os.environ['ACCEPTANCE_WORKSPACE_LEASE'] = str(target)
            try:
                row.update(invoke(['node', str(SKILL / 'playbook/v4/run_case_evaluation_v1.mjs'),
                    str(flows / 'input.json'), str(flows / 'catalog.json'), str(flows / 'cases.json'), str(target)],
                    workspace, flows / 'stage.log'))
                if (target / 'answer.json').exists():
                    checked = validate_evaluation(read(target / 'answer.json'), case_input, answer, workspace, require_target_checks=True)
                    save(flows / 'validated-description.json', checked); row['citations_valid'] = True
                row['source_unchanged'] = before == git(workspace, 'status', '--porcelain', '--untracked-files=all')
                finish_scene(catalog, target)
            finally:
                if old is None: os.environ.pop('ACCEPTANCE_WORKSPACE_LEASE', None)
                else: os.environ['ACCEPTANCE_WORKSPACE_LEASE'] = old
        row['artifact'] = str(target / 'answer.json')
    row['structurally_completed'] = row['exit_code'] == 0 and Path(row['artifact']).exists()
    save(local / 'role-probe.json', row); finish_acceptance(root, at)
    print(json.dumps(row, ensure_ascii=False), flush=True)
    return row


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--only', nargs='+'); p.add_argument('--workers', type=int, default=1); args = p.parse_args()
    if not os.environ.get('ACCEPTANCE_AGENT') or not os.environ.get('ACCEPTANCE_MODEL'):
        p.error('Explicit actual caller Agent/model required')
    if not args.output.is_absolute() or args.output.exists(): p.error('Use a new absolute output directory')
    specs = [x for x in JOBS if not args.only or x['id'] in args.only]
    if not specs or args.only and set(args.only) - {x['id'] for x in specs}: p.error('Unknown probe')
    if args.workers != 1 and any(x['stage'] == 'evaluation' for x in specs):
        p.error('Evaluation leases are process-wide; run separate processes for concurrency')
    args.output.mkdir(parents=True); rows = []
    for spec in specs:
        try: rows.append(run_job(spec, args.output))
        except Exception as error:
            rows.append({'id': spec['id'], 'stage': spec['stage'], 'harness_or_contract_error': str(error)})
        save(args.output / 'results.json', {'schema': 'native-role-probes-v1', 'rows': rows})
    return 0 if all(x.get('structurally_completed') for x in rows) else 1


if __name__ == '__main__': sys.exit(main())
