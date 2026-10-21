"""Structural output quality checks; semantic clarity is independently reviewed."""
import re

VERSION = 1
CJK_RE = re.compile(r'[\u3400-\u9fff]')
LATIN_RE = re.compile(r'[A-Za-z]')
PLACEHOLDERS = {
    '通过', '失败', '测试通过', '执行通过', '测试完成', '符合预期', '功能正常',
    '已验证', '已保存', '摘要', '待补充', '暂无', '无', 'passed', 'failed', 'ok',
    'done', 'summary', 'as expected', 'works', 'todo', 'tbd',
    '已保存执行结果，尚未记录简短摘要', '已保存独立评估，尚未记录简短摘要',
    '已保存测试方案，尚未记录简短摘要',
}


def meaningful(value):
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = re.sub(r'[。.!！;；\s]+$', '', value.strip()).lower()
    return normalized not in PLACEHOLDERS


def language_hint(value):
    """Return the dominant authored language family for a business string."""
    if not isinstance(value, str):
        return 'unknown'
    cjk = len(CJK_RE.findall(value))
    latin = len(LATIN_RE.findall(value))
    if cjk and cjk >= latin:
        return 'zh'
    if latin:
        return 'en'
    return 'other'


def explicit_language(value):
    """Normalize an optional requirement language/locale declaration."""
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().lower().replace('_', '-').split('-', 1)[0]
    if normalized in ('zh', 'cn', '中文', '简体中文', '繁体中文'):
        return 'zh'
    if normalized in ('en', '英语', '英文'):
        return 'en'
    return normalized


def requirement_language(requirement):
    """Use an explicit requirement language when present, otherwise infer it."""
    if isinstance(requirement, dict):
        declared = explicit_language(requirement.get('language') or requirement.get('locale'))
        if declared:
            return declared
        return language_hint(requirement.get('text', ''))
    return language_hint(requirement)


def language_matches(value, expected):
    """Business text must contain the expected script; technical tokens may remain unchanged."""
    if expected == 'zh':
        return bool(CJK_RE.search(value or ''))
    if expected == 'en':
        return bool(LATIN_RE.search(value or ''))
    return True


def summary_errors(value, label):
    if not meaningful(value) or len(value) > 180:
        return [label + ' needs a substantive short summary (at most 180 characters), not a status/placeholder']
    return []


def review_errors(value, required, label='output quality review', repair=False):
    """Require a scoped, reasoned review, not a boolean 'readable' declaration."""
    if not isinstance(value, dict):
        return [label + ' is required']
    errors = []
    status = value.get('status')
    if value.get('version') != VERSION or status not in ('passed', 'repair_required'):
        errors.append(label + ' needs version 1 and passed/repair_required status')
    if status != 'passed' and not repair:
        errors.append(label + ' requires correction before completion')
    findings = value.get('findings')
    if not isinstance(findings, list) or not all(meaningful(v) for v in findings):
        errors.append(label + ' needs a text findings list')
    elif status == 'passed' and findings or status == 'repair_required' and not findings:
        errors.append(label + ' status disagrees with findings')
    checks = value.get('checks')
    if not isinstance(checks, list):
        return errors + [label + ' needs per-artifact checks']
    seen = set()
    for check in checks:
        if not isinstance(check, dict) or not isinstance(check.get('artifact'), str):
            errors.append(label + ' check needs artifact and concrete reason')
            continue
        name = check['artifact']
        if name in seen or name not in required:
            errors.append(label + ': duplicate/unknown artifact ' + name)
        seen.add(name)
        if not meaningful(check.get('reason')):
            errors.append(label + ': ' + name + ' needs a concrete clarity/accuracy judgment')
        if name in required and required[name] is not None:
            ids = check.get('record_ids')
            if not isinstance(ids, list) or not all(isinstance(v, str) and v for v in ids) or len(ids) != len(set(ids)) or set(ids) != set(required[name]):
                errors.append(label + ': ' + name + ' must enumerate exactly the reviewed records')
    errors.extend(label + ': missing artifact ' + name for name in required.keys() - seen)
    return errors


def design_errors(scenario_map, method_map, requirement_map=None, language_override=None):
    errors = []
    for sid, scene in scenario_map.items():
        if 'method_ids' in scene:
            errors.append(f'scenario {sid}: store acceptance inline; independent method_ids are no longer supported')
        for field in ('title', 'expected', 'priority_reason'):
            if not meaningful(scene.get(field)):
                errors.append(f'scenario {sid}: {field} must state the concrete condition, behavior or risk')
        if isinstance(scene.get('title'), str) and len(scene['title']) > 120:
            errors.append(f'scenario {sid}: title exceeds 120 characters; move details to expected/acceptance')
        if requirement_map is not None and scene.get('kind') == 'black_box':
            requirements = [requirement_map[rid] for rid in scene.get('requirement_ids', []) if rid in requirement_map]
            expected_languages = {language_override} if language_override else {requirement_language(req) for req in requirements}
            if len(expected_languages) == 1:
                expected_language = next(iter(expected_languages))
                if expected_language in ('zh', 'en') and not language_matches(scene.get('title'), expected_language):
                    errors.append(f'scenario {sid}: title must follow the linked requirement language ({expected_language})')
        if scene.get('kind') == 'white_box' and not meaningful(scene.get('target_condition')):
            errors.append(f'scenario {sid}: target_condition needs a concrete branch/state and consequence')
    for mid, method in method_map.items():
        errors.extend(summary_errors(method.get('description'), 'scenario acceptance ' + mid))
        for field in ('preconditions', 'actions', 'criteria', 'evidence_expected'):
            value = method.get(field)
            if not isinstance(value, list) or not value or not all(meaningful(v) for v in value):
                errors.append(f'scenario acceptance {mid}: {field} needs a nonempty list of substantive individual items')
    return errors
