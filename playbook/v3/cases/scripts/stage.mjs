import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const [requestPath,folder,stage,number]=process.argv.slice(2),attempt=Number(number);
const request=JSON.parse(readFileSync(requestPath,'utf8'));
const skill=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const portable=join(skill,'scripts/v3/portable.py');
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const read=name=>JSON.parse(readFileSync(join(folder,name),'utf8'));
const save=(name,data)=>{const p=join(folder,name),tmp=p+'.tmp';writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');renameSync(tmp,p)};
const text=x=>typeof x==='string'&&x.trim().length>0;
const errors=[];let status='invalid',repair_target=null;
const scene=read('scene.current.json');
const catalog=new Map((request.case_catalog??[]).map(x=>[x.id,x]));
const attemptDir=join(folder,`attempt-${attempt}`);
function runPortable(action,manifest){
 const p=spawnSync('python3',[portable,action,manifest,attemptDir],{encoding:'utf8',timeout:240000});
 if(p.status!==0)errors.push(`portable ${action}: ${(p.stderr||p.stdout||p.error||'failed').trim()}`);
 return p.status===0;
}
if(stage==='plan'){
 let plan;try{plan=read('plan.candidate.json')}catch(e){errors.push(String(e))}
 if(plan){
  if(plan.scene_id!==scene.id||plan.scene_sha256!==digest(join(folder,'scene.current.json')))errors.push('Plan scene binding changed');
  if(!Array.isArray(plan.checks)||!plan.checks.length||new Set(plan.checks.map(x=>x.id)).size!==plan.checks.length||plan.checks.some(x=>!text(x.id)||!text(x.text)))errors.push('Concrete checks missing');
  if(!Array.isArray(plan.cases)||!plan.cases.length||new Set(plan.cases.map(x=>x.catalog_id)).size!==plan.cases.length)errors.push('Case selection missing or duplicate');
  const covered=new Set();
  for(const item of plan.cases??[]){
   const candidate=catalog.get(item.catalog_id);
   if(!candidate||!text(item.reason)||!Array.isArray(item.check_ids)||!item.check_ids.length)errors.push('Case selection is not grounded in catalog and checks');
   for(const id of item.check_ids??[]){if(!plan.checks?.some(x=>x.id===id))errors.push('Unknown check ID');covered.add(id)}
  }
  for(const check of plan.checks??[])if(!covered.has(check.id))errors.push('Unassigned scene check: '+check.id);
  if(!errors.length){
   const bindings=plan.cases.map(item=>{
    const c=catalog.get(item.catalog_id);
    return {id:c.id,scenario_id:scene.id,kind:c.kind,origin:c.origin,title:c.title,
     ...(c.kind==='automated'?{test_file:c.test_file,command:c.command,success_markers:c.success_markers,
      env:c.env,timeout_seconds:c.timeout_seconds}:{procedure:c.procedure})};
   });
   const coverage={...request.coverage};
   if(coverage.policy==='required'&&coverage.case_binding_ids==='selected')
    coverage.case_binding_ids=bindings.filter(x=>x.kind==='automated').map(x=>x.id);
   const manifest={schema:'delivery-trace-v1',project:request.project,requirements:request.requirements,
    reverse_rules:request.reverse_rules??[],change:request.change,
    scenarios:[scene],bindings,coverage};
   save('plan.current.json',plan);save('manifest.current.json',manifest);status='ready';
  }
 }
}else if(stage==='scene'){
 let update;try{update=read('scene.candidate.json')}catch(e){errors.push(String(e))}
 if(update){
  if(update.base_sha256!==digest(join(folder,'scene.current.json'))||update.scene?.id!==scene.id||
     update.scene?.requirement_id!==scene.requirement_id||!text(update.scene?.title)||
     !text(update.scene?.description)||!text(update.reason))errors.push('Scene revision binding or content invalid');
  if(!errors.length){save(`scene.previous-${attempt-1}.json`,scene);save('scene.current.json',{...update.scene,version:(scene.version??1)+1});status='ready'}
 }
}else if(stage==='execute'){
 const plan=read('plan.current.json'),manifest=read('manifest.current.json');
 if(plan.scene_sha256!==digest(join(folder,'scene.current.json'))||manifest.scenarios[0].id!==scene.id)errors.push('Plan or manifest bound to different scene');
 if(!errors.length){
  mkdirSync(attemptDir,{recursive:true});
  const frozen=join(attemptDir,'manifest.frozen.json');
  if(!existsSync(frozen))copyFileSync(join(folder,'manifest.current.json'),frozen);
  else if(digest(frozen)!==digest(join(folder,'manifest.current.json')))errors.push('Frozen manifest differs from current plan');
  if(!errors.length){
   const missing=manifest.bindings.filter(b=>b.kind==='automated'&&!existsSync(resolve(request.project.root,b.test_file)));
   const manual=manifest.bindings.some(b=>b.kind==='manual')&&!existsSync(join(attemptDir,'manual-results.json'));
   if(missing.length||manual){status='needs_implementation';errors.push(missing.length?'Selected case code not implemented: '+missing.map(x=>x.id).join(','):'Manual observation not recorded');}
   else if(!existsSync(join(attemptDir,'preparation.json'))&&!runPortable('prepare',frozen))status='invalid';
   if(!errors.length){
    if(!existsSync(join(attemptDir,'execution.json'))&&!runPortable('execute',frozen))status='invalid';
    if(!errors.length&&runPortable('project',frozen))status='ready';
   }
  }
 }
}else if(stage==='review'){
 let review,execution;try{review=read('review.candidate.json');execution=read(`attempt-${attempt}/execution.json`)}catch(e){errors.push(String(e))}
 if(review&&execution){
  const plan=read('plan.current.json');
  if(review.scene_id!==scene.id||review.scene_sha256!==digest(join(folder,'scene.current.json'))||
     review.execution_sha256!==digest(join(attemptDir,'execution.json')))errors.push('Review input binding changed');
  if(!['passed','product_bug','repair_required','blocked'].includes(review.status)||!text(review.reason)||!review.checks)errors.push('Review decision incomplete');
  for(const field of ['scope','case_design','execution','evidence'])if(!['sufficient','gap'].includes(review.checks?.[field]))errors.push('Review check missing: '+field);
  if(!Array.isArray(review.case_assessments)||review.case_assessments.length!==plan.cases.length||
    plan.cases.some(c=>!review.case_assessments.some(a=>a.catalog_id===c.catalog_id&&text(a.reason)&&['valid_pass','valid_fail','unreliable'].includes(a.disposition))))errors.push('Each case requires independent assessment');
  if(review.status==='passed'&&(execution.case_results.some(c=>c.status!=='passed')||
     Object.values(review.checks).some(x=>x!=='sufficient')||
     (request.coverage.policy==='required'&&execution.coverage.status!=='measured')))errors.push('Pass contradicts execution, evidence or required coverage');
  if(review.status==='product_bug'&&(
     !execution.case_results.some(c=>c.status==='failed'&&review.case_assessments.some(a=>a.catalog_id===c.binding_id&&a.disposition==='valid_fail'))||
     ['scope','case_design','evidence'].some(field=>review.checks[field]!=='sufficient')||
     (request.coverage.policy==='required'&&execution.coverage.status!=='measured')))
   errors.push('BUG needs credible failed product evidence');
  if(review.status==='repair_required'&&!['scenario','case_design','case_code','evidence'].includes(review.repair_target))errors.push('Repair target missing');
  if(!errors.length){
   // A missing/incorrect selection of checks is a design defect even when the
   // selected test code also needs work. Re-plan first, then repair the code.
   const routedTarget=review.status==='repair_required'&&review.checks.case_design==='gap'&&
    review.repair_target==='case_code'?'case_design':review.repair_target;
   const assessment={...review,repair_target:routedTarget,
    ...(routedTarget!==review.repair_target?{routing_note:'Missing scene checks require case design repair before code repair.'}:{}),
    reviewer:'independent-playbook-reviewer'};
   save(`attempt-${attempt}/assessment.json`,assessment);
   if(runPortable('project',join(attemptDir,'manifest.frozen.json'))){save('review.current.json',assessment);status=review.status;repair_target=routedTarget??null;}
  }
 }
}else errors.push('Unknown stage');
save(`${stage}-gate.json`,{stage,attempt,status,repair_target,errors});
process.exitCode=(stage==='review'?['passed','product_bug','repair_required','blocked'].includes(status):status==='ready')?0:1;
