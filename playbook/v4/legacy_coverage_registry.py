"""Append scene evidence and publish an atomic, tool-generated live summary.

No coverage arithmetic occurs here. A project keeps this registry across later
scenes; a different prepared profile starts a separate statistics collection.
"""
from pathlib import Path
import fcntl
import hashlib
import json
import subprocess
import sys
import tempfile

PROVIDER=Path(__file__).resolve().parents[2]/'scripts/coverage-istanbul/provider.mjs'
def read(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,data):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    temp=p.with_suffix(p.suffix+'.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');temp.replace(p)
def _git(root,*args):
    return subprocess.check_output(['git',*args],cwd=root,text=True,stderr=subprocess.DEVNULL).strip()
def project_policy_path(root):
    try:return Path(_git(root,'rev-parse','--path-format=absolute','--git-common-dir'))/'delivery-acceptance-coverage.json'
    except (subprocess.CalledProcessError,OSError):return None
def project_coverage(root,declared=None):
    path=project_policy_path(root)
    if not path or not path.is_file():return declared
    policy=read(path);active=policy['coverage']
    if _git(root,'rev-parse','HEAD')!=policy['revision']:
        raise ValueError('Project coverage requires validated preparation for this revision')
    if sha(Path(active['prepared'])/'prepared.json')!=policy['prepared_sha256']:
        raise ValueError('Active project coverage preparation changed')
    if declared:
        if declared.get('policy')!='required':raise ValueError('Active project cannot downgrade required coverage; rebind the latest catalog')
        if any(declared.get(k)!=active[k] for k in ['provider','prepared']):
            raise ValueError('Scene differs from the active project coverage; rebind the latest catalog')
        for key in ['required_test_files', 'acceptance']:
            if key in declared and key in active and declared[key] != active[key]:
                raise ValueError('Scene cannot replace project coverage binding: ' + key)
    return {**active,**(declared or {})}
def paths(prepared):
    p=read(Path(prepared)/'prepared.json')
    unsupported=[name for name in p.get('files',{}) if Path(name).suffix.lower() not in {'.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts'}]
    if unsupported:raise ValueError('Registered Istanbul provider cannot instrument another language: '+str(unsupported))
    registry=p['spec'].get('registry_path')
    if not registry:return p,None,None
    registry=Path(registry)
    return p,registry,registry.with_name('coverage-view.json')
def ensure_active(prepared):
    p,registry,_=paths(prepared)
    if registry and (not registry.exists() or read(registry).get('active_profile')!=sha(Path(prepared)/'prepared.json')):
        raise ValueError('Coverage profile is not active; validate/activate the project preparation first')
    if registry and read(registry).get('active_inventory_sha256')!=sha(p['spec']['inventory_path']):
        raise ValueError('Frozen coverage scope inventory changed')
def activate(prepared,catalog=None):
    bound = read(catalog) if catalog else None
    policy = project_policy_path(read(Path(prepared)/'prepared.json')['spec']['project_root'])
    previous = read(policy) if policy and policy.is_file() else {}
    if not bound and previous.get('coverage', {}).get('acceptance'):
        if previous.get('prepared_sha256') != sha(Path(prepared)/'prepared.json'):
            raise ValueError('New acceptance coverage preparation requires its bound project catalog')
        bound = {'acceptance': previous['coverage']['acceptance'],
                 'coverage_test_files': previous['coverage'].get('required_test_files', {})}
    if bound and bound.get('acceptance'):
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
        from acceptance_store import guard
        guard({'acceptance':bound['acceptance'], 'source_checkout':read(Path(prepared)/'prepared.json')['spec']['project_root']}, [prepared])
    subprocess.run(['node',str(PROVIDER),'verify-preparation',str(prepared)],check=True,stdout=subprocess.PIPE)
    p,registry,view=paths(prepared)
    if not registry:return
    registry.parent.mkdir(parents=True,exist_ok=True)
    with registry.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        data=read(registry) if registry.exists() else {'schema':'continuous-coverage-index-v1','entries':[]}
        key=sha(Path(prepared)/'prepared.json')
        inventory_hash=sha(p['spec']['inventory_path'])
        if data.get('active_profile')==key and data.get('active_inventory_sha256')!=inventory_hash:
            raise ValueError('Cannot change the scope inventory of an active preparation')
        data.update(active_profile=key,active_prepared=str(Path(prepared).resolve()),active_inventory_sha256=inventory_hash)
        save(registry,data)
        if not view.exists() or read(view).get('profile')!=key:
            save(view,{'profile':key,'prepared':str(Path(prepared).resolve()),'tools':p['tools'],'entries':[],'summary':None})
        policy=project_policy_path(p['spec']['project_root'])
        if policy:
            coverage={'policy':'required','provider':p['tools']['provider'],'prepared':str(Path(prepared).resolve()),'inventory_path':p['spec']['inventory_path']}
            if bound:
                coverage.update(required_test_files=bound.get('coverage_test_files', {}),
                                acceptance=bound['acceptance'])
            save(policy,{'schema':'project-required-coverage-v1','coverage':coverage,'revision':p['spec']['revision'],
              'prepared_sha256':key,'catalog':str(Path(catalog).resolve()) if catalog else None})
