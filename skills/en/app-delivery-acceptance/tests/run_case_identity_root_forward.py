#!/usr/bin/env python3
"""Native finder regression for one exact root-level file across two scenarios."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

SKILL=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(SKILL/'scripts'),str(SKILL/'playbook/v4'),str(SKILL/'tests')]
from acceptance_store import initialize, read_knowledge, publish_catalog, read, save, digest, finish_acceptance
from acceptance_definitions import binding, scene_input
from acceptance_workspace import workspace_lease, finish_scene, verify_frozen_workspace
from case_identity import verify, MARKER
from scene_pipeline import collect_files
from run_case_discovery_forward import git, run_bounded


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    if not os.environ.get('ACCEPTANCE_AGENT') or not os.environ.get('ACCEPTANCE_MODEL'):parser.error('Explicit caller runtime required')
    output=args.output.resolve()
    if output.exists():parser.error('Use a new output directory')
    output.mkdir(parents=True);root=output/'project';root.mkdir()
    fixture=SKILL/'tests/fixtures/case_discovery/python-ledger'
    shutil.copy2(fixture/'ledger.py',root/'ledger.py');shutil.copy2(fixture/'checks/test_accounts.py',root/'test_accounts.py')
    (root/'README.md').write_text('Run: python3 -m unittest -v test_accounts\n')
    original=(root/'test_accounts.py').read_bytes()
    git(root,'init','-q');git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=test@example.invalid','commit','-qm','root tests fixture')
    at='AT-ID-root';store=initialize(root,at,'根目录用例身份验收','host',{'purpose':'exact file scope and stable IDs'},'User authorized isolated tests')
    local=Path(store['local']);workspace=local/'workspace';git(root,'clone','-q',str(root),str(workspace))
    acceptance=read_knowledge(root,at,[])['acceptance']
    text='余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。'
    publish_catalog(root,at,{'schema':'acceptance-catalog-v2','project':{'id':'root-file'},'context':{'business_goal':'跨场景追踪同一测试。'},'basis':'controlled fixture contract',
        'requirements':[],'reverse_rules':[],'scenarios':[{'id':sid,'title':text,'description':text,'priority':'P1','priority_reason':'身份复用验收','related_refs':[],'external_refs':[],
        'origin':{'kind':'fixture','reference':'native identity regression'},'check':{'method':'host','basis':'frozen before native run'}} for sid in ['SC1','SC2']]})
    config={'acceptance':acceptance,'definitions':binding(root,at),'workspace_policy':'single-acceptance-v1','source_checkout':str(root)}
    catalog={'schema':'portable-project-catalog-v1',**config,'project_root':str(workspace),'revision':git(workspace,'rev-parse','HEAD'),'components':[],
        'test_roots':['test_accounts.py'],'write_roots':['test_accounts.py'],'source_roots':['ledger.py'],'source_hashes':{'ledger.py':digest(workspace/'ledger.py')},'coverage':{'policy':'off'},'runner_hints':[]}
    save(local/'catalog.json',catalog);save(local/'guide.json',{'summary':'Python standard-library unittest is ready; use the README entry. No installation needed.','existing_test_examples':[],'uncertainties':[]})
    files=['playbook/v4/run_case_guided_v6.mjs','playbook/v4/case_identity.py','playbook/v4/existing_case_policy.py','playbook/v4/scene_pipeline.py','scripts/acceptance_workspace.py']
    result={'schema':'case-id-root-forward-v1','implementation':{n:digest(SKILL/n) for n in files},'rows':[]};prior=None
    for scene in ['SC1','SC2']:
        value={**config,**scene_input(config,scene),'case_strategy':'existing_only','existing_case_mode':'discover_only','coverage':{'policy':'off'}}
        path=local/(scene+'-input.json');save(path,value);folder=local/'workflows'/scene;folder.parent.mkdir(exist_ok=True)
        env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','ACCEPTANCE_WORKSPACE_LEASE':str(folder)}
        with workspace_lease(config,folder,scene=True):
            exit_code=run_bounded(['node',str(SKILL/'playbook/v4/run_existing_case_v1.mjs'),str(path),str(local/'catalog.json'),str(local/'guide.json'),str(folder)],workspace,local/(scene+'.log'),env,600)
            metrics=read(folder/'metrics.json');answer=read(folder/'answer.json');report=verify(answer,workspace,scene_id=scene,acceptance_id=at)
            ids={c['id'] for c in report['cases']}
            assert exit_code==0 and metrics['status']=='success' and len(ids)==2
            assert answer['status']=='not_executed' and answer['observations']==[]
            assert prior is None or prior==ids
            assert b''.join(line for line in (workspace/'test_accounts.py').read_bytes().splitlines(keepends=True) if not MARKER.fullmatch(line.decode().rstrip('\r\n')))==original
            verify_frozen_workspace(config,catalog);assert collect_files(workspace,answer,catalog)==['test_accounts.py']
            command=['python3','-m','unittest','-v','test_accounts.Accounts.test_examples','test_accounts.Accounts.test_declined']
            with (local/(scene+'-behavior.log')).open('w') as log:
                checked=subprocess.run(command,cwd=workspace,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=60)
            assert checked.returncode==0
            row={'scene_id':scene,'status':'passed','ids':sorted(ids),'behavior_exit_code':checked.returncode,'output':str(folder)}
            result['rows'].append(row);save(output/'results.json',result);print(json.dumps(row),flush=True);prior=ids;finish_scene(config,folder)
    registry=read(root/'.acceptance/case-identities.json')
    assert all(len(registry['cases'][cid]['relationships'])==2 for cid in prior)
    result['implementation_unchanged']=all(digest(SKILL/n)==h for n,h in result['implementation'].items());save(output/'results.json',result)
    finish_acceptance(root,at)
    return 0 if result['implementation_unchanged'] else 1


if __name__=='__main__':sys.exit(main())
