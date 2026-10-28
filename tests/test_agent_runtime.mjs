import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveAgentRuntime,bindAgentRuntime} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/players.mjs';

function fixture(t) {
  const home=mkdtempSync(join(tmpdir(),'acceptance-agent-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  return {home,cwd:home};
}
test('Agent is explicitly supplied, never selected from PATH or model-service variables',t=>{
  const f=fixture(t);
  for (const agent of [undefined,'gemini','claude'])
    assert.throws(()=>resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:agent,ANTHROPIC_MODEL:'deepseek-flash'}}),/ACCEPTANCE_AGENT/);
});
test('unknown model stops instead of substituting a vendor default',t=>{
  const f=fixture(t);
  for (const agent of ['codex','claude-code'])
    assert.throws(()=>resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:agent}}),/Current model is unknown/);
});
test('Claude follows DeepSeek model, service and effort without recording credentials',t=>{
  const f=fixture(t);
  const config=resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'claude-code',ANTHROPIC_MODEL:'deepseek-flash',
    ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:'fixture-secret-only',CLAUDE_CODE_EFFORT_LEVEL:'high'}});
  assert.equal(config.agent,'claude-code');assert.equal(config.model,'deepseek-flash');
  assert.equal(config.service.base_url,'https://api.deepseek.com/anthropic');assert.equal(config.effort,'high');
  assert.ok(!JSON.stringify(config).includes('fixture-secret-only'));
});
test('Claude settings env is inherited; active process/caller model overrides saved settings',t=>{
  const f=fixture(t);mkdirSync(join(f.home,'.claude'));
  writeFileSync(join(f.home,'.claude/settings.json'),JSON.stringify({env:{ANTHROPIC_MODEL:'saved-model',ANTHROPIC_BASE_URL:'https://relay.invalid/anthropic',ANTHROPIC_AUTH_TOKEN:'saved-secret'}}));
  const saved=resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'claude-code'}});
  assert.equal(saved.model,'saved-model');assert.equal(saved.service.base_url,'https://relay.invalid/anthropic');
  assert.equal(resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'claude-code',ANTHROPIC_MODEL:'active-model'}}).model,'active-model');
  assert.equal(resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'claude-code',ACCEPTANCE_MODEL:'caller-model'}}).model,'caller-model');
  assert.ok(!JSON.stringify(saved).includes('saved-secret'));
});
test('Codex reads the active profile model/service/effort rather than hard-coded GPT defaults',t=>{
  const f=fixture(t);mkdirSync(join(f.home,'.codex'));
  writeFileSync(join(f.home,'.codex/config.toml'),`model="base-model"\nprofile="work"\n[profiles.work]\nmodel="profile-model"\nmodel_provider="relay"\nmodel_reasoning_effort="medium"\n[model_providers.relay]\nname="Relay"\nbase_url="https://relay.invalid/v1"\nwire_api="responses"\nenv_key="RELAY_API_KEY"\n`);
  const config=resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'codex',RELAY_API_KEY:'profile-secret'}});
  assert.equal(config.model,'profile-model');assert.equal(config.effort,'medium');
  assert.deepEqual(config.service,{provider:'relay',base_url:'https://relay.invalid/v1'});
  assert.ok(!JSON.stringify(config).includes('profile-secret'));
  assert.equal(resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'codex',ACCEPTANCE_MODEL:'session-override'}}).model,'session-override');
  assert.throws(()=>resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'codex',ACCEPTANCE_CODEX_PROFILE:'missing'}}),/profile is absent/);
});
test('bad configuration and URLs fail without echoing sensitive content',t=>{
  const f=fixture(t);mkdirSync(join(f.home,'.claude'));
  writeFileSync(join(f.home,'.claude/settings.json'),'secret-invalid-json');
  assert.throws(()=>resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'claude-code'}}),e=>!e.message.includes('secret-invalid-json'));
  rmSync(join(f.home,'.claude/settings.json'));
  assert.throws(()=>resolveAgentRuntime({...f,env:{ACCEPTANCE_AGENT:'claude-code',ANTHROPIC_MODEL:'m',ANTHROPIC_BASE_URL:'sensitive-invalid-url'}}),e=>!e.message.includes('sensitive-invalid-url'));
});
test('explicit stage overrides are honored and URL credential/query values never persist',t=>{
  const config=resolveAgentRuntime({...fixture(t),env:{ACCEPTANCE_AGENT:'claude-code',ANTHROPIC_MODEL:'current',ANTHROPIC_BASE_URL:'https://user:password@relay.invalid/api?token=secret-query'},model:'chosen',effort:'low'});
  assert.equal(config.model,'chosen');assert.equal(config.effort,'low');
  assert.equal(config.service.base_url,'https://relay.invalid/api');
  assert.ok(!JSON.stringify(config).includes('password'));assert.ok(!JSON.stringify(config).includes('secret-query'));
});
test('matching resume preserves old binding bytes; changing Agent/model/service/SDK/effort never overwrites it',t=>{
  const {home}=fixture(t);
  const old={schema:'acceptance-agent-runtime-v1',agent:'codex',model:'actual-model',effort:'high',service:{provider:'openai',base_url:null},sdk:{package:'sdk',version:'1'}};
  bindAgentRuntime(home,old);const original=readFileSync(join(home,'agent-runtime.json'),'utf8');
  bindAgentRuntime(home,{...old,model_source:'new caller source'},{resume:true});
  for (const change of [{agent:'claude-code'},{model:'different'},{effort:'low'},{service:{provider:'relay',base_url:'https://relay.invalid'}},{sdk:{package:'sdk',version:'2'}}])
    assert.throws(()=>bindAgentRuntime(home,{...old,...change},{resume:true}),/differs from this attempt/);
  assert.equal(readFileSync(join(home,'agent-runtime.json'),'utf8'),original);
});
test('legacy attempts cannot resume a model session without a runtime binding',t=>{
  const {home}=fixture(t);writeFileSync(join(home,'old-evidence.json'),'original evidence');
  assert.throws(()=>bindAgentRuntime(home,{agent:'codex',model:'m'},{resume:true}),/Historical attempt/);
  assert.ok(!existsSync(join(home,'agent-runtime.json')));
  assert.equal(readFileSync(join(home,'old-evidence.json'),'utf8'),'original evidence');
});
