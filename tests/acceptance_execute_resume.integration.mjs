// Recheck a real completed selected-case run after a stale assertion failed.
// Does not repeat execution or model review, and never modifies original evidence.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {harness,read,sha} from './official_workflow_harness.mjs';
const args=process.argv.slice(2),source=path.resolve(args[args.indexOf('--from')+1]);
const h=harness('acceptance-execute-resume',[['acceptance-execute','execute']]);
if(!h.live||!args.includes('--from'))throw Error('Requires --live-cli --from an actual completed selected-case fixture');
const fixture=read(path.join(source,'fixture.json')),request=read(path.join(source,'request.json'));
assert.ok(fixture.root.includes('/acceptance-execute-test-'));
const folder=path.join(fixture.root,'.acceptance-local',fixture.at,'workflows/execute',request.request_id),before={};
for(const name of ['result.json','execution/execution.json','review/answer.json','review/metrics.json'])before[name]=sha(path.join(folder,name));
h.test('EXECUTE-RESUME-01','Actual selected-case result uses the official Player port, correct role/model and selection-only verdict',()=>{
  const result=read(path.join(folder,'result.json')),metrics=read(path.join(folder,'review/metrics.json')),configured=read(path.join(h.output,'cli-config.json')).players['acceptance.execute.reviewer'];
  assert.equal(result.review_status,'passed');assert.equal(result.review_applies_to,'selected_cases_only');assert.equal(result.scene_review_status,'not_revalidated');assert.deepEqual(result.unselected_case_ids,[fixture.ids[1]]);
  assert.equal(metrics.agent_runtime.transport.kind,'official-playbook-player-port');assert.equal(metrics.agent_runtime.role,'reviewer');
  assert.equal(metrics.agent_runtime.model,configured.model);assert.equal(metrics.agent_runtime.effort,configured.effort);
  assert.equal(read(path.join(folder,'review/decision-gate.json')).status,'valid');h.save('actual-result.json',result);h.save('actual-review-metrics.json',metrics);
});
h.test('EXECUTE-RESUME-02','Official CLI reuses the actual completed checkpoint without repeating a case or Reviewer',()=>{
  const cli=h.cli('acceptance-execute',request,'reuse-completed-selected',fixture.root);h.settled(cli,'acceptance-execute','done');
  assert.equal(cli.traces.filter(item=>item.type==='player.call.started').length,0);
  for(const [name,digest] of Object.entries(before))assert.equal(sha(path.join(folder,name)),digest);
});
h.finish(['tests/acceptance_execute_resume.integration.mjs']);
