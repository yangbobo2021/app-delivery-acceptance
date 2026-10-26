import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {resolveAgentRuntime,bindAgentRuntime} from '../playbook/agent-runtime.mjs';
import {openCodePermissions,openCodePrompt,normalizeOpenCodeEvents,openCodeStructuredResult,openCodeOutputFormat} from '../playbook/opencode-runtime.mjs';

function fixture(t) {
  const home=mkdtempSync(join(tmpdir(),'acceptance-opencode-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const bin=join(home,'bin');mkdirSync(bin);
  const config={model:'other/default',provider:{relay:{npm:'@ai-sdk/openai-compatible',
    options:{baseURL:'https://user:password@relay.invalid/v1?token=query-secret',apiKey:'fixture-api-secret',headers:{'x-auth':'header-secret'}},
    models:{'glm-5.3-flash':{options:{reasoning_effort:'high'},variants:{max:{reasoning_effort:'max'}}}}}}};
  const configPath=join(home,'native-effective-config.json');
  writeFileSync(configPath,JSON.stringify(config));
  // Model-free resolver boundary: native CLI success/error output is intentionally private.
  writeFileSync(join(bin,'opencode'),`#!${process.execPath}\nimport fs from 'node:fs';\nimport http from 'node:http';\nif(process.argv[2]==='--version')console.log('1.19.4');\nelse {const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(${JSON.stringify(configPath)},'utf8'));});server.listen(0,'127.0.0.1',()=>console.log('opencode server listening on http://127.0.0.1:'+server.address().port));process.on('SIGTERM',()=>server.close());}\n`,{mode:0o755});
  return {home,cwd:home,config,configPath,env:{...process.env,PATH:bin+delimiter+process.env.PATH,
    ACCEPTANCE_AGENT:'opencode',ACCEPTANCE_MODEL:'relay/glm-5.3-flash',ZHIPU_API_KEY:'environment-secret'}};
}

test('OpenCode requires the actual fully qualified model before invoking configuration resolution',t=>{
  const f=fixture(t);
  for(const model of [undefined,'glm-5.3-flash','relay/','/model',' relay/model'])
    assert.throws(()=>resolveAgentRuntime({...f,env:{...f.env,ACCEPTANCE_MODEL:model}}),/Current model|provider\/model/);
});
test('OpenCode follows resolved native provider, model and CLI without retaining credentials',t=>{
  const f=fixture(t),meta=resolveAgentRuntime(f);
  assert.equal(meta.agent,'opencode');assert.equal(meta.model,'relay/glm-5.3-flash');
  assert.deepEqual(meta.service,{provider:'relay',base_url:'https://relay.invalid/v1'});
  assert.equal(meta.opencode.cli_version,'1.19.4');
  assert.match(meta.opencode.config_sha256,/^[a-f0-9]{64}$/);
  for(const secret of ['password','query-secret','fixture-api-secret','header-secret','environment-secret'])
    assert.ok(!JSON.stringify(meta).includes(secret));
  const override=resolveAgentRuntime({...f,model:'relay/another-model'});
  assert.equal(override.model,'relay/another-model');
});
test('OpenCode explicit effort must be a configured native variant',t=>{
  const f=fixture(t);
  assert.equal(resolveAgentRuntime({...f,effort:'max'}).effort,'max');
  assert.throws(()=>resolveAgentRuntime({...f,effort:'high'}),/configured model variant/);
});
test('resume rejects effective OpenCode model config drift without changing frozen evidence',t=>{
  const f=fixture(t),meta=resolveAgentRuntime(f);
  bindAgentRuntime(f.home,meta);
  const original=readFileSync(join(f.home,'agent-runtime.json'),'utf8');
  f.config.provider.relay.models['glm-5.3-flash'].options.reasoning_effort='low';
  writeFileSync(f.configPath,JSON.stringify(f.config));
  assert.throws(()=>bindAgentRuntime(f.home,resolveAgentRuntime(f),{resume:true}),/differs/);
  assert.equal(readFileSync(join(f.home,'agent-runtime.json'),'utf8'),original);
});
test('OpenCode token limits and public URL query settings participate in resume identity',t=>{
  const f=fixture(t),provider=f.config.provider.relay;
  provider.models['glm-5.3-flash'].options.maxTokens=512;
  provider.options.baseURL='https://relay.invalid/v1?api-version=v1&token=private-token';
  writeFileSync(f.configPath,JSON.stringify(f.config));
  const first=resolveAgentRuntime(f);
  provider.models['glm-5.3-flash'].options.maxTokens=2048;
  writeFileSync(f.configPath,JSON.stringify(f.config));
  assert.notEqual(resolveAgentRuntime(f).opencode.config_sha256,first.opencode.config_sha256);
  provider.models['glm-5.3-flash'].options.maxTokens=512;
  provider.options.baseURL='https://relay.invalid/v1?api-version=v2&token=private-token';
  writeFileSync(f.configPath,JSON.stringify(f.config));
  assert.notEqual(resolveAgentRuntime(f).opencode.config_sha256,first.opencode.config_sha256);
});
test('invalid native configuration never echoes interpolated secrets',t=>{
  const f=fixture(t);writeFileSync(f.configPath,'invalid fixture-api-secret');
  assert.throws(()=>resolveAgentRuntime(f),e=>/Cannot resolve/.test(e.message)&&!e.message.includes('fixture-api-secret'));
});
test('OpenCode keeps model-only roles tool-free, reviewers read-only and case execution writable',()=>{
  const pure=openCodePermissions({fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'});
  assert.equal(pure.permission['*'],'deny');assert.equal(pure.permission.read,undefined);
  assert.equal(pure.permission.bash,'deny');
  const review=openCodePermissions({fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'});
  assert.equal(review.permission.read,'allow');assert.equal(review.permission.edit,'deny');
  assert.equal(review.permission.task,'deny');assert.equal(review.permission.skill,'deny');
  const cases=openCodePermissions({mode:'bypass'});
  assert.deepEqual(cases.policy,{mode:'auto',fileWrite:'allow',shellExecute:'allow',networkAccess:'allow'});
});
test('OpenCode image input contains the actual frozen pixels and rejects unsupported input',t=>{
  const f=fixture(t),path=join(f.home,'frozen.png');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQp8AAAAASUVORK5CYII=','base64');
  writeFileSync(path,bytes);
  const input=openCodePrompt([{type:'text',text:'review'},{type:'local_image',path}]);
  assert.equal(input.text,'review');assert.equal(input.images[0].mime,'image/png');
  assert.deepEqual(Buffer.from(input.images[0].url.split(',')[1],'base64'),bytes);
  assert.equal(input.images[0].filename,'frozen.png');
  writeFileSync(path,'invalid');assert.throws(()=>openCodePrompt([{type:'local_image',path}]),/image format/);
  assert.throws(()=>openCodePrompt([{type:'image_url',url:'https://invalid'}]),/Unsupported/);
});

test('streamed OpenCode output becomes the final JSON snapshot expected by existing runners',async()=>{
  const source=(async function*(){
    for(const [type,payload] of [
      ['text_delta',{delta:'I will inspect the fixture.'}],['tool_use',{name:'read'}],
      ['text_delta',{delta:'{"status":'}],['text_delta',{delta:'"passed"}'}],['done',{status:'success'}],
    ]) yield {type,sessionId:'actual-session',agent:'opencode',payload};
  })();
  const result=[];for await(const e of normalizeOpenCodeEvents(source))result.push(e);
  const snapshot=result.find(e=>e.type==='text');
  assert.deepEqual(JSON.parse(snapshot.payload.content),{status:'passed'});
  assert.equal(result.at(-1).type,'done');
});

test('native structured submission supplies final JSON while raw prose stays in the trace',async()=>{
  const source=(async function*(){
    yield {type:'text',sessionId:'s',payload:{content:'Explanation before an unreliable JSON fence'}};
    yield {type:'done',sessionId:'s',payload:{status:'success'}};
  })();
  const events=[];
  for await(const event of normalizeOpenCodeEvents(source,{readStructuredOutput:async id=>{
    assert.equal(id,'s');return {status:'ready',items:[1,2]};
  }})) events.push(event);
  assert.match(events[0].payload.content,/Explanation/);
  assert.equal(events.at(-2).payload.source,'opencode-structured');
  assert.deepEqual(JSON.parse(events.at(-2).payload.content),{status:'ready',items:[1,2]});
});

test('structured results cannot be substituted by another request, old successful step or prose',()=>{
  const submitted={sessionID:'s',messageID:'request'};
  const message=(id,parentID,created,structured,error)=>({info:{id,role:'assistant',sessionID:'s',
    parentID,time:{created,completed:created+1},structured,error}});
  const valid=message('m','request',1,{result:{status:'ready'}});
  assert.deepEqual(openCodeStructuredResult([valid],submitted),{status:'ready'});
  assert.throws(()=>openCodeStructuredResult([message('other','old-request',2,{result:{status:'ready'}})],submitted),/did not submit/);
  assert.throws(()=>openCodeStructuredResult([valid,message('latest','request',2,undefined)],submitted),/did not submit/);
  assert.throws(()=>openCodeStructuredResult([message('bad','request',1,{result:[]})],submitted),/did not submit/);
  assert.throws(()=>openCodeStructuredResult([message('bad','request',1,{result:{}},{name:'StructuredOutputError'})],submitted),/did not submit/);
});

test('native result envelope carries the stage schema without relaxing required fields',()=>{
  const schema={type:'object',properties:{protocol:{type:'string',enum:['fixture-v1']}},required:['protocol']};
  const format=openCodeOutputFormat(schema);
  assert.deepEqual(format.schema.properties.result,schema);
  assert.deepEqual(format.schema.required,['result']);
  assert.equal(format.schema.additionalProperties,false);
  assert.throws(()=>openCodeOutputFormat({type:'array'}),/object/);
});
