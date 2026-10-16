import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../playbook/package.json', import.meta.url));
const { createActor, fromPromise } = require('xstate');
const { deliveryAcceptanceMachine } = await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.fsm.ts');
const { validateOptions } = await import('../playbook/delivery-acceptance.playbook/delivery-acceptance.playbook.ts');
const base = { project: '/isolated/app', testDir: '/isolated/tests', requirementsFile: '/isolated/approved.json', skill: '/isolated/skill' };
const defaultActor = createActor(deliveryAcceptanceMachine, {input: validateOptions(base)});
assert.equal(defaultActor.getSnapshot().context.coverageMode, 'standard');
defaultActor.stop();
for (const mode of ['auto', true, null, 'COVERAGE']) {
  assert.throws(() => validateOptions({ ...base, coverageMode: mode }), /coverageMode/);
}

async function probe(name, mode) {
  const calls = [], rounds = [], inputs = [];
  let executions = 0, collections = 0;
  const input = mode === undefined ? base : { ...base, coverageMode: mode };
  const actor = createActor(deliveryAcceptanceMachine.provide({ actors: {
    script: fromPromise(async ({ input }) => {
    if (['analysisGate','generationGate'].includes(input.stateId)) return {guard:'passed',exitStatus:0};
      calls.push(input.stateId); inputs.push(input);
      const failed = name === 'false-sufficient' && input.stateId === 'coverage3';
      return { guard: failed ? 'failed' : 'passed', exitStatus: failed ? 2 : 0 };
    }),
    player: fromPromise(async ({ input }) => {
    // New prerequisites are isolated here; workflow_pipeline_probe uses their real scripts.
    if (['sourceAnalysis','organizationDesign'].includes(input.stateId)) return {guard:'done'};
      calls.push(input.stateId); inputs.push(input);
      if (input.stateId.startsWith('coverage')) {
        assert.equal(mode, 'coverage', 'standard invoked optional actor');
        assert.equal(input.coverageMode, 'coverage');
      }
      switch (input.stateId) {
        // Isolate downstream coverage routing; the real organization gate has separate probes.
        case 'organizationReview': return { guard: 'passed' };
        case 'entry1': case 'resource1': return { guard: 'ready', coverageMode: mode === 'coverage' ? 'standard' : 'coverage' };
        case 'scenario1': case 'scenario3': case 'scenario5': case 'execution4': case 'execution5': case 'coverage4': return { guard: 'done' };
        case 'scenario2': return { guard: 'passed' };
        case 'execution1': executions++; return { guard: 'recorded', runId: `run-${executions}` };
        case 'coverage1':
          collections++;
          return name === 'blocked' ? { guard: 'blocked', failureDetails: 'missing branch collector' } : { guard: 'measured', coverageMode: 'standard' };
        case 'coverage2':
          if (name === 'product-failed') return { guard: 'productFailed', failureDetails: 'actual product assertion failed' };
          if (name === 'limit' || (name === 'repair' && collections === 1)) return { guard: 'gaps', coverageFindings: `important pending state gap, round ${collections}` };
          return { guard: 'sufficient' };
        case 'execution2': return { guard: 'sufficient' };
        default: throw new Error(`unexpected player ${input.stateId}`);
      }
    }),
    captain: fromPromise(async ({ input }) => {
      calls.push(input.stateId); inputs.push(input);
      assert.equal(input.stateId, 'completion1');
      if (['blocked', 'limit', 'product-failed', 'false-sufficient'].includes(name)) {
        return { guard: 'incomplete', response: 'incomplete', failureDetails: 'terminal gap', runId: `run-${executions}` };
      }
      return { guard: 'accepted', response: 'all applicable gates passed' };
    }),
  } }), { input });
  const finish = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out: ${calls}`)), 8000);
    actor.subscribe({ next(s) { if (s.status === 'done' || s.status === 'error') { clearTimeout(timer); resolve(s); } }, error(e) { clearTimeout(timer); reject(e); } });
  });
  actor.start(); actor.send({ type: 'BOSS_TASK', bossIntent: 'Verify local acceptance; do not infer mode from prose.' });
  const result = await finish; actor.stop();
  assert.equal(result.status, 'done');
  const incomplete = ['blocked', 'limit', 'product-failed', 'false-sufficient'].includes(name);
  assert.equal(result.value, incomplete ? 'incomplete' : 'done', `${name}: ${JSON.stringify(result.value)}`);
  if (mode !== 'coverage') {
    assert.ok(!calls.some(s => s.startsWith('coverage')));
    const i = calls.indexOf('execution1'); assert.equal(calls[i + 1], 'execution2');
  } else if (name === 'repair') {
    assert.equal(collections, 2); assert.equal(executions, 2);
    const i = calls.indexOf('coverage4'); assert.equal(calls[i + 1], 'scenario2');
    assert.equal(calls[i + 2], 'scenario4'); assert.equal(calls[i + 3], 'execution1');
  } else if (name === 'limit' || name === 'false-sufficient') {
    assert.equal(collections, 3); assert.equal(executions, 3);
    assert.equal(calls.filter(s => s === 'coverage4').length, 2);
    assert.ok(!calls.includes('execution2'));
  }
  return { name, mode: mode ?? 'omitted', final: result.value, calls, executions, collections, coverageMode: result.context.coverageMode, coverageRounds: result.context.coverageRounds };
}

const results = [];
for (const [name, mode] of [['default', undefined], ['standard', 'standard'], ['enhanced', 'coverage'], ['repair', 'coverage'], ['limit', 'coverage'], ['blocked', 'coverage'], ['product-failed', 'coverage'], ['false-sufficient', 'coverage']]) {
  results.push(await probe(name, mode));
}
console.log(JSON.stringify({ status: 'passed', probes: results }, null, 2));
