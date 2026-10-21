import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const selected = "/temporary/test results [user]'";
const context = { project: '/temporary/app', testDir: selected, skill: '/temporary/skill', requirementsFile: '/temporary/approved.json', runId: 'run-1' };

for (const name of ['black-box-scenarios', 'delivery-acceptance']) {
  const folder = new URL(`../playbook/${name}.playbook/`, import.meta.url);
  const fsm = await import(new URL(`${name}.fsm.ts`, folder));
  const runtime = await import(new URL(`${name}.playbook.ts`, folder));
  const verify = await import(new URL('.slc-verify/verify.js', folder));
  const config = verify.findMachineConfig(fsm);
  const gears = readFileSync(fileURLToPath(new URL(`${name}.gears.md`, folder)), 'utf8');
  assert.deepEqual(verify.checkGearsFsmConformance(gears, config, { concurrentRoleSets: fsm.concurrentRoleSets, artifactSchema: 3 }), []);
  for (const state of Object.values(config.states)) {
    const invocation = state.invoke;
    if (!invocation || typeof invocation.input !== 'function') continue;
    const input = invocation.input({ context });
    if (invocation.src === 'player' || invocation.src === 'captain') {
      assert.equal(input.testDir, selected, input.stateId);
      const compose = runtime._internal[invocation.src === 'player' ? 'composePlayerPrompt' : 'composeCaptainPrompt'];
      assert.ok(compose(input).includes(selected), `chosen directory absent from ${input.stateId}`);
    } else if (invocation.src === 'script') {
      assert.ok(input.command.includes('--test-dir'), input.stateId);
      assert.ok(!input.command.includes('.delivery-acceptance/'), input.stateId);
    }
  }
  for (const actor of ['player', 'captain']) {
    const compose = runtime._internal[actor === 'player' ? 'composePlayerPrompt' : 'composeCaptainPrompt'];
    assert.deepEqual(verify.checkPromptComposition({ config, compose, actor, artifactSchema: 3 }), []);
  }
  if (name === 'delivery-acceptance') {
    assert.equal(runtime.validateOptions(contextWithOptions()).testDir, selected);
    const incomplete = contextWithOptions();
    delete incomplete.testDir;
    assert.throws(() => runtime.validateOptions(incomplete), /testDir/);
  }
}

function contextWithOptions() {
  return { project: context.project, requirementsFile: context.requirementsFile, skill: context.skill, testDir: selected };
}

console.log(JSON.stringify({ status: 'passed', workflows: 2 }));
