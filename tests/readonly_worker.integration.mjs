import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {readOnlyProjection,readOnlyProjectionAsync} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/role-contract.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-readonly-worker-'));
async function verify(){
 const project=path.join(root,'project'),output=path.join(project,'.acceptance-local/out');fs.mkdirSync(output,{recursive:true});
 for(let i=0;i<128;i++)fs.writeFileSync(path.join(project,'file '+i+'.txt'),'original source '+i);
 fs.writeFileSync(path.join(output,'host-evidence'),'excluded by existing projection');
 let responsive=false;const timer=setTimeout(()=>responsive=true,0);
 const before=await readOnlyProjectionAsync(project,output);clearTimeout(timer);assert.ok(responsive,'snapshot blocked the host event loop');assert.deepEqual(before,readOnlyProjection(project,output));
 fs.writeFileSync(path.join(project,'file 7.txt'),'unauthorized change');const after=await readOnlyProjectionAsync(project,output);assert.notDeepEqual(after,before);assert.notEqual(after['file 7.txt'],before['file 7.txt']);assert.equal(Object.keys(after).length,128);
 const already=new AbortController();already.abort(Error('before launch'));await assert.rejects(readOnlyProjectionAsync(project,output,{signal:already.signal}),/before launch/);
 const active=new AbortController();const operation=readOnlyProjectionAsync(project,output,{signal:active.signal});setTimeout(()=>active.abort(Error('owned snapshot cancelled')),0);await assert.rejects(operation,/owned snapshot cancelled/);
 await assert.rejects(readOnlyProjectionAsync(path.join(root,'missing'),output),/ENOENT/);
 console.log(JSON.stringify({status:'passed',platform:process.platform,runtime:process.versions.electron?'Electron '+process.versions.electron:'Node '+process.version,eventLoopResponsive:true,identicalCompleteProjection:true,changedFileDetected:true,cancellationRejectedBeforeAcceptance:true,workerFailureRejected:true,evidence:root}));
}
if(process.versions.electron){
 const {app}=await import('electron');app.setPath('userData',path.join(root,'electron-profile'));
 // Electron must finish loading the entry module before ready can fire.
 void app.whenReady().then(verify).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>app.quit());
}else await verify();
