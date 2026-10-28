import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,ownedAbsolute,read,atomicJson,requireCurrent} from '../shared/store.mjs';
import {digest,currentBinding,fingerprint} from '../shared/definitions.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {guard} from '../shared/validation.mjs';
import {workspaceLease,workspaceSnapshot,verifyAllowedChanges,git} from '../shared/workspace.mjs';
import {validateRuntime} from '../shared/runtime.mjs';
import {projectCoverage,activateCoverage,policyPath} from '../shared/coverage-registry.mjs';
import {coveragePreparation} from '../shared/coverage.mjs';
import {runProcess} from '../shared/process.mjs';
import {filesUnder} from '../shared/recovery.mjs';
const rolesRoot=fileURLToPath(new URL('./roles',import.meta.url));
export async function prepareProject(input,{signal}={}){
 const allowed=['project_root','acceptance_id','request_id','definitions_sha256','basis','runtime','revision','source_paths','test_roots','source_roots','binding_files','coverage_test_files','components','coverage','runner_hints'];
 if(!input||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Project preparation contains unknown fields');
 const {root,local,shared}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||!String(input.basis??'').trim())throw Error('Project preparation needs stable identity and actual basis');
 const folder=inside(local,'workflows/project/'+input.request_id),workspace=inside(local,'workspace');
 if(fs.existsSync(folder)){
  if(!equal(read(path.join(folder,'input.json')),input))throw Error('Project request conflicts with frozen input');const result=read(path.join(folder,'result.json'));for(const [file,hash]of Object.entries(result.immutable_files))if(digest(file)!==hash)throw Error('Frozen project artifact changed');
  const catalog=read(result.catalog);let applicability='current';try{if(digest(path.join(shared,'scenarios.json'))!==input.definitions_sha256)throw Error();for(const [name,hash]of Object.entries({...catalog.source_hashes,...catalog.binding_files,...catalog.coverage_test_files}))if(digest(inside(workspace,name))!==hash)throw Error();validateRuntime(catalog.runtime.manifest,{expectedAcceptance:catalog.acceptance,resmoke:true});projectCoverage(workspace,catalog.coverage);}catch{applicability='stale';}return {...result,reused:true,applicability};
 }
 const definitions=currentBinding(root,input.acceptance_id);if(definitions.sha256!==input.definitions_sha256)throw Error('Project definitions changed');if(!input.runtime?.manifest||digest(ownedAbsolute(local,input.runtime.manifest))!==input.runtime.sha256)throw Error('Project needs a current verified runtime manifest');
 const knowledge=readKnowledge(root,input.acceptance_id,[]),config={acceptance:knowledge.acceptance,definitions,source_checkout:workspace,test_roots:input.test_roots};guard(config,[folder]);
 if(!Array.isArray(input.source_paths)||!input.source_paths.length||!Array.isArray(input.test_roots)||!input.test_roots.length)throw Error('Explicit source inventory and test roots required');
 fs.mkdirSync(folder,{recursive:true});atomicJson(path.join(folder,'input.json'),input);
 return await workspaceLease(config,folder,async({env})=>{
  const runtime=validateRuntime(input.runtime.manifest,{expectedAcceptance:knowledge.acceptance,resmoke:true});if(runtime.revision!==input.revision||runtime.workspace!==workspace||git(workspace,'rev-parse','HEAD').trim()!==input.revision)throw Error('Runtime verified another project version');
  const source_hashes={},binding_files={},coverage_test_files={};for(const [names,target]of [[input.source_paths,source_hashes],[input.binding_files??[],binding_files],[input.coverage_test_files??[],coverage_test_files]])for(const name of names){const file=inside(workspace,name);if(!fs.statSync(file).isFile())throw Error('Declared inventory is not a file: '+name);target[name]=digest(file);}
  for(const name of Object.keys(coverage_test_files))if(!input.test_roots.some(p=>name===p||name.startsWith(p.replace(/\/$/,'')+'/'))||Object.hasOwn(source_hashes,name))throw Error('Coverage adapter must belong to tests, not product source');
  const components=input.components??[];for(const part of components)if(git(inside(workspace,part.path),'rev-parse','HEAD').trim()!==part.revision)throw Error('Component revision changed');
  // A newly verified required profile may intentionally replace the prior
  // revision's active policy. Validate it fully before activation instead of
  // asking the obsolete policy to authorize its own replacement.
  let coverage=input.coverage?.policy==='required'?{...input.coverage}:projectCoverage(workspace,input.coverage)??{policy:'unavailable',reason:'No verified project coverage preparation supplied'};
  if(coverage.policy==='required'){
   const profile=coveragePreparation(coverage);if(!equal(profile.spec.source_hashes,source_hashes)||profile.spec.revision!==input.revision||!equal(profile.spec.components??{},Object.fromEntries(components.map(p=>[p.path,p.revision]))))throw Error('Coverage does not bind complete current source/component inventory');
   if(profile.spec.runtime_manifest!==input.runtime.manifest||profile.spec.runtime_sha256!==input.runtime.sha256)throw Error('Coverage prepared against another runtime');for(const [name,hash]of Object.entries(profile.adapter_files))if(coverage_test_files[name]!==hash)throw Error('Coverage adapter is not frozen in test inventory');coverage={...coverage,required_test_files:coverage_test_files,acceptance:knowledge.acceptance};
  }
  const catalog={schema:'portable-project-catalog-v1',project_id:path.basename(root),acceptance:knowledge.acceptance,definitions,workspace_policy:'single-acceptance-v1',preparation_protocol:'node-runtime-coverage-v1',project_root:workspace,revision:input.revision,components,source_paths:[...input.source_paths],source_hashes,binding_files,test_roots:input.test_roots,write_roots:input.test_roots,source_roots:input.source_roots??[],coverage_test_files,runner_hints:input.runner_hints??{},runtime:input.runtime,coverage};catalog.fingerprint=fingerprint(catalog);
  const catalogFile=path.join(folder,'catalog.json');atomicJson(catalogFile,catalog);if(coverage.policy==='required'){const policy=policyPath(workspace);if(policy&&fs.existsSync(policy))fs.copyFileSync(policy,path.join(folder,'coverage-policy.previous.json'),fs.constants.COPYFILE_EXCL);activateCoverage(coverage.prepared,catalogFile);if(policy)fs.copyFileSync(policy,path.join(folder,'coverage-policy.applied.json'),fs.constants.COPYFILE_EXCL);}
  const before=workspaceSnapshot(workspace,components),guideDirectory=path.join(folder,'semantics'),observation=await runProcess(process.execPath,[path.join(rolesRoot,'guide.mjs'),catalogFile,guideDirectory],{cwd:root,env,output:path.join(folder,'commands/semantics'),signal});
  if(observation.exit_code!==0||observation.timed_out||observation.cancelled)throw Error('Project operation guide incomplete; preserve official session and observations');verifyAllowedChanges(workspace,before,[],components);
  const metrics=read(path.join(guideDirectory,'metrics.json'));if(metrics.status!=='success')throw Error('Project preparer did not complete');
  const guide=read(path.join(guideDirectory,'guide.json'));for(const item of guide.source_basis??[])digest(inside(workspace,item.path));
  const result={schema:'acceptance-project-result-v1',status:'prepared',stopped_after:'project_preparation',acceptance_id:input.acceptance_id,revision:input.revision,catalog:catalogFile,guide:path.join(guideDirectory,'guide.json'),product_judgment:'not_performed',immutable_files:Object.fromEntries(filesUnder(folder).map(file=>[file,digest(file)]))};atomicJson(path.join(folder,'result.json'),result);return result;
 });
}
