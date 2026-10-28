import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,ownedAbsolute,read,atomicJson,requireCurrent} from '../shared/store.mjs';
import {validateStore} from '../shared/validation.mjs';
import {workspaceMetadataLock} from '../shared/workspace.mjs';
import {digest} from '../shared/definitions.mjs';
import {coveragePreparation,verifyCoverageReport,summarizeCoverage} from '../shared/coverage.mjs';
const deny=new Set(['node_modules','.git','checkout','raw-evidence','.secrets']);
export function noSecrets(file){
 const scan=text=>{
  for(const [key,value]of Object.entries(process.env))if(/KEY|TOKEN|AUTH|SECRET|PASSWORD/i.test(key)&&value.length>12&&text.includes(value))throw Error('Selected publication file contains an active credential; redact into a new explicitly reviewed artifact');
  if(/(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"(?:api_key|apiKey|authToken|password)"\s*:\s*"(?!\[REDACTED\]|\*\*\*|\s*")[^"\s]{12,}")/.test(text))throw Error('Selected publication file may contain a credential; inspect and redact a separate copy');
 };
 const text=fs.readFileSync(file).toString('utf8');scan(text);let value;try{value=JSON.parse(text);}catch{return;}
 function nested(item){if(!item||typeof item!=='object')return;for(const [key,value]of Object.entries(item)){if(['base64','before_base64'].includes(key)&&typeof value==='string')scan(Buffer.from(value,'base64').toString('utf8'));else if(value&&typeof value==='object')nested(value);}}nested(value);
}
export function archiveAcceptance(input){
 const allowed=['project_root','acceptance_id','request_id','basis','files','results','coverage_reports'];if(!input||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Archive request has unknown fields');
 const {root,shared,local}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);const state=validateStore(root,input.acceptance_id);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||!String(input.basis??'').trim())throw Error('Stable archive identity and actual reviewed basis required');
 const folder=inside(local,'workflows/archive/'+input.request_id),base=inside(local,'workflows');if(fs.existsSync(folder)){if(!equal(read(path.join(folder,'input.json')),input))throw Error('Archive request identity conflict');const value=read(path.join(folder,'result.json')),record=read(path.join(value.record,'record.json'));if(digest(path.join(value.record,'record.json'))!==value.archive_sha256)throw Error('Archive record changed');for(const [name,hash]of Object.entries(record.files))if(digest(inside(value.record,name))!==hash)throw Error('Archived evidence changed');return {...value,reused:true};}
 const selected=new Set(),sourceHashes=new Map(),originals={},aliases={},reports=new Set(),add=(file,expected)=>{const owned=ownedAbsolute(base,path.resolve(file));if(!fs.statSync(owned).isFile()||path.basename(owned)==='record.json')throw Error('Invalid selected publication file');if(expected&&digest(owned)!==expected)throw Error('Selected publication bytes changed: '+owned);const relative=path.relative(base,owned);if(relative.split(path.sep).some(p=>deny.has(p)||p.startsWith('.env'))||/^(?:agent|native-events|.*\.records)\.jsonl$/.test(path.basename(owned)))throw Error('Raw environment/session assets are not part of the publication profile');noSecrets(owned);sourceHashes.set(owned,digest(owned));selected.add(owned);originals[owned]=relative;return owned;};
 for(const file of input.files??[])add(file);
 for(const resultFile of input.results??[]){
  const file=add(resultFile),result=read(file),directory=path.dirname(file);if(result.schema==='acceptance-manual-execute-result-v1'){
   add(path.join(directory,'input.json'));add(path.join(directory,'request.frozen.json'));add(result.observation_path,result.immutable_files?.[result.observation_path]);const review=read(add(result.review_path,result.immutable_files?.[result.review_path]));for(const name of ['metrics.json','decision-gate.json'])add(path.join(path.dirname(result.review_path),name));const manifest=read(add(path.join(directory,'frozen-evidence.json')));for(const file of review.ui_review?.screenshot_paths??[]){const item=manifest.files.find(x=>x.path===file);if(!item)throw Error('Manual UI review references unfrozen image');add(file,item.sha256);}continue;
  }if(result.schema!=='acceptance-execute-result-v1'||result.status!=='completed')throw Error('Result publication requires a completed new execution workflow');
  for(const name of ['input.json','request.frozen.json','sources.json','state.json','initial-identity.json'])add(path.join(directory,name));
  const reviewFile=add(result.review_path),reviewInput=read(add(path.join(path.dirname(reviewFile),'input.json'))),review=read(reviewFile);for(const name of ['metrics.json','decision-gate.json'])add(path.join(path.dirname(reviewFile),name));
  const receiptFile=add(reviewInput.frozen_execution_receipt),receipt=read(receiptFile);add(path.join(path.dirname(receiptFile),'execution.log'),receipt.log_sha256);
  const answerFile=add(result.active_case_answer),answer=read(answerFile);if(answer.case_identity){const identity=read(add(answer.case_identity.path,answer.case_identity.sha256));add(path.join(path.dirname(answer.case_identity.path),'answer.agent.json'),identity.raw_answer_sha256);}
  const coverage=read(add(result.coverage_result_path));if(coverage.protocol==='project-coverage-v1'){const report=add(coverage.report_path,coverage.report_sha256);if(coverage.execution_sha256!==digest(receiptFile))throw Error('Final coverage does not bind final reviewed execution');reports.add(report);}
  if(reviewInput.frozen_evidence_manifest){const manifest=read(add(reviewInput.frozen_evidence_manifest)),byPath=new Map(manifest.files.map(x=>[x.path,x]));for(const image of review.ui_review?.screenshot_paths??[]){const descriptor=byPath.get(image);if(!descriptor)throw Error('UI review image was not in its frozen manifest');add(image,descriptor.sha256);}if(['passed','failed'].includes(review.ui_review?.status)&&!review.ui_review.screenshot_paths?.length)throw Error('UI judgment lacks real frozen image references');}
 }
 for(const file of input.coverage_reports??[])reports.add(add(file));
 for(const reportFile of reports){
  const report=verifyCoverageReport(reportFile,path.join(path.dirname(reportFile),'execution.json')),profile=coveragePreparation(report),preparedFile=add(path.join(report.prepared,'prepared.json'),report.prepared_sha256),receiptFile=add(report.receipt_path),receipt=read(receiptFile);
  add(path.join(path.dirname(receiptFile),'execution.log'),receipt.log_sha256);add(receipt.coverage_session_path,receipt.coverage_session_sha256);add(profile.spec.inventory_path);
  for(const item of [...report.raw_evidence,...profile.preparation_evidence])add(item.path,item.sha256);
  if(profile.spec.lifecycle_report){const gate=read(add(profile.spec.lifecycle_report,profile.spec.lifecycle_report_sha256));for(const ref of gate.files)add(ref.path,ref.sha256);}
  for(const item of Object.values(report))if(item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.path==='string'&&typeof item.sha256==='string')add(item.path,item.sha256);
  if(profile.spec.runtime_manifest){add(profile.spec.runtime_manifest,profile.spec.runtime_sha256);const probe=read(add(profile.spec.probe_report,profile.spec.probe_report_sha256));add(probe.plan,probe.plan_sha256);for(const route of probe.routes??[])for(const attempt of Object.values(route.probes??{}))if(attempt.status==='passed'){
   for(const reference of Object.values(attempt.receipts??{})){const value=read(add(reference.path,reference.sha256));for(const stream of ['stdout','stderr'])add(value[stream].path,value[stream].sha256);}for(const reference of attempt.native??[])add(reference.path,reference.sha256);
  }}
  for(const [original,alias]of Object.entries(profile.artifact_aliases??{})){const file=typeof alias==='string'?alias:alias.path,relative=path.relative(profile.spec.project_root,original);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Coverage publication alias escapes source inventory');const expected=profile.adapter_files[relative]??profile.spec.source_hashes[relative]??alias.sha256;if(!expected)throw Error('Coverage alias has no frozen hash');const owned=add(file,expected);aliases[original]=path.relative(base,owned);}
  for(const name of Object.keys(profile.adapter_files))if(!aliases[path.join(profile.spec.project_root,name)])throw Error('Offline coverage publication lacks frozen adapter copy: '+name);
 }
 if(!selected.size)throw Error('Explicit reviewed file allowlist or result profile required');
 return workspaceMetadataLock(root,input.acceptance_id,()=>{
  if(fs.existsSync(inside(local,'workspace-owner.json')))throw Error('A scene is still active; reconcile or complete it before publication');
  fs.mkdirSync(folder,{recursive:true});atomicJson(path.join(folder,'input.json'),input);const target=inside(shared,'records/evidence-'+randomUUID().replaceAll('-',''));fs.mkdirSync(target,{recursive:true});const files={};
  for(const file of [...selected].sort()){const name=path.relative(base,file),destination=inside(target,name);fs.mkdirSync(path.dirname(destination),{recursive:true});if(digest(file)!==sourceHashes.get(file))throw Error('Publication source changed before copying');fs.copyFileSync(file,destination,fs.constants.COPYFILE_EXCL);if(digest(destination)!==sourceHashes.get(file)||digest(file)!==sourceHashes.get(file))throw Error('Publication source changed during copying');fs.chmodSync(destination,fs.statSync(file).mode&0o777);files[name]=digest(destination);}
  let coverageSummary=null;if(reports.size){const values=[...reports],profiles=new Set(values.map(file=>read(file).prepared_sha256));if(profiles.size!==1)throw Error('Publication cannot combine incompatible coverage profiles');const profile=coveragePreparation(read(values[0]));coverageSummary='coverage-summary.json';atomicJson(path.join(target,coverageSummary),{schema:'project-coverage-summary-snapshot-v1',reports:values.map(file=>({path:file,sha256:digest(file)})),prepared_sha256:[...profiles][0],summary:summarizeCoverage(values,read(profile.spec.inventory_path))});files[coverageSummary]=digest(path.join(target,coverageSummary));}
  const record={schema:'acceptance-evidence-record-v1',acceptance_id:input.acceptance_id,scope_sha256:state.scope.sha256,created_at:new Date().toISOString(),basis:input.basis,files,original_paths:originals,path_aliases:aliases,coverage_summary:coverageSummary,coverage_reports:[...reports].map(file=>path.relative(base,file)),workflow_requests:Object.fromEntries([...selected].filter(file=>path.basename(file)==='request.frozen.json').map(file=>[path.relative(base,file),{original_path:file,source_mtime:fs.statSync(file).mtime.toISOString()}]))};atomicJson(path.join(target,'record.json'),record);
  const result={schema:'acceptance-archive-result-v1',status:'archived',record:target,files:Object.keys(files).length,archive_sha256:digest(path.join(target,'record.json')),basis:input.basis};atomicJson(path.join(folder,'result.json'),result);return result;
 });
}
