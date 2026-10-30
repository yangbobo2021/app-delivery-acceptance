import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {locations,inside,ownedAbsolute,read,atomicJson,requireCurrent} from '../shared/store.mjs';
import {digest} from '../shared/definitions.mjs';
import {validateStore} from '../shared/validation.mjs';
import {workspaceSnapshot,workspaceMetadataLock,verifyAllowedChanges} from '../shared/workspace.mjs';
import {inspectProcesses,assertQuiescent,verifyExecutionReceipt,verifyRoleResume,staleClaimRecovery,filesUnder} from '../shared/recovery.mjs';
const hashFiles=files=>Object.fromEntries(files.map(file=>[file,digest(file)]));
export function recoverAcceptance(input){
 const allowed=['project_root','acceptance_id','request_id','attempt','action','basis','external_effects'];if(!input||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Recovery request has unknown fields');
 const {root,local}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);validateStore(root,input.acceptance_id);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||!String(input.basis??'').trim())throw Error('Stable recovery identity and actual basis required');
 const folder=ownedAbsolute(inside(local,'workflows'),input.attempt),kind=path.relative(inside(local,'workflows'),folder).split(path.sep)[0];if(!['execute','cases'].includes(kind))throw Error('Recovery currently requires a new Node case/execute attempt');
 if(!['inspect','reconcile','supersede'].includes(input.action))throw Error('Explicit inspect, reconcile or supersede action required');
 const resultFolder=inside(local,'workflows/recover/'+input.request_id);if(fs.existsSync(resultFolder)){const prior=read(path.join(resultFolder,'result.json'));if(digest(path.join(resultFolder,'input.json'))!==digestInput(input))throw Error('Recovery request identity conflicts');for(const [file,hash]of Object.entries(prior.immutable_files))if(digest(file)!==hash)throw Error('Recovery evidence changed');return {...prior,reused:true};}
 const observations=inspectProcesses(folder),snapshot=fs.existsSync(inside(local,'workspace'))?workspaceSnapshot(inside(local,'workspace')):null;
 fs.mkdirSync(resultFolder,{recursive:true});atomicJson(path.join(resultFolder,'input.json'),input);atomicJson(path.join(resultFolder,'inspection.json'),{observations,workspace_snapshot:snapshot,attempt_files:hashFiles(filesUnder(folder))});
 let result={status:'inspected',action:input.action,attempt:folder,processes:observations,unknown_effects:'No missing receipt is interpreted as a failed or safely repeatable operation.'};
 if(input.action!=='inspect'){
  assertQuiescent(observations);
  result=staleClaimRecovery(root,input.acceptance_id,folder,({observations,archived})=>workspaceMetadataLock(root,input.acceptance_id,()=>{
   const normalized=read(path.join(folder,'input.json')),stateFile=path.join(folder,'state.json'),ownerFile=inside(local,'workspace-owner.json');
   if(fs.existsSync(ownerFile)&&read(ownerFile).output_dir!==folder)throw Error('Another scene owns the workspace');
   if(input.action==='supersede'){
    if(!input.external_effects||!['none_proved','reconciled'].includes(input.external_effects.status)||!String(input.external_effects.basis??'').trim())throw Error('Superseding unknown work requires explicit external effect reconciliation');
    const preserve=path.join(folder,'superseded-'+randomUUID()+'.json');atomicJson(preserve,{at:new Date().toISOString(),basis:input.basis,external_effects:input.external_effects,workspace_snapshot:snapshot,processes:observations,old_state:fs.existsSync(stateFile)?read(stateFile):null});if(fs.existsSync(ownerFile))fs.unlinkSync(ownerFile);
    return {status:'superseded',action:'preserve_and_release',attempt:folder,recovery_claims:archived,automatic_retry:false,preserved:preserve};
   }
   if(kind==='cases'){
    const catalog=read(path.join(folder,'catalog.json')),baseline=read(path.join(folder,'workspace-before.json')),bindings=read(path.join(folder,'sources.json'));for(const [file,hash]of Object.entries(bindings))if(digest(file)!==hash)throw Error('Interrupted case input changed');verifyAllowedChanges(catalog.project_root,baseline,catalog.write_roots??catalog.test_roots??[],catalog.components??[]);
    const role=verifyRoleResume(path.join(folder,'case'));if(role.action==='resume_same_session'&&(!input.external_effects||!['none_proved','reconciled'].includes(input.external_effects.status)||!String(input.external_effects.basis??'').trim()))throw Error('Case continuation requires actual external effect reconciliation');
    const authority=path.join(folder,'recovery-authority.json');if(fs.existsSync(authority))throw Error('A bounded case recovery has already been granted');const frozen_files={...role.proof_files,...hashFiles(['input.json','case-input.json','catalog.json','guide.json','sources.json','request.frozen.json','workspace-before.json'].map(name=>path.join(folder,name)))};atomicJson(authority,{...role,workspace_snapshot:workspaceSnapshot(catalog.project_root),frozen_files,basis:input.basis,granted_at:new Date().toISOString(),consumed:false});
    return {status:'reconciled',attempt:folder,stage:'case',recovery:role,recovery_claims:archived,automatic_retry:false,next:'Invoke the identical original case request. It will adopt complete host-validated work or continue the same bound official session once.'};
   }
   const state=read(stateFile),source=read(path.join(folder,'sources.json'));if(state.input_sha256!==digest(path.join(folder,'input.json')))throw Error('Interrupted execution input changed');for(const [file,hash]of Object.entries(source))if(digest(file)!==hash)throw Error('Interrupted stage source changed');
   const catalog=read(normalized.catalog),entries=Object.entries(state.stages).filter(([,v])=>['running','parked'].includes(v.status));if(entries.length!==1)throw Error('Reconcile requires exactly one interrupted stage');const [name,item]=entries[0];if(item.recovery)throw Error('A bounded recovery was already granted; inspect before any further action');let recovery;
   if(/^execution(?:-review-\d+)?$/.test(name)){
    const directory=path.join(folder,name),receipt=path.join(directory,'execution.json');if(!fs.existsSync(receipt))throw Error('Execution receipt missing: effects are unknown; automatic replay is forbidden');const value=verifyExecutionReceipt(receipt,catalog);recovery={action:'adopt_verified_execution',receipt_sha256:digest(receipt)};
    item.status='completed';item.result={receipt,log:path.join(directory,'execution.log'),exit_code:value.exit_code,seconds:value.duration_seconds,test_files:Object.keys(value.test_file_sha256_before)};item.immutable_files=hashFiles(filesUnder(directory));
   }else if(/^(review(?:-review-\d+)?|repair-\d+)$/.test(name)){
    const directory=path.join(folder,name),role=verifyRoleResume(directory);if(role.action==='resume_same_session'&&(!input.external_effects||!['none_proved','reconciled'].includes(input.external_effects.status)||!String(input.external_effects.basis??'').trim()))throw Error('Same-session continuation needs concrete effect reconciliation, not a new-session retry');
    recovery={...role,action:role.action,granted_at:new Date().toISOString(),basis:input.basis};item.status='resume_ready';
   }else throw Error('Interrupted deterministic stage needs verified output adoption, not blind replay');
   item.recovery=recovery;state.recovery_history??=[];state.recovery_history.push({stage:name,...recovery,recovery_request:resultFolder});atomicJson(stateFile,state);
   return {status:'reconciled',attempt:folder,stage:name,recovery,recovery_claims:archived,automatic_retry:false,next:'Invoke the identical original execution request; completed commands are not replayed.'};
  }));
 }
 result={schema:'acceptance-recovery-result-v1',acceptance_id:input.acceptance_id,...result,receipt_path:path.join(resultFolder,'result.json'),immutable_files:hashFiles([path.join(resultFolder,'input.json'),path.join(resultFolder,'inspection.json'),...(result.preserved?[result.preserved]:[])])};atomicJson(path.join(resultFolder,'result.json'),result);return result;
}
function digestInput(value){return (awaitHash)(JSON.stringify(value,null,2)+'\n');}
import {createHash} from 'node:crypto';
const awaitHash=text=>createHash('sha256').update(text).digest('hex');
