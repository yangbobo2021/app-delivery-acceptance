import {validateStore} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/validation.mjs';
import {readKnowledge} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/knowledge.mjs';
import {workspaceMetadataLock} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/workspace.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance,preflightInput} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {harness,skill,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-freeze',[['acceptance-create','create'],['acceptance-freeze','freeze']]);
const root=h.project('project'),at='AT-freeze';
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'新建交付测试'});
const shared=path.join(root,'.acceptance',at),latest=path.join(shared,'scenarios.json');
const requirement=(id,text)=>({id,title:id,text,origin:{kind:'conversation',reference:'integration-fixture:user-message'},external_refs:[]});
const base=(id,defs,project=root,acceptance=at)=>({project_root:project,acceptance_id:acceptance,request_id:id,
  basis:'集成夹具中的用户要求：冻结这些原始约定，暂不生成场景。',
  base_definitions_sha256:fs.existsSync(path.join(project,'.acceptance',acceptance,'scenarios.json'))?sha(path.join(project,'.acceptance',acceptance,'scenarios.json')):null,
  definitions:defs});
const first=base('freeze-1',{context:{business_goal:'验证保留原话的冻结与后续接续。'},requirements:[requirement('R1','用户可以保存原始需求。')]});
let frozen;
h.test('FREEZE-01','空容器冻结口述需求，生成真实范围与完整 v2 定义后停止',()=>{
  frozen=freezeAcceptance(first);assert.equal(frozen.status,'frozen');assert.equal(frozen.stopped_after,'freeze');
  assert.equal(frozen.scope.version,1);assert.equal(frozen.definition_version,1);
  const value=read(latest);assert.equal(value.requirements[0].text,first.definitions.requirements[0].text);
  assert.equal(value.requirements[0].origin.reference,'integration-fixture:user-message');assert.deepEqual(value.scenarios,[]);
  assert.deepEqual(frozen.counts,{requirements:1,reverse_rules:0,scenarios:0});
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));
  h.save('first-request.json',first);h.save('first-receipt.json',frozen);h.save('after-first-freeze.json',snapshot(root));
  return {input:first,output:frozen};
});
h.test('FREEZE-02','当前 Node 存储读取器严格校验冻结产物与知识收据',()=>{assert.equal(validateStore(root,at).scope.version,1);assert.equal(readKnowledge(root,at,[]).acceptance.id,at);});
h.test('FREEZE-03','同一请求重入保持所有文件字节不变',()=>{
  const before=snapshot(root),again=freezeAcceptance(first);assert.equal(again.status,'already_frozen');assert.equal(again.applicability,'current');assert.deepEqual(snapshot(root),before);
});
h.test('FREEZE-04','增量冻结保留旧需求、原文、不可覆盖历史和当前 AT',()=>{
  const old=sha(frozen.definitions.path);
  const result=freezeAcceptance(base('freeze-2',{requirements:[requirement('R2','第二个需求不能覆盖第一个需求。')]}));
  assert.equal(result.definition_version,2);assert.equal(sha(frozen.definitions.path),old);
  assert.deepEqual(read(path.join(shared,result.scope.path)).scope.targets,['R1','R2']);
  assert.deepEqual(read(latest).requirements.map(r=>r.id),['R1','R2']);
  assert.equal(read(path.join(root,'.acceptance-local/current.json')).acceptance_id,at);
});
h.test('FREEZE-05','旧基线和同 request_id 不同输入被拒绝，不发布任何新版本',()=>{
  const before=snapshot(root);
  assert.throws(()=>freezeAcceptance({...first,request_id:'stale'}),/definitions changed/);
  assert.throws(()=>freezeAcceptance({...first,basis:'changed'}),/different freeze request/);
  assert.deepEqual(snapshot(root),before);
});
h.test('FREEZE-06','缺来源、重复身份及待确认规则的非法可执行场景均拒绝',()=>{
  const invalid=[{requirements:[{id:'R-bad',text:'缺来源',external_refs:[]}]},
    {requirements:[requirement('dup','a'),requirement('dup','b')]},
    {reverse_rules:[{id:'rule',text:'观察',origin:{kind:'code',reference:'fixture'},external_refs:[],status:'needs_confirmation',question:'请确认',code_sources:[{path:'a.js',revision:'fixture',sha256:'0'.repeat(64)}]}],
     scenarios:[{id:'S-bad',requirement_id:'rule',description:'不允许执行待确认规则。',priority:'P0',priority_reason:'fixture',origin:{kind:'fixture',reference:'user'},external_refs:[],check:{method:'fixture',basis:'fixture'}}]}];
  for(let i=0;i<invalid.length;i++) {const before=snapshot(root);assert.throws(()=>freezeAcceptance(base('invalid-'+i,invalid[i])));assert.deepEqual(snapshot(root),before);}
});
const scene={id:'S1',requirement_id:'R1',title:'采用已有场景',description:'给定已有需求，保存后可以读取完全相同的原话。',priority:'P0',priority_reason:'原文丢失会使验收失去依据。',origin:{kind:'project-spec',reference:'fixture/spec#S1'},external_refs:[],check:{method:'adopt-existing',basis:'用户明确提供此场景。'}};
h.test('FREEZE-07','直接采用已有场景，保留 ID、来源和判据，不启动生成 Agent',()=>{
  const result=freezeAcceptance(base('adopt-scene',{scenarios:[scene]}));
  assert.equal(result.counts.scenarios,1);assert.equal(read(latest).scenarios[0].origin.reference,scene.origin.reference);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workflows/scenarios')));
});
h.test('FREEZE-08','新增独立需求不使原无关场景失效',()=>{
  const result=freezeAcceptance(base('add-independent',{requirements:[requirement('R3','这是独立需求。')]}));
  assert.deepEqual(result.change.rerun_scene_ids,[]);assert.equal(read(latest).scenarios[0].id,'S1');
});
h.test('FREEZE-09','业务需求变化使依赖场景待复验，原场景和旧结论不被删除',()=>{
  const result=freezeAcceptance(base('change-r1',{requirements:[requirement('R1','用户可以保存原始需求，并准确保留 Unicode。')]}));
  assert.deepEqual(result.change.rerun_scene_ids,['S1']);assert.equal(read(latest).scenarios[0].id,'S1');
});
h.test('FREEZE-10','旧请求重入只返回已被取代的历史，不倒退当前定义',()=>{
  const before=snapshot(root),result=freezeAcceptance(first);assert.equal(result.applicability,'superseded');assert.deepEqual(snapshot(root),before);
});
h.test('FREEZE-11','替换模式必须有明确依据；允许的替换保留历史',()=>{
  const req=base('replace-all',{context:{business_goal:'用户明确只保留 R2。'},requirements:[requirement('R2','第二个需求不能覆盖第一个需求。')]});
  assert.throws(()=>freezeAcceptance({...req,mode:'replace'}),/replace requires/);
  const result=freezeAcceptance({...req,mode:'replace',replace_basis:'用户在夹具中明确退役其余需求和场景。'});
  assert.equal(result.counts.requirements,1);assert.equal(result.counts.scenarios,0);
  assert.ok(fs.existsSync(frozen.definitions.path));
});
h.test('FREEZE-12','非 ASCII、浮点上下文与原协议哈希保持兼容',()=>{
  const result=freezeAcceptance(base('unicode-number',{context:{'共同约束😀':{threshold:0.0000001,large:1e23},note:'原文，换行\n"引号"'},requirements:[requirement('R4','中文、emoji😀 和换行\n都应保留。')]}));
  assert.equal(validateStore(root,at).scope.version,result.scope.version);assert.equal(result.status,'frozen');
});
h.test('FREEZE-13','当前 AT 不匹配与嵌套资料根拒绝发布',()=>{
  const before=snapshot(root);assert.throws(()=>freezeAcceptance({...base('wrong-at',{}),acceptance_id:'AT-other'}));
  const nested=path.join(root,'nested');fs.mkdirSync(nested);assert.throws(()=>freezeAcceptance(base('nested',{},nested)));
  assert.deepEqual(snapshot(root),before);
});
h.test('FREEZE-14','真实工作区互斥持有时拒绝冻结且不改定义',()=>{const req=base('workspace-busy',{requirements:[requirement('R5','之后再冻结。')]}),before=sha(latest);workspaceMetadataLock(root,at,()=>assert.throws(()=>freezeAcceptance(req),/workspace stage is running/));assert.equal(sha(latest),before);});

