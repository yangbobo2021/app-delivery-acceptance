import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {readKnowledge} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/knowledge.mjs';
import {workspaceLease,finishScene} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/workspace.mjs';
import {toolCommand} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/tool-command.mjs';
import {harness} from './official_workflow_harness.mjs';

const h=harness('workspace-liveness',[]),root=fs.realpathSync(h.project('project')),at='AT-live-owner',local=path.join(root,'.acceptance-local',at);
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'验证受限工具的真实拥有者核验，不放宽权限。'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'租约协议集成夹具',definitions:{context:{business_goal:'持有者确实存活时允许受限工具，陈旧或伪造证明停止。'},requirements:[{id:'R1',text:'未知租约不授权副作用。',origin:{kind:'fixture',reference:'liveness'},external_refs:[]}]}});
const config={acceptance:readKnowledge(root,at,[]).acceptance,workspace_policy:'single-acceptance-v1',project_root:path.join(local,'workspace'),test_roots:['test']};fs.mkdirSync(config.project_root);
for(const args of [['init','-q'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']])assert.equal(spawnSync('git',args,{cwd:config.project_root}).status,0);
const configFile=path.join(h.output,'config.json');fs.writeFileSync(configFile,JSON.stringify(config));
const claimFile=path.join(local,'workspace.lock.d/owner.json'),read=file=>JSON.parse(fs.readFileSync(file));
const guardURL=new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/guard.mjs',import.meta.url).href;
const workspaceURL=new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/workspace.mjs',import.meta.url).href;
const verifier=path.join(h.output,'verify.mjs');fs.writeFileSync(verifier,`import fs from 'node:fs';import {requireWorkspaceLease} from ${JSON.stringify(guardURL)};
 if(process.env.FIXTURE_DENY_PID==='yes')process.kill=()=>{throw Object.assign(Error('controlled platform EPERM'),{code:'EPERM'});};
 try{requireWorkspaceLease(JSON.parse(fs.readFileSync(process.argv[2])));console.log('verified');}catch(error){console.error(error.message);process.exitCode=2;}`);
async function check(id,purpose,operation){try{const value=await operation();h.test(id,purpose,()=>value);}catch(error){h.test(id,purpose,()=>{throw error;});}}
async function child(env,{deny=true,configuration=configFile}={}){
 const started_at=new Date().toISOString(),processChild=spawn(process.execPath,[verifier,configuration],{env:{...env,FIXTURE_DENY_PID:deny?'yes':'no'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';processChild.stdout.on('data',b=>stdout+=b);processChild.stderr.on('data',b=>stderr+=b);const [exit_code]=await once(processChild,'close');const result={exit_code,stdout,stderr,started_at,finished_at:new Date().toISOString()};h.save('child-'+processChild.pid+'.json',result);return result;
}
let oldEnv;
await check('LIVE-01','真实租约拥有者响应被 EPERM 拒绝的工具，两个核验使用不同的新鲜签名',async()=>{
 const output=path.join(local,'workflows/live');fs.mkdirSync(output,{recursive:true});
 await workspaceLease(config,output,async({env})=>{
  oldEnv=env;assert.equal((await child(env,{deny:false})).exit_code,0);
  for(let i=0;i<2;i++){const result=await child(env);assert.equal(result.exit_code,0,result.stderr);}
  const claim=read(claimFile),requests=fs.readdirSync(claim.liveness.directory).filter(x=>x.endsWith('.request.json'));assert.equal(requests.length,2);assert.notEqual(requests[0],requests[1]);
  const before={...process.env};Object.assign(process.env,env);try{const argv=toolCommand('/fixture/tool.mjs',output),authority=read(argv.at(-1));assert.equal(authority.proof_key,claim.liveness.public_key);assert.equal(authority.claim,claim.token);}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
  finishScene(config,output);
 },{scene:true});assert.ok(!fs.existsSync(claimFile));
});
await check('LIVE-02','释放后的旧权限、错误 AT、目录、token 和公钥都不能授权工具',async()=>{
 assert.equal((await child(oldEnv)).exit_code,2);
 const output=path.join(local,'workflows/bound');fs.mkdirSync(output,{recursive:true});
 await workspaceLease(config,output,async({env})=>{
  for(const change of [{ACCEPTANCE_WORKSPACE_LEASE:output+'-other'},{ACCEPTANCE_WORKSPACE_CLAIM:'wrong'},{ACCEPTANCE_WORKSPACE_PROOF_KEY:'wrong'}])assert.equal((await child({...env,...change})).exit_code,2);
  const other=path.join(h.output,'other-at.json');fs.writeFileSync(other,JSON.stringify({...config,acceptance:{...config.acceptance,id:'AT-wrong'}}));assert.equal((await child(env,{configuration:other})).exit_code,2);
  finishScene(config,output);
 },{scene:true});
});
await check('LIVE-07','场景拥有者记录的错误 AT 或缺失身份被拒绝，原绑定可继续',async()=>{
 const output=path.join(local,'workflows/owner-binding');fs.mkdirSync(output,{recursive:true});
 await workspaceLease(config,output,async({env})=>{
  const file=path.join(local,'workspace-owner.json'),bytes=fs.readFileSync(file),original=read(file);
  for(const changed of [{...original,acceptance_id:'AT-wrong-owner'},{output_dir:output}]){
   fs.writeFileSync(file,JSON.stringify(changed));try{const result=await child(env);assert.equal(result.exit_code,2);assert.match(result.stderr,/claim does not match/);}finally{fs.writeFileSync(file,bytes);}
  }
  const result=await child(env);assert.equal(result.exit_code,0,result.stderr);finishScene(config,output);
 },{scene:true});
});
await check('LIVE-08','官方工具只向当前租约子目录写入，另一尝试目录没有副作用',async()=>{
 const output=path.join(local,'workflows/tool-owner'),owned=path.join(output,'case'),other=path.join(local,'workflows/tool-other');fs.mkdirSync(owned,{recursive:true});fs.mkdirSync(other);
 const denyFile=path.join(h.output,'deny-pid.mjs');fs.writeFileSync(denyFile,"process.kill=()=>{throw Object.assign(Error('controlled EPERM'),{code:'EPERM'});};\n");
 await workspaceLease(config,output,async({env})=>{
  const before={...process.env};Object.assign(process.env,env);let command;
  try{command=toolCommand(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/tools/case.mjs',import.meta.url).pathname,owned);}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
  for(const destination of [owned,other]){
   const cp=spawn(process.execPath,['--import',denyFile,...command.slice(1),'policy-start',configFile,destination],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';cp.stdout.on('data',x=>stdout+=x);cp.stderr.on('data',x=>stderr+=x);const [code]=await once(cp,'close');h.save('tool-'+cp.pid+'.json',{destination,code,stdout,stderr});assert.equal(code,destination===owned?0:2,stderr);
  }
  assert.ok(fs.existsSync(path.join(owned,'existing-files.json')));assert.ok(!fs.existsSync(path.join(other,'existing-files.json')));finishScene(config,output);
 },{scene:true});
});

// Kill a real lease holder without its finally block. Its retained claim and
// earlier signatures must not be accepted when PID probing is unavailable.
const output=path.join(local,'workflows/crashed');fs.mkdirSync(output,{recursive:true});
const ownerScript=path.join(h.output,'owner.mjs');fs.writeFileSync(ownerScript,`import fs from 'node:fs';import {workspaceLease} from ${JSON.stringify(workspaceURL)};process.on('message',()=>{});await workspaceLease(JSON.parse(fs.readFileSync(process.argv[2])),process.argv[3],async({env})=>{process.send({env});await new Promise(()=>{});},{scene:true});`);
const owner=spawn(process.execPath,[ownerScript,configFile,output],{stdio:['ignore','ignore','inherit','ipc']});const [{env}]=await once(owner,'message');
assert.equal((await child(env)).exit_code,0);const originalClaim=fs.readFileSync(claimFile),claim=read(claimFile),directory=claim.liveness.directory;
const previous=read(path.join(directory,fs.readdirSync(directory).find(x=>x.endsWith('.response.json'))));const closed=once(owner,'close');owner.kill('SIGKILL');await closed;
await check('LIVE-03','拥有者实际死亡后，新鲜挑战无响应而停止，原未知锁不被接管',async()=>{
 const result=await child(env);assert.equal(result.exit_code,2);assert.match(result.stderr,/fresh liveness challenge/);assert.deepEqual(fs.readFileSync(claimFile),originalClaim);
 await assert.rejects(()=>workspaceLease(config,output,async()=>{}),/active or uncertain claim/);
});
async function attack(transform){
 const seen=new Set(fs.readdirSync(directory));let active=true;
 const answer=()=>{if(!active)return;for(const name of fs.readdirSync(directory)){if(seen.has(name)||!name.endsWith('.request.json'))continue;let request;try{request=read(path.join(directory,name));}catch{continue;}seen.add(name);fs.writeFileSync(path.join(directory,request.nonce+'.response.json'),JSON.stringify(transform(request))+'\n',{flag:'wx'});}};
 const watcher=fs.watch(directory,answer),timer=setInterval(answer,50);
 try{return await child(env);}finally{active=false;watcher.close();clearInterval(timer);}
}
await check('LIVE-04','复制旧签名响应到新挑战不能重放',async()=>{
 const result=await attack(()=>previous);assert.equal(result.exit_code,2);assert.match(result.stderr,/signature or invocation binding/);
});
await check('LIVE-05','改成新 nonce 的旧签名仍被拒绝',async()=>{
 const result=await attack(request=>({...previous,nonce:request.nonce}));assert.equal(result.exit_code,2);assert.match(result.stderr,/signature or invocation binding/);
});
await check('LIVE-06','攻击者私钥签名无法替代工具固定的拥有者公钥',async()=>{
 const {privateKey}=generateKeyPairSync('ed25519');const result=await attack(request=>{
  const response={schema:previous.schema,nonce:request.nonce,claim_sha256:request.claim_sha256,pid:claim.pid,responded_at:new Date().toISOString()};return {...response,signature:sign(null,Buffer.from(JSON.stringify(response)),privateKey).toString('base64')};
 });assert.equal(result.exit_code,2);assert.match(result.stderr,/signature or invocation binding/);
});
assert.deepEqual(fs.readFileSync(claimFile),originalClaim);
h.finish(['workflows/shared/lease-proof.mjs','workflows/shared/workspace.mjs','workflows/shared/guard.mjs','tests/workspace_liveness.integration.mjs']);
