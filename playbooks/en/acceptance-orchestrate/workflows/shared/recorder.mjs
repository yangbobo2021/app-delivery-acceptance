import {validArgv} from './argv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {inside,atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';
import {git} from './workspace.mjs';
import {projectCoverage} from './coverage-registry.mjs';
import {coveragePreparation} from './coverage.mjs';
import {read} from './store.mjs';
import {isDeepStrictEqual as equal} from 'node:util';

export async function recordExecution(request,{signal,timeoutSeconds=600,env=process.env}={}){
  const root=fs.realpathSync(request.cwd),out=path.resolve(request.output),command=request.command;
  if(!validArgv(command))throw Error('Frozen execution needs an argv array');
  const active=projectCoverage(root);
  if(active?.policy==='required'){
    if(!request.coverage_session)throw Error('Active project requires its frozen coverage session; direct recording cannot bypass collection');
    const session=read(request.coverage_session),profile=coveragePreparation(active,{runCheck:false});
    if(session.cwd!==root||path.resolve(session.output,'command')!==out||session.prepared!==active.prepared||session.prepared_sha256!==digest(path.join(active.prepared,'prepared.json'))||!equal(command,[...profile.entry,'run',path.resolve(request.coverage_session),path.join(session.output,'run-response.json')]))throw Error('Coverage execution session does not bind this command/output');
  }else if(request.coverage_session)throw Error('Coverage session has no active project preparation');
  if(!Number.isSafeInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>7200)throw Error('Execution timeout must be explicit and bounded');
  if(fs.existsSync(out))throw Error('Execution output already exists; inspect its intent and receipt before retrying');
  const changes=request.env??{};
  if(!changes||Array.isArray(changes)||Object.entries(changes).some(([key,value])=>!key||key.includes('=')||key.includes('\0')||typeof value!=='string'||value.includes('\0')))throw Error('Execution environment must contain explicit string values');
  const files={};for(const name of request.files??[]){const file=inside(root,name);if(!fs.statSync(file).isFile())throw Error('Test file unavailable: '+name);files[name]=digest(file);}
  if(!Object.keys(files).length)throw Error('Selected test files required');
  const headBefore=git(root,'rev-parse','HEAD').trim(),trackedBefore=git(root,'diff','--name-only','HEAD').trim(),statusBefore=git(root,'status','--porcelain','--untracked-files=all').trim();
  const unexpected=trackedBefore.split('\n').filter(Boolean).filter(name=>!Object.hasOwn(files,name));
  if(unexpected.length)throw Error('Unbound tracked changes before execution: '+unexpected.join(', '));
  const fresh=(request.fresh_dirs??[]).map(file=>path.resolve(file));
  if(new Set(fresh).size!==fresh.length||fresh.some(file=>fs.existsSync(file)))throw Error('Fresh execution directory already exists or repeats');
  if(signal?.aborted)throw Error('Execution cancelled before launch');
  fs.mkdirSync(out,{recursive:true});for(const file of fresh)fs.mkdirSync(file,{recursive:true});
  const intent={schema:'isolated-test-execution-v1',start_utc:new Date().toISOString(),cwd:root,command,env_changes:changes,fresh_dirs:fresh,head_before:headBefore,tracked_changes_before:trackedBefore,status_before:statusBefore,test_file_sha256_before:files,
    ...(request.coverage_session?{coverage_session_path:path.resolve(request.coverage_session),coverage_session_sha256:digest(request.coverage_session)}:{})};
  const intentFile=path.join(out,'execution-intent.json');atomicJson(intentFile,intent);
  const logFile=path.join(out,'execution.log'),fd=fs.openSync(logFile,'wx'),started=performance.now();let timedOut=false,cancelled=false,forced,child,code,childSignal;
  try{
    child=spawn(command[0],command.slice(1),{cwd:root,env:{...env,...changes},detached:true,stdio:['ignore',fd,fd]});
    if(child.pid){intent.child_pid=child.pid;atomicJson(intentFile,intent);}
    const terminate=()=>{if(!child.pid)return;try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}forced=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);};
    const cancel=()=>{cancelled=true;terminate();},timer=setTimeout(()=>{timedOut=true;terminate();},timeoutSeconds*1000);signal?.addEventListener('abort',cancel,{once:true});
    try{[code,childSignal]=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,sig)=>resolve([status,sig]));});}
    finally{clearTimeout(timer);clearTimeout(forced);signal?.removeEventListener('abort',cancel);}
  }catch(error){atomicJson(path.join(out,'execution-failure.json'),{status:'unknown',reason:error.message,child_pid:child?.pid??null,automatic_retry:false});throw error;}
  finally{fs.closeSync(fd);}
  const after={};for(const name of Object.keys(files)){const file=inside(root,name);after[name]=fs.existsSync(file)&&fs.statSync(file).isFile()?digest(file):null;}
  const trackedAfter=git(root,'diff','--name-only','HEAD').trim(),unexpectedAfter=trackedAfter.split('\n').filter(Boolean).filter(name=>!Object.hasOwn(files,name));
  const receipt={...intent,end_utc:new Date().toISOString(),duration_seconds:(performance.now()-started)/1000,exit_code:code??(timedOut?124:cancelled?130:128),signal:childSignal,timed_out:timedOut,cancelled,head_after:git(root,'rev-parse','HEAD').trim(),tracked_changes_after:trackedAfter,status_after:git(root,'status','--porcelain','--untracked-files=all').trim(),test_file_sha256_after:after,log_sha256:digest(logFile),...(unexpectedAfter.length?{unexpected_tracked_changes:unexpectedAfter}:{})};
  atomicJson(path.join(out,'execution.json'),receipt);return receipt;
}
