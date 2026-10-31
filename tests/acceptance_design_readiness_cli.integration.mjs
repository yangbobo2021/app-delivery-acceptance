// Live, domain-varied tasks go only through the public orchestrator CLI.
// The correction task starts from an explicitly labelled protocol fixture;
// its corrective Designer answer and all subsequent calls are real native runs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harness,read,sha,snapshot} from './official_workflow_harness.mjs';
import {workflowOverlay} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/bin/configure.mjs';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/scenarios/stage.mjs';

const overlay=await workflowOverlay({agent:'codex',model:process.env.ACCEPTANCE_MODEL??'gpt-6-sol',effort:process.env.ACCEPTANCE_EFFORT??'high'});
const h=harness('acceptance-design-readiness-cli',Object.keys(overlay.playbooks).map(id=>[id,id.slice('acceptance-'.length)]));
const forbidden=new Set(['acceptance-cases','acceptance-find-cases','acceptance-runtime','acceptance-project','acceptance-execute','acceptance-manual-execute','acceptance-coverage-prepare']);
const noExecution=(root,at,calls)=>{
 assert.ok(!calls.some(c=>forbidden.has(c.workflow)));
 for(const folder of ['workspace','workflows/cases','workflows/execute','workflows/runtime'])assert.equal(fs.existsSync(path.join(root,'.acceptance-local',at,folder)),false);
};
const fixture=label=>{
 const root=h.project(label);h.run(label+'-git-init','git',['init','-q',root]);
 fs.writeFileSync(path.join(root,'README.md'),'# Synthetic acceptance design fixture\n\nNo product implementation, executable entry point, accounts, devices or runtime environment are available. Only requirements and scenario design are requested. Never execute product tests.\n');
 h.run(label+'-git-add','git',['add','.'],{cwd:root});h.run(label+'-git-commit','git',['-c','user.name=Acceptance Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Synthetic design inputs'],{cwd:root});return root;
};
const call=(root,taskId,request,label)=>{
 const input={project_root:root,source_checkout:root,task_id:taskId,request_id:label,budget_seconds:1200,...request};h.save(label+'-input.json',input);
 const cli=h.cli('acceptance-orchestrate',input,label,root,{timeout:1500000});
 const result=read(path.join(root,'.acceptance-local/orchestration',taskId,'requests',input.request_id,'result.json'));
 const state=read(path.join(root,'.acceptance-local/orchestration',taskId,'state.json'));return{cli,result,state,input};
};

