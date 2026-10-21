import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [project, runId, mode] = process.argv.slice(2);
const testDir = resolve(project, process.env.DELIVERY_ACCEPTANCE_TEST_DIR || "tests");
const require = createRequire(new URL('../playbook/package.json', import.meta.url));
const { createActor, fromPromise } = require('xstate');
const { deliveryAcceptanceMachine } = await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.fsm.ts');
const calls = [];
const scripts = [];

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
      case 'scenario1': case 'scenario3': case 'scenario5': case 'execution4': case 'execution5': return { guard: 'done' };
      case 'scenario2': return { guard: 'passed' };
      case 'execution1': return { guard: 'recorded', runId };
      case 'execution2': return mode === 'product-failed' || mode === 'product-failed-new-run'
        ? { guard: 'productFailed', reviewFindings: 'Scenario SC-B failed; evidence: evidence/screen.txt' }
        : { guard: 'sufficient' };
      default: throw new Error(`unexpected player state: ${input.stateId}`);
    }
  }),
  captain: fromPromise(async ({ input }) => {
    calls.push(input.stateId);
    if (input.stateId !== 'completion1') throw new Error(`unexpected captain state: ${input.stateId}`);
    if (mode === 'product-failed-new-run') return { guard: 'incomplete', response: 'New run run-2 proves SC-B passed.', failureDetails: 'Scenario SC-B failed; evidence: evidence/screen.txt', runId };
    if (mode === 'product-failed') return { guard: 'incomplete', response: 'Acceptance has failed items.', failureDetails: 'Scenario SC-B failed; evidence: evidence/screen.txt', runId };
    if (scripts.at(-1)?.exitStatus !== 0) return { guard: 'incomplete', response: 'A deterministic gate failed.', failureDetails: 'See the recorded gate report for exact issues.' };
    return { guard: 'accepted', response: 'all gates passed' };
  }),
} }), { input: { project, testDir, requirementsFile: `${project}/requirements.json`, skill: fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '') } });

const final = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`workflow gate probe timed out: ${JSON.stringify({ state: actor.getSnapshot().value, calls, scripts })}`)), 15000);
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
