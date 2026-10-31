import fs from 'node:fs';
import path from 'node:path';
import {inside,read,atomicJson,ownedAbsolute,locations} from './store.mjs';
import {digest} from './definitions.mjs';
import {git} from './workspace.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
export function alive(pid,{group=false}={}){if(!Number.isSafeInteger(Number(pid))||Number(pid)<=0)return false;try{process.kill(group?-Number(pid):Number(pid),0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;throw e;}}
export function filesUnder(root,{skipDirectories=[]}={}){const files=[];if(!fs.existsSync(root))return files;function visit(dir){for(const name of fs.readdirSync(dir).sort()){if(['node_modules','.git','__pycache__','.venv','venv'].includes(name))continue;const candidate=path.join(dir,name),stat=fs.lstatSync(candidate);if(stat.isSymbolicLink())continue;const file=inside(dir,name);if(stat.isDirectory()){if(!skipDirectories.includes(name))visit(file);}else if(stat.isFile())files.push(file);}}visit(root);return files;}
export function inspectProcesses(folder){const observations=[];for(const file of filesUnder(folder)){
 const name=path.basename(file);if(name==='runner.pid'){const pid=Number(fs.readFileSync(file,'utf8').trim());observations.push({file,pid,alive:alive(pid),group_alive:alive(pid,{group:true})});}
 else if(['intent.json','execution-intent.json','owner.json','launcher.json'].includes(name)){const value=read(file),pid=value.child_pid??value.pid;if(pid!==undefined)observations.push({file,pid,alive:alive(pid),group_alive:alive(pid,{group:true})});}
 }return observations;
}
export function assertQuiescent(observations){if(observations.some(x=>x.alive||x.group_alive))throw Error('An owning process or detached process group is still alive; no recovery or replay is allowed');}
export function verifyExecutionReceipt(file,catalog){
 const r=read(file),root=catalog.project_root;if(r.head_before!==catalog.revision||r.head_after!==catalog.revision||git(root,'rev-parse','HEAD').trim()!==catalog.revision)throw Error('Recovery execution revision mismatch');
 if(digest(path.join(path.dirname(file),'execution.log'))!==r.log_sha256)throw Error('Recovery execution log changed');if(r.unexpected_tracked_changes?.length)throw Error('Interrupted execution changed unbound tracked files');
 if(!r.test_file_sha256_after||!Object.keys(r.test_file_sha256_after).length)throw Error('Execution receipt has no bound test files');
 for(const [name,hash]of Object.entries(r.test_file_sha256_after))if(!hash||digest(inside(root,name))!==hash||r.test_file_sha256_before[name]!==hash)throw Error('Recovery selected test bytes changed: '+name);return r;
}
export function verifyRoleResume(directory){
 const runtime=read(path.join(directory,'agent-runtime.json')),events=fs.readFileSync(path.join(directory,'agent.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse),session=events.find(e=>e.type==='init')?.sessionId;
 if(runtime.transport?.profile==='standard'){
  const binding=read(path.join(directory,'role-call-binding.json')),done=events.filter(e=>e.type==='done').at(-1),text=events.filter(e=>e.type==='text').at(-1);
  if(!equal(binding.agent_runtime,runtime)||binding.role!==runtime.role||binding.player_id!==runtime.player_id)throw Error('Original official role binding changed');
  if(done?.payload?.status!=='success'||done.provenance?.source!=='official-player-result')throw Error('Unsuccessful standard-port role has no proved continuation; reconcile effects before superseding');
  const invocation=done.provenance.invocation_file,folder=path.join(directory,'official-player');
  if(typeof invocation!=='string'||path.dirname(invocation)!==folder||text?.provenance?.invocation_file!==invocation)throw Error('Completed role lacks matching official Player result');
  const calls=fs.readdirSync(folder).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).map(name=>({file:path.join(folder,name),value:read(path.join(folder,name))})).sort((a,b)=>(a.value.invocation_sequence??0)-(b.value.invocation_sequence??0)||a.value.started_at.localeCompare(b.value.started_at));
  if(calls.at(-1)?.file!==invocation||calls.some(c=>!fs.existsSync(c.file.replace(/\.json$/,'.result.json'))))throw Error('A later or unfinished official role call has uncertain effects; do not adopt an earlier result');
  const call=read(invocation),response=read(invocation.replace(/\.json$/,'.result.json'));
  if(call.profile!=='standard'||call.role!==binding.role||call.player_id!==binding.player_id||call.cwd!==binding.cwd||response.status!=='ok'||response.finalText!==text.payload.content||call.session_id!==done.provenance.workflow_session_id)throw Error('Completed role lacks matching official Player result');
  if(call.permissions?.fileWrite==='deny'&&!equal(read(invocation.replace(/\.json$/,'.readonly-before.json')),read(invocation.replace(/\.json$/,'.readonly-after.json'))))throw Error('Read-only role changed project files');
  return{action:'adopt_completed_role',session_id:call.session_id,provider_session_id:response.resumeToken??null,native_events:'not-exposed',runtime,proof_files:Object.fromEntries(filesUnder(directory).map(file=>[file,digest(file)]))};
 }
 if(!session||!runtime.service?.provider||runtime.transport?.kind!=='official-playbook-player-port')throw Error('Interrupted role lacks original official session and service binding');
 const binding=read(path.join(directory,'role-call-binding.json'));
 if(!equal(binding.agent_runtime,runtime)||binding.role!==runtime.role||binding.player_id!==runtime.player_id)throw Error('Original official role binding changed');
 const done=events.filter(e=>e.type==='done').at(-1);
 if(done?.payload?.status==='success'){
  const official=path.join(directory,'official-player');
  const calls=fs.readdirSync(official).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).map(name=>path.join(official,name));
  if(calls.some(file=>!fs.existsSync(file.replace(/\.json$/,'.result.json'))))throw Error('A later or unfinished official role call has uncertain effects; do not adopt an earlier result');
  calls.sort((a,b)=>(read(b).invocation_sequence??0)-(read(a).invocation_sequence??0)||read(b).started_at.localeCompare(read(a).started_at));
  const completed=calls.slice(0,1).some(file=>{
   const call=read(file),responseFile=file.replace(/\.json$/,'.result.json'),eventFile=file.replace(/\.json$/,'.events.jsonl');
   if(!fs.existsSync(responseFile)||!fs.existsSync(eventFile))return false;
   const response=read(responseFile),native=fs.readFileSync(eventFile,'utf8').trim().split('\n').map(JSON.parse);
   return call.role===binding.role&&call.player_id===binding.player_id&&call.cwd===binding.cwd&&typeof call.session_id==='string'&&
    response.status==='ok'&&response.resumeToken===session&&done.sessionId===session&&
    native.some(event=>event.type==='init'&&event.sessionId===session)&&native.some(event=>event.type==='done'&&event.sessionId===session&&event.payload?.status==='success');
  });
  if(!completed)throw Error('Completed role lacks matching official Player result and native session evidence');
  return {action:'adopt_completed_role',session_id:session,runtime,proof_files:Object.fromEntries(filesUnder(directory).map(file=>[file,digest(file)]))};
 }
 if(done?.payload?.status!=='error'||!events.some(e=>e.type==='error'))throw Error('Role interruption is not a proved unsuccessful transport; inspect effects before superseding');
 // The CLI's durable root UUID does not prove provider continuity. In v18
 // unsuccessful calls clear optional continuation hints, and a rejected hint
 // may deliberately fall back to a fresh provider session. Never grant a
 // side-effecting retry on the strength of that root UUID alone.
 throw Error('Unsuccessful official role has no proved provider continuation. Inspect/reconcile its external effects, then explicitly supersede the preserved attempt; automatic role replay is forbidden');
}
export function staleClaimRecovery(project,id,folder,operation){
 const {local}=locations(project,id),gate=inside(local,'recovery.lock.d');try{fs.mkdirSync(gate);}catch(e){if(e.code==='EEXIST')throw Error('Another recovery is active or uncertain');throw e;}
 const gateOwner=path.join(gate,'owner.json');fs.writeFileSync(gateOwner,JSON.stringify({pid:process.pid,folder}),{flag:'wx'});
 try{
  const observations=inspectProcesses(folder),workspaceClaim=inside(local,'workspace.lock.d');
  if(fs.existsSync(workspaceClaim)){for(const item of inspectProcesses(workspaceClaim))observations.push(item);}
  assertQuiescent(observations);
  const archived=[];for(const claim of [path.join(folder,'active.lock.d'),workspaceClaim])if(fs.existsSync(claim)){
    const value=read(path.join(claim,'owner.json'));if(value.output_dir&&path.resolve(value.output_dir)!==path.resolve(folder))throw Error('Stale workspace claim belongs to another attempt');
    const destination=path.join(folder,'recovery-claims',Date.now()+'-'+path.basename(claim));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(claim,destination);archived.push({from:claim,to:destination});
  }
  return operation({observations,archived});
 }finally{fs.unlinkSync(gateOwner);fs.rmdirSync(gate);}
}
