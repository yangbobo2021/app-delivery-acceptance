import {buildInventory} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/reverse/protocol.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare as runtimePrepare,finalize as runtimeFinalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/runtime/stage.mjs';
import {prepareCoverage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/stage.mjs';
import {harness,read,sha,skill,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-coverage',[['acceptance-coverage-prepare','coverage']]);
const args=process.argv.slice(2),pythonIndex=args.indexOf('--python');
const python=pythonIndex>=0?fs.realpathSync(args[pythonIndex+1]):null;
async function check(id,purpose,body){try{const data=await body();h.test(id,purpose,()=>data);}catch(error){h.test(id,purpose,()=>{throw error;});}}
const root=h.project('coverage-project'),at='AT-coverage';
fs.mkdirSync(path.join(root,'src'));fs.mkdirSync(path.join(root,'tests'));
fs.writeFileSync(path.join(root,'.gitignore'),'__pycache__/\n*.pyc\n.coverage*\n');
fs.writeFileSync(path.join(root,'src/calc.py'),'def classify(value):\n    if value > 0:\n        return "positive"\n    return "nonpositive"\n');
fs.writeFileSync(path.join(root,'tests/business.py'),'from pathlib import Path\nPath("BUSINESS_TEST_WAS_RUN").write_text("unexpected")\nraise RuntimeError("Business tests are forbidden during preparation")\n');
fs.writeFileSync(path.join(root,'README.md'),'A small Python project. Coverage preparation only; do not run tests/business.py. The source inventory contains the complete src/calc.py. Choose a mature tool from the verified runtime, keep native data read-only for both readers, and implement the actual project-coverage-v1 operations. Probe scripts under tests may load or exercise classify without calling the business test. All source was introduced in the initial product commit, so this inventory has whole-file changed lines.\n');
h.run('fixture-git-init','git',['init','-q',root]);h.run('fixture-empty-commit','git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@local','commit','--allow-empty','-qm','empty base']);
const base=h.run('fixture-base','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
h.run('fixture-git-add','git',['-C',root,'add','.']);h.run('fixture-source-commit','git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@local','commit','-qm','complete product']);
const revision=h.run('fixture-head','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'只准备或修复覆盖率，不执行业务用例。'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'用户只请求覆盖率准备。',definitions:{context:{business_goal:'为后续测试准备真实覆盖率采集。'},requirements:[{id:'R1',text:'用户可以区分正数和非正数。',origin:{kind:'fixture-user',reference:'coverage-prepare-only'},external_refs:[]}]}});
const definitions=path.join(root,'.acceptance',at,'scenarios.json'),local=path.join(root,'.acceptance-local',at);
const request=(id,extra={})=>({project_root:root,acceptance_id:at,request_id:id,definitions_sha256:sha(definitions),policy:'off',basis:'用户明确关闭本次覆盖率。',...extra});
let off;
await check('COVERAGE-01','显式 off 停在覆盖率准备，不建立运行环境、调用角色或执行业务',async()=>{
  const before=sha(definitions);off=await prepareCoverage(request('off'));assert.equal(off.status,'off');assert.equal(off.business_tests,'not_executed');assert.equal(sha(definitions),before);assert.equal(fs.existsSync(path.join(local,'workspace')),false);return {result:off};
});
await check('COVERAGE-02','相同 off 请求重入不改字节；不能把不可用自动写成 off',async()=>{
  const before=snapshot(root),again=await prepareCoverage(request('off'));assert.equal(again.status,'off');assert.equal(again.reused,true);assert.deepEqual(snapshot(root),before);
  const unavailable=await prepareCoverage(request('unavailable',{policy:'unavailable',basis:'受控输入：当前项目没有已验证的采集工具。'}));assert.equal(unavailable.status,'unavailable');
});
await check('COVERAGE-03','缺明确依据、非法策略和跨 AT 的运行环境在模型前阻塞',async()=>{
  assert.equal((await prepareCoverage(request('no-basis',{basis:''}))).status,'blocked');assert.equal((await prepareCoverage(request('unknown',{policy:'optional'}))).status,'blocked');
  assert.equal((await prepareCoverage(request('empty-instructions',{preparation_instructions:' '}))).status,'blocked');
  const result=await prepareCoverage(request('outside',{policy:'required',runtime_manifest:'/etc/hosts',runtime_sha256:sha('/etc/hosts'),inventory_path:'/etc/hosts',inventory_sha256:sha('/etc/hosts')}));assert.equal(result.status,'blocked');assert.match(result.reason,/another acceptance/);
});
if(h.live){
  assert.ok(python,'--python must identify the fixture project interpreter with coverage installed');
  const version=h.run('fixture-tool-version',python,['-c','import coverage; print(coverage.__version__)']);assert.equal(version.exit_code,0,version.stderr);
  const runtimeSpec=runtimePrepare({project_root:root,acceptance_id:at,request_id:'runtime',definitions_sha256:sha(definitions),source_checkout:root,revision,test_roots:['tests'],inspection_files:['README.md','src/calc.py'],available_executables:[{name:'python',path:python}]});
  const runtimeResult=runtimeFinalize(runtimeSpec,JSON.stringify({dependency_files:[],knowledge_used:['INDEX.md'],setup_commands:[],executables:[{name:'python',path:python,version_command:[python,'--version']}],smoke:{command:[python,'-c','import coverage; print(coverage.__version__)'],cwd:'{workspace}'},recipe_candidate:'# Fixture project runtime\nUse the project Python interpreter with coverage.py installed. Confirm its Python and coverage.py versions before coverage probes. No business tests or global installation occur during this controlled setup.'}));
  h.save('fixture-runtime.json',{boundary:'Deterministic test setup; the coverage preparation role below is a real model invocation.',runtimeResult});
  const inventoryRequest=path.join(local,'workflows/inventory-request.json'),inventory=path.join(local,'workflows/inventory.json');
  fs.writeFileSync(inventoryRequest,JSON.stringify({project_root:runtimeResult.workspace,base_revision:base,head_revision:revision,requirements:{items:[]},pr_requirement_ids:[],test_modes:['WHITE_BOX'],source_paths:['src/calc.py'],test_paths:['tests/business.py'],noncode_paths:['.gitignore','README.md']}));
  fs.writeFileSync(inventory,JSON.stringify(buildInventory(read(inventoryRequest)),null,2)+'\n');h.save('inventory-node-binding.json',{module:'workflows/reverse/protocol.mjs#buildInventory',input:inventoryRequest,output:inventory,sha256:sha(inventory)});
  const liveInput=request('live',{policy:'required',basis:'用户明确只准备本次采集链路。',runtime_manifest:runtimeResult.runtime.manifest,runtime_sha256:runtimeResult.runtime.sha256,inventory_path:inventory,inventory_sha256:sha(inventory),source_hashes:{'src/calc.py':sha(path.join(runtimeResult.workspace,'src/calc.py'))},test_roots:['tests'],expected_measured_sources:['src/calc.py']});
  await check('COVERAGE-04','真实官方 CLI 覆盖率准备角色选择工具并交付新零/非零探针及完整准备核验',async()=>{
    h.save('live-input.json',liveInput);const cli=h.cli('acceptance-coverage-prepare',liveInput,'live-coverage',root,{timeout:1000000,env:{...process.env,ACCEPTANCE_AGENT:'codex',ACCEPTANCE_MODEL:process.env.ACCEPTANCE_MODEL??'gpt-6.1-sol',SPEX_HOME:path.join(h.temporary,'spex')}});h.settled(cli,'acceptance-coverage-prepare','done');
    const result=read(path.join(local,'workflows/coverage/live/result.json'));assert.equal(result.status,'ready');assert.equal(result.business_tests,'not_executed');
    assert.equal(fs.existsSync(path.join(runtimeResult.workspace,'BUSINESS_TEST_WAS_RUN')),false);assert.equal(sha(definitions),liveInput.definitions_sha256);
    const handoff=read(path.join(local,'workflows/coverage/live/preparation/handoff.json'));assert.deepEqual(handoff.unmet_expected_sources,[]);
    const report=read(handoff.probe_report);assert.ok(report.routes.length);for(const route of report.routes){assert.equal(route.probes.zero.status,'passed');assert.equal(route.probes.nonzero.status,'passed');}
    const profile=read(path.join(handoff.prepared,'prepared.json'));assert.equal(profile.protocol_revision,2);
    const lifecycle=read(profile.spec.lifecycle_report);assert.equal(lifecycle.status,'passed');assert.ok(lifecycle.routes.length);
    for(const route of lifecycle.routes){assert.equal(route.zero.status,'passed');assert.equal(route.nonzero.status,'passed');assert.equal(route.nonzero.metrics_tamper_rejected,true);}
    const metrics=read(path.join(local,'workflows/coverage/live/preparation/metrics.json'));assert.equal(metrics.agent_runtime.transport.kind,'official-playbook-player-port');assert.equal(metrics.agent_runtime.role,'coverage_preparer');
    h.save('live-result.json',result);return {result,probe_report:handoff.probe_report};
  });
  await check('COVERAGE-05','同请求复用仅核对冻结字节；不重跑探针或调用准备角色',async()=>{
    const folder=path.join(local,'workflows/coverage/live'),before=snapshot(folder),again=await prepareCoverage(liveInput);assert.equal(again.status,'ready');assert.equal(again.current_binding_verified,true);assert.deepEqual(snapshot(folder),before);
  });
  await check('COVERAGE-06','适配器漂移使旧准备返回 stale，原通过报告和原生证据保持',async()=>{
    const result=read(path.join(local,'workflows/coverage/live/result.json')),profile=read(path.join(result.coverage.prepared,'prepared.json')),file=path.join(runtimeResult.workspace,Object.keys(profile.adapter_files)[0]),before=fs.readFileSync(file),profileHash=sha(path.join(result.coverage.prepared,'prepared.json'));
    fs.appendFileSync(file,'\n# controlled post-preparation drift\n');try{const stale=await prepareCoverage(liveInput);assert.equal(stale.status,'stale');assert.equal(stale.historical_report_preserved,true);assert.equal(sha(path.join(result.coverage.prepared,'prepared.json')),profileHash);}finally{fs.writeFileSync(file,before);}
  });
}
h.finish(['workflows/coverage/stage.mjs','workflows/coverage/registry.mjs','workflows/coverage/roles/preparer.mjs','workflows/shared/workspace.mjs','tests/acceptance_coverage.integration.mjs']);