h.test('FREEZE-PREFLIGHT-01','只读预检集中返回独立缺字段，正式入口复用相同检查且不发布业务资料',()=>{
  const project=h.project('preflight-shapes'),acceptance='AT-preflight-shapes';createAcceptance({project_root:project,acceptance_id:acceptance,request_id:'create',user_request:'仅创建参数预检夹具。'});
  const req=base('incomplete',{requirements:[{id:'COPY',text:'导出时保留原文中的换行。',origin:{kind:'conversation'},external_refs:[]}]},project,acceptance),before=snapshot(project),input=JSON.stringify(req);
  const checked=preflightInput(req);assert.equal(checked.status,'invalid');
  assert.ok(checked.issues.some(x=>x.path==='definitions.context.business_goal'));assert.ok(checked.issues.some(x=>x.path==='definitions.requirements.0.origin.reference'));
  assert.throws(()=>freezeAcceptance(req),error=>{assert.deepEqual(error.issues,checked.issues);return true;});
  assert.equal(JSON.stringify(req),input);assert.deepEqual(snapshot(project),before);return {issues:checked.issues};
});
h.test('FREEZE-PREFLIGHT-02','预检成功不保留或锁定版本，正式发布拒绝期间发生的基线漂移',()=>{
  const req=base('preflight-will-stale',{requirements:[requirement('PREFLIGHT','检索结果保留原始顺序。')]}),before=snapshot(root);
  assert.equal(preflightInput(req).status,'ready');assert.deepEqual(snapshot(root),before);
  freezeAcceptance(base('advance-before-commit',{requirements:[requirement('OTHER-PREFLIGHT','到期后仍能读取历史记录。')]}));
  const changed=snapshot(root);assert.equal(preflightInput(req).status,'invalid');assert.throws(()=>freezeAcceptance(req),/definitions changed/);assert.deepEqual(snapshot(root),changed);
});
h.test('FREEZE-PREFLIGHT-03','文件快照预检使用真实字节与定位，正确输入首次发布且历史重入只读',()=>{
  const project=h.project('preflight-files'),acceptance='AT-preflight-files';createAcceptance({project_root:project,acceptance_id:acceptance,request_id:'create',user_request:'预检文件来源。'});
  const text='导出的记录数应等于所选记录数。',file=path.join(project,'contract.txt');fs.writeFileSync(file,text+'\n');
  const req=base('file-freeze',{context:{business_goal:'依据真实文件冻结导出约定。'},requirements:[{id:'EXPORT',text,origin:{kind:'file',reference:'contract.txt:1',file:{path:'contract.txt',start_line:1,end_line:1}},external_refs:[]}]},project,acceptance);
  req.source_inputs={required_documents:['contract.txt'],documents:[{path:'contract.txt',text:text+'\n',sha256:sha(file)}]};
  const before=snapshot(project);assert.equal(preflightInput(req).status,'ready');assert.deepEqual(snapshot(project),before);
  const result=freezeAcceptance(req);assert.equal(result.status,'frozen');const after=snapshot(project);
  assert.equal(preflightInput(req).status,'ready');assert.equal(freezeAcceptance(req).status,'already_frozen');assert.deepEqual(snapshot(project),after);
  fs.writeFileSync(file,text+'变更\n');const drift={...req,request_id:'changed-file',base_definitions_sha256:sha(path.join(project,'.acceptance',acceptance,'scenarios.json'))};assert.equal(preflightInput(drift).status,'invalid');assert.throws(()=>freezeAcceptance(drift),/differs/);
});

