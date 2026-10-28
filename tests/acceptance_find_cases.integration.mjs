import {AcceptanceView} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/view/data.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize,fail} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/find-cases/stage.mjs';
import {prepare as assessPrepare,finalize as assessFinalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/assess-cases/stage.mjs';
import {harness,read,sha,snapshot,skill} from './official_workflow_harness.mjs';

const h=harness('acceptance-find-cases',[['acceptance-find-cases','find-cases',{finder:'acceptance.finder'}],['acceptance-assess-cases','assess-cases',{evaluator:'acceptance.evaluator'}]]);
const description='余额不足时拒绝扣款，账户余额保持不变。';
const source=`import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pay } from '../pay.mjs';
fs.writeFileSync('BUSINESS_TEST_WAS_RUN','unexpected');

test('拒绝余额不足的扣款', () => {
  const account = { balance: 4 };
  assert.equal(pay(account, 5), false);
  assert.equal(account.balance, 4);
});

test('余额不足时保持余额不变（标题诱饵）', () => {
  assert.equal(typeof pay, 'function');
});

test.skip('余额不足扣款的待启用回归', () => {
  const account = { balance: 2 };
  assert.equal(pay(account, 3), false);
  assert.equal(account.balance, 2);
});
`;
function fixture(label){
  const root=h.project(label),at='AT-'+label;fs.mkdirSync(path.join(root,'test'));
  fs.writeFileSync(path.join(root,'test/pay.test.mjs'),source);fs.writeFileSync(path.join(root,'pay.mjs'),'export function pay(account, amount) { if (account.balance < amount) return false; account.balance -= amount; return true; }\n');
  h.run(label+'-init','git',['init','-q',root]);h.run(label+'-add','git',['-C',root,'add','.']);h.run(label+'-commit','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','static finder fixture']);
  const revision=h.run(label+'-revision','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
  createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'只查找并关联已有测试，不执行、不生成。'});
  freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'用户提供两个独立场景以检查关联保留。',definitions:{context:{business_goal:'找到验证余额不足拒绝扣款的真实测试。'},scenarios:['S1','S2'].map(id=>({id,title:id==='S1'?'余额不足拒绝扣款':'另一独立场景',description,priority:'P0',priority_reason:'防止错误扣款。',origin:{kind:'user-statement',reference:'fixture:user#'+id},external_refs:[],check:{method:'adopted',basis:'用户实际提供场景。'}}))}});
  return {root,at,revision};
}
const f=fixture('find-protocol'),latest=x=>path.join(x.root,'.acceptance',x.at,'scenarios.json');
const input=(id,extra={},x=f)=>({project_root:x.root,acceptance_id:x.at,request_id:id,definitions_sha256:sha(latest(x)),scene_id:'S1',source_checkout:x.root,revision:x.revision,test_roots:['test'],inspection_files:['test/pay.test.mjs','pay.mjs'],...extra});
// Protocol fixture, distinct from the live semantic finder below.
const answer=()=>({status:'not_executed',test_files:['test/pay.test.mjs'],test_command:[],test_env:{},observations:[],evidence_paths:[],limitations:['静态关联，未运行测试。'],reason:'实际断言关联当前场景。',case_descriptions:[{id:'C1',name:'余额不足时拒绝扣款并保持余额',method:'余额4、扣款5，调用pay。',assertions:'断言返回false且余额仍为4。',boundary:'直接调用同步业务函数；不验证UI或持久化。',source:{origin:'existing',file:'test/pay.test.mjs',title:'拒绝余额不足的扣款',line_start:7,line_end:11,id_comment:'// {id}'}}],
  case_discovery:{schema:'existing-case-discovery-v1',summary:'找到直接验证拒绝与余额保持的实际用例，未执行。',search_scope:[{path:'test/pay.test.mjs',kind:'tests',summary:'阅读提供的完整已有测试及断言。'},{path:'pay.mjs',kind:'source',summary:'核对被调用函数及同步返回语义。'}],obligations:[{id:'O1',quote:description,status:'found',case_ids:['C1'],reason:'同一次调用同时断言拒绝和余额保持。'}],associations:[{case_id:'C1',obligation_ids:['O1'],contribution:'直接验证余额不足时不扣款。',availability:'active',availability_note:'',evidence_ids:['E1']}],excluded_candidates:[{file:'test/pay.test.mjs',title:'余额不足时保持余额不变（标题诱饵）',reason:'仅断言函数类型，没有验证扣款行为。',evidence_ids:['E2']}],limitations:['仅检索本次提供文件，其他目录未查。'],evidence:[{id:'E1',file:'test/pay.test.mjs',line_start:7,line_end:11,quote:source.split('\n').slice(6,11).join('\n')},{id:'E2',file:'test/pay.test.mjs',line_start:13,line_end:15,quote:source.split('\n').slice(12,15).join('\n')}]}});
