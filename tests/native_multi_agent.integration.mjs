// Opt-in actual Claude Code/OpenCode calls against the user's same GLM service.
// Credentials are read from a private existing file and passed only in child env.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomInt} from 'node:crypto';
import assert from 'node:assert/strict';
import {harness,read,skill} from './official_workflow_harness.mjs';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const output=path.resolve(option('--output')),keyFile=option('--key-file'),opencodeConfig=option('--opencode-config');
if(!keyFile||!opencodeConfig)throw Error('--key-file and --opencode-config are required');
fs.mkdirSync(output,{recursive:true});const credential=fs.readFileSync(keyFile,'utf8').trim();
if(!credential)throw Error('Credential file is empty');
const runtimeModule=path.join(skill,'runtime/players.mjs'),results=[];
const h=harness('native-multi-agent',[['acceptance-create','create']]);
const operation=`import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createAgentRuntime} from ${JSON.stringify('file://'+runtimeModule)};
export async function operation({directory,root}){const agent=createAgentRuntime({directory,role:'implementer'});
const writeSchema={type:'object',properties:{observed:{type:'integer'},path:{type:'string'}},required:['observed','path'],additionalProperties:false};
async function task(prompt,options,label){const events=[];for await(const e of agent.run(prompt,options))events.push(e);fs.writeFileSync(directory+'/'+label+'.json',JSON.stringify(events,null,2));assert.equal(events.at(-1)?.payload?.status,'success',JSON.stringify(events.filter(e=>e.type==='error')));const text=events.filter(e=>e.type==='text').at(-1)?.payload.content;let answer;try{answer=JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\\s*/,'').replace(/\\s*\x60\x60\x60$/,''));}catch{}return {events,answer,text,session:events.find(e=>e.type==='init').sessionId};}
const first=await task('Read product.txt, parse its actual numeric value, and use Node to create tests/result.json with {"observed":number}. Do not modify product.txt or commit. Your final response must be exactly one raw JSON object with observed and path. Do not use Markdown fences, headings, notes or explanations.',{cwd:root,jsonOutput:true,jsonResultSchema:writeSchema,permissions:{fileWrite:'allow',shellExecute:'allow',networkAccess:'deny'}},'write');
let formatCorrectionUsed=false;
if(!first.answer){
 // Claude's transport intentionally uses validated text, rather than OpenCode's
 // native StructuredOutput. Preserve an invalid first response and permit one
 // explicit, read-only format correction in the same provider session. This is
 // a test operation, not a runtime JSON extractor or an inferred business pass.
 const candidates=[...first.text.matchAll(/\x60\x60\x60(?:json)?\\s*([\\s\\S]*?)\x60\x60\x60/g)];assert.equal(candidates.length,1,'Only one unambiguous fenced object may be reformatted');const original=JSON.parse(candidates[0][1]);
 const corrected=await task('Reformat only your previous observed/path JSON object. Preserve its exact keys and values. Return exactly the raw JSON object without Markdown or notes. Do not read files, run tools, or change anything.',{cwd:root,resume:first.session,jsonOutput:true,jsonResultSchema:writeSchema,permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}},'format-correction');assert.deepEqual(corrected.answer,original);assert.equal(corrected.session,first.session);assert.equal(corrected.events.filter(e=>e.type==='tool_use'&&e.payload?.toolName!=='StructuredOutput').length,0);first.answer=corrected.answer;formatCorrectionUsed=true;
}
assert.equal(first.answer.observed,JSON.parse(fs.readFileSync(root+'/tests/result.json')).observed);assert.equal(fs.realpathSync(path.resolve(root,first.answer.path)),fs.realpathSync(path.join(root,'tests/result.json')));
const second=await task('Without reading files or running tools, recall the exact numeric value you just observed. Return only JSON {"recalled":number}.',{cwd:root,resume:first.session,jsonOutput:true,jsonResultSchema:{type:'object',properties:{recalled:{type:'integer'}},required:['recalled'],additionalProperties:false},permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}},'continue');assert.equal(second.answer.recalled,first.answer.observed);assert.equal(second.session,first.session);assert.equal(second.events.filter(e=>e.type==='tool_use'&&e.payload?.toolName!=='StructuredOutput').length,0);
return {status:'passed',agent_runtime:agent.metadata,official_session:first.session,observed:first.answer.observed,recall:second.answer.recalled,same_official_session:true,format_correction_used:formatCorrectionUsed,structured_submission:first.events.some(e=>e.type==='tool_use'&&e.payload?.toolName==='StructuredOutput')};}\nimport {commandRegistry} from ${JSON.stringify('file://'+path.join(skill,'workflows/shared/command.mjs'))};\nexport default commandRegistry({id:'native-agent-contract',intent:'Actual native write, structured submission and same-session continuation under an official workflow session.',successState:'verified',roles:['implementer'],operation});`;
const registry=path.join(h.temporary,'native-agent-contract.mjs');fs.writeFileSync(registry,operation);
const selected=option('--only')?[option('--only')]:['opencode','claude-code'];
if(selected.some(agent=>!['opencode','claude-code'].includes(agent)))throw Error('Unknown selected Agent');
for(const agent of selected){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-'+agent+'-')),directory=path.join(output,agent);fs.mkdirSync(directory);
  const value=randomInt(1000,9000);fs.writeFileSync(path.join(root,'product.txt'),String(value)+'\n');execFileSync('git',['init','-q'],{cwd:root});
  const env={...process.env,ACCEPTANCE_AGENT:agent,ACCEPTANCE_MODEL:agent==='opencode'?'bigmodel/glm-5.3-flash':'glm-5.3-flash',ACCEPTANCE_EFFORT:'',ACCEPTANCE_ROLE_CONFIG:'',
    ZHIPU_API_KEY:credential,OPENCODE_CONFIG:path.resolve(opencodeConfig),ANTHROPIC_MODEL:'glm-5.3-flash',ANTHROPIC_BASE_URL:'https://open.bigmodel.cn/api/anthropic',ANTHROPIC_AUTH_TOKEN:credential};
  delete env.ANTHROPIC_API_KEY;
  if(option('--opencode-cli'))env.PATH=path.dirname(path.resolve(option('--opencode-cli')))+path.delimiter+env.PATH;
  const configFile=path.join(h.temporary,'spex/config/playbook.config.yaml'),config=read(configFile);
  config.playbooks['native-agent-contract']={from:registry,roles:{implementer:'native.contract'}};
  config.players['native.contract']={adapter:agent==='claude-code'?'claude':'opencode',model:env.ACCEPTANCE_MODEL,permissions:{fileWrite:'allow',shellExecute:'allow',networkAccess:'deny'}};
  fs.writeFileSync(configFile,JSON.stringify(config));
  const nativeConfig=path.join(directory,'native-config');fs.mkdirSync(nativeConfig);env.CLAUDE_CONFIG_DIR=nativeConfig;
  for(const [key,folder]of [['XDG_CONFIG_HOME','xdg-config'],['XDG_DATA_HOME','xdg-data'],['XDG_STATE_HOME','xdg-state'],['XDG_CACHE_HOME','xdg-cache']]){env[key]=path.join(directory,folder);fs.mkdirSync(env[key]);}
  env.SPEX_HOME=path.join(h.temporary,'spex');
  const started_at=new Date().toISOString();
  try{
    const cli=h.cli('native-agent-contract',{directory,root},agent,root,{env,timeout:480000});
    h.settled(cli,'native-agent-contract','verified');
    const events=read(path.join(h.output,agent+'-session.json'));
    const write=read(path.join(directory,'write.json')),continued=read(path.join(directory,'continue.json'));
    assert.equal(JSON.parse(fs.readFileSync(root+'/tests/result.json')).observed,value);
    assert.equal(fs.readFileSync(root+'/product.txt','utf8'),String(value)+'\n');
    assert.equal(write.find(e=>e.type==='init')?.sessionId,continued.find(e=>e.type==='init')?.sessionId);
    const nodeCall=write.find(e=>e.type==='tool_use'&&/bash|command_execution/i.test(e.payload?.toolName??'')&&/\bnode(?:\s|$)/.test(e.payload?.input?.command??''));
    assert.ok(nodeCall,'The real native role must execute Node to produce the file');
    assert.ok(write.some(e=>e.type==='tool_result'&&e.payload?.toolUseId===nodeCall.payload.toolUseId&&e.payload?.status==='success'));
    if(agent==='opencode'){
      const submission=write.filter(e=>e.type==='tool_use'&&e.payload?.toolName==='StructuredOutput').at(-1);
      const structured=submission?.payload?.input?.result??submission?.payload?.input;
      assert.equal(structured?.observed,value,'Native OpenCode must submit the constrained structured result');
      assert.ok(write.some(e=>e.type==='tool_result'&&e.payload?.toolUseId===submission.payload.toolUseId&&e.payload?.status==='success'));
    }
    assert.ok(!JSON.stringify(events).includes(credential));
    results.push({agent,status:'passed',root,started_at,finished_at:new Date().toISOString(),official_cli_session:cli.envelope.sessionId,provider_session:write.find(e=>e.type==='init')?.sessionId,observed:value,same_official_session:true,command:cli.receipt.argv,
      credential_boundary:'Private existing GLM credential passed only through child environment; isolated Claude configuration; no global settings read or written.'});
  }catch(error){results.push({agent,status:'failed',started_at,finished_at:new Date().toISOString(),error:String(error.stack).replaceAll(credential,'[REDACTED]')});}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(results.at(-1).status+' '+agent+' actual write + structured result + same-session continuation');
}
if(results.some(x=>x.status!=='passed'))process.exitCode=1;
