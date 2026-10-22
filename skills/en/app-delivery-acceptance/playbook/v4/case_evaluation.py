"""Best-effort human-facing evaluation; never schedules, repairs or gates tests."""
import hashlib
import json
from pathlib import Path


def describe(config, output, prepared, answer_path, run):
    output = Path(output)
    report = output / 'case-evaluation.json'
    answer_path = Path(answer_path)
    input_path = Path(config['case_input'])
    catalog_path = Path(prepared['catalog'])
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    binding = {'input_sha256': sha(input_path), 'answer_sha256': sha(answer_path),
               'catalog_sha256': sha(catalog_path)}
    if report.exists():
        previous = json.loads(report.read_text())
        if previous.get('binding') == binding:
            return previous
    result = {'schema': 'case-evaluation-description-v1', 'advisory_only': True,
              'binding': binding, 'status': 'unavailable'}
    if config.get('case_evaluation', True) is False:
        result['status'] = 'off'
    else:
        # Different case answers get distinct attempts; an advisory failure never retries itself.
        directory = output / ('case-evaluation-' + sha(answer_path)[:16])
        try:
            if not directory.exists():
                run(['node', str(Path(__file__).with_name('run_case_evaluation_v1.mjs')),
                     str(input_path), str(catalog_path), str(answer_path), str(directory)],
                    log=output / 'case-evaluation-stage.log', timeout=300)
            metrics = json.loads((directory / 'metrics.json').read_text())
            answer = json.loads((directory / 'answer.json').read_text())
            if metrics.get('status') != 'success' or not isinstance(answer.get('summary'), str):
                raise ValueError('evaluation Agent did not return a completed description')
            result.update(status='available', description=answer, answer=str(directory / 'answer.json'))
        except Exception as error:
            result['reason'] = str(error)[:1500]
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    lines = ['# 场景关联用例评估', '', '仅供人阅读；不改变执行列表、门禁、修补或正式结论。', '']
    if result['status'] == 'available':
        description = result['description']
        lines.extend([description['summary'], '', '覆盖评估：' + str(description.get('coverage', 'uncertain'))])
        for key, label in [('supported', '支持范围'), ('gaps', '覆盖缺口'),
                           ('quality_issues', '用例质量'), ('redundancy', '可能重复'),
                           ('test_assessments', '逐用例说明')]:
            lines.extend(['', '## ' + label, ''])
            for item in description.get(key, []):
                lines.append('- ' + (item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)))
    else:
        lines.append('评估说明未生成：' + result.get('reason', result['status']) + '。原执行流程继续。')
    (output / 'case-evaluation.md').write_text('\n'.join(lines) + '\n')
    return result
