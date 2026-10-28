import {finalMessage} from './final-message.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const contexts=new AsyncLocalStorage();
export const currentPlayerContext=()=>contexts.getStore();
export const withPlayerSession=(session,operation,snapshot)=>contexts.run({session,snapshot},operation);
export async function callRole(request,emit,signal){
 const context=currentPlayerContext();if(!context)throw Error('No official workflow session');
 const {session}=context,{role}=request,binding=session.roleBindings?.[role];
 if(!binding)throw Error('Workflow did not declare role '+role);
 const selected=session.playerSessions.select(role);
 if(request.options.resume && request.options.resume!==selected)throw Error('Role continuation is not retained in this official session; inspect original effects before starting a fresh attempt');
 const resume=request.options.resume??false,id=randomUUID(),output=path.join(request.directory,'official-player');fs.mkdirSync(output,{recursive:true});
 const invocation=path.join(output,id+'.json');
 fs.writeFileSync(invocation,JSON.stringify({role,player_id:binding.playerId,session_id:session.sessionId,cwd:request.options.cwd,resume,permissions:request.options.permissions,attachments:request.attachments,started_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 await session.ports.recordStep?.({id,kind:'player',stateId:'running'},context.snapshot?.());
 let lastDone;const final=finalMessage();
 const options={...request.options,resume,...(resume===false?{freshSession:true}:{}),attachments:request.attachments,onEvent:async event=>{
  final.observe(event);fs.appendFileSync(path.join(output,id+'.events.jsonl'),JSON.stringify(event)+'\n');
  if(event.type==='done'){lastDone=event;return;}
  if(!['text','text_delta'].includes(event.type))await emit(event);
 }};
 // Codex/Claude use their existing validated JSON text contract. OpenCode needs its native structured format.
 if(binding.agent.adapter!=='opencode')delete options.outputSchema;
 const response=await session.ports.callPlayer(role,request.prompt+(options.outputSchema?'\nSubmit the complete task JSON object inside the native StructuredOutput result field.':''),signal??context.signal??new AbortController().signal,options);
 if(response.resumeToken||response.status==='ok')session.playerSessions.update(role,response.resumeToken);
 fs.writeFileSync(path.join(output,id+'.result.json'),JSON.stringify(response,null,2)+'\n',{flag:'wx'});
 await session.ports.recordStep?.({id,kind:'player',stateId:'running',result:response},context.snapshot?.());
 const selectedAnswer=final.select(response);fs.writeFileSync(path.join(output,id+'.answer-source.json'),JSON.stringify(selectedAnswer,null,2)+'\n',{flag:'wx'});
 if(response.status==='ok'&&typeof selectedAnswer.text==='string')await emit({type:'text',payload:{content:selectedAnswer.text}});
 else await emit({type:'error',payload:{message:response.error??'Official Player did not complete'}});
 await emit(lastDone?{...lastDone,payload:{...lastDone.payload,status:response.status==='ok'?'success':response.status}}:{type:'done',payload:{status:response.status==='ok'?'success':response.status}});
}
export function withPlayerTurn(session,signal,operation,snapshot){return contexts.run({session,signal,snapshot},operation);}
