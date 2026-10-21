import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const [project, runId, mode='standard', style='partial'] = process.argv.slice(2);
const require=createRequire(new URL('../playbook/package.json',import.meta.url));
const {createActor,fromPromise}=require('xstate');
const {deliveryAcceptanceMachine}=await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.fsm.ts');
const skill=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const testDir=resolve(project,process.env.DELIVERY_ACCEPTANCE_TEST_DIR||'tests');
const calls=[],scripts=[];
const detail='P0 已验证；P1 未执行，完整验收未完成。';
const actor=createActor(deliveryAcceptanceMachine.provide({actors:{
  script:fromPromise(async({input})=>{
    if (['analysisGate','generationGate'].includes(input.stateId)) return {guard:'passed',exitStatus:0};
    if(input.stateId==='organizationGate')return {guard:'passed',exitStatus:0};
    calls.push(input.stateId);
    const result=spawnSync('sh',['-c',input.command],{cwd:project,encoding:'utf8'});
    const exitStatus=result.status??127;scripts.push({stateId:input.stateId,exitStatus});
    return {guard:exitStatus===0?'passed':'failed',exitStatus};
  }),
  player:fromPromise(async({input})=>{
    // New prerequisites are isolated here; workflow_pipeline_probe uses their real scripts.
    if (['sourceAnalysis','organizationDesign'].includes(input.stateId)) return {guard:'done'};
    calls.push(input.stateId);
    switch(input.stateId){
      // Isolate downstream routing; workflow_scope_probe exercises the real organization gate.
    case 'organizationReview':return {guard:'passed'};
    case 'entry1':case 'resource1':return {guard:'ready'};
      case 'scenario1':case 'scenario3':case 'scenario5':case 'execution4':case 'execution5':return {guard:'done'};
      case 'scenario2':return {guard:'passed'};
      case 'execution1':return {guard:style==='false-full'?'recorded':'partialRecorded',runId};
      case 'execution2':return style==='false-full'||style==='false-review'?{guard:'sufficient'}:{guard:'partial',reviewFindings:detail};
      default:throw new Error('unexpected partial actor '+input.stateId);
    }
  }),
  captain:fromPromise(async({input})=>{calls.push(input.stateId);return {guard:'accepted',response:'Captain claims accepted'};})
}}),{input:{project,testDir,requirementsFile:resolve(project,'approved.json'),skill,coverageMode:mode}});
const terminal=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('priority workflow timeout '+calls)),12000);
  actor.subscribe({next(s){if(s.status==='done'||s.status==='error'||s.matches('failed')){clearTimeout(timer);resolve(s);}},error(e){clearTimeout(timer);reject(e);}});
});
actor.start();actor.send({type:'BOSS_TASK',bossIntent:'验证用户指定的重要度范围。'});
const s=await terminal;actor.stop();
assert.notEqual(s.output?.status,'accepted');
if(style==='partial'){
  assert.equal(s.value,'incomplete');assert.equal(s.output.runId,runId);assert.equal(s.output.failureDetails,detail);
  assert.equal(calls.filter(v=>v==='execution1').length,1);
  assert.equal(calls[calls.indexOf('execution1')+1],'execution2');
  assert.ok(!calls.some(v=>v.startsWith('coverage')));
  assert.ok(!calls.includes('execution4')&&!calls.includes('execution5'));
}
console.log(JSON.stringify({mode,style,state:s.value,output:s.output,calls,scripts},null,2));