const conclude=(spec,value)=>{try{return finalize(spec,JSON.stringify(value));}catch(e){fail(spec,e.message);throw e;}};
let req,spec,result,finalAnswer;
h.test('FIND-01','物化当前独立场景及实际测试/必要实现，不创建调试入口',()=>{
  req=input('first');spec=prepare(req);assert.equal(spec.data.request.scene.description,description);assert.equal(spec.data.request.requirement,null);assert.ok(spec.prompt.includes('标题诱饵'));
});
h.test('FIND-02','通过原查找门禁后宿主仅补 ID 注释，建立未执行的静态关联',()=>{
  const original=sha(path.join(f.root,'test/pay.test.mjs')),definitions=sha(latest(f));result=conclude(spec,answer());assert.equal(result.status,'not_executed');assert.equal(result.case_count,1);
  finalAnswer=read(result.case_answer.path);const id=finalAnswer.case_descriptions[0].id;assert.match(id,/^TC-[0-9a-f-]{36}$/);const workspace=spec.data.request.project_root;
  assert.equal(fs.readFileSync(path.join(workspace,'test/pay.test.mjs'),'utf8').replace(/^\/\/ @case-id: TC-[0-9a-f-]+\n/gm,''),source);
  assert.equal(sha(path.join(f.root,'test/pay.test.mjs')),original);assert.equal(sha(latest(f)),definitions);assert.deepEqual(finalAnswer.observations,[]);assert.deepEqual(finalAnswer.evidence_paths,[]);
  assert.ok(!fs.existsSync(path.join(workspace,'BUSINESS_TEST_WAS_RUN')));assert.ok(read(path.join(f.root,'.acceptance/case-identities.json')).cases[id]);
  const mapping=read(result.shared_mapping);assert.deepEqual(mapping.scene_mappings[0].test_ids,[id]);h.save('protocol-result.json',result);h.save('protocol-final-answer.json',finalAnswer);
});
h.test('FIND-03','同请求重入不分配新 ID、不调用角色、不改任何文件',()=>{
  const before=snapshot(f.root),again=prepare(req);assert.equal(again.completed.status,'not_executed');assert.equal(again.completed.source_inputs_match_current,true);assert.deepEqual(snapshot(f.root),before);
});
h.test('FIND-04','当前视图显示真实静态关联，但不计入执行、通过或覆盖率',()=>{
 const view=new AcceptanceView(f.root,f.at).snapshot(f.at),trace=view.project_state.traces.find(t=>t.scenarios[0].id==='S1'),group=trace.case_presentations.S1;
 assert.equal(group.cases[0].source.verification,'matches');assert.equal(group.definition_verification,'matches');assert.equal(trace.execution_known,false);assert.equal(view.statistics.executed,0);assert.equal(view.statistics.passed,0);assert.equal(trace.coverage.status,'unavailable');
});
h.test('FIND-05','关联输出可直接交给独立评估，不伪造已执行状态',()=>{
  const assessment=read(path.join(spec.folder,'assessment-request.json')),prepared=assessPrepare(assessment);assert.equal(prepared.data.frozen.context.cases.length,1);
  const invalid=assessFinalize(prepared,'not-json');assert.equal(invalid.status,'unavailable');assert.equal(invalid.product_judgment,'not_performed');assert.equal(finalAnswer.status,'not_executed');
});
h.test('FIND-06','源码变化使历史结果失效而保留原记录',()=>{
  const file=path.join(spec.data.request.project_root,'pay.mjs'),raw=fs.readFileSync(file),old=sha(result.case_answer.path);fs.appendFileSync(file,'// newer code\n');const stale=prepare(req).completed;assert.equal(stale.status,'stale');assert.equal(sha(result.case_answer.path),old);fs.writeFileSync(file,raw);
});
h.test('FIND-07','伪造引文、不一致关联、未读范围或虚假执行回答均拒绝',()=>{
  for(const kind of ['quote','association','scope','execution']){
    const attempt=prepare(input('bad-'+kind)),value=answer(),lines=fs.readFileSync(path.join(attempt.data.request.project_root,'test/pay.test.mjs'),'utf8').split('\n');
    // Rebase this negative protocol candidate to the actual ID-commented source.
    value.case_descriptions[0].source.line_start=8;value.case_descriptions[0].source.line_end=12;
    value.case_discovery.evidence[0]={...value.case_discovery.evidence[0],line_start:8,line_end:12,quote:lines.slice(7,12).join('\n')};value.case_discovery.evidence[1]={...value.case_discovery.evidence[1],line_start:14,line_end:16,quote:lines.slice(13,16).join('\n')};
    if(kind==='quote')value.case_discovery.evidence[0].quote='invented source';if(kind==='association')value.case_discovery.associations[0].obligation_ids=[];
    if(kind==='scope')value.case_discovery.search_scope[0].path='.';if(kind==='execution')value.observations=['claimed execution'];
    const before=sha(path.join(attempt.data.request.project_root,'test/pay.test.mjs'));assert.throws(()=>conclude(attempt,value),/查找用例|actually handed-off/);assert.equal(sha(path.join(attempt.data.request.project_root,'test/pay.test.mjs')),before);
  }
});
h.test('FIND-08','无安全注释位置时不写 ID、不发布关联',()=>{
  const x=fixture('find-no-comment'),attempt=prepare(input('missing-comment',{},x)),value=answer();delete value.case_descriptions[0].source.id_comment;
  assert.throws(()=>conclude(attempt,value),/id_comment/);assert.equal(fs.readFileSync(path.join(attempt.data.request.project_root,'test/pay.test.mjs'),'utf8'),source);assert.ok(!fs.existsSync(path.join(x.root,'.acceptance',x.at,'tests.json')));
});
h.test('FIND-09','现有其他协议的正式测试清单不被静态查找覆盖',()=>{
  const x=fixture('find-other-catalog'),file=path.join(x.root,'.acceptance',x.at,'tests.json');fs.writeFileSync(file,JSON.stringify({schema:'formal-test-catalog-v1',items:[]}));const before=sha(file);assert.throws(()=>prepare(input('refuse-overwrite',{},x)),/another protocol/);assert.equal(sha(file),before);
});
h.test('FIND-13','同一实际声明关联另一场景复用永久 ID，并保留原场景关联',()=>{
  const attempt=prepare(input('second-scene',{scene_id:'S2'})),value=answer(),lines=fs.readFileSync(path.join(attempt.data.request.project_root,'test/pay.test.mjs'),'utf8').split('\n');
  value.case_descriptions[0].source.line_start=8;value.case_descriptions[0].source.line_end=12;
  value.case_discovery.evidence[0]={...value.case_discovery.evidence[0],line_start:8,line_end:12,quote:lines.slice(7,12).join('\n')};value.case_discovery.evidence[1]={...value.case_discovery.evidence[1],line_start:14,line_end:16,quote:lines.slice(13,16).join('\n')};
  const before=sha(path.join(attempt.data.request.project_root,'test/pay.test.mjs')),other=conclude(attempt,value),actual=read(other.case_answer.path),mapping=read(other.shared_mapping);
  assert.equal(actual.case_descriptions[0].id,finalAnswer.case_descriptions[0].id);assert.equal(sha(path.join(attempt.data.request.project_root,'test/pay.test.mjs')),before);assert.equal(mapping.scene_mappings.length,2);assert.equal(mapping.tests.length,1);
});
h.test('FIND-14','静态查找无关联可保存空映射及限制，不能制造执行状态',()=>{
  const x=fixture('find-empty'),attempt=prepare(input('empty',{},x)),value=answer();value.case_descriptions=[];value.test_files=[];
  value.case_discovery.obligations=[{id:'O1',quote:description,status:'not_found',case_ids:[],reason:'协议负向夹具明确提供空关联，不代表语义评估。'}];value.case_discovery.associations=[];value.case_discovery.excluded_candidates=[];value.case_discovery.evidence=[];
  const empty=conclude(attempt,value);assert.equal(empty.case_count,0);assert.equal(empty.status,'not_executed');assert.deepEqual(read(empty.shared_mapping).scene_mappings[0].test_ids,[]);
});
h.test('FIND-15','场景约定变化时旧视图明确提示关联需重核，不继续冒充当前关联',()=>{
  const scene=read(latest(f)).scenarios.find(s=>s.id==='S1');
  freezeAcceptance({project_root:f.root,acceptance_id:f.at,request_id:'change-scene',base_definitions_sha256:sha(latest(f)),basis:'用户增加拒绝扣款时必须返回错误码的要求。',definitions:{scenarios:[{...scene,description:description+'同时返回余额不足的错误码。'}]}});
  const traces=new AcceptanceView(f.root,f.at).snapshot(f.at).project_state.traces;
  const group=id=>traces.find(t=>t.scenarios[0].id===id).case_presentations[id];assert.equal(group('S1').definition_verification,'changed');assert.match(group('S1').search_limitations,/需重新确认/);assert.equal(group('S2').definition_verification,'matches');
});
if(h.live){
  const x=fixture('live-find');
  h.test('FIND-10','真实官方 Finder 基于断言选用例，排除标题诱饵并标明跳过项，宿主只补 ID',()=>{
    const request=input('live-find',{},x),original=sha(path.join(x.root,'test/pay.test.mjs')),response=h.cli('acceptance-find-cases',request,'live-find',x.root);h.settled(response,'acceptance-find-cases','done');
    const value=read(path.join(x.root,'.acceptance-local',x.at,'workflows/find-cases/live-find/result.json')),answer=read(value.case_answer.path);
    assert.equal(value.status,'not_executed');assert.ok(answer.case_descriptions.some(c=>c.source.title==='拒绝余额不足的扣款'));assert.ok(!answer.case_descriptions.some(c=>c.source.title.includes('标题诱饵')));
    for(const item of answer.case_discovery.associations){const c=answer.case_descriptions.find(c=>c.id===item.case_id);if(c.source.title.includes('待启用'))assert.equal(item.availability,'skipped');}
    assert.equal(sha(path.join(x.root,'test/pay.test.mjs')),original);assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,1);assert.deepEqual(answer.observations,[]);
    const workspace=path.join(x.root,'.acceptance-local',x.at,'workspace');assert.ok(!fs.existsSync(path.join(workspace,'BUSINESS_TEST_WAS_RUN')));assert.equal(fs.readFileSync(path.join(workspace,'test/pay.test.mjs'),'utf8').replace(/^\/\/ @case-id: TC-[0-9a-f-]+\n/gm,''),source);
    h.save('live-input.json',request);h.save('live-result.json',value);h.save('live-answer.json',answer);return {output:response.envelope};
  });
  h.test('FIND-11','真实 CLI 重入不重复查找或改写 ID',()=>{
    const before=snapshot(x.root),response=h.cli('acceptance-find-cases',read(path.join(h.output,'live-input.json')),'live-find-repeat',x.root);h.settled(response,'acceptance-find-cases','done');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);assert.deepEqual(snapshot(x.root),before);
  });
  h.test('FIND-12','真实官方 CLI 查找后独立 Evaluator 可消费最终 ID 和引用，两个角色会话独立',()=>{
    const request=read(path.join(x.root,'.acceptance-local',x.at,'workflows/find-cases/live-find/assessment-request.json')),response=h.cli('acceptance-assess-cases',request,'live-find-evaluate',x.root);
    h.settled(response,'acceptance-assess-cases','done');const value=read(path.join(x.root,'.acceptance-local',x.at,'workflows/case-assessment/'+request.request_id+'/result.json'));assert.equal(value.status,'available');assert.equal(value.product_judgment,'not_performed');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,1);h.save('live-assessment.json',read(value.report.path));return {output:response.envelope};
  });
}
h.finish(['workflows/find-cases/stage.mjs','workflows/find-cases/registry.mjs','tests/acceptance_find_cases.integration.mjs']);
