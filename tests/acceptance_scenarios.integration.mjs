import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize,fail} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/scenarios/stage.mjs';
import {harness,skill,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-scenarios',[['acceptance-scenarios','scenarios',{designer:'acceptance.designer'}],['acceptance-freeze','freeze']]);
const root=h.project('project'),at='AT-scenarios';
const req=(id,text)=>({id,text,origin:{kind:'integration-fixture',reference:'actual-user-fixture'},external_refs:[]});
const makeProject=(root,id)=>createAcceptance({project_root:root,acceptance_id:id,request_id:'create',user_request:'在此夹具中新建交付测试'});
const freeze=(id,defs,project=root,acceptance=at)=>freezeAcceptance({project_root:project,acceptance_id:acceptance,request_id:id,
  basis:'集成夹具中的明确采用决定。',base_definitions_sha256:fs.existsSync(path.join(project,'.acceptance',acceptance,'scenarios.json'))?sha(path.join(project,'.acceptance',acceptance,'scenarios.json')):null,definitions:defs});
makeProject(root,at);
freeze('initial',{context:{business_goal:'保留原话并单独设计指定需求的场景。'},requirements:[req('R1','保存输入时保留完整原文。'),req('R2','读取时返回已保存原文。')]});
const latest=path.join(root,'.acceptance',at,'scenarios.json');
const input=(id,target='R1',extra={},project=root,acceptance=at)=>({project_root:project,acceptance_id:acceptance,request_id:id,target_id:target,
  definitions_sha256:sha(path.join(project,'.acceptance',acceptance,'scenarios.json')),...extra});
const sample=(id='S1',description='给定一段原文，保存后读取的文本与输入完全相同。')=>({id,title:'原文保存',description,priority:'P0',priority_reason:'丢失原文会破坏本次交付测试的依据。'});
const check=(text,scenes,ui=false)=>({obligations:[{quote:text,scene_ids:scenes.map(s=>s.id)}],
  ui_requirement:{required:ui,reason:ui?'涉及用户界面。':'仅校验文本保存逻辑，不涉及界面。'},
  scene_checks:scenes.map(s=>({scene_id:s.id,owner_quote:text,distinguishing_failure:'实现保存时修改了原文。',observable_result:'读取内容与冻结输入一致。',failure_impact:'核心原文保存失效。',ui_visual_expectation:ui?'按钮和内容可见、可读且无遮挡':''}))});
const submission=(text,scenes)=>({scenarios:scenes,change_summary:['依据冻结原文形成测试点。'],selfcheck:check(text,scenes)});
const conclude=(spec,value)=>{try{return finalize(spec,JSON.stringify(value));}catch(error){fail(spec,error.message);throw error;}};
let spec,designed,initialInput;
h.test('SCENARIO-01','只为选定需求准备设计输入，但提供全部冻结需求与上下文',()=>{
  initialInput=input('design-r1');spec=prepare(initialInput);
  const frozen=read(path.join(spec.folder,'request.frozen.json'));
  assert.deepEqual(frozen.requirements.items.map(r=>r.id),['R1','R2']);assert.equal(frozen.target_requirement_id,'R1');
  assert.ok(spec.prompt.includes('保存输入时保留完整原文。'));assert.ok(spec.prompt.includes('读取时返回已保存原文。'));
  return {input:initialInput,protocol_fixture:true};
});
h.test('SCENARIO-02','真实结构门禁接收协议夹具，产出候选定义并停止，不伪造独立复审',()=>{
  const before=sha(latest),scene=sample();designed=conclude(spec,submission('保存输入时保留完整原文。',[scene]));
  assert.equal(designed.status,'designed');assert.equal(designed.adopted,false);assert.equal(designed.semantic_review,'not_independent');
  assert.equal(sha(latest),before);assert.equal(designed.scenarios,1);
  const candidate=read(designed.candidate_definitions.path);assert.equal(candidate.scenarios[0].id,'S1');assert.equal(candidate.requirements.length,2);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));
  h.save('protocol-fixture-result.json',designed);return {output:designed,model_execution:false};
});
h.test('SCENARIO-03','宿主可通过已生成的冻结消息采用设计，不需要手工重建定义',()=>{
  const text=fs.readFileSync(designed.next_freeze_command,'utf8');assert.ok(text.startsWith('/acceptance-freeze '));
  const adopted=freezeAcceptance(JSON.parse(text.slice('/acceptance-freeze '.length)));
  assert.equal(adopted.counts.scenarios,1);assert.equal(read(latest).scenarios[0].id,'S1');
  assert.equal(read(latest).requirements[1].id,'R2');
});
h.test('SCENARIO-04','完成请求重入只返回可核验设计，不重复调用角色或改写文件',()=>{
  const before=snapshot(root),again=prepare(initialInput);assert.equal(again.completed.status,'already_designed');assert.deepEqual(snapshot(root),before);
});
h.test('SCENARIO-05','已有场景不能用 create 覆盖，过期定义也不能开始新设计',()=>{
  const before=sha(latest);assert.throws(()=>prepare(input('create-again')),/use edit mode/);
  assert.throws(()=>prepare({...input('stale'),definitions_sha256:'0'.repeat(64)}),/definitions changed/);
  assert.equal(sha(latest),before);
});
let edit,editInput,keep;
h.test('SCENARIO-06','edit 使用当前人工场景作为基线，同时提供需求变更前快照',()=>{
  const prior=read(latest),previous={path:path.join(root,'.acceptance',at,prior.definition_record),sha256:sha(latest)};
  keep={id:'KEEP',requirement_id:'R1',title:'人工保留测试点',description:'给定带换行的原文，保存并读取时换行保持不变。',priority:'P1',priority_reason:'换行丢失会损坏格式。',origin:{kind:'human-designed',reference:'fixture:human-edit'},external_refs:[],check:{method:'human-adopted',basis:'用户保留此测试点。'}};
  freeze('change-and-human-edit',{requirements:[req('R1','保存输入时保留完整原文；空输入应被拒绝。')],scenarios:[keep]});
  keep=read(latest).scenarios.find(s=>s.id==='KEEP');
  editInput=input('edit-r1','R1',{mode:'edit',previous_definitions:previous});edit=prepare(editInput);
  const value=read(path.join(edit.folder,'request.frozen.json'));assert.equal(value.existing_scenarios.length,2);assert.equal(value.previous_target.text,'保存输入时保留完整原文。');
  assert.deepEqual(value.existing_scenarios.find(s=>s.id==='KEEP'),keep);
});
h.test('SCENARIO-07','差量编辑只新增必要场景，人工未改内容、ID 和来源保持不变',()=>{
  const frozen=read(path.join(edit.folder,'request.frozen.json'));
  const old=frozen.existing_scenarios.find(s=>s.id==='S1'),added=sample('EMPTY','给定空输入，保存时明确拒绝而不写入。');
  const scenes=[...frozen.existing_scenarios,added];
  const selfcheck=check('保存输入时保留完整原文',scenes);
  selfcheck.obligations.push({quote:'空输入应被拒绝',scene_ids:['EMPTY']});
  const answer={base_sha256:frozen.scenario_base_sha256,upsert:[added],remove_ids:[],change_reasons:{EMPTY:'需求明确新增空输入拒绝义务。'},change_summary:['新增空输入测试，保留已有人工场景。'],selfcheck};
  const result=conclude(edit,answer),candidate=read(result.candidate_definitions.path);
  assert.deepEqual(candidate.scenarios.find(s=>s.id==='KEEP'),keep);assert.equal(candidate.scenarios.length,3);
  const adopted=freezeAcceptance(JSON.parse(fs.readFileSync(result.next_freeze_command,'utf8').slice('/acceptance-freeze '.length)));
  assert.equal(read(latest).scenarios.find(s=>s.id==='KEEP').version,keep.version);assert.equal(adopted.counts.scenarios,3);
});
h.test('SCENARIO-08','角色输出缺少有效自检时拒绝，保留原回答和失败证据，不改冻结定义',()=>{
  const before=sha(latest),broken=prepare(input('invalid-check','R2'));
  assert.throws(()=>conclude(broken,{scenarios:[sample('R2-test')],change_summary:['协议负例，无自检。']}),/self-check|gate failed/);
  assert.equal(sha(latest),before);assert.ok(fs.existsSync(path.join(broken.folder,'answer.txt')));assert.ok(fs.existsSync(path.join(broken.folder,'failure.json')));
});
h.test('SCENARIO-09','活动尝试不能被另一调用抢占；当前 AT 不匹配时不调用角色',()=>{
  const req=input('active-attempt','R2'),active=prepare(req);assert.throws(()=>prepare(req),/active\/uncertain owner/);fail(active,'结束协议夹具中的人工占用。');
  assert.throws(()=>prepare({...input('wrong-at','R2'),acceptance_id:'AT-other'}),/current acceptance mismatch/);
});
h.test('SCENARIO-10','UI 判据须在场景正文与自检中相同绑定',()=>{
  freeze('ui-requirement',{requirements:[req('R-UI','保存按钮与内容应可见可读且无遮挡。')]});
  const prepared=prepare(input('ui-design','R-UI')),scene=sample('UI1','进入保存页面时，按钮和内容可见、可读且无遮挡。');
  const selfcheck=check('保存按钮与内容应可见可读且无遮挡。',[scene],true);
  const result=conclude(prepared,{scenarios:[scene],change_summary:['保留真实视觉义务。'],selfcheck});
  assert.equal(read(result.candidate_definitions.path).scenarios.find(s=>s.id==='UI1').ui_acceptance.visual_expectation,'按钮和内容可见、可读且无遮挡');
});
h.test('SCENARIO-11','许可条款没有单一必达行为时可保留说明，不虚构场景或通过结论',()=>{
  freeze('optional-requirement',{requirements:[req('R-OPTION','可以显示 A，也可以显示 B。')]});
  const prepared=prepare(input('optional-design','R-OPTION'));
  const result=conclude(prepared,{scenarios:[],change_summary:['许可条款本身没有单一必达结果。'],selfcheck:{obligations:[{quote:'可以显示 A，也可以显示 B。',scene_ids:[],not_required_reason:'原文明确允许两个不同结果。'}],scene_checks:[],ui_requirement:{required:false,reason:'只检查许可条款，不执行界面。'}}});
  assert.equal(result.scenarios,0);assert.equal(result.uncovered_obligations,0);assert.equal(result.status,'designed');
});
h.test('SCENARIO-12','已完成设计的证据被修改时拒绝重入，不能据旧状态跳过校验',()=>{
  fs.appendFileSync(path.join(spec.folder,'terminal.json'),' ');assert.throws(()=>prepare(initialInput),/artifact changed/);
});
h.test('SCENARIO-RAW-01','失败后的原始回答被编辑时拒绝恢复，不能手改模型输出冒充通过',()=>{
  const req=input('raw-answer-integrity','R2'),attempt=prepare(req);
  assert.throws(()=>{try{finalize(attempt,'{invalid-json');}catch(error){fail(attempt,error.message);throw error;}});
  fs.writeFileSync(path.join(attempt.folder,'answer.txt'),JSON.stringify(submission('读取时返回已保存原文。',[sample('fake-corrected')]))+'\n');
  assert.throws(()=>prepare(req),/original answer.*changed/);
});

