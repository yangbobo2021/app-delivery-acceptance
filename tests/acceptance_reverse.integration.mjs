import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize,fail} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/reverse/stage.mjs';
import {reverseArtifactReady,executableReverseRules} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/reverse/artifact.mjs';
import {harness,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-reverse',[['acceptance-reverse','reverse',{analyst:'acceptance.reverse-analyst'}]]),root=h.project('git-project'),at='AT-reverse';
const write=(name,text)=>fs.writeFileSync(path.join(root,name),text);
write('allow.mjs','export function allow(amount) { return amount < 5; }\n');write('retry.mjs','export const retryLimit = 3;\n');write('balance.mjs','export function balance(account) { return 100; }\n');write('contract.md','独立额度合同：额度不超过 5 时允许扣款，超过 5 时拒绝。\n');write('README.md','Reverse fixture.\n');
h.run('git-init','git',['init','-q',root]);h.run('add-base','git',['-C',root,'add','.']);h.run('commit-base','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base contract']);
const base=h.run('read-base','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
write('allow.mjs','export function allow(amount) { return amount <= 5; }\n');write('retry.mjs','export const retryLimit = 4;\n');write('balance.mjs','export function balance(account) { return account.balance; }\n');write('README.md','Reverse fixture, documentation updated.\n');
h.run('add-head','git',['-C',root,'add','.']);h.run('commit-head','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','observable changes']);
const head=h.run('read-head','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'仅逆向已提交的变更，不生成场景或执行测试。'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'用户提供余额需求和已提交代码的独立合同。',definitions:{context:{business_goal:'识别提交的重要直接变化及缺少的判据。'},requirements:[{id:'R1',text:'查询余额时返回该账户的实际余额。',origin:{kind:'user-statement',reference:'fixture:user#balance'},external_refs:[]}]}});
const latest=path.join(root,'.acceptance',at,'scenarios.json');
const input=(id,extra={})=>({project_root:root,acceptance_id:at,request_id:id,definitions_sha256:sha(latest),base_revision:base,head_revision:head,
  source_paths:['allow.mjs','retry.mjs','balance.mjs'],test_paths:[],noncode_paths:['README.md'],contract_files:['contract.md'],context_files:[],pr_requirement_ids:['R1'],test_modes:['WHITE_BOX'],...extra});
const answer=spec=>({base_revision:base,head_revision:head,change_sha256:sha(path.join(spec.folder,'change.json')),
  behavior_impacts:[{id:'B1',description:'等于额度 5 时允许扣款。',code_paths:['allow.mjs'],coverage:'new_rule',target_ids:['WR-allow'],reason:'比较符由 < 改为 <=，改变合法边界结果。'},
    {id:'B2',description:'重试次数由 3 改为 4，是否为预期策略需确认。',code_paths:['retry.mjs'],coverage:'unresolved',target_ids:['WR-retry'],reason:'常量变化影响重试次数，但没有独立合同。'},
    {id:'B3',description:'返回当前账户实际余额而非固定 100。',code_paths:['balance.mjs'],coverage:'requirement',target_ids:['R1'],reason:'该行为已被原余额需求覆盖。'}],
  impacts:[{requirement_id:'R1',reason:'查询结果由固定值改为账户余额。'}],reverse_rules:[
    {id:'WR-allow',title:'额度合法边界',text:'额度不超过 5 时允许扣款，超过 5 时拒绝。',status:'supported',rationale:'边界变更影响扣款允许结果。',basis_kind:'contract',basis:'未在本次提交修改的独立额度合同。',contract_source:'contract.md',contract_quote:'额度不超过 5 时允许扣款，超过 5 时拒绝。',related_requirement_ids:[],changed_paths:['allow.mjs'],question:''},
    {id:'WR-retry',title:'重试次数策略',text:'当前实现将重试次数设为 4；正确次数尚无独立判据。',status:'needs_confirmation',rationale:'常量由 3 改为 4。',basis_kind:'candidate',basis:'仅观察到实现变化，缺少独立要求。',contract_source:'',contract_quote:'',related_requirement_ids:[],changed_paths:['retry.mjs'],question:'本次应采用 3 次还是 4 次重试？'}]});
const conclude=(s,value)=>{try{return finalize(s,JSON.stringify(value));}catch(e){fail(s,e.message);throw e;}};
let req,spec,result;
h.test('REVERSE-01','冻结全部变更归属、真实 diff、原始需求、独立合同与完整源码',()=>{
  req=input('structural');spec=prepare(req);assert.equal(spec.data.change.changed_files.length,3);assert.equal(spec.data.change.inventory.files.length,4);
  assert.deepEqual(spec.data.request.requirements.items.map(x=>x.id),['R1']);assert.ok(spec.prompt.includes('account.balance'));assert.ok(spec.prompt.includes('retryLimit = 4'));
});
h.test('REVERSE-02','原门禁验证候选并停止，原需求不重复造规则、未确认项不可执行',()=>{
  const before=sha(latest),code=sha(path.join(root,'allow.mjs'));result=conclude(spec,answer(spec));assert.equal(result.status,'analyzed');assert.equal(result.adopted,false);
  const artifact=read(result.reverse_artifact.path);assert.ok(reverseArtifactReady(artifact,result.reverse_artifact.path));assert.deepEqual(executableReverseRules(artifact).map(r=>r.id),['WR-allow']);
  const candidate=read(result.candidate_definitions.path);assert.equal(candidate.requirements[0].text,'查询余额时返回该账户的实际余额。');assert.equal(candidate.reverse_rules.length,2);assert.equal(candidate.scenarios.length,0);
  assert.equal(sha(latest),before);assert.equal(sha(path.join(root,'allow.mjs')),code);assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));
});
h.test('REVERSE-03','同请求重复不改文件、不调用分析角色',()=>{
  const before=snapshot(root),again=prepare(req);assert.equal(again.completed.status,'analyzed');assert.equal(again.completed.source_inputs_match_current,true);assert.deepEqual(snapshot(root),before);
});
h.test('REVERSE-04','源码变化使历史候选失效但不覆写原结果',()=>{
  const file=path.join(root,'allow.mjs'),original=fs.readFileSync(file),old=sha(result.reverse_artifact.path);fs.appendFileSync(file,'// drift\n');const again=prepare(req).completed;assert.equal(again.status,'stale');assert.equal(again.source_inputs_match_current,false);assert.equal(sha(result.reverse_artifact.path),old);fs.writeFileSync(file,original);
});
h.test('REVERSE-05','变更路径未分类、产品路径遗漏和未提交代码拒绝启动角色',()=>{
  assert.throws(()=>prepare(input('unclassified',{noncode_paths:[]})),/unclassified changed paths/);
  assert.throws(()=>prepare(input('missing-product',{source_paths:['allow.mjs','balance.mjs']})),/unclassified changed paths/);
  const file=path.join(root,'retry.mjs'),raw=fs.readFileSync(file);fs.appendFileSync(file,'// dirty\n');assert.throws(()=>prepare(input('dirty')),/uncommitted content/);fs.writeFileSync(file,raw);
});
h.test('REVERSE-06','遗漏产品行为归属、错误合同引文或把候选当已确认均拒绝',()=>{
  for(const id of ['omit','quote','unsupported']){
    const attempt=prepare(input(id)),value=answer(attempt);
    if(id==='omit')value.behavior_impacts.pop();
    if(id==='quote')value.reverse_rules[0].contract_quote='不存在的合同原文';
    if(id==='unsupported'){value.reverse_rules[1].status='supported';value.behavior_impacts[1].coverage='new_rule';}
    assert.throws(()=>conclude(attempt,value),/reverse draft gate failed/);
  }
});
h.test('REVERSE-07','源文件或独立合同在角色执行期间变化时拒绝候选',()=>{
  for(const name of ['allow.mjs','contract.md']){
    const attempt=prepare(input('concurrent-'+name.replace('.','-'))),file=path.join(root,name),raw=fs.readFileSync(file);fs.appendFileSync(file,'\nchanged\n');
    assert.throws(()=>conclude(attempt,answer(attempt)),/source changed|contract drift/i);fs.writeFileSync(file,raw);
  }
});
h.test('REVERSE-08','采用候选是独立冻结步骤，待确认规则不能进入执行场景',()=>{
  const file=result.next_freeze_command,command=fs.readFileSync(file,'utf8'),frozen=freezeAcceptance(JSON.parse(command.slice('/acceptance-freeze '.length)));
  assert.equal(frozen.counts.reverse_rules,2);assert.equal(read(latest).scenarios.length,0);const stale=prepare(req).completed;assert.equal(stale.status,'stale');assert.equal(stale.source_definitions_match_current,false);
});
h.test('REVERSE-09','既有规则原文/状态/依据不可被模型重写',()=>{
  const attempt=prepare(input('existing-modified')),value=answer(attempt);value.reverse_rules[0].text='模型未经确认改写了原规则。';assert.throws(()=>conclude(attempt,value),/existing rule was rewritten/);
});
h.test('REVERSE-10','错误原始回答不能手工替换后恢复为角色产物',()=>{
  const request=input('bad-answer'),attempt=prepare(request);try{finalize(attempt,'invalid-json');}catch(e){fail(attempt,e.message);}
  fs.writeFileSync(path.join(attempt.folder,'answer.txt'),JSON.stringify(answer(attempt)));assert.throws(()=>prepare(request),/saved original answer is missing or changed/);
});
if(h.live){
  h.test('REVERSE-11','真实官方 CLI 以单次 Analyst 自查分析三类直接影响，无独立 Reviewer 或自动场景',()=>{
    const request=input('live-reverse'),before=sha(latest),response=h.cli('acceptance-reverse',request,'live-reverse',root);h.settled(response,'acceptance-reverse','done');
    const result=read(path.join(root,'.acceptance-local',at,'workflows/reverse/live-reverse/result.json')),artifact=read(result.reverse_artifact.path);
    assert.equal(result.status,'analyzed');assert.equal(artifact.draft.behavior_impacts.flatMap(x=>x.code_paths).filter((v,i,a)=>a.indexOf(v)===i).length,3);
    assert.ok(artifact.draft.impacts.some(x=>x.requirement_id==='R1'));assert.ok(artifact.draft.reverse_rules.some(r=>r.status==='needs_confirmation'&&r.code_sources.some(s=>s.path==='retry.mjs')));
    assert.equal(sha(latest),before);assert.equal(read(latest).scenarios.length,0);assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,1);assert.equal(result.review_kind,'internal_self_check');
    h.save('live-input.json',request);h.save('live-result.json',result);h.save('live-artifact.json',artifact);return {output:response.envelope};
  });
  h.test('REVERSE-12','真实 CLI 重入不重复调用分析角色',()=>{
    const request=read(path.join(h.output,'live-input.json')),before=snapshot(root),response=h.cli('acceptance-reverse',request,'live-reverse-repeat',root);h.settled(response,'acceptance-reverse','done');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);assert.deepEqual(snapshot(root),before);
  });
}
h.finish(['workflows/reverse/stage.mjs','workflows/reverse/registry.mjs','tests/acceptance_reverse.integration.mjs']);
