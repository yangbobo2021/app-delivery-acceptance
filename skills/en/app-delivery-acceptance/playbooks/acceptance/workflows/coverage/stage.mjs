import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {begin,complete,failure,read,sha,json,owned,packageRoot} from '../shared/artifacts.mjs';
import {workspaceLease,git} from '../shared/workspace.mjs';
import {acceptanceGuard} from '../shared/guard.mjs';
import {ownedAbsolute,locations,inside} from '../shared/store.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {coveragePreparation} from '../shared/coverage.mjs';
import {setCoverageOff} from '../shared/coverage-registry.mjs';
import {runProcess} from '../shared/process.mjs';

const allowed=['project_root','acceptance_id','request_id','definitions_sha256','policy','basis','runtime_manifest','runtime_sha256',
  'inventory_path','inventory_sha256','source_hashes','test_roots','components','expected_measured_sources','prior_attempts','knowledge_paths'];
function ownedArtifact(input,file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Absolute acceptance artifact path required');
  const base=owned(input.project_root,'.acceptance-local/'+input.acceptance_id);
  return ownedAbsolute(base,file);
}
function verifyCached(result){
  if(result.policy_change&&(!fs.existsSync(result.policy_change.policy_path)||sha(result.policy_change.policy_path)!==result.policy_change.policy_sha256))throw Error('Explicit coverage policy changed after this decision');
  if(result.coverage?.policy!=='required')return result;
  const profile=read(path.join(result.coverage.prepared,'prepared.json')),runtime=read(profile.spec.runtime_manifest);
  if(sha(profile.spec.runtime_manifest)!==profile.spec.runtime_sha256||git(runtime.workspace,'rev-parse','HEAD').trim()!==runtime.revision)throw Error('Coverage runtime/source revision changed');
  coveragePreparation(result.coverage,{runCheck:false});
  return {...result,current_binding_verified:true,runtime_smoke_repeated:false};
}
export async function prepareCoverage(input,{signal}={}){
  let spec;
  try{
    spec=begin(input,'coverage',allowed);
    if(spec.completed){
      if(!spec.completed.source_definitions_match_current)return {...spec.completed,status:'stale',reason:'Coverage definitions superseded',historical_report_preserved:true};
      try{return verifyCached(spec.completed);}catch(error){return {...spec.completed,status:'stale',reason:error.message,historical_report_preserved:true};}
    }
    const value=spec.normalized;
    if(!['required','off','unavailable'].includes(value.policy)||typeof value.basis!=='string'||!value.basis.trim())throw Error('Coverage policy and actual decision basis required');
    if(value.policy!=='required'){
      let change;
      const {local}=locations(value.project_root,value.acceptance_id),workspace=inside(local,'workspace');
      if(value.policy==='off'&&fs.existsSync(workspace)){
        const knowledge=readKnowledge(value.project_root,value.acceptance_id,value.knowledge_paths??[]),config={acceptance:knowledge.acceptance,source_checkout:workspace};
        return await workspaceLease(config,spec.folder,async()=>{
          change=setCoverageOff(workspace,knowledge.acceptance,value.basis,spec.folder);
          return complete(spec,{status:'off',reason:value.basis,policy_change:change,stopped_after:'coverage_preparation',business_tests:'not_executed'},['coverage-policy.applied.json','coverage-policy-change.json',...(change.previous_sha256?['coverage-policy.previous.json']:[])]);
        });
      }
      return complete(spec,{status:value.policy,reason:value.basis,stopped_after:'coverage_preparation',business_tests:'not_executed'},[]);
    }
    const manifest=ownedArtifact(value,value.runtime_manifest),inventory=ownedArtifact(value,value.inventory_path);
    if(sha(manifest)!==value.runtime_sha256||sha(inventory)!==value.inventory_sha256)throw Error('Coverage runtime or source inventory changed');
    const runtime=read(manifest);
    if(runtime.acceptance?.id!==value.acceptance_id||runtime.acceptance.project_root!==value.project_root||runtime.status!=='ready')throw Error('Coverage needs a verified runtime for this acceptance');
    const inventoryValue=read(inventory);
    if(!inventoryValue.source_hashes||!isDeepStrictEqual(value.source_hashes,inventoryValue.source_hashes))throw Error('Coverage source inventory differs from its complete frozen source_hashes');
    const components=Object.fromEntries((runtime.components??[]).map(item=>[item.path,item.revision]));
    if(value.components&&!isDeepStrictEqual(value.components,components))throw Error('Coverage components differ from the verified runtime');
    if(!Array.isArray(value.test_roots)||!value.test_roots.length||value.test_roots.some(name=>typeof name!=='string'||!(runtime.test_roots??[]).some(root=>name===root||name.startsWith(root.replace(/\/$/,'')+'/'))))throw Error('Coverage test roots exceed the verified runtime test roots');
    const knowledge=readKnowledge(value.project_root,value.acceptance_id,value.knowledge_paths??[]);
    const priors=(value.prior_attempts??[]).map(file=>ownedArtifact(value,file));
    const request={schema:'project-coverage-agent-request-v1',acceptance:knowledge.acceptance,
      runtime_manifest:manifest,runtime_sha256:value.runtime_sha256,workspace:runtime.workspace,revision:runtime.revision,
      inventory_path:inventory,inventory_sha256:value.inventory_sha256,registry_path:path.join(spec.folder,'registry.json'),
      source_hashes:value.source_hashes,test_roots:value.test_roots,components,expected_measured_sources:value.expected_measured_sources??[],
      prior_attempts:priors};
    const requestFile=path.join(spec.folder,'request.frozen.json');fs.writeFileSync(requestFile,json(request),{flag:'wx'});
    const config={acceptance:knowledge.acceptance,source_checkout:runtime.workspace,test_roots:value.test_roots};
    acceptanceGuard(config,[spec.folder]);
    return await workspaceLease(config,spec.folder,async({env})=>{
      const stage=path.join(spec.folder,'preparation'),args=[path.join(packageRoot,'workflows/coverage/roles/preparer.mjs'),requestFile,stage];
      const observation=await runProcess(process.execPath,args,{cwd:value.project_root,env,
        output:path.join(spec.folder,'commands/preparation'),timeoutSeconds:900,signal});
      fs.writeFileSync(path.join(spec.folder,'command.json'),json({...observation,executable:process.execPath}),{flag:'wx'});
      if(observation.timed_out||observation.cancelled)throw Error('Coverage preparation interrupted; inspect process and file effects before any new attempt');
      if(observation.exit_code!==0)throw Error('Coverage preparation blocked; inspect command.json, commands/preparation/combined.log and preparation/metrics.json');
      const handoff=read(path.join(stage,'handoff.json'));
      if(!['ready','partial'].includes(handoff.status))throw Error('Coverage stage returned no verified handoff');
      const profile=path.join(handoff.prepared,'prepared.json');
      if(sha(profile)!==handoff.prepared_sha256)throw Error('Coverage profile changed before handoff');
      return complete(spec,{status:handoff.status,coverage:{policy:'required',protocol:'project-coverage-v1',prepared:handoff.prepared,prepared_sha256:handoff.prepared_sha256,inventory_path:inventory},
        stopped_after:'coverage_preparation',business_tests:'not_executed',product_judgment:'not_performed',
        runtime:'Node store, runtime, probes and profile verification; official Playbook CLI role execution'},
        ['request.frozen.json','command.json','preparation/handoff.json','preparation/metrics.json','preparation/workspace-baseline.json','preparation/prepared/prepared.json']);
    });
  }catch(error){return failure(spec,error.message,{stopped_after:'coverage_preparation'});}
}
