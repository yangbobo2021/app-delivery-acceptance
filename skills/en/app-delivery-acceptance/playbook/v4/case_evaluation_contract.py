"""Validate advisory structure and traceable quotations, never product correctness."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys

SCHEMA = 'case-evaluation-v2'


def context(input_value, answer):
    values = answer.get('case_descriptions') or answer.get('associated_tests')
    if not values:
        values = [{'file': x} for x in answer.get('test_files', [])]
    cases = []
    for n, value in enumerate(values, 1):
        source = value.get('source') or value
        cases.append({'case_id': f'C{n}', 'original_id': value.get('id', ''),
                      'file': source.get('file', ''),
                      'title': source.get('title') or value.get('name', ''),
                      'line_start': source.get('line_start'), 'line_end': source.get('line_end'),
                      'file_sha256': source.get('file_sha256') or value.get('file_sha256', '')})
    scene = input_value.get('scene', {})
    # Deliberately exclude parent requirements, provenance and priority rationale.
    def strings(value):
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [s for x in value for s in strings(x)]
        if isinstance(value, dict):
            return [s for x in value.values() for s in strings(x)]
        return []
    quotes = [s for k in ('title', 'description', 'conditions', 'preconditions', 'operation',
                          'steps', 'expected', 'expected_result') for s in strings(scene.get(k))]
    quotes += strings((scene.get('ui_acceptance') or {}).get('visual_expectation'))
    return {'cases': cases, 'scene_texts': quotes}


def validate(value, input_value, answer, root, *, require_target_checks=False):
    value = deepcopy(value)
    def require(ok, message):
        if not ok:
            raise ValueError('评估引用或结构校验失败：' + message)
    def text(item, field, maximum, optional=False):
        v = item.get(field)
        require(isinstance(v, str) and (optional or bool(v.strip())) and len(v) <= maximum,
                f'{field} 必须是简洁文本（最多{maximum}字）')
        return v
    def rows(field, maximum):
        v = value.get(field)
        require(isinstance(v, list) and len(v) <= maximum and all(isinstance(x, dict) for x in v),
                field + ' 必须是结构化列表')
        return v
    def index(items, field):
        out = {}
        for x in items:
            key = text(x, field, 80)
            require(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,79}', key) is not None, field + ' 标识格式无效')
            require(key not in out, field + ' 重复：' + key)
            out[key] = x
        return out
    def refs(item, field, known, required=False):
        ids = item.get(field)
        require(isinstance(ids, list) and all(isinstance(x, str) for x in ids), field + ' 必须是标识列表')
        require(len(set(ids)) == len(ids) and set(ids) <= set(known), field + ' 含重复或未知标识')
        require(not required or bool(ids), field + ' 缺少依据')
        return ids
    require(isinstance(value, dict) and value.get('schema') == SCHEMA, '需要 ' + SCHEMA)
    text(value, 'summary', 180)
    require(value.get('coverage') in ('sufficient', 'partial', 'gap', 'uncertain'), '未知支持程度')
    ctx = context(input_value, answer)
    known_cases = {x['case_id']: x for x in ctx['cases']}
    root = Path(root).resolve()
    evidence = index(rows('evidence', 80), 'id')
    for e in evidence.values():
        name = text(e, 'file', 1000)
        relative = Path(name)
        path = (root / relative).resolve()
        require(not relative.is_absolute() and path.is_relative_to(root) and
                not set(relative.parts) & {'.git', '.acceptance', '.acceptance-local'}, '引用必须在源码工作区内')
        require(path.is_file(), '引用文件不存在：' + name)
        start, end = e.get('line_start'), e.get('line_end')
        require(type(start) is int and type(end) is int and 1 <= start <= end and end-start < 30, '引用行号无效')
        raw = path.read_bytes()
        lines = raw.decode('utf-8').splitlines()
        require(end <= len(lines), '引用行号越界：' + name)
        quote = text(e, 'quote', 1800)
        if quote not in '\n'.join(lines[start-1:end]):
            # A unique exact quotation can prove a one-line end-boundary typo.
            # Never relocate a quote to another start/test or rewrite its text.
            full = '\n'.join(lines)
            position = full.find(quote)
            actual_start = full[:position].count('\n') + 1 if position >= 0 else None
            actual_end = actual_start + quote.count('\n') if actual_start else None
            require(full.count(quote) == 1 and actual_start == start and actual_end == end + 1 and
                    actual_end - start < 30, '引用原文与行号不符：' + name)
            e['reported_line_end'] = end
            e['line_end'] = actual_end
            e['citation_resolution'] = 'unique_exact_quote_end_boundary'
        e['file_sha256'] = hashlib.sha256(raw).hexdigest()
    obligations = index(rows('obligations', 16), 'id')
    require(bool(obligations), '缺少场景义务')
    for o in obligations.values():
        quote = text(o, 'quote', 1000)
        require(any(quote in s for s in ctx['scene_texts']), '义务摘录不是当前场景原文')
        require(o.get('status') in ('supported', 'partial', 'unsupported', 'uncertain'), '未知义务支持程度')
        text(o, 'assessment', 160)
        refs(o, 'evidence_ids', evidence, o['status'] in ('supported', 'partial'))
    findings = index(rows('findings', 6), 'id')
    for f in findings.values():
        require(f.get('kind') in ('gap', 'quality', 'uncertainty', 'enhancement'), '未知问题类型')
        refs(f, 'obligation_ids', obligations, f['kind'] == 'gap')
        for field, limit in [('statement', 180), ('impact', 200), ('recommendation', 180)]:
            text(f, field, limit)
        refs(f, 'evidence_ids', evidence, bool(known_cases) and f['kind'] in ('gap', 'quality'))
    require(sum(f['kind'] == 'enhancement' for f in findings.values()) <= 2, '可选增强过多')
    assessments = index(rows('case_assessments', 200), 'case_id')
    require(set(assessments) == set(known_cases), '逐用例评价与当前关联不一致')
    for cid, a in assessments.items():
        require(a.get('role') in ('essential', 'complementary', 'duplicate', 'out_of_scope', 'uncertain'), '未知用例贡献类型')
        text(a, 'contribution', 180)
        related = refs(a, 'compared_with', known_cases, a['role'] == 'duplicate')
        require(cid not in related, '用例不能与自己比较')
        ids = refs(a, 'evidence_ids', evidence, a['role'] != 'uncertain')
        case = known_cases[cid]
        if a['role'] != 'uncertain':
            own = [evidence[x] for x in ids if evidence[x]['file'] == case['file']]
            if case['line_start'] and case['line_end']:
                own = [e for e in own if e['line_start'] <= case['line_end'] and e['line_end'] >= case['line_start']]
            require(bool(own), cid + ' 缺少自身测试正文引用')
        for other in related if a['role'] == 'duplicate' else []:
            c = known_cases[other]
            require(any(evidence[x]['file'] == c['file'] and (not c['line_start'] or
                evidence[x]['line_start'] <= (c['line_end'] or c['line_start']) and
                evidence[x]['line_end'] >= c['line_start']) for x in ids), '重复判断缺少对照用例证据')
        for e in (evidence[x] for x in ids if evidence[x]['file'] == case['file']):
            require(not case['file_sha256'] or case['file_sha256'] == e['file_sha256'], '关联测试源码已变化')
        if require_target_checks or 'checks' in a:
            checks = a.get('checks')
            require(isinstance(checks, list) and 1 <= len(checks) <= 20 and
                    all(isinstance(c, dict) for c in checks), cid + ' 缺少逐目标核验')
            for check in checks:
                text(check, 'target', 120)
                text(check, 'assessment', 180)
                if require_target_checks:
                    text(check, 'counterexample', 180)
                refs(check, 'evidence_ids', evidence, a['role'] != 'uncertain')
    text(value, 'selection_advice', 180)
    limitations = value.get('limitations')
    require(isinstance(limitations, list) and len(limitations) <= 3 and
            all(isinstance(x, str) and 0 < len(x) <= 180 for x in limitations), '限制说明应简洁')
    statuses = {o['status'] for o in obligations.values()}
    if value['coverage'] == 'sufficient':
        require(statuses == {'supported'} and not any(f['kind'] == 'gap' for f in findings.values()), '充分结论与必要缺口冲突')
    if value['coverage'] in ('partial', 'gap'):
        empty_group = not known_cases and value['coverage'] == 'gap' and statuses == {'unsupported'}
        require(empty_group or any(f['kind'] == 'gap' for f in findings.values()), '不足结论未列必要缺口')
    value['cases'] = ctx['cases']
    value['citation_check'] = 'source_quotes_verified'
    return value


def markdown_description(d):
    """Human copy retains typed issues and exact, hash-bound source quotations."""
    support = {'sufficient': '支持充分', 'partial': '部分支持', 'gap': '存在缺口', 'uncertain': '无法判断'}
    role = {'essential': '关键', 'complementary': '互补', 'duplicate': '重复', 'out_of_scope': '场景外', 'uncertain': '待确认'}
    cite = lambda x: ' '.join('[' + e + '](#' + e.lower() + ')' for e in x['evidence_ids'])
    lines = [support[d['coverage']] + '：' + d['summary'], '', '取舍建议：' + d['selection_advice'], '', '## 场景义务', '']
    for o in d['obligations']:
        lines += [f"- {o['id']}「{o['quote']}」：{o['assessment']} {cite(o)}"]
    for kind, label in [('gap', '必要缺口'), ('quality', '设计质量'), ('uncertainty', '待确认'), ('enhancement', '可选增强')]:
        items = [f for f in d['findings'] if f['kind'] == kind]
        if items:
            lines += ['', '## ' + label, '']
            for f in items:
                lines += [f"- {f['statement']}（{', '.join(f['obligation_ids'])}） {cite(f)}",
                          '  - 影响：' + f['impact'], '  - 建议：' + f['recommendation']]
    lines += ['', '## 用例贡献与取舍', '']
    names = {c['case_id']: c['title'] or c['file'] for c in d['cases']}
    for a in d['case_assessments']:
        lines += [f"- {a['case_id']} {names[a['case_id']]} · {role[a['role']]}：{a['contribution']} {cite(a)}"]
        for check in a.get('checks', []):
            lines += [f"  - {check['target']}：{check['assessment']} {cite(check)}"]
            if check.get('counterexample'):
                lines += ['    - 反例核验：' + check['counterexample']]
    lines += ['', '## 引用依据', '', '仅核对引用原文和文件哈希；语义判断仍需审阅。', '']
    for e in d['evidence']:
        lines += [f"<a id=\"{e['id'].lower()}\"></a>",
                  f"### {e['id']} · {e['file']}:{e['line_start']}–{e['line_end']}", '',
                  'SHA-256：' + e['file_sha256'], '', '```', e['quote'], '```', '']
        if e.get('citation_resolution'):
            lines += [f"原结束行 {e['reported_line_end']}；宿主按唯一原文校正为 {e['line_end']}。", '']
    if d['limitations']:
        lines += ['## 评估边界', ''] + ['- ' + x for x in d['limitations']]
    return lines


if __name__ == '__main__':
    inp, answer = (json.loads(Path(p).read_text()) for p in sys.argv[1:3])
    print(json.dumps(context(inp, answer), ensure_ascii=False))
