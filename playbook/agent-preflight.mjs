import {createAgentRuntime} from './v3/runtime-path.mjs';

// No acceptance identity or product execution is created by this connectivity check.
let metadata;
try {
  const agent=createAgentRuntime(); metadata=agent.metadata;
  let success=false,reply='';
  for await (const event of agent.run('Reply exactly ACCEPTANCE_RUNTIME_READY. Do not call tools.',{
    cwd:process.cwd(),abortSignal:AbortSignal.timeout(180000),
    permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'},
  })) {
    if (event.type==='text') reply=event.payload?.content??'';
    if (event.type==='done') success=event.payload?.status==='success';
  }
  if (!success||reply.trim()!=='ACCEPTANCE_RUNTIME_READY') throw Error('Selected Agent/model did not complete the connectivity check');
  console.log(JSON.stringify({status:'ready',agent_runtime:metadata}));
} catch (error) {
  console.error(JSON.stringify({status:'blocked',agent_runtime:metadata,error:error.message}));
  process.exitCode=1;
}
