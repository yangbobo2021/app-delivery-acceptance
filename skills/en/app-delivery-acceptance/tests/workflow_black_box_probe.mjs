import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = process.argv[2];
const testDir = resolve(project, process.env.DELIVERY_ACCEPTANCE_TEST_DIR || "tests");
const require = createRequire(new URL('../playbook/package.json', import.meta.url));
const { createActor, fromPromise } = require('xstate');
const { blackBoxScenariosMachine } = await import('../playbook/black-box-scenarios.playbook/black-box-scenarios.fsm.ts');
const calls = [];
const scripts = [];

const actor = createActor(blackBoxScenariosMachine.provide({ actors: {
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
    if (input.stateId === 'organizationReview') return { guard: 'passed' };
    if (input.stateId === 'organizationRepair') return { guard: 'done' };
    if (input.stateId === 'entry') return { guard: 'ready' };
    if (input.stateId === 'scenarioDesign' || input.stateId === 'scenarioRepair') return { guard: 'done' };
    if (input.stateId === 'scenarioReview') return { guard: 'passed' };
    throw new Error(`unexpected player state: ${input.stateId}`);
  }),
  captain: fromPromise(async ({ input }) => {
    calls.push(input.stateId);
    if (input.stateId !== 'completion') throw new Error(`unexpected captain state: ${input.stateId}`);
    return input.failureDetails
      ? { guard: 'incomplete', response: input.failureDetails }
      : { guard: 'scenariosReady', response: 'Black-box scenarios reviewed; no app execution.' };
  }),
} }));

const final = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('black-box probe timed out')), 15000);
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
actor.send({ type: 'START', project, testDir, requirementsFile: `${project}/requirements.json`, skill: fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '') });
const snapshot = await final;
console.log(JSON.stringify({ state: snapshot.value, status: snapshot.status, calls, scripts, response: snapshot.output?.response }));
actor.stop();
