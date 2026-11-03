import {isAbsolute} from 'node:path';
// Scope Electron's Node mode to this workflow's Node-only child processes.
// Never change the host environment or reinterpret a project-owned executable.
export function nodeEnvironment(env=process.env){
 return process.versions.electron?{...env,ELECTRON_RUN_AS_NODE:'1'}:env;
}
export function nodeCommand(...args){
 return process.versions.electron?['env','ELECTRON_RUN_AS_NODE=1',process.execPath,...args]:[process.execPath,...args];
}
// Decode only the Node command forms emitted above, independent of the
// process reading a retained profile (Node CLI or Electron Node mode).
export function nodeScriptPath(command){
 if(!Array.isArray(command))throw Error('Frozen Node command required');
 const wrapped=command[0]==='env'&&command[1]==='ELECTRON_RUN_AS_NODE=1';
 const script=command[wrapped?3:1];
 if(typeof script!=='string'||!isAbsolute(script))throw Error('Frozen Node command has no script');
 return script;
}
