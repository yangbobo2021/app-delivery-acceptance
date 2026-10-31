// Fresh normal paths for lifecycle entries, not merely replay of old receipts.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harness,read,sha} from './official_workflow_harness.mjs';
const names=['create','current','freeze','change-plan','source-status','report','archive','view','finish','start','cleanup'];
const h=harness('acceptance-lifecycle-cli',names.map(name=>['acceptance-'+name,name]));
if(!h.live)throw Error('Requires --live-cli for actual official command checks');
const root=h.project('fresh-lifecycle'),at='AT-fresh-lifecycle',local=path.join(root,'.acceptance-local',at);
const cli=(name,input,label,state)=>{const invoked=h.cli('acceptance-'+name,input,label,root);h.settled(invoked,'acceptance-'+name,state);return invoked;};
const base={project_root:root,acceptance_id:at};
cli('create',{...base,request_id:'create',user_request:'新建交付测试，冻结用户给出的需求并检查生命周期；不要生成或执行测试。'},'01-create','created');
const pointer=path.join(root,'.acceptance-local/current.json'),definitions=path.join(root,'.acceptance',at,'scenarios.json');
h.test('LIFECYCLE-CLI-01','Current reads the actual newly created empty AT without inventing scope or changing its pointer',()=>{
  const before=sha(pointer);cli('current',{project_root:root},'02-current','read');assert.equal(sha(pointer),before);assert.equal(fs.existsSync(definitions),false);
});
fs.mkdirSync(path.join(root,'docs'));const source=path.join(root,'docs/contract.md');fs.writeFileSync(source,'# Contract\n保存后读取的文本与输入逐字一致。\n');
const revision='sha256:'+sha(source),locator='docs/contract.md#contract';
cli('freeze',{...base,request_id:'freeze',base_definitions_sha256:null,basis:'The fixture author explicitly supplies the complete original contract; freeze only.',
  definitions:{context:{business_goal:'仅验证冻结与生命周期，不进行产品验收。'},requirements:[{id:'R1',text:'保存后读取的文本与输入逐字一致。',
    origin:{kind:'fixture-user',reference:'test-author-contract'},external_refs:[{locator,revision,text:fs.readFileSync(source,'utf8')}]}]}},'03-freeze','frozen');
const original=read(definitions),previous={path:path.join(root,'.acceptance',at,original.definition_record),sha256:sha(definitions)};
let failure;try{fs.readFileSync(path.join(root,'docs/unavailable.md'));}catch(error){failure={operation:'fs.readFileSync',path:'docs/unavailable.md',code:error.code};}
// The declared original source is now deliberately unavailable in this disposable fixture.
fs.renameSync(source,source+'.held');try{fs.readFileSync(source);}catch(error){failure={operation:'fs.readFileSync',path:source,code:error.code};}
const evidence=path.join(local,'workflows/observed-source/read-failure.json');fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.writeFileSync(evidence,JSON.stringify(failure));
h.test('LIFECYCLE-CLI-02','A new source-status command records a real failed read while preserving all frozen obligations',()=>{
  const before=sha(definitions);cli('source-status',{...base,request_id:'read-failed',definitions_sha256:before,ref:'requirements:R1',locator,revision,status:'read_failed',
    basis:'Actual read of the previously frozen fixture source failed with ENOENT after its explicit test-only retirement.',source_reference:evidence,observed_at:new Date().toISOString()},'04-source-status','recorded');
  assert.equal(failure.code,'ENOENT');assert.equal(sha(definitions),before);
});
cli('freeze',{...base,request_id:'append',base_definitions_sha256:sha(definitions),basis:'The fixture user explicitly adds another requirement without requesting tests.',
  definitions:{requirements:[{id:'R2',text:'删除前必须显示确认，取消时保留原内容。',origin:{kind:'fixture-user',reference:'test-author-added-contract'},external_refs:[]}]}},'05-append','frozen');
h.test('LIFECYCLE-CLI-03','A fresh change-plan command preserves newly unexecuted requirements and design-only starts no cases',()=>{
  cli('change-plan',{...base,request_id:'design-only',definitions_sha256:sha(definitions),basis:'Explicitly plan the definition change only.',previous_definitions:previous,
    execution_intent:{mode:'design_only',basis:'Only plan the newly added requirement; no test execution.'}},'06-change-plan','planned');
  const result=read(path.join(local,'workflows/change-plan/design-only/result.json'));
  assert.equal(result.execution_started,false);assert.deepEqual(result.selection.selected_scene_ids,[]);assert.ok(result.selection.affected_target_ids.includes('R2'));
  assert.equal(fs.existsSync(path.join(local,'workspace')),false);
});
cli('report',{...base,request_id:'report',basis:'Export only the actual unexecuted state and source-read limitation.'},'07-report','reported');
const report=read(path.join(local,'workflows/report/report/result.json')),note=path.join(local,'workflows/local-note/observation.txt');
fs.mkdirSync(path.dirname(note),{recursive:true});fs.writeFileSync(note,'Lifecycle-only observation. No business test was executed.\n');
cli('archive',{...base,request_id:'archive',basis:'Preserve these actual selected observation and report files.',files:[note,report.report]},'08-archive','archived');
const archive=read(path.join(local,'workflows/archive/archive/result.json'));
h.test('LIFECYCLE-CLI-04','Fresh report/archive retain real bytes, no business pass and no product execution',()=>{
  assert.equal(report.statistics.executed,0);assert.equal(report.execution_started,false);assert.ok(fs.existsSync(archive.record));
  const record=read(path.join(archive.record,'record.json'));for(const [name,digest] of Object.entries(record.files))assert.equal(sha(path.join(archive.record,name)),digest);
});
let viewer;
h.test('LIFECYCLE-CLI-05','The normal view command starts an actual readonly server and preserves the current pointer',()=>{
  const before=sha(pointer),result=cli('view',base,'09-view','viewing');
  viewer=result.receipt.stderr.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(item=>item.status==='viewing');
  assert.ok(viewer?.url&&viewer.pid);assert.equal(sha(pointer),before);
});
if(viewer){try{assert.equal((await fetch(viewer.url)).status,200);}finally{process.kill(viewer.pid,'SIGTERM');}}
const finish=id=>({...base,request_id:id,basis:'Explicitly finish this lifecycle-only fixture without creating a product judgment.',unfinished_limits:['No business test was requested or executed.'],allow_unfinished:true});
h.test('LIFECYCLE-CLI-06','Finish, explicit restart and finish preserve limitations and clear only the matching pointer',()=>{
  cli('finish',finish('first-finish'),'10-finish','finished');assert.equal(fs.existsSync(pointer),false);
  cli('start',{...base,basis:'Explicit fixture user resumes this known existing AT.'},'11-start','started');assert.equal(read(pointer).acceptance_id,at);
  cli('finish',finish('second-finish'),'12-finish-again','finished');assert.equal(fs.existsSync(pointer),false);
});
h.test('LIFECYCLE-CLI-07','Normal cleanup removes only the explicitly selected inactive note after checking its real archive',()=>{
  cli('cleanup',{...base,request_id:'cleanup-note',basis:'Remove this archived disposable local note only.',assets:['workflows/local-note'],archive_record:archive.record,missing_attachment_limits:[]},'13-cleanup','cleaned');
  assert.equal(fs.existsSync(note),false);assert.ok(fs.existsSync(archive.record));assert.ok(fs.existsSync(definitions));
});
h.finish(['tests/acceptance_lifecycle_cli.integration.mjs']);
