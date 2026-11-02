import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {recoverAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/recover/stage.mjs';

const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-coverage-recovery-')));
let child;
try{
 const id='AT-coverage-recovery';
 createAcceptance({project_root:root,acceptance_id:id,request_id:'fixture-create',user_request:'Synthetic coverage recovery boundary fixture; no product execution.'});
 freezeAcceptance({project_root:root,acceptance_id:id,request_id:'fixture-freeze',base_definitions_sha256:null,basis:'Controlled preparation recovery fixture.',scope:{kind:'coverage-environment',project:root},definitions:{context:{business_goal:'Inspect and explicitly settle this synthetic preparation without executing a product scenario.'}}});
 const local=path.join(root,'.acceptance-local',id),folder=path.join(local,'workflows/coverage/interrupted');
 fs.mkdirSync(path.join(folder,'active.lock.d'),{recursive:true});
 const input=JSON.stringify({project_root:root,acceptance_id:id,request_id:'interrupted'})+'\n';
 const failure=JSON.stringify({reason:'Synthetic interrupted preparation'})+'\n';
 fs.writeFileSync(path.join(folder,'input.json'),input);
 fs.writeFileSync(path.join(folder,'failure.json'),failure);
 child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 await new Promise(resolve=>child.once('spawn',resolve));
 const owner=JSON.stringify({pid:child.pid,output_dir:folder})+'\n';
 const ownerFile=path.join(folder,'active.lock.d/owner.json');fs.writeFileSync(ownerFile,owner);
 const base={project_root:root,acceptance_id:id,attempt:folder,basis:'Controlled recovery of this synthetic coverage preparation only.'};
 const inspected=recoverAcceptance({...base,request_id:'inspect',action:'inspect'});
 assert.equal(inspected.status,'inspected');assert.ok(inspected.processes.some(p=>p.alive));
 assert.equal(fs.readFileSync(ownerFile,'utf8'),owner);
 assert.throws(()=>recoverAcceptance({...base,request_id:'unsupported',action:'reconcile'}),/no automatic continuation or replay/);
 assert.throws(()=>recoverAcceptance({...base,request_id:'missing-basis',action:'supersede'}),/external effect reconciliation/);
 assert.equal(fs.readFileSync(ownerFile,'utf8'),owner,'Missing reconciliation must not move an ownership claim');
 const external_effects={status:'none_proved',basis:'The fixture child has no business effects; input and failure bytes are retained.'};
 assert.throws(()=>recoverAcceptance({...base,request_id:'live-child',action:'supersede',external_effects}),/still alive/);
 assert.equal(fs.readFileSync(ownerFile,'utf8'),owner);
 process.kill(-child.pid,'SIGTERM');await new Promise(resolve=>child.once('close',resolve));child=null;
 const result=recoverAcceptance({...base,request_id:'quiescent',action:'supersede',external_effects});
 assert.equal(result.status,'superseded');assert.equal(result.automatic_retry,false);
 assert.equal(result.recovery_claims.length,1);
 assert.equal(fs.readFileSync(path.join(result.recovery_claims[0].to,'owner.json'),'utf8'),owner);
 assert.equal(fs.readFileSync(path.join(folder,'input.json'),'utf8'),input);
 assert.equal(fs.readFileSync(path.join(folder,'failure.json'),'utf8'),failure);
 assert.equal(recoverAcceptance({...base,request_id:'quiescent',action:'supersede',external_effects}).reused,true);
 console.log('PASS: coverage inspection, unsupported replay refusal, missing-effect refusal before claim changes, live process refusal, explicit quiescent superseding and immutable recovery reuse.');
}finally{
 if(child){try{process.kill(-child.pid,'SIGTERM');}catch{}await new Promise(resolve=>child.once('close',resolve));}
 fs.rmSync(root,{recursive:true,force:true});
}
