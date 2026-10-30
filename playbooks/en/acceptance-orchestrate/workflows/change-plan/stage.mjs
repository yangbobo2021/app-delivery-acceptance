import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,atomicJson,requireCurrent,ownedAbsolute} from '../shared/store.mjs';
import {currentBinding,loadBinding,compareDefinitions,refs,digest} from '../shared/definitions.mjs';
import {filesUnder} from '../shared/recovery.mjs';
import {validateStore} from '../shared/validation.mjs';
export function executionHistory(root,id){
 const {local,shared}=locations(root,id),sources=[],executed=new Set(),seen=new Set(),roots=[inside(local,'workflows'),inside(shared,'records')];
 for(const file of [...filesUnder(inside(local,'workflows')),...filesUnder(inside(shared,'records'))])if(path.basename(file)==='execution.json'&&!file.split(path.sep).some(part=>/^frozen-evidence(?:-|$)/.test(part)||part==='debug')){
  try{const receipt=read(file);if(receipt.schema!=='isolated-test-execution-v1'||!receipt.end_utc||!receipt.command?.length||!Object.hasOwn(receipt,'exit_code'))continue;const directory=path.dirname(file),ancestors=[];let folder=directory;while(roots.some(base=>folder.startsWith(base+path.sep))){ancestors.push(folder);folder=path.dirname(folder);}
   let scene;for(const dir of ancestors){const request=path.join(dir,'request.frozen.json');if(fs.existsSync(request)){const req=read(request);if(req.acceptance?.id===id&&req.scene?.id){scene=req.scene.id;break;}}}
   if(!scene)continue;const hash=digest(file),key=scene+':'+hash;if(seen.has(key))continue;if(digest(path.join(directory,'execution.log'))!==receipt.log_sha256)throw Error('Historical execution log changed');seen.add(key);executed.add(scene);sources.push({path:file,sha256:hash,scene_id:scene});
  }catch(error){throw Error('Cannot trust execution history '+file+': '+error.message);}
 }
 return {executed_scene_ids:[...executed].sort(),sources};
}
export function selectScenes(plan,value,history){
 const mode=plan.execution_intent?.mode??(plan.scene_ids?'explicit_selection':null),basis=plan.execution_intent?.basis??plan.basis;if(!['explicit_selection','complete_change_acceptance','follow_history','design_only'].includes(mode)||!String(basis??'').trim())throw Error('Explicit execution intent and actual user basis required');
 if(mode!=='design_only'&&mode!=='explicit_selection'&&!plan.previous_definitions)throw Error('Change execution needs previous definitions before all dependent revisions');
 const previous=plan.previous_definitions?loadBinding({...plan,definitions:plan.previous_definitions},{current:false,required:true}):null,report=previous?compareDefinitions(previous,value,plan.change_review?.assessment??{}):value.change,scenes=value.scenarios,known=new Set(scenes.map(s=>s.id)),affected=new Set(report.rerun_scene_ids),changedTargets=new Set(report.changes.filter(c=>c.classification==='definition'&&!c.ref.startsWith('scenarios:')).map(c=>c.ref.split(':',2)[1]));
 if(report.execution_context_changed)for(const item of [...value.requirements,...value.reverse_rules])if(item.status!=='needs_confirmation')changedTargets.add(item.id);
 const additional=plan.change_review?.affected_target_ids??[],targets=new Set([...value.requirements,...value.reverse_rules].filter(r=>r.status!=='needs_confirmation').map(r=>r.id));if(!Array.isArray(additional)||additional.some(id=>!targets.has(id))||additional.length&&!plan.change_review?.basis)throw Error('Additional target impact needs known confirmed targets and explicit Agent basis');
 for(const id of additional)changedTargets.add(id);for(const scene of scenes)if([...refs(scene)].some(id=>additional.includes(id)))affected.add(scene.id);
 const required=new Set([...affected,...scenes.filter(s=>[...refs(s)].some(r=>changedTargets.has(r))).map(s=>s.id)]),executed=new Set(history.executed_scene_ids);let selected;
 if(mode==='complete_change_acceptance'){const missing=report.missing_scenario_target_ids.filter(id=>changedTargets.has(id));if(missing.length)throw Error('Complete change acceptance still lacks scenarios for: '+missing.join(', '));selected=plan.scene_ids??[...required].sort();if([...required].some(id=>!selected.includes(id)))throw Error('Complete change acceptance cannot omit affected or new/unexecuted scenes');}
 else if(mode==='follow_history')selected=plan.scene_ids??[...affected].filter(id=>executed.has(id)).sort();else if(mode==='design_only'){if(plan.scene_ids?.length)throw Error('design_only cannot launch scenes');selected=[];}else selected=plan.scene_ids;
 if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'||!known.has(id)))throw Error('Plan contains duplicate or unknown scene IDs');
 if(mode==='follow_history'&&selected.some(id=>!affected.has(id)||!executed.has(id)))throw Error('Follow-history cannot select unaffected or never-executed scenes; use explicit_selection for a different user scope');
 return {mode,basis,previous_definitions:plan.previous_definitions??null,change:report,selected_scene_ids:selected,affected_scene_ids:[...affected].sort(),affected_target_ids:[...changedTargets].sort(),required_scene_ids:mode==='complete_change_acceptance'?[...required].sort():[],deferred_scene_ids:[...required].filter(id=>!selected.includes(id)).sort(),historically_executed_scene_ids:[...executed].sort(),history_sources:history.sources};
}
export function planChange(input){
 const allowed=['project_root','acceptance_id','request_id','definitions_sha256','basis','previous_definitions','execution_intent','scene_ids','change_review'];if(!input||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Change plan has unknown fields');
 const {root,local,shared}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);validateStore(root,input.acceptance_id);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??''))throw Error('Stable change plan identity required');
 const folder=inside(local,'workflows/change-plan/'+input.request_id);if(fs.existsSync(folder)){if(!equal(read(path.join(folder,'input.json')),input))throw Error('Change plan identity conflict');const result=read(path.join(folder,'result.json'));for(const [file,hash]of Object.entries(result.immutable_files))if(digest(file)!==hash)throw Error('Change plan evidence changed');return {...result,reused:true,applicability:digest(path.join(shared,'scenarios.json'))===input.definitions_sha256?'current':'superseded'};}
 const binding=currentBinding(root,input.acceptance_id);if(binding.sha256!==input.definitions_sha256)throw Error('Change plan definitions changed');const value=read(binding.path),history=executionHistory(root,input.acceptance_id),plan={...input,acceptance:{project_root:root,id:input.acceptance_id},definitions:binding};if(input.previous_definitions)plan.previous_definitions={...input.previous_definitions,path:ownedAbsolute(shared,path.resolve(shared,input.previous_definitions.path))};
 const selection=selectScenes(plan,value,history);fs.mkdirSync(folder,{recursive:true});atomicJson(path.join(folder,'input.json'),input);atomicJson(path.join(folder,'selection.json'),selection);const result={schema:'acceptance-change-plan-result-v1',status:'planned',stopped_after:'selection',execution_started:false,selection,immutable_files:Object.fromEntries(['input.json','selection.json'].map(name=>[path.join(folder,name),digest(path.join(folder,name))]))};atomicJson(path.join(folder,'result.json'),result);return result;
}
