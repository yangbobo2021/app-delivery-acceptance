"""Source-bound existing-case associations, independent of language and runner."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys

from case_evaluation_contract import context


def validate(answer, input_value, root, baseline=None, *, discovery_only=False):
    answer = deepcopy(answer)
    root = Path(root).resolve()

    def require(ok, message):
        if not ok:
            raise ValueError('查找用例结构或引用无效：' + message)

    def text(item, field, limit, *, empty=False):
        value = item.get(field)
        require(isinstance(value, str) and (empty or bool(value.strip())) and len(value) <= limit,
                field + ' 缺失或超过长度限制')
        return value

    def rows(item, field, limit):
        value = item.get(field)
        require(isinstance(value, list) and len(value) <= limit and all(isinstance(x, dict) for x in value),
                field + ' 必须是结构化列表')
        return value

    def index(items, field):
        found = {}
        for item in items:
            key = text(item, field, 80)
            require(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,79}', key) is not None and key not in found,
                    field + ' 重复或格式无效')
            found[key] = item
        return found

    def refs(item, field, known, *, required=False):
        value = item.get(field)
        require(isinstance(value, list) and all(isinstance(x, str) for x in value) and
                len(set(value)) == len(value) and set(value) <= set(known) and (not required or bool(value)),
                field + ' 缺失、重复或包含未知引用')
        return value

    def source(name, *, directory=False):
        require(isinstance(name, str) and bool(name), '源码路径缺失')
        relative = Path(name)
        path = (root / relative).resolve()
        require(not relative.is_absolute() and path.is_relative_to(root) and
                not set(relative.parts) & {'.git', '.acceptance', '.acceptance-local'}, '源码路径越界')
        require(path.exists() if directory else path.is_file(), '源码路径不存在：' + name)
        if baseline is not None and not directory:
            require(name in baseline['files'] and 'sha256' in baseline['files'][name],
                    '引用并非启动时已有文件：' + name)
            require(hashlib.sha256(path.read_bytes()).hexdigest() == baseline['files'][name]['sha256'],
                    '源码字节与启动快照不符：' + name)
        return path

    def span(item, path):
        start, end = item.get('line_start'), item.get('line_end')
        lines = path.read_text().splitlines()
        require(type(start) is int and type(end) is int and 1 <= start <= end <= len(lines), '源码行号无效')
        return '\n'.join(lines[start-1:end])

    require(isinstance(answer, dict), '需要 JSON 对象')
    discovery = answer.get('case_discovery')
    require(isinstance(discovery, dict) and discovery.get('schema') == 'existing-case-discovery-v1', '缺少查找记录')
    text(discovery, 'summary', 180)
    scope = rows(discovery, 'search_scope', 100)
    require(bool(scope), '缺少实际查找范围')
    for item in scope:
        source(text(item, 'path', 1000), directory=True)
        require(item.get('kind') in ('manifest', 'tests', 'source'), '未知查找范围类型')
        text(item, 'summary', 180)

    evidence = index(rows(discovery, 'evidence', 200), 'id')
    for item in evidence.values():
        path = source(text(item, 'file', 1000))
        body = span(item, path)
        require(item['line_end'] - item['line_start'] < 30, '单条引用过长')
        require(text(item, 'quote', 1800) in body, '引用与连续源码原文不符：' + item['file'])
        item['file_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()

    cases = index(rows(answer, 'case_descriptions', 500), 'id')
    files = answer.get('test_files')
    require(isinstance(files, list) and all(isinstance(x, str) for x in files) and len(set(files)) == len(files), 'test_files 无效')
    for name in files:
        source(name)
    for case in cases.values():
        for field, limit in [('name', 120), ('method', 600), ('assertions', 600), ('boundary', 600)]:
            text(case, field, limit)
        loc = case.get('source')
        require(isinstance(loc, dict) and loc.get('origin') == 'existing', '已有用例来源无效')
        name = text(loc, 'file', 1000)
        path = source(name)
        require(name in files, '关联用例文件不在 test_files 中')
        body = span(loc, path)
        title = text(loc, 'title', 500)
        require(title in body or title in (name, path.name), '用例标题不在声明范围内')
        loc['file_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()

    obligations = index(rows(discovery, 'obligations', 100), 'id')
    require(bool(obligations), '缺少当前场景关联目标')
    scene_texts = context(input_value, {})['scene_texts']
    for item in obligations.values():
        require(any(text(item, 'quote', 1000) in s for s in scene_texts), '关联目标不是当前场景原文')
        require(item.get('status') in ('found', 'not_found', 'uncertain'), '关联目标状态无效')
        linked = refs(item, 'case_ids', cases, required=item['status'] == 'found')
        require(item['status'] != 'not_found' or not linked, '未找到与关联列表冲突')
        text(item, 'reason', 180)

    associations = index(rows(discovery, 'associations', 500), 'case_id')
    require(set(associations) == set(cases), '逐用例关联与展示列表不同')
    for cid, item in associations.items():
        targets = refs(item, 'obligation_ids', obligations, required=True)
        require(set(targets) == {oid for oid, o in obligations.items() if cid in o['case_ids']}, '场景与用例关联不是双向一致')
        require(item.get('availability') in ('active', 'skipped', 'conditional', 'unknown'), '关联可运行状态无效')
        text(item, 'contribution', 180)
        if item['availability'] in ('skipped', 'conditional'):
            text(item, 'availability_note', 180)
        ids = refs(item, 'evidence_ids', evidence, required=True)
        loc = cases[cid]['source']
        require(any(evidence[e]['file'] == loc['file'] and evidence[e]['line_start'] <= loc['line_end'] and
                    evidence[e]['line_end'] >= loc['line_start'] for e in ids), '缺少自身测试正文引用')

    for item in rows(discovery, 'excluded_candidates', 12):
        name = text(item, 'file', 1000)
        path = source(name)
        text(item, 'reason', 180)
        title = text(item, 'title', 500)
        require(title in path.read_text() or title in (name, path.name), '排除候选标题并不存在')
        ids = refs(item, 'evidence_ids', evidence, required=True)
        require(any(evidence[e]['file'] == name for e in ids), '排除候选缺少自身引用')
    limits = discovery.get('limitations')
    require(isinstance(limits, list) and len(limits) <= 5 and
            all(isinstance(x, str) and 0 < len(x) <= 180 for x in limits), '限制说明无效')
    if discovery_only:
        require(answer.get('status') == 'not_executed' and answer.get('observations') == [] and
                answer.get('evidence_paths') == [], '静态查找不得声称执行')
    discovery['citation_check'] = 'source_quotes_verified'
    return answer


if __name__ == '__main__':
    input_path, answer_path, root, baseline_path, *flags = sys.argv[1:]
    load = lambda p: json.loads(Path(p).read_text())
    print(json.dumps(validate(load(answer_path), load(input_path), root, load(baseline_path),
                              discovery_only='--discovery-only' in flags), ensure_ascii=False, indent=2))
