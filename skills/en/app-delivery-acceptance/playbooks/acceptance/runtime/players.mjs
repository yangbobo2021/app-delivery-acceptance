// Workflow roles use the official session port. This module owns no SDK or CLI loop.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {currentPlayerContext,callRole} from './session.mjs';
import {resolveRuntimeConfig,bindAgentRuntime} from './configuration.mjs';
import {installedPackage} from './installed.mjs';
export {bindAgentRuntime,resolveAgentRuntime} from './configuration.mjs';
const select=value=>typeof value==='string'?value:value?.kind==='value'?value.value:null;
function bindings(){
 const context=currentPlayerContext();
 if(context)return context.session.roleBindings;
 if(process.send && process.env.ACCEPTANCE_PLAYER_BINDINGS)return JSON.parse(process.env.ACCEPTANCE_PLAYER_BINDINGS);
 throw Error('Roles must run inside a configured official Playbook workflow session');
}
const pending=new Map();let sequence=0;
if(process.send){process.channel?.unref();process.on('message',message=>{
 if(message?.kind!=='acceptance-player-event'&&message?.kind!=='acceptance-player-end')return;
 const queue=pending.get(message.id);if(!queue)return;
 queue.values.push(message);queue.wake?.();queue.wake=null;
});}
export function createAgentRuntime({directory,resume=false,role='worker',model,effort,preferStandard=false}={}){
 const binding=bindings()[role];if(!binding?.playerId)throw Error('Official host did not expose configured role: '+role);
 const standard=preferStandard||!binding.agent,hasMetadata=Boolean(binding.agent);
 const agent=!hasMetadata?'host-managed':{claude:'claude-code',codex:'codex',opencode:'opencode'}[binding.agent.adapter];
 const selectedModel=!hasMetadata?null:select(binding.agent.model),selectedEffort=!hasMetadata?null:select(binding.agent.effort);
 if(!standard&&(!agent||!selectedModel))throw Error('Acceptance roles require an explicit supported Agent and model');
 if(model&&model!==selectedModel||effort&&effort!==selectedEffort)throw Error('Stage override conflicts with the official role configuration');
 const env={...process.env,ACCEPTANCE_AGENT:agent,ACCEPTANCE_MODEL:selectedModel};if(selectedEffort)env.ACCEPTANCE_EFFORT=selectedEffort;else delete env.ACCEPTANCE_EFFORT;
 const {metadata}=standard?{metadata:{schema:'acceptance-agent-runtime-v1',agent,model:selectedModel??null,effort:selectedEffort??null,service:{provider:'host-managed'},prompt_identity:binding.promptIdentity??null}}:resolveRuntimeConfig({env,model:selectedModel,effort:selectedEffort});
 metadata.effort=selectedEffort??null;metadata.model_source='official-role-binding';
 metadata.transport={kind:'official-playbook-player-port',profile:standard?'standard':'native-events',...(standard?{native_events:'not-exposed',configuration_owner:'host'}:{playbook_version:installedPackage('@sublang/playbook').manifest.version})};
 if(!standard){const sdk={codex:'@openai/codex-sdk','claude-code':'@anthropic-ai/claude-agent-sdk',opencode:'@opencode-ai/sdk'}[agent];metadata.sdk={package:sdk,version:installedPackage(sdk).manifest.version};metadata.transport.cligent_version=installedPackage('@sublang/cligent').manifest.version;}
 metadata.role=role;metadata.player_id=binding.playerId;
 metadata.role_binding_sha256=createHash('sha256').update(JSON.stringify(binding)).digest('hex');
 if(directory)bindAgentRuntime(directory,metadata,{resume});
 return {metadata,async *run(prompt,options={}){
  if(options.model&&options.model!==selectedModel||options.effort&&options.effort!==selectedEffort)throw Error('Run model/effort differs from official role binding');
  const blocks=typeof prompt==='string'?[{type:'text',text:prompt}]:prompt;
  if(!Array.isArray(blocks)||blocks.some(x=>!['text','local_image'].includes(x.type)))throw Error('Unsupported role prompt');
  const request={role,directory:path.resolve(directory),prompt:blocks.filter(x=>x.type==='text').map(x=>x.text).join('\n'),
   attachments:blocks.filter(x=>x.type==='local_image').map(x=>({path:path.resolve(x.path)})),
   profile:standard?'standard':'native-events',options:{cwd:path.resolve(options.cwd??process.cwd()),permissions:options.permissions??{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'},nativeSkills:false,
    ...(options.resume?{resume:options.resume}:{}),...(options.jsonOutput?{outputSchema:options.jsonResultSchema??{type:'object',additionalProperties:true}}:{}),
    ...(agent==='claude-code'&&options.permissions?.fileWrite==='deny'?{allowedTools:options.permissions.shellExecute==='deny'?[]:['Read','Glob','Grep','Bash']}:{}),
   }};
  const bindingFile=path.join(request.directory,'role-call-binding.json'),frozen={role,player_id:binding.playerId,cwd:request.options.cwd,agent_runtime:metadata};
  if(fs.existsSync(bindingFile)){if(JSON.stringify(JSON.parse(fs.readFileSync(bindingFile)))!==JSON.stringify(frozen))throw Error('Role call cwd/Agent/model/service changed within an attempt');}
  else {if(options.resume&&!standard)throw Error('Resume requires an existing verified role-call binding');fs.writeFileSync(bindingFile,JSON.stringify(frozen)+'\n',{flag:'wx'});}
  // Business gates consume only final text; intermediate prose is kept in the official journal.
  const queue={values:[],wake:null},id=String(++sequence);pending.set(id,queue);
  let job;
  if(currentPlayerContext())job=callRole(request,event=>{queue.values.push({kind:'acceptance-player-event',event});queue.wake?.();queue.wake=null;},options.signal).then(()=>{queue.values.push({kind:'acceptance-player-end'});queue.wake?.();},error=>{queue.values.push({kind:'acceptance-player-end',error:error.message});queue.wake?.();});
  else {process.channel?.ref();process.send({kind:'acceptance-player-call',id,request});}
  try{for(;;){if(!queue.values.length)await new Promise(resolve=>queue.wake=resolve);const message=queue.values.shift();if(message.kind==='acceptance-player-end'){if(message.error)throw Error(message.error);break;}yield message.event;}}finally{pending.delete(id);if(!pending.size)process.channel?.unref();await job;}
 }};
}
