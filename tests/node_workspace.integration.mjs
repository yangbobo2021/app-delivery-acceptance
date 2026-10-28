import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {readKnowledge} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/knowledge.mjs';
import {workspaceLease,finishScene,workspaceMetadataLock} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/workspace.mjs';
import {harness} from './official_workflow_harness.mjs';
const h=harness('node-workspace',[]),root=fs.realpathSync(h.project('project')),at='AT-lock';
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'验证实际工作区互斥及恢复边界。'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'受控并发测试。',definitions:{context:{business_goal:'拒绝并发工作区写入。'},requirements:[{id:'R1',text:'并发操作不会覆盖运行中的工作区。',origin:{kind:'fixture',reference:'workspace-lock'},external_refs:[]}]}});
const acceptance=readKnowledge(root,at,[]).acceptance,local=path.join(root,'.acceptance-local',at),config={acceptance,workspace_policy:'single-acceptance-v1',project_root:path.join(local,'workspace'),test_roots:['tests']};
const first=path.join(local,'workflows/first'),second=path.join(local,'workflows/second');fs.mkdirSync(first,{recursive:true});fs.mkdirSync(second);fs.mkdirSync(config.project_root);
const configFile=path.join(h.output,'config.json');fs.writeFileSync(configFile,JSON.stringify(config));
async function check(id,purpose,operation){try{const result=await operation();h.test(id,purpose,()=>result);}catch(error){h.test(id,purpose,()=>{throw error;});}}
await check('LEASE-01','真实 Node 租约持有时，另一 Node 进程与定义冻结均被阻塞',()=>workspaceLease(config,first,async()=>{
 const script=`import fs from 'node:fs';import {workspaceLease} from ${JSON.stringify(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/workspace.mjs',import.meta.url).href)};try{await workspaceLease(JSON.parse(fs.readFileSync(process.argv[1])),process.argv[2],async()=>{});process.exitCode=9;}catch(e){if(!e.message.includes('active or uncertain claim'))throw e;console.log(e.message);}`;
 const result=h.run('competing-node',process.execPath,['--input-type=module','-e',script,configFile,second]);assert.equal(result.exit_code,0,result.stderr);assert.match(result.stdout,/active or uncertain claim/);
 assert.throws(()=>workspaceMetadataLock(root,at,()=>{}),/workspace stage is running/);
 const before=fs.readFileSync(path.join(root,'.acceptance',at,'scope.json'));assert.throws(()=>freezeAcceptance({project_root:root,acceptance_id:at,request_id:'blocked-freeze',base_definitions_sha256:null,basis:'并发冻结应被阻塞',definitions:{requirements:[]}}));assert.deepEqual(fs.readFileSync(path.join(root,'.acceptance',at,'scope.json')),before);
},{scene:true}));
await check('LEASE-02','阶段退出保留场景归属；另一场景不能抢占，原场景可继续后释放',async()=>{
 assert.equal(fs.existsSync(path.join(local,'workspace.lock.d')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(local,'workspace-owner.json'))).output_dir,first);
 await assert.rejects(()=>workspaceLease(config,second,async()=>{throw Error('must not run');},{scene:true}),/Another scene owns/);
 await workspaceLease(config,first,async()=>finishScene(config,first),{scene:true});assert.equal(fs.existsSync(path.join(local,'workspace-owner.json')),false);assert.throws(()=>finishScene(config,first));
});
await check('LEASE-03','状态不明的互斥不能自动接管，伪造 claim 身份不能释放场景',async()=>{
 const claim=path.join(local,'workspace.lock.d');fs.mkdirSync(claim);fs.writeFileSync(path.join(claim,'owner.json'),'{"pid":99999999}');
 await assert.rejects(()=>workspaceLease(config,first,async()=>{}),/active or uncertain claim/);assert.ok(fs.existsSync(path.join(claim,'owner.json')));fs.rmSync(claim,{recursive:true});
 await workspaceLease(config,first,async()=>{const file=path.join(claim,'owner.json'),bytes=fs.readFileSync(file),value=JSON.parse(bytes);fs.writeFileSync(file,JSON.stringify({...value,pid:99999999}));try{assert.throws(()=>finishScene(config,first),/hold its Node workspace lease/);}finally{fs.writeFileSync(file,bytes);}finishScene(config,first);},{scene:true});
});
h.finish(['workflows/shared/workspace.mjs','tests/node_workspace.integration.mjs']);
