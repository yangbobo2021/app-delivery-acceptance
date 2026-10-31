import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/assess-cases/stage.mjs';
import {harness,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-case-assessment',[['acceptance-assess-cases','assess-cases',{evaluator:'acceptance.evaluator'}]]);
const description='额度不超过 5 时允许扣款，并在超过 5 时拒绝。';
const root=h.project('source'),at='AT-assessment';
fs.mkdirSync(path.join(root,'test'));
fs.writeFileSync(path.join(root,'allow.mjs'),'export function allow(amount) { return amount <= 5; }\n');
const testSource=`import assert from 'node:assert/strict';
import test from 'node:test';
import { allow } from '../allow.mjs';

// @case-id: TC-20cb4170-c6fd-4f3f-b4ef-96b273177c45
test('低于额度可以扣款', () => {
  assert.equal(allow(4), true);
});

// @case-id: TC-17b3e3f6-1963-47f2-ae50-cb86d7630373
test('超过额度不能扣款', () => {
  assert.equal(allow(6), false);
});
`;
const testFile=path.join(root,'test/allow.test.mjs');fs.writeFileSync(testFile,testSource);
h.run('init-source','git',['init','-q',root]);h.run('add-source','git',['-C',root,'add','allow.mjs','test']);
h.run('commit-source','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','actual assessment fixture']);
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'只评估提供的场景关联用例，不运行或修改测试。'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'用户提供独立额度场景与待评估实际用例。',definitions:{
  context:{business_goal:'核对额度规则的场景关联用例。'},scenarios:[{id:'S1',title:'额度判断',description,priority:'P0',priority_reason:'额度判断影响扣款。',origin:{kind:'user-statement',reference:'fixture:threshold'},external_refs:[],check:{method:'adopted',basis:'用户明确提供的场景原文。'}}]}});
const latest=path.join(root,'.acceptance',at,'scenarios.json');
const cases=()=>['TC-20cb4170-c6fd-4f3f-b4ef-96b273177c45','TC-17b3e3f6-1963-47f2-ae50-cb86d7630373'].map((id,n)=>({id,source:{file:'test/allow.test.mjs',file_sha256:sha(testFile),title:['低于额度可以扣款','超过额度不能扣款'][n],line_start:6+n*5,line_end:8+n*5}}));
const input=(id,extra={})=>({project_root:root,acceptance_id:at,request_id:id,definitions_sha256:sha(latest),scene_id:'S1',case_answer:{case_descriptions:cases()},supporting_files:[{file:'allow.mjs',sha256:sha(path.join(root,'allow.mjs'))}],...extra});
// Structural fixture only; semantic quality is tested separately using a real Evaluator.
const answer=()=>({schema:'case-evaluation-v2',summary:'现有 4 和 6 样本支持阈值两侧，缺少等于 5 的必要边界。',coverage:'partial',
  obligations:[{id:'O1',quote:'额度不超过 5 时允许扣款',status:'partial',assessment:'4 被允许，但合法等于 5 的情况未被断言。',evidence_ids:['E1']},{id:'O2',quote:'超过 5 时拒绝',status:'supported',assessment:'6 被拒绝。',evidence_ids:['E2']}],
  findings:[{id:'F1',kind:'gap',obligation_ids:['O1'],statement:'缺少等于 5 的合法边界。',impact:'将 <= 改为 < 时现有断言仍全部通过。',recommendation:'增加 allow(5) 为 true 的断言。',evidence_ids:['E1','E2']}],
  case_assessments:[1,2].map((n)=>({case_id:'C'+n,role:'essential',contribution:n===1?'覆盖低于阈值的允许结果。':'覆盖超过阈值的拒绝结果。',compared_with:[],evidence_ids:['E'+n],checks:[{target:n===1?'amount=4 的允许判断':'amount=6 的拒绝判断',assessment:'对同步布尔返回值作精确相等断言，操作与观察对象一致。',counterexample:'若当前返回值改为 undefined 或反转，精确相等断言会失败。',evidence_ids:['E'+n]}]})),
  selection_advice:'保留现有两例，补充等于 5 的合法边界。',limitations:['仅评估当前关联源码，未执行测试。'],
  evidence:[{id:'E1',file:'test/allow.test.mjs',line_start:6,line_end:8,quote:testSource.split('\n').slice(5,8).join('\n')},{id:'E2',file:'test/allow.test.mjs',line_start:11,line_end:13,quote:testSource.split('\n').slice(10,13).join('\n')}]});
