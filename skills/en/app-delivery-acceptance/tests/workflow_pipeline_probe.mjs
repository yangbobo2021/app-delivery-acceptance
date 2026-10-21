// Exercise actual pipeline checker/transition behavior with controlled role outputs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const [project,testDir,kind,mode='pass',override]=process.argv.slice(2);
const skill=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const require=createRequire(new URL('../playbook/package.json',import.meta.url));
const {createActor,fromPromise}=require('xstate');
const name=kind==='black-box'?'black-box-scenarios':'delivery-acceptance';
const mod=await import(pathToFileURL(override||`${skill}/playbook/${name}.playbook/${name}.fsm.ts`));
const machine=kind==='black-box'?mod.blackBoxScenariosMachine:mod.deliveryAcceptanceMachine;
const ledger=`${testDir}/delivery-acceptance`;let actor,finish;const calls=[],scripts=[];let generated=0;
const done=new Promise(resolve=>finish=resolve);
const read=n=>JSON.parse(readFileSync(`${ledger}/${n}`,'utf8'));
function python(command,args=[]){const result=spawnSync('python3',[`${skill}/scripts/playbook.py`,command,project,'--test-dir',testDir,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);return JSON.parse(result.stdout);}
if(mode==='missing-analysis')unlinkSync(`${ledger}/source-analysis.json`);
actor=createActor(machine.provide({actors:{
 player:fromPromise(async({input})=>{
  calls.push(input.stateId);
  if(['entry','entry1','resource1'].includes(input.stateId))return {guard:'ready'};
  if(['sourceAnalysis','organizationDesign','organizationRepair'].includes(input.stateId))return {guard:'done'};
  if(input.stateId==='organizationReview')return {guard:'passed'};
  if(['scenario1','scenarioDesign'].includes(input.stateId)){
   if(mode==='false-completion')return {guard:'done'};
   const next=python('design-next').unit;assert.ok(next);
   python('start-unit',['--unit',next.unit_id]);
   const templates=read('scene-templates.json');const scene=templates.find(s=>s.generation_unit_id===next.unit_id);assert.ok(scene);
   const scenes=read('scenarios.json');scenes.items.push(scene);writeFileSync(`${ledger}/scenarios.json`,JSON.stringify(scenes,null,2));
   python('complete-unit',['--unit',next.unit_id]);generated++;
   return {guard:python('design-next').unit?'more':'done'};
  }
  if(['scenario2','scenarioReview'].includes(input.stateId)){
   queueMicrotask(()=>finish({entered:input.stateId,calls,scripts,generated}));return new Promise(()=>{});
  }
  throw Error('Unexpected pipeline actor '+input.stateId);
 }),
 script:fromPromise(async({input})=>{
  calls.push(input.stateId);const result=spawnSync('sh',['-c',input.command],{cwd:project,encoding:'utf8'});
  const exitStatus=result.status??127;scripts.push({stateId:input.stateId,exitStatus});return {guard:exitStatus===0?'passed':'failed',exitStatus};
 }),
 captain:fromPromise(async({input})=>({guard:'incomplete',response:input.failureDetails||'Pipeline blocked',failureDetails:input.failureDetails||'Pipeline blocked'}))
}}),{input:kind==='black-box'?{}:{project,testDir,requirementsFile:`${ledger}/requirements.json`,skill,coverageMode:'standard'}});
const timer=setTimeout(()=>finish({error:'pipeline timeout',calls,scripts}),12000);
actor.subscribe({next(s){if(s.status==='done'||s.status==='error'||s.matches('failed'))finish({state:s.value,output:s.output,calls,scripts,generated});},error(e){finish({error:String(e),calls,scripts});}});
actor.start();actor.send(kind==='black-box'?{type:'BOSS_TASK',project,testDir,requirementsFile:`${ledger}/requirements.json`,skill}:{type:'BOSS_TASK',bossIntent:'Generate all units before execution'});
const result=await done;clearTimeout(timer);actor.stop();
if(mode==='pass'){
 assert.equal(result.generated,2,JSON.stringify(result));assert.ok(result.entered,JSON.stringify(result));
 assert.deepEqual(result.scripts.map(s=>s.stateId),['analysisGate','organizationGate','unitAdvance','generationGate']);
 assert.ok(result.scripts.every(s=>s.exitStatus===0));
 assert.ok(calls.indexOf('sourceAnalysis')<calls.indexOf('organizationDesign'));
 assert.ok(calls.indexOf('organizationGate')<calls.indexOf(kind==='black-box'?'scenarioDesign':'scenario1'));
}else{
 assert.ok(!result.entered,JSON.stringify(result));assert.notEqual(result.output?.status,'accepted');
 assert.ok(result.scripts.some(s=>s.exitStatus!==0));
 if(mode==='missing-analysis')assert.equal(calls.filter(s=>s==='sourceAnalysis').length,3);
 if(mode==='false-completion')assert.equal(result.scripts.at(-1).stateId,'generationGate');
}
assert.ok(!calls.includes('execution1'));console.log(JSON.stringify(result));
