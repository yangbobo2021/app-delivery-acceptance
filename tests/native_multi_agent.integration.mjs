// Opt-in actual Claude Code/OpenCode calls against the user's same GLM service.
// Credentials are read from a private existing file and passed only in child env.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {fileURLToPath} from 'node:url';import {spawn,execFileSync} from 'node:child_process';
import {randomInt} from 'node:crypto';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const output=path.resolve(option('--output')),keyFile=option('--key-file'),opencodeConfig=option('--opencode-config');
if(!keyFile||!opencodeConfig)throw Error('--key-file and --opencode-config are required');
fs.mkdirSync(output,{recursive:true});const credential=fs.readFileSync(keyFile,'utf8').trim();
if(!credential)throw Error('Credential file is empty');
const runtimeModule=fileURLToPath(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/players.mjs',import.meta.url)),results=[];
const driver=`import fs from 'node:fs';import assert from 'node:assert/strict';import {createAgentRuntime} from ${JSON.stringify('file://'+runtimeModule)};
const [directory,root,expectedText]=process.argv.slice(1),expected=Number(expectedText),agent=createAgentRuntime({directory,role:'implementer'}),calls=[];
const writeSchema={type:'object',properties:{observed:{type:'integer'},path:{type:'string'}},required:['observed','path'],additionalProperties:false};
async function task(prompt,options,label){const events=[];for await(const e of agent.run(prompt,options))events.push(e);fs.writeFileSync(directory+'/'+label+'.json',JSON.stringify(events,null,2));assert.equal(events.at(-1)?.payload?.status,'success',JSON.stringify(events.filter(e=>e.type==='error')));const text=events.filter(e=>e.type==='text').at(-1)?.payload.content;return {events,answer:JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\\s*/,'').replace(/\\s*\x60\x60\x60$/,'')),session:events.find(e=>e.type==='init').sessionId};}
const first=await task('Read product.txt, parse its actual numeric value, and use Node to create tests/result.json with {"observed":number}. Do not modify product.txt or commit. Return only a JSON object with observed and path.',{cwd:root,jsonOutput:true,jsonResultSchema:writeSchema,permissions:{fileWrite:'allow',shellExecute:'allow',networkAccess:'deny'}},'write');assert.equal(first.answer.observed,expected);assert.equal(JSON.parse(fs.readFileSync(root+'/tests/result.json')).observed,expected);
const second=await task('Without reading files or running tools, recall the exact numeric value you just observed. Return only JSON {"recalled":number}.',{cwd:root,resume:first.session,jsonOutput:true,jsonResultSchema:{type:'object',properties:{recalled:{type:'integer'}},required:['recalled'],additionalProperties:false},permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}},'continue');assert.equal(second.answer.recalled,expected);assert.equal(second.session,first.session);assert.equal(second.events.filter(e=>e.type==='tool_use'&&e.payload?.toolName!=='StructuredOutput').length,0);
console.log(JSON.stringify({status:'passed',agent_runtime:agent.metadata,official_session:first.session,observed:first.answer.observed,recall:second.answer.recalled,same_official_session:true,structured_submission:first.events.some(e=>e.type==='text'&&e.payload?.source==='opencode-structured')}));`;
const selected=option('--only')?[option('--only')]:['opencode','claude-code'];
if(selected.some(agent=>!['opencode','claude-code'].includes(agent)))throw Error('Unknown selected Agent');
for(const agent of selected){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-'+agent+'-')),directory=path.join(output,agent);fs.mkdirSync(directory);
  const value=randomInt(1000,9000);fs.writeFileSync(path.join(root,'product.txt'),String(value)+'\n');execFileSync('git',['init','-q'],{cwd:root});
  const env={...process.env,ACCEPTANCE_AGENT:agent,ACCEPTANCE_MODEL:agent==='opencode'?'bigmodel/glm-5.3-flash':'glm-5.3-flash',ACCEPTANCE_EFFORT:'',ACCEPTANCE_ROLE_CONFIG:'',
    ZHIPU_API_KEY:credential,OPENCODE_CONFIG:path.resolve(opencodeConfig),ANTHROPIC_MODEL:'glm-5.3-flash',ANTHROPIC_BASE_URL:'https://open.bigmodel.cn/api/anthropic',ANTHROPIC_AUTH_TOKEN:credential};
  delete env.ANTHROPIC_API_KEY;
  if(option('--opencode-cli'))env.PATH=path.dirname(path.resolve(option('--opencode-cli')))+path.delimiter+env.PATH;
  const started_at=new Date().toISOString();let stdout='',stderr='',timer;
  try{
    const child=spawn(process.execPath,['--input-type=module','-e',driver,directory,root,String(value)],{env,detached:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}},480000);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    stdout=stdout.replaceAll(credential,'[REDACTED]');stderr=stderr.replaceAll(credential,'[REDACTED]');
    const parsed=code===0?JSON.parse(stdout):null;
    results.push({agent,status:parsed?.status==='passed'?'passed':'failed',root,started_at,finished_at:new Date().toISOString(),exit_code:code,stdout,stderr,details:parsed,
      credential_boundary:'Same pre-existing GLM credential supplied privately; no credential copied into task, configuration or report.'});
  }catch(error){results.push({agent,status:'failed',error:error.message.replaceAll(credential,'[REDACTED]'),stdout:stdout.replaceAll(credential,'[REDACTED]'),stderr:stderr.replaceAll(credential,'[REDACTED]')});}
  finally{clearTimeout(timer);}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(results.at(-1).status+' '+agent+' actual write + structured result + same-session continuation');
}
if(results.some(x=>x.status!=='passed'))process.exitCode=1;