def register(report_path):
    r=read(report_path);prepared=Path(r['prepared'])
    p,registry,view=paths(prepared)
    if not registry:return
    ensure_active(prepared)
    subprocess.run(['node',str(PROVIDER),'verify',str(report_path)],check=True,stdout=subprocess.PIPE)
    out=Path(report_path).parent;receipt=read(out/'execution.json')
    snapshot={'schema':'dedicated-coverage-evidence-v1','scene_id':r['scene_id'],
      'prepared_sha256':r['prepared_sha256'],'report_sha256':sha(report_path),'receipt_sha256':sha(out/'execution.json'),
      'raw_evidence':r['raw_evidence'],'build_sha256':sha(out/'coverage-build.json'),
      'restored_source_sha256':sha(out/'restored-source.json')}
    save(out/'coverage-freeze.json',snapshot)
    item={'id':r['scene_id'],'scene_id':r['scene_id'],'profile':r['prepared_sha256'],
      'output':str(out.resolve()),'report':str(Path(report_path).resolve()),'report_sha256':sha(report_path),
      'exit_code':r['case_exit_code'],'ended_at':receipt['end_utc']}
    with registry.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        data=read(registry)
        if data['active_profile']!=item['profile']:raise ValueError('Project coverage profile changed while case ran')
        same=[x for x in data['entries'] if x['report']==item['report']]
        if same and same[0]!=item:raise ValueError('Immutable registered report changed')
        if not same:data['entries'].append(item)
        latest={}
        for entry in data['entries']:
            if entry['profile']!=item['profile']:continue
            old=latest.get(entry['scene_id'])
            if old is None or entry['ended_at']>old['ended_at']:latest[entry['scene_id']]=entry
        inventory_path=p['spec'].get('inventory_path')
        with tempfile.TemporaryDirectory(prefix='coverage-registry-') as folder:
            request=Path(folder)/'input.json';summary=Path(folder)/'summary.json'
            save(request,{'reports':[x['report'] for x in latest.values()],
                          'inventory':read(inventory_path) if inventory_path else None})
            subprocess.run(['node',str(PROVIDER),'summarize',str(request),str(summary)],check=True,stdout=subprocess.PIPE)
            from coverage_collection_check import check_collection
            checks={entry['scene_id']:check_collection((Path(entry['output'])/'execution.log').read_text(errors='replace'),sha(Path(entry['output'])/'execution.json')) for entry in latest.values()}
            limits=sorted({reason for check in checks.values() for reason in check['limitations']})
            save(registry,data)
            save(view,{'profile':item['profile'],'prepared':str(prepared),'tools':p['tools'],
                       'entries':list(latest.values()),'summary':read(summary),'collection_checks':checks,'collection_limitations':limits})

if __name__=='__main__':
    {'activate':activate,'register':register}[sys.argv[1]](sys.argv[2])
