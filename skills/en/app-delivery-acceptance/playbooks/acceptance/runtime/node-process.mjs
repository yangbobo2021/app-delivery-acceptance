// Scope Electron's Node mode to this workflow's Node-only child processes.
// Never change the host environment or reinterpret a project-owned executable.
export function nodeEnvironment(env=process.env){
 return process.versions.electron?{...env,ELECTRON_RUN_AS_NODE:'1'}:env;
}
export function nodeCommand(...args){
 return process.versions.electron?['env','ELECTRON_RUN_AS_NODE=1',process.execPath,...args]:[process.execPath,...args];
}
