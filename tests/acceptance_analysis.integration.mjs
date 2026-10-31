import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize,fail} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/analyze/stage.mjs';
import {harness,skill,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-analysis',[['acceptance-analyze','analyze',{analyst:'acceptance.analyst'}]]);
const root=h.project('project'),at='AT-analysis';
const req=(id,text)=>({id,text,origin:{kind:'user-statement',reference:'fixture:user#'+id},external_refs:[]});
const setup=(root,at)=>{
  createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'先分析保存及读取需求，不要设计或执行。'});
  return freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'采用前向测试中提供的原始需求与用户范围。',definitions:{
    context:{business_goal:'对保存及读取要求做需求分析。',shared_constraints:'本轮验收不包括移动端界面。'},requirements:[req('R1','桌面端用户能够保存标题。'),req('R2','桌面端用户能够读取已保存标题列表。')]}});
};
setup(root,at);
const latest=path.join(root,'.acceptance',at,'scenarios.json');
const input=(id,extra={},project=root,acceptance=at)=>({project_root:project,acceptance_id:acceptance,request_id:id,definitions_sha256:sha(path.join(project,'.acceptance',acceptance,'scenarios.json')),...extra});
const answer=()=>({business_goal:'让桌面端用户保存标题并读回已保存列表。',confirmed_scope:{included_requirement_ids:['R1','R2'],exclusions:['移动端界面'],limitations:['运行环境尚未验证。']},
  requirement_groups:[{id:'G1',title:'标题保存读取闭环',requirement_ids:['R1','R2'],reason:'读取依赖已保存标题，两个需求组成用户闭环。'}],change_summary:['完整保留两条原始需求。']});
const conclude=(spec,value)=>{try{return finalize(spec,JSON.stringify(value));}catch(e){fail(spec,e.message);throw e;}};
let originalInput,spec,result;
h.test('ANALYSIS-01','从当前快照物化全部原始需求及真实排除约束',()=>{
  originalInput=input('analysis-once');spec=prepare(originalInput);
  const frozen=read(path.join(spec.folder,'request.frozen.json'));assert.equal(frozen.requirements.items.length,2);
  assert.equal(frozen.requirements.items[0].text,'桌面端用户能够保存标题。');assert.ok(spec.prompt.includes('本轮验收不包括移动端界面。'));
});
h.test('ANALYSIS-02','分析候选经原结构门禁后停止，不冻结、不生成场景或执行测试',()=>{
  const before=sha(latest);result=conclude(spec,answer());assert.equal(result.status,'analyzed');assert.equal(result.adopted,false);
  assert.equal(result.requirement_count,2);assert.equal(sha(latest),before);assert.deepEqual(read(latest).scenarios,[]);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));h.save('protocol-result.json',result);
});
h.test('ANALYSIS-03','分析候选可独立采用，同时保持原始需求与场景集合',()=>{
  const raw=fs.readFileSync(result.next_freeze_command,'utf8'),adopted=freezeAcceptance(JSON.parse(raw.slice('/acceptance-freeze '.length)));
  assert.equal(read(latest).context.business_goal,answer().business_goal);assert.equal(read(latest).requirements[0].text,'桌面端用户能够保存标题。');assert.equal(adopted.counts.scenarios,0);
});
h.test('ANALYSIS-04','重复请求和 JSON 对象键重排不再调用角色或改写文件',()=>{
  const before=snapshot(root),again=prepare(Object.fromEntries(Object.entries(originalInput).reverse()));
  assert.equal(again.completed.status,'analyzed');assert.equal(again.completed.reused,true);assert.deepEqual(snapshot(root),before);
});
h.test('ANALYSIS-05','遗漏需求或发明分组成员的回答被拒绝，原定义不变',()=>{
  for(const [id,value]of [['omit',{...answer(),confirmed_scope:{...answer().confirmed_scope,included_requirement_ids:['R1']}}],
    ['invent',{...answer(),requirement_groups:[{id:'G1',title:'bad',requirement_ids:['R1','R2','FAKE'],reason:'fixture negative'}]}]]){
    const before=sha(latest),attempt=prepare(input(id));assert.throws(()=>conclude(attempt,value),/structure gate failed/);assert.equal(sha(latest),before);
  }
});
h.test('ANALYSIS-06','edit 严格限制允许改变的顶层与范围字段',()=>{
  const req=input('edit-forbidden',{mode:'edit',previous_analysis:result.analysis,allowed_changes:['confirmed_scope'],allowed_scope_changes:['exclusions']});
  const attempt=prepare(req),value={...answer(),business_goal:'Unauthorized new goal'};
  assert.throws(()=>conclude(attempt,value),/unauthorized section change/);
  const other=prepare(input('edit-scope-forbidden',{...req,request_id:'edit-scope-forbidden'}));
  assert.throws(()=>conclude(other,{...answer(),confirmed_scope:{...answer().confirmed_scope,limitations:['changed']}}),/unauthorized scope field change/);
});
h.test('ANALYSIS-07','合法局部 edit 保留目标、组 ID 及未授权字段',()=>{
  const attempt=prepare(input('edit-allowed',{mode:'edit',previous_analysis:result.analysis,allowed_changes:['confirmed_scope'],allowed_scope_changes:['exclusions']}));
  const updated=conclude(attempt,{...answer(),confirmed_scope:{...answer().confirmed_scope,exclusions:['移动端界面（用户明确排除）']},change_summary:['只澄清已有排除项，不改变业务范围。']});
  const value=read(updated.analysis.path);assert.equal(value.business_goal,answer().business_goal);assert.equal(value.requirement_groups[0].id,'G1');assert.equal(value.version,2);
});
h.test('ANALYSIS-08','失败原答被手工修改后，不能作为旧角色结果恢复',()=>{
  const req=input('bad-answer'),attempt=prepare(req);assert.throws(()=>{try{finalize(attempt,'bad-json');}catch(e){fail(attempt,e.message);throw e;}});
  fs.writeFileSync(path.join(attempt.folder,'answer.txt'),JSON.stringify(answer()));assert.throws(()=>prepare(req),/original answer.*changed/);
});
h.test('ANALYSIS-09','当前 AT 错误及定义过期时不启动分析角色',()=>{
  assert.throws(()=>prepare({...input('wrong'),acceptance_id:'AT-other'}),/current acceptance mismatch/);
  assert.throws(()=>prepare({...input('stale'),definitions_sha256:'0'.repeat(64)}),/definitions changed/);
});
h.test('ANALYSIS-10','没有原始需求时明确跳过，不编造业务目标或分组',()=>{
  const project=h.project('standalone'),acceptance='AT-standalone';
  createAcceptance({project_root:project,acceptance_id:acceptance,request_id:'create',user_request:'仅采用提供的独立场景。'});
  freezeAcceptance({project_root:project,acceptance_id:acceptance,request_id:'freeze',base_definitions_sha256:null,basis:'用户明确采用独立场景，不补造需求。',definitions:{context:{business_goal:'仅核验提供的独立约定。'},scenarios:[{id:'S1',title:'独立约定',description:'读取已有对象时原文保持相同。',priority:'P1',priority_reason:'读取内容变化会损坏对象。',origin:{kind:'user-statement',reference:'fixture:standalone'},external_refs:[],check:{method:'adopted',basis:'实际用户约定。'}}]}});
  const skipped=prepare(input('analyze-empty',{},project,acceptance));assert.equal(skipped.completed.status,'not_required');assert.ok(!fs.existsSync(path.join(project,'.acceptance-local',acceptance,'workflows/analysis/analyze-empty/analysis.json')));
});

