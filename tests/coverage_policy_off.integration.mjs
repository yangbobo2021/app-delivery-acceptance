import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {prepareCoverage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/stage.mjs';
import {readKnowledge} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/knowledge.mjs';
import {workspaceLease} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/workspace.mjs';
import {read} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/store.mjs';
import {projectCoverage,activateCoverage,policyPath} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/coverage-registry.mjs';
import {recordExecution} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/recorder.mjs';
import {harness,sha} from './official_workflow_harness.mjs';
const h=harness('coverage-explicit-off',[['acceptance-coverage-prepare','coverage']]),args=process.argv.slice(2),index=args.indexOf('--prepared');if(index<0)throw Error('--prepared must name an actual validated mature-tool fixture');
const prepared=fs.realpathSync(args[index+1]),profile=read(path.join(prepared,'prepared.json')),runtime=read(profile.spec.runtime_manifest),root=runtime.acceptance.project_root,at=runtime.acceptance.id,workspace=runtime.workspace,originalPolicy=read(policyPath(workspace)),originalPolicyHash=sha(policyPath(workspace)),knowledge=readKnowledge(root,at,[]),directory=path.join(root,'.acceptance-local',at,'workflows/off-policy-forward');fs.mkdirSync(directory);
const input={project_root:root,acceptance_id:at,request_id:'explicit-off-after-required-1',definitions_sha256:sha(path.join(root,'.acceptance',at,'scenarios.json')),policy:'off',basis:'The test author explicitly disables collection for this next actual fixture run; retain the prior required policy and do not silently downgrade on failure.'};
h.save('input.json',input);h.save('policy-before.json',{policy:originalPolicy,sha256:originalPolicyHash});
let result;
try{
  if(h.live){const cli=h.cli('acceptance-coverage-prepare',input,'live-explicit-off',root);h.settled(cli,'acceptance-coverage-prepare','done');result=read(path.join(root,'.acceptance-local',at,'workflows/coverage',input.request_id,'result.json'));}
  else result=await prepareCoverage(input);
  assert.equal(result.status,'off',result.reason);assert.equal(result.policy_change.previous_sha256,originalPolicyHash);assert.equal(result.policy_change.previous_policy,'required');assert.equal(projectCoverage(workspace,{policy:'off'}).policy,'off');assert.throws(()=>projectCoverage(workspace,originalPolicy.coverage),/changed explicitly/);
  const receipt=await recordExecution({cwd:workspace,output:path.join(directory,'execution'),files:['tests/native_formal.py'],command:[profile.entry[0],'tests/native_formal.py'],env:{}});assert.equal(receipt.exit_code,0);assert.equal(receipt.coverage_session_path,undefined);assert.match(fs.readFileSync(path.join(directory,'execution/execution.log'),'utf8'),/NATIVE_NODE_FORMAL_CLASSIFY_OK/);
  const immutableHash=sha(result.receipt_path),again=await prepareCoverage(input);assert.equal(again.status,'off');assert.equal(sha(result.receipt_path),immutableHash);
  h.test('OFF-01','An explicit user decision changes an active required policy and the real product command runs without the collector',()=>({result,receipt}));
  await workspaceLease({acceptance:knowledge.acceptance,source_checkout:workspace},directory,async()=>activateCoverage(prepared,originalPolicy.catalog));
  const stale=await prepareCoverage(input);assert.equal(stale.status,'stale');assert.equal(stale.historical_report_preserved,true);assert.equal(sha(result.receipt_path),immutableHash);assert.equal(projectCoverage(workspace).policy,'required');
  h.test('OFF-02','Re-enabling verified collection makes the old off decision stale and preserves its immutable history',()=>({stale,policy_after:read(policyPath(workspace))}));
}catch(error){h.test('OFF-ERROR','Explicit policy forward test',()=>{throw error;});
  // Restore through the actual verified activation operation; never fabricate
  // a policy receipt or overwrite the preserved old decision to hide a failure.
  if(projectCoverage(workspace)?.policy==='off')await workspaceLease({acceptance:knowledge.acceptance,source_checkout:workspace},directory,async()=>activateCoverage(prepared,originalPolicy.catalog));
}
h.finish(['workflows/coverage/stage.mjs','workflows/shared/coverage-registry.mjs','tests/coverage_policy_off.integration.mjs']);
