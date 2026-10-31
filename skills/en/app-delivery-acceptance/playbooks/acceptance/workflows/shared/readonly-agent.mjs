import {finalMessage} from '../../runtime/final-message.mjs';
// Public official PlaybookRuntime: the official CLI binds Players and owns all
// provider sessions. Business JSON is submitted verbatim to deterministic gates;
// it is never reparsed by a second model as a generic developer outcome.
import fs from 'node:fs';
import path from 'node:path';
import {createAgentRuntime} from '../../runtime/players.mjs';
import {withPlayerTurn} from '../../runtime/session.mjs';
export function readonlyAgentRegistry({id,role,intent,prepare,finalize,fail,advisory=false,resultSchema}){
 const validateOptions=(value={})=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error(id+' accepts no config options');return {};};
 function createRuntime(_options,capabilities){
  let session,position='ready',result=null,sequence=0,turn=0,calls=0,spec=null;
  const terminal=()=>['done','off','unavailable','skipped','blocked'].includes(position),state=()=>({value:position,activeStateIds:[position],stateId:position,tags:terminal()?[]:[position==='ready'?'playbook.parked':'playbook.busy'],status:terminal()?'done':'active',quiescent:true});
  const snapshot=()=>({schemaVersion:4,playbookId:session.playbookId,machine:{position,result,spec},roleResumeTokens:session.playerSessions?.snapshot()??{},sequences:{trace:sequence,turn,judgeCall:0,playerCall:calls,playbookCall:0,captainCall:0},state:state(),pendingBossQuestions:[],effectLedger:capabilities.effectLedger.snapshot()});
  const trace=async(type,payload,callId)=>session.ports.emitTelemetry({topic:'playbook.trace',payload:{schemaVersion:4,sessionId:session.sessionId,playbookId:session.playbookId,rootSessionId:session.rootSessionId,...(session.parentSessionId?{parentSessionId:session.parentSessionId}:{}),...(session.parentCallId?{parentCallId:session.parentCallId}:{}),depth:session.depth,sequence:++sequence,timestamp:Date.now(),type,turnId:turn,payload,...(callId?{callId}:{})}});
  const transition=async next=>{const previousState=state(),from=position;position=next;await trace('fsm.transition',{from,to:next,previousState,state:state()});};
  return {
   async init(value){session=value;},exportSnapshot(){return snapshot();},
   async restore(value,saved){if(saved.schemaVersion!==4||saved.playbookId!==value.playbookId)throw Error('Read-only workflow snapshot identity mismatch');session=value;({position,result,spec}=saved.machine);sequence=saved.sequences.trace;turn=saved.sequences.turn;calls=saved.sequences.playerCall;session.playerSessions?.restore(saved.roleResumeTokens);},
   async handleBossInput({text,signal,onAccepted}){
    if(position!=='ready')throw Error('An interrupted read-only engagement must be inspected; no automatic role replay');onAccepted?.();turn++;await trace('boss.input.received',{text});
    try{
     await transition('preparing');spec=await prepare(JSON.parse(text));
     if(spec.completed)result=spec.completed;
     else{
      let answer=spec.savedAnswer;
      if(!answer){
       await transition('perform');const callId='player-'+(++calls),directory=path.join(spec.folder,'role');fs.mkdirSync(directory,{recursive:true});
       await trace('player.call.started',{stateId:'perform',sourceItem:id,roleId:role,playerId:session.roleBindings[role].playerId},callId);
       const final=finalMessage();let status,error;
       await withPlayerTurn(session,signal,async()=>{
        const agent=createAgentRuntime({role,directory,preferStandard:true});
        for await(const event of agent.run(spec.prompt,{cwd:spec.normalized.project_root,permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'},jsonOutput:true,jsonResultSchema:resultSchema?resultSchema(spec):{type:'object',additionalProperties:true},signal})){
         fs.appendFileSync(path.join(directory,'agent.jsonl'),JSON.stringify(event)+'\n');final.observe(event);
         if(event.type==='done')status=event.payload?.status;if(event.type==='error')error=event.payload?.message;
        }
       },snapshot);
       answer=final.select({}).text;
       await trace('player.call.finished',{stateId:'perform',sourceItem:id,roleId:role,playerId:session.roleBindings[role].playerId,status:status==='success'?'ok':status??'error',...(typeof answer==='string'?{finalText:answer}:{})},callId);
       if(status!=='success'||error||typeof answer!=='string'||!answer.trim())throw Error(error??'Official Player did not submit a complete raw answer');
      }
      await transition('finalizing');result=await finalize(spec,answer);
     }
     const final=result?.status==='not_required'?'skipped':advisory&&result?.status==='off'?'off':advisory&&result?.status==='unavailable'?'unavailable':result?.status==='blocked'?'blocked':'done';await transition(final);
    }catch(error){await transition('failing');try{result=await fail(spec,error.message);}catch(second){result={status:'blocked',reason:error.message+'; '+second.message};}await transition(advisory?'unavailable':'blocked');}
    const stateDescription=JSON.stringify({workflow:id,state:position,status:result?.status??position,...(result?.reason?{reason:result.reason}:{}),...(result?.receipt_path?{receipt_path:result.receipt_path}:{}),...(result?.stopped_after?{stopped_after:result.stopped_after}:{})});
    await session.ports.emitStatus(JSON.stringify(result));await trace('boss.input.settled',{outcome:'terminal'});return {outcome:'terminal',state:state(),stateDescription,terminal:{stateId:position,kind:position==='blocked'?'failure':'success',description:stateDescription},output:result};
   },
   async resumePlaybookCall(){throw Error('This read-only workflow has no pending nested call');},async dispose(){},
  };
 }
 return {id,command:id,intent,artifactSchema:3,runtimeProfile:{kind:'shared-factory',compat:{artifactSchema:3,runtimeAbi:1}},requiredRoleIds:[role],rolePolicies:{[role]:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}},concurrentRoleSets:[],validateOptions,createRuntime};
}
