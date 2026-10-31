// Adapt only the session's optional metadata, never models, roles or scheduling.
// SPEX artifacts use the standard public Player port even in a future enhanced host.
export function spexEntry(entry){return{...entry,createRuntime(options,capabilities){
 const runtime=entry.createRuntime(options,capabilities);
 const standard=session=>({...session,roleBindings:Object.fromEntries(Object.entries(session.roleBindings??{}).map(([id,{playerId,promptIdentity}])=>[id,{playerId,promptIdentity}]))});
 const init=runtime.init.bind(runtime);runtime.init=session=>init(standard(session));
 if(runtime.restore){const restore=runtime.restore.bind(runtime);runtime.restore=(session,saved)=>restore(standard(session),saved);}
 return runtime;
}};}
