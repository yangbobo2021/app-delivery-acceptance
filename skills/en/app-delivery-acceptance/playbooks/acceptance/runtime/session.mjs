import {finalMessage} from './final-message.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {rolePrompt,readOnlyProjectionAsync} from './role-contract.mjs';
const contexts=new AsyncLocalStorage();
export const currentPlayerContext=()=>contexts.getStore();
export const withPlayerSession=(session,operation,snapshot)=>contexts.run({session,snapshot},operation);
export async function callRole(request,emit,signal){
 const context=currentPlayerContext();if(!context)throw Error('No official workflow session');
 const {session}=context,{role}=request,binding=session.roleBindings?.[role];
 if(!binding)throw Error('Workflow did not declare role '+role);
 const selected=session.playerSessions.select(role);
 if(request.options.resume && request.options.resume!==selected)throw Error('Role continuation is not retained in this official session; inspect original effects before starting a fresh attempt');
 const standard=request.profile==='standard';
 const resume=standard?selected:request.options.resume??false,id=randomUUID(),output=path.join(request.directory,'official-player');fs.mkdirSync(output,{recursive:true});
 const invocation=path.join(output,id+'.json');
 fs.writeFileSync(invocation,JSON.stringify({role,player_id:binding.playerId,session_id:session.sessionId,invocation_sequence:fs.readdirSync(output).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).length+1,cwd:request.options.cwd,resume,permissions:request.options.permissions,attachments:request.attachments,profile:standard?'standard':'native-events',...(standard?{cwd_authority:'prompt-contract',permissions_authority:'prompt-contract',native_events:'not-exposed'}:{}),started_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 await session.ports.recordStep?.({id,kind:'player',stateId:'running'},context.snapshot?.());
 let lastDone;const final=finalMessage();
 if(standard){
  const prompt=rolePrompt(request),contractFile=path.join(output,id+'.prompt.txt');fs.writeFileSync(contractFile,prompt,{flag:'wx'});
  const before=request.options.permissions?.fileWrite==='deny'?await readOnlyProjectionAsync(request.options.cwd,request.directory,{signal:signal??context.signal}):null;
  if(before)fs.writeFileSync(path.join(output,id+'.readonly-before.json'),JSON.stringify(before)+'\n',{flag:'wx'});
  const response=await session.ports.callPlayer(role,prompt,signal??context.signal??new AbortController().signal,{resume,freshPrompt:prompt});
  if(response.resumeToken||response.status==='ok')session.playerSessions.update(role,response.resumeToken);
  fs.writeFileSync(path.join(output,id+'.result.json'),JSON.stringify(response,null,2)+'\n',{flag:'wx'});
  await session.ports.recordStep?.({id,kind:'player',stateId:'running',result:response},context.snapshot?.());
  const after=before?await readOnlyProjectionAsync(request.options.cwd,request.directory,{signal:signal??context.signal}):null;
  if(after)fs.writeFileSync(path.join(output,id+'.readonly-after.json'),JSON.stringify(after)+'\n',{flag:'wx'});
  if(before&&!isDeepStrictEqual(before,after))throw Error('Read-only role changed project files; preserve the official result and filesystem evidence for reconciliation');
  fs.writeFileSync(path.join(output,id+'.answer-source.json'),JSON.stringify({source:'official-player-final-text',text:response.finalText})+'\n',{flag:'wx'});
  const provenance={source:'official-player-result',invocation_file:invocation,workflow_session_id:session.sessionId,role,player_id:binding.playerId};
  if(response.status==='ok'&&typeof response.finalText==='string')await emit({type:'text',payload:{content:response.finalText},provenance});
  else await emit({type:'error',payload:{message:response.error??'Official Player did not complete'},provenance});
  await emit({type:'done',payload:{status:response.status==='ok'?'success':response.status},provenance});
  return;
 }
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
