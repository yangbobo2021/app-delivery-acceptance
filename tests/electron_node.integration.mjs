import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2),oi=args.indexOf('--output'),root=oi<0?fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-electron-node-')):path.resolve(args[oi+1]);fs.mkdirSync(root,{recursive:true});
const ei=args.indexOf('--electron'),electron=ei<0?process.env.ACCEPTANCE_TEST_ELECTRON:args[ei+1],pkg=pathToFileURL(path.join(repo,'skills/en/app-delivery-acceptance/playbooks/acceptance')).href;
const harness=path.join(root,'probe.mjs');
fs.writeFileSync(harness,`
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {nodeCommand,nodeEnvironment} from ${JSON.stringify(pkg+'/runtime/node-process.mjs')};
import {runProcess} from ${JSON.stringify(pkg+'/workflows/shared/process.mjs')};
import {toolCommand} from ${JSON.stringify(pkg+'/workflows/shared/tool-command.mjs')};
import {createAcceptance} from ${JSON.stringify(pkg+'/workflows/create/initialize.mjs')};
import {freezeAcceptance} from ${JSON.stringify(pkg+'/workflows/freeze/registry.mjs')};
import {prepare,finalize} from ${JSON.stringify(pkg+'/workflows/scenarios/stage.mjs')};
const root=process.argv[2],isElectron=!!process.versions.electron,original=process.env.ELECTRON_RUN_AS_NODE;let app;
if(isElectron){({app}=await import('electron'));app.setPath('userData',path.join(root,'userdata'));await app.whenReady();}
try{
 const env={...process.env,ACCEPTANCE_NODE_SENTINEL:'preserved'};delete env.ELECTRON_RUN_AS_NODE;
 assert.equal(process.env.ELECTRON_RUN_AS_NODE,original);
 const probe=path.join(root,'node only script.mjs');fs.writeFileSync(probe,"console.log(JSON.stringify({flag:process.env.ELECTRON_RUN_AS_NODE??null,sentinel:process.env.ACCEPTANCE_NODE_SENTINEL,argv:process.argv.slice(2)}));");
 const command=nodeCommand(probe,'argument with spaces'),simple=spawnSync(command[0],command.slice(1),{env,encoding:'utf8',timeout:10000});assert.ifError(simple.error);assert.equal(simple.status,0,simple.stderr);let value=JSON.parse(simple.stdout);assert.equal(value.flag,isElectron?'1':null);assert.equal(value.sentinel,'preserved');assert.deepEqual(value.argv,['argument with spaces']);
 const processResult=await runProcess(process.execPath,[probe],{cwd:root,env,output:path.join(root,'process'),timeoutSeconds:10});assert.equal(processResult.exit_code,0);assert.equal(JSON.parse(fs.readFileSync(processResult.log.path)).flag,isElectron?'1':null);
 const foreign=await runProcess('/bin/sh',['-c',${JSON.stringify('printf "%s" "${ELECTRON_RUN_AS_NODE:-unset}"')}],{cwd:root,env,output:path.join(root,'foreign'),timeoutSeconds:10});assert.equal(fs.readFileSync(foreign.log.path,'utf8'),'unset');
 const delegated=path.join(root,'delegated');fs.mkdirSync(delegated);process.env.ACCEPTANCE_WORKSPACE_LEASE=path.join(root,'fixture lease');process.env.ACCEPTANCE_WORKSPACE_CLAIM='fixture-claim';
 const tool=toolCommand(probe,delegated);delete process.env.ACCEPTANCE_WORKSPACE_LEASE;delete process.env.ACCEPTANCE_WORKSPACE_CLAIM;const invoked=spawnSync(tool[0],tool.slice(1),{env,encoding:'utf8',timeout:10000});assert.ifError(invoked.error);assert.equal(invoked.status,0,invoked.stderr);value=JSON.parse(invoked.stdout);assert.deepEqual(value.argv,['--lease-file',path.join(delegated,'.tool-authority.json')]);assert.equal(value.flag,isElectron?'1':null);assert.equal(JSON.parse(fs.readFileSync(value.argv[1])).claim,'fixture-claim');
 const project=path.join(root,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'.gitignore'),'.acceptance-local/\\n');let git=spawnSync('git',['init'],{cwd:project,encoding:'utf8'});assert.equal(git.status,0,git.stderr);
 createAcceptance({project_root:project,acceptance_id:'AT-electron',request_id:'create',user_request:'integration fixture'});
 freezeAcceptance({project_root:project,acceptance_id:'AT-electron',request_id:'freeze',base_definitions_sha256:null,basis:'explicit fixture requirement',definitions:{context:{business_goal:'保留输入原文的真实门禁夹具'},requirements:[{id:'R1',text:'保存输入时保留完整原文。',origin:{kind:'integration-fixture',reference:'actual-fixture'},external_refs:[]}]}});
 const catalog=path.join(project,'.acceptance/AT-electron/scenarios.json'),sha=createHash('sha256').update(fs.readFileSync(catalog)).digest('hex');const spec=prepare({project_root:project,acceptance_id:'AT-electron',request_id:'design',definitions_sha256:sha,target_id:'R1'});
 const scene={id:'S1',title:'原文保存',description:'给定一段原文，保存后读取的文本与输入完全相同。',priority:'P0',priority_reason:'丢失原文会破坏交付依据。'};
 const designed=finalize(spec,JSON.stringify({scenarios:[scene],change_summary:['依据冻结原文形成测试点。'],selfcheck:{obligations:[{quote:'保存输入时保留完整原文。',scene_ids:['S1']}],ui_requirement:{required:false,reason:'仅校验文本逻辑。'},scene_checks:[{scene_id:'S1',owner_quote:'保存输入时保留完整原文。',distinguishing_failure:'保存时修改了原文。',observable_result:'读取内容与冻结输入一致。',failure_impact:'原文保存失效。',ui_visual_expectation:''}]}}));
 assert.equal(designed.status,'designed');assert.equal(designed.scenarios,1);const validation=JSON.parse(fs.readFileSync(path.join(spec.folder,'validation-command.json')));assert.equal(validation.exit_code,0);assert.equal(validation.argv[0],isElectron?'env':process.execPath);
 if(isElectron){
  const missing=prepare({project_root:project,acceptance_id:'AT-electron',request_id:'missing-helper',definitions_sha256:sha,target_id:'R1'}),answer=fs.readFileSync(path.join(spec.folder,'answer.txt'),'utf8'),savedPath=process.env.PATH;
  try{process.env.PATH=path.join(root,'no-executables');assert.throws(()=>finalize(missing,answer),error=>error.code==='ENOENT');}finally{process.env.PATH=savedPath;}
  const refused=JSON.parse(fs.readFileSync(path.join(missing.folder,'validation-command.json')));assert.equal(refused.exit_code,null);assert.equal(refused.stdout,null);assert.equal(refused.stderr,null);assert.equal(refused.spawn_error.code,'ENOENT');
 }
 assert.equal(process.env.ELECTRON_RUN_AS_NODE,original);assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({status:'passed',host:isElectron?'electron-main':'node',electron:process.versions.electron??null,host_environment_unchanged:true,foreign_command_environment_unchanged:true,tool_authority_preserved:true,scenario_status:designed.status,validation,process_receipt:processResult},null,2)+'\\n');
 if(app)app.exit(0);
}catch(error){console.error(error);if(app)app.exit(1);else process.exitCode=1;}
`);
const electronApp=path.join(root,'electron-app');fs.mkdirSync(electronApp);fs.writeFileSync(path.join(electronApp,'package.json'),JSON.stringify({name:'acceptance-electron-node-check',version:'1.0.0',main:'main.cjs'}));fs.writeFileSync(path.join(electronApp,'main.cjs'),"const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(process.argv[2],'userdata'));app.whenReady().then(()=>import("+JSON.stringify(pathToFileURL(harness).href)+")).catch(error=>{console.error(error);app.exit(1)});");
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const results=[];
for(const [mode,executable] of [['node',process.execPath],...(electron?[['electron-main',electron]]:[])]){const dir=path.join(root,mode);fs.mkdirSync(dir);const argv=[mode==='node'?harness:electronApp,dir],r=spawnSync(executable,argv,{env,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});fs.writeFileSync(path.join(root,mode+'.command.json'),JSON.stringify({executable,argv,exit_code:r.status,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr},null,2)+'\n');assert.ifError(r.error);assert.equal(r.status,0,r.stderr);results.push(JSON.parse(fs.readFileSync(path.join(dir,'result.json'))));}
fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify({status:'passed',modes:results.map(r=>r.host),electron_not_available:!electron,results},null,2)+'\n');console.log('passed scoped Node children, foreign env, authority and actual scenario gate: '+results.map(r=>r.host).join(', ')+'; evidence: '+root);
