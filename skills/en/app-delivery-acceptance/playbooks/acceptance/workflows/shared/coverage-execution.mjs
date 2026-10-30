import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {read,inside,locations,ownedAbsolute,atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';
import {guard} from './validation.mjs';
import {git} from './workspace.mjs';
import {protocol,coveragePreparation,invokeCoverage,verifyCoverageReport} from './coverage.mjs';
import {projectCoverage,ensureActive,registerCoverage} from './coverage-registry.mjs';
import {recordExecution} from './recorder.mjs';

function executionBinding(request,active){
  const binding=active.acceptance??request.acceptance;
  if(!binding){if(path.resolve(request.cwd).split(path.sep).includes('.acceptance-local'))throw Error('Acceptance coverage requires a bound catalog');return;}
  // A boundary records its own real knowledge-read receipt. That receipt is
  // evidence of the read, not the stable acceptance identity. Validate both
  // reads while comparing the project/AT/frozen scope that must be identical.
  if(request.acceptance&&['project_root','id','scope_sha256'].some(key=>request.acceptance[key]!==binding[key]))throw Error('Coverage acceptance mismatch');
  guard({acceptance:binding,source_checkout:request.cwd},[request.output,...(request.fresh_dirs??[])]);
  if(request.acceptance)guard({acceptance:request.acceptance,source_checkout:request.cwd},[request.output,...(request.fresh_dirs??[])]);
  const {local}=locations(binding.project_root,binding.id);
  if(fs.realpathSync(request.cwd)!==inside(local,'workspace'))throw Error('Coverage must use the acceptance workspace');
  for(const key of request.output_env_dir_keys??[])if(request.env?.[key])ownedAbsolute(inside(local,'workflows'),request.env[key]);
}
export async function runCoverage(request,options={}){
  const root=fs.realpathSync(request.cwd),out=path.resolve(request.output),config=request.coverage??{},active=projectCoverage(root,config)??config;
  executionBinding(request,active);
  const profile=coveragePreparation(active);ensureActive(active.prepared);const spec=profile.spec;
  if(path.resolve(spec.project_root)!==root)throw Error('Coverage project root mismatch');
  if(!request.scene_id||!request.command?.length)throw Error('Coverage needs an exact scene/command');
  if(config.scene_id&&config.scene_id!==request.scene_id)throw Error('Coverage request differs from bound scene');
  const revision=git(root,'rev-parse','HEAD').trim();
  if(revision!==spec.revision||(request.revision??revision)!==revision)throw Error('Product revision changed');
  if(request.inventory_path&&digest(request.inventory_path)!==digest(spec.inventory_path))throw Error('Coverage scope inventory mismatch');
  for(const [name,hash]of Object.entries(spec.source_hashes))if(digest(inside(root,name))!==hash)throw Error('Original product source changed: '+name);
  const required={...profile.adapter_files,...(active.required_test_files??{})};
  for(const [name,hash]of Object.entries(required))if(digest(inside(root,name))!==hash)throw Error('Prepared coverage fixture changed: '+name);
  const files=[...new Set([...(request.files??[]),...Object.keys(required)])];for(const name of files)if(!fs.statSync(inside(root,name)).isFile())throw Error('Coverage test file escapes project: '+name);
  if(fs.existsSync(out))throw Error('Coverage execution output already exists; preserve previous attempt');fs.mkdirSync(out,{recursive:true});
  const frozen={...request,cwd:root,output:out,files,coverage:active,prepared:active.prepared,prepared_sha256:digest(path.join(active.prepared,'prepared.json'))},requestFile=path.join(out,'coverage-request.json');atomicJson(requestFile,frozen);
  try{
    const receipt=await recordExecution({cwd:root,output:path.join(out,'command'),files,env:request.env??{},fresh_dirs:request.fresh_dirs??[],coverage_session:requestFile,command:[...profile.entry,'run',requestFile,path.join(out,'run-response.json')]},options);
    fs.copyFileSync(path.join(out,'command/execution.json'),path.join(out,'execution.json'),fs.constants.COPYFILE_EXCL);fs.copyFileSync(path.join(out,'command/execution.log'),path.join(out,'execution.log'),fs.constants.COPYFILE_EXCL);
    for(const [name,hash]of Object.entries(spec.source_hashes))if(digest(inside(root,name))!==hash)throw Error('Coverage adapter did not restore original source: '+name);
    invokeCoverage(profile,'finish',{request:requestFile,receipt:path.join(out,'execution.json'),output:out},path.join(out,'coverage-report.json'));
    verifyCoverageReport(path.join(out,'coverage-report.json'),path.join(out,'execution.json'));registerCoverage(path.join(out,'coverage-report.json'));return receipt;
  }finally{
    atomicJson(path.join(out,'restored-source.json'),Object.fromEntries(Object.keys(spec.source_hashes).map(name=>[name,fs.existsSync(inside(root,name))?digest(inside(root,name)):null])));
  }
}
export function freezeCoverage(spec,executionDirectory,receiptPath,destination){
  spec??={policy:'unavailable',reason:'No project coverage preparation was supplied'};let result;
  if(spec.policy==='required'){
    if(spec.protocol!==protocol)throw Error('New execution requires a project-owned coverage profile; legacy captures remain historical');
    const report=path.join(executionDirectory,'coverage-report.json');result={...verifyCoverageReport(report,receiptPath),report_path:report,report_sha256:digest(report),capture_end:read(receiptPath).end_utc};
  }else if(['off','unavailable'].includes(spec.policy))result={status:spec.policy,reason:spec.reason??(spec.policy==='off'?'Explicitly skipped':'Project coverage preparation unavailable'),...(spec.tools?{tools:spec.tools}:{}),...(spec.tool?{tool:spec.tool}:{})};
  else throw Error('coverage policy must be required, unavailable or off');
  const file=destination+'.json';atomicJson(file,result);return {result,path:file,evidence_paths:['measured','incomplete'].includes(result.status)?result.raw_evidence.map(item=>item.path):[]};
}
