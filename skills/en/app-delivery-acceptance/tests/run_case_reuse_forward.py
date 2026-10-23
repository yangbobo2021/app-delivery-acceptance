#!/usr/bin/env python3
"""Opt-in real implementation-Agent regression in isolated fixture acceptances."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

SKILL = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'playbook/v4'), str(SKILL / 'tests')]
from acceptance_store import initialize, read_knowledge, publish_catalog, read, save, digest, finish_acceptance
from acceptance_definitions import binding, scene_input
from acceptance_workspace import workspace_lease, finish_scene
from run_case_discovery_forward import git, run_bounded

# Expectations and mutations remain in this harness, outside Agent workspaces.
CASES = [
 {'id':'accounts-a','fixture':'python-ledger','expect':'reuse', 'roots':['checks'],
  'scene':'余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。',
  'product':['ledger.py'], 'mutations': [('ledger.py',"if amount > self.balance: raise ValueError('insufficient')", "if amount > self.balance:\n            self.balance -= 1\n            raise ValueError('insufficient')")]},
 {'id':'accounts-b','fixture':'weak-library','expect':'supplement','roots':['checks'],
  'scene':'余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。',
  'product':['ledger.py'], 'mutations': [('ledger.py',"if amount > self.balance: raise ValueError('insufficient')", "if amount > self.balance:\n            self.balance -= 1\n            raise ValueError('insufficient')")]},
 {'id':'settings-a','fixture':'no-tests','expect':'new','roots':['tests'],
  'scene':'保存某项配置后，可以读回新值，其他已有配置项保持不变。',
  'product':['src/settings.py'], 'mutations':[('src/settings.py','values[key]=value','values.clear(); values[key]=value')]},
 {'id':'accounts-c','suite':'case_reuse','fixture':'python-missing-path','expect':'supplement_new','roots':['checks'],
  'scene':'余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。',
  'product':['ledger.py'], 'mutations': [('ledger.py',"if amount > self.balance: raise ValueError('insufficient')", "if amount > self.balance:\n            self.balance -= 1\n            raise ValueError('insufficient')")]},
 {'id':'web-session-a','fixture':'javascript-web','expect':'reuse','roots':['spec'],
  'scene':'注销会话时删除服务端会话，返回204，并要求浏览器清除名为sid的Cookie。',
  'product':['src/session.mjs'], 'mutations':[
    ('src/session.mjs',"store.delete('session');",'/* omitted server session deletion */'),
    ('src/session.mjs',"response.clearCookie('sid', {httpOnly:true});",'/* omitted cookie clearing */')]},
 {'id':'preview-a','fixture':'shell-cli','expect':'reuse','roots':['verify'],
  'scene':'命令以--preview运行时显示将要写入的目标路径，并且不创建目标文件。',
  'product':['bin/preview.sh'],'mutations':[
    ('bin/preview.sh',"printf 'would write %s\\n' \"$2\"", "printf 'would write %s\\n' \"$2\"; printf 'unexpected' > \"$2\"")]}
]


def execute(command, cwd, env, log):
    with log.open('w') as stream:
        p = subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=90)
    return p.returncode


def run_case(spec, output):
    root = output / spec['id']
    shutil.copytree(SKILL / 'tests/fixtures' / spec.get('suite', 'case_discovery') / spec['fixture'], root)
    git(root,'init','-q');git(root,'add','.')
    git(root,'-c','user.name=Reuse fixture','-c','user.email=fixture@example.invalid','commit','-qm','Controlled source')
    at='AT-reuse-'+spec['id']
    store=initialize(root,at,'用例复用与补充验证','host',{'purpose':'native implementation reuse regression'},'Explicit user request to validate implementation reuse')
    acceptance=read_knowledge(root,at,[])['acceptance'];local=Path(store['local']);workspace=local/'workspace'
    git(root,'clone','-q',str(root),str(workspace))
    definitions={'schema':'acceptance-catalog-v2','project':{'id':spec['id']},
      'context':{'business_goal':'按场景完成必要的测试设计与实际本地验证。'},'basis':'Controlled project source and requirement',
      'requirements':[],'reverse_rules':[],'scenarios':[{'id':'SC-1','title':spec['scene'],'description':spec['scene'],
        'priority':'P1','priority_reason':'Controlled behavior verification','related_refs':[],
        'origin':{'kind':'fixture','reference':'local regression requirement'},'external_refs':[],
        'check':{'method':'host-authored controlled scene','basis':'Frozen before model execution'}}]}
    publish_catalog(root,at,definitions)
    config={'acceptance':acceptance,'definitions':binding(root,at),'workspace_policy':'single-acceptance-v1','source_checkout':str(root)}
    catalog={'schema':'portable-project-catalog-v1',**config,'project_root':str(workspace),'revision':git(workspace,'rev-parse','HEAD'),
      'components':[],'test_roots':spec['roots'],'write_roots':spec['roots'],'source_roots':spec['product'],
      'coverage':{'policy':'off'},'source_hashes':{p:digest(workspace/p) for p in spec['product']},'runner_hints':[]}
    save(local/'catalog.json',catalog)
    save(local/'guide.json',{'summary':'Project dependencies are ready. Follow its existing entry when present. Python standard-library unittest, Node builtin node:test, POSIX shell and make are available; do not install new dependencies.',
      'existing_test_examples':[],'uncertainties':[]})
    value={**config,**scene_input(config,'SC-1'),'case_strategy':'implement','coverage':{'policy':'off'}}
    input_path=local/'input.json';save(input_path,value)
    folder=local/'workflows'/'SC-1';folder.parent.mkdir(exist_ok=True)
    env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','ACCEPTANCE_WORKSPACE_LEASE':str(folder)}
    row={'id':spec['id'],'expected':spec['expect'],'output':str(folder),'semantic_review':'requires source and final test reading'}
    with workspace_lease(config,folder,scene=True):
        started=time.monotonic()
        row['exit_code']=run_bounded(['node',str(SKILL/'playbook/v4/run_case_guided_v6.mjs'),str(input_path),str(local/'catalog.json'),str(local/'guide.json'),str(folder)],workspace,local/'agent-run.log',env,600)
        row['seconds']=round(time.monotonic()-started,2)
        errors=[]
        try:
            metrics,answer=read(folder/'metrics.json'),read(folder/'answer.json')
            report=read(folder/'case-reuse.json')
            row['runtime']=metrics['agent_runtime'];row['tool_calls']=metrics.get('tool_calls');row['usage']=metrics.get('usage')
            row['agent_seconds']=metrics.get('seconds');row['status']=answer.get('status');row['reuse_report']=report
            if metrics.get('status')!='success' or not metrics.get('reuse_validated') or metrics.get('invalid_source_change'):
                errors.append('Implementation/reuse did not validate: '+str(metrics.get('error')))
            if answer.get('status')!='passed_local':errors.append('Actual local test did not pass')
            changed=git(workspace,'status','--porcelain','--untracked-files=all')
            row['changes']=changed.splitlines()
            actions=[c['action'] for c in report.get('decisions',[])]
            found=read(folder/'case-reuse-discovery.json')['discovery']['case_descriptions']
            row['found_cases']=[c['source'] for c in found];row['final_cases']=answer.get('case_descriptions',[])
            if spec['expect']=='reuse' and (not found or not actions or any(a!='reuse' for a in actions) or changed):
                errors.append('Complete existing support should be reused without editing tests')
            if spec['expect']=='supplement' and (not found or not any(a in ('extend','new') for a in actions) or not changed):
                errors.append('Partial existing support should be retained/extended and its gap filled')
            if spec['expect']=='new' and (found or 'new' not in actions or not changed):
                errors.append('Missing existing tests should produce a real new test')
            if spec['expect']=='supplement_new' and (not found or 'reuse' not in actions or 'new' not in actions or not changed):
                errors.append('Retain the existing success case and create only the missing independent path')
            if any(digest(workspace/p)!=catalog['source_hashes'][p] for p in spec['product']):
                errors.append('Product source changed')
            command=answer.get('test_command',[])
            run_env={**env,**answer.get('test_env',{})}
            row['confirmation_exit']=execute(command,workspace,run_env,local/'confirmed-tests.log')
            if row['confirmation_exit']!=0:errors.append('Returned original business command failed')
            row['mutation_runs']=[]
            for i,(name,before,after) in enumerate(spec['mutations']):
                mutation=output/('mutation-'+spec['id']+'-'+str(i))
                shutil.copytree(workspace,mutation,ignore=shutil.ignore_patterns('.git','__pycache__'))
                file=mutation/name;text=file.read_text()
                if text.count(before)!=1:raise ValueError('Mutation preimage is not unique')
                file.write_text(text.replace(before,after))
                mapped=[arg.replace(str(workspace),str(mutation)) for arg in command]
                mutated_env={k:v.replace(str(workspace),str(mutation)) for k,v in run_env.items()}
                code=execute(mapped,mutation,mutated_env,local/('mutation-'+str(i)+'.log'))
                row['mutation_runs'].append({'file':name,'exit_code':code,'log':str(local/('mutation-'+str(i)+'.log'))})
                if code==0:errors.append('Tests failed to catch controlled business mutation')
        except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
            errors.append(str(error))
        row['errors']=errors;row['checks_passed']=not errors
        save(local/'forward-result.json',row)
        finish_scene(config,folder)
    save(Path(store['shared'])/'reuse-regression.json',row);finish_acceptance(root,at)
    print(json.dumps({k:v for k,v in row.items() if k not in ('reuse_report','final_cases','found_cases','usage')},ensure_ascii=False),flush=True)
    return row


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--only',nargs='+');args=p.parse_args()
    if not os.environ.get('ACCEPTANCE_AGENT') or not os.environ.get('ACCEPTANCE_MODEL'):p.error('Explicit actual Agent/model required')
    if not args.output.is_absolute() or args.output.exists():p.error('Use a new absolute output directory')
    specs=[x for x in CASES if not args.only or x['id'] in args.only]
    if not specs or args.only and set(args.only)-{x['id'] for x in specs}:p.error('Unknown example ID')
    args.output.mkdir(parents=True)
    subprocess.run([sys.executable,str(SKILL/'scripts/ensure_runtime.py')],check=True,stdout=subprocess.DEVNULL)
    with (args.output/'preflight.json').open('w') as stream:
        subprocess.run(['node',str(SKILL/'playbook/agent-preflight.mjs')],check=True,stdout=stream)
    files=['playbook/v4/run_case_guided_v6.mjs','playbook/v4/case_reuse.py','playbook/v4/case_discovery_contract.py',
           'references/case-search-guidance.md','references/case-reuse-contract.md','references/case-discovery-contract.md',
           'references/case-display-contract.md','tests/run_case_reuse_forward.py']
    report={'schema':'case-reuse-forward-results-v1','implementation':{name:digest(SKILL/name) for name in files},'rows':[]}
    save(args.output/'results.json',report)
    for spec in specs:
        report['rows'].append(run_case(spec,args.output));save(args.output/'results.json',report)
    report['implementation_unchanged']=all(digest(SKILL/name)==value for name,value in report['implementation'].items())
    save(args.output/'results.json',report)
    return 0 if report['implementation_unchanged'] and all(x['checks_passed'] for x in report['rows']) else 1


if __name__=='__main__':sys.exit(main())
