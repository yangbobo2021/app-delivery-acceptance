import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {locations,inside,ownedAbsolute,requireCurrent,read} from '../shared/store.mjs';
import {guard,validateStore} from '../shared/validation.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {currentBinding,digest,loadBinding,validateDefinitions,fingerprint} from '../shared/definitions.mjs';
import {canonical,cloneJson} from '../shared/json.mjs';
import {createHash} from 'node:crypto';
const fields=['id','title','description','priority','priority_reason'];
const hash=text=>createHash('sha256').update(text).digest('hex');
const write=(file,value,exclusive=false)=>fs.writeFileSync(file,canonical(value)+'\n',exclusive?{flag:'wx'}:undefined);
const equal=(a,b)=>fingerprint(a)===fingerprint(b);
export function materialize(original){
 const request=cloneJson(original),value=loadBinding(request),mode=request.mode??'create';request.mode=mode;
 if(!['create','edit'].includes(mode))throw Error('scenario mode must be create or edit');
 if(!value){if(mode==='edit')throw Error('scenario edit requires current and previous frozen definitions');return request;}
 Object.assign(request,{requirements:{items:value.requirements,shared_constraints:value.context.shared_constraints??''},reverse_rules:value.reverse_rules,analysis:{...request.analysis,...value.context},user_constraints:value.context.user_constraints??[]});
 const target=request.target_requirement_id,scenes=value.scenarios.filter(s=>s.requirement_id===target).map(cloneJson);request.all_existing_scenarios=cloneJson(value.scenarios);
 const admitted=[...value.requirements,...value.reverse_rules].find(r=>r.id===target);if(!admitted||admitted.status==='needs_confirmation')throw Error('scenario target is absent or still needs confirmation');
 if(!['BLACK_BOX','WHITE_BOX'].includes(request.scenario_kind))throw Error('invalid scenario kind');
 if(mode==='create'){if(scenes.length)throw Error('target already has scenes; use edit mode to preserve their identities and edits');return request;}
 if(!request.previous_definitions)throw Error('scenario edit needs previous_definitions from before the requirement change');
 const previous=loadBinding({...request,definitions:request.previous_definitions},{current:false,required:true});
 Object.assign(request,{previous_target:cloneJson([...previous.requirements,...previous.reverse_rules].find(r=>r.id===target)??null),previous_context:cloneJson(previous.context),previous_scenarios:previous.scenarios.filter(s=>s.requirement_id===target).map(cloneJson),existing_scenarios:scenes});
 request.scenario_base_text=canonical({requirement_id:target,kind:request.scenario_kind,scenarios:scenes})+'\n';request.scenario_base_sha256=hash(request.scenario_base_text);
 request.reserved_definition_ids=[...value.requirements,...value.reverse_rules,...value.scenarios].map(r=>r.id);return request;
}
export function applyPatch(request,patch){
 if(request.mode!=='edit')throw Error('scenario patch requires edit mode');
 if(hash(request.scenario_base_text)!==request.scenario_base_sha256||patch.base_sha256!==request.scenario_base_sha256)throw Error('scenario patch base changed');
 const base=JSON.parse(request.scenario_base_text);if(!equal(base.scenarios,request.existing_scenarios))throw Error('scenario base differs from current adopted scenes');
 if(!Array.isArray(patch.upsert)||!Array.isArray(patch.remove_ids))throw Error('edit must return upsert and remove_ids, not a replacement list');
 if(!Array.isArray(patch.change_summary)||!patch.change_summary.length||patch.change_summary.some(x=>typeof x!=='string'||!x.trim()))throw Error('scenario change_summary required');
 const old=new Map(base.scenarios.map(s=>[s.id,s])),removed=patch.remove_ids,updates=new Map();
 if(removed.some(x=>typeof x!=='string'||!old.has(x))||new Set(removed).size!==removed.length)throw Error('invalid retired scene IDs');
 for(const scene of patch.upsert){
  if(!scene||Array.isArray(scene)||typeof scene!=='object'||Object.keys(scene).some(k=>!fields.includes(k)))throw Error('scene patch may change only complete design fields, not origins or references');
  if(fields.some(k=>typeof scene[k]!=='string'||!scene[k].trim()))throw Error('scene patch needs all five complete design fields');
  const id=scene.id;if(updates.has(id)||removed.includes(id))throw Error('duplicate or contradictory scene patch ID');
  if(!['P0','P1','P2','P3'].includes(scene.priority))throw Error('invalid scene priority');
  if(!old.has(id)&&request.reserved_definition_ids.includes(id))throw Error('new scene ID collides with another frozen definition');
  if(old.has(id)&&fields.every(k=>scene[k]===old.get(id)[k]))throw Error('unchanged scenes must be retained, not rewritten in upsert');updates.set(id,scene);
 }
 const changed=new Set([...updates.keys(),...removed]),reasons=patch.change_reasons;
 if(!reasons||Array.isArray(reasons)||typeof reasons!=='object'||Object.keys(reasons).length!==changed.size||Object.entries(reasons).some(([k,v])=>!changed.has(k)||typeof v!=='string'||!v.trim()))throw Error('every updated/new/retired scene needs its change reason');
 const merged=[];for(const scene of base.scenarios){if(removed.includes(scene.id))continue;const item=cloneJson(scene);if(updates.has(scene.id)){Object.assign(item,updates.get(scene.id));delete item.version;delete item.content_sha256;}merged.push(item);}
 for(const [id,scene]of updates)if(!old.has(id))merged.push({...cloneJson(scene),requirement_id:request.target_requirement_id,kind:request.scenario_kind});
 return {requirement_id:request.target_requirement_id,kind:request.scenario_kind,scenarios:merged,change_summary:patch.change_summary,change_reasons:reasons,retired_scene_ids:removed,base_sha256:patch.base_sha256};
}
function runGate(requestFile,folder,receiptFolder=folder){
 const script=fileURLToPath(new URL('./tools/gate.mjs',import.meta.url)),args=[script,requestFile,folder,'draft','1'],p=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 write(path.join(receiptFolder,'validation-command.json'),{argv:[process.execPath,...args],exit_code:p.status,stdout:p.stdout,stderr:p.stderr});if(p.error)throw p.error;
 if(p.status!==0){const detail=read(path.join(folder,'draft-gate.json'));if(folder!==receiptFolder)write(path.join(receiptFolder,'draft-gate.json'),detail);throw Error('scenario structure/self-check gate failed: '+JSON.stringify(detail.errors));}
}
function editGate(request,folder){
 if(fs.readFileSync(path.join(folder,'scenarios.base.json'),'utf8')!==request.scenario_base_text)throw Error('frozen scenario baseline changed');
 const draft=read(path.join(folder,'draft.candidate.json')),result=applyPatch(request,draft);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-scenario-gate-'));
 try{write(path.join(temp,'request.json'),{...request,mode:'create'});const checked={...result,selfcheck:draft.selfcheck};delete checked.base_sha256;write(path.join(temp,'draft.candidate.json'),checked);runGate(path.join(temp,'request.json'),temp,folder);write(path.join(folder,'selfcheck.current.json'),read(path.join(temp,'selfcheck.current.json')));}finally{fs.rmSync(temp,{recursive:true,force:true});}
 for(const name of ['scenarios.current.json','scenarios.round-1.json'])write(path.join(folder,name),result);
 write(path.join(folder,'draft-gate.json'),{stage:'draft',status:'ready',errors:[],semantic_review:'not_performed',mode:'edit'});
}
export function prepareScenarios(value,folder){
 const {root,shared,local}=locations(value.project_root,value.acceptance_id);requireCurrent(root,value.acceptance_id);validateStore(root,value.acceptance_id);
 const latest=read(path.join(shared,'scenarios.json')),definitions=currentBinding(root,value.acceptance_id);if(definitions.sha256!==value.definitions_sha256)throw Error('scenario input definitions changed');
 const target=[...latest.requirements,...latest.reverse_rules].find(r=>r.id===value.target_id);if(!target||target.status==='needs_confirmation')throw Error('target absent or still needs confirmation');
 if(path.resolve(folder)!==inside(local,'workflows/scenarios/'+value.request_id))throw Error('scenario output belongs to another acceptance');
 const knowledge=readKnowledge(root,value.acceptance_id,value.knowledge_paths??[]),original={acceptance:knowledge.acceptance,definitions,project_root:fs.realpathSync(value.source_checkout??root),mode:value.mode??'create',target_requirement_id:value.target_id,scenario_kind:latest.reverse_rules.includes(target)?'WHITE_BOX':'BLACK_BOX'};
 if(original.scenario_kind==='WHITE_BOX')original.source_evidence={status:'approved',revision:target.code_sources[0].revision,items:target.code_sources.map(x=>({...x,basis:target.basis}))};
 if(value.previous_definitions)original.previous_definitions={...value.previous_definitions,path:ownedAbsolute(shared,path.resolve(shared,value.previous_definitions.path))};
 const frozen=materialize(original);Object.assign(frozen,{scenario_selfcheck_protocol:'v4-target-check-v1',scenario_ui_protocol:'v4-ui-acceptance-v1'});guard(frozen,[folder]);write(path.join(folder,'request.frozen.json'),frozen,true);
 if(frozen.mode==='edit')fs.writeFileSync(path.join(folder,'scenarios.base.json'),frozen.scenario_base_text);return {frozen,target,knowledge:knowledge.contents};
}
export function scenarioCandidate(request,folder){
 const current=loadBinding(request,{required:true}),terminal=read(path.join(folder,'terminal.json')),frozen=read(path.join(folder,'request.frozen.json'));
 if(terminal.final_state!=='done'||terminal.request_sha256!==digest(path.join(folder,'request.frozen.json'))||terminal.scenarios_sha256!==digest(path.join(folder,'scenarios.current.json'))||read(path.join(folder,'draft-gate.json')).status!=='ready')throw Error('scenario result is incomplete or changed');
 if(terminal.selfcheck_sha256!==digest(path.join(folder,'selfcheck.current.json')))throw Error('scenario self-check changed after generation');
 const checked=read(path.join(folder,'selfcheck.current.json')),result=read(path.join(folder,'scenarios.current.json'));
 if(request.mode==='edit'&&(terminal.delta_sha256!==digest(path.join(folder,'draft.candidate.json'))||!equal(applyPatch(request,read(path.join(folder,'draft.candidate.json'))),result)))throw Error('scene delta/result changed');
 const old=new Map((request.existing_scenarios??[]).map(s=>[s.id,s])),target=request.target_requirement_id,related=[...new Set((current.context.requirement_groups??[]).filter(g=>g.requirement_ids.includes(target)).flatMap(g=>g.requirement_ids))].filter(r=>r!==target).sort(),adopted=[];
 for(const original of result.scenarios){const scene=cloneJson(original),id=scene.id,prior=old.get(id),check=checked.scene_checks.find(x=>x.scene_id===id),ui=checked.ui_requirement;
  if(ui.required||Object.hasOwn(scene,'ui_acceptance'))scene.ui_acceptance={required:ui.required,visual_expectation:check.ui_visual_expectation??''};
  if(prior&&equal(scene,prior)){adopted.push(scene);continue;}
  const item=prior?cloneJson(scene):Object.fromEntries(fields.map(k=>[k,scene[k]]));if(scene.ui_acceptance)item.ui_acceptance=cloneJson(scene.ui_acceptance);
  if(!prior)Object.assign(item,{requirement_id:target,kind:request.scenario_kind,origin:{kind:'skill_generated_internal_self_check',reference:path.join(folder,'scenarios.current.json')+'#'+id},external_refs:[],related_refs:related});
  if(!prior||item.description!==prior.description)item.check={method:'internal_self_check',basis:path.join(folder,'terminal.json')+': '+(result.change_reasons?.[id]??result.change_summary.join('; '))};delete item.version;delete item.content_sha256;adopted.push(item);
 }
 const replacement=new Map(adopted.map(s=>[s.id,s]));if(current.scenarios.some(s=>s.requirement_id!==target&&replacement.has(s.id)))throw Error('generated scene ID collides with an unrelated adopted scene');
 const inserted=new Set(),merged=[];for(const scene of current.scenarios){if(scene.requirement_id!==target)merged.push(cloneJson(scene));else if(replacement.has(scene.id)){merged.push(replacement.get(scene.id));inserted.add(scene.id);}}
 merged.push(...adopted.filter(s=>!inserted.has(s.id)));current.scenarios=merged;current.design_gaps=[...(current.design_gaps??[]).filter(g=>g.requirement_id!==target),...checked.obligations.filter(x=>!x.scene_ids.length&&x.gap_reason).map(x=>({requirement_id:target,quote:x.quote,reason:x.gap_reason}))];
 current.scenario_revision={request:path.join(folder,'request.frozen.json'),request_sha256:terminal.request_sha256,result_sha256:terminal.scenarios_sha256,mode:request.mode,change_reasons:result.change_reasons??{},retired_scene_ids:result.retired_scene_ids??[]};validateDefinitions(current);return current;
}
export function finishScenarios(folder){
 const requestFile=path.join(folder,'request.frozen.json'),request=read(requestFile);guard(request,[folder]);
 if(request.mode==='edit')editGate(request,folder);else runGate(requestFile,folder);
 const checked=read(path.join(folder,'selfcheck.current.json')),terminal={final_state:'done',review_kind:'internal_self_check',semantic_review:'not_independent',request_sha256:digest(requestFile),scenarios_sha256:digest(path.join(folder,'scenarios.current.json')),selfcheck_sha256:digest(path.join(folder,'selfcheck.current.json')),uncovered_obligations:checked.obligations.filter(x=>!x.scene_ids.length&&x.gap_reason).length};
 if(request.mode==='edit')Object.assign(terminal,{mode:'edit',delta_sha256:digest(path.join(folder,'draft.candidate.json')),previous_definitions:request.previous_definitions});write(path.join(folder,'terminal.json'),terminal);
 const complete=scenarioCandidate(request,folder);for(const k of ['acceptance_id','scope_sha256','updated_at','definition_record','definition_version','previous_catalog_sha256','change'])delete complete[k];
 const candidate_path=path.join(folder,'candidate-definitions.json');write(candidate_path,complete);return {terminal,candidate_path,candidate_sha256:digest(candidate_path),scenarios:read(path.join(folder,'scenarios.current.json')).scenarios.length,definitions:request.definitions};
}