if(h.live){
  const liveRoot=h.project('live-git-project'),liveAt='AT-live-scenarios';
  h.run('init-live-git','git',['init','-q',liveRoot]);h.run('live-empty-commit','git',['-C',liveRoot,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);
  makeProject(liveRoot,liveAt);
  freeze('live-original',{context:{business_goal:'只为指定需求设计场景，不运行产品测试。'},requirements:[req('R-live','保存文本后再次读取，应与输入逐字相同。'),req('R-other','删除操作需要确认。')]},liveRoot,liveAt);
  h.test('SCENARIO-13','真实官方 CLI 绑定 Designer 角色，调用实际模型并通过场景门禁后停止',()=>{
    const original=sha(path.join(liveRoot,'.acceptance',liveAt,'scenarios.json'));
    const req=input('live-design','R-live',{},liveRoot,liveAt);h.save('live-input.json',req);
    const result=h.cli('acceptance-scenarios',req,'live-design',liveRoot);h.settled(result,'acceptance-scenarios','done');
    const folder=path.join(liveRoot,'.acceptance-local',liveAt,'workflows/scenarios/live-design'),receipt=read(path.join(folder,'result.json'));
    assert.equal(receipt.status,'designed');assert.ok(receipt.scenarios>0);assert.equal(receipt.adopted,false);
    assert.equal(sha(path.join(liveRoot,'.acceptance',liveAt,'scenarios.json')),original);
    const calls=result.traces.filter(t=>t.type==='player.call.started');assert.equal(calls.length,1);assert.equal(calls[0].payload.roleId??calls[0].payload.role,'designer');
    h.save('live-result.json',receipt);h.save('live-after.json',snapshot(liveRoot));
    return {output:result.envelope,receipt,player_calls:calls.length,actual_model:'gpt-6.1-sol'};
  });
  h.test('SCENARIO-14','真实 CLI 对已完成设计不再调用角色，并可单独采用候选定义',()=>{
    const req=read(path.join(h.output,'live-input.json')),again=h.cli('acceptance-scenarios',req,'live-design-repeat',liveRoot);h.settled(again,'acceptance-scenarios','done');
    assert.equal(again.traces.filter(t=>t.type==='player.call.started').length,0);
    const receipt=read(path.join(h.output,'live-result.json')),text=fs.readFileSync(receipt.next_freeze_command,'utf8');
    const adopted=h.cli('acceptance-freeze',JSON.parse(text.slice('/acceptance-freeze '.length)),'live-adopt-design',liveRoot);h.settled(adopted,'acceptance-freeze','frozen');
    assert.ok(read(path.join(liveRoot,'.acceptance',liveAt,'scenarios.json')).scenarios.length>0);
    assert.ok(!fs.existsSync(path.join(liveRoot,'.acceptance-local',liveAt,'workspace')));
    return {repeat:again.envelope,adoption:adopted.envelope};
  });
}
h.finish(['workflows/shared/readonly-agent.mjs','workflows/scenarios/stage.mjs','workflows/scenarios/registry.mjs','tests/acceptance_scenarios.integration.mjs']);
