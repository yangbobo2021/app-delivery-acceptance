// Opt-in real-model integration probe. Caller supplies its native OpenCode environment.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createAgentRuntime} from '../playbook/agent-runtime.mjs';
const output=resolve(process.argv[2]),image=resolve(process.argv[3]);
mkdirSync(output,{recursive:true});
const workspace=join(output,'workspace');mkdirSync(workspace,{recursive:true});
const artifact=join(workspace,'probe-result.json'),nonce=randomBytes(12).toString('hex');
const roles=[];
const pure={fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'};
const parse=text=>JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
async function run(role,prompt,permissions,{resume,agent}={}) {
  const directory=join(output,role);mkdirSync(directory,{recursive:true});
  agent??=createAgentRuntime({directory});
  let answer='',done,session;const events=[];
  for await(const event of agent.run(prompt,{cwd:workspace,permissions,resume,abortSignal:AbortSignal.timeout(150000)})) {
    events.push(event);appendFileSync(join(directory,'events.jsonl'),JSON.stringify(event)+'\n');
    if(event.type==='text')answer=event.payload.content;
    if(event.type==='done')done=event.payload;
    if(event.type==='init')session=event.sessionId;
  }
  assert.equal(done?.status,'success',JSON.stringify(done));
  assert.ok(session);roles.push({role,session_id:session,agent_runtime:agent.metadata,
    tool_calls:events.filter(e=>e.type==='tool_use').length,answer});
  return {answer,session,agent,events};
}
try {
  if(process.argv[4]==='image-only') {
    const vision=await run('frozen-image-review',[
      {type:'text',text:'Inspect the attached image pixels without tools. Return only JSON {"dominant_color":"red|green|blue"} choosing its dominant color.'},
      {type:'local_image',path:image},
    ],pure);
    assert.equal(parse(vision.answer).dominant_color,'blue');
    assert.equal(vision.events.filter(e=>e.type==='tool_use').length,0);
    const report={status:'passed',scope:'Frozen image pixels with a neutral attachment filename',checks:{frozen_image_pixels:true,model_only_no_tools:true},roles};
    writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } else {
  const implementation=await run('implementation',
    `Use a shell command to create only ${artifact} containing JSON with nonce=${nonce} and sum=17+25 (compute the sum). Then run a Node command to read the file and verify the sum. Do not read outside ${workspace}. Return only JSON {"written":true,"sum":number}.`,{mode:'bypass'});
  assert.ok(implementation.events.some(e=>e.type==='tool_use'));
  assert.deepEqual(JSON.parse(readFileSync(artifact,'utf8')),{nonce,sum:42});
  assert.equal(parse(implementation.answer).sum,42);
  const resumed=await run('resumed',
    'Without tools, return only JSON {"nonce":"the nonce from your preceding task"}.',pure,
    {resume:implementation.session,agent:implementation.agent});
  assert.equal(resumed.session,implementation.session);
  assert.equal(parse(resumed.answer).nonce,nonce);
  assert.equal(resumed.events.filter(e=>e.type==='tool_use').length,0);
  const original=createHash('sha256').update(readFileSync(artifact)).digest('hex');
  const review=await run('independent-review',
    `Read ${artifact} using a tool. Independently verify that its sum equals 17+25. Do not modify any file. Return only JSON {"sum_ok":boolean,"nonce":"actual file nonce"}.`,
    {fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'});
  assert.notEqual(review.session,implementation.session);
  assert.equal(parse(review.answer).sum_ok,true);assert.equal(parse(review.answer).nonce,nonce);
  assert.ok(review.events.some(e=>e.type==='tool_use'));
  assert.equal(createHash('sha256').update(readFileSync(artifact)).digest('hex'),original);
  const vision=await run('frozen-image-review',[
    {type:'text',text:'Inspect the attached image pixels without tools. Return only JSON {"dominant_color":"red|green|blue"} choosing its dominant color.'},
    {type:'local_image',path:image},
  ],pure);
  assert.equal(parse(vision.answer).dominant_color,'blue');
  assert.equal(vision.events.filter(e=>e.type==='tool_use').length,0);
  const report={status:'passed',scope:'OpenCode runtime integration, not a full product acceptance',
    checks:{tool_execution:true,artifact_verified:true,same_session_resume:true,separate_readonly_review:true,frozen_image_pixels:true,model_only_no_tools:true},roles};
  writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  }
} catch(error) {
  const report={status:'failed',error:error.message,roles};
  writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify(report));process.exitCode=1;
}
