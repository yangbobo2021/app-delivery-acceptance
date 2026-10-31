import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {finalMessage} from '../../runtime/final-message.mjs';
import {createAgentRuntime} from '../../runtime/players.mjs';
import {withPlayerTurn} from '../../runtime/session.mjs';
import {atomicJson} from '../shared/store.mjs';
import {normalize,taskLocation,ownerState,openTask,discover,inspectPath,projectFacts,compact,childRequest,read,callKey,preflightChildInput} from './task.mjs';
const id='acceptance-orchestrate',role='orchestrator';
const permissions={fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'};
const instructions=fs.readFileSync(new URL('./orchestrator.md',import.meta.url),'utf8');
const decisionSchema={type:'object',properties:{action:{type:'string',enum:['inspect','call','finish']},reason:{type:'string'},notes:{type:'string'},files:{type:'array',items:{type:'object',properties:{path:{type:'string'},start_line:{type:'integer'},end_line:{type:'integer'},executable:{type:'string'}},additionalProperties:false}},workflow:{type:'string'},input:{type:'object',additionalProperties:true},input_file:{type:'string'},status:{type:'string',enum:['completed','needs_input','blocked']},summary:{type:'string'},question:{type:'string'},evidence_call_ids:{type:'array',items:{type:'string'}}},required:['action','reason','notes'],additionalProperties:false};
function validateOptions(value={}){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length)throw Error(id+' accepts task delegations, not configuration options');return{};}
function createRuntime(_options,capabilities){
 let session,position='ready',result=null,task=null,input=null,catalog=null,observation=null,pending=null,sequence=0,turn=0,players=0,children=0;
 const state=()=>({value:position,activeStateIds:[position],stateId:position,tags:position==='done'?[]:[['ready','waiting'].includes(position)?'playbook.parked':'playbook.busy'],status:position==='done'?'done':'active',quiescent:true});
 const suspended=()=>pending?.childSessionId?{callId:pending.call_id,playbookId:pending.workflow,childSessionId:pending.childSessionId,stateId:'waiting',text:pending.text??JSON.stringify(pending.input)}:undefined;
 const snapshot=({child}={})=>({schemaVersion:4,playbookId:session.playbookId,machine:{position,result,input,task:task?{folder:task.folder,requestFolder:task.requestFolder,token:task.token}:null,observation,pending},roleResumeTokens:session.playerSessions?.snapshot()??{},sequences:{trace:sequence,turn,judgeCall:0,playerCall:players,playbookCall:children,captainCall:0},state:state(),pendingBossQuestions:[],effectLedger:capabilities.effectLedger.snapshot(),...(child?{suspendedCall:{...child,stateId:'waiting',text:pending?.text??JSON.stringify(pending?.input??{})}}:suspended()?{suspendedCall:suspended()}:{} )});
 const trace=async(type,payload,callId)=>session.ports.emitTelemetry({topic:'playbook.trace',payload:{schemaVersion:4,sessionId:session.sessionId,playbookId:session.playbookId,rootSessionId:session.rootSessionId,...(session.parentSessionId?{parentSessionId:session.parentSessionId}:{}),...(session.parentCallId?{parentCallId:session.parentCallId}:{}),depth:session.depth,sequence:++sequence,timestamp:Date.now(),type,turnId:turn,payload,...(callId?{callId}:{})}});
 const transition=async next=>{const previousState=state(),from=position;position=next;await trace('fsm.transition',{from,to:next,previousState,state:state()});};
 const saveResult=async fields=>{
  result={schema:'acceptance-orchestration-result-v1',task_id:input?.task_id,request_id:input?.request_id,project_root:input?.project_root,...fields};
  if(task&&!task.cached){task.state.status=result.status;task.state.updated_at=new Date().toISOString();task.save();atomicJson(path.join(task.requestFolder,'result.json'),result);task.release();}
  // Host state descriptions are bounded presentation text; full receipts stay in output/storage.
  const meaning=[result.status,result.summary??result.reason,result.question].filter(Boolean).join(': ');
  await transition('done');await session.ports.emitStatus(meaning);await trace('boss.input.settled',{outcome:'terminal'});
  return{outcome:'terminal',state:state(),stateDescription:meaning,terminal:{stateId:'done',kind:result.status==='blocked'?'failure':'success',description:meaning},output:result};
 };
 const fail=error=>{
  if(task?.state?.pending){task.state.status='needs_reconciliation';task.save();}
  return saveResult({status:'blocked',reason:error.message,summary:'Inspect the preserved orchestration and official child/session receipts before continuation. No child was automatically replayed.',task_directory:task?.folder,pending:task?.state?.pending??null});
 };
 async function acceptChild(value){
  const directory=path.join(task.folder,'calls',pending.call_id);atomicJson(path.join(directory,'result.json'),value);
  task.state.calls.push({...pending,result:compact(value),result_file:path.join(directory,'result.json'),finished_at:new Date().toISOString()});
  task.state.pending=null;task.save();observation={kind:'child_result',call_id:pending.call_id,workflow:pending.workflow,result:compact(value),result_file:path.join(directory,'result.json')};
  await trace('playbook.call.finished',{stateId:'calling',request:{callId:pending.call_id,playbookId:pending.workflow,text:pending.text??JSON.stringify(pending.input)},result:value},pending.call_id);pending=null;
 }
 async function plan(signal){
  catalog??=await discover();const deadline=fs.statSync(path.join(task.requestFolder,'input.json')).mtimeMs+input.budget_seconds*1000;
  const combined=AbortSignal.any([signal,AbortSignal.timeout(Math.min(input.budget_seconds*1000,2147483647))]);
  const directory=path.join(task.requestFolder,'planner');fs.mkdirSync(directory,{recursive:true});
  const adapter=await withPlayerTurn(session,combined,()=>createAgentRuntime({directory,role}));
  let fresh=true;
  while(Date.now()<deadline){
   combined.throwIfAborted();await transition('planning');const number=String(++players).padStart(4,'0'),callId='planner-'+players;
   const resume=session.playerSessions?.select(role)??false;if(resume===false)fresh=true;
   const context={task_id:input.task_id,project_root:input.project_root,latest_delegation:input,messages:task.state.messages,notes:task.state.notes,observed:observation,calls:task.state.calls.map(c=>({call_id:c.call_id,workflow:c.workflow,input:c.input,result:compact(c.result),result_file:c.result_file})),...(fresh?{...catalog,project:projectFacts(input)}:{})};
   let nativeFailure=null,playerSettled=false;
   const protocol='Return one JSON object only, with quoted keys, no prose or second object. Use inspect/call/finish, not native shell tools. Required fields: action, reason, notes. For finish also provide status (completed/needs_input/blocked) and summary. For call provide workflow plus input or input_file. For inspect provide files. Diagnose decision_error by returning a corrected decision; do not investigate the orchestrator implementation. Keep the original goal and stopping point.\n';
   const prompt=(fresh?instructions+'\n':'')+protocol+JSON.stringify(context);
   fs.writeFileSync(path.join(directory,number+'-prompt.txt'),prompt,{flag:'wx'});const final=finalMessage();
   await trace('player.call.started',{stateId:'planning',roleId:role,playerId:session.roleBindings[role].playerId},callId);
   try{
    const images=[...new Map([...(observation?.items??[]),...(context.project?.source_documents??[])].filter(x=>x.kind==='local_image').map(x=>[x.path,x])).values()];
    const blocks=images.length?[{type:'text',text:prompt},...images.map(x=>({type:'local_image',path:x.path}))]:prompt;
    await withPlayerTurn(session,combined,async()=>{for await(const event of adapter.run(blocks,{cwd:input.project_root,permissions,resume,jsonOutput:true,jsonResultSchema:decisionSchema,signal:combined})){fs.appendFileSync(path.join(directory,'agent.jsonl'),JSON.stringify(event)+'\n');final.observe(event);if(event.type==='error')nativeFailure=event.payload?.message??'Official orchestrator role failed';if(event.type==='done'&&event.payload?.status!=='success')nativeFailure??='Official orchestrator role did not complete';}});
    if(nativeFailure)throw Error(nativeFailure);playerSettled=true;
    const answer=final.select({}).text;if(typeof answer!=='string')throw Error('Orchestrator returned no complete decision');fs.writeFileSync(path.join(directory,number+'-answer.txt'),answer,{flag:'wx'});
    await trace('player.call.finished',{stateId:'planning',roleId:role,status:'ok',finalText:answer},callId);
    const raw=answer.trim(),decision=JSON.parse(raw.startsWith('```')?raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''):raw);
    if(!decision||!['inspect','call','finish'].includes(decision.action)||typeof decision.reason!=='string')throw Error('Structured inspect/call/finish decision required');
    if(typeof decision.notes==='string')task.state.notes=decision.notes;task.save();fresh=false;
    if(decision.action==='inspect'){
     observation={kind:'inspection',items:(decision.files??[]).map(item=>{try{if(item.executable){const found=projectFacts({...input,source_files:[],executable_names:[item.executable]});return{executable:item.executable,available:found.available_executables};}return inspectPath(input,item.path,item);}catch(error){return{...item,error:error.message};}})};atomicJson(path.join(directory,number+'-inspection.json'),observation);continue;
    }
    if(decision.action==='finish'){
     if(!['completed','needs_input','blocked'].includes(decision.status)||!decision.summary?.trim())throw Error('Finish needs an actual task status and explanation');
     for(const cid of decision.evidence_call_ids??[]){const c=task.state.calls.find(c=>c.call_id===cid);if(!c)throw Error('Unknown evidence call '+cid);if(decision.status==='completed'&&(c.result.status!=='ok'||['blocked','failed','stale','unavailable'].includes(c.result.output?.status)||c.result.output?.review_status==='repair_required'))throw Error('Cited child is not successful: '+cid);}
     return saveResult({status:decision.status,summary:decision.summary,...(decision.question?{question:decision.question}:{}),notes:task.state.notes,evidence_call_ids:decision.evidence_call_ids??[],calls:task.state.calls.map(c=>({call_id:c.call_id,workflow:c.workflow,child_session_id:c.result.childSessionId,terminal:c.result.terminal,status:c.result.output?.status??c.result.status,review_status:c.result.output?.review_status,result_file:c.result_file})),task_directory:task.folder});
    }
    if(!catalog.workflows.some(w=>w.id===decision.workflow))throw Error('Unknown public child workflow: '+decision.workflow);
    const request=childRequest(task,decision),args=request.input,key=callKey(decision.workflow,args,decision.input_file?request.text:undefined),previous=task.state.calls.find(c=>c.key===key);
    if(previous){observation={kind:'already_called',reason:'Identical immutable invocation already has a receipt. Inspect it; use a genuinely new request and basis for authorized changed work.',call:previous};continue;}
    const checked=await preflightChildInput(decision.workflow,args,request.text);
    if(checked){
     atomicJson(path.join(directory,number+'-preflight.json'),{workflow:decision.workflow,input:args,input_key:key,...checked});
     if(checked.status==='invalid'){observation={kind:'child_input_invalid',workflow:decision.workflow,issues:checked.issues,reason:'Read-only contract preflight rejected the proposed input. No child call or business attempt was started. Correct the input from delegated facts; do not invent missing business intent.'};continue;}
    }
    children++;pending={call_id:'child-'+randomUUID(),key,workflow:decision.workflow,input:args,text:request.text,reason:decision.reason,started_at:new Date().toISOString()};
    const callFolder=path.join(task.folder,'calls',pending.call_id);fs.mkdirSync(callFolder,{recursive:true});atomicJson(path.join(callFolder,'input.json'),pending);
    task.state.pending=pending;task.save();await transition('calling');
    await trace('playbook.call.started',{stateId:'calling',request:{callId:pending.call_id,playbookId:pending.workflow,text:request.text}},pending.call_id);
    const started=await session.ports.callPlaybook({callId:pending.call_id,playbookId:pending.workflow,text:request.text},combined);
    if(started.state==='suspended'){pending.childSessionId=started.childSessionId;task.state.pending=pending;task.save();await transition('waiting');return{outcome:'suspended',state:state(),pendingCall:{callId:pending.call_id,playbookId:pending.workflow,childSessionId:pending.childSessionId}};}
    await acceptChild(started.result);
   }catch(error){
    if(!playerSettled||pending||combined.aborted||nativeFailure)throw error;
    observation={kind:'decision_error',reason:error.message};atomicJson(path.join(directory,number+'-error.json'),observation);fresh=false;
   }
  }
  throw Error('Orchestration resource budget exhausted');
 }
 const runtime={
  async init(value){session=value;},exportSnapshot:snapshot,
  async restore(value,saved){
   if(saved.playbookId!==value.playbookId||saved.schemaVersion!==4)throw Error('Orchestration snapshot identity mismatch');session=value;({position,result,input,observation,pending}=saved.machine);sequence=saved.sequences.trace;turn=saved.sequences.turn;players=saved.sequences.playerCall;children=saved.sequences.playbookCall;session.playerSessions?.restore(saved.roleResumeTokens);
   if(saved.machine.task){const value=saved.machine.task,owner=ownerState(value.folder);if(!owner||owner.token!==value.token||(owner.alive&&owner.pid!==process.pid))throw Error('Original orchestration owner cannot be reconciled');atomicJson(path.join(value.folder,'active.lock.d/owner.json'),{...owner,pid:process.pid});const stateFile=path.join(value.folder,'state.json');task={...value,input,state:read(stateFile),save(){atomicJson(stateFile,this.state);},release(){const dir=path.join(value.folder,'active.lock.d');if(read(path.join(dir,'owner.json')).token!==value.token)throw Error('Owner changed');fs.unlinkSync(path.join(dir,'owner.json'));fs.rmdirSync(dir);}};}
  },
  async handleBossInput({text,signal,onAccepted}){
   if(position!=='ready')throw Error('Use the retained official parent session to resume an interrupted orchestration');onAccepted?.();turn++;await trace('boss.input.received',{text});
   try{
    input=normalize(JSON.parse(text));
    if(input.inspect){const folder=taskLocation(input);return saveResult({status:'inspected',owner:ownerState(folder),task:fs.existsSync(path.join(folder,'state.json'))?compact(read(path.join(folder,'state.json'))):null});}
    task=openTask(input);if(task.cached)return saveResult({...task.cached,reused:true});
    return await plan(signal);
   }catch(error){return fail(error);}
  },
  async resumePlaybookCall({callId,result:childResult,signal}){if(!pending||pending.call_id!==callId)throw Error('Unexpected child continuation');try{await acceptChild(childResult);return await plan(signal);}catch(error){return fail(error);}},
  async dispose(){},
 };
 return runtime;
}
export default{id,command:id,intent:'Own the delegated acceptance goal, dynamically inspect and call independent public Playbooks, recover prerequisites and retain evidence; the host communicates only with this entry.',artifactSchema:3,runtimeProfile:{kind:'shared-factory',compat:{artifactSchema:3,runtimeAbi:1}},requiredRoleIds:[role],rolePolicies:{[role]:permissions},concurrentRoleSets:[],validateOptions,createRuntime};
