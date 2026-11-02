import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const artifact=path.resolve(process.argv[2]??'skills/en/app-delivery-acceptance/playbooks/acceptance');
const {createAcceptance}=await import(pathToFileURL(path.join(artifact,'workflows/create/initialize.mjs')));
const {AcceptanceView}=await import(pathToFileURL(path.join(artifact,'workflows/view/data.mjs')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-view-progress-'));
try{
 const id='AT-view-fixture';createAcceptance({project_root:root,acceptance_id:id,request_id:'synthetic-fixture',user_request:'Synthetic viewer regression fixture; no product test.'});
 const attempt=path.join(root,'.acceptance-local',id,'workflows/runtime/failed-inspection');fs.mkdirSync(attempt,{recursive:true});
 fs.writeFileSync(path.join(attempt,'request.frozen.json'),'{}\n');const failure=JSON.stringify({reason:'preserved historical inspection failure'})+'\n';fs.writeFileSync(path.join(attempt,'failure.json'),failure);
 const view=new AcceptanceView(root,id),active=()=>view.snapshot().progress.stages.filter(stage=>!stage.finished);assert.equal(active().length,0,'an unowned terminal failure is history, not active work');
 fs.mkdirSync(path.join(attempt,'active.lock.d'));fs.writeFileSync(path.join(attempt,'active.lock.d/owner.json'),JSON.stringify({pid:process.pid}));
 assert.equal(active().length,1,'a current ownership claim still needs attention');
 // Change only the synthetic fixture lifecycle, never an actual acceptance.
 fs.unlinkSync(path.join(root,'.acceptance-local/current.json'));
 assert.equal(active().length,0,'historical acceptance is not current progress');
 assert.equal(fs.readFileSync(path.join(attempt,'failure.json'),'utf8'),failure,'original failure remains intact');
 console.log('PASS: historical failures stay preserved, current claims remain visible, closed acceptances do not show active progress.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
