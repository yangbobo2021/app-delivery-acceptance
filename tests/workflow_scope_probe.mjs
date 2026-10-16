// Real checker gates; actors are controlled seams for testing orchestration.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [project, testDir, kind, mode = 'pass', override] = process.argv.slice(2);
const skill = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(new URL('../playbook/package.json', import.meta.url));
const { createActor, fromPromise } = require('xstate');
const filename = override || `${skill}/playbook/${kind === 'black-box' ? 'black-box-scenarios' : 'delivery-acceptance'}.playbook/${kind === 'black-box' ? 'black-box-scenarios' : 'delivery-acceptance'}.fsm.ts`;
const module = await import(pathToFileURL(filename));
const machine = kind === 'black-box' ? module.blackBoxScenariosMachine : module.deliveryAcceptanceMachine;
const calls = [], scripts = [];
let reviews = 0, finish;
const complete = new Promise(resolve => { finish = resolve; });
let actor;
const timer = setTimeout(() => { finish({error:'scope probe timeout',calls,scripts}); actor.stop(); }, 10000);
actor = createActor(machine.provide({actors: {
  player: fromPromise(async ({input}) => {
    calls.push(input.stateId);
    if (['entry','entry1'].includes(input.stateId)) return {guard:'ready'};
    if (['sourceAnalysis','organizationDesign'].includes(input.stateId)) return {guard:'done'};
    if (input.stateId === 'organizationReview') {
      reviews++;
      if (mode === 'review-gaps' || mode === 'repair' && reviews === 1) return {guard:'gaps',failureDetails:'Original requirement check is missing from the organization'};
      return {guard:'passed'};
    }
    if (input.stateId === 'organizationRepair') return {guard:'done'};
    if (['scenarioDesign','resource1'].includes(input.stateId)) {
      queueMicrotask(() => finish({entered:input.stateId,calls,scripts,reviews,context:actor.getSnapshot().context}));
      return new Promise(()=>{});
    }
    throw new Error(`Unexpected actor before organization gate: ${input.stateId}`);
  }),
  script: fromPromise(async ({input}) => {
    calls.push(input.stateId);
    if (!['analysisGate','organizationGate'].includes(input.stateId)) throw new Error('Scenario/resource work must stop after organization proof');
    const result = spawnSync('sh',['-c',input.command],{cwd:project,encoding:'utf8'});
    const exitStatus = result.status ?? 127;
    scripts.push({stateId:input.stateId,exitStatus});
    return {guard:exitStatus === 0?'passed':'failed',exitStatus};
  }),
  captain: fromPromise(async ({input}) => ({guard:'incomplete',response:input.failureDetails || 'Organization incomplete',failureDetails:input.failureDetails || 'Organization incomplete'})),
}}),{input:kind === 'black-box'?{}:{project,testDir,requirementsFile:`${testDir}/delivery-acceptance/requirements.json`,skill,coverageMode:'standard'}});
actor.subscribe({next(snapshot){if(snapshot.status==='done'||snapshot.status==='error') finish({state:snapshot.value,status:snapshot.status,calls,scripts,reviews,output:snapshot.output});},error(error){finish({error:String(error),calls,scripts});}});
actor.start();
actor.send(kind === 'black-box'?{type:'BOSS_TASK',project,testDir,requirementsFile:`${testDir}/delivery-acceptance/requirements.json`,skill}:{type:'BOSS_TASK',bossIntent:'Verify the explicitly selected acceptance scope'});
const result = await complete;
clearTimeout(timer);actor.stop();
console.log(JSON.stringify(result));
if(result.error) process.exitCode=1;
