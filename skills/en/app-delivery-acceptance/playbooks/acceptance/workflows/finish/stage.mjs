import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,current,finish,requireCurrent} from '../shared/store.mjs';
import {digest} from '../shared/definitions.mjs';
import {validateStore} from '../shared/validation.mjs';
import {workspaceMetadataLock} from '../shared/workspace.mjs';
import {inspectProcesses,assertQuiescent} from '../shared/recovery.mjs';
import {AcceptanceView} from '../view/data.mjs';
export function finishAcceptance(input){
 const fields=['project_root','acceptance_id','request_id','basis','unfinished_limits','allow_unfinished'];if(!input||Object.keys(input).some(k=>!fields.includes(k))||!String(input.basis??'').trim()||!Array.isArray(input.unfinished_limits)||input.unfinished_limits.some(x=>typeof x!=='string'||!x.trim())||typeof input.allow_unfinished!=='boolean'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??''))throw Error('Explicit finish basis, unfinished limits and allow_unfinished decision required');
 const {root,shared,local}=locations(input.project_root,input.acceptance_id),record=inside(shared,'records/lifecycle/finish-'+input.request_id+'.json');validateStore(root,input.acceptance_id,{requireScope:false});
 if(fs.existsSync(record)){const prior=read(record);if(!equal(prior.input,input))throw Error('Finish request identity conflict');if(current(root)===input.acceptance_id)throw Error('This AT has since restarted; use a new finish request');return {status:'already_finished',record,sha256:digest(record),product_judgment:'not_created'};}
 requireCurrent(root,input.acceptance_id);const processes=inspectProcesses(inside(local,'workflows'));assertQuiescent(processes);
 return workspaceMetadataLock(root,input.acceptance_id,()=>{
  const snapshot=new AcceptanceView(root,input.acceptance_id).snapshot(input.acceptance_id),unresolved=snapshot.project_state.traces.filter(t=>!t.execution_known||t.judgment.status!=='passed'||!['matches_current','equivalent_by_assessment'].includes(t.definition_applicability));if(unresolved.length&&(!input.allow_unfinished||!input.unfinished_limits.length))throw Error('Unfinished or unconfirmed scenes require an explicit close-with-limits decision');
  const owner=inside(local,'workspace-owner.json'),value={schema:'acceptance-finish-record-v1',acceptance_id:input.acceptance_id,input,finished_at:new Date().toISOString(),snapshot,unresolved_scene_ids:unresolved.flatMap(t=>t.scenarios.map(s=>s.id)),parked_scene_owner:fs.existsSync(owner)?read(owner):null,processes,product_judgment:'not_created'};fs.mkdirSync(path.dirname(record),{recursive:true});fs.writeFileSync(record,JSON.stringify(value,null,2)+'\n',{flag:'wx'});if(fs.existsSync(owner))fs.unlinkSync(owner);const result=finish(root,input.acceptance_id);return {...result,record,sha256:digest(record),unfinished_scene_ids:value.unresolved_scene_ids,product_judgment:'not_created'};
 });
}
