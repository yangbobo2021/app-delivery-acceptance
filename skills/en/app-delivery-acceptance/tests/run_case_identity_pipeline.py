#!/usr/bin/env python3
"""Real finder/generator → evaluation → execution → review → ID archive regression."""
import argparse, json, os, pathlib, shutil, subprocess, sys
skill=pathlib.Path(__file__).resolve().parents[1]
sys.path[:0]=[str(skill/'scripts'),str(skill/'playbook/v4')]
from acceptance_store import initialize, read_knowledge, publish_catalog, save, digest, archive, read
from case_identity import verify as verify_identity
from acceptance_workspace import workspace_lease, finish_scene
from acceptance_definitions import binding
parser=argparse.ArgumentParser(description='Opt-in real Agent ID pipeline acceptance in isolated fixtures')
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
if not os.environ.get('ACCEPTANCE_AGENT') or not os.environ.get('ACCEPTANCE_MODEL'):parser.error('Pass the caller actual Agent and model')
base=args.output.resolve()
if base.exists():parser.error('Use a new output directory; preserve previous evidence')
base.mkdir(parents=True)
for name,fixture,roots,products,scene,strategy in [
('existing','case_discovery/python-ledger',['checks'],['ledger.py'],'余额足够时取款并返回及保存扣减后的余额；余额不足时拒绝取款且余额不变。','existing_only'),
('new','case_discovery/no-tests',['tests'],['src/settings.py'],'保存某项配置后，可以读回新值，其他已有配置项保持不变。','implement')]:
 root=base/name;shutil.copytree(skill/'tests/fixtures'/fixture,root)
 for args in [('init','-q'),('add','.'),('-c','user.name=Fixture','-c','user.email=test@example.invalid','commit','-qm','fixture')]: subprocess.run(['git',*args],cwd=root,check=True)
 at='AT-ID-'+name;store=initialize(root,at,'用例 ID 端到端验收','host',{'purpose':'identity full pipeline'},'User authorized isolated acceptance')
 local=pathlib.Path(store['local']);workspace=local/'workspace';subprocess.run(['git','clone','-q',str(root),str(workspace)],check=True)
 acceptance=read_knowledge(root,at,[])['acceptance']
 publish_catalog(root,at,{'schema':'acceptance-catalog-v2','project':{'id':name},'context':{'business_goal':'用真实执行和独立评估验收用例身份。'},'basis':'frozen fixture requirement',
  'requirements':[],'reverse_rules':[],'scenarios':[{'id':'SC1','title':scene,'description':scene,'priority':'P1','priority_reason':'关键业务判据','related_refs':[],'external_refs':[],'origin':{'kind':'fixture','reference':'isolated native acceptance'},'check':{'method':'host','basis':'frozen before native run'}}]})
 config={'acceptance':acceptance,'definitions':binding(root,at),'workspace_policy':'single-acceptance-v1','source_checkout':str(workspace)}
 revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=workspace,text=True).strip()
 catalog={'schema':'portable-project-catalog-v1',**config,'project_root':str(workspace),'revision':revision,'components':[],'test_roots':roots,'write_roots':roots,'source_roots':products,'source_hashes':{p:digest(workspace/p) for p in products},'coverage':{'policy':'off'},'runner_hints':[]}
 save(local/'catalog.json',catalog);save(local/'guide.json',{'summary':'Dependencies ready. Use existing Python standard-library tests or new tests under declared test roots. No installation is needed.','existing_test_examples':[],'uncertainties':[]})
 flows=local/'workflows';flows.mkdir(exist_ok=True)
 save(local/'template.json',{**config,'scene_id':'SC1','template_catalog':str(local/'catalog.json'),'guide':str(local/'guide.json'),'case_run_dir':str(flows/'full'),'allowed_test_roots':roots,'case_strategy':strategy,'case_evaluation':True,'coverage':{'policy':'off'},'max_review_repairs':1,'resume_safe_after_local_loopback':True})
 with (local/'bind.log').open('w') as log: p=subprocess.run([sys.executable,str(skill/'playbook/v4/bind_case.py'),str(local/'template.json'),str(flows/'handoff')],stdout=log,stderr=subprocess.STDOUT)
 if p.returncode: raise RuntimeError('bind failed '+str(local/'bind.log'))
 with (local/'pipeline.log').open('w') as log: p=subprocess.run([sys.executable,str(skill/'playbook/v4/scene_pipeline.py'),str(flows/'handoff/config.json')],stdout=log,stderr=subprocess.STDOUT,timeout=1200)
 summary=read(flows/'full/summary.json')
 if p.returncode or summary.get('review_status') not in ('passed','repair_required','product_bug','blocked','inconclusive'):
  raise RuntimeError('full pipeline did not produce an independent outcome: '+str(local/'pipeline.log'))
 review_input=read(pathlib.Path(summary['review_path']).with_name('input.json'))
 answer=read(review_input['agent_result_path']);receipt=read(review_input['frozen_execution_receipt'])
 identities=verify_identity(answer,workspace,scene_id='SC1',acceptance_id=at,receipt_hashes=receipt['test_file_sha256_before'])
 evaluation=read(flows/'full/case-evaluation.json')
 if evaluation['status']!='available' or {c['original_id'] for c in evaluation['description']['cases']}!={c['id'] for c in identities['cases']}:
  raise RuntimeError('evaluation lost permanent IDs')
 record=archive(root,at,flows/'full',[],'Reviewed isolated ID pipeline artifacts',v4_result=True)
 row={'case':name,'status':'passed','ids':[c['id'] for c in identities['cases']],'evaluation_status':evaluation['status'],
      'review_status':summary['review_status'],'receipt':review_input['frozen_execution_receipt'],'archive':record}
 save(base/(name+'-result.json'),row);print(json.dumps(row,ensure_ascii=False),flush=True)

 # A real differential repair must keep the adopted ID and give the new
 # declaration its own identity. This is fixture-specific acceptance data.
 if name=='new':
  prior_ids={c['id'] for c in identities['cases']}
  feedback={'status':'repair_required','findings':[{'kind':'test_design',
   'reason':'当前测试修改已有配置，尚未独立检查保存此前不存在的配置项。',
   'requested_change':'保留当前测试、断言和 ID 注释；新增独立测试保存此前不存在的配置项，检查可读回新值且其他已有配置项不变。最终列出保留及新增的所有关联测试。'}]}
  save(local/'repair-feedback.json',feedback);repair=flows/'repair-identity'
  with workspace_lease(config,repair,scene=True):
   with (local/'repair-agent.log').open('w') as log:
    process=subprocess.run(['node',str(skill/'playbook/v4/repair_case_delta_v3.mjs'),str(flows/'handoff/case-input.json'),str(local/'repair-feedback.json'),str(flows/'full/catalog.json'),str(local/'guide.json'),str(repair)],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'ACCEPTANCE_WORKSPACE_LEASE':str(repair)},timeout=600)
   repaired=read(repair/'answer.json');metrics=read(repair/'metrics.json')
   verified=verify_identity(repaired,workspace,scene_id='SC1',acceptance_id=at)
   final_ids={c['id'] for c in verified['cases']}
   if process.returncode or metrics['status']!='success' or not prior_ids<final_ids:
    raise RuntimeError('repair lost existing identity or reused it for new test')
   save(base/'repair-result.json',{'status':'passed','prior_ids':sorted(prior_ids),'final_ids':sorted(final_ids),'output':str(repair)})
   finish_scene(config,repair)