let req,spec,result;
h.test('ASSESS-01','物化当前场景、真实声明及必要实现，不加载上层需求增加义务',()=>{
  req=input('structural');spec=prepare(req);assert.equal(spec.data.frozen.context.cases.length,2);assert.equal(spec.data.frozen.scene.description,description);
  assert.ok(spec.prompt.includes('amount <= 5'));assert.ok(spec.data.frozen.answer.case_descriptions.every(c=>c.identity_status==='source_marked'));
});
h.test('ASSESS-02','结构夹具经过原引用门禁，仅生成只读评估证据',()=>{
  const before=sha(latest),original=sha(testFile);result=finalize(spec,JSON.stringify(answer()));assert.equal(result.status,'available');
  const report=read(result.report.path);assert.equal(report.description.citation_check,'source_quotes_verified');assert.equal(report.description.coverage,'partial');
  assert.equal(result.execution_control,'none');assert.equal(result.product_judgment,'not_performed');assert.equal(sha(latest),before);assert.equal(sha(testFile),original);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));
});
h.test('ASSESS-03','已完成请求重入不启动角色、不改文件且验证源码仍适用',()=>{
  const before=snapshot(root),again=prepare(req);assert.equal(again.completed.status,'available');assert.equal(again.completed.source_inputs_match_current,true);assert.deepEqual(snapshot(root),before);
});
h.test('ASSESS-04','源码变化使缓存失效，保留原评估且不冒充最新结论',()=>{
  const original=fs.readFileSync(testFile),reportBefore=sha(result.report.path);fs.appendFileSync(testFile,'// changed after assessment\n');
  const stale=prepare(req).completed;assert.equal(stale.status,'unavailable');assert.equal(stale.original_status,'available');assert.equal(stale.historical_report_preserved,true);assert.equal(sha(result.report.path),reportBefore);fs.writeFileSync(testFile,original);
});
h.test('ASSESS-05','尚未永久编号的真实候选可评估，但不会补造或写入 TC 身份',()=>{
  const request=input('candidate',{case_answer:{case_descriptions:cases().map((c,n)=>({...c,id:'candidate-'+n}))}}),attempt=prepare(request);
  assert.ok(attempt.data.frozen.answer.case_descriptions.every(c=>c.identity_status==='unassigned_candidate'));const before=sha(testFile);
  assert.equal(finalize(attempt,JSON.stringify(answer())).status,'available');assert.equal(sha(testFile),before);
});
h.test('ASSESS-06','明确关闭评估不调用角色、不虚构分数或产品通过',()=>{
  const off=prepare(input('off',{enabled:false,case_answer:null})).completed;assert.equal(off.status,'off');assert.equal(off.product_judgment,'not_performed');assert.ok(!('coverage' in off));
});
h.test('ASSESS-07','错误 ID、重复声明、过期源码和伪造标题记录 unavailable',()=>{
  for(const [id,changed]of [['bad-id',cs=>{cs[0].id='TC-invalid';}],['wrong-marker',cs=>{cs[0].id='TC-c75cd594-9810-4677-9114-a18dfc82a71b';}],['duplicate',cs=>{cs.push(cs[0]);}],['stale',cs=>{cs[0].source.file_sha256='0'.repeat(64);}],['title',cs=>{cs[0].source.title='不存在的声明';}]]){
    const values=cases();changed(values);const bad=prepare(input(id,{case_answer:{case_descriptions:values}})).completed;assert.equal(bad.status,'unavailable');assert.equal(bad.execution_control,'none');assert.equal(bad.product_judgment,'not_performed');
  }
});
h.test('ASSESS-08','错误回答或伪造引用只使评估不可用，原定义与用例不变',()=>{
  const original=sha(latest),code=sha(testFile);
  for(const [id,value]of [['invalid-json','not json'],['bad-quote',JSON.stringify({...answer(),evidence:[{...answer().evidence[0],quote:'invented'},answer().evidence[1]]})]]){
    const attempt=prepare(input(id)),bad=finalize(attempt,value);assert.equal(bad.status,'unavailable');assert.equal(bad.execution_control,'none');assert.ok(fs.existsSync(path.join(attempt.folder,'answer-receipt.json')));
  }
  assert.equal(sha(latest),original);assert.equal(sha(testFile),code);
});
h.test('ASSESS-09','角色运行期间源码变化拒绝陈旧评估，不重试或修补',()=>{
  const attempt=prepare(input('concurrent-change')),original=fs.readFileSync(testFile);fs.appendFileSync(testFile,'// concurrent change\n');
  const failed=finalize(attempt,JSON.stringify(answer()));assert.equal(failed.status,'unavailable');assert.match(failed.reason,/source changed/);fs.writeFileSync(testFile,original);
});
h.test('ASSESS-10','空关联保持为空，不把文件列表冒充实际用例声明',()=>{
  const attempt=prepare(input('empty-group',{case_answer:{case_descriptions:[],test_files:['test/allow.test.mjs']}}));assert.equal(attempt.data.frozen.context.cases.length,0);
  const empty={schema:'case-evaluation-v2',summary:'当前关联为空。',coverage:'gap',obligations:[{id:'O1',quote:description,status:'unsupported',assessment:'没有已关联用例可支持当前场景。',evidence_ids:[]}],findings:[],case_assessments:[],selection_advice:'为当前场景关联或编写实际用例。',limitations:['仅知道本次关联为空，不据此判断整个仓库。'],evidence:[]};
  assert.equal(finalize(attempt,JSON.stringify(empty)).status,'available');
});
h.test('ASSESS-11','请求冲突与失配当前交付测试在角色启动前拒绝',()=>{
  assert.throws(()=>prepare({...req,enabled:false}),/request_id conflicts/);assert.throws(()=>prepare({...input('wrong-at'),acceptance_id:'AT-other'}),/current acceptance mismatch/);
});
h.test('ASSESS-BINARY','非文本支持文件在角色调用前返回不可用，保留原文件与场景',()=>{
  const definitionHash=sha(latest),testHash=sha(testFile);
  for(const [name,bytes]of [['invalid-utf8',Buffer.from([0xcf,0xfa,0xed,0xfe])],['nul-binary',Buffer.from('binary\0payload')]]){
    const file=path.join(root,'test',name);fs.writeFileSync(file,bytes);const hash=sha(file),attempt=prepare(input('reject-'+name,{supporting_files:[{file:'test/'+name,sha256:hash}]}));
    assert.equal(attempt.completed.status,'unavailable');assert.match(attempt.completed.reason,/UTF-8|NUL/);assert.equal(attempt.prompt,undefined);assert.equal(fs.existsSync(path.join(path.dirname(attempt.completed.receipt_path),'prompt.txt')),false);assert.equal(sha(file),hash);
  }
  assert.equal(sha(latest),definitionHash);assert.equal(sha(testFile),testHash);
});
if(h.live&&process.argv.includes('--binary-only'))h.test('ASSESS-BINARY-CLI','真实官方CLI对非文本支持源码走unavailable且不调用Evaluator',()=>{
  for(const name of ['invalid-utf8','nul-binary']){const file=path.join(root,'test',name),response=h.cli('acceptance-assess-cases',input('live-reject-'+name,{supporting_files:[{file:'test/'+name,sha256:sha(file)}]}),'live-reject-'+name,root);
    h.settled(response,'acceptance-assess-cases','unavailable');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);const value=read(path.join(root,'.acceptance-local',at,'workflows/case-assessment/live-reject-'+name+'/result.json'));assert.match(value.reason,/UTF-8|NUL/);assert.equal(value.product_judgment,'not_performed');assert.equal(value.execution_control,'none');
  }
});
if(h.live&&!process.argv.includes('--binary-only')){
  let liveReq;
  h.test('ASSESS-12','真实官方 CLI 调用独立 Evaluator，发现等于阈值的必要缺口并提供真实引用',()=>{
    liveReq=input('live-evaluator');const before=sha(latest),code=sha(testFile),response=h.cli('acceptance-assess-cases',liveReq,'live-evaluator',root);
    h.settled(response,'acceptance-assess-cases','done');const value=read(path.join(root,'.acceptance-local',at,'workflows/case-assessment/live-evaluator/result.json'));
    assert.equal(value.status,'available');const report=read(value.report.path),d=report.description;assert.ok(['gap','partial'].includes(d.coverage));
    assert.ok(d.findings.some(f=>f.kind==='gap'&&/5/.test(f.statement+' '+f.impact+' '+f.recommendation)&&/等于|边界|<=|小于|< 5|<5/.test(f.statement+' '+f.impact+' '+f.recommendation)));
    assert.equal(d.case_assessments.length,2);assert.equal(d.citation_check,'source_quotes_verified');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,1);
    assert.equal(sha(latest),before);assert.equal(sha(testFile),code);h.save('live-result.json',value);h.save('live-description.json',d);return {output:response.envelope};
  });
  h.test('ASSESS-13','真实 CLI 完成后重入不重复调用 Evaluator',()=>{
    const before=snapshot(root),response=h.cli('acceptance-assess-cases',liveReq,'live-evaluator-repeat',root);h.settled(response,'acceptance-assess-cases','done');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);assert.deepEqual(snapshot(root),before);
  });
  h.test('ASSESS-14','真实 CLI 关闭评估走 off 终态且不调用角色',()=>{
    const response=h.cli('acceptance-assess-cases',input('live-off',{enabled:false}),'live-evaluator-off',root);h.settled(response,'acceptance-assess-cases','off');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);return {output:response.envelope};
  });
  h.test('ASSESS-15','真实 CLI 过期引用走 unavailable 终态，不给产品失败或阻断正式执行',()=>{
    const values=cases();values[0].source.file_sha256='0'.repeat(64);const response=h.cli('acceptance-assess-cases',input('live-unavailable',{case_answer:{case_descriptions:values}}),'live-evaluator-unavailable',root);
    h.settled(response,'acceptance-assess-cases','unavailable');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);const result=read(path.join(root,'.acceptance-local',at,'workflows/case-assessment/live-unavailable/result.json'));assert.equal(result.execution_control,'none');return {output:response.envelope};
  });
}
h.finish(['workflows/assess-cases/stage.mjs','workflows/assess-cases/protocol.mjs','workflows/assess-cases/registry.mjs','workflows/shared/readonly-agent.mjs','tests/acceptance_case_assessment.integration.mjs']);
