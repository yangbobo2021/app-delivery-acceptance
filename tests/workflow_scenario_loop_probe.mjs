import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../playbook/package.json',import.meta.url));
const {createActor,fromPromise}=require('xstate');
const {deliveryAcceptanceMachine}=await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.fsm.ts');
const {default:createPlaybookRuntime}=await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.playbook.ts');
assert.ok(createPlaybookRuntime);
const reports=[];
for(const variant of ['pass','repair','bug','ai_error','pause','test_commit','gate_repair','gate_invalidated','coverage']) {
 const calls=[],scripts=[],queue=['P0-A','P0-B','P1-A'];let selected=0, repaired=false,paused=false, gateRejected=false;let actor;
 const provide=deliveryAcceptanceMachine.provide({actors:{
  player:fromPromise(async({input})=>{
    // New prerequisites are isolated here; workflow_pipeline_probe uses their real scripts.
    if (['sourceAnalysis','organizationDesign'].includes(input.stateId)) return {guard:'done'};
   calls.push({id:input.stateId,scenarioId:input.scenarioId});
   switch(input.stateId){
    // Isolate downstream routing; workflow_scope_probe exercises the real organization gate.
    case 'organizationReview':return {guard:'passed'};
    case 'entry1':case 'resource1':return {guard:'ready'};
    case 'scenario1':case 'scenario3':case 'scenario5':case 'execution4':case 'execution5':case 'coverage4':return {guard:'done'};
    case 'scenario2':return {guard:'passed'};
    case 'execution1':return selected<queue.length?{guard:'selected',runId:'run-loop',scenarioId:queue[selected++]}:{guard:'recorded',runId:'run-loop'};
    case 'executionPrepare':
     assert.equal(input.scenarioId,queue[selected-1]);
     if(variant==='pause'&&!paused){paused=true;return {guard:'needsBossReply',question:'Fixture capability recovery detail?'};}
     return {guard:variant==='test_commit'?'testsPrepared':'ready'};
    case 'executionOperate':return {guard:'observed'};
    case 'executionEvaluate':
     if(variant==='repair'&&!repaired){repaired=true;return {guard:'repairRequired',executionFindings:'Evidence omits storage state; correct and rerun this same scenario'};}
     return {guard:'evaluated'};
    case 'executionRecordRepair':return variant==='gate_invalidated'?{guard:'invalidated',failureDetails:'External product manifest changed; preserve incomplete run'}:{guard:'repairRequired',executionFindings:'Repair current scene recording and rerun before advancing'};
    case 'execution2':return ['bug','ai_error'].includes(variant)?{guard:'productFailed',reviewFindings:variant==='bug'?'Confirmed BUGs recorded; later scenes executed':'AI capability failure separately recorded; later scenes executed'}:{guard:'sufficient'};
    case 'coverage1':return {guard:'measured'};
    case 'coverage2':return {guard:'sufficient'};
    default:throw Error('unexpected '+input.stateId);
   }
  }),
  script:fromPromise(async({input})=>{
    if (['analysisGate','generationGate'].includes(input.stateId)) return {guard:'passed',exitStatus:0};
   scripts.push(input.stateId);
   assert.ok(!input.command.includes('<scenario-id>'));
   const bad=['gate_repair','gate_invalidated'].includes(variant)&&!gateRejected&&input.stateId==='executionScenarioGate';
   if(bad)gateRejected=true;
   return {guard:bad?'failed':'passed',exitStatus:bad?2:0};
  }),
  captain:fromPromise(async()=>({guard:'accepted',response:'Fixture controller report'}))
 }});
 actor=createActor(provide,{input:{project:'/tmp/fixture-project',testDir:'/tmp/fixture-results',requirementsFile:'/tmp/fixture-project/confirmed.json',skill:'/tmp/fixture-skill',coverageMode:variant==='coverage'?'coverage':'standard'}});
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('loop timeout '+variant)),8000);
  actor.subscribe({next(s){
   if(s.matches('awaitBossReply'))actor.send({type:'BOSS_REPLY',answer:'Retry fixture operation with supported capability'});
   if(s.status==='done'||s.status==='error'||s.matches('failed')){clearTimeout(timer);resolve(s);}
  },error(e){clearTimeout(timer);reject(e);}});
 });
 actor.start();actor.send({type:'BOSS_TASK',bossIntent:'Process priority scenarios one at a time, repair execution defects within each scene'});
 const snapshot=await done;actor.stop();
 assert.equal(snapshot.value,['bug','ai_error','gate_invalidated'].includes(variant)?'incomplete':'done',JSON.stringify({variant,calls,snapshot:snapshot.value}));
 const evalCalls=calls.filter(c=>c.id==='executionEvaluate');
 const startCalls=calls.filter(c=>c.id==='executionPrepare');
 if(variant==='gate_invalidated')assert.equal(selected,1);
 else assert.equal(selected,queue.length);
 if(['repair','gate_repair'].includes(variant)){
  assert.equal(evalCalls[0].scenarioId,evalCalls[1].scenarioId);
  assert.equal(startCalls[0].scenarioId,startCalls[1].scenarioId);
  assert.equal(evalCalls.length,4);
 }else if(variant!=='gate_invalidated')assert.equal(evalCalls.length,3);
 for(let i=0;i<calls.length;i++){
  if(calls[i].id!=='execution1'||!calls.slice(0,i).some(c=>c.id==='executionEvaluate'))continue;
  assert.equal(calls[i-1].id,'executionEvaluate');
 }
 if(variant==='coverage')assert.ok(scripts.includes('coverage3'));
 reports.push({variant,state:snapshot.value,calls,scripts});
}
console.log(JSON.stringify({status:'passed',cases:reports.length,reports},null,2));