if(h.live){
  const liveRoot=h.project('live-project'),liveAt='AT-live-freeze';
  h.test('FREEZE-15','真实官方 CLI 串联创建与冻结后停止，保持同一 AT',()=>{
    const creation={project_root:liveRoot,acceptance_id:liveAt,request_id:'live-create',user_request:'针对这项需求，新建交付测试并冻结，不生成场景。'};
    const a=h.cli('acceptance-create',creation,'live-create',liveRoot);h.settled(a,'acceptance-create','created');
    const input=base('live-freeze',{context:{business_goal:'保存当前口述需求。'},requirements:[requirement('R-live','用户能够冻结原始需求。')]},liveRoot,liveAt);
    h.save('live-input.json',input);
    const b=h.cli('acceptance-freeze',input,'live-freeze',liveRoot);h.settled(b,'acceptance-freeze','frozen');
    const value=read(path.join(liveRoot,'.acceptance',liveAt,'scenarios.json'));assert.equal(value.requirements[0].text,'用户能够冻结原始需求。');assert.deepEqual(value.scenarios,[]);
    assert.equal(read(path.join(liveRoot,'.acceptance-local/current.json')).acceptance_id,liveAt);
    h.save('live-input.json',input);h.save('live-after.json',snapshot(liveRoot));return {input,output:b.envelope};
  });
  h.test('FREEZE-16','真实 CLI 重试不重写文件；过期基线到达 blocked 而非伪成功',()=>{
    const input=read(path.join(h.output,'live-input.json')),before=snapshot(liveRoot);
    const again=h.cli('acceptance-freeze',input,'live-freeze-repeat',liveRoot);h.settled(again,'acceptance-freeze','frozen');assert.deepEqual(snapshot(liveRoot),before);
    const bad=h.cli('acceptance-freeze',{...input,request_id:'stale-cli'},'live-freeze-stale',liveRoot);h.settled(bad,'acceptance-freeze','blocked');assert.deepEqual(snapshot(liveRoot),before);
    return {repeat_reply:again.envelope,expected_blocked_reply:bad.envelope};
  });
}
h.finish(['workflows/freeze/registry.mjs','workflows/shared/command.mjs','tests/acceptance_freeze.integration.mjs']);
