import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harness,sha} from './official_workflow_harness.mjs';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare,finalize,fail} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/runtime/stage.mjs';
import {AcceptanceView} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/view/data.mjs';

const h=harness('view-terminal-progress',[]),root=h.project('runtime'),at='AT-runtime-progress';
fs.writeFileSync(path.join(root,'README.md'),'Run node main.mjs for a side-effect-free runtime smoke. No dependencies.');
fs.writeFileSync(path.join(root,'main.mjs'),'console.log("RUNTIME_READY");\n');
h.run('git-init','git',['init','-q',root]);
h.run('git-add','git',['-C',root,'add','.']);
h.run('git-commit','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','-qm','runtime fixture']);
const revision=h.run('revision','git',['-C',root,'rev-parse','HEAD']).stdout.trim();
createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'Prepare only this fixture runtime.'});
freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'Fixture runtime readiness.',scope:{kind:'coverage-environment',project:root},definitions:{context:{business_goal:'Prepare an isolated runtime without business tests.'}}});
const pointer=path.join(root,'.acceptance-local/current.json'),pointerHash=sha(pointer),view=new AcceptanceView(root,at);
const input=(request_id,inspection_files=['README.md'])=>({project_root:root,acceptance_id:at,request_id,definitions_sha256:sha(path.join(root,'.acceptance',at,'scenarios.json')),source_checkout:root,revision,test_roots:['tests'],inspection_files});
assert.throws(()=>prepare(input('failed-inspection',['.acceptance/knowledge/INDEX.md'])),/outside frozen workspace/);
const failed=path.join(root,'.acceptance-local',at,'workflows/runtime/failed-inspection'),failureFile=path.join(failed,'failure.json'),failureHash=sha(failureFile);
const active=()=>view.snapshot(at).progress.stages.filter(stage=>!stage.finished);

h.test('PROGRESS-01','A settled failed runtime attempt is historical, not current pending work',()=>{
  const snapshot=view.snapshot(at),old=snapshot.progress.stages.find(stage=>stage.blocker.includes('outside frozen workspace'));
  assert.ok(old,'The historical failure remains represented');
  assert.equal(old.finished,true);
  assert.equal(active().length,0);
  assert.equal(sha(failureFile),failureHash);
});
const spec=prepare(input('corrected-inspection'));
h.test('PROGRESS-02','A real active runtime claim remains visible while an earlier settled failure is retained',()=>{
  assert.ok(fs.existsSync(path.join(spec.folder,'active.lock.d')));
  assert.equal(active().length,1);
  assert.equal(sha(failureFile),failureHash);
});
finalize(spec,JSON.stringify({dependency_files:[],knowledge_used:['INDEX.md'],setup_commands:[],executables:[{name:'node',path:process.execPath,version_command:[process.execPath,'--version']}],smoke:{command:[process.execPath,'main.mjs'],timeout_seconds:10},recipe_candidate:'Use the actual Node executable to run main.mjs; no dependencies or business tests.'}));
h.test('PROGRESS-03','Successful corrected preparation clears current work without erasing the first failure or changing the current AT',()=>{
  assert.equal(active().length,0);
  assert.equal(sha(failureFile),failureHash);
  assert.equal(sha(pointer),pointerHash);
  h.save('recovered-snapshot.json',view.snapshot(at));
});
const unfinished=prepare(input('explicit-unfinished'));
fs.writeFileSync(path.join(unfinished.folder,'state.json'),JSON.stringify({stages:{preparation:{status:'blocked',reason:'Explicit unfinished stage'}}}));
fail(unfinished,'Unfinished stage needs continuation');
h.test('PROGRESS-04','Explicit unfinished stage state remains current even after a failure receipt releases its claim',()=>{
  const pending=active();assert.equal(pending.length,1);
  assert.equal(pending[0].blocker,'Explicit unfinished stage');
  assert.equal(sha(failureFile),failureHash);
  assert.equal(sha(pointer),pointerHash);
});
const args=process.argv.slice(2),coverageIndex=args.indexOf('--coverage-project');
if(coverageIndex>=0){
  const coverageRoot=path.resolve(args[coverageIndex+1]),coverageId=args[args.indexOf('--acceptance-id')+1];
  h.test('CAPTURE-01','The actual saved coverage receipt supplies the visible collection time without changing its evidence',()=>{
    const selected=new AcceptanceView(coverageRoot,coverageId),snapshot=selected.snapshot(coverageId);
    assert.ok(snapshot.coverage.length);
    for(const group of snapshot.coverage){
      const traces=snapshot.project_state.traces.filter(trace=>trace.coverage.prepared_sha256===group.profile);
      const receipts=traces.map(trace=>selected.resolve(coverageId,trace.coverage.receipt_path,trace.coverage.execution_sha256));
      assert.ok(receipts.length&&receipts.every(Boolean));
      const before=receipts.map(sha),times=receipts.map(file=>JSON.parse(fs.readFileSync(file)).end_utc).sort();
      assert.equal(group.last_capture_at,times.at(-1));
      assert.deepEqual(receipts.map(sha),before);
    }
    h.save('coverage-time-snapshot.json',snapshot.coverage);
  });
}
h.finish(['workflows/view/data.mjs','tests/view_terminal_progress.integration.mjs']);
