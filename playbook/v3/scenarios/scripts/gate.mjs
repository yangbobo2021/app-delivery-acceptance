import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [requestPath,folder,stage,roundString]=process.argv.slice(2);const round=Number(roundString);
const request=JSON.parse(readFileSync(requestPath,'utf8'));const target=(request.scenario_kind==='WHITE_BOX'?request.reverse_rules?.find(x=>x.id===request.target_requirement_id)??request.requirements.items.find(x=>x.id===request.target_requirement_id):request.requirements.items.find(x=>x.id===request.target_requirement_id));
const errors=[];const meaningful=x=>typeof x==='string'&&x.trim().length>0;
const strings=x=>Array.isArray(x)&&x.length>0&&x.every(meaningful);
const digest=x=>createHash('sha256').update(x).digest('hex');
const load=file=>{try{return JSON.parse(readFileSync(join(folder,file),'utf8'))}catch(e){errors.push(file+': '+e.message);return null}};
const atomic=(file,obj)=>{writeFileSync(join(folder,file+'.tmp'),JSON.stringify(obj,null,2)+'\n');renameSync(join(folder,file+'.tmp'),join(folder,file))};
if(!target)errors.push('Unknown target requirement');
if(request.scenario_kind==='WHITE_BOX'&&(!request.source_evidence||request.source_evidence.status!=='approved'||!meaningful(request.source_evidence.revision)||!Array.isArray(request.source_evidence.items)||!request.source_evidence.items.length||request.source_evidence.items.some(x=>!meaningful(x.path)||!meaningful(x.sha256)||!meaningful(x.basis))))errors.push('Approved white-box source evidence missing or unbound');
if(request.scenario_kind==='WHITE_BOX'&&request.source_evidence?.status==='approved'){
 const root=resolve(request.project_root);
 try{if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==request.source_evidence.revision)errors.push('Reviewed source revision changed')}
 catch{errors.push('Reviewed source revision unavailable')}
 for(const item of request.source_evidence.items??[]){
  try{const path=resolve(root,item.path);if(!path.startsWith(root+'/')||digest(readFileSync(path))!==item.sha256)errors.push('Reviewed source changed: '+item.path)}
  catch{errors.push('Reviewed source missing: '+item.path)}
 }
}
if(!target){atomic(stage+'-gate.json',{stage,status:'invalid',errors,semantic_review:'not_performed'});process.exit(1);}
let outcome='invalid',doc;
if(stage==='draft'){
 doc=load('draft.candidate.json');
 if(doc){
  if(doc.base_sha256){
   const base=load('scenarios.current.json');
   if(!base || doc.base_sha256!==digest(readFileSync(join(folder,'scenarios.current.json'))))errors.push('Patch base changed');
   if(!Array.isArray(doc.upsert)||!Array.isArray(doc.remove_ids)||!strings(doc.change_summary))errors.push('Invalid patch');
   if(base&&!errors.length){
    const updates=new Map(doc.upsert.map(s=>[s.id,s]));
    if(updates.size!==doc.upsert.length || new Set(doc.remove_ids).size!==doc.remove_ids.length || doc.remove_ids.some(id=>!base.scenarios.some(s=>s.id===id)||updates.has(id)))errors.push('Invalid patch ids');
    const merged=base.scenarios.filter(s=>!doc.remove_ids.includes(s.id)).map(s=>updates.get(s.id)??s);
    for(const x of doc.upsert)if(!base.scenarios.some(s=>s.id===x.id))merged.push(x);
    doc={requirement_id:target.id,kind:request.scenario_kind,scenarios:merged,change_summary:doc.change_summary};
   }
  }
  for(const s of doc.scenarios??[]){s.requirement_id??=target.id;s.kind??=request.scenario_kind;}
  doc.requirement_id??=target.id;doc.kind??=request.scenario_kind;
  if(doc.requirement_id!==target.id||doc.kind!==request.scenario_kind||!strings(doc.change_summary))errors.push('Invalid target/kind/change_summary');
  if(!Array.isArray(doc.scenarios)||!doc.scenarios.length)errors.push('Scenarios missing');
  const ids=new Set();
  for(const s of doc.scenarios??[]){
   if(!meaningful(s.id)||ids.has(s.id)||s.requirement_id!==target.id||s.kind!==request.scenario_kind||!meaningful(s.title))errors.push('Invalid scene identity/owner/kind');ids.add(s.id);
   if(!['P0','P1','P2','P3'].includes(s.priority)||!meaningful(s.priority_reason))errors.push('Priority/reason missing');
   if(!meaningful(s.description))errors.push('Scenario statement missing');
   if(s.acceptance||s.source_basis||s.preconditions||s.actions||s.criteria||s.evidence_expected)errors.push('Legacy detailed scene fields are not part of concise contract');
   if(s.generation_unit_id||s.method_ids||s.code_sources&&s.kind==='BLACK_BOX')errors.push('Unsupported layer or source scan');
  }
  if(!errors.length){doc.version=round;atomic('scenarios.current.json',doc);atomic(`scenarios.round-${round}.json`,doc);outcome='ready';}
 }
}else if(stage==='review'){
 const scenes=load('scenarios.current.json');doc=load('review.candidate.json');
 if(doc&&scenes){
  const sceneIds=scenes.scenarios.map(x=>x.id);
  if(doc.requirement_id!==target.id||doc.scenarios_sha256!==digest(readFileSync(join(folder,'scenarios.current.json'))))errors.push('Review source binding changed');
  if(!['approved','changes_required','needs_clarification'].includes(doc.status)||!meaningful(doc.summary))errors.push('Review status/summary invalid');
  const checks=doc.checks;
  const passValues={coverage:'sufficient',priority:'appropriate',overlap:'clear',scope:'related'};
  const allowed={coverage:['sufficient','gap'],priority:['appropriate','gap'],overlap:['clear','overlap'],scope:['related','gap']};
  if(!checks||Object.entries(allowed).some(([k,v])=>!v.includes(checks[k])))errors.push('All four semantic checks required');
  if(!Array.isArray(doc.coverage)||!doc.coverage.length)errors.push('Coverage mapping missing');
  for(const row of doc.coverage??[]){
   if(!meaningful(row.requirement_quote)||!target.text.includes(row.requirement_quote)||!Array.isArray(row.scenario_ids)||new Set(row.scenario_ids).size!==row.scenario_ids.length||row.scenario_ids.some(id=>!sceneIds.includes(id)))errors.push('Invalid coverage mapping');
   if(checks?.coverage==='sufficient'&&!row.scenario_ids?.length)errors.push('Sufficient coverage has an unmapped clause');
  }
  const passed=doc.passed_scene_ids;
  if(!Array.isArray(passed)||new Set(passed).size!==passed.length||passed.some(id=>!sceneIds.includes(id)))errors.push('Invalid passed scene ids');
  if(!Array.isArray(doc.findings))errors.push('findings must be an array');
  const kinds=new Set(),referenced=new Set(Array.isArray(passed)?passed:[]);
  for(const f of doc.findings??[]){
   if(!meaningful(f.id)||!['coverage','priority','overlap','scope','clarification'].includes(f.kind)||!meaningful(f.requirement_quote)||!meaningful(f.reason)||!meaningful(f.requested_change)||!Array.isArray(f.scenario_ids)||new Set(f.scenario_ids).size!==f.scenario_ids.length||f.scenario_ids.some(id=>!sceneIds.includes(id)))errors.push('Invalid finding');
   if(!target.text.includes(f.requirement_quote??'')&&!(request.user_constraints??[]).some(c=>c.source_quote?.includes(f.requirement_quote)))errors.push('Finding has no original requirement or human scope anchor');
   kinds.add(f.kind);for(const id of f.scenario_ids??[])referenced.add(id);
   if(['priority','overlap','scope'].includes(f.kind)&&(f.scenario_ids??[]).some(id=>passed?.includes(id)))errors.push('Problem scene marked as passed');
   if(['priority','overlap','scope'].includes(f.kind)&&!f.scenario_ids?.length)errors.push('Scene problem requires scene ids');
   if(f.kind==='overlap'&&f.scenario_ids?.length<2)errors.push('Overlap requires multiple scenes');
  }
  if(new Set(doc.findings?.map(f=>f.id)).size!==doc.findings?.length)errors.push('Finding ids must be unique');
  if(sceneIds.some(id=>!referenced.has(id)))errors.push('Not all scenes assessed');
  for(const kind of ['coverage','priority','overlap','scope']){
   const hasProblem=kinds.has(kind)||(kind==='coverage'&&kinds.has('clarification'));
   if(checks&&((checks[kind]!==passValues[kind])!==hasProblem))errors.push('Check verdict contradicts findings: '+kind);
  }
  if(doc.status==='approved'&&((doc.findings??[]).length||!checks||Object.entries(passValues).some(([k,v])=>checks[k]!==v)||passed?.length!==sceneIds.length))errors.push('Approval contradicts semantic checks');
  if(doc.status!=='approved'&&!doc.findings?.length)errors.push('Nonapproval requires concrete findings');
  if(doc.status==='needs_clarification'&&!kinds.has('clarification'))errors.push('Clarification status requires a clarification finding');
  if(!errors.length){atomic(`review.round-${round}.json`,doc);atomic('review.current.json',doc);outcome=doc.status;}
 }
}else errors.push('Unknown stage');
const report={stage,status:outcome,errors,semantic_review:stage==='review'?'independent_model':'not_performed'};atomic(stage+'-gate.json',report);
process.exitCode=stage==='draft'&&outcome==='ready'||stage==='review'&&outcome==='approved'?0:1;
