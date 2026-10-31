import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize,fail} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/runtime/stage.mjs';
import {harness,read,sha,snapshot,skill} from './official_workflow_harness.mjs';
import {validateRuntime,projectEnvironment} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/runtime.mjs';

const h=harness('acceptance-runtime',[['acceptance-runtime','runtime',{preparer:'acceptance.runtime-preparer'}]]);
function fixture(label){
  const root=h.project(label),at='AT-'+label;fs.mkdirSync(path.join(root,'test'));
  fs.writeFileSync(path.join(root,'.gitignore'),'.runtime-cache/\n');
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'runtime-fixture',private:true,type:'module',scripts:{prepare:'node setup.mjs',smoke:'node smoke.mjs',test:'node --test test/business.test.mjs'}},null,2));
  fs.writeFileSync(path.join(root,'setup.mjs'),"import fs from 'node:fs';fs.mkdirSync('.runtime-cache',{recursive:true});fs.writeFileSync('.runtime-cache/ready','prepared');console.log('SETUP_READY');\n");
  fs.writeFileSync(path.join(root,'smoke.mjs'),"import fs from 'node:fs';if(fs.readFileSync('.runtime-cache/ready','utf8')!=='prepared')process.exit(3);console.log('RUNTIME_SMOKE_READY');\n");
  fs.writeFileSync(path.join(root,'test/business.test.mjs'),"import fs from 'node:fs';fs.writeFileSync('BUSINESS_TEST_WAS_RUN','unexpected');throw Error('Business test is outside runtime preparation');\n");
  fs.writeFileSync(path.join(root,'README.md'),`This fixture uses Node.js. Available executable: ${process.execPath}. No external dependencies or lockfile. Required runtime setup: execute setup.mjs with the available Node executable in workspace; it writes only ignored .runtime-cache/ready. Smoke: execute smoke.mjs through that same executable in workspace. This checks readiness only, no business assertions. Do not run the business test. Existing test entry: Node --test test/business.test.mjs. Use package.json as the dependency manifest. Record Node with its --version output.\n`);
  h.run(label+'-git-init','git',['init','-q',root]);h.run(label+'-git-add','git',['-C',root,'add','.']);h.run(label+'-git-commit','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','runtime fixture']);
  const revision=h.run(label+'-revision','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
  createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'只准备运行环境，禁止执行业务测试。'});
  freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'用户明确只准备运行环境。',definitions:{context:{business_goal:'建立本次测试执行环境。'},requirements:[{id:'R1',text:'用户可以读取已保存条目。',origin:{kind:'user-statement',reference:'fixture:user'},external_refs:[]}]}});
  return {root,at,revision};
}
const f=fixture('runtime-protocol'),latest=x=>path.join(x.root,'.acceptance',x.at,'scenarios.json');
const input=(id,extra={},x=f)=>({project_root:x.root,acceptance_id:x.at,request_id:id,definitions_sha256:sha(latest(x)),source_checkout:x.root,revision:x.revision,test_roots:['test'],inspection_files:['README.md','package.json','setup.mjs','smoke.mjs'],available_executables:[{name:'node',path:process.execPath}],...extra});
const answer=()=>({dependency_files:['package.json'],knowledge_used:['INDEX.md'],setup_commands:[{command:[process.execPath,'setup.mjs'],cwd:'{workspace}',timeout_seconds:10}],executables:[{name:'node',path:process.execPath,version_command:[process.execPath,'--version']}],smoke:{command:[process.execPath,'smoke.mjs'],cwd:'{workspace}',timeout_seconds:10},recipe_candidate:'# Runtime recipe\nUse project setup.mjs through the installed Node executable, then smoke.mjs in the same workspace. No global installation or business test is required.'});
const conclude=(spec,value)=>{try{return finalize(spec,JSON.stringify(value));}catch(e){fail(spec,e.message);throw e;}};
let req,spec,result;
h.test('RUNTIME-01','创建本 AT 唯一隔离工作树并交接实际项目资料与知识',()=>{
  req=input('first');spec=prepare(req);assert.ok(spec.data.inspection.workspace.endsWith('/.acceptance-local/'+f.at+'/workspace'));assert.ok(spec.prompt.includes('RUNTIME_SMOKE_READY'));assert.ok(spec.data.inspection.knowledge['INDEX.md']);assert.deepEqual(spec.data.inspection.knowledge_keys,['INDEX.md']);
});
h.test('RUNTIME-02','宿主真实执行 setup、版本探针和 smoke，记录可复验清单后停止',()=>{
  const before=sha(latest(f));result=conclude(spec,answer());assert.equal(result.status,'ready');assert.equal(result.product_judgment,'not_performed');assert.equal(sha(latest(f)),before);
  const manifest=read(result.runtime.manifest);assert.equal(manifest.setup.length,1);assert.equal(manifest.setup[0].exit_code,0);assert.equal(manifest.smoke.exit_code,0);assert.ok(fs.readFileSync(manifest.smoke.log,'utf8').includes('RUNTIME_SMOKE_READY'));
  assert.ok(fs.readFileSync(manifest.setup[0].log,'utf8').includes('SETUP_READY'));assert.equal(manifest.executables[0].resolved_path,fs.realpathSync(process.execPath));assert.equal(fs.readFileSync(path.join(result.workspace,'.runtime-cache/ready'),'utf8'),'prepared');
  assert.ok(!fs.existsSync(path.join(result.workspace,'BUSINESS_TEST_WAS_RUN')));assert.ok(!fs.existsSync(path.join(f.root,'.runtime-cache')));h.save('protocol-result.json',result);
});
h.test('RUNTIME-03','重复请求只复核已有环境，不再安装或调用角色，原清单字节不变',()=>{
  const manifestBefore=sha(result.runtime.manifest),setup=sha(path.join(spec.folder,'runtime/setup-00.log')),again=prepare(req).completed;
  assert.equal(again.status,'ready');assert.equal(again.revalidated,true);assert.equal(sha(result.runtime.manifest),manifestBefore);assert.equal(sha(path.join(spec.folder,'runtime/setup-00.log')),setup);
});
h.test('RUNTIME-04','实际 smoke 失效使复用返回 stale，不改写原 ready 事实',()=>{
  const marker=path.join(result.workspace,'.runtime-cache/ready');fs.writeFileSync(marker,'broken');const stale=prepare(req).completed;assert.equal(stale.status,'stale');assert.equal(stale.historical_report_preserved,true);assert.equal(read(result.runtime.manifest).status,'ready');fs.writeFileSync(marker,'prepared');
});
h.test('RUNTIME-05','真实执行器、知识和清单引用被核对，不以模型自述当就绪',()=>{
  const attempt=prepare(input('unknown-knowledge'));assert.throws(()=>conclude(attempt,{...answer(),knowledge_used:['INDEX.md','never-read.md']}),/actually read indexed/);
  const another=prepare(input('wrong-executable'));assert.throws(()=>conclude(another,{...answer(),executables:[{name:'missing',path:'/missing/tool',version_command:['/missing/tool','--version']}]}),/existing executable/);
});
h.test('RUNTIME-06','角色执行期间项目字节变化被拒绝，即使 git status 文件集合相同',()=>{
  const attempt=prepare(input('changed-inspection')),file=path.join(result.workspace,'README.md'),original=fs.readFileSync(file);fs.appendFileSync(file,'changed');assert.throws(()=>conclude(attempt,answer()),/changed workspace bytes/);fs.writeFileSync(file,original);
});
h.test('RUNTIME-07','失败的实际命令保留退出码和首次日志，不生成流程就绪回执',()=>{
  const attempt=prepare(input('failed-smoke')),value={...answer(),smoke:{command:[process.execPath,'-e','console.log("FAILURE_EVIDENCE");process.exit(7)'],timeout_seconds:10}};
  assert.throws(()=>conclude(attempt,value),/did not succeed/);assert.ok(fs.readFileSync(path.join(attempt.folder,'runtime/smoke.log'),'utf8').includes('FAILURE_EVIDENCE'));
  assert.ok(fs.existsSync(path.join(attempt.folder,'runtime/failure.json')));assert.ok(!fs.existsSync(path.join(attempt.folder,'result.json')));
});
h.test('RUNTIME-08','setup 修改源码时拒绝环境就绪，不把命令 exit 0 当通过',()=>{
  const x=fixture('runtime-code-mutation'),attempt=prepare(input('mutate',{},x)),value={...answer(),setup_commands:[...answer().setup_commands,{command:[process.execPath,'-e',"require('fs').appendFileSync('README.md','unauthorized')"]}]};
  assert.throws(()=>conclude(attempt,value),/changed tracked project files/);assert.ok(!fs.existsSync(path.join(attempt.folder,'result.json')));
});
h.test('RUNTIME-09','不同 AT 必须建立并核验自己的环境，不复制旧 runtime 收据',()=>{
  const x=fixture('runtime-another-at'),attempt=prepare(input('new-at',{},x)),fresh=conclude(attempt,answer());assert.notEqual(fresh.workspace,result.workspace);const manifest=read(fresh.runtime.manifest);assert.equal(manifest.acceptance.id,x.at);assert.ok(manifest.setup[0].log.includes(x.at));
});
h.test('RUNTIME-10','过期修订、无实际项目资料及请求身份冲突在角色前拒绝',()=>{
  assert.throws(()=>prepare(input('wrong-revision',{revision:'0'.repeat(40)})),/source revision differs/);assert.throws(()=>prepare(input('no-inspection',{inspection_files:[]})),/inspection_files/);assert.throws(()=>prepare({...req,test_roots:['different']}),/request_id conflicts/);
});
h.test('RUNTIME-INPUT-01','Monorepo subdirectory is rejected before worktree creation with the actual checkout root and relative-path correction',()=>{
  const x=fixture('nested-checkout'),sub=path.join(x.root,'subproject');fs.mkdirSync(sub);
  let error;try{prepare(input('nested-root',{source_checkout:sub},x));}catch(e){error=e;}
  assert.ok(error);assert.ok(error.message.includes('complete Git checkout root: '+fs.realpathSync(x.root)));assert.match(error.message,/Prefix inspection_files and test_roots/);
  assert.equal(fs.existsSync(path.join(x.root,'.acceptance-local',x.at,'workspace')),false);
  const corrected=conclude(prepare(input('corrected-root',{},x)),answer());assert.equal(corrected.status,'ready');
});
h.test('RUNTIME-INPUT-02','A filesystem-form knowledge path is rejected with exact allowed logical keys and can be corrected in a new attempt',()=>{
  const attempt=prepare(input('wrong-knowledge-path'));assert.throws(()=>conclude(attempt,{...answer(),knowledge_used:['.acceptance/knowledge/INDEX.md']}),/allowed logical keys: \["INDEX.md"\]/);
  assert.equal(fs.existsSync(path.join(attempt.folder,'result.json')),false);
  const corrected=conclude(prepare(input('corrected-knowledge-path')),answer());assert.equal(corrected.status,'ready');
});
h.test('RUNTIME-ENV-01','Project command environment is expanded, verified by actual smoke and frozen separately from model settings',()=>{
  const attempt=prepare(input('execution-env')),value={...answer(),execution_env:{PROJECT_TOOL_FLAG:'ready',PROJECT_TOOL_CACHE:'{runtime_root}/cache'},smoke:{command:[process.execPath,'-e','const a=require("node:assert/strict");a.equal(process.env.PROJECT_TOOL_FLAG,"ready");a.ok(process.env.PROJECT_TOOL_CACHE.endsWith("/runtime/cache"));console.log("PROJECT_ENV_VERIFIED")']}};
  const ready=conclude(attempt,value),manifest=read(ready.runtime.manifest),env=projectEnvironment({runtime:ready.runtime});
  assert.equal(env.PROJECT_TOOL_FLAG,'ready');assert.equal(manifest.smoke.env.PROJECT_TOOL_CACHE,env.PROJECT_TOOL_CACHE);
  assert.ok(fs.readFileSync(manifest.smoke.log,'utf8').includes('PROJECT_ENV_VERIFIED'));
  const before=fs.readFileSync(ready.runtime.manifest);manifest.execution_env.PROJECT_TOOL_FLAG='changed';fs.writeFileSync(ready.runtime.manifest,JSON.stringify(manifest));
  try{assert.throws(()=>validateRuntime(ready.runtime.manifest),/execution environment differs/);assert.throws(()=>projectEnvironment({runtime:ready.runtime}),/binding missing or changed/);}finally{fs.writeFileSync(ready.runtime.manifest,before);}
});
h.test('RUNTIME-ENV-02','Invalid non-string project environment cannot publish a ready runtime',()=>{
  const attempt=prepare(input('invalid-execution-env'));assert.throws(()=>conclude(attempt,{...answer(),execution_env:{PROJECT_TOOL_FLAG:1}}),/explicit string values/);assert.equal(fs.existsSync(path.join(attempt.folder,'result.json')),false);
});
if(h.live){
  const live=fixture('live-runtime');
  h.test('RUNTIME-11','真实官方 CLI 的独立 Preparer 选择项目入口，宿主实际安装并核验 smoke',()=>{
    const request=input('live-prepare',{},live),before=sha(latest(live)),response=h.cli('acceptance-runtime',request,'live-prepare',live.root);h.settled(response,'acceptance-runtime','done');
    const value=read(path.join(live.root,'.acceptance-local',live.at,'workflows/runtime/live-prepare/result.json')),manifest=read(value.runtime.manifest);
    assert.equal(value.status,'ready');assert.equal(manifest.acceptance.id,live.at);assert.ok(manifest.setup.length>=1);assert.ok(fs.readFileSync(manifest.smoke.log,'utf8').includes('RUNTIME_SMOKE_READY'));
    assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,1);assert.equal(sha(latest(live)),before);assert.ok(!fs.existsSync(path.join(value.workspace,'BUSINESS_TEST_WAS_RUN')));assert.ok(!fs.existsSync(path.join(live.root,'.runtime-cache')));
    h.save('live-input.json',request);h.save('live-result.json',value);h.save('live-manifest.json',manifest);return {output:response.envelope};
  });
  h.test('RUNTIME-12','真实 CLI 重入只复验 smoke，不重复调用或重新准备',()=>{
    const response=h.cli('acceptance-runtime',read(path.join(h.output,'live-input.json')),'live-runtime-repeat',live.root);h.settled(response,'acceptance-runtime','done');assert.equal(response.traces.filter(t=>t.type==='player.call.started').length,0);
  });
}
h.finish(['workflows/runtime/stage.mjs','workflows/runtime/registry.mjs','tests/acceptance_runtime.integration.mjs']);
