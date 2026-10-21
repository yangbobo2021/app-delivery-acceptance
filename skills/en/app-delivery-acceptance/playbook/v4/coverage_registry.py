"""Continuous evidence index; project tools own collection and statistics."""
from pathlib import Path
import fcntl
import json
import subprocess
import sys
from coverage_protocol import PROTOCOL, read, sha, save, preparation, verify_report, summarize_reports


def project_policy_path(root):
    try:
        # A Git repository may contain several acceptance projects in distinct
        # worktrees. The common dir would let one project's preparation replace
        # another's active binding before its scene can run.
        value=subprocess.check_output(['git','rev-parse','--absolute-git-dir'],cwd=root,text=True,stderr=subprocess.DEVNULL).strip()
        return Path(value)/'delivery-acceptance-coverage.json'
    except (OSError,subprocess.CalledProcessError):return None


def project_coverage(root,declared=None):
    path=project_policy_path(root)
    if not path or not path.is_file():return declared
    policy=read(path);active=policy['coverage']
    if active.get('protocol')!=PROTOCOL:
        from legacy_coverage_registry import project_coverage as legacy
        return legacy(root,declared)
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    if revision!=policy['revision']:raise ValueError('Project coverage requires new preparation for this revision')
    preparation(active,run_check=False)
    if declared:
        if declared.get('policy')!='required':raise ValueError('Active project cannot downgrade required coverage; rebind latest catalog')
        for key in ('protocol','prepared','prepared_sha256','required_test_files','acceptance'):
            if key in declared and declared[key]!=active.get(key):raise ValueError('Scene cannot replace project coverage binding: '+key)
    return {**active,**(declared or {})}


def paths(prepared):
    value=read(Path(prepared)/'prepared.json')
    if value.get('schema')!='project-coverage-preparation-v1':
        from legacy_coverage_registry import paths as legacy
        return legacy(prepared)
    registry=Path(value['spec']['registry_path'])
    return value,registry,registry.with_name('coverage-view.json')


def ensure_active(prepared):
    profile,registry,_=paths(prepared)
    if profile.get('schema')!='project-coverage-preparation-v1':
        from legacy_coverage_registry import ensure_active as legacy
        return legacy(prepared)
    if not registry.is_file() or read(registry).get('active_profile')!=sha(Path(prepared)/'prepared.json'):
        raise ValueError('Coverage preparation is not active')
    if read(registry).get('active_inventory_sha256')!=sha(profile['spec']['inventory_path']):
        raise ValueError('Frozen coverage scope inventory changed')


def activate(prepared,catalog=None):
    profile,registry,view=paths(prepared)
    if profile.get('schema')!='project-coverage-preparation-v1':
        from legacy_coverage_registry import activate as legacy
        return legacy(prepared,catalog)
    binding=read(catalog) if catalog else {}
    config={'policy':'required','protocol':PROTOCOL,'prepared':str(Path(prepared).resolve()),
            'prepared_sha256':sha(Path(prepared)/'prepared.json'),
            'inventory_path':profile['spec']['inventory_path'],
            'required_test_files':binding.get('coverage_test_files',profile['adapter_files'])}
    if binding.get('acceptance'):
        config['acceptance']=binding['acceptance']
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
        from acceptance_store import guard
        guard({'acceptance':binding['acceptance'],'source_checkout':profile['spec']['project_root']},[prepared])
    preparation(config)
    registry.parent.mkdir(parents=True,exist_ok=True)
    with registry.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        data=read(registry) if registry.exists() else {'schema':'project-coverage-index-v1','entries':[]}
        if data.get('active_profile')==config['prepared_sha256'] and data.get('active_inventory_sha256')!=sha(config['inventory_path']):
            raise ValueError('Cannot change frozen coverage inventory')
        data.update(active_profile=config['prepared_sha256'],active_prepared=config['prepared'],active_inventory_sha256=sha(config['inventory_path']))
        save(registry,data)
        if not view.exists() or read(view).get('profile')!=config['prepared_sha256']:
            save(view,{'profile':config['prepared_sha256'],'tools':profile['tools'],'entries':[],'summary':None})
        policy=project_policy_path(profile['spec']['project_root'])
        if policy:save(policy,{'schema':'project-required-coverage-v1','coverage':config,'revision':profile['spec']['revision'],'catalog':str(catalog) if catalog else None})


def register(report_path):
    report=read(report_path)
    if report.get('protocol')!=PROTOCOL:
        from legacy_coverage_registry import register as legacy
        return legacy(report_path)
    report=verify_report(report_path,Path(report_path).with_name('execution.json'))
    profile,registry,view=paths(report['prepared']);ensure_active(report['prepared'])
    receipt=read(Path(report_path).with_name('execution.json'))
    item={'scene_id':report['scene_id'],'profile':report['prepared_sha256'],'report':str(Path(report_path).resolve()),
          'report_sha256':sha(report_path),'ended_at':receipt['end_utc'],'exit_code':receipt['exit_code']}
    with registry.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        data=read(registry)
        if data['active_profile']!=item['profile']:raise ValueError('Coverage profile changed during collection')
        same=[entry for entry in data['entries'] if entry['report']==item['report']]
        if same and same[0]!=item:raise ValueError('Immutable coverage report changed')
        if not same:data['entries'].append(item)
        latest={}
        for entry in data['entries']:
            if entry['profile']==item['profile'] and (entry['scene_id'] not in latest or entry['ended_at']>latest[entry['scene_id']]['ended_at']):latest[entry['scene_id']]=entry
        summary=summarize_reports([entry['report'] for entry in latest.values()],read(profile['spec']['inventory_path']))
        save(registry,data)
        save(view,{'profile':item['profile'],'prepared':report['prepared'],'tools':profile['tools'],'entries':list(latest.values()),'summary':summary})


if __name__=='__main__':
    {'activate':activate,'register':register}[sys.argv[1]](*sys.argv[2:])
