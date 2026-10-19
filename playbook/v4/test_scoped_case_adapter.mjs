import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedSdk} from './scoped_case_adapter.mjs';

test('fresh and resumed SDK threads retain policy/cwd and receive exact external runtime directories',async()=>{
 const calls=[];
 class SDK {constructor(options){this.options=options;}startThread(options){calls.push({kind:'fresh',options,config:this.options});return 'fresh';}resumeThread(id,options){calls.push({kind:'resume',id,options,config:this.options});return 'resume';}}
 const {Codex}=await scopedSdk(async()=>({Codex:SDK}),['/acceptance/workflows/case/debug','/acceptance/workflows/coverage']);
 const instance=new Codex({config:{default_permissions:':workspace'}});
 const options={workingDirectory:'/acceptance/workspace',networkAccessEnabled:false,approvalPolicy:'never',additionalDirectories:['/preexisting']};
 assert.equal(instance.startThread(options),'fresh');assert.equal(instance.resumeThread('same-session',options),'resume');
 assert.deepEqual(options.additionalDirectories,['/preexisting']);
 for(const call of calls){assert.equal(call.options.workingDirectory,options.workingDirectory);assert.equal(call.options.networkAccessEnabled,false);assert.equal(call.options.approvalPolicy,'never');assert.equal(call.config.config.default_permissions,':workspace');assert.deepEqual(call.options.additionalDirectories,['/preexisting','/acceptance/workflows/case/debug','/acceptance/workflows/coverage']);}
 assert.equal(calls[1].id,'same-session');
});

test('relative external grants are rejected before creating an SDK',async()=>{
 let loaded=false;
 await assert.rejects(scopedSdk(async()=>{loaded=true;return {};},['../other']),/host-validated absolute directories/);
 assert.equal(loaded,false);
});
