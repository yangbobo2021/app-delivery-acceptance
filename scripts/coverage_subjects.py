"""Intent-scoped coverage from pinned Git diffs and verified native units."""
import json
import hashlib
import re
import subprocess
from pathlib import Path


def definition_hash(subjects):
    return hashlib.sha256(json.dumps(subjects, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate_definition(document, review):
    subjects = document.get('coverage_subjects')
    if not isinstance(subjects, list) or not subjects:
        raise ValueError('必须根据测试意图确定覆盖率分母范围并记录 coverage_subjects')
    for value in subjects:
        subject(value)
    identities = [(v['project_id'], str(Path(v['project_root']).resolve())) for v in subjects]
    if len(set(identities)) != len(identities):
        raise ValueError('每个被测组件必须只有一个统一的累计覆盖范围')
    check = review.get('coverage_subject_review', {})
    if check.get('status') != 'passed' or check.get('subjects_sha256') != definition_hash(subjects) or check.get('reviewer_kind') not in ('independent_ai', 'playbook') or not check.get('reason') or not check.get('review_reference'):
        raise ValueError('覆盖率范围缺少独立审查或范围哈希已改变')
    return subjects


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True).stdout


def commit(root, revision):
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', revision):
        raise ValueError('覆盖率基线与版本必须使用完整提交哈希')
    if git(root, 'rev-parse', revision + '^{commit}').decode().strip() != revision:
        raise ValueError('覆盖率提交身份不一致')


def changed_lines(root, base, head, path):
    diff = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', base, head, '--', path)
    result = set()
    for start, count in re.findall(rb'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', diff, re.M):
        first, length = int(start), int(count) if count else 1
        result.update(range(first, first + length))
    return result


def subject(value):
    """Resolve the reviewed test intent, never infer scope from visited files."""
    if not isinstance(value, dict):
        raise ValueError('覆盖率范围记录必须是对象')
    root = Path(value['project_root']).resolve()
    commit(root, value['revision'])
    kind = value['kind']
    if kind not in ('project', 'directories', 'files', 'commit_changes', 'pr_changes'):
        raise ValueError('覆盖率范围类型无效')
    if not all(isinstance(value.get(k), str) and value[k].strip() for k in ('intent', 'basis', 'project_id', 'project_label')):
        raise ValueError('覆盖率范围必须描述测试意图及选择依据')
    paths = value['source_paths']
    exclusions = value['excluded_paths']
    if not isinstance(paths, list) or any(not isinstance(p, str) or not p for p in paths) or len(set(paths)) != len(paths):
        raise ValueError('被测源码范围必须唯一')
    if not isinstance(exclusions, list) or any(not isinstance(e, dict) or not isinstance(e.get('path'), str) or not e['path'] or not isinstance(e.get('reason'), str) or not e['reason'].strip() for e in exclusions):
        raise ValueError('非执行内容排除必须说明原因')
    excluded = {e['path'] for e in exclusions}
    if len(excluded) != len(exclusions) or excluded & set(paths):
        raise ValueError('被测源码与排除范围不能重复')
    if kind in ('project', 'directories', 'files'):
        inventory = set(git(root, 'ls-tree', '-rz', '--name-only', value['revision']).decode().strip('\0').split('\0')) - {''}
        if kind == 'files':
            selected = value['selected_paths']
            if not isinstance(selected, list) or not selected or len(set(selected)) != len(selected) or not set(selected).issubset(inventory):
                raise ValueError('指定文件范围不存在或重复')
            inventory = set(selected)
        if kind == 'directories':
            directories = value['directories']
            if not isinstance(directories, list) or not directories or any(not isinstance(d, str) or not d or Path(d).is_absolute() or '..' in Path(d).parts for d in directories):
                raise ValueError('指定目录范围无效')
            for directory in directories:
                if not any(p.startswith(directory.rstrip('/') + '/') for p in inventory):
                    raise ValueError('指定目录不在冻结项目清单中')
            inventory = {p for p in inventory if any(p.startswith(d.rstrip('/') + '/') for d in directories)}
        if inventory != set(paths) | excluded:
            raise ValueError('覆盖率分母文件清单不完整：源码/排除项与指定范围不一致')
        for path in paths:
            target = (root / path).resolve()
            if not target.is_relative_to(root) or not target.is_file() or target.read_bytes() != git(root, 'show', value['revision'] + ':' + path):
                raise ValueError('覆盖率范围源码与冻结版本不一致')
        return {path: None for path in paths}
    changes = value['changes']
    if not changes or not value.get('project_id') or not value.get('project_label'):
        raise ValueError('覆盖率被测对象缺少身份或变更基线')
    changed = set()
    lines = {}
    for change in changes:
        base, head = change['base_revision'], change['head_revision']
        commit(root, base); commit(root, head)
        if kind == 'pr_changes' and not change.get('pr_url'):
            raise ValueError('需要明确对应PR')
        if kind == 'commit_changes' and base not in git(root, 'show', '-s', '--format=%P', head).decode().split():
            raise ValueError('提交范围须明确该提交的实际父提交；合并提交须选择并说明父提交')
        # --no-renames treats renamed files as deletion/addition; new-side lines
        # are measured. Deleted-only paths have no current executable units.
        records = git(root, 'diff', '--no-ext-diff', '--no-renames', '--name-status', '-z', base, head).decode().split('\0')
        for i in range(0, len(records) - 1, 2):
            status, path = records[i:i + 2]
            if status == 'D':
                continue
            changed.add(path)
            if path not in paths:
                continue
            target = (root / path).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                raise ValueError('被测源码路径超出项目或缺失')
            original = git(root, 'show', head + ':' + path)
            if original != git(root, 'show', value['revision'] + ':' + path) or original != target.read_bytes():
                raise ValueError('PR修改行无法直接定位到冻结被测源码；需明确重映射，不能套用旧行号')
            lines.setdefault(path, set()).update(changed_lines(root, base, head, path))
    if changed != set(paths) | excluded:
        raise ValueError('变更文件清单不完整：遗漏或多出源码/排除项')
    return lines


def select(units, lines):
    result = {}
    for name, changed in lines.items():
        source = units[name]
        selected = {'sha256': source['sha256']}
        for kind in ('lines', 'branches'):
            def relevant(key):
                unit = json.loads(key)
                # coverage.py: source line of arc; Istanbul: parent decision
                # start line. Include ALL exits of a changed decision, including
                # implicit else. Unchanged decisions are not changed branches.
                anchor = unit if kind == 'lines' else unit[0] if isinstance(unit[0], int) else unit[1][0][0]
                return changed is None or anchor in changed
            all_units = {k for k in source[kind]['all'] if relevant(k)}
            selected[kind] = {'all': all_units, 'hit': source[kind]['hit'] & all_units}
        result[name] = selected
    return result


def summarize(subjects, verified):
    """Merge by original file/unit, regardless of a scene's subset scope."""
    if not isinstance(subjects, list):
        return [{'status': 'invalid', 'reason': '覆盖率范围清单格式无效', 'metrics': None}]
    rows = []
    for value in subjects:
        if not isinstance(value, dict):
            rows.append({'status': 'invalid', 'reason': '覆盖率范围记录必须是对象', 'metrics': None})
            continue
        row = {k: value.get(k) for k in ('kind', 'intent', 'basis', 'project_id', 'project_label', 'project_root', 'revision', 'changes', 'directories', 'selected_paths', 'source_paths', 'excluded_paths')}
        row.update(status='pending', scenario_ids=[], missing_paths=[], metrics=None)
        try:
            lines = subject(value)
            merged = {}
            tool = None
            ids = set()
            for receipt, units in verified:
                if receipt['project_id'] != value['project_id'] or Path(receipt['project_root']).resolve() != Path(value['project_root']).resolve() or receipt['revision'] != value['revision']:
                    continue
                useful = set(units) & set(lines)
                if not useful:
                    continue
                identity = (receipt.get('format', 'coverage.py'), receipt['tool']['name'], receipt['tool']['version'])
                if tool is not None and identity != tool:
                    raise ValueError('累计采集工具口径不同，不能合并')
                tool = identity
                for name in useful:
                    source = units[name]
                    if name not in merged:
                        merged[name] = {'sha256': source['sha256'], **{k: {'all': set(source[k]['all']), 'hit': set(source[k]['hit'])} for k in ('lines', 'branches')}}
                    else:
                        before = merged[name]
                        if before['sha256'] != source['sha256'] or any(before[k]['all'] != source[k]['all'] for k in ('lines', 'branches')):
                            raise ValueError('同一源码的覆盖分母不一致，不能累计')
                        for kind in ('lines', 'branches'):
                            before[kind]['hit'].update(source[kind]['hit'])
                ids.add(receipt['scenario_id'])
            row['scenario_ids'] = sorted(ids)
            row['changed_lines'] = {name: sorted(v) for name, v in lines.items() if v is not None}
            row['missing_paths'] = sorted(set(lines) - set(merged))
            if row['missing_paths']:
                row.update(status='incomplete', reason='整体分母尚不完整：缺少以下被测文件的可执行单元清单及可核验计数；不能用已采集子集代替指定范围覆盖率。')
            else:
                selected = select(merged, lines)
                row.update(status='measured', reason=('按变更新增/修改的可执行行及修改判定位置的全部分支出口统计。' if value['kind'] in ('pr_changes', 'commit_changes') else '按指定被测范围全部可执行行与分支出口统计。') + '只累计本轮独立评估完成的场景。',
                           metrics={k: {'covered': sum(len(s[k]['hit']) for s in selected.values()), 'total': sum(len(s[k]['all']) for s in selected.values())} for k in ('lines', 'branches')})
        except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
            row.update(status='invalid', reason=str(error), metrics=None)
        rows.append(row)
    return rows


if __name__ == '__main__':
    import argparse
    from storage import asset_directory
    parser = argparse.ArgumentParser(description='核验按测试意图选择的覆盖率文件范围并输出独立审查绑定哈希')
    parser.add_argument('project', type=Path); parser.add_argument('--test-dir', required=True)
    args = parser.parse_args()
    ledger = asset_directory(args.project.resolve(), args.test_dir)
    values = json.loads((ledger / 'project.json').read_text()).get('coverage_subjects', [])
    if not values:
        raise ValueError('缺少按测试意图识别的覆盖率范围')
    for value in values:
        subject(value)
    print(json.dumps({'subjects_sha256': definition_hash(values)}, ensure_ascii=False))
