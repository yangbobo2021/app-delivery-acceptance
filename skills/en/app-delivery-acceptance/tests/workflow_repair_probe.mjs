import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [project] = process.argv.slice(2);
const testDir = resolve(project, process.env.DELIVERY_ACCEPTANCE_TEST_DIR || "tests");
const require = createRequire(new URL('../playbook/package.json', import.meta.url));
const { createActor, fromPromise } = require('xstate');
const { deliveryAcceptanceMachine } = await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.fsm.ts');
const scenarioPath = `${testDir}/delivery-acceptance/scenarios.json`;
const runOnePath = `${testDir}/delivery-acceptance/runs/run-1/run.json`;
const originalScenarios = readFileSync(scenarioPath, 'utf8');
const calls = [];
const scripts = [];
let runCount = 0;

const actor = createActor(deliveryAcceptanceMachine.provide({ actors: {
  script: fromPromise(async ({ input }) => {
    if (['analysisGate','generationGate'].includes(input.stateId)) return {guard:'passed',exitStatus:0};
    // These legacy-record probes isolate later gates. Real organization gates
    // are independently exercised by workflow_scope_probe.mjs.
    if (input.stateId === 'organizationGate') return { guard: 'passed', exitStatus: 0 };
    calls.push(input.stateId);
    const child = spawnSync('sh', ['-c', input.command.replace('--stage design','--stage black-box')], { cwd: project, encoding: 'utf8' });
    const exitStatus = child.status ?? 127;
    scripts.push({ stateId: input.stateId, exitStatus });
    const guards = Object.keys(input.result);
    return { guard: exitStatus === 0 ? guards[0] : guards[1], exitStatus };
  }),
  player: fromPromise(async ({ input }) => {
    // New prerequisites are isolated here; workflow_pipeline_probe uses their real scripts.
    if (['sourceAnalysis','organizationDesign'].includes(input.stateId)) return {guard:'done'};
    calls.push(input.stateId);
    switch (input.stateId) {
      case 'organizationReview': return { guard: 'passed' };
      case 'organizationRepair': return { guard: 'done' };
      case 'entry1': case 'resource1': return { guard: 'ready' };
      case 'scenario1': {
        const scenarios = JSON.parse(originalScenarios);
        scenarios.items[0].method_ids = ['UNKNOWN-METHOD'];
        writeFileSync(scenarioPath, JSON.stringify(scenarios));
        return { guard: 'done' };
      }
      case 'scenario3': case 'scenario5':
        writeFileSync(scenarioPath, originalScenarios);
        return { guard: 'done' };
      case 'scenario2': return { guard: 'passed' };
      case 'execution1': {
        runCount += 1;
        if (runCount === 1) {
          const run = JSON.parse(readFileSync(runOnePath, 'utf8'));
          run.results[0].evidence = [];
          writeFileSync(runOnePath, JSON.stringify(run));
        }
        return { guard: 'recorded', runId: `run-${runCount}` };
      }
      case 'execution4': case 'execution5': return { guard: 'done' };
      case 'execution2': return { guard: 'sufficient' };
      default: throw new Error(`unexpected player state: ${input.stateId}`);
    }
  }),
  captain: fromPromise(async ({ input }) => {
    calls.push(input.stateId);
    if (input.stateId !== 'completion1') throw new Error(`unexpected captain state: ${input.stateId}`);
    return { guard: 'accepted', response: 'all gates passed' };
  }),
} }), { input: { project, testDir, requirementsFile: `${project}/requirements.json`, skill: fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '') } });

const final = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('workflow repair probe timed out')), 15000);
  actor.subscribe({
    next(snapshot) {
      if (snapshot.status === 'done' || snapshot.status === 'error') {
        clearTimeout(timeout);
        resolve(snapshot);
      }
    },
    error(error) { clearTimeout(timeout); reject(error); },
  });
});
actor.start();
actor.send({ type: 'BOSS_TASK', bossIntent: 'Verify delivery acceptance.' });
const snapshot = await final;
console.log(JSON.stringify({ state: snapshot.value, status: snapshot.status, calls, scripts, response: snapshot.output?.response }));
actor.stop();
