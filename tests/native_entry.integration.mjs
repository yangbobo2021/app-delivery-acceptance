import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const packageRoot=path.resolve(process.argv[2]??'skills/en/app-delivery-acceptance/playbooks/acceptance');
const {normalizeBossInput}=await import(pathToFileURL(path.join(packageRoot,'workflows/orchestrate/task.mjs')));
const entry=(await import(pathToFileURL(path.join(packageRoot,'workflows/orchestrate/registry.mjs')))).default;
const {validateTestRoots}=await import(pathToFileURL(path.join(packageRoot,'workflows/shared/workspace.mjs')));
const {commandSignal,commandRegistry}=await import(pathToFileURL(path.join(packageRoot,'workflows/shared/command.mjs')));
const {withPlayerTurn}=await import(pathToFileURL(path.join(packageRoot,'runtime/session.mjs')));
async function cancellationBoundary(){
 let start,observed=false;const entered=new Promise(resolve=>start=resolve);
 const command=commandRegistry({id:'cancellation-regression',intent:'test host cancellation',successState:'done',parseInput:text=>text,
  operation:async(_text,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>{observed=true;resolve({status:'blocked',reason:'observed host cancellation'});},{once:true});start();})});
 const cancelRuntime=command.createRuntime({}, {effectLedger:{snapshot:()=>({schemaVersion:1,revision:0,boundaries:[],logicalOperations:[]}),writeAhead:async()=>{throw Error('unexpected effect');}}});
 const unused=async()=>{throw Error('unexpected Player or child invocation');};
 await cancelRuntime.init({sessionId:'00000000-0000-4000-8000-000000000001',rootSessionId:'00000000-0000-4000-8000-000000000001',playbookId:command.id,depth:0,roleBindings:{},playerSessions:{snapshot:()=>({})},
  ports:{callPlayer:unused,callCaptain:unused,callJudge:unused,callPlaybook:unused,emitTelemetry:async()=>{},emitStatus:async()=>{},recordStep:async()=>{}}});
 const host=new AbortController(),run=cancelRuntime.handleBossInput({text:'start',signal:host.signal});
 await entered;host.abort();let timer;
 try{await Promise.race([run,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('active operation missed host cancellation')),1000))]);assert.equal(observed,true);}
 finally{clearTimeout(timer);await cancelRuntime.dispose();}
}
const {nodeScriptPath}=await import(pathToFileURL(path.join(packageRoot,'runtime/node-process.mjs')));
assert.equal(nodeScriptPath(['/node','/tmp/entry.mjs']),'/tmp/entry.mjs');
assert.equal(nodeScriptPath(['env','ELECTRON_RUN_AS_NODE=1','/Spex','/tmp/entry.mjs']),'/tmp/entry.mjs');
assert.throws(()=>nodeScriptPath(['env','ELECTRON_RUN_AS_NODE=1','/Spex']),/no script/);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-native-entry-'));
try{
 for(const invalid of [['projects/python-cli/.acceptance-local'],['.'],['../tests'],['/absolute/tests'],['tests/.git']])assert.throws(()=>validateTestRoots(invalid),/Explicit test-only/);
 assert.deepEqual(validateTestRoots(['projects/python-cli/tests']),['projects/python-cli/tests']);
 const hostAbort=new AbortController(),actorAbort=new AbortController();const cancelled=withPlayerTurn({},hostAbort.signal,()=>commandSignal(actorAbort.signal));hostAbort.abort(new Error('user aborted'));assert.equal(cancelled.aborted,true);assert.match(cancelled.reason.message,/user aborted/);assert.equal(commandSignal(actorAbort.signal),actorAbort.signal);
 const host={cwd:root,sessionId:'official-session-1',rootSessionId:'official-root-1',turn:1};
 const natural=normalizeBossInput('请验收当前项目，不修改产品。',host);
 assert.equal(natural.project_root,fs.realpathSync(root));assert.equal(natural.message,'请验收当前项目，不修改产品。');
 assert.deepEqual(natural,normalizeBossInput(natural.message,host));
 assert.notEqual(natural.request_id,normalizeBossInput(natural.message,{...host,turn:2}).request_id);
 assert.equal(normalizeBossInput('请检查 JSON 示例 {"value":1}，不要执行测试。',host).message,'请检查 JSON 示例 {"value":1}，不要执行测试。');
 const followup=normalizeBossInput('继续查看证据',{...host,sessionId:'official-session-2'});
 assert.equal(natural.task_id,followup.task_id);assert.notEqual(natural.request_id,followup.request_id);
 assert.notEqual(natural.task_id,normalizeBossInput('新会话',{...host,rootSessionId:'another-root'}).task_id);
 const legacy={project_root:root,task_id:'external-task',request_id:'external-request',message:'只查看'};
 assert.equal(normalizeBossInput(JSON.stringify(legacy),host).task_id,'external-task');
 assert.equal(normalizeBossInput(JSON.stringify(legacy)).task_id,'external-task','CLI JSON does not require SPEX context');
 assert.throws(()=>normalizeBossInput('自然语言',{}),/当前项目目录/);
 assert.throws(()=>normalizeBossInput('{broken',host),/JSON 请求格式/);
 assert.throws(()=>entry.validateOptions({cwd:'relative'}));assert.throws(()=>entry.validateOptions({unexpected:true}));
 assert.deepEqual(entry.validateOptions({cwd:root}),{cwd:root});
 assert.deepEqual(entry.rolePolicies.orchestrator,{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'});
 assert.deepEqual(entry.requiredRoleIds,['orchestrator']);
 // Exercise the actual runtime boundary: bad input must identify the input error,
 // without a misleading pending-child reconciliation summary or any child effect.
 let childCalls=0;const statuses=[];const runtime=entry.createRuntime({cwd:root},{effectLedger:{snapshot(){return{};}}});
 await runtime.init({sessionId:'s1',rootSessionId:'r1',playbookId:entry.id,depth:0,ports:{async emitTelemetry(){},async emitStatus(s){statuses.push(s);},async callPlaybook(){childCalls++;throw Error('unexpected child');}}});
 const result=await runtime.handleBossInput({text:'{broken',signal:new AbortController().signal});
 assert.equal(result.output.status,'blocked');assert.match(result.output.summary,/JSON 请求格式/);assert.doesNotMatch(result.output.summary,/official child/);assert.equal(childCalls,0);assert.match(statuses[0],/JSON 请求格式/);
 await cancellationBoundary();
 console.log('PASS: official command cancellation boundary, safe test-root preflight, host cwd injection contract, natural-language normalization, stable conversation/request identities, legacy JSON, fail-closed options, actionable runtime errors without child effects.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
