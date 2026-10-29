import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/freeze.mjs';
import {sceneInput} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/definitions.mjs';
import {prepare as prepareScenarios,finalize as finalizeScenarios} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/scenarios/stage.mjs';
import {harness,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-source-inputs',[['acceptance-create','create'],['acceptance-freeze','freeze']]);
const root=h.project('source-project'),at='AT-source-quality';
const original='按账号汇总，使用精确整数计算；结果可以超过 32 位。';
const docs={'docs/requirements.md':'# 需求\n\n合法金额为 0 至 1000000000。\n\n- INV-02：'+original+'\n',
  'README.md':'# 操作指南\n\n从任意目录执行：`python3 -m invoice --input <UTF-8 CSV>`。\n'};
for(const [name,text]of Object.entries(docs)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),text);}
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'仅冻结 INV-02，完整保留需求和 README 背景，不启动测试。'});
const inputs=()=>({required_documents:Object.keys(docs),documents:Object.entries(docs).map(([name,text])=>({path:name,sha256:createHash('sha256').update(text).digest('hex'),text,purpose:name==='README.md'?'实际命令背景':'需求及合法输入背景'}))});
const req=(id,project=root,acceptance=at)=>({project_root:project,acceptance_id:acceptance,request_id:id,basis:'用户明确仅冻结 INV-02，需求全文与 README 为必要背景。',base_definitions_sha256:null,
  source_inputs:inputs(),definitions:{context:{business_goal:'只验收 INV-02。'},requirements:[{id:'INV-02',text:original,origin:{kind:'SPEC',reference:'docs/requirements.md:5@fixture'},external_refs:[]}]}});
function designRequest(project,acceptance){
  const scene={id:'S1',title:'金额精确汇总',description:original,priority:'P0',priority_reason:'精确整数是核心结果。'};
  const spec=prepareScenarios({project_root:project,acceptance_id:acceptance,request_id:'design-quality',target_id:'INV-02',definitions_sha256:sha(path.join(project,'.acceptance',acceptance,'scenarios.json'))});
  const designed=finalizeScenarios(spec,JSON.stringify({scenarios:[scene],change_summary:['只设计选定原始约定。'],selfcheck:{obligations:[{quote:original,scene_ids:['S1']}],ui_requirement:{required:false,reason:'纯 CLI 金额结果。'},scene_checks:[{scene_id:'S1',owner_quote:original,distinguishing_failure:'大整数被截断导致汇总错误。',observable_result:'真实 CLI 返回精确整数总额。',failure_impact:'金额汇总错误。',ui_visual_expectation:''}]}}));
  return JSON.parse(fs.readFileSync(designed.next_freeze_command,'utf8').slice('/acceptance-freeze '.length));
}
function rejected(id,edit,pattern){h.test(id,'拒绝无效输入且不创建冻结版本/范围/工作区',()=>{const request=req(id);edit(request);const before=snapshot(root);assert.throws(()=>freezeAcceptance(request),pattern);assert.deepEqual(snapshot(root),before);});}
rejected('SOURCE-01',r=>r.definitions.requirements[0].origin.reference='docs/requirements.md:4@fixture',/source line range does not contain original text/);
rejected('SOURCE-02',r=>r.source_inputs.documents.pop(),/missing required document snapshot: README/);
rejected('SOURCE-03',r=>r.source_inputs.documents[0].text=original,/snapshot text\/hash differs/);
rejected('SOURCE-04',r=>r.source_inputs.documents[0].sha256='0'.repeat(64),/snapshot text\/hash differs/);
rejected('SOURCE-05',r=>delete r.source_inputs,/complete source_inputs snapshot/);
rejected('SOURCE-06',r=>r.definitions.requirements[0].origin.reference='docs/requirements.md:999@fixture',/outside document/);
rejected('SOURCE-07',r=>{r.definitions.requirements[0].origin.file={path:'docs/requirements.md',start_line:5,end_line:5};r.definitions.requirements[0].origin.reference='docs/requirements.md:4@fixture';},/conflicts with human reference/);
rejected('SOURCE-08',r=>r.source_inputs.required_documents.push('../outside.md'),/outside project/);
rejected('SOURCE-09',r=>r.definitions.context.source_documents=r.source_inputs.documents,/use source_inputs/);
rejected('SOURCE-10',r=>r.definitions.requirements[0].origin.reference+=' sha256:'+'0'.repeat(64),/reference hash mismatch/);
let frozen;
h.test('SOURCE-11','冻结完整背景后逐字交接到场景输入，范围仍只有选定需求',()=>{
  const request=req('valid');request.definitions.requirements[0].origin.file={path:'docs/requirements.md',start_line:5,end_line:5};
  frozen=freezeAcceptance(request);assert.equal(frozen.status,'frozen');assert.equal(frozen.stopped_after,'freeze');
  let value=read(frozen.definitions.path);
  assert.deepEqual(value.context.source_documents.map(x=>[x.path,x.text]),Object.entries(docs));
  assert.deepEqual(value.requirements.map(x=>x.id),['INV-02']);assert.deepEqual(value.scenarios,[]);
  const generated=designRequest(root,at);
  assert.equal(generated.mode,'replace');assert.deepEqual(generated.definitions.context.source_documents,value.context.source_documents);
  const adopted=freezeAcceptance(generated);
  const input=sceneInput({acceptance:{project_root:root,id:at,scope_sha256:adopted.scope.sha256},definitions:adopted.definitions},'S1');
  assert.deepEqual(input.execution_context.source_documents,value.context.source_documents);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));
  const before=snapshot(root);assert.equal(freezeAcceptance(request).status,'already_frozen');assert.deepEqual(snapshot(root),before);
  h.save('frozen-stage-input.json',input);return {definitions:adopted.definitions,input};
});
h.test('SOURCE-12','已冻结来源被改写时拒绝新采用，原快照仍然可读',()=>{
  const name=path.join(root,'docs/requirements.md');fs.writeFileSync(name,docs['docs/requirements.md']+'新增内容\n');
  const request=req('outdated');delete request.source_inputs;request.base_definitions_sha256=sha(path.join(root,'.acceptance',at,'scenarios.json'));
  const before=snapshot(root);assert.throws(()=>freezeAcceptance(request),/frozen source differs from current file/);assert.deepEqual(snapshot(root),before);
  assert.equal(read(frozen.definitions.path).context.source_documents[0].text,docs['docs/requirements.md']);fs.writeFileSync(name,docs['docs/requirements.md']);
});
h.test('SOURCE-13','口述需求不强制项目文档，远程 URL 不被误认为本地文件',()=>{
  const r=h.project('oral');createAcceptance({project_root:r,acceptance_id:'AT-oral',request_id:'create',user_request:'冻结口头约定。'});
  const request=req('oral',r,'AT-oral');delete request.source_inputs;request.definitions.requirements[0].origin={kind:'conversation',reference:'fixture:user-message'};
  assert.equal(freezeAcceptance(request).status,'frozen');
  request.request_id='remote';request.base_definitions_sha256=sha(path.join(r,'.acceptance/AT-oral/scenarios.json'));request.definitions.requirements[0].origin={kind:'remote-snapshot',reference:'https://example.test:8080'};
  assert.equal(freezeAcceptance(request).status,'frozen');
});
h.test('SOURCE-14','CRLF 多行原文与 Unicode 按完整文件字节校验',()=>{
  const r=h.project('crlf'),text='第一行😀\r\n第二行。',name='SPEC.txt';fs.writeFileSync(path.join(r,name),text+'\r\n');
  createAcceptance({project_root:r,acceptance_id:'AT-crlf',request_id:'create',user_request:'冻结原文。'});
  const request=req('crlf',r,'AT-crlf');request.definitions.requirements[0].text=text;request.definitions.requirements[0].origin={kind:'document',reference:'SPEC.txt:1-2'};
  request.source_inputs={required_documents:[name],documents:[{path:name,text:text+'\r\n',sha256:sha(path.join(r,name))}]};
  assert.equal(freezeAcceptance(request).status,'frozen');
});
h.test('SOURCE-16','显式完整替换可移除旧背景，旧版本仍保留完整来源',()=>{
  const request=req('replace');delete request.source_inputs;request.mode='replace';request.replace_basis='用户明确仅保留新的口述约定，移除其余定义与背景。';
  request.base_definitions_sha256=sha(path.join(root,'.acceptance',at,'scenarios.json'));request.definitions.requirements[0].origin={kind:'conversation',reference:'fixture:new-user-message'};
  const result=freezeAcceptance(request),value=read(result.definitions.path);
  assert.equal(value.context.source_documents,undefined);assert.deepEqual(value.scenarios,[]);assert.equal(read(frozen.definitions.path).context.source_documents.length,2);
});

