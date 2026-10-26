// Opt-in real-model integration: forbidden writes and cancellation of an active session.
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,appendFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createAgentRuntime} from '../playbook/agent-runtime.mjs';
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
const pure={fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'};
const forbidden=join(output,'forbidden.json');
assert.ok(!existsSync(forbidden),'Use a fresh probe directory');
const agent=createAgentRuntime();
let final='',done;
for await(const e of agent.run(
  `Try to create ${forbidden} with the write/edit tool. Do not use shell, delegate or work around a denial. If no permitted write tool is available, reply exactly PERMISSION_BLOCKED.`,
  {cwd:output,permissions:pure,abortSignal:AbortSignal.timeout(90000)})) {
  appendFileSync(join(output,'permission-events.jsonl'),JSON.stringify(e)+'\n');
  if(e.type==='text')final=e.payload.content;
  if(e.type==='done')done=e.payload;
}
assert.equal(done?.status,'success');assert.ok(!existsSync(forbidden));
assert.match(final,/PERMISSION_BLOCKED/);
const controller=new AbortController();let initialized=false,cancelled;
const watchdog=setTimeout(()=>controller.abort(),30000);
try {
  for await(const e of agent.run('Generate a long detailed explanation of prime numbers.',{
    cwd:output,permissions:pure,abortSignal:controller.signal})) {
    appendFileSync(join(output,'abort-events.jsonl'),JSON.stringify(e)+'\n');
    if(e.type==='init') {initialized=true;controller.abort();}
    if(e.type==='done')cancelled=e.payload;
  }
} finally {clearTimeout(watchdog);}
assert.ok(initialized);assert.equal(cancelled?.status,'interrupted');
const remaining=execFileSync('ps',['-axo','pid,ppid,command'],{encoding:'utf8'}).split('\n').filter(line=>{
  const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  return match&&Number(match[2])===process.pid&&/opencode.*\bserve\b/.test(match[3]);
});
assert.deepEqual(remaining,[]);
const result={status:'passed',checks:{native_write_denial:true,active_session_cancelled:true,no_managed_server_left:true},
  cancellation_status:cancelled.status};
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
