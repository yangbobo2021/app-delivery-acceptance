import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {readKnowledge} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/knowledge.mjs';
import {sceneInput} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/definitions.mjs';
import {executeScenario} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/execute/stage.mjs';
import {verifyIdentity} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/identity.mjs';
import {finalizeIdentities} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/identity.mjs';
import {prepare as runtimePrepare,finalize as runtimeFinalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/runtime/stage.mjs';
import {harness,read,sha,skill} from './official_workflow_harness.mjs';
const h=harness('acceptance-execute',[['acceptance-execute','execute']]),root=h.project('project'),at='AT-execution',repairCheckpoint=process.argv.includes('--repair-checkpoint'),repairFixture=process.argv.includes('--repair-fixture')||repairCheckpoint;
fs.mkdirSync(path.join(root,'src'));fs.mkdirSync(path.join(root,'tests'));
fs.writeFileSync(path.join(root,'src/product.mjs'),'export const classify = value => value > 0 ? "positive" : "nonpositive";\n');
fs.writeFileSync(path.join(root,'tests/selected.mjs'),`import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {classify} from '../src/product.mjs';
function positive(){ assert.equal(classify(1),'positive'); }
function nonpositive(){ ${repairFixture?"assert.equal(typeof classify(0),'string');":"assert.equal(classify(0),'nonpositive'); assert.equal(classify(-1),'nonpositive');"} }
const selection=process.argv[2],ran=[];
for(const [name,test] of [['positive',positive],['nonpositive',nonpositive]])if(!selection||selection===name){test();ran.push(name);}
assert.ok(ran.length);
const file=path.join(process.env.FIXTURE_STATE,'ran.json');
assert.equal(fs.existsSync(file),false,'fresh state must be unused');
fs.writeFileSync(file,JSON.stringify({ran}));
console.log(JSON.stringify({actual_cases:ran,oracle:'original sign classification contract',fresh_state:file}));
`);
h.run('git-init','git',['init','-q',root]);h.run('git-add','git',['-C',root,'add','.']);h.run('git-commit','git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@local','commit','-qm','classification contract']);
const revision=h.run('git-head','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'验证指定永久用例重跑及检查点继续。'});
const frozen=freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'Controlled execution contract supplied by test author',definitions:{project:{id:'sign-classification'},context:{business_goal:'Verify sign classification without losing execution evidence.'},requirements:[{id:'R1',text:'A positive number is positive; zero and a negative number are nonpositive.',origin:{kind:'fixture-user',reference:'test-author-contract'},external_refs:[]}],scenarios:[{id:'S1',requirement_id:'R1',description:'Check positive, zero and negative values against the sign classification contract.',priority:'P0',priority_reason:'Core classification contract',origin:{kind:'fixture-user',reference:'test-author-scenario'},external_refs:[],check:{method:'adopt-existing',basis:'Directly supplied contract'}}]}});
const local=path.join(root,'.acceptance-local',at);
const runtimeSpec=runtimePrepare({project_root:root,acceptance_id:at,request_id:'runtime',definitions_sha256:frozen.definitions.sha256,source_checkout:root,revision,test_roots:['tests'],inspection_files:['src/product.mjs'],available_executables:[{name:'node',path:process.execPath}]});
const runtime=runtimeFinalize(runtimeSpec,JSON.stringify({dependency_files:[],knowledge_used:['INDEX.md'],setup_commands:[],executables:[{name:'node',path:process.execPath,version_command:[process.execPath,'--version']}],smoke:{command:[process.execPath,'-e','require("node:assert/strict"); console.log("NODE_BUILTIN_ASSERT_READY")'],cwd:'{workspace}'},recipe_candidate:'# Fixture Node runtime\nUse the verified local Node executable and built-in assert/fs modules. No installation or product business test is needed for this smoke.'}));
assert.equal(runtime.status,'ready');const workspace=runtime.workspace;
const fixture=path.join(local,'workflows/ready-case');fs.mkdirSync(fixture,{recursive:true});const knowledge=readKnowledge(root,at,[]),caseInput={acceptance:knowledge.acceptance,...sceneInput({acceptance:knowledge.acceptance,definitions:frozen.definitions},'S1')},catalog={schema:'portable-project-catalog-v1',acceptance:knowledge.acceptance,definitions:frozen.definitions,workspace_policy:'single-acceptance-v1',project_root:workspace,revision,components:[],test_roots:['tests'],write_roots:['tests'],source_hashes:{'src/product.mjs':sha(path.join(workspace,'src/product.mjs'))},coverage:{policy:'off',reason:'This fixture validates execution scheduling, not tool coverage.'}};
const inputFile=path.join(fixture,'case-input.json'),catalogFile=path.join(fixture,'catalog.json'),answerFile=path.join(fixture,'answer.json');fs.writeFileSync(inputFile,JSON.stringify(caseInput));fs.writeFileSync(catalogFile,JSON.stringify(catalog));
catalog.runtime=runtime.runtime;fs.writeFileSync(catalogFile,JSON.stringify(catalog));
fs.writeFileSync(answerFile,JSON.stringify({status:'host_ready',test_files:['tests/selected.mjs'],test_command:[process.execPath,'tests/selected.mjs'],case_descriptions:[{id:'positive',name:'Positive sign',method:'Call the real classify function',assertions:'The result equals positive',boundary:'Positive value',source:{file:'tests/selected.mjs',line_start:5,line_end:5,title:'positive',id_comment:'// {id}'}},{id:'nonpositive',name:'Zero and negative sign',method:'Call the real classify function',assertions:'Zero and a negative value equal nonpositive',boundary:'Includes zero',source:{file:'tests/selected.mjs',line_start:6,line_end:6,title:'nonpositive',id_comment:'// {id}'}}]}));
// Deterministic ready-case fixture; the actual Node identity implementation is
// independently checked against old report readers by the protocol regressions.
finalizeIdentities(catalog,caseInput,fixture);
const answer=read(answerFile),ids=answer.case_descriptions.map(item=>item.id);verifyIdentity(answer,workspace,{sceneId:'S1',acceptanceId:at});
const request={project_root:root,acceptance_id:at,request_id:'rerun-positive',definitions_sha256:frozen.definitions.sha256,basis:'User explicitly requests only the positive permanent test to rerun.',case_input:inputFile,case_answer:answerFile,catalog:catalogFile,selected_case_ids:[ids[0]],execution_command:[process.execPath,'tests/selected.mjs','positive'],selection_basis:'The test entry filters the exact named declaration positive; its permanent ID is bound in the identity report.',max_review_repairs:0,execution_settings:{fresh_env_root_key:'FIXTURE_STATE',evidence_env_dir_keys:['FIXTURE_STATE']}};
if(repairFixture){
  request.request_id='bounded-repair';request.basis='User requests the full frozen scene, with one finite test repair attempt if independent review finds a concrete gap.';delete request.selected_case_ids;delete request.execution_command;delete request.selection_basis;request.max_review_repairs=1;request.guide=path.join(fixture,'guide.json');fs.writeFileSync(request.guide,JSON.stringify({summary:'Actual Node runtime and built-in assert/fs/path are ready; keep product source unchanged and repair only concrete test gaps.',fixture_isolation:'The bound debug entry supplies fresh FIXTURE_STATE for each attempt. Return the original Node business command.',environment_contract:[]}));
}
h.save('request.json',request);h.save('fixture.json',{root,at,workspace,inputFile,answerFile,catalogFile,ids,runtime,fixture_boundary:'The already-ready case and verified runtime are deterministic Node fixtures. Live execution and review below use Node; this test needs no Python executable.'});
async function check(id,purpose,operation){try{const value=await operation();h.test(id,purpose,()=>value);}catch(error){h.test(id,purpose,()=>{throw error;});}}
await check('EXECUTE-01','Unknown permanent IDs and implicit subset commands stop before any real test',async()=>{
  const wrong=await executeScenario({...request,request_id:'bad-id',selected_case_ids:['TC-unknown']});assert.equal(wrong.status,'blocked');assert.match(wrong.reason,/unknown/);
  const implicit={...request,request_id:'implicit-subset',selected_case_ids:[ids[0]]};delete implicit.execution_command;const result=await executeScenario(implicit);assert.equal(result.status,'blocked');assert.match(result.reason,/subset rerun needs/);
  assert.equal(fs.existsSync(path.join(local,'workflows/execute/bad-id')),false);
});
let checkpoint,receiptHash;
await check('EXECUTE-02',repairFixture?'A real intentionally insufficient case group executes, freezes its actual receipt and stops before independent review':'A real Node test command executes only the selected TC, freezes receipt and stops before Reviewer',async()=>{
  checkpoint=await executeScenario({...request,stop_after:'execution'});assert.equal(checkpoint.status,'stopped',checkpoint.reason);assert.equal(checkpoint.stopped_after,'execution');
  const receipt=read(path.join(checkpoint.directory,'execution/execution.json'));receiptHash=sha(path.join(checkpoint.directory,'execution/execution.json'));assert.equal(receipt.exit_code,0);assert.deepEqual(read(path.join(receipt.env_changes.FIXTURE_STATE,'ran.json')).ran,repairFixture?['positive','nonpositive']:['positive']);
  assert.equal(fs.existsSync(path.join(checkpoint.directory,'review')),false);assert.equal(read(path.join(local,'workspace-owner.json')).output_dir,checkpoint.directory);assert.equal(read(path.join(root,'.acceptance-local/current.json')).acceptance_id,at);
  return {checkpoint,receipt};
});
if(!process.argv.includes('--stop-at-execution'))await check('EXECUTE-03','Continue through evidence and deterministic handoff without replaying the recorded command',async()=>{
  const value=await executeScenario({...request,stop_after:'gate'});assert.equal(value.status,'stopped',value.reason);assert.equal(value.stopped_after,'gate');assert.equal(sha(path.join(value.directory,'execution/execution.json')),receiptHash);assert.equal(read(path.join(value.directory,'handoff-gate.json')).status,'ready_for_review');
  const manifest=read(path.join(value.directory,'frozen-evidence.json'));assert.ok(manifest.files.some(item=>item.source.endsWith('ran.json')));for(const item of manifest.files)assert.equal(sha(item.path),item.sha256);
});
if(h.live)await check('EXECUTE-04',repairFixture?'Real independent review identifies the seeded test gap, one Node repair retains IDs and a new execution/review verifies the full scene':'Real official CLI resumes the checkpoint and obtains independent judgment against only the selected TC',async()=>{
  let repairHashes;
  if(repairCheckpoint){
    const paused=h.cli('acceptance-execute',{...request,stop_after:'repair'},'live-stop-after-repair',root,{timeout:1000000,env:{...process.env,ACCEPTANCE_AGENT:'codex',ACCEPTANCE_MODEL:'gpt-6.1-sol',SPEX_HOME:path.join(h.temporary,'spex')}});h.settled(paused,'acceptance-execute','done');
    assert.equal(read(path.join(checkpoint.directory,'state.json')).stages['repair-1'].status,'completed');assert.equal(fs.existsSync(path.join(checkpoint.directory,'execution-review-1')),false);assert.equal(fs.existsSync(path.join(checkpoint.directory,'result.json')),false);
    repairHashes=Object.fromEntries(['repair-1/metrics.json','repair-1/answer.json','review/answer.json'].map(name=>[name,sha(path.join(checkpoint.directory,name))]));h.save('repair-checkpoint.json',{directory:checkpoint.directory,repairHashes,first_execution_sha256:receiptHash});
  }
  const cli=h.cli('acceptance-execute',request,'live-execute',root,{timeout:1000000,env:{...process.env,ACCEPTANCE_AGENT:'codex',ACCEPTANCE_MODEL:'gpt-6.1-sol',SPEX_HOME:path.join(h.temporary,'spex')}});h.settled(cli,'acceptance-execute','done');
  const value=read(path.join(checkpoint.directory,'result.json'));assert.equal(value.status,'completed');assert.equal(value.review_status,'passed');
  if(repairFixture){assert.equal(value.review_applies_to,'frozen_scene');assert.equal(value.scene_review_status,'passed');assert.equal(value.repair_attempts,1);assert.equal(read(path.join(checkpoint.directory,'review/answer.json')).status,'repair_required');assert.equal(read(path.join(checkpoint.directory,'review-review-1/answer.json')).status,'passed');assert.deepEqual(read(value.active_case_answer).case_descriptions.map(item=>item.id).sort(),[...ids].sort());}
  else{assert.equal(value.review_applies_to,'selected_cases_only');assert.equal(value.scene_review_status,'not_revalidated');assert.deepEqual(value.unselected_case_ids,[ids[1]]);}
  assert.equal(sha(path.join(checkpoint.directory,'execution/execution.json')),receiptHash);assert.equal(fs.existsSync(path.join(local,'workspace-owner.json')),false);assert.equal(read(path.join(root,'.acceptance-local/current.json')).acceptance_id,at);
  const metrics=read(path.join(checkpoint.directory,'review/metrics.json'));assert.equal(metrics.agent_runtime.transport.kind,'official-playbook-cli');assert.equal(read(path.join(checkpoint.directory,'review/decision-gate.json')).status,'valid');
  if(repairHashes)for(const [name,expected]of Object.entries(repairHashes))assert.equal(sha(path.join(checkpoint.directory,name)),expected,'A completed repair or review was repeated or changed during continuation');
  const cached=await executeScenario(request);assert.equal(cached.reused,true);assert.equal(cached.review_status,'passed');return {result:value,metrics};
});
h.finish(['workflows/execute/stage.mjs','workflows/execute/registry.mjs','workflows/shared/recorder.mjs','workflows/shared/evidence.mjs','workflows/shared/review-gates.mjs','tests/acceptance_execute.integration.mjs']);
