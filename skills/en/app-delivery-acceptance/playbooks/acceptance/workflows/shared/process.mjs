import fs from 'node:fs';
import {nodeEnvironment} from '../../runtime/node-process.mjs';
import {currentPlayerContext,callRole} from '../../runtime/session.mjs';
import {packageRoot} from '../../root.mjs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';

export async function runProcess(program,args,{cwd,env=process.env,output,timeoutSeconds=900,signal}={}){
  if(!output||fs.existsSync(output))throw Error('Process observation must use a new output directory');
  if(signal?.aborted)throw Error('Process cancelled before launch');
  fs.mkdirSync(output,{recursive:true});const log=path.join(output,'combined.log'),fd=fs.openSync(log,'wx'),started=performance.now(),receipt={program,args,cwd,started_at:new Date().toISOString(),...(program===process.execPath&&process.versions.electron?{node_environment:{ELECTRON_RUN_AS_NODE:'1'}}:{})};
  let child,timer,forced,timedOut=false,cancelled=false,code,childSignal;
  try{
    const roleController=new AbortController();let roleCalls=0;
    const context=currentPlayerContext(),isRole=context&&args[0]?.startsWith(path.join(packageRoot,'workflows')+path.sep)&&args[0].includes(path.sep+'roles'+path.sep);
    const childEnv=program===process.execPath?nodeEnvironment(env):env;
    child=spawn(program,args,{cwd,env:isRole?{...childEnv,ACCEPTANCE_PLAYER_BINDINGS:JSON.stringify(context.session.roleBindings)}:childEnv,detached:true,stdio:isRole?['ignore',fd,fd,'ipc']:['ignore',fd,fd]});
    if(isRole)child.on('message',message=>{
      if(message?.kind!=='acceptance-player-call')return;
      const send=value=>new Promise(resolve=>{if(!child.connected)return resolve();child.send(value,()=>resolve());});
      roleCalls++;void callRole(message.request,event=>send({kind:'acceptance-player-event',id:message.id,event}),AbortSignal.any([context.signal,roleController.signal])).then(()=>send({kind:'acceptance-player-end',id:message.id}),error=>send({kind:'acceptance-player-end',id:message.id,error:error.message})).finally(()=>roleCalls--);
    });
    child.once('close',()=>{if(roleCalls)roleController.abort(new Error('Role subprocess ended before its invocation settled'));});
    atomicJson(path.join(output,'intent.json'),{...receipt,child_pid:child.pid??null});
    const terminate=()=>{roleController.abort(new Error('Role subprocess cancelled or timed out'));if(!child.pid)return;try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}forced=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},10000);};
    const abort=()=>{cancelled=true;terminate();};timer=setTimeout(()=>{timedOut=true;terminate();},timeoutSeconds*1000);signal?.addEventListener('abort',abort,{once:true});
    try{[code,childSignal]=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exit,sig)=>resolve([exit,sig]));});}
    finally{signal?.removeEventListener('abort',abort);}
  }catch(error){atomicJson(path.join(output,'failure.json'),{...receipt,status:'unknown',reason:error.message,automatic_retry:false});throw error;}
  finally{clearTimeout(timer);clearTimeout(forced);fs.closeSync(fd);}
  const result={...receipt,child_pid:child.pid,exit_code:code,signal:childSignal,timed_out:timedOut,cancelled,finished_at:new Date().toISOString(),seconds:(performance.now()-started)/1000,log:{path:log,sha256:digest(log)}};atomicJson(path.join(output,'command.json'),result);return result;
}
