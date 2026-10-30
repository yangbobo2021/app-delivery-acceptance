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
import {projectCoverageInput} from './project-input.mjs';

const allowed=['project_root','acceptance_id','request_id','definitions_sha256','policy','basis','runtime_manifest','runtime_sha256',
  'inventory_path','inventory_sha256','source_hashes','test_roots','components','expected_measured_sources','prior_attempts','knowledge_paths','preparation_instructions','preparation_timeout_seconds'];
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
    const requestedBudget=input?.preparation_timeout_seconds??(input?.definitions_sha256?900:1800);
    if(!Number.isSafeInteger(requestedBudget)||requestedBudget<1||requestedBudget>3600)throw Error('Coverage preparation_timeout_seconds must be a finite integer from 1 to 3600');
    const workflowDeadline=Date.now()+requestedBudget*1000;
    input=await projectCoverageInput(input,{signal});
    if(input.unavailable)return {...input,business_tests:'not_executed',product_judgment:'not_performed'};
    spec=begin(input,'coverage',allowed);
    if(spec.completed){
      if(!spec.completed.source_definitions_match_current)return {...spec.completed,status:'stale',reason:'Coverage definitions superseded',historical_report_preserved:true};
      try{return verifyCached(spec.completed);}catch(error){return {...spec.completed,status:'stale',reason:error.message,historical_report_preserved:true};}
    }
    const value=spec.normalized;
    const preparationBudget=value.preparation_timeout_seconds??900;
    if(!Number.isSafeInteger(preparationBudget)||preparationBudget<1||preparationBudget>3600)throw Error('Coverage preparation_timeout_seconds must be a finite integer from 1 to 3600');
    if(value.preparation_instructions!==undefined&&(typeof value.preparation_instructions!=='string'||!value.preparation_instructions.trim()))throw Error('Explicit coverage preparation instructions must be nonempty text');
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
      prior_attempts:priors,preparation_instructions:value.preparation_instructions??null};
    const requestFile=path.join(spec.folder,'request.frozen.json');fs.writeFileSync(requestFile,json(request),{flag:'wx'});
    const config={acceptance:knowledge.acceptance,source_checkout:runtime.workspace,test_roots:value.test_roots};
    acceptanceGuard(config,[spec.folder]);
    return await workspaceLease(config,spec.folder,async({env})=>{
      const deadline=workflowDeadline,attempts=[];let stage,observation,sequence=0;
      for(;;){
        if(signal?.aborted)throw signal.reason??Error('Coverage preparation cancelled');
        const remaining=(deadline-Date.now())/1000;
        if(remaining<=0)throw Error('Coverage preparation budget exhausted; last unresolved issue: '+(attempts.at(-1)?.reason??'not completed'));
        sequence++;stage=path.join(spec.folder,sequence===1?'preparation':'repairs/'+String(sequence).padStart(4,'0'));
        fs.mkdirSync(path.dirname(stage),{recursive:true});
        const attemptRequest=sequence===1?requestFile:path.join(spec.folder,'repair-request-'+sequence+'.json');
        if(sequence>1)fs.writeFileSync(attemptRequest,json({...request,prior_attempts:[...priors,...attempts.map(x=>x.directory)],repair_feedback:attempts.at(-1),remaining_seconds:remaining}),{flag:'wx'});
        const args=[path.join(packageRoot,'workflows/coverage/roles/preparer.mjs'),attemptRequest,stage];
        observation=await runProcess(process.execPath,args,{cwd:value.project_root,env,output:path.join(spec.folder,'commands',sequence===1?'preparation':'repair-'+sequence),timeoutSeconds:remaining,signal});
        const metricsFile=path.join(stage,'metrics.json'),metrics=fs.existsSync(metricsFile)?read(metricsFile):null;
        attempts.push({sequence,directory:stage,exit_code:observation.exit_code,reason:metrics?.error??null,status:metrics?.status??'interrupted',command:observation});
        atomicAttemptLog();
        if(observation.timed_out||observation.cancelled)throw Error('Coverage preparation interrupted by actual budget or cancellation; unresolved: '+(metrics?.error??'see '+observation.log.path));
        if(observation.exit_code===0)break;
        if(!metrics)throw Error('Coverage preparation process could not start; inspect '+observation.log.path);
        if(metrics.agent_status!=='success')await new Promise(resolve=>setTimeout(resolve,Math.min(1000,Math.max(0,deadline-Date.now()))));
        // The Agent completed a proposal but actual tool/protocol validation
        // failed. Repair belongs to this workflow, not to the Skill caller.
      }
      function atomicAttemptLog(){fs.writeFileSync(path.join(spec.folder,'attempts.json'),json(attempts));}
      fs.writeFileSync(path.join(spec.folder,'command.json'),json({...observation,executable:process.execPath,preparation_timeout_seconds:preparationBudget,attempts:attempts.map(({command,...item})=>item)}),{flag:'wx'});
      const handoff=read(path.join(stage,'handoff.json'));
      const prefix=path.relative(spec.folder,stage).split(path.sep).join('/');
      if(handoff.status==='unavailable')return complete(spec,{status:'unavailable',reason:handoff.reason,limitations:handoff.limitations??[],preparation_directory:stage,attempts:attempts.map(({command,...item})=>item),stopped_after:'coverage_preparation',business_tests:'not_executed',product_judgment:'not_performed'},['request.frozen.json','command.json','attempts.json',prefix+'/handoff.json',prefix+'/metrics.json']);
      if(!['ready','partial'].includes(handoff.status))throw Error('Coverage stage returned no verified handoff');
      const profile=path.join(handoff.prepared,'prepared.json');
      if(sha(profile)!==handoff.prepared_sha256)throw Error('Coverage profile changed before handoff');
      return complete(spec,{status:handoff.status,coverage:{policy:'required',protocol:'project-coverage-v1',prepared:handoff.prepared,prepared_sha256:handoff.prepared_sha256,inventory_path:inventory},
        preparation_directory:stage,attempts:attempts.map(({command,...item})=>item),stopped_after:'coverage_preparation',business_tests:'not_executed',product_judgment:'not_performed',
        runtime:'Node store, runtime, probes and profile verification; official Playbook CLI role execution'},
        ['request.frozen.json','command.json','attempts.json',prefix+'/handoff.json',prefix+'/metrics.json',prefix+'/workspace-baseline.json',prefix+'/prepared/prepared.json']);
    });
  }catch(error){return failure(spec,error.message,{stopped_after:'coverage_preparation'});}
}
