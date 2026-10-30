import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';
import {locations,inside,ownedAbsolute,requireCurrent,read,atomicJson} from '../shared/store.mjs';
import {guard} from '../shared/validation.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {digest,sceneInput,loadBinding,object} from '../shared/definitions.mjs';
import {workspaceLease,finishScene,git,workspaceSnapshot,verifyAllowedChanges} from '../shared/workspace.mjs';
import {verifyIdentity} from '../shared/identity.mjs';
import {validateRuntime} from '../shared/runtime.mjs';
import {projectCoverage} from '../shared/coverage-registry.mjs';
import {validateEvaluation} from '../shared/case-contract.mjs';
import {runProcess} from '../shared/process.mjs';
import {collectDebugEvidence} from './debug-evidence.mjs';

const rolesRoot=fileURLToPath(new URL('./roles',import.meta.url));
const allowed=new Set(['project_root','acceptance_id','request_id','definitions_sha256','scene_id','basis','catalog','guide','case_strategy','case_evaluation','debug_environment','knowledge_paths']);
const debugFields=new Set(['fresh_env_root_key','fresh_env_paths','evidence_env_dir_keys']);
function filesUnder(root){const result=[];function visit(directory){for(const name of fs.readdirSync(directory).sort()){const candidate=path.join(directory,name),stat=fs.lstatSync(candidate);if(stat.isSymbolicLink())continue;const file=inside(directory,name);if(stat.isDirectory())visit(file);else if(stat.isFile())result.push(file);}}visit(root);return result;}
const hashFiles=files=>Object.fromEntries(files.map(file=>[file,digest(file)]));
function verifyFiles(files){for(const [file,hash]of Object.entries(files))if(digest(file)!==hash)throw Error('Frozen case artifact changed: '+file);}
function frozenSource(catalog){
  if(git(catalog.project_root,'rev-parse','HEAD').trim()!==catalog.revision)throw Error('Prepared product revision changed');
  for(const part of catalog.components??[])if(git(inside(catalog.project_root,part.path),'rev-parse','HEAD').trim()!==part.revision)throw Error('Prepared component changed');
  for(const [name,hash]of Object.entries({...catalog.source_hashes,...catalog.binding_files}))if(digest(inside(catalog.project_root,name))!==hash)throw Error('Prepared source or dependency binding changed: '+name);
}
function roleResult(directory,{identity=false}={}){
  const metrics=read(path.join(directory,'metrics.json')),answer=read(path.join(directory,'answer.json'));
  if(metrics.status!=='success'||metrics.invalid_source_change||metrics.invalid_reuse||metrics.invalid_discovery)throw Error('Case role did not pass host protocol checks: '+(metrics.error??metrics.status));
  const events=fs.readFileSync(path.join(directory,'agent.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)),raw=events.filter(e=>e.type==='text').at(-1)?.payload?.content;
  if(!events.some(e=>e.type==='done'&&e.payload?.status==='success')||typeof raw!=='string')throw Error('Case role lacks successful official role result');
  const original=identity?read(path.join(directory,'answer.agent.json')):answer;
  if(!equal(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),original))throw Error('Case answer differs from original official role result');return {metrics,answer};
}
function evaluationMarkdown(value){
  const lines=['# 场景关联用例评估','','仅提供设计评估，不改变执行列表或正式产品结论。','',value.summary,'','覆盖判断：'+value.coverage,'','取舍建议：'+value.selection_advice,''];
  for(const obligation of value.obligations)lines.push('- '+obligation.id+'「'+obligation.quote+'」：'+obligation.assessment);
  for(const finding of value.findings)lines.push('','- '+finding.kind+'：'+finding.statement,'  - 影响：'+finding.impact,'  - 建议：'+finding.recommendation);
  for(const item of value.case_assessments){lines.push('','- '+item.case_id+' '+item.role+'：'+item.contribution);for(const check of item.checks??[])lines.push('  - '+check.target+'：'+check.assessment+'；反例核验：'+(check.counterexample??''));}
  for(const evidence of value.evidence)lines.push('','## '+evidence.id+' · '+evidence.file+':'+evidence.line_start+'–'+evidence.line_end,'','SHA-256：'+evidence.file_sha256,'','```',evidence.quote,'```');
  if(value.limitations.length)lines.push('','## 评估边界','',...value.limitations.map(item=>'- '+item));return lines.join('\n')+'\n';
}
export async function prepareCases(input,{signal}={}){
  let folder,claim,token,recovery;
  try{
    if(!object(input)||Object.keys(input).some(key=>!allowed.has(key)))throw Error('Case request contains unknown fields');
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||typeof input.basis!=='string'||!input.basis.trim()||typeof input.scene_id!=='string'||!input.scene_id)throw Error('Stable request, explicit scene and actual user basis required');
    const {root,shared,local}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);
    const normalized={...input,project_root:root},strategy=input.case_strategy??'implement',evaluate=input.case_evaluation??true;
    if(!['implement','existing_only'].includes(strategy)||typeof evaluate!=='boolean')throw Error('Declare a valid case strategy and boolean advisory evaluation policy');
    const debug=input.debug_environment??{};if(!object(debug)||Object.keys(debug).some(key=>!debugFields.has(key)))throw Error('Unknown bound debug environment');
    folder=inside(local,'workflows/cases/'+input.request_id);
    if(fs.existsSync(folder)){
      if(!equal(read(path.join(folder,'input.json')),normalized))throw Error('request_id conflicts with its frozen case request');
      if(fs.existsSync(path.join(folder,'result.json'))){const result=read(path.join(folder,'result.json'));verifyFiles(result.immutable_files);
        let applicability=digest(inside(shared,'scenarios.json'))===input.definitions_sha256?'current':'superseded';
        try{frozenSource(read(result.catalog));verifyIdentity(read(result.case_answer),read(result.catalog).project_root);}catch{applicability='stale';}
        return {...result,reused:true,applicability};
      }
      const authority=path.join(folder,'recovery-authority.json');if(!fs.existsSync(authority))throw Error('Case attempt is incomplete; inspect original official role result, processes and workspace effects before explicit recovery');
      recovery=read(authority);if(recovery.consumed)throw Error('The bounded same-session recovery was already consumed');
      for(const [file,hash]of Object.entries(recovery.frozen_files))if(digest(file)!==hash)throw Error('Recovery frozen inputs changed');
      if(!equal(workspaceSnapshot(inside(local,'workspace')),recovery.workspace_snapshot))throw Error('Recovery workspace changed after reconciliation');
    }
    if(digest(inside(shared,'scenarios.json'))!==input.definitions_sha256)throw Error('Definitions changed before case preparation');
    const originalCatalog=ownedAbsolute(local,input.catalog),originalGuide=ownedAbsolute(local,input.guide),catalog=read(originalCatalog),guide=read(originalGuide),knowledge=readKnowledge(root,input.acceptance_id,input.knowledge_paths??[]),latest=read(inside(shared,'scenarios.json')),binding={path:inside(shared,latest.definition_record),sha256:digest(inside(shared,latest.definition_record))},config={acceptance:knowledge.acceptance,definitions:binding,source_checkout:catalog.project_root,workspace_policy:'single-acceptance-v1',allowed_test_roots:catalog.write_roots??catalog.test_roots??[]};
    loadBinding(config,{required:true});
    if(catalog.schema!=='portable-project-catalog-v1'||!equal(catalog.definitions,binding)||catalog.acceptance?.id!==input.acceptance_id||catalog.acceptance.scope_sha256!==knowledge.acceptance.scope_sha256||fs.realpathSync(catalog.project_root)!==inside(local,'workspace')||catalog.workspace_policy!=='single-acceptance-v1')throw Error('Case needs a current prepared catalog in this acceptance workspace');
    if(!catalog.runtime)throw Error('New case preparation requires a verified runtime manifest');
    const scene=sceneInput(config,input.scene_id),caseInput={acceptance:knowledge.acceptance,...scene,preparation_basis:input.basis,case_strategy:strategy,coverage:projectCoverage(catalog.project_root,catalog.coverage)??{policy:'unavailable',reason:'No project coverage preparation was supplied'},debug_environment:debug};
    if(caseInput.coverage.policy==='required')caseInput.coverage={...caseInput.coverage,scene_id:input.scene_id,revision:catalog.revision};
    let boundCatalog={...catalog,acceptance:knowledge.acceptance,case_strategy:strategy,coverage:caseInput.coverage};
    if(recovery){Object.assign(caseInput,read(path.join(folder,'case-input.json')));boundCatalog=read(path.join(folder,'catalog.json'));config.acceptance=boundCatalog.acceptance;}
    guard(config,[folder]);frozenSource(catalog);
    fs.mkdirSync(folder,{recursive:true});if(!recovery)atomicJson(path.join(folder,'input.json'),normalized);claim=path.join(folder,'active.lock.d');token=randomUUID();fs.mkdirSync(claim);fs.writeFileSync(path.join(claim,'owner.json'),JSON.stringify({pid:process.pid,token}),{flag:'wx'});
    return await workspaceLease(config,folder,async({env})=>{
      if(catalog.runtime){const manifest=catalog.runtime.manifest??catalog.runtime.runtime_manifest;if(!manifest||digest(manifest)!==catalog.runtime.sha256)throw Error('Prepared runtime manifest binding missing or changed');validateRuntime(manifest,{expectedAcceptance:catalog.acceptance,resmoke:true});}
      const caseFile=path.join(folder,'case-input.json'),catalogFile=path.join(folder,'catalog.json'),guideFile=path.join(folder,'guide.json');if(!recovery){atomicJson(caseFile,caseInput);atomicJson(catalogFile,boundCatalog);atomicJson(guideFile,guide);}
      if(!recovery){atomicJson(path.join(folder,'sources.json'),hashFiles([originalCatalog,originalGuide,binding.path]));atomicJson(path.join(folder,'request.frozen.json'),{acceptance:knowledge.acceptance,progress_schema:'single-agent-scene-v1',project:{id:catalog.project_id??path.basename(root),root:catalog.project_root,revision:catalog.revision},requirements:latest.requirements,scene:caseInput.scene,definitions:binding,definition_binding_sha256:caseInput.definition_binding_sha256,case_input_path:caseFile});}
      const baseline=recovery?read(path.join(folder,'workspace-before.json')):workspaceSnapshot(catalog.project_root,catalog.components??[]);if(!recovery)atomicJson(path.join(folder,'workspace-before.json'),baseline);
      const directory=path.join(folder,'case'),runner=strategy==='existing_only'?'existing.mjs':'implement.mjs';
      if(recovery){atomicJson(path.join(folder,'recovery-authority.json'),{...recovery,consumed:true,consumed_at:new Date().toISOString()});}
      if(recovery?.action!=='adopt_completed_role'){const command=await runProcess(process.execPath,[path.join(rolesRoot,runner),caseFile,catalogFile,guideFile,directory,...(recovery?['--resume']:[])],{cwd:root,env,output:path.join(folder,'commands','case'+(recovery?'-resume-'+randomUUID():'')),timeoutSeconds:1200,signal});
      if(command.exit_code!==0||command.timed_out||command.cancelled)throw Error('Case role interrupted or incomplete; preserve original process and side-effect evidence');}
      const {metrics,answer}=roleResult(directory,{identity:true});verifyAllowedChanges(catalog.project_root,baseline,catalog.write_roots??catalog.test_roots??[],catalog.components??[]);frozenSource(catalog);
      const identity=verifyIdentity(answer,catalog.project_root,{sceneId:input.scene_id,acceptanceId:input.acceptance_id});
      const debugEvidence=collectDebugEvidence(path.join(directory,'debug')),receipts=debugEvidence.completed.map(item=>item.receipt);
      if(['passed_local','product_failure'].includes(answer.status)&&(!receipts.length||(answer.status==='passed_local'&&!receipts.some(item=>item.exit_code===0))))throw Error('Local observations lack a real bound debug execution receipt');
      if(answer.status==='host_ready'&&!catalog.runtime)throw Error('Unexecuted host-ready handoff needs a verified runtime manifest');
      let evaluation={status:evaluate?'unavailable':'off',advisory_only:true};
      if(evaluate){
        const before=workspaceSnapshot(catalog.project_root,catalog.components??[]),evaluationDirectory=path.join(folder,'case-evaluation');
        try{
          if(!fs.existsSync(evaluationDirectory)){const result=await runProcess(process.execPath,[fileURLToPath(new URL('../assess-cases/roles/evaluator.mjs',import.meta.url)),caseFile,catalogFile,path.join(directory,'answer.json'),evaluationDirectory],{cwd:root,env,output:path.join(folder,'commands/evaluation'),timeoutSeconds:600,signal});
          if(result.exit_code!==0||result.timed_out||result.cancelled)throw Error('Independent advisory evaluator did not complete');}
          const parsed=roleResult(evaluationDirectory),description=validateEvaluation(parsed.answer,caseInput,answer,catalog.project_root,{requireTargetChecks:true});atomicJson(path.join(evaluationDirectory,'description.json'),description);const evaluationText=evaluationMarkdown(description),evaluationMarkdownFile=path.join(folder,'case-evaluation.md');if(fs.existsSync(evaluationMarkdownFile)){if(fs.readFileSync(evaluationMarkdownFile,'utf8')!==evaluationText)throw Error('Existing independent evaluation rendering changed');}else fs.writeFileSync(evaluationMarkdownFile,evaluationText,{flag:'wx'});evaluation={status:'available',advisory_only:true,answer:path.join(evaluationDirectory,'answer.json'),description:path.join(evaluationDirectory,'description.json')};
        }catch(error){evaluation.reason=error.message;}
        verifyAllowedChanges(catalog.project_root,before,[],catalog.components??[]);
      }
      atomicJson(path.join(folder,'case-evaluation.json'),evaluation);frozenSource(catalog);
      const ready=['passed_local','host_ready','product_failure'].includes(answer.status)&&answer.test_command?.length>0;
      const immutable=hashFiles(filesUnder(folder).filter(file=>!file.includes(path.sep+'active.lock.d'+path.sep))),result={schema:'acceptance-cases-result-v1',status:ready?'ready':'blocked',acceptance_id:input.acceptance_id,scene_id:input.scene_id,definitions:binding,definition_binding_sha256:caseInput.definition_binding_sha256,case_strategy:strategy,case_input:caseFile,case_answer:path.join(directory,'answer.json'),catalog:catalogFile,guide:guideFile,permanent_case_ids:identity.cases.map(item=>item.id),local_case_status:answer.status,debug_executions:receipts.length,evaluation,stopped_after:'case_preparation',formal_execution:'not_performed',product_judgment:'not_performed',...(ready?{}:{reason:answer.reason??'Case was not executable; preserve the attempt'}),directory:folder,immutable_files:immutable};
      Object.assign(result,{debug_attempts:debugEvidence.attempts,debug_incomplete:debugEvidence.incomplete});
      atomicJson(path.join(folder,'result.json'),result);if(ready)finishScene(config,folder);return result;
    },{scene:true});
  }catch(error){const result={status:'blocked',reason:error.message,stopped_after:'case_preparation',...(folder?{directory:folder}:{})};if(folder&&fs.existsSync(folder))atomicJson(path.join(folder,'failure-'+randomUUID()+'.json'),result);return result;}
  finally{if(claim&&fs.existsSync(path.join(claim,'owner.json'))&&read(path.join(claim,'owner.json')).token===token){fs.unlinkSync(path.join(claim,'owner.json'));fs.rmdirSync(claim);}}
}