if(h.live){
 for(const fixtureCase of [
  {id:'RESPONSE-17',label:'response-without-implementation',quote:'成功响应的 available 字段值为布尔值 true。'},
  {id:'STOCK-8',label:'inventory-without-environment',quote:'库存数量为零时，商品显示为不可购买。'}
 ]){
  h.test('READY-CLI-'+fixtureCase.id,'无实现和运行资源仍由真实 Designer 设计不同领域的明确黑盒判据',()=>{
   const root=fixture(fixtureCase.label);fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs/contract.txt'),fixtureCase.quote+'\n');
   const task='TASK-'+fixtureCase.id,run=call(root,task,{source_files:[{path:'README.md',purpose:'真实验证前提：当前没有产品实现或运行资源'},{path:'docs/contract.txt',purpose:'本次唯一完整合成需求原文'}],message:'仅依据 docs/contract.txt 中的原文为 '+fixtureCase.id+' 新建交付测试、冻结需求，然后由场景设计角色设计并采用恰好一个黑盒场景。README 已说明没有产品实现或运行资源；判据明确时设计应先完成，将执行前提另行说明。采用后停止，不生成或调试用例、不执行产品测试、不准备运行环境、不采集覆盖率、不生成报告或视图。总调度不得自行替写场景绕过 Designer。',context:{requirement_ids:[fixtureCase.id],coverage:'off',authorization:'Only create, freeze, design and adopt one synthetic scenario; stop before all product execution.'}},fixtureCase.label);
   assert.equal(run.result.status,'completed');const at=read(path.join(root,'.acceptance-local/current.json')).acceptance_id,catalog=read(path.join(root,'.acceptance',at,'scenarios.json'));
   assert.equal(catalog.requirements.length,1);assert.equal(catalog.requirements[0].text,fixtureCase.quote);assert.equal(catalog.scenarios.length,1);
   const scene=catalog.scenarios[0];assert.equal(scene.origin.kind,'skill_generated_internal_self_check');
   const designs=run.state.calls.filter(c=>c.workflow==='acceptance-scenarios');assert.ok(designs.length>0);
   const produced=designs.find(c=>c.result.output.scenarios===1&&c.result.output.design_coverage?.status==='complete');assert.ok(produced,'No complete real Designer result');
   assert.ok(scene.origin.reference.startsWith(path.dirname(produced.result.output.receipt_path)+path.sep));assert.equal(produced.result.output.semantic_review,'not_independent');
   assert.ok(Array.isArray(produced.result.output.execution_prerequisites));assert.ok(produced.result.output.execution_prerequisites.length>0,'Known missing execution resources were not recorded');
   const freezes=run.state.calls.filter(c=>c.workflow==='acceptance-freeze');assert.ok(freezes.length>=2);assert.ok(freezes.every(c=>c.result.output.status==='frozen'),'Invalid freeze input escaped preflight');
   noExecution(root,at,run.state.calls);h.save(fixtureCase.label+'-catalog.json',catalog);h.save(fixtureCase.label+'-task.json',run.state);return{result:run.result,designer:produced.result.output,actual_model:process.env.ACCEPTANCE_MODEL??'gpt-6-sol'};
  });
 }
 h.test('READY-CLI-CORRECTION','总调度把旧设计问题以字节绑定交回真实 Designer，保留旧原答并采用其新候选',()=>{
  const root=fixture('correction'),at='AT-correction',quote='导出文档保留所有段落的原始顺序。';
  createAcceptance({project_root:root,acceptance_id:at,request_id:'protocol-fixture-create',user_request:'合成协议夹具前提，非模型执行。'});
  freezeAcceptance({project_root:root,acceptance_id:at,request_id:'protocol-fixture-freeze',basis:'合成验证前提中明确提供的文档导出合同。',base_definitions_sha256:null,definitions:{context:{business_goal:'文档导出保持段落顺序。'},requirements:[{id:'DOCUMENT-4',text:quote,origin:{kind:'conversation',reference:'synthetic-fixture:DOCUMENT-4'},external_refs:[]}]}});
  const latest=path.join(root,'.acceptance',at,'scenarios.json'),spec=prepare({project_root:root,acceptance_id:at,request_id:'protocol-fixture-mistaken-design',definitions_sha256:sha(latest),target_id:'DOCUMENT-4',mode:'create'});
  const prior=finalize(spec,JSON.stringify({scenarios:[],change_summary:['协议夹具模拟执行前提误判；这不是模型答复。'],selfcheck:{obligations:[{quote,scene_ids:[],gap_reason:'当前没有产品实现，因此不能设计导出验证。'}],scene_checks:[],ui_requirement:{required:false,reason:'文档内容合同。'}}}));
  const before=snapshot(root),oldHash=sha(prior.receipt_path),task='TASK-correction';
  const run=call(root,task,{message:'现有 DOCUMENT-4 的场景草案把没有产品实现当成设计缺口，尚未采用。请核对已有冻结需求和旧设计回执，将这个判断问题通过带来源绑定的纠正意见交回场景设计角色。判据明确时由 Designer 重新设计并采用恰好一个场景，执行前提单列；不要由总调度替写场景。完成采用后停止，不运行产品测试、用例或准备环境。',context:{acceptance_id:at,requirement_ids:['DOCUMENT-4'],previous_design_result:{path:prior.receipt_path,sha256:oldHash},prior_origin:'Synthetic protocol fixture, not a claimed native Designer run.',coverage:'off',authorization:'Correct through Designer and adopt only; no product tests.'}},'correction-via-parent');
  assert.equal(run.result.status,'completed');const design=run.state.calls.find(c=>c.workflow==='acceptance-scenarios'&&c.input.design_feedback);
  assert.ok(design,'Parent did not hand the feedback back to Designer');assert.equal(design.input.design_feedback.previous_result.path,prior.receipt_path);assert.equal(design.input.design_feedback.previous_result.sha256,oldHash);
  assert.equal(design.result.output.design_coverage.status,'complete');assert.equal(design.result.output.scenarios,1);
  const catalog=read(latest);assert.equal(catalog.scenarios.length,1);assert.equal(catalog.scenarios[0].origin.kind,'skill_generated_internal_self_check');assert.ok(catalog.scenarios[0].origin.reference.startsWith(path.dirname(design.result.output.receipt_path)+path.sep));
  assert.equal(sha(prior.receipt_path),oldHash);for(const [file,digest]of Object.entries(before))if(file.startsWith(path.relative(root,spec.folder)+path.sep))assert.equal(sha(path.join(root,file)),digest);
  noExecution(root,at,run.state.calls);h.save('correction-task.json',run.state);h.save('correction-catalog.json',catalog);return{result:run.result,designer:design.result.output,original_protocol_fixture:prior.receipt_path};
 });
}else h.test('READY-CLI-SCOPE','Live model validation is explicitly opt-in; no protocol fixture is reported as native success',()=>({live_model_tests:'not_run; use --live-cli'}));
h.finish(['workflows/orchestrate/orchestrator.md','workflows/scenarios/standard.md','workflows/scenarios/selfcheck.md','workflows/scenarios/stage.mjs','tests/acceptance_design_readiness_cli.integration.mjs']);
