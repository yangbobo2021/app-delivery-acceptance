import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../playbook/package.json',import.meta.url));
const {createActor,fromPromise}=require('xstate');
const {deliveryAcceptanceMachine:machine}=await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.fsm.ts');
const reports=[];
// Drive legal contexts through the real machine; keep official finite-probe failures visible.
for (const target of ['coverage1','coverage2','coverage3','coverage4','execution4']) {
  const calls=[];let entered=0,interrupted=false,runs=0,actor;
  async function perform(input) {
    calls.push(input.stateId);
    if(input.stateId===target && target!=='execution4' && ++entered===1) return await new Promise(()=>{});
    switch(input.stateId) {
      case 'sourceAnalysis':case 'organizationDesign':return {guard:'done'};
      case 'entry1':case 'resource1':return {guard:'ready'};
      case 'scenario1':case 'scenario3':case 'scenario5':case 'execution4':case 'execution5':case 'coverage4':return {guard:'done'};
      case 'scenario2':return {guard:'passed'};
      case 'execution1':return {guard:'recorded',runId:'witness-'+ ++runs};
      case 'coverage1':return {guard:'measured'};
      case 'coverage2':return target==='coverage4'&&runs===1?{guard:'gaps',coverageFindings:'Add missing state acceptance before new run'}:{guard:'sufficient'};
      case 'execution2':return target==='execution4'&&runs===1?{guard:'repairable',reviewFindings:'Frozen baseline definition correction requires a fresh reviewed run'}:{guard:'sufficient'};
      default:return {guard:'passed',exitStatus:0};
    }
  }
  actor=createActor(machine.provide({actors:{player:fromPromise(({input})=>perform(input)),script:fromPromise(({input})=>perform(input)),captain:fromPromise(async()=>({guard:'accepted',response:'Witness complete'}))}}),{input:{project:'/fixture/project',testDir:'/fixture/results',requirementsFile:'/fixture/confirmed.json',skill:'/fixture/skill',coverageMode:target==='execution4'?'standard':'coverage'}});
  const done=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('witness timed out '+target)),8000);
    actor.subscribe({next(snapshot){
      if(snapshot.matches(target)&&target!=='execution4'&&!interrupted){interrupted=true;actor.send({type:'BOSS_INTERRUPT',targetId:target});}
      if(snapshot.status==='done'||snapshot.status==='error'){clearTimeout(timer);resolve(snapshot);}
    },error(error){clearTimeout(timer);reject(error);}});
  });
  actor.start();actor.send({type:'BOSS_TASK',bossIntent:'Exercise legal coverage and baseline-repair guard contexts'});
  const snapshot=await done;actor.stop();
  assert.equal(snapshot.value,'done');assert.ok(calls.includes(target));
  if(target!=='execution4'){assert.equal(interrupted,true);assert.equal(entered,2);}
  else assert.equal(runs,2);
  reports.push({target,final:snapshot.value,interrupted,calls,runs});
}
console.log(JSON.stringify({status:'passed',cases:reports.length,reports},null,2));
