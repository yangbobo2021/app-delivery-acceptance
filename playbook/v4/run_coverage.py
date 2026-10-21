#!/usr/bin/env python3
"""Evidence-bound execution through a prepared project-owned coverage entry."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
from coverage_protocol import PROTOCOL, read, sha, save, preparation, invoke, verify_report

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]/'scripts'))


def execution_binding(request,active):
    from acceptance_store import guard,inside,locations,owned_path
    binding=active.get('acceptance') or request.get('acceptance')
    if not binding:
        if '.acceptance-local' in Path(request['cwd']).absolute().parts:
            raise ValueError('Acceptance coverage requires a bound catalog')
        return
    if request.get('acceptance') and request['acceptance']!=binding:raise ValueError('Coverage acceptance mismatch')
    guard({'acceptance':binding,'source_checkout':request['cwd']},[request['output'],*request.get('fresh_dirs',[])])
    _,_,local=locations(binding['project_root'],binding['id'])
    if Path(request['cwd']).resolve()!=inside(local,'workspace'):raise ValueError('Coverage must use the acceptance workspace')
    for key in request.get('output_env_dir_keys',[]):
        if request.get('env',{}).get(key):owned_path(local/'workflows',request['env'][key])


def validate_session(path,root,output,command):
    """The ordinary recorder may bypass required collection only for this wrapper."""
    request=read(path);config=request['coverage']
    from coverage_registry import project_coverage
    active=project_coverage(root,config) or {}
    execution_binding(request,active)
    profile=preparation(active,run_check=False)
    if (request.get('prepared')!=active['prepared'] or
        request.get('prepared_sha256')!=sha(Path(active['prepared'])/'prepared.json') or
        (config.get('scene_id') and config['scene_id']!=request.get('scene_id'))):
        raise ValueError('Coverage session differs from the active scene/preparation')
    if (Path(request['cwd']).resolve()!=Path(root).resolve() or
        Path(output).resolve()!=Path(request['output']).resolve()/'command' or
        command!=[*profile['entry'],'run',str(Path(path).resolve()),str(Path(request['output']).resolve()/'run-response.json')]):
        raise ValueError('Coverage execution session does not bind this command/output')
    return request,profile


def run_coverage(request):
    config=request.get('coverage') or {}
    root=Path(request['cwd']).resolve();out=Path(request['output']).resolve()
    from coverage_registry import project_coverage,ensure_active,register
    active=project_coverage(root,config) or config
    execution_binding(request,active)
    if config.get('protocol')!=PROTOCOL:
        candidate=read(Path(request['prepared'])/'prepared.json')
        if candidate.get('schema')!='project-coverage-preparation-v1':
            from legacy_coverage_execution import run_coverage as legacy
            return legacy(request)
        config={'policy':'required','protocol':PROTOCOL,'prepared':request['prepared']}
    root=Path(request['cwd']).resolve();out=Path(request['output']).resolve()
    from coverage_registry import project_coverage,ensure_active,register
    active=project_coverage(root,config) or config
    execution_binding(request,active)
    profile=preparation(active)
    ensure_active(active['prepared'])
    spec=profile['spec']
    if Path(spec['project_root']).resolve()!=root:raise ValueError('Coverage project root mismatch')
    if not request.get('scene_id') or not request.get('command'):raise ValueError('Coverage needs an exact scene/command')
    if config.get('scene_id') and config['scene_id']!=request['scene_id']:raise ValueError('Coverage request differs from the bound scene')
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    if revision!=spec['revision'] or request.get('revision',revision)!=revision:raise ValueError('Product revision changed')
    if request.get('inventory_path') and sha(request['inventory_path'])!=sha(spec['inventory_path']):raise ValueError('Coverage scope inventory mismatch')
    for name,digest in spec['source_hashes'].items():
        if sha(root/name)!=digest:raise ValueError('Original product source changed: '+name)
    required={**profile['adapter_files'],**active.get('required_test_files',{})}
    for name,digest in required.items():
        if sha(root/name)!=digest:raise ValueError('Prepared coverage fixture changed: '+name)
    files=list(dict.fromkeys([*request['files'],*required]))
    for name in files:
        file=(root/name).resolve()
        if not file.is_relative_to(root) or not file.is_file():raise ValueError('Coverage test file escapes project: '+name)
    out.mkdir(parents=True,exist_ok=False)
    frozen={**request,'cwd':str(root),'output':str(out),'files':files,'coverage':active,
            'prepared':active['prepared'],'prepared_sha256':sha(Path(active['prepared'])/'prepared.json')}
    request_path=out/'coverage-request.json';save(request_path,frozen)
    command=[sys.executable,str(HERE/'run_evidence_v2.py'),'--cwd',str(root),'--output',str(out/'command'),
             '--coverage-session',str(request_path)]
    for name in files:command+=['--file',name]
    for fresh in request.get('fresh_dirs',[]):command+=['--fresh-dir',fresh]
    for key,value in request.get('env',{}).items():command+=['--env',key+'='+value]
    command+=['--',*profile['entry'],'run',str(request_path),str(out/'run-response.json')]
    try:
        with (out/'host.log').open('wb') as log:
            completed=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
        receipt=out/'command/execution.json'
        if not receipt.is_file():raise ValueError('Project coverage execution produced no receipt; inspect host.log')
        shutil.copy2(receipt,out/'execution.json');shutil.copy2(out/'command/execution.log',out/'execution.log')
        for name,digest in spec['source_hashes'].items():
            if sha(root/name)!=digest:raise ValueError('Coverage adapter did not restore original source: '+name)
        invoke(profile,'finish',{'request':str(request_path),'receipt':str(out/'execution.json'),
             'output':str(out)},out/'coverage-report.json')
        verify_report(out/'coverage-report.json',out/'execution.json')
        register(out/'coverage-report.json')
        return read(out/'execution.json')['exit_code']
    finally:
        save(out/'restored-source.json',{name:sha(root/name) for name in spec['source_hashes']})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('request');args=parser.parse_args()
    sys.exit(run_coverage(read(args.request)))
