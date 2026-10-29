import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/runtime/stage.mjs';
import {validateRuntime} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/runtime.mjs';
import {runProbePlan,verifyProbeReport} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/coverage-probes.mjs';
import {harness,read,sha,skill} from './official_workflow_harness.mjs';

const h=harness('node-coverage-probes',[]),root=h.project('project'),at='AT-probe-protocol';
fs.mkdirSync(path.join(root,'src'));fs.mkdirSync(path.join(root,'test'));
fs.writeFileSync(path.join(root,'README.md'),'Controlled protocol fixture, not a real coverage tool or product coverage.');
fs.writeFileSync(path.join(root,'src/unit.fixture'),'synthetic tool-owned unit fixture\n');
h.run('git-init','git',['init','-q',root]);h.run('git-add','git',['-C',root,'add','.']);h.run('git-commit','git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@local','commit','-qm','protocol fixture']);
const revision=h.run('git-head','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'验证实际进程、冻结探针与坏证据拒绝。'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'受控协议测试。',definitions:{context:{business_goal:'验证协议绑定，不声明真实产品覆盖率。'},requirements:[{id:'R1',text:'保存实际运行及拒绝坏证据。',origin:{kind:'fixture',reference:'node-probe-integration'},external_refs:[]}]}});
const latest=path.join(root,'.acceptance',at,'scenarios.json'),spec=prepare({project_root:root,acceptance_id:at,request_id:'runtime',definitions_sha256:sha(latest),source_checkout:root,revision,test_roots:['test'],inspection_files:['README.md'],available_executables:[{name:'node',path:process.execPath}]});
const prepared=finalize(spec,JSON.stringify({dependency_files:[],knowledge_used:['INDEX.md'],setup_commands:[],executables:[{name:'node',path:process.execPath,version_command:[process.execPath,'--version']}],smoke:{command:[process.execPath,'-e','console.log("READY_FOR_CONTROLLED_PROBES")'],cwd:'{workspace}'},recipe_candidate:'# Controlled runtime\nUse Node and its actual version; no product execution or global installation.'}));
const local=path.dirname(prepared.workspace),folder=path.join(local,'workflows/probe-fixture');fs.mkdirSync(folder);
const helper=path.join(folder,'controlled-collector.mjs');
fs.writeFileSync(helper,`import fs from 'node:fs';import path from 'node:path';const [kind,raw,variant]=process.argv.slice(2),file=path.join(raw,'native.json');
if(kind==='collect'){fs.writeFileSync(file,variant==='empty'?'':JSON.stringify({covered:variant==='zero'?0:2,total:9}));}
else{const data=JSON.parse(fs.readFileSync(file));if(variant==='mutate')fs.appendFileSync(file,' ');console.log(JSON.stringify({schema:'coverage-probe-normalized-v1',components:[{id:'controlled-fixture',source_paths:['src/unit.fixture'],metrics:{line:{status:'measured',covered:data.covered+(variant==='mismatch'?1:0),total:data.total},branch:{status:'unavailable',reason:'Synthetic protocol fixture has no branch tool'}}}]}));}`);
function plan(label,{zero='zero',adapter='plain',direct='plain'}={}){
  const commands=(variant,reader,directVariant)=>({collect:[process.execPath,helper,'collect','{raw_dir}',variant],adapter:[process.execPath,helper,'adapter','{raw_dir}',reader],direct:[process.execPath,helper,'direct','{raw_dir}',directVariant]});
  const value={schema:'project-coverage-probe-plan-v1',runtime_manifest:prepared.runtime.manifest,runtime_sha256:prepared.runtime.sha256,workspace:prepared.workspace,revision,routes:[{id:'fixture',source_paths:['src/unit.fixture'],zero:commands(zero,adapter,direct),nonzero:commands('nonzero','plain','plain')}]};
  const file=path.join(folder,label+'-plan.json');fs.writeFileSync(file,JSON.stringify(value));return file;
}
let good,goodPlan;
h.test('PROBE-01','Node 复核实际运行时及版本，并执行受控零/非零进程保存真实收据',()=>{
  assert.equal(validateRuntime(prepared.runtime.manifest).status,'ready');goodPlan=plan('good');good=runProbePlan(goodPlan,path.join(folder,'good'));assert.equal(good.status,'ready');
  const verified=verifyProbeReport(path.join(folder,'good/coverage-probes.json'),prepared.runtime.manifest,prepared.runtime.sha256,['src/unit.fixture']);assert.equal(verified.status,'ready');
  for(const mode of ['zero','nonzero'])for(const ref of Object.values(good.routes[0].probes[mode].receipts))assert.equal(read(ref.path).exit_code,0);
  return {fixture_boundary:'Controlled counts test transport/integrity, not real product coverage.',report:good};
});
h.test('PROBE-02','保留空原生文件的失败记录，不认证空数据为实测零命中',()=>{
  const result=runProbePlan(plan('empty',{zero:'empty'}),path.join(folder,'empty'));assert.equal(result.status,'partial');assert.match(result.routes[0].probes.zero.reason,/no nonempty native data/);
  assert.throws(()=>verifyProbeReport(path.join(folder,'empty/coverage-probes.json'),prepared.runtime.manifest,prepared.runtime.sha256,['src/unit.fixture']),/lacks passing/);
});
h.test('PROBE-03','读取器修改原生资料时拒绝并保留前后哈希',()=>{
  const result=runProbePlan(plan('mutate',{adapter:'mutate'}),path.join(folder,'mutate'));assert.equal(result.status,'partial');assert.match(result.routes[0].probes.zero.reason,/readers changed native data/);
  const integrity=read(path.join(folder,'mutate/fixture/zero/native-integrity-adapter.json'));assert.equal(integrity.changed.length,1);assert.notDeepEqual(integrity.before,integrity.after);
});
h.test('PROBE-04','适配器与独立输出不一致、零探针出现命中时拒绝就绪',()=>{
  const mismatch=runProbePlan(plan('mismatch',{adapter:'mismatch'}),path.join(folder,'mismatch'));assert.equal(mismatch.status,'partial');assert.match(mismatch.routes[0].probes.zero.reason,/differs from direct/);
  const falseZero=runProbePlan(plan('false-zero',{zero:'nonzero'}),path.join(folder,'false-zero'));assert.equal(falseZero.status,'partial');assert.match(falseZero.routes[0].probes.zero.reason,/Zero-hit native probe/);
});
h.test('PROBE-05','重复目录仍保留，未列入清单的合法程序按实际执行及采集事实判断',()=>{
  assert.throws(()=>runProbePlan(goodPlan,path.join(folder,'good')),/already exists/);
  const file=plan('unprepared'),value=read(file);value.routes[0].zero.collect=['/bin/echo','ACTUAL_PROJECT_COMMAND'];fs.writeFileSync(file,JSON.stringify(value));
  const result=runProbePlan(file,path.join(folder,'unprepared'));assert.equal(result.status,'partial');assert.match(result.routes[0].probes.zero.reason,/no nonempty native data/);
  const receipt=read(path.join(folder,'unprepared/fixture/zero/collect/receipt.json'));
  assert.equal(receipt.exit_code,0);assert.equal(receipt.resolved_executable,fs.realpathSync('/bin/echo'));
  assert.match(fs.readFileSync(receipt.stdout.path,'utf8'),/ACTUAL_PROJECT_COMMAND/);
});
h.test('PROBE-06','Node 报告可由当前 Node 校验器只读复核，保持历史格式兼容',()=>{
  assert.equal(verifyProbeReport(path.join(folder,'good/coverage-probes.json'),prepared.runtime.manifest,prepared.runtime.sha256,['src/unit.fixture']).status,'ready');
});
h.test('PROBE-07','归档映射能读取离线同哈希资料，原生字节漂移后拒绝历史认证',()=>{
  const archive=path.join(folder,'archive');fs.mkdirSync(archive);const originals=[goodPlan,prepared.runtime.manifest];
  function visit(dir){for(const item of fs.readdirSync(dir)){const file=path.join(dir,item);if(fs.statSync(file).isDirectory())visit(file);else originals.push(file);}}visit(path.join(folder,'good'));
  const mapping={};for(const [index,original] of originals.entries()){const file=path.join(archive,index+path.extname(original));fs.copyFileSync(original,file);mapping[original]={path:file,sha256:sha(file)};}
  fs.renameSync(path.join(folder,'good'),path.join(folder,'good-offline'));fs.renameSync(goodPlan,goodPlan+'.offline');
  const reportPath=mapping[path.join(folder,'good/coverage-probes.json')].path,runtimePath=mapping[prepared.runtime.manifest].path;
  assert.equal(verifyProbeReport(reportPath,runtimePath,prepared.runtime.sha256,['src/unit.fixture'],{verifyRuntime:false,mapping}).status,'ready');
  const native=good.routes[0].probes.nonzero.native[0].path;fs.appendFileSync(mapping[native].path,' ');
  assert.throws(()=>verifyProbeReport(reportPath,runtimePath,prepared.runtime.sha256,['src/unit.fixture'],{verifyRuntime:false,mapping}),/bound artifact missing or changed/);
});
h.test('PROBE-08','失败探针把具体路由、模式、退出码和原始堆栈交给准备修复流程',()=>{
  const file=plan('diagnostic'),value=read(file);value.routes[0].zero.adapter=[process.execPath,'-e','throw new Error("READER_DIAGNOSTIC_MARKER")'];fs.writeFileSync(file,JSON.stringify(value));
  const result=runProbePlan(file,path.join(folder,'diagnostic')),failure=result.routes[0].probes.zero;
  assert.equal(failure.status,'failed');assert.match(failure.reason,/"route":"fixture"/);assert.match(failure.reason,/"mode":"zero"/);
  assert.match(failure.reason,/"exit_code":1/);assert.match(failure.reason,/READER_DIAGNOSTIC_MARKER/);assert.match(failure.reason,/receipt.json/);
  assert.throws(()=>verifyProbeReport(path.join(folder,'diagnostic/coverage-probes.json'),prepared.runtime.manifest,prepared.runtime.sha256,['src/unit.fixture']),/READER_DIAGNOSTIC_MARKER/);
});
h.finish(['workflows/shared/runtime.mjs','workflows/shared/coverage-probes.mjs','tests/node_coverage_probes.integration.mjs']);
