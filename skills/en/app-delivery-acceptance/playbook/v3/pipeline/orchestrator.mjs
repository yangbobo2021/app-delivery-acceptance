import {acceptanceGuard} from '../../acceptance-guard.mjs';
import {readFileSync,writeFileSync,renameSync,mkdirSync,rmSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const [specArg,ledgerArg,...flags]=process.argv.slice(2);
if(!specArg||!ledgerArg)throw Error('usage: node orchestrator.mjs spec.json ledger-dir [--retry job-id]');
const specPath=resolve(specArg),specDir=dirname(specPath),ledgerDir=resolve(ledgerArg);
const spec=JSON.parse(readFileSync(specPath,'utf8'));
acceptanceGuard(spec,[ledgerDir]);
if(spec.schema!==1||!Array.isArray(spec.jobs)||!spec.jobs.length)throw Error('Invalid pipeline spec');
const retryIndex=flags.indexOf('--retry'),retry=retryIndex>=0?flags[retryIndex+1]:null;
if(retryIndex>=0&&!retry)throw Error('--retry needs a job ID');
const resolutionIndex=flags.indexOf('--resolve-uncertain'),resolveUncertain=resolutionIndex>=0?flags[resolutionIndex+1]:null;
if(resolutionIndex>=0&&!resolveUncertain)throw Error('--resolve-uncertain needs a job ID');
const validJob=j=>j?.id&&Array.isArray(j.depends_on)&&Array.isArray(j.inputs)&&Array.isArray(j.command)&&j.terminal?.file&&Array.isArray(j.terminal.accept);
const jobs=new Map(spec.jobs.map(j=>[j.id,j]));
if(jobs.size!==spec.jobs.length||[...jobs].some(([,j])=>!validJob(j)))throw Error('Invalid job definition');
for(const j of spec.jobs)for(const d of j.depends_on)if(!jobs.has(d))throw Error(`Unknown dependency ${d}`);
if(retry&&!jobs.has(retry))throw Error('Unknown retry job');
const sha=b=>createHash('sha256').update(b).digest('hex');
const resolveFile=p=>resolve(specDir,p);
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const ledgerPath=join(ledgerDir,'ledger.json'),lockPath=join(ledgerDir,'lock');
mkdirSync(ledgerDir,{recursive:true});
try{mkdirSync(lockPath);}catch{
 let owner=null;try{owner=readJson(join(lockPath,'owner.json'));}catch{}
 if(owner&&Number.isInteger(owner.pid)&&owner.pid>0){
  try{process.kill(owner.pid,0);throw Error(`Scheduler already running: pid ${owner.pid}`);}catch(e){if(e.code!=='ESRCH')throw e;}
 }
 rmSync(lockPath,{recursive:true,force:true});mkdirSync(lockPath);
}
writeFileSync(join(lockPath,'owner.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
const save=x=>{const tmp=ledgerPath+'.tmp';const fd=openSync(tmp,'w');try{writeFileSync(fd,JSON.stringify(x,null,2)+'\n');}finally{closeSync(fd);}renameSync(tmp,ledgerPath);};
const ledger=existsSync(ledgerPath)?readJson(ledgerPath):{schema:1,jobs:{},created_at:new Date().toISOString()};
const prContract=spec.pr_completion;
let frozenTargets=null;
if(prContract){
 if(!prContract.targets_file||!Array.isArray(prContract.targets))throw Error('PR completion contract needs targets file and target jobs');
 const targetPath=resolveFile(prContract.targets_file);
 frozenTargets=readJson(targetPath);
 if(frozenTargets.schema!=='pr-targets-v1')throw Error('Invalid PR target inventory');
 const targetHash=sha(readFileSync(targetPath));
 if(ledger.pr_targets_sha256&&ledger.pr_targets_sha256!==targetHash)throw Error('PR target inventory changed; create a new ledger');
 ledger.pr_targets_sha256=targetHash;
 const planned=new Set(prContract.targets.map(x=>x.key??x.id));
 if(planned.size!==prContract.targets.length||planned.size!==frozenTargets.targets.length||frozenTargets.targets.some(x=>!planned.has(x.key??x.id)))
  throw Error('PR completion contract omits an approved behavior target');
}
const renderDeps=value=>value.replace(/\{\{job\.([a-zA-Z0-9_-]+)\.attempt\}\}/g,(_,id)=>{
 const upstream=ledger.jobs[id];
 if(!upstream||upstream.status!=='done'||!Number.isInteger(upstream.attempt))
  throw Error(`Dependency attempt unavailable: ${id}`);
 return String(upstream.attempt);
});
const render=(value,attempt)=>renderDeps(value).replaceAll('{{attempt}}',String(attempt));
const field=(object,path)=>path.split('.').reduce((v,k)=>v?.[k],object);
const fill=(value,item)=>{
 if(typeof value==='string')return value.replace(/\{\{item\.([a-zA-Z0-9_]+)\}\}/g,(_,key)=>{
  const result=item[key];if(typeof result!=='string'&&typeof result!=='number')throw Error(`Missing fanout field ${key}`);return String(result);
 });
 if(Array.isArray(value))return value.map(x=>fill(x,item));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fill(v,item)]));
 return value;
};
const terminalOf=(job,attempt)=>{
 const p=resolveFile(render(job.terminal.file,attempt));
 if(!existsSync(p))return null;
 let parsed;try{parsed=readJson(p);}catch{return null;}
 const state=field(parsed,job.terminal.state_path??'final_state');
 const finished=field(parsed,job.terminal.finished_path??'finished_at');
 if(!state||!finished)return null;
 if(job.terminal.input_binding){
  const binding=job.terminal.input_binding;
  const inputPath=resolveFile(binding.file);
  if(!existsSync(inputPath)||field(parsed,binding.field??'input_sha256')!==sha(readFileSync(inputPath)))return null;
 }
 const artifacts={};
 for(const relative of job.terminal.artifacts??[]){const path=resolveFile(render(relative,attempt));if(!existsSync(path))return null;artifacts[path]=sha(readFileSync(path));}
 artifacts[p]=sha(readFileSync(p));
 return {state,accepted:job.terminal.accept.includes(state),artifacts,terminal:p};
};
const fingerprint=job=>{
 const inputs={};for(const relative of job.inputs){const p=resolveFile(renderDeps(relative));if(!existsSync(p))throw Error(`${job.id}: missing input ${p}`);inputs[p]=sha(readFileSync(p));}
 const deps={};for(const id of job.depends_on){const d=ledger.jobs[id];if(!d||d.status!=='done')throw Error(`${job.id}: dependency ${id} incomplete`);deps[id]=d.receipt.artifacts;}
 return sha(JSON.stringify({job:{id:job.id,kind:job.kind,command:job.command,cwd:job.cwd,terminal:job.terminal},inputs,deps}));
};
const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}};
const finish=(id,item,receipt,status)=>{ledger.jobs[id]={...item,status,receipt,ended_at:new Date().toISOString(),pid:null};save(ledger);};
const queue=[...spec.jobs];
function expandFanout(parent,index){
 const rule=parent.fanout;if(!rule)return;
 const parentReceipt=ledger.jobs[parent.id]?.receipt;
 const source=resolveFile(rule.file);
 if(!parentReceipt?.artifacts?.[source]||parentReceipt.artifacts[source]!==sha(readFileSync(source)))throw Error(`${parent.id}: fanout source is not a bound artifact`);
 const items=field(readJson(source),rule.items_path);
 if(!Array.isArray(items))throw Error(`${parent.id}: fanout items missing`);
 const added=[];
 for(const item of items){const child=fill(rule.job_template,item);
  if(!validJob(child)||!child.depends_on.includes(parent.id)||jobs.has(child.id))throw Error(`${parent.id}: invalid or duplicate fanout child`);
  jobs.set(child.id,child);added.push(child);
 }
 queue.splice(index+1,0,...added);
}
let child=null;
process.on('SIGINT',()=>{if(child)child.kill('SIGINT');});
process.on('SIGTERM',()=>{if(child)child.kill('SIGTERM');});
try{
 for(let index=0;index<queue.length;index++){
  const job=queue[index];
  const id=job.id;
  if(job.depends_on.some(d=>ledger.jobs[d]?.status!=='done')){console.log(JSON.stringify({job:id,status:'waiting_dependency'}));process.exitCode=2;break;}
  let current=ledger.jobs[id],key=fingerprint(job);
  if(current?.status==='done'){
   const observation=terminalOf(job,current.attempt);
   if(current.key!==key||!observation||!observation.accepted||JSON.stringify(observation.artifacts)!==JSON.stringify(current.receipt.artifacts)){
    ledger.jobs[id]={...current,status:'stale',reason:'Input or accepted output changed'};save(ledger);
    console.log(JSON.stringify({job:id,status:'stale'}));process.exitCode=2;break;
   }
   console.log(JSON.stringify({job:id,status:'reused',state:current.receipt.state}));expandFanout(job,index);continue;
  }
  if(current?.status==='running'){
   const observation=terminalOf(job,current.attempt);
   if(alive(current.pid)){console.log(JSON.stringify({job:id,status:'running_elsewhere',pid:current.pid}));process.exitCode=3;break;}
   if(current.key===key&&observation?.accepted){finish(id,current,observation,'done');console.log(JSON.stringify({job:id,status:'adopted',state:observation.state}));expandFanout(job,index);continue;}
   ledger.jobs[id]={...current,status:'interrupted',reason:'Child disappeared without accepted terminal'};save(ledger);current=ledger.jobs[id];
  }
  if(current?.status==='launch_pending'){
   const observation=terminalOf(job,current.attempt);
   if(current.key===key&&observation?.accepted){finish(id,current,observation,'done');console.log(JSON.stringify({job:id,status:'adopted',state:observation.state}));expandFanout(job,index);continue;}
   if(resolveUncertain!==id){console.log(JSON.stringify({job:id,status:'uncertain_launch',reason:'Confirm no child is active before --resolve-uncertain'}));process.exitCode=3;break;}
  }
  // A parked child can finish later through its own checked --resume path.
  // Reconcile its accepted, still-bound terminal before considering a fresh attempt.
  if(current&&!job.external_pin_sha256&&['failed','blocked','interrupted'].includes(current.status)){
   const observation=terminalOf(job,current.attempt);
   if(current.key===key&&observation?.accepted){finish(id,current,observation,'done');console.log(JSON.stringify({job:id,status:'adopted_after_resume',state:observation.state}));expandFanout(job,index);continue;}
  }
  if(current&&current.status!=='done'&&retry!==id){console.log(JSON.stringify({job:id,status:current.status,reason:current.reason}));process.exitCode=2;break;}
  const attempt=(current?.attempt??0)+1,command=job.command.map(x=>render(x,attempt));
  if(job.external_pin_sha256){
   const observation=terminalOf(job,attempt);
   if(!observation?.accepted||observation.artifacts[observation.terminal]!==job.external_pin_sha256){
    ledger.jobs[id]={status:'blocked',attempt,key,reason:'Pinned external result missing or changed'};save(ledger);
    console.log(JSON.stringify({job:id,status:'blocked',reason:'external pin mismatch'}));process.exitCode=2;break;
   }
   finish(id,{attempt,key,external:true},observation,'done');console.log(JSON.stringify({job:id,status:'adopted_external',state:observation.state}));expandFanout(job,index);continue;
  }
  if(!command.length)throw Error(`${id}: no command or pinned external result`);
  const cwd=resolveFile(job.cwd??'.');
  const stdout=join(ledgerDir,`${id}-attempt-${attempt}.out`),stderr=join(ledgerDir,`${id}-attempt-${attempt}.err`);
  const intent={status:'launch_pending',attempt,key,command,cwd,stdout,stderr,started_at:new Date().toISOString(),
   history:[...(current?.history??[]),...(current?[{status:current.status,attempt:current.attempt,receipt:current.receipt,reason:current.reason}]:[])]};
  ledger.jobs[id]=intent;save(ledger);
  if(process.env.SCHEDULER_FAIL_AFTER_INTENT===id)process.exit(97);
  const outFd=openSync(stdout,'w'),errFd=openSync(stderr,'w');
  acceptanceGuard(spec,[ledgerDir]);
  child=spawn(command[0],command.slice(1),{cwd,stdio:['ignore',outFd,errFd],env:{...process.env,...job.env}});
  const record={...intent,status:'running',pid:child.pid};
  ledger.jobs[id]=record;save(ledger);closeSync(outFd);closeSync(errFd);
  const exit=await new Promise(res=>{child.once('error',error=>res({error:String(error)}));child.once('exit',(code,signal)=>res({code,signal}));});child=null;
  const observation=terminalOf(job,attempt);
  if(process.env.SCHEDULER_FAIL_AFTER_TERMINAL===id&&observation?.accepted)process.exit(97);
  if(exit.code===0&&observation?.accepted){finish(id,record,observation,'done');console.log(JSON.stringify({job:id,status:'done',state:observation.state}));expandFanout(job,index);continue;}
  ledger.jobs[id]={...record,status:observation?.state==='blocked'?'blocked':'failed',exit,receipt:observation,ended_at:new Date().toISOString(),reason:observation?.state??'Child exited without accepted terminal'};save(ledger);
  console.log(JSON.stringify({job:id,status:ledger.jobs[id].status,exit}));process.exitCode=2;break;
 }
 if(!process.exitCode){
  let completionError=null;
  if(prContract){
   try{
    for(const target of prContract.targets){
     const scenes=readJson(resolveFile(target.scenarios_file)),review=readJson(resolveFile(target.review_file));
     if(review.status!=='approved'||review.scenarios_sha256!==sha(readFileSync(resolveFile(target.scenarios_file))))throw Error('PR target scenario list lacks independent approval: '+target.id);
     const identity=frozenTargets.targets.find(x=>(x.key??x.id)===(target.key??target.id));
     if(!identity||review.requirement_id!==identity.id||(scenes.scenarios??[]).some(x=>x.requirement_id!==identity.id||identity.mode&&x.kind!==identity.mode))
      throw Error('PR target scenario owner/mode mismatch: '+(target.key??target.id));
     const expected=new Set((scenes.scenarios??[]).map(x=>x.id));
     const mapped=new Set((target.case_jobs??[]).map(x=>x.scenario_id));
     if(!expected.size||expected.size!==mapped.size||[...expected].some(id=>!mapped.has(id)))throw Error('PR target has missing/extra scenario execution: '+target.id);
     for(const item of target.case_jobs){
      const receipt=ledger.jobs[item.job_id]?.receipt;
      if(!receipt?.accepted||!['passed','product_bug'].includes(receipt.state))throw Error('PR scenario lacks final independent judgment: '+item.scenario_id);
      if(!item.trace_file)throw Error('PR scenario trace path missing: '+item.scenario_id);
      const tracePath=resolveFile(item.trace_file),traceHash=sha(readFileSync(tracePath)),trace=readJson(tracePath);
      if(receipt.artifacts?.[tracePath]!==traceHash||trace.scenarios?.[0]?.id!==item.scenario_id||
         trace.revision!==frozenTargets.head_revision||trace.judgment?.status!==receipt.state||
         (frozenTargets.inventory_sha256&&sha(JSON.stringify(trace.change?.inventory))!==frozenTargets.inventory_sha256))
       throw Error('PR scenario judgment is not bound to this frozen change: '+item.scenario_id);
     }
    }
   }catch(error){completionError=error.message;}
  }
  ledger.final_state=completionError||frozenTargets?.unresolved?.length?'blocked':queue.some(job=>ledger.jobs[job.id]?.receipt?.state==='product_bug')?'bugs_found':'passed';
  ledger.final_reason=completionError??(frozenTargets?.unresolved?.length?'Unresolved PR behavior requires confirmation':null);
  if(frozenTargets)ledger.test_modes=frozenTargets.test_modes??['WHITE_BOX'];
  ledger.finished_at=new Date().toISOString();save(ledger);console.log(JSON.stringify({pipeline:ledger.final_state}));
  if(completionError)process.exitCode=2;
 }
}finally{rmSync(lockPath,{recursive:true,force:true});}
