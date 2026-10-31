// One bounded public workflow repair against preserved real failure evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harness, read, sha} from './official_workflow_harness.mjs';
import {prepareCoverage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/stage.mjs';
import {coveragePreparation} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/coverage.mjs';

const args = process.argv.slice(2), index = args.indexOf('--from');
if (!args.includes('--live-cli') || index < 0) throw Error('Requires --live-cli --from PRESERVED_FAILED_CHECK');
const from = path.resolve(args[index + 1]), original = read(path.join(from, 'live-input.json'));
const h = harness('coverage-readiness-repair', [['acceptance-coverage-prepare', 'coverage']]);
const input = {...original, request_id: 'read-primitives-repair',
  basis: 'Repair preparation only. The preserved check proved zero native data reads individually but loses branch mode during merge. Adopt the current tools/run/read protocol, preserve zero-mode metadata with real tool-supported collection, and prove complete/zero/mixed native paths. Do not run business tests.',
  prior_attempts: [path.join(original.project_root, '.acceptance-local', original.acceptance_id, 'workflows/coverage', original.request_id)]};
const resultFile = path.join(input.project_root, '.acceptance-local', input.acceptance_id, 'workflows/coverage', input.request_id, 'result.json');
h.save('input.json', input);
let ready;
h.test('PREPARATION-REPAIR-01', '官方 CLI 的真实准备角色修复原失败、完成全零/混合验证并交接就绪', () => {
  const cli = h.cli('acceptance-coverage-prepare', input, 'real-repair', input.project_root, {timeout: 1000000,
    env: {...process.env, SPEX_HOME: path.join(h.temporary, 'spex')}});
  h.settled(cli, 'acceptance-coverage-prepare', 'done');
  ready = read(resultFile);assert.equal(ready.status, 'ready');assert.equal(ready.business_tests, 'not_executed');
  const profile = coveragePreparation(ready.coverage), proof = read(profile.spec.lifecycle_report);
  assert.equal(profile.protocol_revision, 2);assert.equal(proof.status, 'passed');
  for (const route of proof.routes) {
    for (const mode of ['zero', 'zero_repeat', 'nonzero']) assert.equal(route[mode].status, 'passed');
    assert.equal(route.aggregates.zero.status, 'passed');assert.equal(route.aggregates.mixed.status, 'passed');
  }
  assert.equal(fs.existsSync(path.join(profile.spec.project_root, 'BUSINESS_TEST_WAS_RUN')), false);
  h.save('actual-ready.json', ready);h.save('lifecycle-proof.json', proof);
  const metrics = read(path.join(path.dirname(resultFile), 'preparation/metrics.json'));
  assert.equal(metrics.model, process.env.ACCEPTANCE_MODEL);assert.equal(metrics.effort, process.env.ACCEPTANCE_EFFORT);
  h.save('actual-role-metrics.json', metrics);
});
if (ready?.status === 'ready') {
  const before = sha(resultFile), reused = await prepareCoverage(input);
  h.test('PREPARATION-REPAIR-02', '相同请求复用已验证准备，不再调用角色或重跑探针', () => {
    assert.equal(reused.status, 'ready');assert.equal(reused.current_binding_verified, true);assert.equal(sha(resultFile), before);
  });
}
h.finish(['workflows/coverage/protocol/entry.mjs', 'workflows/coverage/protocol/lifecycle.mjs', 'workflows/coverage/roles/preparer.mjs', 'tests/coverage_readiness_repair.integration.mjs']);
