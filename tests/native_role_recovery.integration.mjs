// Faults applied to copies of an actual completed official Player role.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {verifyRoleResume} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/recovery.mjs';
import {harness,read,sha} from './official_workflow_harness.mjs';
const args=process.argv.slice(2),from=path.resolve(args[args.indexOf('--from')+1]);assert.ok(args.includes('--from'));
const source=path.join(read(path.join(from,'live-result.json')).result.directory,'case'),h=harness('native-role-recovery',[]),results=[];
const original=Object.fromEntries(['agent-runtime.json','agent.jsonl','role-call-binding.json'].map(name=>[name,sha(path.join(source,name))]));
function fixture(name){const folder=path.join(h.temporary,name);fs.mkdirSync(folder);for(const file of ['agent-runtime.json','agent.jsonl','role-call-binding.json','metrics.json'])fs.copyFileSync(path.join(source,file),path.join(folder,file));fs.cpSync(path.join(source,'official-player'),path.join(folder,'official-player'),{recursive:true});return folder;}
function edit(file,operation){const value=read(file);operation(value);fs.writeFileSync(file,JSON.stringify(value)+'\n');}
h.test('ROLE-PROOF-01','实际完成的官方 Player 角色可被接续，授权冻结原生会话、服务及调用证据摘要',()=>{
 const value=verifyRoleResume(source);assert.equal(value.action,'adopt_completed_role');assert.ok(value.proof_files[path.join(source,'role-call-binding.json')]);assert.ok(Object.keys(value.proof_files).some(file=>file.endsWith('.result.json')));h.save('actual-completion-proof.json',value);
});
h.test('ROLE-PROOF-02','同一角色的服务绑定被修改时拒绝接续',()=>{const folder=fixture('binding-drift');edit(path.join(folder,'role-call-binding.json'),value=>value.agent_runtime.service.provider='another-service');assert.throws(()=>verifyRoleResume(folder),/role binding changed/);});
h.test('ROLE-PROOF-03','官方返回的提供商会话与原生 init/done 不符时拒绝接续',()=>{const folder=fixture('provider-drift'),official=path.join(folder,'official-player');for(const name of fs.readdirSync(official).filter(name=>name.endsWith('.result.json')))edit(path.join(official,name),value=>value.resumeToken='different-provider-session');assert.throws(()=>verifyRoleResume(folder),/matching official Player result/);});
h.test('ROLE-PROOF-04','旧传输标记不能冒充新 Player 证据',()=>{const folder=fixture('legacy-marker');edit(path.join(folder,'agent-runtime.json'),value=>value.transport.kind='official-playbook-cli');assert.throws(()=>verifyRoleResume(folder),/official session and service binding/);});
h.test('ROLE-PROOF-05','失败角色没有已证明的提供商继续能力时仍阻止自动重放',()=>{const folder=fixture('failed-call'),file=path.join(folder,'agent.jsonl'),events=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse),done=events.filter(event=>event.type==='done').at(-1);done.payload.status='error';events.push({type:'error',sessionId:done.sessionId,payload:{message:'Controlled failed transport'}});fs.writeFileSync(file,events.map(event=>JSON.stringify(event)).join('\n')+'\n');assert.throws(()=>verifyRoleResume(folder),/no proved provider continuation/);});
for(const [name,digest]of Object.entries(original))assert.equal(sha(path.join(source,name)),digest);
h.save('original-native-integrity.json',{source,before:original,after:Object.fromEntries(Object.keys(original).map(name=>[name,sha(path.join(source,name))]))});
h.finish(['workflows/shared/recovery.mjs','tests/native_role_recovery.integration.mjs']);
