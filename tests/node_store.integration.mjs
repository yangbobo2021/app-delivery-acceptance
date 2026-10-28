import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {guard,validateStore} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/validation.mjs';
import {readKnowledge,validateKnowledge} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/knowledge.mjs';
import {digest,sceneInput,verifyCase,verifyStage,fingerprint} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/definitions.mjs';

const skill=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2),index=args.indexOf('--output');
const output=index<0?fs.mkdtempSync(path.join(os.tmpdir(),'node-store-proof-')):path.resolve(args[index+1]);fs.mkdirSync(output,{recursive:true});
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'node-store-project-'))),results=[],commands=[];
createAcceptance({project_root:root,acceptance_id:'AT-store',request_id:'create',user_request:'验证冻结存储及坏证据拒绝。'});
freezeAcceptance({project_root:root,acceptance_id:'AT-store',request_id:'freeze',base_definitions_sha256:null,basis:'受控存储合同测试。',definitions:{context:{business_goal:'Unicode 真实约定',shared_constraints:'Preserve original bytes.'},requirements:[{id:'R1',text:'Retain every valid field.',origin:{kind:'fixture',reference:'requirements/R1'},external_refs:[]}],scenarios:[{id:'S1',requirement_id:'R1',description:'Retain every valid field.',priority:'P0',priority_reason:'Core contract',check:{method:'adopted',basis:'Controlled fixture'},origin:{kind:'fixture',reference:'scenarios/S1'},external_refs:[]},{id:'S2',description:'Standalone scenario keeps no invented parent.',priority:'P1',priority_reason:'Independent contract',check:{method:'adopted',basis:'Controlled standalone fixture'},origin:{kind:'fixture',reference:'scenarios/S2'},external_refs:[]}]}});
const knowledge=readKnowledge(root,'AT-store',[]),definition=JSON.parse(fs.readFileSync(path.join(root,'.acceptance/AT-store/scenarios.json'))),config={acceptance:knowledge.acceptance,definitions:{path:path.join(root,'.acceptance/AT-store',definition.definition_record),sha256:digest(path.join(root,'.acceptance/AT-store/scenarios.json'))},test_roots:['tests']},local=path.join(root,'.acceptance-local/AT-store'),shared=path.join(root,'.acceptance/AT-store'),run=path.join(local,'workflows/check'),originalConfig=structuredClone(config);
async function test(id,purpose,operation){try{results.push({id,purpose,status:'passed',...(await operation()??{})});}catch(error){results.push({id,purpose,status:'failed',error:error.stack});process.exitCode=1;}
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(results.at(-1).status+' '+id+' '+purpose);}
function rejects(value=originalConfig,outputs=[run]){assert.throws(()=>guard(value,outputs,{}));}
function mutate(file,fn){const original=fs.readFileSync(file);try{fn(file);rejects();}finally{fs.writeFileSync(file,original);}}
await test('STORE-01','Node 验证真实冻结目录与知识收据',()=>{assert.equal(validateStore(root,'AT-store').scope.version,1);assert.deepEqual(guard(config,[run],{}),config.acceptance);});
await test('STORE-02','读取知识生成独立有效收据且不改原收据',()=>{const before=fs.readFileSync(config.acceptance.knowledge_receipt),next=readKnowledge(root,'AT-store',[]);assert.deepEqual(guard({...config,acceptance:next.acceptance},[run],{}),next.acceptance);assert.deepEqual(fs.readFileSync(config.acceptance.knowledge_receipt),before);});
await test('STORE-03','Wrong AT, changed scope, foreign output and store-based test roots stop before commands',()=>{
  for(const change of [v=>v.acceptance.id='AT-other',v=>v.acceptance.scope_sha256='0'.repeat(64),v=>v.test_roots=['.acceptance/AT-store'],v=>v.test_roots=['../outside']]){const value=structuredClone(config);change(value);rejects(value);}
  rejects(config,[output]);rejects(config,[path.join(local,'workflows')]);
});
await test('STORE-04','Current pointer removal, corruption and symlink never fall back to history',()=>{
  const file=path.join(root,'.acceptance-local/current.json'),original=fs.readFileSync(file);
  try{fs.unlinkSync(file);rejects();fs.writeFileSync(file,'{"acceptance_id":"AT-store","extra":true}');rejects();fs.unlinkSync(file);fs.symlinkSync(path.join(output,'pointer.json'),file);fs.writeFileSync(path.join(output,'pointer.json'),original);rejects();}
  finally{if(fs.existsSync(file)||fs.lstatSync(file,{throwIfNoEntry:false}))fs.unlinkSync(file);fs.writeFileSync(file,original);}
});
await test('STORE-05','Changed scope snapshots and definition contents cannot be used as frozen history',()=>{
  mutate(path.join(shared,'records/scope-0001.json'),file=>{const v=JSON.parse(fs.readFileSync(file));v.basis+=' changed';fs.writeFileSync(file,JSON.stringify(v));});
  mutate(config.definitions.path,file=>{const v=JSON.parse(fs.readFileSync(file));v.requirements[0].text='Tampered';fs.writeFileSync(file,JSON.stringify(v));});
  mutate(path.join(shared,'scenarios.json'),file=>{const v=JSON.parse(fs.readFileSync(file));v.definition_version=9;fs.writeFileSync(file,JSON.stringify(v));});
});
await test('STORE-06','Unindexed knowledge, bad links, changed receipts and symlink assets are rejected',()=>{
  const base=path.join(root,'.acceptance/knowledge'),rogue=path.join(base,'rogue.md');
  try{fs.writeFileSync(rogue,'Unindexed');rejects();}finally{fs.unlinkSync(rogue);}
  mutate(path.join(base,'INDEX.md'),file=>fs.appendFileSync(file,'\n[Broken](missing.md)\n'));
  mutate(config.acceptance.knowledge_receipt,file=>{const v=JSON.parse(fs.readFileSync(file));v.read_files['INDEX.md']='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(v));});
  const original=fs.readFileSync(path.join(base,'INDEX.md'));try{fs.writeFileSync(rogue,'temp');fs.unlinkSync(rogue);fs.symlinkSync(path.join(output,'target.md'),rogue);fs.writeFileSync(path.join(output,'target.md'),'linked');fs.appendFileSync(path.join(base,'INDEX.md'),'\n[Linked](rogue.md)\n');rejects();}finally{fs.unlinkSync(rogue);fs.writeFileSync(path.join(base,'INDEX.md'),original);}
});
await test('STORE-07','Archived record checks reject missing or changed evidence independently of current runs',()=>{
  const folder=path.join(shared,'records/archive-fixture');fs.mkdirSync(folder);const file=path.join(folder,'selected.log');fs.writeFileSync(file,'Original evidence');
  fs.writeFileSync(path.join(folder,'record.json'),JSON.stringify({schema:'acceptance-evidence-record-v1',acceptance_id:'AT-store',files:{'selected.log':digest(file)}}));
  try{assert.deepEqual(guard(config,[run],{}),config.acceptance);fs.writeFileSync(file,'Tampered');rejects();fs.unlinkSync(file);rejects();}finally{fs.rmSync(folder,{recursive:true});}
});
await test('STORE-08','Frozen owned and standalone scenes retain complete business context and reject altered inputs',()=>{
  for(const id of ['S1','S2']){
    const value=sceneInput(config,id);assert.equal(value.scene.id,id);if(id==='S1')assert.equal(value.requirement.id,'R1');else assert.equal(value.requirement,null);verifyCase({...value,acceptance:config.acceptance});
    const altered={...value,acceptance:config.acceptance,business_goal:'Changed business goal'};assert.throws(()=>verifyCase(altered),/differs from frozen/);
  }
  const value=JSON.parse(fs.readFileSync(config.definitions.path));verifyStage({...config,requirements:{items:value.requirements,shared_constraints:value.context.shared_constraints}});
  assert.throws(()=>verifyStage({...config,requirements:{items:[]}}),/complete frozen/);
});
await test('STORE-09','Layered knowledge and indexed project assets produce valid current receipts',()=>{
  const base=path.join(root,'.acceptance/knowledge'),original=fs.readFileSync(path.join(base,'INDEX.md'));
  fs.mkdirSync(path.join(base,'tools'));fs.writeFileSync(path.join(base,'tools/INDEX.md'),'# Tools\n\n## 职责\nReusable tools.\n\n## 何时读取\nWhen preparing tests.\n\n[Note](note.md)\n[Project](project:tests/helper.mjs)\n');fs.writeFileSync(path.join(base,'tools/note.md'),'Reusable note');fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'tests/helper.mjs'),'export const fixture = true;\n');fs.appendFileSync(path.join(base,'INDEX.md'),'\n[Tools](tools/INDEX.md)\n');
  try{
    const inventory=validateKnowledge(root);assert.ok(inventory);
    const knowledge=readKnowledge(root,'AT-store',['project:tests/helper.mjs','tools/note.md']);assert.deepEqual(Object.keys(knowledge.contents).sort(),['INDEX.md','tools/INDEX.md','tools/note.md','project:tests/helper.mjs'].sort());
    assert.deepEqual(guard({...config,acceptance:knowledge.acceptance},[run],{}),knowledge.acceptance);rejects(config);
  }finally{fs.writeFileSync(path.join(base,'INDEX.md'),original);fs.rmSync(path.join(base,'tools'),{recursive:true});fs.rmSync(path.join(root,'tests'),{recursive:true});}
});
await test('STORE-10','Node validation does not need a Python executable for an existing valid store',()=>{
  const bin=path.join(output,'no-python-bin'),marker=path.join(output,'unexpected-python');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'python3'),'#!/bin/sh\n: > '+JSON.stringify(marker)+'\nexit 97\n',{mode:0o700});
  const original=process.env.PATH;try{process.env.PATH=bin+':'+original;assert.deepEqual(guard(config,[run],{}),config.acceptance);assert.match(fingerprint({中国:'约定',list:[null,true,3]}),/^[0-9a-f]{64}$/);assert.equal(fs.existsSync(marker),false);}finally{process.env.PATH=original;}
});
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({root,output,passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,scope:'Current Node store, frozen definitions, knowledge receipts and tamper/concurrency guards.',results},null,2)+'\n');
