// Project tools own instrumentation, merging, executable units and statistics.
// This module only binds immutable bytes, invokes argv and validates provenance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {read,inside,atomicJson} from './store.mjs';
import {digest,object} from './definitions.mjs';
import {validateRuntime} from './runtime.mjs';
import {verifyProbeReport} from './coverage-probes.mjs';
import {assertToolIdentity} from '../coverage/protocol/tools.mjs';
import {verifyLifecycleGate} from '../coverage/protocol/lifecycle.mjs';
export const protocol='project-coverage-v1';
const commandObservers=[];
export function withCoverageCommandObserver(observer,operation){commandObservers.push(observer);try{return operation();}finally{commandObservers.pop();}}
export function resolveArtifact(file,mapping={},expected){
  if(fs.existsSync(file)&&fs.statSync(file).isFile()&&(!expected||digest(file)===expected))return file;
  const item=(expected?mapping[file+'#'+expected]:null)??mapping[file];
  if(item&&(!expected||item.sha256===expected)){
    if(digest(item.path)!==item.sha256)throw Error('coverage artifact mapping changed: '+file);return item.path;
  }
  return file;
}
export function boundFile(file,expected,mapping={}){
  const actual=resolveArtifact(file,mapping,expected);
  if(fs.lstatSync(actual).isSymbolicLink()||!fs.statSync(actual).isFile()||digest(actual)!==expected)throw Error('coverage bound file missing or changed: '+file);
  return actual;
}
export function invokeCoverage(profile,operation,request,output,mapping={}){
  if(!Array.isArray(profile.entry)||!profile.entry.length||profile.entry.some(x=>typeof x!=='string'||!x))throw Error('project coverage entry must be an argv array');
  fs.mkdirSync(path.dirname(output),{recursive:true});const root=profile.spec.project_root,map={...mapping};
  const bindings=Object.fromEntries(Object.entries({...profile.spec.source_hashes,...profile.adapter_files}).map(([name,hash])=>[path.join(root,name),hash]));
  for(const [original,hash]of Object.entries(bindings))if(map[original+'#'+hash])map[original]=map[original+'#'+hash];
  for(const [name,hash]of Object.entries(profile.adapter_files??{}))boundFile(path.join(root,name),hash,map);
  const argv=profile.entry.map(x=>Object.hasOwn(map,x)?resolveArtifact(x,map,bindings[x]):x),folder=fs.mkdtempSync(path.join(path.dirname(output),'coverage-request-')),file=path.join(folder,'request.json');
  try{
    atomicJson(file,{...request,artifact_map:map});
    const started_at=new Date().toISOString(),actualArgv=[...argv.slice(1),operation,file,output],result=spawnSync(argv[0],[...argv.slice(1),operation,file,output],{cwd:fs.existsSync(root)?root:path.dirname(output),encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
    for(const observer of commandObservers)observer({operation,argv:[argv[0],...actualArgv],cwd:fs.existsSync(root)?root:path.dirname(output),started_at,finished_at:new Date().toISOString(),exit_code:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message??null,request:{...request,artifact_map:map}});
    if(result.error)throw result.error;
    if(result.status!==0)throw Error('project coverage '+operation+' failed: '+JSON.stringify({exit_code:result.status,signal:result.signal,command:[argv[0],...actualArgv],request:file,response:output,detail:String(result.stderr||result.stdout||(fs.existsSync(output)?fs.readFileSync(output,'utf8'):'No diagnostic text')).slice(-4000)}));
  }finally{fs.rmSync(folder,{recursive:true});}
  if(!fs.existsSync(output))throw Error('project coverage operation produced no response: '+operation);return read(output);
}
function relativeFile(root,name,mapping,hash){
  // inside rejects links within the live tree; archived aliases must be explicit.
  const file=inside(root,name);return boundFile(file,hash,mapping);
}
function tempOperation(prefix,operation){const directory=fs.mkdtempSync(path.join(os.tmpdir(),prefix));try{return operation(directory);}finally{fs.rmSync(directory,{recursive:true});}}
export function coveragePreparation(config,{runCheck=true,mapping={}}={}){
  if(config.protocol!==protocol)throw Error('required coverage needs a verified project coverage protocol; tool labels cannot certify metrics');
  const file=resolveArtifact(path.join(config.prepared,'prepared.json'),mapping,config.prepared_sha256),profile=read(file);
  if(profile.schema!=='project-coverage-preparation-v1')throw Error('invalid project coverage preparation');
  if(config.prepared_sha256&&digest(file)!==config.prepared_sha256)throw Error('coverage preparation changed');
  const spec=profile.spec,root=path.resolve(spec.project_root);
  if(!object(spec.source_hashes)||!Object.keys(spec.source_hashes).length||!spec.registry_path||!spec.inventory_path)throw Error('coverage needs complete source inventory and persistent evidence index');
  for(const name of ['inventory_path','registry_path'])if(!path.isAbsolute(spec[name]))throw Error('coverage '+name+' must be absolute');
  if(!spec.inventory_sha256)throw Error('coverage needs a frozen scope inventory digest');boundFile(spec.inventory_path,spec.inventory_sha256,mapping);
  for(const [name,hash]of Object.entries(spec.source_hashes))relativeFile(root,name,mapping,hash);
  if(!object(profile.adapter_files)||!Object.keys(profile.adapter_files).length||!Array.isArray(profile.tools)||!profile.tools.length)throw Error('coverage needs frozen project adapters and actual tool versions');
  for(const tool of profile.tools)if(!tool.name||!tool.version||!tool.role)throw Error('coverage tool provenance is incomplete');
  for(const [name,hash]of Object.entries(profile.adapter_files))relativeFile(root,name,mapping,hash);
  if(!Object.keys(profile.adapter_files).some(name=>profile.entry?.includes(name)||profile.entry?.includes(path.join(root,name))))throw Error('project coverage entry must include a frozen project adapter');
  const dispositions=profile.source_dispositions??{};
  if(!equal(Object.keys(dispositions).sort(),Object.keys(spec.source_hashes).sort()))throw Error('coverage disposition must cover every frozen source');
  if(Object.values(dispositions).some(x=>!['measured','non_executable','unsupported'].includes(x.kind)||!x.reason))throw Error('coverage source disposition is incomplete');
  if(!profile.preparation_evidence?.length)throw Error('coverage requires actual toolchain probe evidence');
  for(const item of profile.preparation_evidence)boundFile(item.path,item.sha256,mapping);
  if(profile.protocol_revision===2){
    if(!spec.lifecycle_report||!spec.lifecycle_report_sha256)throw Error('Coverage preparation lacks its complete lifecycle gate');
    verifyLifecycleGate(boundFile(spec.lifecycle_report,spec.lifecycle_report_sha256,mapping),profile,mapping);
  }
  const runtimeKeys=['runtime_manifest','runtime_sha256','probe_report','probe_report_sha256'];
  if(runtimeKeys.some(k=>spec[k])){
    if(!runtimeKeys.every(k=>spec[k]))throw Error('coverage runtime/probe binding is incomplete');
    const runtimePath=boundFile(spec.runtime_manifest,spec.runtime_sha256,mapping),probePath=boundFile(spec.probe_report,spec.probe_report_sha256,mapping),runtime=read(runtimePath);
    if(runtime.schema!=='project-runtime-preparation-v1'||path.resolve(runtime.workspace)!==root||runtime.revision!==spec.revision)throw Error('coverage profile binds another runtime workspace/revision');
    const live=!Object.keys(mapping).length&&path.resolve(runtimePath)===path.resolve(spec.runtime_manifest);
    if(runCheck&&live)validateRuntime(runtimePath,{expectedAcceptance:runtime.acceptance,resmoke:true});
    const measured=Object.entries(dispositions).filter(([,x])=>x.kind==='measured').map(([name])=>name),probe=verifyProbeReport(probePath,runtimePath,spec.runtime_sha256,measured,{verifyRuntime:runCheck&&live,mapping});
    const expected=probe.status==='ready'&&measured.length&&!Object.values(dispositions).some(x=>x.kind==='unsupported')?'ready':'partial';
    if(profile.preparation_status!==expected)throw Error('coverage readiness does not match validated probe/source limits');
  }
  if(runCheck)tempOperation('coverage-verify-preparation-',directory=>{
    if(invokeCoverage(profile,'verify-preparation',{prepared:file},path.join(directory,'checked.json'),mapping).status!=='valid')throw Error('project coverage preparation verification rejected');
  });
  return profile;
}
export function verifyCoverageReport(reportPath,receiptPath,{runCheck=true,mapping={}}={}){
  reportPath=resolveArtifact(reportPath,mapping);const report=read(reportPath);
  if(report.schema!=='project-tool-coverage-report-v1'||report.protocol!==protocol)throw Error('invalid project coverage report protocol');
  const profile=coveragePreparation(report,{runCheck,mapping});
  if(report.revision!==profile.spec.revision||!equal(report.source_hashes,profile.spec.source_hashes))throw Error('coverage source version mismatch');
  assertToolIdentity(report.tools,profile.tools,'Coverage report tool identity');
  if(report.collection_relation!=='same_run')throw Error('coverage execution relation mismatch');
  if(!['measured','incomplete'].includes(report.status)||!Array.isArray(report.components)||!report.components.length)throw Error('coverage report has no measured components');
  const receiptFile=boundFile(report.receipt_path,report.execution_sha256,mapping);
  if(receiptPath&&digest(resolveArtifact(receiptPath,mapping,report.execution_sha256))!==report.execution_sha256)throw Error('coverage is bound to another execution');
  const receipt=read(receiptFile),session=read(boundFile(receipt.coverage_session_path,receipt.coverage_session_sha256,mapping));
  if(session.scene_id!==report.scene_id||session.prepared_sha256!==report.prepared_sha256||session.prepared!==report.prepared||session.cwd!==profile.spec.project_root||(session.revision??report.revision)!==report.revision||receipt.head_before!==report.revision||receipt.head_after!==report.revision)throw Error('coverage scene/profile/source does not bind its frozen execution session');
  if(!equal(receipt.command,[...profile.entry,'run',receipt.coverage_session_path,path.join(session.output,'run-response.json')])||receipt.cwd!==session.cwd)throw Error('coverage receipt does not bind the prepared execution entry');
  if(!report.raw_evidence?.length)throw Error('coverage report lacks native evidence');
  for(const item of report.raw_evidence){
    if(![session.output,report.prepared].some(base=>item.path===base||item.path.startsWith(base+path.sep)))throw Error('native coverage evidence is outside its execution/preparation');
    boundFile(item.path,item.sha256,mapping);
  }
  for(const item of Object.values(report))if(object(item)&&typeof item.path==='string'&&typeof item.sha256==='string')boundFile(item.path,item.sha256,mapping);
  if(report.status==='measured'&&Object.values(profile.source_dispositions).some(x=>x.kind==='unsupported'))throw Error('unsupported source scope cannot claim complete measured coverage');
  for(const component of report.components){
    if(!component.id||!Array.isArray(component.source_paths)||!component.source_paths.length)throw Error('coverage component source binding missing');
    if(component.source_paths.some(name=>!Object.hasOwn(profile.spec.source_hashes,name)))throw Error('coverage component escapes frozen source inventory');
    for(const metric of ['line','branch']){
      const value=component[metric]??{};if(!['measured','incomplete','unavailable'].includes(value.status))throw Error('coverage metric status missing');
      if(['measured','incomplete'].includes(value.status)){
        if(!Number.isSafeInteger(value.covered)||!Number.isSafeInteger(value.total)||value.covered<0||value.covered>value.total)throw Error('invalid tool-owned coverage counts');
        if(Object.hasOwn(value,'pct')&&(typeof value.pct!=='number'||!Number.isFinite(value.pct)||value.pct<0||value.pct>100))throw Error('invalid tool-owned coverage percentage');
      }else if(!value.reason)throw Error('unavailable coverage metric needs reason');
    }
  }
  const represented=new Set(report.components.flatMap(c=>c.source_paths));
  if(Object.entries(profile.source_dispositions).some(([name,x])=>x.kind==='measured'&&!represented.has(name)))throw Error('coverage components omit frozen measured source');
  if(runCheck)tempOperation('coverage-verify-report-',directory=>{
    if(invokeCoverage(profile,'verify-report',{report:reportPath},path.join(directory,'checked.json'),mapping).status!=='valid')throw Error('project tool rejected native coverage report');
  });
  return report;
}
export function summarizeCoverage(reports,inventory,{mapping={}}={}){
  reports=[...new Set(reports)].sort();const checked=reports.map(file=>verifyCoverageReport(file,undefined,{mapping}));
  if(!checked.length||new Set(checked.map(r=>r.prepared_sha256)).size!==1)throw Error('coverage preparations are missing or incompatible');
  const profile=coveragePreparation(checked[0],{runCheck:false,mapping}),frozen=read(boundFile(profile.spec.inventory_path,profile.spec.inventory_sha256,mapping));
  if(inventory&&!equal(inventory,frozen))throw Error('coverage summary inventory differs from frozen preparation');
  const result=tempOperation('coverage-project-summary-',directory=>invokeCoverage(profile,'summarize',{reports,inventory:frozen},path.join(directory,'summary.json'),mapping));
  if(!object(result.scopes))throw Error('project coverage summary lacks scope');
  assertToolIdentity(result.tools,profile.tools,'Coverage summary tool identity');
  for(const name of ['project','changed_files','changed_lines']){
    const value=result.scopes[name]??{};
    if(!['measured','incomplete','unavailable'].includes(value.status))throw Error('project summarizer omitted coverage scope: '+name);
    if(value.status==='unavailable'&&!value.reason)throw Error('unsupported coverage scope needs a concrete reason');
  }
  return result;
}
