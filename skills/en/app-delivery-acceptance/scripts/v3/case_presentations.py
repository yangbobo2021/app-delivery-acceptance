"""Human-facing case information, independent of execution and verdicts."""
from copy import deepcopy
import hashlib


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def case_description(value, origin='unknown'):
    source = value.get('source') if isinstance(value.get('source'), dict) else {}
    return {'id': value.get('id', ''), 'name': value.get('name') or value.get('title') or '未命名用例',
            'method': value.get('method') or value.get('input_and_operation') or value.get('procedure') or '',
            'assertions': value.get('assertions') or '',
            'boundary': value.get('boundary') or '\n'.join(str(x) for x in
                [value.get('mock_boundary'), value.get('limitations')] if x) or '',
            'command': value.get('command') or value.get('test_command') or [],
            'source': {**source, 'origin': source.get('origin', origin),
                       'file': source.get('file') or value.get('file') or value.get('test_file') or '',
                       'title': source.get('title') or value.get('title') or '',
                       'line_start': source.get('line_start') or value.get('line_start'),
                       'line_end': source.get('line_end') or value.get('line_end'),
                       'revision': source.get('revision') or value.get('revision') or value.get('version') or '',
                       'file_sha256': source.get('file_sha256') or value.get('file_sha256') or '',
                       'verification': value.get('source_verification') or source.get('verification', '')}}


def display_names(shared):
    """Optional presentation copy, bound to original test identity and bytes."""
    from acceptance_store import read
    path = shared / 'case-display.json'
    if not path.is_file():
        return {}
    value = read(path)
    if value.get('schema') != 'acceptance-case-display-v1' or value.get('acceptance_id') != shared.name:
        raise ValueError('case display names have a different schema or acceptance ID')
    names = {}
    for item in value['cases']:
        if not all(isinstance(item.get(k), str) and item[k].strip() for k in
                   ('id', 'name', 'source_title', 'file_sha256')) or item['id'] in names:
            raise ValueError('invalid or duplicate case display name')
        names[item['id']] = item
    return names


def bound_evaluation(report, answer_path):
    if not isinstance(report, dict) or report.get('schema') != 'case-evaluation-description-v1' or report.get('advisory_only') is not True:
        return None
    value = deepcopy(report)
    if value.get('status') == 'available' and (not answer_path.is_file() or
            value.get('binding', {}).get('answer_sha256') != digest(answer_path)):
        return {'status': 'stale', 'reason': '评估对应较早的用例版本，当前用例待评估。'}
    return value


def static_evaluation(shared, scene, associations, definition_sha=None):
    from acceptance_store import inside, read
    folder = inside(shared, 'records/descriptions/' + scene['id'])
    report = folder / 'case-evaluation.json'
    if not report.is_file():
        return None
    value = bound_evaluation(read(report), folder / 'static-associations.json')
    if not value or value.get('status') != 'available':
        return value
    input_path = folder / 'static-input.json'
    if not input_path.is_file() or value.get('binding', {}).get('input_sha256') != digest(input_path):
        return {'status': 'stale', 'reason': '评估输入缺失或已变化，无法核对。'}
    frozen = read(input_path)
    if frozen.get('scene') != scene or (definition_sha and frozen.get('definition_binding_sha256') != definition_sha):
        return {'status': 'stale', 'reason': '评估对应的场景定义已变化，当前场景待评估。'}
    original = read(folder / 'static-associations.json').get('associated_tests', [])
    identity = lambda tests: sorted((t['id'], t.get('file_sha256')) for t in tests)
    if identity(original) != identity(associations.get('tests', [])):
        return {'status': 'stale', 'reason': '关联用例已变化，当前用例组待评估。'}
    return value


def attach_case_presentations(rows, shared=None):
    names, title_warning = {}, ''
    if shared:
        try:
            names = display_names(shared)
        except (ValueError, OSError, KeyError, TypeError) as error:
            title_warning = '展示标题读取失败，保留原始标题：' + str(error)
    for trace in rows:
        presentations = {}
        for scene in trace.get('scenarios', []):
            sid = scene['id']
            association = trace.get('static_case_associations', {}).get(sid)
            bindings = [b for b in trace.get('bindings', []) if b.get('scenario_id') == sid]
            descriptions = trace.get('case_descriptions') or []
            if descriptions or bindings:
                cases = [case_description(x) for x in descriptions or bindings if isinstance(x, dict)]
                for case in cases:
                    case['source']['revision'] = case['source']['revision'] or trace.get('project', {}).get('revision', '')
                    case['command'] = case['command'] or next((b.get('command', []) for b in bindings if b.get('command')), [])
                evaluation = trace.get('case_evaluation')
                basis, limitations = '', ''
            elif association is not None:
                cases = [case_description(x, 'existing') for x in association['tests']]
                try:
                    evaluation = static_evaluation(shared, scene, association, trace.get('current_definition_sha256')) if shared else None
                except (ValueError, OSError, KeyError, TypeError) as error:
                    evaluation = {'status': 'unavailable', 'reason': '独立评估读取失败：' + str(error)}
                basis, limitations = association.get('mapping_basis', ''), association.get('limitations', '')
            else:
                cases, evaluation, basis, limitations = [], None, '', ''
            for case in cases:
                override = names.get(case['id'])
                if override and override['source_title'] == case['source']['title'] and override['file_sha256'] == case['source']['file_sha256']:
                    case['name'] = override['name']
            presentations[sid] = {'cases': cases, 'evaluation': evaluation,
                                  'title_warning': title_warning,
                                  'association_basis': basis, 'search_limitations': limitations,
                                  'empty_reason': ('在本轮静态检索范围内未找到关联用例。' if association is not None
                                                   else '尚无用例说明。')}
        trace['case_presentations'] = presentations
