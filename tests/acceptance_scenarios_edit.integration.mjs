import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {harness,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-scenarios-edit',[['acceptance-scenarios','scenarios',{designer:'acceptance.designer'}]]);
if(!h.live)throw Error('This is a real-model forward test; pass --live-cli explicitly');
const root=h.project('git-project'),at='AT-edit-forward';
h.run('git-init','git',['init','-q',root]);
fs.writeFileSync(path.join(root,'product.mjs'),'throw new Error("This product must not be executed by scenario design");\n');
h.run('git-add-fixture','git',['-C',root,'add','product.mjs']);
h.run('git-commit-fixture','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'采用明确提供的需求和人工场景。'});
const requirement=(id,text)=>({id,text,origin:{kind:'integration-fixture',reference:'fixture:requirements'},external_refs:[]});
const scene=(id,owner,text)=>({id,requirement_id:owner,title:id,description:text,priority:'P1',priority_reason:'此保存或确认分支失效会损坏对应业务结果。',
  origin:{kind:'human-designed',reference:'fixture:human#'+id},external_refs:[],check:{method:'human-adopted',basis:'夹具中真实提供的人工场景，不是模型输出。'}});
const latest=path.join(root,'.acceptance',at,'scenarios.json');
const save=(id,defs)=>freezeAcceptance({project_root:root,acceptance_id:at,request_id:id,basis:'本次独立前向测试夹具中的明确采用决定。',base_definitions_sha256:fs.existsSync(latest)?sha(latest):null,definitions:defs});
let previous,keep,other,input,receipt;
h.test('EDIT-01','真实冻结旧需求、人工场景，再增量冻结扩展需求，保留两个快照',()=>{
  const original=save('baseline',{context:{business_goal:'验证指定需求修订不会破坏已有人工场景。'},requirements:[requirement('R1','保存非空文本后再次读取，应与输入逐字相同。'),requirement('R2','删除操作需要明确确认。')],
    scenarios:[{...scene('NORMAL','R1','保存一段非空普通文本后再次读取，内容与输入逐字相同。'),priority:'P0',priority_reason:'普通文本保存读取失效会破坏核心业务闭环。'},scene('HUMAN-KEEP','R1','给定含换行符和首尾空格的非空文本，保存并读回时逐字相同，且保留换行符与首尾空格。'),scene('OTHER','R2','发起删除后先显示确认，取消时不删除原记录。')]});
  previous=original.definitions;keep=read(latest).scenarios.find(s=>s.id==='HUMAN-KEEP');other=read(latest).scenarios.find(s=>s.id==='OTHER');
  save('extend-r1',{requirements:[requirement('R1','保存非空文本后再次读取，应与输入逐字相同；空字符串应被拒绝，且不得新增或覆盖已保存内容。')]});
  input={project_root:root,acceptance_id:at,request_id:'real-edit',definitions_sha256:sha(latest),target_id:'R1',mode:'edit',previous_definitions:previous};
  h.save('input.json',input);h.save('before.json',snapshot(root));
});
h.test('EDIT-02','真实 CLI 的 Designer 提交差量并通过门禁，原人工场景和无关目标保持原样',()=>{
  const before=sha(latest),product=sha(path.join(root,'product.mjs'));
  const result=h.cli('acceptance-scenarios',input,'live-edit',root);h.settled(result,'acceptance-scenarios','done');
  receipt=read(path.join(root,'.acceptance-local',at,'workflows/scenarios/real-edit/result.json'));
  const candidate=read(receipt.candidate_definitions.path),target=candidate.scenarios.filter(s=>s.requirement_id==='R1');
  assert.equal(receipt.mode,'edit');assert.equal(sha(latest),before);assert.equal(sha(path.join(root,'product.mjs')),product);
  assert.deepEqual(candidate.scenarios.find(s=>s.id==='HUMAN-KEEP'),keep);
  assert.deepEqual(candidate.scenarios.find(s=>s.id==='OTHER'),other);
  assert.ok(target.some(s=>!['NORMAL','HUMAN-KEEP'].includes(s.id)),'missing new empty-input scene');
  assert.ok(target.some(s=>s.id==='NORMAL'),'old positive-path identity disappeared');
  assert.equal(result.traces.filter(t=>t.type==='player.call.started').length,1);
  h.save('receipt.json',receipt);h.save('candidate.json',candidate);return {output:result.envelope,scenarios:target.map(s=>s.id)};
});
h.test('EDIT-03','单独采用差量后，人工场景版本和来源保持不变，仍未运行产品测试',()=>{
  const message=fs.readFileSync(receipt.next_freeze_command,'utf8'),adopted=freezeAcceptance(JSON.parse(message.slice('/acceptance-freeze '.length)));
  assert.equal(read(latest).scenarios.find(s=>s.id==='HUMAN-KEEP').version,keep.version);
  assert.deepEqual(read(latest).scenarios.find(s=>s.id==='OTHER'),other);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));return {definitions:adopted.definitions};
});
h.test('EDIT-04','采用之后重入旧设计请求不重跑模型、不倒退冻结定义',()=>{
  const before=snapshot(root),again=h.cli('acceptance-scenarios',input,'live-edit-repeat',root);h.settled(again,'acceptance-scenarios','done');
  assert.equal(again.traces.filter(t=>t.type==='player.call.started').length,0);assert.deepEqual(snapshot(root),before);return {output:again.envelope};
});
h.finish(['workflows/shared/readonly-agent.mjs','workflows/scenarios/stage.mjs','tests/acceptance_scenarios_edit.integration.mjs']);
