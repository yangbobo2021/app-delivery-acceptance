"""Optional, per-scenario coverage receipts; independent of enhancement gates."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone
import scenario_execution as lifecycle
import istanbul_counters
import coverage_subjects
from storage import asset_directory

NAME = 'execution-coverage.json'
POLICY_NAME = 'execution-coverage-policy.json'
POLICIES = ('off', 'required')
UNAVAILABILITY_KINDS = ('runtime_unsupported', 'access_restricted')


def unavailable_error(item):
    if item.get('status') == 'unavailable' and item.get('unavailability_kind') not in UNAVAILABILITY_KINDS:
        return '采集状态需要重新核验：尚未区分项目无法采集与采集后的处理失败；SKILL解析/适配失败必须修正，不能作为无法采集豁免'
    return None


def policy(ledger, explicit=None):
    path = Path(ledger) / POLICY_NAME
    saved = read(path).get('mode') if path.exists() else 'required'
    mode = saved if explicit is None else explicit
    if mode not in POLICIES:
        raise ValueError('execution coverage policy must be off or required')
    if explicit is not None and path.exists() and saved != mode:
        raise ValueError('execution coverage policy differs from the fixed session policy')
    return {'mode': mode}


def required(run):
    return run.get('coverage_policy', {}).get('mode') == 'required'


def policy_errors(folder, run):
    path = Path(folder) / 'execution-plan.json'
    if not path.exists():
        return ['覆盖率策略缺少冻结执行计划'] if 'coverage_policy' in run else []
    plan = read(path)
    fixed = plan.get('coverage_policy', {'mode': 'off'})
    current = run.get('coverage_policy', {'mode': 'off'})
    if fixed != current or current.get('mode') not in POLICIES:
        return ['覆盖率策略已改变或无效；不能在本轮关闭采集要求']
    return []


def collection_errors(project, folder, run, binding, scene):
    if not required(run):
        return []
    errors = []
    collection = binding.get('coverage_collection', {})
    if not isinstance(collection, dict):
        return ['覆盖率准备问题：采集记录必须是对象']
    projects = collection.get('projects', [])
    if not isinstance(projects, list) or not projects:
        return ['覆盖率采集遗漏：准备时必须记录被测项目的采集能力与范围']
    if any(not isinstance(p, dict) for p in projects):
        return ['覆盖率准备问题：项目记录必须是对象']
    roots = {str(Path(project).resolve())}
    roots.update(str(Path(s['root']).resolve()) for s in scene.get('code_sources', []) if s.get('root'))
    subjects = read(Path(folder).parent.parent / 'project.json').get('coverage_subjects', [])
    # Reviewed run-wide subjects also bind black-box scenes without code_sources.
    # Keep exact root equality and the per-component/source/version checks below.
    roots.update(str(Path(s['project_root']).resolve()) for s in subjects
                 if s.get('project_root') and coverage_subjects.subject(s))
    if {str(Path(p.get('project_root', '')).resolve()) for p in projects} != roots:
        errors.append('覆盖率准备必须逐一说明本项目及冻结场景代码来源项目，不能漏掉组件')
    ids = [p.get('project_id') for p in projects]
    if len(set(ids)) != len(ids):
        errors.append('覆盖率项目标识不能重复')
    for root_name in roots:
        declared = [p for p in projects if str(Path(p.get('project_root', '')).resolve()) == root_name]
        frozen = [s for s in subjects if str(Path(s['project_root']).resolve()) == root_name]
        if frozen:
            required_ids = {s['project_id'] for s in frozen if coverage_subjects.subject(s)}
            if not required_ids.issubset({p.get('project_id') for p in declared}):
                errors.append('覆盖率准备遗漏冻结组件；同仓库的各个非空被测分母必须分别声明')
        elif len(declared) != 1:
            errors.append('未定义组件分母的代码来源必须恰好声明一个采集项目')
    for item in projects:
        try:
            validate_source(project, folder, run, item)
            if not all(lifecycle.text(item.get(k)) for k in ('project_id', 'project_label', 'reason')):
                raise ValueError('项目名称与能力判断原因必须具体')
            scope = item.get('scope', {})
            if not lifecycle.text(scope.get('basis')) or not isinstance(scope.get('targets'), list) or not scope['targets'] or len(set(scope['targets'])) != len(scope['targets']):
                raise ValueError('必须明确被测源文件范围及依据')
            root = Path(item['project_root']).resolve()
            root_subjects = [s for s in subjects if Path(s['project_root']).resolve() == root]
            if any(s['revision'] != item['revision'] for s in root_subjects):
                raise ValueError('同仓库组件的冻结版本与采集版本不一致')
            matched_subjects = [s for s in root_subjects if s['project_id'] == item['project_id']]
            if root_subjects and len(matched_subjects) != 1:
                raise ValueError('覆盖率被测对象与准备项目身份/冻结版本不一致')
            for subject in matched_subjects:
                changed = coverage_subjects.subject(subject)
                if subject['revision'] != item['revision']:
                    raise ValueError('覆盖率被测对象与准备项目身份/冻结版本不一致')
                if not set(changed).issubset(scope['targets']):
                    raise ValueError('覆盖率采集范围遗漏被测源码；必须包含未命中源码以固定整体分母')
            for name in scope['targets']:
                source = lifecycle.safe_path(root, name)
                original = subprocess.run(['git', '-C', str(root), 'show', item['revision'] + ':' + name], capture_output=True, check=True).stdout
                if hashlib.sha256(original).hexdigest() != digest(source):
                    raise ValueError('采集目标与冻结产品版本不一致')
            if not isinstance(scope.get('exclusions'), list) or any(not e.get('path') or not lifecycle.text(e.get('reason')) for e in scope['exclusions']):
                raise ValueError('范围排除项必须有具体原因')
            evidence = item.get('evidence')
            lifecycle.evidence_hashes(folder, evidence)
            if item.get('status') == 'available':
                if not all(lifecycle.text(item.get('tool', {}).get(k)) for k in ('name', 'version', 'command')):
                    raise ValueError('可采集时必须核实实际工具版本与执行命令')
            elif item.get('status') == 'unavailable':
                problem = unavailable_error(item)
                if problem:
                    raise ValueError(problem)
                attempts = item.get('recovery_attempts')
                if not isinstance(attempts, list) or not attempts or any(not all(lifecycle.text(a.get(k)) for k in ('action', 'result')) or not a.get('evidence') or any(e not in evidence for e in a['evidence']) for a in attempts):
                    raise ValueError('无法采集必须保存已尝试解决办法、实际结果与证据；工具未安装不是自动豁免')
            else:
                raise ValueError('采集能力必须明确 available 或 unavailable')
        except (AttributeError, ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
            errors.append('覆盖率准备问题：' + str(error))
    return errors


def validate_prepared_receipt(run, progress, receipt):
    if not required(run):
        return
    items = (progress.get('binding') or {}).get('coverage_collection', {}).get('projects', [])
    matches = [p for p in items if p.get('project_id') == receipt.get('project_id')]
    if len(matches) != 1 or matches[0].get('status') != 'available':
        raise ValueError('覆盖收据项目未在本场景准备记录中声明为可采集')
    if any(receipt.get(k) != matches[0].get(k) for k in ('project_root', 'revision', 'scope', 'tool')):
        raise ValueError('覆盖收据工具或范围偏离本场景准备记录')
    if receipt.get('format', 'coverage.py') != matches[0].get('format', 'coverage.py'):
        raise ValueError('覆盖收据格式偏离本场景准备记录')


def obligation_errors(project, folder, run, progress, observed, assessment):
    """No completion calls here: used by both evaluate and the recording gate."""
    if not required(run):
        return []
    errors = policy_errors(folder, run)
    scene = next(s for s in read(Path(folder) / 'scenarios.snapshot.json')['items'] if s['id'] == progress['scenario_id'])
    binding = observed.get('binding') or progress.get('binding') or {}
    errors += collection_errors(project, folder, run, binding, scene)
    try:
        pinned = binding.get('coverage_collection', {}).get('evidence_sha256', {})
        if not pinned or lifecycle.evidence_hashes(folder, list(pinned)) != pinned:
            errors.append('覆盖率能力检查证据缺失或在准备后被修改')
    except (ValueError, OSError) as error:
        errors.append('覆盖率能力证据问题：' + str(error))
    projects = binding.get('coverage_collection', {}).get('projects', [])
    check = assessment.get('execution_coverage', {})
    rows = check.get('projects', [])
    if check.get('status') != 'verified' or not isinstance(rows, list) or len(rows) != len(projects) or {r.get('project_id') for r in rows} != {p.get('project_id') for p in projects}:
        return errors + ['覆盖率采集遗漏：独立评估必须逐项目核查采集结果或无法采集原因']
    document = read(Path(folder) / NAME) if (Path(folder) / NAME).exists() else {}
    for receipt in document.get('receipts', []):
        if receipt.get('scenario_id') == progress['scenario_id'] and receipt.get('attempt') == progress['attempt']:
            try:
                validate_prepared_receipt(run, progress, receipt)
            except (ValueError, KeyError, TypeError) as error:
                errors.append('覆盖率核查问题：' + str(error))
    for item in projects:
        row = next(r for r in rows if r.get('project_id') == item['project_id'])
        refs = row.get('evidence', [])
        if not lifecycle.text(row.get('reason')) or not isinstance(refs, list) or not refs or any(r not in observed.get('evidence', []) for r in refs) or any(r not in refs for r in item['evidence']):
            errors.append('覆盖率独立核查必须引用本次采集能力与实际观察证据')
        expected = 'measured' if item['status'] == 'available' else 'unavailable'
        if row.get('status') != expected:
            errors.append('可采集却未采集属于执行问题，不能改成无法采集豁免')
        if expected == 'unavailable':
            continue
        receipts = [r for r in document.get('receipts', []) if r.get('scenario_id') == progress['scenario_id'] and r.get('attempt') == progress['attempt'] and r.get('project_id') == item['project_id']]
        if len(receipts) != 1:
            errors.append('覆盖率采集遗漏：本场景当前尝试缺少唯一有效收据')
            continue
        receipt = receipts[0]
        try:
            if document.get('run_id') != Path(folder).name or document.get('ledger_hashes') != run['ledger_hashes'] or receipt.get('result_sha256') != lifecycle.hash_value(observed):
                raise ValueError('覆盖收据与本次观察/设计不一致')
            if any(receipt.get(k) != item.get(k) for k in ('project_root', 'revision', 'scope', 'tool')):
                raise ValueError('实际采集工具或范围偏离准备记录')
            raw = receipt['raw_evidence']
            if raw['path'] not in refs or raw['path'] not in observed.get('evidence', []) or observed.get('evidence_sha256', {}).get(raw['path']) != raw['sha256']:
                raise ValueError('覆盖率原始数据没有纳入本次取证和独立核查')
            for proof in receipt.get('provenance_evidence', []):
                if proof['path'] not in refs or proof['path'] not in observed.get('evidence', []) or observed.get('evidence_sha256', {}).get(proof['path']) != proof['sha256']:
                    raise ValueError('覆盖率工具及源码映射证据没有纳入本次取证和独立核查')
            counters(validate_source(project, folder, run, receipt), folder, receipt)
        except (AttributeError, ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
            errors.append('覆盖率核查问题：' + str(error))
    return errors


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def counters(root, folder, receipt):
    """Read native coverage.py/Istanbul JSON; verify source and counter units."""
    captured = datetime.fromisoformat(receipt['captured_at'])
    if captured.tzinfo is None or captured.utcoffset() is None:
        raise ValueError('采集时间必须包含时区')
    raw = receipt['raw_evidence']
    path = lifecycle.safe_path(folder, raw['path'])
    contents = path.read_bytes()
    if hashlib.sha256(contents).hexdigest() != raw['sha256']:
        raise ValueError('覆盖率原始文件已改变')
    report = json.loads(contents)
    if not all(lifecycle.text(receipt.get('tool', {}).get(k)) for k in ('name', 'version', 'command')):
        raise ValueError('需要真实工具、版本及执行命令')
    if receipt.get('format') == 'istanbul':
        proofs = receipt.get('provenance_evidence')
        if not isinstance(proofs, list) or not proofs:
            raise ValueError('Istanbul 必须提供实际工具版本、采集调用及原始源码映射证据')
        seen = set()
        for proof in proofs:
            if not isinstance(proof, dict) or proof.get('path') in seen or proof.get('path') == raw['path'] or digest(lifecycle.safe_path(folder, proof['path'])) != proof['sha256']:
                raise ValueError('Istanbul 工具或映射证据重复、缺失或已改变')
            seen.add(proof['path'])
        if not receipt['scope'].get('basis') or not isinstance(receipt['scope'].get('exclusions'), list) or any(not e.get('path') or not e.get('reason') for e in receipt['scope']['exclusions']):
            raise ValueError('Istanbul 范围与排除原因必须明确')
        targets = receipt['scope']['targets']
        if not targets or len(targets) != len(set(targets)):
            raise ValueError('Istanbul 采集目标必须唯一且非空')
        return istanbul_counters.counters(root, report, receipt, lifecycle.safe_path, digest)
    if receipt.get('format', 'coverage.py') != 'coverage.py':
        raise ValueError('覆盖收据格式暂不支持，属于SKILL适配问题，不能作为无法采集豁免')
    if report['meta']['version'] != receipt['tool']['version'] or report['meta'].get('branch_coverage') is not True:
        raise ValueError('工具版本或分支采集配置不一致')
    if receipt['tool']['name'] != 'coverage.py' or not receipt['tool'].get('command'):
        raise ValueError('需要真实工具及执行命令')
    files = {}
    for name, value in report['files'].items():
        target = (root / name).resolve()
        if not target.is_relative_to(root):
            raise ValueError('采集文件超出声明项目')
        files[target.relative_to(root).as_posix()] = value
    targets = receipt['scope']['targets']
    if not targets or len(targets) != len(set(targets)) or set(targets) != set(files) or not receipt['scope'].get('basis'):
        raise ValueError('采集文件与声明范围不一致')
    if not receipt['scope'].get('exclusions') or not all(e.get('path') and e.get('reason') for e in receipt['scope']['exclusions']):
        raise ValueError('请说明测量范围之外的组件')
    result = {}
    for name in targets:
        path = lifecycle.safe_path(root, name)
        original = subprocess.run(['git', '-C', str(root), 'show', receipt['revision'] + ':' + name], capture_output=True, check=True).stdout
        sha = digest(path)
        if hashlib.sha256(original).hexdigest() != sha:
            raise ValueError('测量源码与声明产品版本不一致')
        value = files[name]
        if value.get('excluded_lines'):
            raise ValueError('行级排除须另行审查；不能缩小此指标分母')
        units = {}
        for kind, hit_key, missing_key, total_key, count_key in (
            ('lines', 'executed_lines', 'missing_lines', 'num_statements', 'covered_lines'),
            ('branches', 'executed_branches', 'missing_branches', 'num_branches', 'covered_branches')):
            hit, missing = value[hit_key], value[missing_key]
            valid = (lambda v: isinstance(v, int) and not isinstance(v, bool) and v > 0) if kind == 'lines' else (lambda v: isinstance(v, list) and len(v) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in v))
            if not all(valid(v) for v in hit + missing):
                raise ValueError('覆盖单元格式无效')
            h = {json.dumps(v) for v in hit}; m = {json.dumps(v) for v in missing}
            if len(h) != len(hit) or len(m) != len(missing) or h & m or len(h | m) != value['summary'][total_key] or len(h) != value['summary'][count_key]:
                raise ValueError('原始覆盖单元与计数不一致')
            units[kind] = {'hit': h, 'all': h | m}
        result[name] = {'sha256': sha, **units}
    return result


def validate_source(project, folder, run, receipt):
    root = Path(receipt['project_root']).resolve()
    if root == Path(project).resolve():
        versions = {run['revision']}
    else:
        versions = set()
        for name in ('scenarios.snapshot.json', 'white_box_rules.snapshot.json'):
            snapshot = read(folder / name) if (folder / name).exists() else {}
            for item in snapshot.get('items', []):
                for source in item.get('code_sources', []):
                    if source.get('root') and Path(source['root']).resolve() == root:
                        versions.add(source.get('revision'))
    if not versions:
        raise ValueError('覆盖率项目不是冻结的被测代码来源')
    if receipt['revision'] not in versions:
        raise ValueError('覆盖率版本与冻结产品版本不一致')
    return root


def summarize(project, ledger, folder, run, document):
    """Do not include pending, repaired, stale or untrustworthy executions."""
    # One scene can have receipts for several components. Reuse checks within
    # this single read only; the next snapshot still verifies changed inputs.
    completions = {}; obligations = {}; receipt_units = {}
    def completed(sid):
        if sid not in completions:
            completions[sid] = lifecycle.completion_errors(project, ledger, folder, run, identifier=sid)
        return completions[sid]
    def obligation(progress, observed, assessment):
        sid = progress['scenario_id']
        if sid not in obligations:
            obligations[sid] = obligation_errors(project, folder, run, progress, observed, assessment)
        return obligations[sid]
    def measured(receipt):
        key = json.dumps(receipt, sort_keys=True)
        if key not in receipt_units:
            root = validate_source(project, folder, run, receipt)
            receipt_units[key] = (root, counters(root, folder, receipt))
        return receipt_units[key]
    result = {'projects': [], 'issues': [], 'measured_scenario_ids': [], 'updated_at': None,
              'policy': run.get('coverage_policy', {'mode': 'off'}), 'collection': [], 'subjects': []}
    subjects = read(Path(ledger) / 'project.json').get('coverage_subjects', [])
    result['subjects'] = coverage_subjects.summarize(subjects, [])
    if required(run):
        try:
            selected = read(Path(folder) / 'execution-plan.json')['ordered_scenario_ids']
            for progress in run.get('progress', []):
                sid = progress['scenario_id']
                if sid not in selected:
                    continue
                phase = progress.get('phase')
                projects = (progress.get('binding') or {}).get('coverage_collection', {}).get('projects', [])
                if not projects:
                    state = 'pending' if phase in ('pending', 'preparing', 'not_run') else 'missing'
                    reason = '尚未进入采集准备' if state == 'pending' else '覆盖率采集遗漏，待修正：没有采集能力与范围记录'
                    review = next((r for r in run.get('scenario_reviews', []) if r['scenario_id'] == sid), {})
                    if phase == 'completed' and review.get('status') == 'execution_error':
                        errors = completed(sid)
                        state = 'invalid' if errors else 'not_completed'
                        reason = '; '.join(errors) if errors else review['assessment']['execution_coverage']['reason']
                    result['collection'].append({'scenario_id': sid, 'status': state, 'reason': reason})
                for item in projects:
                    row = {k: item.get(k) for k in ('project_id', 'project_label', 'scope', 'reason', 'recovery_attempts')}
                    row['recorded_reason'] = item.get('reason')
                    row.update(scenario_id=sid, status='collecting' if item['status'] == 'available' else 'unavailable_pending')
                    problem = unavailable_error(item)
                    if problem:
                        row.update(status='collection_error', reason=problem)
                    if phase == 'evaluating':
                        receipt = next((r for r in (document or {}).get('receipts', []) if r.get('scenario_id') == sid and r.get('attempt') == progress['attempt'] and r.get('project_id') == item['project_id']), None)
                        if item['status'] == 'available':
                            row['status'] = 'pending_review' if receipt else 'missing'
                            row['reason'] = '真实计数已保存，等待独立核验后计入' if receipt else '覆盖率采集遗漏，待修正：可采集但本次尚无有效收据'
                    if phase == 'completed':
                        observed = next((r for r in run['results'] if r['scenario_id'] == sid), {})
                        assessment = next((r.get('assessment', {}) for r in run['scenario_reviews'] if r['scenario_id'] == sid), {})
                        review = next((r for r in run['scenario_reviews'] if r['scenario_id'] == sid), {})
                        if review.get('status') == 'execution_error':
                            errors = completed(sid)
                            row['status'] = 'invalid' if errors else 'not_completed'
                            row['reason'] = '; '.join(errors) if errors else assessment['execution_coverage']['reason']
                        else:
                            errors = obligation(progress, observed, assessment)
                            row['status'] = 'collection_error' if problem else 'invalid' if errors else 'measured' if item['status'] == 'available' else 'unavailable'
                            row['validation_issues'] = list(dict.fromkeys(errors))
                            row['reason'] = problem if problem else '; '.join(dict.fromkeys(errors)) if errors else next(r['reason'] for r in assessment['execution_coverage']['projects'] if r['project_id'] == item['project_id'])
                            if row['status'] == 'measured':
                                receipt = next(r for r in document['receipts'] if r['scenario_id'] == sid and r['attempt'] == progress['attempt'] and r['project_id'] == item['project_id'])
                                _, units = measured(receipt)
                                row['metrics'] = {kind: {'covered': sum(len(s[kind]['hit']) for s in units.values()), 'total': sum(len(s[kind]['all']) for s in units.values())} for kind in ('lines', 'branches')}
                    result['collection'].append(row)
        except (AttributeError, ValueError, KeyError, TypeError, OSError) as error:
            result['issues'].append('覆盖率采集状态无法核验：' + str(error))
    if document is None:
        return result
    try:
        if not isinstance(document, dict):
            raise ValueError('覆盖记录格式不是对象')
        latest = None
        if document.get('version') != 1 or document.get('run_id') != folder.name or document.get('ledger_hashes') != run.get('ledger_hashes'):
            raise ValueError('覆盖统计不属于当前运行或设计版本')
        if any(digest(ledger / n) != sha for n, sha in run['ledger_hashes'].items()):
            raise ValueError('当前设计已改变，不能认证本轮覆盖统计')
        grouped = {}; seen = set(); verified = []
        for receipt in document['receipts']:
            sid = receipt['scenario_id']; key = (sid, receipt['attempt'], receipt['project_id'])
            if key in seen:
                raise ValueError('场景覆盖记录重复')
            seen.add(key)
            progress = next((p for p in run['progress'] if p['scenario_id'] == sid), {})
            observed = next((r for r in run['results'] if r['scenario_id'] == sid), {})
            if receipt['attempt'] != progress.get('attempt') or receipt['result_sha256'] != lifecycle.hash_value(observed):
                result['issues'].append(sid + '：旧尝试或观察绑定已变化，未计入')
                continue
            if progress.get('phase') != 'completed':
                continue
            review = next((r for r in run['scenario_reviews'] if r['scenario_id'] == sid), {})
            if review.get('status') not in ('passed', 'failed'):
                continue
            errors = completed(sid)
            if errors:
                result['issues'].append(sid + '：执行及证据核验不通过，未计入')
                continue
            if receipt['raw_evidence']['path'] not in observed.get('evidence', []):
                raise ValueError('覆盖率文件不属于本次观察证据')
            validate_prepared_receipt(run, progress, receipt)
            root, units = measured(receipt)
            verified.append((receipt, units))
            identity = (receipt['project_id'], str(root), receipt['revision'], json.dumps(receipt['scope'], sort_keys=True), receipt['tool']['name'], receipt['tool']['version'], receipt.get('format', 'coverage.py'))
            group = grouped.get(identity)
            if group is None:
                group = grouped[identity] = {'id': receipt['project_id'], 'label': receipt['project_label'], 'root': str(root), 'revision': receipt['revision'], 'scope': receipt['scope'], 'sources': units, 'scenario_ids': []}
            else:
                for name, source in units.items():
                    before = group['sources'][name]
                    if before['sha256'] != source['sha256'] or any(before[k]['all'] != source[k]['all'] for k in ('lines','branches')):
                        raise ValueError('源码或计数分母不同，不能累计')
                    for kind in ('lines', 'branches'):
                        before[kind]['hit'] |= source[kind]['hit']
            group['scenario_ids'].append(sid)
            result['measured_scenario_ids'].append(sid)
            captured = datetime.fromisoformat(receipt['captured_at'])
            if captured.tzinfo is None or captured.utcoffset() is None:
                raise ValueError('采集时间必须包含时区')
            captured = captured.astimezone(timezone.utc)
            latest = max(latest, captured) if latest else captured
            result['updated_at'] = latest.isoformat()
        for group in grouped.values():
            group['metrics'] = {kind: {'covered': sum(len(s[kind]['hit']) for s in group['sources'].values()), 'total': sum(len(s[kind]['all']) for s in group['sources'].values())} for kind in ('lines','branches')}
            group['sources'] = [{'path': n, 'sha256': s['sha256']} for n,s in group['sources'].items()]
            result['projects'].append(group)
        result['measured_scenario_ids'] = sorted(set(result['measured_scenario_ids']))
        result['subjects'] = coverage_subjects.summarize(subjects, verified)
    except (AttributeError, KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        result.update(projects=[], measured_scenario_ids=[], updated_at=None)
        result['subjects'] = coverage_subjects.summarize(subjects, [])
        result['issues'].append('覆盖统计无法核验：' + str(error))
    return result


def main():
    parser = argparse.ArgumentParser(description='保存本轮可选执行覆盖率收据；不启用增强补测')
    parser.add_argument('project', type=Path); parser.add_argument('--test-dir'); parser.add_argument('--run', required=True); parser.add_argument('--input', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', args.run):
        raise ValueError('invalid run id')
    project = args.project.resolve(); ledger = asset_directory(project, args.test_dir); folder = ledger / 'runs' / args.run
    with lifecycle.lock(folder):
        run = read(folder / 'run.json'); receipt = read(args.input)
        if run.get('lifecycle') != 'running':
            raise ValueError('不能给已结束的运行补造覆盖率')
        progress = next(p for p in run['progress'] if p['scenario_id'] == receipt['scenario_id'])
        observation = next(r for r in run['results'] if r['scenario_id'] == receipt['scenario_id'])
        if progress['phase'] not in ('evaluating','completed') or receipt['attempt'] != progress['attempt'] or receipt['result_sha256'] != lifecycle.hash_value(observation) or receipt['raw_evidence']['path'] not in observation['evidence']:
            raise ValueError('覆盖记录须绑定当前尝试和真实观察证据')
        validate_prepared_receipt(run, progress, receipt)
        root = validate_source(project, folder, run, receipt)
        counters(root, folder, receipt)
        path = folder / NAME
        value = read(path) if path.exists() else {'version':1, 'run_id':args.run, 'ledger_hashes':run['ledger_hashes'], 'receipts':[]}
        if any((r['scenario_id'],r['attempt'],r['project_id']) == (receipt['scenario_id'],receipt['attempt'],receipt['project_id']) for r in value['receipts']):
            raise ValueError('同一尝试覆盖记录已保存，不能覆盖')
        value['receipts'].append(receipt); lifecycle.atomic_json(path, value)
    print(json.dumps({'status':'saved', 'scenario_id':receipt['scenario_id']},ensure_ascii=False))


if __name__ == '__main__':
    main()
