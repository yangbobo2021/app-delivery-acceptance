import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,atomicJson,requireCurrent} from '../shared/store.mjs';
import {guard,validateStore} from '../shared/validation.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {digest,loadBinding,object} from '../shared/definitions.mjs';
import {workspaceMetadataLock,ensureWorkspace,workspaceSnapshot,git} from '../shared/workspace.mjs';
import {snapshotExisting} from '../shared/existing-policy.mjs';
import {validateRuntime,observeRuntime} from '../shared/runtime.mjs';

function boundary(config,output,operation){
  const {root,local}=locations(config.acceptance.project_root,config.acceptance.id);guard(config,[output]);
  return workspaceMetadataLock(root,config.acceptance.id,()=>{
    guard(config,[output]);if(fs.existsSync(inside(local,'workspace-owner.json')))throw Error('Another scene owns this workspace; resume/reconcile it before runtime preparation');return operation();
  });
}
function saveOnce(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function inspectionFile(workspace,name){
  if(typeof name!=='string'||name.split('/').some(part=>['.git','.acceptance','.acceptance-local'].includes(part)))throw Error('Runtime inspection file is outside frozen workspace');
  const file=inside(workspace,name);if(!fs.statSync(file).isFile())throw Error('Runtime inspection file is unavailable: '+name);return file;
}
export function prepareRuntimeRequest(value,folder){
  const {root,shared}=locations(value.project_root,value.acceptance_id);requireCurrent(root,value.acceptance_id);validateStore(root,value.acceptance_id);
  const latest=read(inside(shared,'scenarios.json')),definitions={path:inside(shared,latest.definition_record),sha256:digest(inside(shared,latest.definition_record))};
  if(definitions.sha256!==value.definitions_sha256)throw Error('Runtime definitions changed');
  if(!Array.isArray(value.test_roots)||!value.test_roots.length)throw Error('Explicit project test_roots required');
  const names=value.inspection_files;if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length)throw Error('Explicit unique runtime inspection_files required');
  const knowledge=readKnowledge(root,value.acceptance_id,value.knowledge_paths??[]),request={...Object.fromEntries(['source_checkout','revision','test_roots','components','component_sources'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]])),schema:'project-runtime-agent-request-v1',acceptance:knowledge.acceptance,definitions};
  if(!request.revision||!request.source_checkout)throw Error('Actual source_checkout and immutable revision required');guard(request,[folder]);saveOnce(path.join(folder,'request.frozen.json'),request);
  const observations=[],workspace=boundary(request,folder,()=>ensureWorkspace(request,request.source_checkout,request.revision,request.components??[],request.component_sources??{},observations));saveOnce(path.join(folder,'bootstrap.json'),{workspace,revision:request.revision,commands:observations});
  const files={};for(const name of names){const file=inspectionFile(workspace,name);files[name]={sha256:digest(file),text:new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file))};}
  if(Object.values(files).reduce((sum,item)=>sum+[...item.text].length,0)>500000)throw Error('Runtime inspection exceeds 500000 characters; select necessary project materials');
  const executables=(value.available_executables??[]).map(item=>{if(typeof item.path!=='string'||!path.isAbsolute(item.path)||!fs.existsSync(item.path)||!fs.statSync(item.path).isFile())throw Error('Available executable is not an actual executable file');fs.accessSync(item.path,fs.constants.X_OK);return {...item,resolved_path:fs.realpathSync(item.path),sha256:digest(fs.realpathSync(item.path))};});
  const inspection={workspace,files,available_executables:executables,inherited_environment:{PATH:process.env.PATH??''},knowledge:knowledge.contents,baseline:workspaceSnapshot(workspace,request.components??[]).files,baseline_modes:snapshotExisting({project_root:workspace,components:request.components??[]})};saveOnce(path.join(folder,'inspection.json'),inspection);return {request,inspection};
}
function expand(value,workspace,runtimeRoot){if(typeof value!=='string')throw Error('Runtime command values must be strings');return value.replaceAll('{workspace}',workspace).replaceAll('{runtime_root}',runtimeRoot);}
function command(item,workspace,runtimeRoot){
  if(!object(item)||!Array.isArray(item.command)||!item.command.length||item.command.some(x=>typeof x!=='string'||!x))throw Error('Runtime command must contain a nonempty argv string array');
  const argv=item.command.map(x=>expand(x,workspace,runtimeRoot)),cwd=fs.realpathSync(expand(item.cwd??'{workspace}',workspace,runtimeRoot));
  if(![workspace,runtimeRoot].some(root=>cwd===root||cwd.startsWith(root+path.sep))||!fs.statSync(cwd).isDirectory())throw Error('Runtime command cwd escapes acceptance workspace/runtime root or is missing');
  if(!object(item.env??{})||Object.values(item.env??{}).some(x=>typeof x!=='string'))throw Error('Runtime command env must have string values');
  const timeout=item.timeout_seconds??120;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800)throw Error('Runtime command timeout_seconds must be 1..1800');
  return {command:argv,cwd,env:Object.fromEntries(Object.entries(item.env??{}).map(([k,v])=>[k,expand(v,workspace,runtimeRoot)])),timeout_seconds:timeout};
}
function run(item,log){
  const start=performance.now(),started_at=new Date().toISOString(),observed=observeRuntime(item);fs.writeFileSync(log,observed.raw,{flag:'wx'});
  const receipt={...item,exit_code:observed.exit_code,seconds:(performance.now()-start)/1000,started_at,finished_at:new Date().toISOString(),log,output_sha256:digest(log)};
  return receipt;
}
const successful=receipt=>{if(receipt.exit_code!==0)throw Error('Runtime command did not succeed: '+receipt.log);};
export function installRuntimeSpec(specFile,output){
  specFile=fs.realpathSync(specFile);const spec=read(specFile);if(spec.schema!=='project-runtime-spec-v1')throw Error('Unsupported runtime spec schema');const binding=guard(spec,[output]);
  if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Runtime preparation output is immutable; use a new workflow attempt');
  const receipt=read(binding.knowledge_receipt),knowledgeUsed=spec.knowledge_used??['INDEX.md'];
  if(!Array.isArray(knowledgeUsed)||!knowledgeUsed.length||!knowledgeUsed.includes('INDEX.md')||knowledgeUsed.some(name=>!Object.hasOwn(receipt.read_files,name)))throw Error('Runtime knowledge_used must name actually read indexed assets including INDEX.md');
  if(typeof spec.recipe_candidate!=='string'||!spec.recipe_candidate.trim())throw Error('Runtime preparation needs a reusable recipe candidate');
  fs.mkdirSync(output,{recursive:true});const runtimeRoot=path.join(output,'runtime');fs.mkdirSync(runtimeRoot);fs.writeFileSync(path.join(output,'recipe-candidate.md'),spec.recipe_candidate.trim()+'\n',{flag:'wx'});
  boundary(spec,output,()=>{
    const observations=[],workspace=ensureWorkspace(spec,spec.source_checkout??binding.project_root,spec.revision,spec.components??[],spec.component_sources??{},observations),before=git(workspace,'diff','--name-only','HEAD'),dependencyHashes={};
    for(const name of spec.dependency_files??[]){const file=inside(workspace,name);if(!fs.statSync(file).isFile())throw Error('Dependency file missing: '+name);dependencyHashes[name]=digest(file);}
    const setup=[];
    try{
      for(const [index,item]of (spec.setup_commands??[]).entries()){const result=run(command(item,workspace,runtimeRoot),path.join(output,'setup-'+String(index).padStart(2,'0')+'.log'));setup.push(result);successful(result);}
      const executables=[];
      for(const [index,item]of (spec.executables??[]).entries()){
        if(!object(item)||typeof item.name!=='string'||!/^[A-Za-z0-9_-]+$/.test(item.name))throw Error('Executable requires a name');
        const file=expand(item.path??'',workspace,runtimeRoot);if(!path.isAbsolute(file)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Executable path must be an existing executable file');fs.accessSync(file,fs.constants.X_OK);
        const resolved=fs.realpathSync(file),version=command({command:item.version_command,cwd:'{workspace}',timeout_seconds:30},workspace,runtimeRoot);if(version.command[0]!==file)throw Error('Version command must invoke recorded executable');
        const result=run(version,path.join(output,'version-'+String(index).padStart(2,'0')+'.log'));successful(result);executables.push({name:item.name,path:file,resolved_path:resolved,sha256:digest(resolved),version_command:version.command,version_output:fs.readFileSync(result.log,'utf8').trim(),version_receipt:result});
      }
      if(!executables.length)throw Error('Runtime preparation needs at least one verified executable');
      const smoke=run(command(spec.smoke,workspace,runtimeRoot),path.join(output,'smoke.log'));successful(smoke);
      if(before!==git(workspace,'diff','--name-only','HEAD'))throw Error('Runtime setup changed tracked project files');
      for(const [name,expected]of Object.entries(dependencyHashes))if(digest(inside(workspace,name))!==expected)throw Error('Runtime setup changed frozen dependency files');
      const manifest={schema:'project-runtime-preparation-v1',status:'ready',acceptance:binding,workspace,runtime_root:runtimeRoot,revision:spec.revision,components:spec.components??[],test_roots:spec.test_roots??[],platform:{system:os.type(),machine:os.machine()},dependency_hashes:dependencyHashes,knowledge_receipt:binding.knowledge_receipt,knowledge_read_sha256:digest(binding.knowledge_receipt),knowledge_used:knowledgeUsed,spec_path:specFile,spec_sha256:digest(specFile),recipe_candidate:path.join(output,'recipe-candidate.md'),recipe_candidate_sha256:digest(path.join(output,'recipe-candidate.md')),setup,executables,smoke};saveOnce(path.join(output,'runtime.json'),manifest);
    }catch(error){saveOnce(path.join(output,'failure.json'),{schema:'project-runtime-failure-v1',reason:error.message,spec_sha256:digest(specFile),setup});throw error;}
  });return validateRuntime(path.join(output,'runtime.json'),{expectedAcceptance:binding,resmoke:true});
}
export function finishRuntimeRequest(folder){
  const request=read(path.join(folder,'request.frozen.json'));guard(request,[folder]);loadBinding(request,{required:true});const inspection=read(path.join(folder,'inspection.json')),workspace=inspection.workspace;
  if(git(workspace,'rev-parse','HEAD').trim()!==request.revision||!equal(workspaceSnapshot(workspace,request.components??[]).files,inspection.baseline)||(inspection.baseline_modes&&!equal(snapshotExisting({project_root:workspace,components:request.components??[]}),inspection.baseline_modes)))throw Error('Runtime planner changed or received changed workspace bytes/modes');
  const draft=read(path.join(folder,'candidate.json')),allowed=new Set(['dependency_files','knowledge_used','setup_commands','executables','smoke','recipe_candidate','blocked_reason']);
  if(!object(draft)||Object.keys(draft).some(key=>!allowed.has(key)))throw Error('Runtime plan has undeclared fields');if(draft.blocked_reason)throw Error('Runtime planner blocked: '+draft.blocked_reason);
  for(const key of ['dependency_files','knowledge_used','setup_commands','executables'])if(!Array.isArray(draft[key]))throw Error('Runtime plan requires array: '+key);
  if(!object(draft.smoke)||typeof draft.recipe_candidate!=='string'||!draft.recipe_candidate.trim())throw Error('Runtime plan requires smoke and nonempty recipe_candidate');
  const spec={...Object.fromEntries(['acceptance','source_checkout','revision','test_roots','components','component_sources'].filter(key=>Object.hasOwn(request,key)).map(key=>[key,request[key]])),...draft,schema:'project-runtime-spec-v1'};saveOnce(path.join(folder,'agent-spec.json'),spec);
  const result=installRuntimeSpec(path.join(folder,'agent-spec.json'),path.join(folder,'runtime'));
  if(!equal(workspaceSnapshot(workspace,request.components??[]).files,inspection.baseline)||(inspection.baseline_modes&&!equal(snapshotExisting({project_root:workspace,components:request.components??[]}),inspection.baseline_modes)))throw Error('Runtime setup changed frozen tracked or nonignored project bytes/modes');
  atomicJson(path.join(folder,'verification.json'),result);return result;
}
