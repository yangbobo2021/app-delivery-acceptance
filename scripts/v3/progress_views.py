"""Read-only, project-neutral progress derived from v3 workflow artifacts."""
from __future__ import annotations

import json
import hashlib
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path


def read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def stamp(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except OSError:
        return ''


def newest(folder: Path, names: list[str]) -> str:
    return max((stamp(folder / name) for name in names), default='')


def requirement_items(value):
    if isinstance(value, dict):
        value = value.get('items', [])
    return value if isinstance(value, list) else []


def key_of(request):
    project = request.get('project') or {}
    return project.get('root') or request.get('project_root') or ''


def classify(request):
    if not isinstance(request, dict):
        return None
    if request.get('scene') and isinstance(request.get('case_catalog'), list):
        return 'case'
    if request.get('target_requirement_id') and request.get('scenario_kind'):
        return 'scenario'
    if request.get('base_revision') and request.get('head_revision') and 'source_paths' in request:
        return 'reverse'
    if request.get('mode') in ('create', 'edit') and 'requirements' in request:
        return 'analysis'
    return None


def initial_project(request, identities):
    root = key_of(request)
    known = identities.get(root, {})
    supplied = request.get('project') or {}
    return {'id': supplied.get('id') or known.get('id') or Path(root).name,
            'label': supplied.get('label') or known.get('label') or Path(root).name,
            'root': root,
            'revision': supplied.get('revision') or request.get('head_revision') or
                        request.get('source_evidence', {}).get('revision') or known.get('revision') or '',
            'sources': supplied.get('sources') or request.get('source_paths') or []}


def current_case_attempt(folder: Path):
    attempts = sorted((p for p in folder.glob('attempt-*') if p.is_dir() and p.name[8:].isdigit()),
                      key=lambda p: int(p.name[8:]))
    return attempts[-1] if attempts else None


def matches_review(execution_path: Path | None, review) -> bool:
    if execution_path is None or not execution_path.is_file() or not review.get('execution_sha256'):
        return False
    return hashlib.sha256(execution_path.read_bytes()).hexdigest() == review['execution_sha256']


def matches_scenario_review(folder: Path, review) -> bool:
    path = folder / 'scenarios.current.json'
    return (path.is_file() and bool(review.get('scenarios_sha256')) and
            hashlib.sha256(path.read_bytes()).hexdigest() == review['scenarios_sha256'])


def case_result_history(folder, preview, artifact_resolver=None):
    """Retain execution facts/confirmed results before selecting active attempts."""
    receipts = set(folder.glob('attempt-*/execution.json'))
    receipts.update(folder.glob('execution-review-*/execution.json'))
    receipts.update(p for p in (folder / 'execution/execution.json',
                                folder / 'blocker-assessment/execution/execution.json') if p.is_file())
    confirmed = {}
    review_paths = list(folder.glob('review*/answer.json'))
    review_paths += list(folder.glob('blocker-assessment/review/answer.json'))
    for summary_path in (folder / 'summary.json', folder / 'blocker-assessment/summary.json'):
        summary = read_json(summary_path) or {}
        if summary.get('review_path'):
            ref = artifact_resolver(summary_path, summary['review_path']) if artifact_resolver else Path(summary['review_path'])
            if ref:
                review_paths.append(ref)
    for path in dict.fromkeys(review_paths):
        answer = read_json(path) or {}
        gate = read_json(path.with_name('decision-gate.json')) or {}
        inp = read_json(path.with_name('input.json')) or {}
        receipt = ((artifact_resolver(path, inp['frozen_execution_receipt']) if artifact_resolver else
                    Path(inp['frozen_execution_receipt'])) if inp.get('frozen_execution_receipt') else None)
        if not receipt or not receipt.is_file() or gate.get('status') != 'valid' or gate.get('review_status') != answer.get('status'):
            continue
        receipts.add(receipt)
        metrics = read_json(path.with_name('metrics.json')) or {}
        confirmed.setdefault(receipt, []).append((answer, answer.get('confirmed_at') or
                                                  metrics.get('finished_at') or stamp(path)))
    v3_review = read_json(folder / 'review.current.json') or {}
    history = []
    for path in sorted(receipts):
        receipt = read_json(path) or {}
        actual = bool(receipt.get('start_utc') and receipt.get('command')) or any(
            r.get('status') in {'passed', 'failed', 'executed', 'error', 'aborted'}
            for r in receipt.get('case_results', []))
        if not actual:
            continue
        row = deepcopy(preview)
        row['executed_scene_ids'] = [s['id'] for s in row['scenarios']]
        row['generated_at'] = receipt.get('end_utc') or receipt.get('start_utc') or stamp(path)
        row['attempt_id'] = str(path.parent.relative_to(folder)) if path.is_relative_to(folder) else str(path.parent)
        row['case_results'] = receipt.get('case_results', [])
        if not row['case_results'] and row.get('bindings'):
            row['case_results'] = [{'binding_id': row['bindings'][0]['id'], 'status': 'executed',
                                    'actual': '执行退出码 ' + str(receipt.get('exit_code')),
                                    'evidence_path': str(path.with_name('execution.log'))}]
        row['judgment'] = {'status': 'pending_review', 'reason': '已有执行记录，尚无已确认结论。'}
        records = list(confirmed.get(path, []))
        if matches_review(path, v3_review):
            records.append((v3_review, v3_review.get('confirmed_at') or stamp(folder / 'review.current.json')))
        if records:
            answer, at = max(records, key=lambda pair: pair[1])
            row.update(judgment={'status': answer['status'], 'reason': answer.get('summary') or answer.get('reason', '')},
                       judgment_confirmed=True, judgment_confirmed_at=at)
        history.append(row)
    return history


def status_for(kind, folder, request, metrics):
    if request.get('progress_schema') == 'single-agent-scene-v1':
        state = read_json(folder / 'state.json') or {}
        summary = read_json(folder / 'summary.json') or {}
        stages = state.get('stages', {})
        if summary.get('review_status'):
            verdict = summary['review_status']
            if verdict in ('passed', 'product_bug'):
                return 'done', '独立判定：' + ('通过' if verdict == 'passed' else '产品 BUG'), ''
            return ('repair' if verdict == 'repair_required' else 'blocked'), '独立审查：' + verdict, summary.get('review_completion_reason', '')
        for name, item in sorted(stages.items(), key=lambda pair: pair[1].get('started_at', ''), reverse=True):
            if name.startswith('review-repair-') or name.startswith('execution-review-') or name.startswith('review-'):
                label = ('差量修复' if name.startswith('review-repair-') else
                         '返工后冻结执行' if name.startswith('execution-review-') else '返工后独立审查')
                if item.get('status') in ('running', 'resume_ready', 'retry_ready'):
                    return 'running', label + '进行中', ''
                if item.get('status') == 'parked':
                    return 'blocked', label + '已暂停', item.get('error', '')
        for name, label in [('review', '独立审查'), ('gate', '执行交接门禁'),
                            ('evidence', '冻结证据'), ('execution', '冻结执行'),
                            ('case_repair', '用例差量修复'), ('case', '用例实现与本地调试'),
                            ('prepare', '项目准备')]:
            item = stages.get(name, {})
            if item.get('status') in ('running', 'resume_ready', 'retry_ready'):
                return 'running', label + '进行中', ''
            if item.get('status') == 'parked':
                return 'blocked', label + '已暂停', item.get('error', '')
        completed = [name for name, item in stages.items() if item.get('status') == 'completed']
        return ('running' if completed else 'queued'), ('已完成 ' + '、'.join(completed[-2:]) if completed else '场景已接收，待项目准备'), ''
    terminal = read_json(folder / 'terminal.json') or {}
    terminal_state = terminal.get('state')
    final = metrics.get('final_state') or terminal.get('final_state') or (
        terminal_state.get('stateId') if isinstance(terminal_state, dict) else terminal_state)
    if kind == 'analysis':
        if (folder / 'analysis.json').exists() and final == 'done':
            return 'done', '整体业务目标和已确认范围已形成', ''
        if final in ('blocked', 'failed', 'interrupted'):
            return 'blocked', '需求分析未完成', metrics.get('reason') or terminal.get('reason') or ''
        if (folder / 'analysis.json').exists():
            return 'running', '正在校验需求分析', ''
        return 'running' if metrics.get('calls') else 'queued', '正在分析全部需求' if metrics.get('calls') else '需求已接收，待分析', ''
    if kind == 'reverse':
        result = read_json(folder / 'result.json') or {}
        if result.get('status') == 'completed':
            rules = result.get('draft', {}).get('reverse_rules', [])
            return 'done', f'已形成 {len(rules)} 条行为规则', ''
        if final in ('blocked', 'failed', 'interrupted'):
            return 'blocked', '逆向分析未完成', metrics.get('reason') or terminal.get('reason') or ''
        if (folder / 'draft.current.json').exists():
            return 'running', '正在校验逆向规则', ''
        return 'running' if metrics.get('calls') else 'queued', '正在逆向分析代码变更' if metrics.get('calls') else '变更已接收，待逆向分析', ''
    if kind == 'scenario':
        scenes = read_json(folder / 'scenarios.current.json') or {}
        if (read_json(folder / 'terminal.json') or {}).get('review_kind') == 'internal_self_check':
            terminal = read_json(folder / 'terminal.json') or {}
            if terminal.get('final_state') == 'done' and matches_v4_scenarios(folder, terminal):
                return 'done', f"{len(scenes.get('scenarios', []))} 个场景已完成内部自审和结构校验", ''
            return 'blocked', '场景生成尚未形成有效结果', ''
        review = read_json(folder / 'review.current.json') or {}
        if review and not matches_scenario_review(folder, review):
            review = {}
        count = len(scenes.get('scenarios', []))
        if review.get('status') == 'approved' and count:
            return 'done', f'{count} 个场景已通过独立审查', ''
        if review and review.get('status') != 'approved':
            return 'repair', f'{count} 个场景需根据审查意见调整', review.get('summary') or ''
        if final in ('blocked', 'failed', 'interrupted'):
            return 'blocked', '场景生成未完成', metrics.get('reason') or terminal.get('reason') or ''
        if count:
            return 'running', f'{count} 个场景已生成，正在独立审查', ''
        return 'running' if metrics.get('calls') else 'queued', '正在生成场景' if metrics.get('calls') else '目标已接收，待生成场景', ''
    attempt = current_case_attempt(folder)
    review = read_json(folder / 'review.current.json') or {}
    plan = read_json(folder / 'plan.current.json') or {}
    execution_path = attempt / 'execution.json' if attempt else None
    execution = read_json(execution_path) if execution_path else None
    published = read_json(attempt / 'trace.json') if attempt else None
    handoff = read_json(attempt / 'code-repair-handoff.json') if attempt else None
    recovery = read_json(attempt / 'recovery-block.json') if attempt else None
    published_status = (published or {}).get('judgment', {}).get('status')
    if published_status in ('passed', 'product_bug'):
        return 'done', '独立判定：' + ('通过' if published_status == 'passed' else '产品 BUG'), ''
    if published_status in ('repair_required', 'blocked'):
        return ('repair' if published_status == 'repair_required' else 'blocked'), '独立审查：' + (
            '需修复测试' if published_status == 'repair_required' else '受阻'), (published or {}).get('judgment', {}).get('reason', '')
    if final in ('passed', 'product_bug') and review and matches_review(execution_path, review):
        return 'done', '独立判定：' + ('通过' if final == 'passed' else '产品 BUG'), ''
    if recovery or handoff:
        return 'blocked', '用例实现或恢复需要处理', (recovery or handoff).get('reason', '')
    if review.get('status') in ('repair_required', 'blocked', 'product_bug', 'passed') and (
            not execution or matches_review(execution_path, review)):
        state = 'repair' if review['status'] == 'repair_required' else 'blocked' if review['status'] == 'blocked' else 'done'
        label = {'repair_required': '需修复测试', 'blocked': '受阻',
                 'product_bug': '产品 BUG', 'passed': '通过'}[review['status']]
        return state, '独立审查：' + label, review.get('reason') or ''
    if execution:
        return 'running', '实际执行已记录，正在独立审查', ''
    if plan.get('cases'):
        if attempt and (attempt / 'code-repair-receipt.json').exists():
            return 'running', '用例代码已准备，正在执行', ''
        return 'running', f"已选择 {len(plan['cases'])} 个用例／操作，正在实现或准备执行", ''
    return 'running' if metrics.get('calls') else 'queued', '正在设计用例' if metrics.get('calls') else '场景已接收，待设计用例', ''


def matches_v4_scenarios(folder: Path, terminal: dict) -> bool:
    path = folder / 'scenarios.current.json'
    return (path.is_file() and terminal.get('scenarios_sha256') ==
            hashlib.sha256(path.read_bytes()).hexdigest())


def collect(roots, traces, request_paths=None, artifact_resolver=None):
    paths = list(request_paths or [])
    for root in roots:
        paths.extend(root.rglob('request.frozen.json') if root.is_dir() else [])
    identities = {t['project']['root']: t['project'] for t in traces if t.get('project', {}).get('root')}
    requests = []
    for path in paths:
        request = read_json(path)
        kind = classify(request)
        if kind:
            requests.append((path.parent, request, kind))
            project = request.get('project') or {}
            root = key_of(request)
            if root and project.get('id'):
                identities[root] = project
    stages, previews = [], []
    for folder, request, kind in requests:
        metrics = read_json(folder / 'metrics.json') or {}
        project = initial_project(request, identities)
        state, detail, blocker = status_for(kind, folder, request, metrics)
        target = request.get('target_requirement_id') or request.get('scene', {}).get('id') or ''
        active_call = (metrics.get('calls') or [])[-1:]
        attempt_dir = current_case_attempt(folder) if kind == 'case' else None
        update_names = ['request.frozen.json', 'metrics.json', 'analysis.json', 'result.json',
                        'scenarios.current.json', 'review.current.json', 'plan.current.json', 'terminal.json']
        if attempt_dir:
            update_names.extend([f'{attempt_dir.name}/execution.json', f'{attempt_dir.name}/trace.json',
                                 f'{attempt_dir.name}/code-repair-handoff.json',
                                 f'{attempt_dir.name}/recovery-block.json'])
        stage = {'kind': kind, 'project_id': project['id'], 'project_label': project['label'],
                 'target_id': target, 'state': state, 'detail': detail, 'blocker': blocker,
                 'requirement_id': request.get('target_requirement_id') or request.get('scene', {}).get('requirement_id') or '',
                 'finished': bool(read_json(folder / 'terminal.json') or
                                  (read_json(folder / 'summary.json') or {}).get('review_status') or
                                  metrics.get('final_state')),
                 'started_at': metrics.get('started_at') or stamp(folder / 'request.frozen.json'),
                 'updated_at': newest(folder, update_names),
                 'attempt': int(attempt_dir.name[8:]) if attempt_dir else 0,
                 'role': active_call[0].get('role', '') if active_call else '', 'folder': str(folder)}
        stages.append(stage)
        requirements = requirement_items(request.get('requirements'))
        reverse_rules = []
        if kind == 'reverse':
            result = read_json(folder / 'result.json') or {}
            reverse_rules = result.get('draft', {}).get('reverse_rules', []) if result.get('status') == 'completed' else []
        elif kind in ('scenario', 'case'):
            reverse_rules = request.get('reverse_rules') or []
        scenes, bindings, case_results, judgment = [], [], [], {'status': 'not_run', 'reason': detail}
        coverage = {'status': 'pending'}
        if kind == 'scenario':
            scenario_data = read_json(folder / 'scenarios.current.json') or {}
            scenes = scenario_data.get('scenarios', [])
            judgment = {'status': 'not_run', 'reason': ('场景已完成内部自审，尚待用例执行' if
                        (read_json(folder / 'terminal.json') or {}).get('review_kind') == 'internal_self_check' else
                        '场景设计已审查，尚待用例执行') if state == 'done' else
                        '场景仍在生成或审查，尚待用例执行'}
        if kind == 'case':
            scene = read_json(folder / 'scene.current.json') or request['scene']
            scenes = [scene]
            if request.get('progress_schema') == 'single-agent-scene-v1':
                summary = read_json(folder / 'summary.json') or {}
                stage_data = (read_json(folder / 'state.json') or {}).get('stages', {})
                case_answer = read_json(folder / 'case/answer.json') or {}
                receipt_path = folder / 'execution/execution.json'
                review_path = folder / 'review/answer.json'
                coverage_path = folder / 'coverage-report.json'
                for key in sorted(stage_data, reverse=True):
                    if key.startswith('execution-review-') and stage_data[key].get('status') == 'completed':
                        receipt_path = folder / key / 'execution.json'
                        number = key.removeprefix('execution-review-')
                        coverage_path = folder / f'coverage-review-{number}-report.json'
                    if key.startswith('review-') and stage_data[key].get('status') == 'completed':
                        review_path = folder / key / 'answer.json'
                receipt = read_json(receipt_path) or {}
                review = read_json(review_path) or {}
                coverage = read_json(coverage_path) or {'status': 'pending'}
                bindings = [{'id': f"{scene['id']}-case", 'scenario_id': scene['id'],
                             'kind': 'automated', 'title': '冻结测试命令',
                             'test_file': ', '.join(case_answer.get('test_files', [])),
                             'command': case_answer.get('test_command', [])}] if case_answer else []
                case_results = ([{'binding_id': bindings[0]['id'] if bindings else '',
                                  'status': 'passed' if receipt.get('exit_code') == 0 else 'failed',
                                  'actual': f"冻结执行退出码 {receipt.get('exit_code')}",
                                  'evidence_path': str(receipt_path.with_name('execution.log'))}]
                                if receipt else [])
                verdict = summary.get('review_status') if summary and review else None
                judgment = {'status': verdict or ('pending_review' if receipt else 'not_run'),
                            'reason': (review.get('summary') if verdict else detail) or detail}
            else:
                plan = read_json(folder / 'plan.current.json') or {}
                catalog = {c['id']: c for c in request['case_catalog']}
                bindings = [{**catalog[c['catalog_id']], 'scenario_id': scene['id']}
                            for c in plan.get('cases', []) if c.get('catalog_id') in catalog]
                attempt = current_case_attempt(folder)
                execution = read_json(attempt / 'execution.json') if attempt else None
                case_results = (execution or {}).get('case_results', [])
                review = read_json(folder / 'review.current.json') or {}
                current_review = review if execution and matches_review(attempt / 'execution.json', review) else {}
                judgment = {'status': current_review.get('status') or ('pending_review' if execution else 'not_run'),
                            'reason': current_review.get('reason') or detail}
        preview_at = metrics.get('started_at') or stamp(folder / 'request.frozen.json')
        preview_stage = (('scenario_self_checked' if (read_json(folder / 'terminal.json') or {}).get('review_kind') == 'internal_self_check'
                          else 'scenario_approved') if state == 'done' else 'awaiting_review') if kind == 'scenario' else (
            'reviewed' if kind == 'case' and state == 'done' else
            'awaiting_review' if kind == 'case' and case_results else 'prepared')
        previews.append({'schema': 'delivery-trace-v1', 'provisional': True, 'project': project,
                         'requirements': requirements, 'reverse_rules': reverse_rules,
                         'change': request.get('change') or {}, 'scenarios': scenes,
                         'bindings': bindings, 'case_results': case_results,
                         'stage': preview_stage,
                         'judgment': judgment, 'coverage': coverage,
                         'progress_folder': stage['folder'],
                         'attempt_number': stage['attempt'],
                         'progress_updated_at': stage['updated_at'],
                         'attempt_id': f"第 {stage['attempt']} 次尝试" if stage['attempt'] else '准备阶段',
                         'generated_at': preview_at, 'progress_kind': kind, 'progress_state': state})
    # A later attempt for the same stage and target is the current one. Preserve older
    # final traces separately; never make an earlier run look like the current state.
    history = [row for preview in previews if preview.get('progress_kind') == 'case'
               for row in case_result_history(Path(preview['progress_folder']), preview, artifact_resolver)]
    current = {}
    for stage in stages:
        key = (stage['project_id'], stage['kind'], stage['target_id'])
        if key not in current or stage['started_at'] > current[key]['started_at']:
            current[key] = stage
    active_folders = {s['folder'] for s in current.values()}
    previews = [p for p, s in zip(previews, stages) if s['folder'] in active_folders]
    return {'stages': sorted(current.values(), key=lambda s: (s['project_id'],
                        {'analysis': 0, 'reverse': 1, 'scenario': 2, 'case': 3}[s['kind']], s['target_id'])),
            'previews': previews, 'case_history': history}
