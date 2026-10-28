import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {resolveAgentRuntime,bindAgentRuntime} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/players.mjs';

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