if(h.live){
  const project=h.project('live-git'),acceptance='AT-live-analysis';h.run('git-init','git',['init','-q',project]);h.run('git-initial','git',['-C',project,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);setup(project,acceptance);
  let liveResult;
  h.test('ANALYSIS-11','真实官方 CLI 调用 Analyst，完整纳入需求且不把阶段限制当业务排除',()=>{
    const req=input('live-analysis',{},project,acceptance),latest=path.join(project,'.acceptance',acceptance,'scenarios.json'),before=sha(latest);
    const response=h.cli('acceptance-analyze',req,'live-analysis',project);h.settled(response,'acceptance-analyze','done');
    liveResult=read(path.join(project,'.acceptance-local',acceptance,'workflows/analysis/live-analysis/result.json'));const value=read(liveResult.analysis.path);
    assert.deepEqual([...value.confirmed_scope.included_requirement_ids].sort(),['R1','R2']);assert.ok(value.confirmed_scope.exclusions.some(x=>x.includes('移动')));
    assert.ok(!value.confirmed_scope.exclusions.some(x=>/不执行测试|不生成场景|禁止调用工具/.test(x)));assert.equal(sha(latest),before);
    assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,1);h.save('live-input.json',req);h.save('live-result.json',liveResult);h.save('live-analysis.json',value);return {output:response.envelope};
  });
  h.test('ANALYSIS-12','真实 CLI 重入完成分析不再调用 Analyst',()=>{
    const req=read(path.join(h.output,'live-input.json')),before=snapshot(project),again=h.cli('acceptance-analyze',req,'live-analysis-repeat',project);h.settled(again,'acceptance-analyze','done');
    assert.equal(again.traces.filter(t=>t.type==='player.call.started').length,0);assert.deepEqual(snapshot(project),before);
  });
  h.test('ANALYSIS-13','真实 CLI 在没有原始需求时明确跳过，不调用 Analyst 或声称完成分析',()=>{
    const empty=h.project('live-standalone'),identity='AT-live-empty';
    h.run('init-empty-git','git',['init','-q',empty]);h.run('commit-empty-git','git',['-C',empty,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);
    createAcceptance({project_root:empty,acceptance_id:identity,request_id:'create',user_request:'只采用提供的独立场景，没有原始需求。'});
    freezeAcceptance({project_root:empty,acceptance_id:identity,request_id:'freeze',base_definitions_sha256:null,basis:'实际前向夹具只包含独立场景。',definitions:{context:{business_goal:'验收提供的独立约定。'},scenarios:[{id:'S-only',title:'独立约定',description:'读取对象时原文相同。',priority:'P1',priority_reason:'原文损坏会影响读取。',origin:{kind:'user-statement',reference:'fixture:standalone'},external_refs:[],check:{method:'adopted',basis:'用户提供的实际约定。'}}]}});
    const request=input('skip-analysis',{},empty,identity),response=h.cli('acceptance-analyze',request,'live-analysis-skip',empty);
    h.settled(response,'acceptance-analyze','skipped');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);
    assert.equal(read(path.join(empty,'.acceptance-local',identity,'workflows/analysis/skip-analysis/result.json')).status,'not_required');return {output:response.envelope};
  });
}
h.finish(['workflows/analyze/stage.mjs','workflows/analyze/registry.mjs','workflows/shared/artifacts.mjs','tests/acceptance_analysis.integration.mjs']);
