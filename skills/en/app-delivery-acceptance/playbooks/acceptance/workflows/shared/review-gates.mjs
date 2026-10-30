import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {read,inside} from './store.mjs';
import {digest,verifyCase,object} from './definitions.mjs';
import {git} from './workspace.mjs';
import {verifyIdentity} from './identity.mjs';
import {verifyCoverageReport,protocol} from './coverage.mjs';
const image=file=>/\.(png|jpe?g|webp)$/i.test(file);
export function decisionGate(answer,input,metrics={}){
  const errors=[],status=answer.status;
  if(!['passed','product_bug','repair_required','inconclusive'].includes(status))errors.push('unknown independent review status');
  for(const key of ['coverage','oracle','evidence','summary'])if(typeof answer[key]!=='string'||!answer[key].trim())errors.push('review field missing: '+key);
  let findings=answer.findings;if(!Array.isArray(findings)){errors.push('findings must be an array');findings=[];}
  for(const item of findings)if(!object(item)||!['case_code','case_design','evidence','scenario','product','contract'].includes(item.kind)||typeof item.reason!=='string'||!item.reason.trim()||typeof item.requested_change!=='string'||!item.requested_change.trim())errors.push('review finding is incomplete');
  if(input.decision_gate_correction&&(input.decision_gate_correction.previous_review?.findings??[]).some(item=>!findings.some(other=>equal(item,other))))errors.push('decision correction must retain every original finding unchanged');
  const receipt=read(input.frozen_execution_receipt);let visualBug=false;
  if(object(input.ui_acceptance)){
    let ui=answer.ui_review;
    if(!object(ui)||typeof ui.reason!=='string'||!ui.reason.trim()){errors.push('UI review missing');ui={};}
    const required=input.ui_acceptance.required===true;
    if(!(required?['passed','failed','unverified']:['not_applicable']).includes(ui.status))errors.push('UI review status contradicts scene binding');
    let screenshots=ui.screenshot_paths;if(!Array.isArray(screenshots)||screenshots.some(p=>typeof p!=='string')){errors.push('UI screenshot references invalid');screenshots=[];}
    if(required&&['passed','failed'].includes(ui.status)){
      const images=new Map(read(input.frozen_evidence_manifest).files.filter(item=>image(item.path)).map(item=>[item.path,item.sha256])),attached=new Set((metrics.image_inputs??[]).filter(item=>object(item)&&images.get(item.path)===item.sha256).map(item=>item.sha256));
      if(!screenshots.length||screenshots.some(file=>!images.has(file)))errors.push('UI conclusion lacks bound frozen screenshots');
      if(!screenshots.length||screenshots.some(file=>!attached.has(images.get(file))))errors.push('UI conclusion lacks matching multimodal image input');
      if([...images].some(([file,hash])=>!fs.existsSync(file)||digest(file)!==hash))errors.push('frozen UI screenshot changed after review');
    }
    if(required&&ui.status==='unverified'&&status==='passed')errors.push('UI evidence unverified cannot pass');
    if(required&&ui.status==='failed'&&status==='passed')errors.push('failed UI check cannot pass');
    visualBug=required&&ui.status==='failed'&&screenshots.length>0&&!errors.some(e=>e.startsWith('UI conclusion lacks')||e==='frozen UI screenshot changed after review');
  }
  if(status==='passed'&&(receipt.exit_code!==0||findings.length))errors.push('pass contradicts execution exit or findings');
  if(status==='repair_required'&&!findings.length)errors.push('repair requires a concrete finding');
  if(status==='product_bug'&&((receipt.exit_code===0&&!visualBug)||!findings.some(item=>item.kind==='product')))errors.push('product BUG needs failed execution or frozen visual failure, and product finding');
  return {status:errors.length?'invalid':'valid',errors,review_status:status,execution_exit_code:receipt.exit_code};
}
export function handoffGate(request,catalog){
  const errors=[],root=fs.realpathSync(catalog.project_root),receiptPath=request.frozen_execution_receipt,log=request.frozen_execution_log,receipt=fs.existsSync(receiptPath)?read(receiptPath):{},revision=catalog.revision;
  if(receipt.coverage_build_path)errors.push('legacy isolated instrumentation is historical; bind a new project-owned coverage profile');
  if(!Object.keys(receipt).length)errors.push('frozen execution receipt missing');
  if(request.frozen_revision!==revision)errors.push('case version differs from prepared project');
  try{if(catalog.definitions&&!equal(request.definitions,catalog.definitions))throw Error('case and catalog definitions differ');verifyCase(request);}catch(error){errors.push('scene definition binding invalid: '+error.message);}
  if(Object.keys(receipt).length){
    if(receipt.head_before!==revision||receipt.head_after!==revision)errors.push('execution changed or used a different source revision');
    const before=(receipt.tracked_changes_before??'').split('\n').filter(Boolean).sort(),after=(receipt.tracked_changes_after??'').split('\n').filter(Boolean).sort();
    if(!equal(before,after)||after.some(name=>!(request.test_files??[]).includes(name)))errors.push('tracked product/source changes during execution');
    if(!Number.isSafeInteger(receipt.exit_code))errors.push('actual command exit code missing');
    if(!Array.isArray(receipt.command)||!receipt.command.length)errors.push('actual command missing');
    if(!fs.existsSync(log)||receipt.log_sha256!==digest(log))errors.push('execution log missing or hash mismatch');
    if(receipt.timed_out||receipt.cancelled)errors.push('execution timed out or was cancelled; preserve incomplete effects before review');
  }
  const paths=request.test_files??[],before=receipt.test_file_sha256_before??{},after=receipt.test_file_sha256_after??{};
  if(!Array.isArray(paths)||!paths.length)errors.push('selected test files missing');
  if(request.agent_result_path)try{const answer=read(request.agent_result_path);if(answer.case_identity)verifyIdentity(answer,root,{sceneId:request.scene?.id,acceptanceId:request.acceptance?.id,receiptHashes:before});}catch(error){errors.push('invalid selected case identity: '+error.message);}
  if(Object.keys(receipt).length){
    if(!equal(Object.keys(before).sort(),[...paths].sort())||!equal(Object.keys(after).sort(),[...paths].sort()))errors.push('test-file receipt does not bind exactly selected files');
    for(const name of paths)try{const file=inside(root,name);if(!fs.statSync(file).isFile()||after[name]!==before[name]||after[name]!==digest(file))throw Error('changed');}catch{errors.push('test file changed, missing or outside project: '+name);}
  }
  if(request.artifact_scope==='isolated_worktree'){
    const actual=git(root,'ls-files','-z','--others','--exclude-standard').split('\0').filter(Boolean),unbound=actual.filter(name=>!paths.includes(name));
    if(unbound.length)errors.push('isolated worktree has unbound non-ignored files: '+unbound.join(', '));
  }
  for(const file of request.execution_evidence_paths??[])if(!fs.existsSync(file))errors.push('execution evidence path missing: '+file);
  if(!request.frozen_evidence_manifest||!fs.existsSync(request.frozen_evidence_manifest))errors.push('frozen evidence manifest missing');
  else{
    const manifest=read(request.frozen_evidence_manifest);if(manifest.source_execution_sha256!==digest(receiptPath))errors.push('frozen evidence bound to another execution');
    for(const item of manifest.files??[])if(!fs.existsSync(item.path)||digest(item.path)!==item.sha256)errors.push('frozen evidence changed: '+item.path);
  }
  if(!request.coverage_result_path||!fs.existsSync(request.coverage_result_path))errors.push('coverage measurement status missing');
  else{
    const coverage=read(request.coverage_result_path);
    if(!['measured','incomplete','unavailable','off'].includes(coverage.status))errors.push('invalid coverage status');
    if(['measured','incomplete'].includes(coverage.status))try{if(coverage.protocol!==protocol)throw Error('legacy coverage capture is historical');verifyCoverageReport(request.coverage_result_path,receiptPath);}catch(error){errors.push('project coverage evidence invalid: '+error.message);}
  }
  if(!errors.length){
    if(git(root,'rev-parse','HEAD').trim()!==revision)errors.push('current project revision changed after execution');
    for(const component of catalog.components??[])try{if(git(inside(root,component.path),'rev-parse','HEAD').trim()!==component.revision)errors.push('prepared component revision changed: '+component.path);}catch{errors.push('prepared component missing: '+component.path);}
    for(const [name,hash]of Object.entries(catalog.source_hashes??{}))try{if(digest(inside(root,name))!==hash)errors.push('prepared product source changed: '+name);}catch{errors.push('prepared product source missing: '+name);}
  }
  return {schema:'single-scene-review-handoff-v1',status:errors.length?'repair_required':'ready_for_review',scene_id:request.scene?.id,execution_exit_code:receipt.exit_code,receipt_sha256:fs.existsSync(receiptPath)?digest(receiptPath):null,errors};
}
