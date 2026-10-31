import fs from 'node:fs';
import {nodeCommand} from '../../runtime/node-process.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {locations,inside,read,ownedAbsolute,requireCurrent,atomicJson} from '../shared/store.mjs';
import {guard,validateStore} from '../shared/validation.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {currentBinding,digest,verifyStage,loadBinding,executionContext} from '../shared/definitions.mjs';
import {canonical} from '../shared/json.mjs';
export function prepareAnalysis(input,folder){
  const {root,shared,local}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);validateStore(root,input.acceptance_id);
  const definitions=currentBinding(root,input.acceptance_id);if(definitions.sha256!==input.definitions_sha256)throw Error('Analysis definitions changed');
  const current=read(inside(shared,'scenarios.json')),knowledge=readKnowledge(root,input.acceptance_id,input.knowledge_paths??[]),request={mode:input.mode??'create',acceptance:knowledge.acceptance,definitions,project_root:root,requirements:{items:current.requirements,shared_constraints:current.context.shared_constraints??''},execution_context:executionContext(current.context),user_constraints:current.context.user_constraints??[],feedback:input.feedback??[]};
  if(!['create','edit'].includes(request.mode))throw Error('Analysis mode must be create or edit');
  if(request.mode==='edit'){
    const reference=input.previous_analysis??{},file=ownedAbsolute(local,reference.path);if(digest(file)!==reference.sha256)throw Error('Previous analysis changed');request.previous_analysis=read(file);request.allowed_changes=input.allowed_changes;
    if(!Array.isArray(request.allowed_changes)||request.allowed_changes.some(name=>!['business_goal','confirmed_scope','requirement_groups'].includes(name)))throw Error('Explicit allowed_changes list required for analysis edit');
    if(Object.hasOwn(input,'allowed_scope_changes')){const allowed=input.allowed_scope_changes;if(!Array.isArray(allowed)||allowed.some(name=>!['included_requirement_ids','exclusions','limitations'].includes(name)))throw Error('Invalid allowed_scope_changes');request.allowed_scope_changes=allowed;}
  }
  guard(request,[folder]);fs.writeFileSync(path.join(folder,'request.frozen.json'),canonical(request)+'\n',{flag:'wx'});return {request,knowledge:knowledge.contents};
}
export function finishAnalysis(folder){
  const requestFile=path.join(folder,'request.frozen.json'),request=read(requestFile);guard(request,[folder]);verifyStage(request);
  const validator=fileURLToPath(new URL('./tools/validate.mjs',import.meta.url)),argv=nodeCommand(validator,requestFile,folder),started_at=new Date().toISOString(),result=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  atomicJson(path.join(folder,'validation-command.json'),{argv,started_at,finished_at:new Date().toISOString(),exit_code:result.status,stdout:result.stdout,stderr:result.stderr});
  if(result.error)throw result.error;if(result.status!==0)throw Error('Analysis structure gate failed: '+JSON.stringify(read(path.join(folder,'validation.json')).errors));
  const analysis=read(path.join(folder,'analysis.json')),current=loadBinding(request,{required:true});
  for(const key of ['business_goal','confirmed_scope','requirement_groups'])current.context[key]=analysis[key];
  for(const key of ['acceptance_id','scope_sha256','updated_at','definition_record','definition_version','previous_catalog_sha256','change'])delete current[key];
  const candidate=path.join(folder,'candidate-definitions.json');fs.writeFileSync(candidate,canonical(current)+'\n');return {analysis:path.join(folder,'analysis.json'),candidate};
}
