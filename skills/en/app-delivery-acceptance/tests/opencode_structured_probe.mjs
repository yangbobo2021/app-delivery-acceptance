// Live native CLI/model regression. Credentials are inherited, never written here.
import {createAgentRuntime} from '../playbook/agent-runtime.mjs';
import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const out=resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const runtime=createAgentRuntime({directory:out});
const nonce=randomUUID();let done,answer,session;
for await(const event of runtime.run(`Return a JSON object with nonce=${JSON.stringify(nonce)}, nested={ok:true,values:[0,3,7]}, status="ready". Explain your answer in prose if you like, but submit the complete task object through the requested structured result envelope.`,{
 jsonOutput:true,jsonResultSchema:{type:'object',additionalProperties:true,
   properties:{protocol:{type:'string',enum:['fixture-v1']}},required:['protocol']},
 cwd:out,permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}})){
 appendFileSync(join(out,'events.jsonl'),JSON.stringify(event)+'\n');
 if(event.type==='init')session=event.sessionId;
 if(event.type==='text'&&event.payload?.source==='opencode-structured')answer=JSON.parse(event.payload.content);
 if(event.type==='done')done=event.payload;
}
assert.equal(done?.status,'success');assert.equal(answer?.nonce,nonce);
assert.deepEqual(answer?.nested,{ok:true,values:[0,3,7]});assert.equal(answer.status,'ready');
assert.equal(answer.protocol,'fixture-v1');
const original=structuredClone(answer);let continued,continuationDone,continuationSession;
for await(const event of runtime.run('Continue the same session. Preserve this exact JSON object and add only case_reuse: {schema: "case-reuse-plan-v1"}. No tools except structured submission, no file or test work. Original: '+JSON.stringify(original),{
 jsonOutput:true,jsonResultSchema:{type:'object',additionalProperties:true,properties:{case_reuse:{type:'object',additionalProperties:false,
  properties:{schema:{type:'string',enum:['case-reuse-plan-v1']}},required:['schema']}},required:['case_reuse']},
 resume:session,cwd:out,permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}})){
 appendFileSync(join(out,'continuation-events.jsonl'),JSON.stringify(event)+'\n');
 if(event.type==='init')continuationSession=event.sessionId;
 if(event.type==='tool_use')assert.equal(event.payload?.toolName,'StructuredOutput');
 if(event.type==='text'&&event.payload?.source==='opencode-structured')continued=JSON.parse(event.payload.content);
 if(event.type==='done')continuationDone=event.payload;
}
assert.equal(continuationDone?.status,'success');assert.equal(continuationSession,session);
assert.deepEqual(continued,{...original,case_reuse:{schema:'case-reuse-plan-v1'}});
writeFileSync(join(out,'result.json'),JSON.stringify({status:'passed',runtime:runtime.metadata,answer,continuation:{session,answer:continued,status:'passed'}},null,2)+'\n');
console.log('Native structured JSON probe passed');
