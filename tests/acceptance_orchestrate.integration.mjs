// Protocol fixtures exercise durable delegation without claiming model behavior.
// --live-cli additionally drives only the public parent through the actual CLI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harness,read,sha,skill} from './official_workflow_harness.mjs';
import {normalize,openTask,taskLocation,ownerState,inspectPath,childInput,childRequest,callKey,executablePath,preflightChildInput} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/orchestrate/task.mjs';
import orchestrate from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/orchestrate/registry.mjs';
import {workflowOverlay} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/bin/configure.mjs';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
const agent=process.env.ACCEPTANCE_AGENT??'codex',model=process.env.ACCEPTANCE_MODEL??'gpt-6-sol',effort=process.env.ACCEPTANCE_EFFORT??'high';
const overlay=await workflowOverlay({agent,model,effort});
const h=harness('acceptance-orchestrate',Object.keys(overlay.playbooks).map(id=>[id,id.replace('acceptance-','')]));
const root=h.project('protocol'),base={project_root:root,task_id:'TASK-protocol',request_id:'message-1',message:'原始用户要求：仅创建交付测试',context:{original:'原话保留',coverage:'off'}};
h.test('ORCH-01','Delegation retains original wording and refuses a conflicting message identity',()=>{
 const task=openTask(normalize(base));assert.equal(task.state.messages[0].message,base.message);assert.deepEqual(task.state.messages[0].context,base.context);task.release();
 assert.throws(()=>openTask(normalize({...base,message:'different goal'})),/conflicts/);
});
h.test('ORCH-02','An interrupted child is preserved rather than automatically replayed',()=>{
 const input=normalize({...base,task_id:'TASK-interrupted'}),task=openTask(input);task.state.pending={call_id:'child-in-flight',workflow:'acceptance-create',input:{project_root:root,request_id:'child-request'}};task.save();task.release();
 assert.throws(()=>openTask(input),/Interrupted child/);const state=read(path.join(taskLocation(input),'state.json'));assert.equal(state.pending.call_id,'child-in-flight');assert.equal(state.calls.length,0);
});
h.test('ORCH-03','An active task owner blocks concurrent work without replacing its claim',()=>{
 const input=normalize({...base,task_id:'TASK-owned'}),task=openTask(input),before=read(path.join(task.folder,'active.lock.d/owner.json'));
 assert.throws(()=>openTask(input),/active or uncertain/);assert.equal(ownerState(task.folder).token,before.token);task.release();
});
h.test('ORCH-04','Actual file inspection preserves complete bytes, hashes and explicit line ranges',()=>{
 const file=path.join(root,'source.md'),text='# 来源\n第一行原话。\n第二行原话。\n';fs.writeFileSync(file,text);
 const all=inspectPath(normalize(base),'source.md'),line=inspectPath(normalize(base),'source.md',{start_line:2,end_line:2});assert.equal(all.text,text);assert.equal(all.sha256,sha(file));assert.equal(line.text,'第一行原话。');
 const outside=path.join(h.temporary,'undelegated.txt');fs.writeFileSync(outside,'other project');assert.throws(()=>inspectPath(normalize(base),outside),/not delegated/);
});
h.test('ORCH-05','Generated command handoff preserves provenance and cannot target a different project',()=>{
 const input=normalize({...base,task_id:'TASK-command'}),command=path.join(root,'adoption.txt'),payload={project_root:root,definitions:{scenarios:[{id:'S1',origin:{kind:'generated',reference:'original#S1'}}]}};
 fs.writeFileSync(command,'/acceptance-freeze '+JSON.stringify(payload));const parsed=childInput({input},{workflow:'acceptance-freeze',input_file:command});assert.deepEqual(parsed,{...payload,project_root:input.project_root});
 assert.throws(()=>childInput({input},{workflow:'acceptance-create',input_file:command}),/another workflow/);
 assert.throws(()=>childInput({input},{input:{project_root:h.temporary}}),/another undelegated project/);
});
// Controlled official-port fixture: validates suspended-call persistence only,
// not a provider session, child business execution or product result.
let suspendedFixture,suspendedError;
try{
 const root=h.project('suspended-port-fixture'),tokens=new Map(),events=[],capabilities={effectLedger:{snapshot:()=>({schemaVersion:1,revision:0,boundaries:[],logicalOperations:[]})}};
 let plans=0,childCalls=0;
 const session={sessionId:'fixture-parent',playbookId:'acceptance-orchestrate',rootSessionId:'fixture-parent',depth:0,roleBindings:{orchestrator:{playerId:'fixture-planner',agent:{adapter:'codex',model,effort}}},playerSessions:{select:r=>tokens.get(r)??false,update:(r,t)=>tokens.set(r,t),snapshot:()=>Object.fromEntries(tokens),restore:obj=>{tokens.clear();for(const [k,v]of Object.entries(obj))tokens.set(k,v);}},ports:{emitStatus:async()=>{},emitTelemetry:async e=>events.push(e),recordStep:async()=>{},callPlayer:async()=>({status:'ok',resumeToken:'fixture-resume',finalText:JSON.stringify(++plans===1?{action:'call',reason:'Protocol suspension fixture only',notes:'Await controlled child',workflow:'acceptance-create',input:{project_root:root,request_id:'child',user_request:'fixture only'}}:{action:'finish',reason:'Protocol callback received',notes:'No product run claimed',status:'needs_input',summary:'Controlled callback recorded',question:'Protocol fixture question',evidence_call_ids:[]})}),callPlaybook:async()=>{childCalls++;return{state:'suspended',childSessionId:'fixture-child'};}}};
 const first=orchestrate.createRuntime({},capabilities);await first.init(session);const input={project_root:root,task_id:'TASK-suspended',request_id:'message',message:'Controlled port suspension protocol fixture',budget_seconds:600};
 const waiting=await first.handleBossInput({text:JSON.stringify(input),signal:new AbortController().signal});const saved=first.exportSnapshot();assert.equal(waiting.outcome,'suspended');assert.equal(saved.suspendedCall.childSessionId,'fixture-child');assert.equal(saved.sequences.playbookCall,1);
 const second=orchestrate.createRuntime({},capabilities);await second.restore(session,saved);const done=await second.resumePlaybookCall({callId:waiting.pendingCall.callId,result:{status:'ok',playbookId:'acceptance-create',childSessionId:'fixture-child',output:{status:'fixture_callback_only'}},signal:new AbortController().signal});
 assert.equal(done.stateDescription,'needs_input: Controlled callback recorded: Protocol fixture question');assert.equal(done.terminal.description,done.stateDescription);assert.ok(done.stateDescription.length<400);assert.equal(done.output.calls.length,1);assert.equal(read(path.join(taskLocation(normalize(input)),'requests/message/result.json')).calls.length,1);
 assert.equal(done.output.status,'needs_input');assert.equal(childCalls,1);assert.equal(second.exportSnapshot().suspendedCall,undefined);assert.equal(ownerState(taskLocation(normalize(input))),null);suspendedFixture={childCalls,plans,final:done.output.status};
}catch(error){suspendedError=error;}
h.test('ORCH-06','A suspended native-call protocol snapshot restores its callback without starting a second child',()=>{if(suspendedError)throw suspendedError;return suspendedFixture;});
h.test('ORCH-07','Authored command JSON is forwarded verbatim and cache identity includes workflow and semantic input',()=>{const input=normalize({...base,task_id:'TASK-verbatim'}),file=path.join(root,'verbatim.txt'),text=JSON.stringify({project_root:input.project_root,context:{ratio:1}}).replace('"ratio":1','"ratio":1.0');fs.writeFileSync(file,'/acceptance-freeze '+text);assert.equal(childRequest({input},{workflow:'acceptance-freeze',input_file:file}).text,text);assert.equal(callKey('acceptance-a',{a:1,b:2}),callKey('acceptance-a',{b:2,a:1}));assert.notEqual(callKey('acceptance-a',{a:1}),callKey('acceptance-b',{a:1}));});
h.test('ORCH-08','Generic executable lookup handles a project-specific tool with spaces without shell execution',()=>{const bin=path.join(root,'custom-bin');fs.mkdirSync(bin);const name='project tool',file=path.join(bin,name);fs.writeFileSync(file,'fixture only, do not execute');fs.chmodSync(file,0o755);const original=process.env.PATH;try{process.env.PATH=bin+path.delimiter+original;assert.equal(executablePath(name),file);assert.equal(executablePath('definitely-absent-project-tool'),null);}finally{process.env.PATH=original;}});
h.test('ORCH-09','Local images remain byte-bound attachments rather than lossy decoded text',()=>{const file=path.join(root,'pixel.png');fs.writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XsAAAAASUVORK5CYII=','base64'));const info=inspectPath(normalize(base),file);assert.equal(info.kind,'local_image');assert.equal(info.sha256,sha(file));assert.equal(info.text,undefined);});
// Actual storage and parent runtime with controlled official-port decisions;
// this checks preflight effects, not model reasoning or a real native session.
let preflightFixture,preflightError;
try{
 const project=h.project('preflight-parent'),at='AT-parent-preflight';createAcceptance({project_root:project,acceptance_id:at,request_id:'create',user_request:'仅创建参数准备验证。'});
 const invalid={project_root:project,acceptance_id:at,request_id:'freeze',basis:'冻结原始口述合同。',base_definitions_sha256:null,definitions:{requirements:[{id:'ORDER',text:'检索时按原始顺序返回结果。',origin:{kind:'conversation'},external_refs:[]}]}};
 const valid={...invalid,definitions:{context:{business_goal:'根据已提供合同冻结检索行为。'},requirements:[{...invalid.definitions.requirements[0],origin:{kind:'conversation',reference:'protocol-fixture:original-request'}}]}};
 assert.equal((await preflightChildInput('acceptance-freeze',invalid,JSON.stringify(valid))).status,'ready','Preflight must validate the actual transmitted JSON when a verbatim payload is available');
 let plans=0,children=0;const capabilities={effectLedger:{snapshot:()=>({schemaVersion:1,revision:0,boundaries:[],logicalOperations:[]})}},tokens=new Map();
 const session={sessionId:'fixture-preflight-parent',playbookId:'acceptance-orchestrate',rootSessionId:'fixture-preflight-parent',depth:0,roleBindings:{orchestrator:{playerId:'fixture-planner',agent:{adapter:'codex',model,effort}}},playerSessions:{select:r=>tokens.get(r)??false,update:(r,t)=>tokens.set(r,t),snapshot:()=>Object.fromEntries(tokens)},ports:{emitStatus:async()=>{},emitTelemetry:async()=>{},recordStep:async()=>{},callPlayer:async(_role,prompt)=>{
  plans++;if(plans===2){assert.ok(prompt.includes('child_input_invalid'));assert.ok(prompt.includes('definitions.context.business_goal'));assert.ok(prompt.includes('definitions.requirements.0.origin.reference'));assert.equal(children,0);assert.equal(fs.existsSync(path.join(project,'.acceptance',at,'scenarios.json')),false);}
  return{status:'ok',resumeToken:'fixture-preflight-token',finalText:JSON.stringify(plans<=2?{action:'call',reason:'Controlled contract preparation fixture',notes:'Only freeze the supplied requirement',workflow:'acceptance-freeze',input:plans===1?invalid:valid}:{action:'finish',reason:'Actual storage receipt obtained',notes:'No cases or execution',status:'completed',summary:'Frozen after read-only input correction',evidence_call_ids:[]})};
 },callPlaybook:async()=>{children++;return{state:'completed',result:{status:'ok',playbookId:'acceptance-freeze',childSessionId:'fixture-real-freeze',output:freezeAcceptance(valid)}};}}};
 const runtime=orchestrate.createRuntime({},capabilities);await runtime.init(session);const input={project_root:project,task_id:'TASK-preflight-parent',request_id:'message',message:'Freeze only the supplied original requirement',budget_seconds:600};
 const done=await runtime.handleBossInput({text:JSON.stringify(input),signal:new AbortController().signal});assert.equal(done.output.status,'completed');assert.equal(children,1);assert.equal(plans,3);
 const folder=taskLocation(normalize(input)),state=read(path.join(folder,'state.json'));assert.equal(state.calls.length,1);assert.equal(state.calls[0].result.output.status,'frozen');
 const first=read(path.join(folder,'requests/message/planner/0001-preflight.json'));assert.equal(first.status,'invalid');assert.ok(first.issues.length>=2);preflightFixture={children,plans,issues:first.issues};
}catch(error){preflightError=error;}
h.test('ORCH-10','Child-owned preflight corrects multiple missing fields before any official child or storage publication',()=>{if(preflightError)throw preflightError;return preflightFixture;});
if(h.live){
 const live=h.project('live'),taskId='TASK-live';h.run('git-init','git',['init','-q',live]);fs.writeFileSync(path.join(live,'README.md'),'# Minimal project\nNo product tests requested.\n');h.run('git-add','git',['add','README.md'],{cwd:live});h.run('git-commit','git',['-c','user.name=Acceptance Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture baseline'],{cwd:live});
 const call=(input,label)=>{const value=h.cli('acceptance-orchestrate',input,label,live,{timeout:900000});const file=path.join(live,'.acceptance-local/orchestration',input.task_id,'requests',input.request_id,'result.json');return{...value,result:read(file)};};
 let created,at;
 const create={project_root:live,task_id:taskId,request_id:'create-only',message:'新建一个交付测试，只创建空容器即停止；没有需求，不冻结、不生成场景或用例、不运行测试。',budget_seconds:600};
 h.test('ORCH-LIVE-01','Only the parent is called; the real nested create stops at an empty container',()=>{
  created=call(create,'01-create-only');assert.equal(created.result.status,'completed');const state=read(path.join(live,'.acceptance-local/orchestration',taskId,'state.json'));assert.deepEqual(state.calls.map(c=>c.workflow),['acceptance-create']);at=state.calls[0].result.output.acceptance_id;
  assert.ok(at);assert.equal(fs.existsSync(path.join(live,'.acceptance',at,'scenarios.json')),false);assert.equal(fs.existsSync(path.join(live,'.acceptance-local',at,'workspace')),false);
  const child=created.traces.find(t=>t.type==='playbook.call.started'&&t.playbookId==='acceptance-orchestrate');assert.ok(child);assert.ok(created.traces.some(t=>t.playbookId==='acceptance-create'&&t.parentSessionId));
 });
 if(at){
  h.test('ORCH-LIVE-02','Identical completed message returns saved result without another role/child call',()=>{const before=sha(path.join(live,'.acceptance-local/orchestration',taskId,'state.json')),again=call(create,'02-cached-message');assert.equal(again.result.status,'completed');assert.equal(again.traces.some(t=>t.type==='playbook.call.started'),false);assert.equal(again.traces.some(t=>t.type==='player.call.started'),false);assert.equal(sha(path.join(live,'.acceptance-local/orchestration',taskId,'state.json')),before);});
  const quote='R1：成功执行时返回一个 JSON 对象，退出码为 0。';
  h.test('ORCH-LIVE-03','A later user message freezes oral requirements in the same AT and stops before design',()=>{
   const next=call({project_root:live,task_id:taskId,request_id:'freeze-only',message:'在刚才的同一交付测试中，只冻结以下口述需求后停止：'+quote+' 不生成场景、准备环境、生成用例或运行测试。',context:{source:{kind:'conversation',reference:'TASK-live/freeze-only',original:quote}},budget_seconds:900},'03-freeze-only');assert.equal(next.result.status,'completed');const defs=read(path.join(live,'.acceptance',at,'scenarios.json'));assert.equal(defs.requirements.length,1);assert.equal(defs.requirements[0].text,quote);assert.equal(defs.scenarios.length,0);assert.equal(fs.existsSync(path.join(live,'.acceptance-local',at,'workspace')),false);
   const state=read(path.join(live,'.acceptance-local/orchestration',taskId,'state.json'));assert.equal(state.calls.at(-1).workflow,'acceptance-freeze');assert.equal(state.messages.length,2);
  });
 }
 h.test('ORCH-LIVE-04','Missing user requirements produce a concrete question without inventing scope or running tests',()=>{
  const requested={project_root:live,task_id:'TASK-missing-input',request_id:'question',message:'我稍后才会提供另一项新需求。现在请说明还需要我提供什么，不要猜需求，不要采用旧需求，不创建、冻结或执行测试。',budget_seconds:600};const result=call(requested,'04-missing-input');assert.equal(result.result.status,'needs_input');assert.ok(result.result.question?.trim());const state=read(path.join(live,'.acceptance-local/orchestration',requested.task_id,'state.json'));assert.equal(state.calls.some(c=>['acceptance-create','acceptance-freeze','acceptance-cases','acceptance-execute'].includes(c.workflow)),false);
 });
}
let continuationFailure,continuationEvidence=[];
try{
 for(const fault of ['budget','native']){
  const root=h.project('continuation-'+fault),input={project_root:root,task_id:'TASK-continuation-'+fault,request_id:'first',message:'Controlled continuation fault; no product execution',budget_seconds:600};let plans=0,children=0;
  const capabilities={effectLedger:{snapshot:()=>({schemaVersion:1,revision:0,boundaries:[],logicalOperations:[]})}},session={sessionId:'continuation-'+fault,playbookId:'acceptance-orchestrate',rootSessionId:'continuation-'+fault,depth:0,roleBindings:{orchestrator:{playerId:'fixture',agent:{adapter:'codex',model,effort}}},playerSessions:{select:()=>false,update:()=>{},snapshot:()=>({})},ports:{emitStatus:async()=>{},emitTelemetry:async()=>{},recordStep:async()=>{},callPlayer:async()=>{if(++plans>1)throw Error('controlled native routing failure');return{status:'ok',finalText:JSON.stringify({action:'call',reason:'Controlled protocol fixture',notes:'Await one callback',workflow:'acceptance-create',input:{project_root:root,request_id:'child',user_request:'fixture'}})};},callPlaybook:async()=>{children++;return{state:'suspended',childSessionId:'controlled-child'};}}};
  const runtime=orchestrate.createRuntime({},capabilities);await runtime.init(session);const waiting=await runtime.handleBossInput({text:JSON.stringify(input),signal:new AbortController().signal}),folder=taskLocation(normalize(input)),file=path.join(folder,'requests/first/input.json');
  if(fault==='budget')fs.utimesSync(file,new Date(0),new Date(0)); // Only the isolated protocol fixture clock is expired.
  const child={status:'ok',playbookId:'acceptance-create',childSessionId:'controlled-child',output:{status:'fixture_callback_only'}},done=await runtime.resumePlaybookCall({callId:waiting.pendingCall.callId,result:child,signal:new AbortController().signal});
  assert.equal(done.output.status,'blocked');assert.match(done.output.reason,fault==='budget'?/budget exhausted/:/controlled native routing failure/);const saved=read(path.join(folder,'state.json'));assert.equal(saved.pending,null);assert.equal(saved.calls.length,1);assert.equal(saved.calls[0].result.output.status,'fixture_callback_only');assert.equal(children,1);assert.equal(ownerState(folder),null);assert.equal(read(path.join(folder,'requests/first/result.json')).reason,done.output.reason);
  const next=openTask(normalize({...input,request_id:'authorized-followup'}));assert.equal(next.state.calls.length,1);next.release();continuationEvidence.push({fault,children,status:done.output.status});
 }
}catch(error){continuationFailure=error;}
h.test('ORCH-11','Settled child callbacks preserve receipts and release only their own task claim when continuation budget or native planning fails',()=>{if(continuationFailure)throw continuationFailure;return{continuations:continuationEvidence};});
h.finish(['workflows/orchestrate/registry.mjs','workflows/orchestrate/task.mjs','workflows/orchestrate/orchestrator.md','docs/orchestration-workflow.md','tests/acceptance_orchestrate.integration.mjs']);
