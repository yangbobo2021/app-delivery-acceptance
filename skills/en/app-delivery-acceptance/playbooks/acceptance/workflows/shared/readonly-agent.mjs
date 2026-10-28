import {finalMessage} from '../../runtime/final-message.mjs';
// Public official PlaybookRuntime: the official CLI binds Players and owns all
// provider sessions. Business JSON is submitted verbatim to deterministic gates;
// it is never reparsed by a second model as a generic developer outcome.
import {randomUUID} from 'node:crypto';
export function readonlyAgentRegistry({id,role,intent,prepare,finalize,fail,advisory=false}){
 const validateOptions=(value={})=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error(id+' accepts no config options');return {};};
 function createRuntime(_options,capabilities){
  let session,position='ready',result=null,sequence=0,turn=0,calls=0,spec=null;
  const terminal=()=>['done','off','unavailable','skipped','blocked'].includes(position),state=()=>({value:position,activeStateIds:[position],stateId:position,tags:[position==='ready'?'playbook.parked':'playbook.busy'],status:terminal()?'done':'active',quiescent:true});
  const snapshot=()=>({schemaVersion:4,playbookId:session.playbookId,machine:{position,result,spec},roleResumeTokens:session.playerSessions?.snapshot()??{},sequences:{trace:sequence,turn,judgeCall:0,playerCall:calls,playbookCall:0,captainCall:0},state:state(),pendingBossQuestions:[],effectLedger:capabilities.effectLedger.snapshot()});
  const trace=async(type,payload,callId)=>session.ports.emitTelemetry({topic:'playbook.trace',payload:{schemaVersion:4,sessionId:session.sessionId,playbookId:session.playbookId,rootSessionId:session.rootSessionId,...(session.parentSessionId?{parentSessionId:session.parentSessionId}:{}),...(session.parentCallId?{parentCallId:session.parentCallId}:{}),depth:session.depth,sequence:++sequence,timestamp:Date.now(),type,turnId:turn,payload,...(callId?{callId}:{})}});
  const transition=async next=>{const from=position;position=next;await trace('fsm.transition',{from,to:next});};
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
      if(!answer){await transition('perform');const callId='player-'+(++calls),stepId=randomUUID(),resume=session.playerSessions?.select(role)??false;await session.ports.recordStep?.({id:stepId,kind:'player',stateId:'perform'},snapshot());await trace('player.call.started',{stateId:'perform',sourceItem:id,roleId:role,playerId:session.roleBindings[role].playerId,resume},callId);
       const final=finalMessage(),structured=session.roleBindings[role]?.agent?.adapter==='opencode';const response=await session.ports.callPlayer(role,spec.prompt+(structured?'\nUse native StructuredOutput: place the complete required JSON object inside result.':''),signal,{resume,nativeSkills:false,onEvent:event=>final.observe(event),...(structured?{outputSchema:{type:'object',additionalProperties:true}}:{})});if(response.resumeToken)session.playerSessions?.update(role,response.resumeToken);await trace('player.call.finished',{stateId:'perform',sourceItem:id,roleId:role,playerId:session.roleBindings[role].playerId,resume,...response},callId);await session.ports.recordStep?.({id:stepId,kind:'player',stateId:'perform',result:response},snapshot());
       if(response.status!=='ok'||typeof response.finalText!=='string'||!response.finalText.trim())throw Error(response.error??'Official Player did not submit a complete raw answer');answer=final.select(response).text;
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
 return {id,command:id,intent,artifactSchema:3,runtimeProfile:{kind:'shared-factory',compat:{artifactSchema:3,runtimeAbi:1}},requiredRoleIds:[role],concurrentRoleSets:[],validateOptions,createRuntime};
}
