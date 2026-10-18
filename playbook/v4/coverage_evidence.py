"""Freeze tool-verified project coverage without choosing a language/tool."""
from pathlib import Path
from coverage_protocol import PROTOCOL, read, sha, save, verify_report


def evidence_paths(result):
    if result.get('status') not in ('measured','incomplete'):return []
    if result.get('protocol')==PROTOCOL:
        return [Path(item['path']) for item in result['raw_evidence']]
    return [Path(result['line_raw_path'])]


def freeze_coverage(spec,root,execution_dir,receipt_path,destination):
    spec=spec or {'policy':'unavailable','reason':'No project coverage preparation was supplied'}
    policy=spec.get('policy')
    if policy=='required':
        if spec.get('protocol')!=PROTOCOL:
            from legacy_coverage_evidence import freeze_coverage as legacy
            return legacy(spec,root,execution_dir,receipt_path,destination)
        path=Path(execution_dir)/'coverage-report.json'
        result=verify_report(path,receipt_path)
        result={**result,'report_path':str(path),'report_sha256':sha(path),
                'capture_end':read(receipt_path)['end_utc']}
    elif policy in {'off','unavailable'}:
        result={'status':policy,'reason':spec.get('reason','Explicitly skipped' if policy=='off' else 'Project coverage preparation unavailable')}
        for name in ('tools','tool'):
            if spec.get(name):result[name]=spec[name]
    else:raise ValueError('coverage policy must be required, unavailable or off')
    target=Path(destination).with_name(Path(destination).name+'.json');save(target,result)
    return result,target