if(h.live){
  const r=h.project('live'),id='AT-live-source';for(const[name,text]of Object.entries(docs)){fs.mkdirSync(path.dirname(path.join(r,name)),{recursive:true});fs.writeFileSync(path.join(r,name),text);}
  h.test('SOURCE-15','真实官方 CLI 创建后拦截错误来源及遗漏 README，再成功冻结完整输入',()=>{
    h.settled(h.cli('acceptance-create',{project_root:r,acceptance_id:id,request_id:'create',user_request:'仅冻结明确来源，不执行测试。'},'live-create',r),'acceptance-create','created');
    for(const [label,edit]of [['wrong-line',q=>q.definitions.requirements[0].origin.reference='docs/requirements.md:4'],['missing-readme',q=>q.source_inputs.documents.pop()]]){
      const request=req(label,r,id);edit(request);const before=snapshot(r),result=h.cli('acceptance-freeze',request,label,r);h.settled(result,'acceptance-freeze','blocked');assert.deepEqual(snapshot(r),before);
    }
    const request=req('valid',r,id),result=h.cli('acceptance-freeze',request,'live-valid',r);h.settled(result,'acceptance-freeze','frozen');
    const value=read(path.join(r,'.acceptance',id,'scenarios.json'));assert.deepEqual(value.context.source_documents.map(x=>x.text),Object.values(docs));assert.deepEqual(value.scenarios,[]);
    const adoption=designRequest(r,id),adopted=h.cli('acceptance-freeze',adoption,'live-adopt-generated',r);h.settled(adopted,'acceptance-freeze','frozen');
    const complete=read(path.join(r,'.acceptance',id,'scenarios.json'));assert.equal(complete.scenarios.length,1);assert.deepEqual(complete.context.source_documents,value.context.source_documents);
    h.save('live-project-snapshot.json',snapshot(r));return {project_root:r,result:result.envelope};
  });
}
h.finish(['workflows/freeze/source-inputs.mjs','workflows/freeze/freeze.mjs','tests/acceptance_source_inputs.integration.mjs']);
