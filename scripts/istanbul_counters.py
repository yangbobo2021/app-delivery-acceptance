"""Read original-source Istanbul counters, without trusting summary percentages.

Line coverage follows Istanbul: a line is hit if any statement starting on it is
hit. Branch units use source locations, type and arm position, never report IDs.
Conversion provenance is hash-bound evidence and independently reviewed.
"""
import hashlib
import json
from pathlib import Path
import subprocess


def count(value):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError('Istanbul 命中次数必须是非负整数')
    return value


def location(value, lines):
    if not isinstance(value, dict) or value.get('skip'):
        raise ValueError('Istanbul 位置无效或存在未经审查的排除')
    points = []
    for kind in ('start', 'end'):
        point = value.get(kind, {})
        line, column = point.get('line'), point.get('column')
        if not isinstance(line, int) or isinstance(line, bool) or not 1 <= line <= len(lines):
            raise ValueError('Istanbul 位置超出原始源代码')
        # Source-map remapping can leave an unknown end column (JSON null).
        width = len(lines[line - 1].encode('utf-16-le')) // 2
        if kind == 'end' and column is None:
            column = width
        if not isinstance(column, int) or isinstance(column, bool) or not 0 <= column <= width:
            raise ValueError('Istanbul 列位置超出原始源代码')
        points.append((line, column))
    if points[0] > points[1]:
        raise ValueError('Istanbul 位置起止顺序无效')
    return points


def counters(root, report, receipt, safe_path, digest):
    if not isinstance(report, dict) or not report:
        raise ValueError('Istanbul 报告必须包含原始文件计数')
    hashes = receipt.get('source_sha256', {})
    targets = receipt['scope']['targets']
    if not isinstance(hashes, dict) or set(hashes) != set(targets):
        raise ValueError('Istanbul 必须绑定每个原始源文件 SHA256')
    files = {}
    for name, value in report.items():
        target = (root / name).resolve()
        if not target.is_relative_to(root) or not isinstance(value, dict) or (root / value.get('path', '')).resolve() != target:
            raise ValueError('Istanbul 文件身份不一致或超出声明项目')
        name = target.relative_to(root).as_posix()
        if name in files:
            raise ValueError('Istanbul 原始源文件重复')
        files[name] = value
    if set(files) != set(targets):
        raise ValueError('Istanbul 文件与声明范围不一致')
    result = {}
    for name, value in files.items():
        path = safe_path(root, name)
        original = subprocess.run(['git', '-C', str(root), 'show', receipt['revision'] + ':' + name], capture_output=True, check=True).stdout
        sha = digest(path)
        if hashlib.sha256(original).hexdigest() != sha or hashes[name] != sha:
            raise ValueError('Istanbul 映射源码与冻结产品版本或字节不一致')
        lines = original.decode('utf-8').split('\n')
        for mapping, hits in (('statementMap', 's'), ('branchMap', 'b')):
            if not isinstance(value.get(mapping), dict) or not isinstance(value.get(hits), dict) or set(value[mapping]) != set(value[hits]):
                raise ValueError('Istanbul 覆盖单元与命中计数不一致')
        line_all, line_hit, branch_all, branch_hit = set(), set(), set(), set()
        for identifier, loc in value['statementMap'].items():
            key = json.dumps(location(loc, lines)[0][0])
            line_all.add(key)
            if count(value['s'][identifier]):
                line_hit.add(key)
        for identifier, branch in value['branchMap'].items():
            if not isinstance(branch, dict) or branch.get('skip') or not isinstance(branch.get('type'), str) or not branch['type']:
                raise ValueError('Istanbul 分支类型无效或存在未经审查的排除')
            loc = location(branch['loc'], lines)
            arms, hits = branch.get('locations'), value['b'][identifier]
            if not isinstance(arms, list) or not arms or not isinstance(hits, list) or len(arms) != len(hits):
                raise ValueError('Istanbul 分支出口与命中计数不一致')
            for index, (arm, hit) in enumerate(zip(arms, hits)):
                # Istanbul represents the implicit else of `if` without an
                # else body using empty positions. Keep that real branch arm
                # in the denominator, identified by its parent and arm index.
                implicit_else = branch['type'] == 'if' and len(arms) == 2 and index == 1 and arm == {'start': {}, 'end': {}}
                key = json.dumps([branch['type'], loc, index, 'implicit_else' if implicit_else else location(arm, lines)])
                if key in branch_all:
                    raise ValueError('Istanbul 分支单元重复')
                branch_all.add(key)
                if count(hit):
                    branch_hit.add(key)
        result[name] = {'sha256': sha, 'lines': {'hit': line_hit, 'all': line_all},
                        'branches': {'hit': branch_hit, 'all': branch_all}}
    return result
