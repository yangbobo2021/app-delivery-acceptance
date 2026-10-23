#!/usr/bin/env python3
"""Real counterexample execution, production handoff gates and native review/repair.

Continue an already prepared, coverage-off parcel-cli fixture; never fake receipts.
The seeded test is host-authored and intentionally isolated from project regression.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

SKILL = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(SKILL / 'scripts'), str(SKILL / 'playbook/v4'), str(Path(__file__).parent)]
from acceptance_store import read, save, digest, read_knowledge
from acceptance_workspace import workspace_lease, finish_scene
from decision_gate import validate
from run import invoke

PROBES = {
    'overstrict': '''import json
from pathlib import Path
import tempfile
import subprocess
import sys
from parcel import reserve
subprocess.run([sys.executable,'-m','unittest','discover','-s','tests','-p','test_reservations.py'],check=True)
with tempfile.TemporaryDirectory() as folder:
    path=Path(folder)/'inventory.json'
    path.write_text(json.dumps({'book':10,'lamp':4}))
    result=reserve(path,'book',3)
    assert result == 7
    assert json.loads(path.read_text()) == {'book':7,'lamp':4}
    assert str(result) == '007', 'numeric value must use three digits'
''',
    'shallow': '''from parcel import reserve, InsufficientStock
assert callable(reserve)
assert issubclass(InsufficientStock, Exception)
print('API imports and callable checks passed')
''',
    'environment': '''import subprocess
subprocess.run(['/nonexistent-quality-fixture/bin/python','-m','unittest','discover','-s','tests'],check=True)
''',
}


def execution_review(root, original, catalog_path, folder, files, command, evidence_dir=None, attach_images=True):
    catalog=read(catalog_path); workspace=Path(catalog['project_root'])
    folder.mkdir()
    argv=[sys.executable,str(SKILL/'playbook/v4/run_evidence_v2.py'),'--cwd',str(workspace),
          '--output',str(folder/'execution')]
    for file in files: argv += ['--file',file]
    if evidence_dir: argv += ['--env','QUALITY_EVIDENCE='+str(evidence_dir)]
    executed=invoke(argv+['--']+command,workspace,folder/'host-execution.log')
    receipt=folder/'execution/execution.json'; log=folder/'execution/execution.log'
    if not receipt.exists(): raise ValueError('No real execution receipt')
    frozen=[]
    images=sorted(evidence_dir.glob('*.png')) if evidence_dir and attach_images else []
    for source in [receipt,log,*images]:
        target=folder/'frozen-evidence'/source.name; target.parent.mkdir(exist_ok=True)
        shutil.copyfile(source,target)
        frozen.append({'path':str(target),'sha256':digest(target),'source':str(source)})
    save(folder/'frozen-evidence.json',{'schema':'frozen-scene-evidence-v1','files':frozen,
        'source_execution_sha256':digest(receipt)})
    save(folder/'coverage-report.json',{'status':'off','reason':'Explicit coverage-off semantic review probe'})
    request={**original,'frozen_revision':catalog['revision'],'test_files':files,
        'artifact_scope':'isolated_worktree','frozen_execution_receipt':str(receipt),
        'frozen_execution_log':str(log),'frozen_evidence_manifest':str(folder/'frozen-evidence.json'),
        'execution_evidence_paths':[x['path'] for x in frozen],
        'coverage_result_path':str(folder/'coverage-report.json'),
        'scope_note':'Host-authored test probe; actual execution is recorded. Judge the frozen user obligation.'}
    save(folder/'review-input.json',request)
    gate=invoke([sys.executable,str(SKILL/'playbook/v4/review_handoff_gate_v2.py'),
        str(folder/'review-input.json'),str(catalog_path),str(folder/'gate.json')],root,folder/'gate.log')
    if gate['exit_code'] != 0: raise ValueError('Real review handoff rejected: '+(folder/'gate.log').read_text())
    request['handoff_gate_path']=str(folder/'gate.json');save(folder/'review-input.json',request)
    review=invoke(['node',str(SKILL/'playbook/v4/review_case_v3.mjs'),str(workspace),
        str(folder/'review-input.json'),str(folder/'review')],root,folder/'review.log')
    answer=read(folder/'review/answer.json')
    checked=validate(answer,request,read(folder/'review/metrics.json'))
    save(folder/'decision-validation.json',checked)
    if review['exit_code'] != 0 or checked['status'] != 'valid':raise ValueError('Review incomplete/invalid')
    return {'execution':executed,'review':review,'status':answer['status'],'answer':str(folder/'review/answer.json')}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True)
    p.add_argument('--only',nargs='+',choices=list(PROBES),default=list(PROBES));p.add_argument('--repair',action='store_true')
    args=p.parse_args();root=args.root.resolve();aid=read(root/'.acceptance-local/current.json')['acceptance_id']
    acceptance=read_knowledge(root,aid,[])['acceptance'];flows=root/'.acceptance-local'/aid/'workflows'
    handoff=flows/'inputs-bind-off-original/handoff';config=read(handoff/'config.json')
    original=read(handoff/'case-input.json');original['acceptance']=acceptance
    catalog_path=flows/'catalog/catalog.json';catalog=read(catalog_path);workspace=Path(catalog['project_root'])
    originals={name:digest(workspace/name) for name in ['tests/test_reservations.py','parcel/store.py','parcel/__main__.py','parcel/__init__.py']}
    rows=[]
    for name in args.only:
        folder=flows/('review-probe-'+name);folder.mkdir()
        test=workspace/'tests/quality_probe.py'
        if test.exists():raise ValueError('Owned probe already exists; reconcile before retry')
        test.write_text(PROBES[name]);shutil.copyfile(test,folder/'before.py')
        lease_config={**catalog,'acceptance':acceptance,'definitions':original['definitions']}
        with workspace_lease(lease_config,folder,scene=True):
            try:
                # Overconstraint adds only a numeric display assumption after all existing checks.
                files=['tests/quality_probe.py']+(['tests/test_reservations.py'] if name=='overstrict' else [])
                python=read(catalog['runtime']['manifest'])['executables']
                python_path=next(x['path'] for x in python if x.get('name')=='python') if isinstance(python,list) else None
                # Runtime manifests use an explicit Python entry; never a different model-selected interpreter.
                if python_path is None:
                    candidates=[x for x in python.values() if isinstance(x,dict) and x.get('kind')=='python']
                    python_path=candidates[0]['path'] if candidates else str(workspace/'.venv/bin/python')
                if not Path(python_path).is_file():raise ValueError('Prepared Python missing')
                command=[python_path,'-c',"import runpy;runpy.run_path('tests/quality_probe.py',run_name='__main__')"]
                row={'probe':name,'semantic_review':'requires source and raw result reading',
                     **execution_review(root,original,catalog_path,folder/'initial',files,command)}
                if args.repair and name=='overstrict' and row['status']=='repair_required':
                    repair=invoke(['node',str(SKILL/'playbook/v4/repair_case_delta_v3.mjs'),
                        str(handoff/'case-input.json'),row['answer'],str(catalog_path),str(flows/'guide/guide.json'),
                        str(folder/'repair')],root,folder/'repair.log',timeout=900)
                    row['repair']=repair;answer=read(folder/'repair/answer.json')
                    if answer.get('test_command'):
                        row['after_repair']=execution_review(root,original,catalog_path,folder/'retest',
                            answer['test_files'],answer['test_command'])
                shutil.copyfile(test,folder/'after.py')
                row['original_files_unchanged']=all(digest(workspace/x)==v for x,v in originals.items())
                save(folder/'result.json',row);rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
            finally:
                finish_scene(lease_config,folder)
                # Remove only our owned probe; exact versions remain in this workflow.
                test.unlink(missing_ok=True)
    return 0


if __name__=='__main__':sys.exit(main())
