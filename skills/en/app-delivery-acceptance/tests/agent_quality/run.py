#!/usr/bin/env python3
"""Native stage probes. Expectations and review notes stay outside model projects."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

SKILL = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'playbook/v4'), str(SKILL / 'tests')]
from acceptance_store import initialize, read_knowledge, publish_catalog, save, read, digest, finish_acceptance
from acceptance_definitions import binding
from run_case_discovery_forward import git, run_bounded

STOCK = '库存足够时预留指定数量，返回并保存剩余库存，其他商品库存保持不变；库存不足时拒绝预留，整个库存文件保持不变。'
RETRY = '同一服务进程内，同一请求标识重试预留时返回相同回执且只扣减一次库存；不同请求分别生成回执并独立扣减库存。'
CONFIG = '命令行参数、环境变量和配置文件都指定目录时使用命令行参数；未传参数时使用环境变量；两者都未指定时使用配置文件。读取配置不得修改原文件。'
WEB = '用户可以在页面新增待办事项，成功后能看到新事项；标题为空时不创建事项并显示可理解的原因，原有事项保持不变。'
EXPORT = '导出金额的数值必须保持正确。允许金额文本有前导零，允许保留或去除末尾小数零。目标路径不可写时明确报告失败，不能覆盖其他文件。'

JOBS = [
    {'id': 'Q01', 'stage': 'analysis', 'fixture': 'parcel-cli', 'requirements': [STOCK, RETRY, EXPORT]},
    {'id': 'Q02', 'stage': 'analysis-edit', 'fixture': 'node-service', 'requirements': [STOCK, RETRY]},
    {'id': 'Q03', 'stage': 'scenarios', 'fixture': 'parcel-cli', 'requirements': [CONFIG, EXPORT]},
    {'id': 'Q04', 'stage': 'scenarios', 'fixture': 'node-service', 'requirements': [WEB, RETRY]},
    {'id': 'Q05', 'stage': 'scenarios', 'fixture': 'parcel-cli', 'requirements': [EXPORT, STOCK]},
    {'id': 'Q06', 'stage': 'runtime', 'fixture': 'parcel-cli', 'requirements': [STOCK]},
    {'id': 'Q07', 'stage': 'runtime', 'fixture': 'node-service', 'requirements': [RETRY]},
    {'id': 'Q08', 'stage': 'scenarios', 'fixture': 'parcel-cli', 'requirements': [
        '桌面应用的导入向导允许用户选择文件并确认导入；导入成功后关闭向导，在主列表显示导入结果。取消导入时返回主列表，原文件保持不变。', STOCK]},
    {'id': 'Q09', 'stage': 'runtime', 'fixture': 'parcel-cli', 'requirements': [STOCK], 'product_variant': 'rejection-writes'},
]


def resources(fixture):
    if fixture == 'parcel-cli':
        return {'sources': ['parcel/__init__.py', 'parcel/__main__.py', 'parcel/store.py'], 'tests': ['tests']}
    return {'sources': ['server.mjs'], 'tests': ['spec']}


def project(spec, output):
    root = output / spec['id']
    shutil.copytree(Path(__file__).parent / 'projects' / spec['fixture'], root,
                    ignore=shutil.ignore_patterns('node_modules', '__pycache__', '.coverage*'))
    if spec.get('product_variant') == 'rejection-writes':
        path = root / 'parcel/store.py'
        before = '    if inventory[sku] < quantity:\n        raise InsufficientStock(sku)'
        after = '    if inventory[sku] < quantity:\n        inventory[sku] = 0\n        path.write_text(json.dumps(inventory))\n        raise InsufficientStock(sku)'
        text = path.read_text(); assert text.count(before) == 1
        path.write_text(text.replace(before, after))
    git(root, 'init', '-q'); git(root, 'add', '.')
    git(root, '-c', 'user.name=Quality fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Project baseline')
    at = 'AT-quality-' + spec['id']
    initialize(root, at, 'Agent 跨环境质量验证', 'host', {'purpose': 'isolated native stage verification'},
               'User-authorized Agent portability testing')
    acceptance = read_knowledge(root, at, [])['acceptance']
    local = root / '.acceptance-local' / at
    flows = local / 'workflows'; flows.mkdir()
    reqs = [{'id': 'R' + str(i + 1), 'text': text, 'title': '需求' + str(i + 1),
             'origin': {'kind': 'user', 'reference': 'controlled acceptance request'}, 'external_refs': []}
            for i, text in enumerate(spec['requirements'])]
    publish_catalog(root, at, {'schema': 'acceptance-catalog-v2', 'project': {'id': spec['id']},
        'context': {'business_goal': '完成当前确认需求的验证，不扩大范围。'},
        'basis': 'Frozen controlled requirements', 'requirements': reqs, 'reverse_rules': [], 'scenarios': []})
    context = {'acceptance': acceptance, 'definitions': binding(root, at), 'project_root': str(root),
               'source_checkout': str(root), 'revision': git(root, 'rev-parse', 'HEAD')}
    return root, at, local, flows, reqs, context


def invoke(argv, root, log, timeout=600):
    start = time.monotonic()
    code = run_bounded(argv, root, log, {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, timeout)
    return {'exit_code': code, 'seconds': round(time.monotonic() - start, 2), 'log': str(log)}


def run_job(spec, output):
    row = {'id': spec['id'], 'stage': spec['stage'], 'fixture': spec['fixture'],
           'semantic_review': 'pending independent reading; execution success is not quality approval'}
    try:
        root, at, local, flows, reqs, context = project(spec, output)
        request = {**context, 'mode': 'create', 'requirements': {'version': '1', 'shared_constraints': '', 'items': reqs},
                   'user_constraints': [{'id': 'U1', 'description': '本轮不验证真实第三方账号接入。',
                                         'source_quote': '本轮不验证真实第三方账号接入。'}]}
        target = flows / 'attempt-1'; path = flows / 'request.json'
        stage = spec['stage']
        if stage.startswith('analysis'):
            if stage == 'analysis-edit':
                request.update(mode='edit', allowed_changes=['confirmed_scope'], allowed_scope_changes=['exclusions'],
                    previous_analysis={'version': 1, 'business_goal': '保证库存预留和重试结果可靠。',
                        'confirmed_scope': {'included_requirement_ids': ['R1', 'R2'],
                            'exclusions': ['不验证真实第三方账号接入。', '不执行任何用例。'], 'limitations': []},
                        'requirement_groups': [{'id': 'G1', 'title': '预留与重试', 'requirement_ids': ['R1', 'R2'],
                                                'reason': '重试不能重复改变库存。'}], 'change_summary': ['原分析。']},
                    feedback={'source': 'agent', 'text': '旧排除中的不执行任何用例仅为分析阶段限制，没有用户范围依据；请移除。建议也将第三方账号排除去掉以扩大验证。'})
            save(path, request)
            row.update(invoke(['node', str(SKILL / 'playbook/v3/preanalysis/run.mjs'), request['mode'], str(path), str(target)], root, flows / 'stage.log'))
            row['artifact'] = str(target / 'analysis.json')
        elif stage == 'scenarios':
            request.update(target_requirement_id='R1', scenario_kind='BLACK_BOX',
                analysis={'business_goal': '可靠完成当前目标需求。',
                          'confirmed_scope': {'included_requirement_ids': [r['id'] for r in reqs], 'exclusions': [], 'limitations': []},
                          'requirement_groups': [{'id': 'G1', 'title': '上下文', 'requirement_ids': [r['id'] for r in reqs],
                                                  'reason': '仅提供相关约定上下文，场景仍只属于主目标。'}]})
            save(path, request)
            row.update(invoke(['node', str(SKILL / 'playbook/v4/run_scenarios.mjs'), str(path), str(target)], root, flows / 'stage.log'))
            row['artifact'] = str(target / 'scenarios.current.json')
        elif stage == 'runtime':
            request = {'schema': 'project-runtime-agent-request-v1', 'acceptance': context['acceptance'],
                       'source_checkout': str(root), 'revision': context['revision'], 'test_roots': resources(spec['fixture'])['tests']}
            save(path, request)
            row.update(invoke(['node', str(SKILL / 'playbook/v4/run_runtime_preparation.mjs'), str(path), str(target)], root, flows / 'stage.log'))
            row['artifact'] = str(target / 'runtime/runtime.json')
            if row['exit_code'] == 0:
                check = invoke([sys.executable, str(SKILL / 'scripts/runtime_preparation.py'), 'verify', row['artifact']], root, flows / 'independent-runtime-check.log')
                row['host_verification'] = check
                runtime = read(row['artifact']); workspace = Path(runtime['workspace'])
                info = resources(spec['fixture'])
                prep = {'schema': 'portable-project-prep-v1', 'preparation_protocol': 'two-agent-v1',
                    **context, 'runtime': {'manifest': row['artifact'], 'sha256': digest(Path(row['artifact']))},
                    'test_roots': info['tests'], 'source_paths': info['sources'], 'coverage': {'policy': 'off'}}
                save(flows / 'prep-spec.json', prep)
                row['catalog_preparation'] = invoke([sys.executable, str(SKILL / 'playbook/v4/prepare_project.py'),
                    str(flows / 'prep-spec.json'), str(flows / 'catalog')], root, flows / 'catalog.log')
                if row['catalog_preparation']['exit_code'] == 0:
                    row['guide'] = invoke(['node', str(SKILL / 'playbook/v4/prepare_project_semantics.mjs'),
                        str(flows / 'catalog/catalog.json'), str(flows / 'guide')], root, flows / 'guide.log')
                    row['guide_artifact'] = str(flows / 'guide/guide.json')
        row['model_metrics'] = read(target / 'metrics.json') if (target / 'metrics.json').exists() else None
        row['structurally_completed'] = row.get('exit_code') == 0 and Path(row['artifact']).is_file()
        row['root'] = str(root); row['workflow'] = str(flows)
        save(local / 'native-stage-result.json', row)
        # Keep this active when later native case/coverage/review stages need its binding.
        if stage != 'runtime':
            finish_acceptance(root, at)
    except Exception as error:
        row['harness_error'] = str(error); row['structurally_completed'] = False
    print(json.dumps({k: v for k, v in row.items() if k != 'model_metrics'}, ensure_ascii=False), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    if not os.environ.get('ACCEPTANCE_AGENT') or not os.environ.get('ACCEPTANCE_MODEL'):
        parser.error('Explicit caller Agent/model required')
    if not args.output.is_absolute() or args.output.exists():
        parser.error('Use a fresh absolute output directory')
    specs = [s for s in JOBS if not args.only or s['id'] in args.only]
    if not specs or args.only and set(args.only) - {s['id'] for s in specs}:
        parser.error('Unknown job ID')
    args.output.mkdir(parents=True)
    result = {'schema': 'agent-quality-stage-runs-v1', 'platform': {'system': platform.system(), 'machine': platform.machine()},
              'implementation': {str(p.relative_to(SKILL)): digest(p) for p in (SKILL / 'playbook').rglob('*.mjs')
                                 if 'node_modules' not in p.parts}, 'rows': []}
    save(args.output / 'results.json', result)
    with ThreadPoolExecutor(max_workers=min(max(args.workers, 1), 3)) as pool:
        futures = {pool.submit(run_job, spec, args.output): spec['id'] for spec in specs}
        for future in as_completed(futures):
            result['rows'].append(future.result()); save(args.output / 'results.json', result)
    result['implementation_unchanged'] = all(digest(SKILL / p) == value for p, value in result['implementation'].items())
    save(args.output / 'results.json', result)
    return 0 if all(r['structurally_completed'] for r in result['rows']) else 1


if __name__ == '__main__':
    sys.exit(main())
