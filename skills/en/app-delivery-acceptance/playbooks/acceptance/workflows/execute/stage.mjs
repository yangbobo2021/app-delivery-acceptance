import {validArgv} from '../shared/argv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';
import {locations,inside,ownedAbsolute,requireCurrent,read,atomicJson} from '../shared/store.mjs';
import {guard} from '../shared/validation.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {digest,verifyCase,loadBinding} from '../shared/definitions.mjs';
import {workspaceLease,finishScene,git,workspaceSnapshot,verifyAllowedChanges} from '../shared/workspace.mjs';
import {validateRuntime,projectEnvironment} from '../shared/runtime.mjs';
import {verifyIdentity,sourceLines} from '../shared/identity.mjs';
import {recordExecution} from '../shared/recorder.mjs';
import {runCoverage} from '../shared/coverage-execution.mjs';
import {projectCoverage} from '../shared/coverage-registry.mjs';
import {freezeEvidence} from '../shared/evidence.mjs';
import {handoffGate,decisionGate} from '../shared/review-gates.mjs';
import {runProcess} from '../shared/process.mjs';

import {packageRoot} from '../../root.mjs';
const rolesRoot=fileURLToPath(new URL('./roles',import.meta.url));
const fields=new Set(['project_root','acceptance_id','request_id','definitions_sha256','basis','case_input','case_answer','catalog','guide','selected_case_ids','execution_command','selection_basis','max_review_repairs','execution_settings','stop_after']);
const settingsFields=new Set(['fresh_env_root_key','fresh_env_paths','evidence_env_dir_keys','evidence_log_prefix','evidence_relative_paths','evidence_execution_relative_paths','evidence_globs','evidence_exclude_globs','evidence_max_bytes','scope_note']);
const saveOnce=(file,value)=>{if(fs.existsSync(file)){if(!equal(read(file),value))throw Error('Frozen operation input changed: '+file);}else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}};
function artifactFiles(folder){
  const files=[];function visit(directory){for(const name of fs.readdirSync(directory).sort()){
    const candidate=path.join(directory,name),stat=fs.lstatSync(candidate);if(stat.isSymbolicLink())continue;const file=inside(directory,name);if(stat.isDirectory())visit(file);else if(stat.isFile())files.push(file);
  }}visit(folder);return files;
}
function hashes(files){return Object.fromEntries([...new Set(files)].map(file=>[file,digest(file)]));}
function verifyFiles(files){for(const [file,expected]of Object.entries(files))if(digest(file)!==expected)throw Error('Frozen stage artifact changed: '+file);}
function parseAnswer(directory){
  const metrics=read(path.join(directory,'metrics.json')),answer=read(path.join(directory,'answer.json'));
  if(metrics.status!=='success')throw Error('Role did not complete; preserve original session and inspect before recovery');
  const events=fs.readFileSync(path.join(directory,'agent.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  if(!events.some(e=>e.type==='done'&&e.payload?.status==='success'))throw Error('Role answer lacks successful native session evidence');
  const raw=events.filter(e=>e.type==='text').at(-1)?.payload?.content?.trim();
  const original=fs.existsSync(path.join(directory,'answer.agent.json'))?read(path.join(directory,'answer.agent.json')):answer;
  if(!raw||!equal(JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),original))throw Error('Role answer differs from original native session evidence');
  return {answer,metrics};
}
function frozenWorkspace(catalog){
  if(git(catalog.project_root,'rev-parse','HEAD').trim()!==catalog.revision)throw Error('Frozen product revision changed');
  for(const component of catalog.components??[])if(git(inside(catalog.project_root,component.path),'rev-parse','HEAD').trim()!==component.revision)throw Error('Frozen component revision changed');
  for(const [name,hash]of Object.entries({...catalog.source_hashes,...catalog.binding_files}))if(digest(inside(catalog.project_root,name))!==hash)throw Error('Frozen product source or binding file changed: '+name);
}
function selectedFiles(root,answer,catalog){
  if(!Array.isArray(answer.test_files)||!answer.test_files.length)throw Error('Case did not declare test files');
  const roots=catalog.write_roots??catalog.test_roots??[],changed=git(root,'diff','--name-only','HEAD').trim().split('\n').filter(Boolean),untracked=git(root,'ls-files','-z','--others','--exclude-standard').split('\0').filter(Boolean);
  const files=[...new Set([...answer.test_files,...changed,...untracked,...Object.keys(catalog.coverage_test_files??{})])].sort();
  for(const name of files){if(!fs.statSync(inside(root,name)).isFile())throw Error('Test artifact is unavailable: '+name);if([...changed,...untracked].includes(name)&&!roots.some(scope=>name===scope||name.startsWith(scope.replace(/\/$/,'')+'/')))throw Error('Workspace change outside declared test roots: '+name);}
  return files;
}
export async function executeScenario(input,{signal}={}){
  let folder,claim,token;
  try{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.has(k)))throw Error('Execution request contains unknown fields');
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||typeof input.basis!=='string'||!input.basis.trim())throw Error('Stable request_id and actual execution basis required');
    const {root,local,shared}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);
    if(!/^[0-9a-f]{64}$/.test(input.definitions_sha256??''))throw Error('Current definitions SHA required');
    const normalized={...input,project_root:root};delete normalized.stop_after;
    const maximum=input.max_review_repairs??2;
    if(!Number.isSafeInteger(maximum)||maximum<0||maximum>5)throw Error('A finite repair budget from 0 to 5 is required');
    if(maximum&&!input.guide)throw Error('Bounded automatic repair needs the frozen project guide; use explicit budget 0 for execution without repair');
    if(input.stop_after&&!['execution','evidence','gate','review','repair'].includes(input.stop_after))throw Error('Unknown explicit execution stop boundary');
    const settings=input.execution_settings??{};if(!settings||Array.isArray(settings)||Object.keys(settings).some(k=>!settingsFields.has(k)))throw Error('Unknown execution settings');
    folder=inside(local,'workflows/execute/'+input.request_id);
    if(fs.existsSync(folder)){
      if(!equal(read(inside(folder,'input.json')),normalized))throw Error('request_id conflicts with its frozen execution input');
      if(fs.existsSync(path.join(folder,'result.json'))){const result=read(path.join(folder,'result.json'));verifyFiles(result.immutable_files);
        let applicability=digest(inside(shared,'scenarios.json'))===input.definitions_sha256?'current':'superseded';
        try{const catalog=read(input.catalog);if(!catalog.runtime)throw Error('Historical catalog has no verified runtime');frozenWorkspace(catalog);verifyIdentity(read(result.active_case_answer??input.case_answer),catalog.project_root);}catch{applicability='stale';}
        return {...result,reused:true,applicability};}
    }
    if(digest(inside(shared,'scenarios.json'))!==input.definitions_sha256)throw Error('Definitions changed; preserve prior execution and freeze a new attempt');
    const originalInput=ownedAbsolute(inside(local,'workflows'),input.case_input),originalAnswer=ownedAbsolute(inside(local,'workflows'),input.case_answer),originalCatalog=ownedAbsolute(inside(local,'workflows'),input.catalog),caseInput=read(originalInput),answer=read(originalAnswer),catalog=read(originalCatalog);
    verifyCase(caseInput);loadBinding(caseInput,{required:true});
    if(caseInput.acceptance.id!==input.acceptance_id||caseInput.definitions.sha256!==input.definitions_sha256||catalog.acceptance.id!==input.acceptance_id||!equal(catalog.definitions,caseInput.definitions))throw Error('Execution case/catalog/definitions belong to another frozen request');
    const workspace=inside(local,'workspace');if(catalog.workspace_policy!=='single-acceptance-v1'||fs.realpathSync(catalog.project_root)!==workspace)throw Error('Execution needs the verified single acceptance workspace');
    if(!catalog.runtime)throw Error('New formal execution requires a verified runtime manifest');
    let identity;
    const previousStateFile=path.join(folder,'state.json'),previousState=fs.existsSync(previousStateFile)?read(previousStateFile):null;
    const completedRepairs=Object.entries(previousState?.stages??{}).filter(([name,item])=>/^repair-\d+$/.test(name)&&item.status==='completed').sort(([a],[b])=>Number(a.slice(7))-Number(b.slice(7)));
    if(completedRepairs.length){
      if(previousState.input_sha256!==digest(path.join(folder,'input.json'))||!previousState.initial_identity_sha256)throw Error('Interrupted older repair lacks a complete frozen identity checkpoint; preserve it and inspect explicitly');
      const frozenIdentity=path.join(folder,'initial-identity.json');if(digest(frozenIdentity)!==previousState.initial_identity_sha256)throw Error('Frozen initial case identity changed');
      verifyFiles(read(path.join(folder,'sources.json')));
      const last=completedRepairs.at(-1)[1];verifyFiles(last.immutable_files);verifyIdentity(read(last.result.answer),workspace,{sceneId:caseInput.scene.id,acceptanceId:input.acceptance_id});
      identity=read(frozenIdentity).identity;
      if(digest(answer.case_identity.path)!==answer.case_identity.sha256||!equal(identity.cases,answer.case_descriptions))throw Error('Original identity checkpoint differs from the frozen source answer');
    }else identity=verifyIdentity(answer,workspace,{sceneId:caseInput.scene.id,acceptanceId:input.acceptance_id});
    let allIds=identity.cases.map(item=>item.id),selection=input.selected_case_ids??allIds;
    if(!Array.isArray(selection)||!selection.length||new Set(selection).size!==selection.length||selection.some(id=>!allIds.includes(id)))throw Error('Selected permanent case IDs are empty, duplicate or unknown');
    if(input.execution_command&&(!input.selection_basis||!input.selected_case_ids))throw Error('An exact rerun command needs explicit permanent IDs and its actual selection basis');
    if(!input.execution_command&&selection.length!==allIds.length)throw Error('A subset rerun needs an explicit command; cannot silently execute all cases');
    const command=input.execution_command??answer.test_command;if(!validArgv(command))throw Error('Executable case command required');
    const knowledge=readKnowledge(root,input.acceptance_id,[]),config={acceptance:knowledge.acceptance,definitions:caseInput.definitions,source_checkout:workspace,workspace_policy:'single-acceptance-v1',allowed_test_roots:catalog.write_roots??catalog.test_roots??[],...settings};
    guard(config,[folder]);
    fs.mkdirSync(folder,{recursive:true});saveOnce(inside(folder,'input.json'),normalized);
    claim=inside(folder,'active.lock.d');token=randomUUID();try{fs.mkdirSync(claim);}catch(error){if(error.code==='EEXIST')throw Error('Execution attempt has an active or uncertain owner; inspect before recovery');throw error;}
    fs.writeFileSync(path.join(claim,'owner.json'),JSON.stringify({pid:process.pid,token}),{flag:'wx'});
    return await workspaceLease(config,folder,async({env})=>{
      const sources=hashes([originalInput,originalAnswer,originalCatalog,answer.case_identity.path,path.join(path.dirname(answer.case_identity.path),'answer.agent.json'),...(input.guide?[input.guide]:[])]);saveOnce(path.join(folder,'sources.json'),sources);
      const preview={acceptance:knowledge.acceptance,progress_schema:'single-agent-scene-v1',project:{...(catalog.project??{}),id:catalog.project_id??path.basename(root),root:workspace,revision:catalog.revision},requirements:loadBinding(caseInput,{required:true}).requirements,scene:caseInput.scene,definitions:caseInput.definitions,definition_binding_sha256:caseInput.definition_binding_sha256,case_input_path:originalInput,selected_case_ids:selection,execution_basis:input.basis};
      // The first fresh knowledge receipt remains the immutable preview binding.
      if(!fs.existsSync(path.join(folder,'request.frozen.json')))saveOnce(path.join(folder,'request.frozen.json'),preview);
      const stateFile=path.join(folder,'state.json'),state=fs.existsSync(stateFile)?read(stateFile):{schema:'acceptance-native-execution-state-v1',input_sha256:digest(path.join(folder,'input.json')),stages:{}};
      if(state.input_sha256!==digest(path.join(folder,'input.json')))throw Error('Execution state belongs to changed input');
      const initialIdentityFile=path.join(folder,'initial-identity.json');
      if(!fs.existsSync(initialIdentityFile))saveOnce(initialIdentityFile,{identity,protected_cases:identity.cases.filter(item=>!selection.includes(item.id)).map(item=>({id:item.id,body:sourceLines(fs.readFileSync(inside(workspace,item.source.file))).slice(item.source.line_start-1,item.source.line_end).join('\n')}))});
      if(state.initial_identity_sha256&&state.initial_identity_sha256!==digest(initialIdentityFile))throw Error('Frozen initial identity checkpoint changed');state.initial_identity_sha256=digest(initialIdentityFile);atomicJson(stateFile,state);
      frozenWorkspace(catalog);
      if(catalog.runtime){const manifest=catalog.runtime.manifest??catalog.runtime.runtime_manifest;if(!manifest||digest(manifest)!==catalog.runtime.sha256)throw Error('Runtime manifest binding missing or changed');validateRuntime(manifest,{expectedAcceptance:catalog.acceptance,resmoke:true});}
      config.coverage=projectCoverage(workspace,catalog.coverage??caseInput.coverage)??{policy:'unavailable',reason:'No project coverage preparation was supplied'};
      if(config.coverage.policy==='required')config.coverage={...config.coverage,scene_id:caseInput.scene.id,revision:catalog.revision};
      async function stage(name,operation){
        verifyFiles(sources);frozenWorkspace(catalog);
        const old=state.stages[name];if(old?.status==='completed'){verifyFiles(old.immutable_files);return old.result;}
        if(old&&old.status!=='resume_ready')throw Error('Stage '+name+' is '+old.status+'; inspect its processes, receipts and effects before explicit recovery');
        if(old?.recovery?.proof_files)verifyFiles(old.recovery.proof_files);
        state.stages[name]={...old,status:'running',started_at:new Date().toISOString()};atomicJson(stateFile,state);
        try{
          const result=await operation({recovery:old?.recovery});frozenWorkspace(catalog);state.stages[name]={...state.stages[name],status:'completed',finished_at:new Date().toISOString(),result:result.value,immutable_files:hashes(result.files)};atomicJson(stateFile,state);return result.value;
        }catch(error){state.stages[name]={...state.stages[name],status:'parked',reason:error.message};atomicJson(stateFile,state);throw error;}
      }
      const stop=name=>input.stop_after===name?{schema:'acceptance-execute-checkpoint-v1',status:'stopped',stopped_after:name,acceptance_id:input.acceptance_id,scene_id:caseInput.scene.id,selected_case_ids:selection,directory:folder,resume:'Invoke the same request_id and identical frozen fields with the next stop_after or without it; no completed command is replayed.'}:null;
      let activeAnswer=answer,activeAnswerPath=originalAnswer,activeCommand=command,review,coveragePath;
      const partialSelection=selection.length!==allIds.length,protectedCases=read(initialIdentityFile).protected_cases;
      for(let iteration=0;iteration<=maximum;iteration++){
        const suffix=iteration?'-review-'+iteration:'',executionDirectory=path.join(folder,'execution'+suffix),files=selectedFiles(workspace,activeAnswer,catalog);
        const execution=await stage('execution'+suffix,async()=>{
          const values={...projectEnvironment(catalog),...(activeAnswer.test_env??{})},fresh=[];
          if(settings.fresh_env_root_key){const freshRoot=path.join(folder,'fresh'+suffix);fresh.push(freshRoot);values[settings.fresh_env_root_key]=freshRoot;for(const [key,relative]of Object.entries(settings.fresh_env_paths??{}))values[key]=inside(freshRoot,relative);}
          for(const key of settings.evidence_env_dir_keys??[])if(values[key])ownedAbsolute(folder,values[key]);
          const request={acceptance:knowledge.acceptance,cwd:workspace,output:executionDirectory,files,command:activeCommand,env:values,fresh_dirs:fresh,scene_id:caseInput.scene.id,revision:catalog.revision,coverage:config.coverage,prepared:config.coverage.prepared,inventory_path:config.coverage.inventory_path};
          saveOnce(path.join(folder,'execution-request'+suffix+'.json'),request);
          const receipt=config.coverage.policy==='required'?await runCoverage(request,{env,signal}):await recordExecution(request,{env,signal});
          return {value:{receipt:path.join(executionDirectory,'execution.json'),log:path.join(executionDirectory,'execution.log'),exit_code:receipt.exit_code,seconds:receipt.duration_seconds,test_files:Object.keys(receipt.test_file_sha256_before)},files:artifactFiles(executionDirectory)};
        });
        if(stop('execution'))return stop('execution');
        const evidence=await stage('evidence'+suffix,async()=>{const value=freezeEvidence(config,activeAnswer,executionDirectory,folder,{tag:suffix});return {value,files:[value.manifest,value.coverage_path,...value.paths]};});coveragePath=evidence.coverage_path;
        if(stop('evidence'))return stop('evidence');
        const reviewInput={...caseInput,frozen_revision:catalog.revision,test_files:execution.test_files,selected_case_ids:selection,
          review_scope:{kind:selection.length===allIds.length?'frozen_scene':'selected_cases',full_scene_revalidation:selection.length===allIds.length,selected_case_ids:selection,unselected_case_ids:allIds.filter(id=>!selection.includes(id))},
          execution_selection_basis:input.selection_basis??input.basis,artifact_scope:'isolated_worktree',execution_evidence_paths:evidence.paths,frozen_evidence_manifest:evidence.manifest,frozen_execution_receipt:execution.receipt,frozen_execution_log:execution.log,coverage_result_path:coveragePath,agent_result_path:activeAnswerPath,scope_note:settings.scope_note??'Only the frozen scene and explicitly selected permanent cases',...(review?{previous_review:read(review.answer)}:{})};
        const inputFile=path.join(folder,'review-input'+suffix+'.json'),gateFile=path.join(folder,'handoff-gate'+suffix+'.json');
        saveOnce(inputFile,reviewInput);
        const gate=await stage('gate'+suffix,async()=>{const value=handoffGate(reviewInput,catalog);saveOnce(gateFile,value);if(value.status!=='ready_for_review')throw Error('Review handoff rejected: '+value.errors.join('; '));return {value,files:[gateFile,inputFile]};});
        if(stop('gate'))return stop('gate');
        const boundInput=path.join(folder,'review-bound'+suffix+'.json');saveOnce(boundInput,{...reviewInput,handoff_gate_path:gateFile});
        review=await stage('review'+suffix,async({recovery})=>{
          async function invoke(directory,file,label){
            if(recovery?.action!=='adopt_completed_role'){
              const observation=path.join(folder,'commands',label+(recovery?'-resume-'+randomUUID():'')),result=await runProcess(process.execPath,[path.join(rolesRoot,'reviewer.mjs'),workspace,file,directory,...(recovery?['--resume']:[])],{cwd:root,env,output:observation,signal});
              if(result.exit_code!==0||result.timed_out||result.cancelled)throw Error('Independent Reviewer incomplete; inspect preserved command and native session');
            }
            const parsed=parseAnswer(directory),decision=decisionGate(parsed.answer,read(file),parsed.metrics);saveOnce(path.join(directory,'decision-gate.json'),decision);
            return {answer:path.join(directory,'answer.json'),metrics:path.join(directory,'metrics.json'),status:parsed.answer.status,seconds:parsed.metrics.seconds,decision,directory};
          }
          let current=await invoke(path.join(folder,'review'+suffix),boundInput,'review'+suffix),directories=[current.directory];
          if(current.decision.status!=='valid'){
            const correction=path.join(folder,'decision-correction'+suffix+'.json');saveOnce(correction,{...read(boundInput),decision_gate_correction:{previous_review:read(current.answer),previous_review_path:current.answer,previous_review_sha256:digest(current.answer),gate:current.decision,instruction:'Correct judgment structure against the same frozen evidence only; retain every original finding unchanged. Do not execute tests or change scope.'}});
            const original=current;current=await invoke(path.join(folder,'review'+suffix+'-decision-correction-1'),correction,'review'+suffix+'-decision-correction-1');directories.push(current.directory);current.decision_correction={previous_answer:original.answer,input:correction};
            if(current.decision.status!=='valid')throw Error('Independent review correction invalid; finite correction budget exhausted');
          }
          return {value:current,files:[boundInput,...directories.flatMap(artifactFiles)]};
        });
        if(stop('review'))return stop('review');
        const findings=read(review.answer).findings;
        if(findings.some(item=>['scenario','contract'].includes(item.kind))){review={...review,status:'needs_scope_or_contract'};break;}
        const needsTestRepair=review.status==='repair_required'||findings.some(item=>['case_code','case_design','evidence'].includes(item.kind));
        if(!needsTestRepair||catalog.case_strategy==='existing_only'||caseInput.case_strategy==='existing_only')break;
        if(iteration===maximum)break;
        const repairName='repair-'+(iteration+1),repairDirectory=path.join(folder,repairName);
        const repaired=await stage(repairName,async({recovery})=>{
          const repairInput=path.join(folder,repairName+'-input.json');saveOnce(repairInput,{...caseInput,debug_environment:Object.fromEntries(['fresh_env_root_key','fresh_env_paths','evidence_env_dir_keys'].filter(key=>Object.hasOwn(settings,key)).map(key=>[key,settings[key]])),repair_selection:{kind:partialSelection?'selected_cases':'frozen_scene',selected_case_ids:selection,unselected_case_ids:protectedCases.map(item=>item.id),business_command:activeCommand,preserve_unselected_declarations:true}});
          const baseline=workspaceSnapshot(workspace,catalog.components??[]);
          if(recovery?.action!=='adopt_completed_role'){const result=await runProcess(process.execPath,[path.join(rolesRoot,'repairer.mjs'),repairInput,review.answer,originalCatalog,input.guide,repairDirectory,...(recovery?['--resume']:[])],{cwd:root,env,output:path.join(folder,'commands',repairName+(recovery?'-resume-'+randomUUID():'')),signal});
          if(result.exit_code!==0||result.timed_out||result.cancelled)throw Error('Bounded test repair incomplete; preserve the attempt');}
          const parsed=parseAnswer(repairDirectory);verifyAllowedChanges(workspace,baseline,catalog.write_roots??catalog.test_roots??[],catalog.components??[]);const repairedIdentity=verifyIdentity(parsed.answer,workspace,{sceneId:caseInput.scene.id,acceptanceId:input.acceptance_id});
          if(partialSelection){
            for(const protectedCase of protectedCases){const item=repairedIdentity.cases.find(item=>item.id===protectedCase.id);if(!item||sourceLines(fs.readFileSync(inside(workspace,item.source.file))).slice(item.source.line_start-1,item.source.line_end).join('\n')!==protectedCase.body)throw Error('Targeted repair changed or removed an unselected declaration');}
            if(!equal(parsed.answer.test_command,command))throw Error('Targeted repair changed the frozen exact rerun command');
          }
          return {value:{answer:path.join(repairDirectory,'answer.json'),status:parsed.answer.status},files:[repairInput,...artifactFiles(repairDirectory)]};
        });
        activeAnswerPath=repaired.answer;activeAnswer=read(activeAnswerPath);activeCommand=activeAnswer.test_command;
        if(activeAnswer.status==='needs_contract'){review={...review,status:'needs_scope_or_contract'};break;}
        if(activeAnswer.status==='blocked'||!Array.isArray(activeCommand)||!activeCommand.length){review={...review,status:'repair_parked'};break;}
        if(!input.selected_case_ids){allIds=activeAnswer.case_descriptions.map(item=>item.id);selection=allIds;}
        if(stop('repair'))return {...stop('repair'),repair_attempt:iteration+1,active_case_answer:activeAnswerPath};
      }
      const immutable=hashes([path.join(folder,'input.json'),path.join(folder,'sources.json'),path.join(folder,'request.frozen.json'),initialIdentityFile,...Object.values(state.stages).filter(s=>s.status==='completed').flatMap(s=>Object.keys(s.immutable_files))]);
      const result={schema:'acceptance-execute-result-v1',status:'completed',acceptance_id:input.acceptance_id,scene_id:caseInput.scene.id,definitions:caseInput.definitions,definition_binding_sha256:caseInput.definition_binding_sha256,selected_case_ids:selection,review_status:review.status,review_applies_to:selection.length===allIds.length?'frozen_scene':'selected_cases_only',scene_review_status:selection.length===allIds.length?review.status:'not_revalidated',unselected_case_ids:allIds.filter(id=>!selection.includes(id)),active_case_answer:activeAnswerPath,review_path:review.answer,coverage_result_path:coveragePath,directory:folder,repair_budget:maximum,repair_attempts:Object.keys(state.stages).filter(name=>/^repair-/.test(name)).length,scope:'Selected frozen scene/cases only; workflow completion is not whole acceptance pass',immutable_files:immutable};
      saveOnce(path.join(folder,'result.json'),result);finishScene(config,folder);return result;
    },{scene:true});
  }catch(error){
    const result={status:'blocked',reason:error.message,stopped_after:'execute',...(folder?{directory:folder}:{})};
    if(folder&&fs.existsSync(folder)){const file=path.join(folder,'failure-'+randomUUID()+'.json');atomicJson(file,result);}return result;
  }finally{
    if(claim&&fs.existsSync(path.join(claim,'owner.json'))&&read(path.join(claim,'owner.json')).token===token){fs.unlinkSync(path.join(claim,'owner.json'));fs.rmdirSync(claim);}
  }
}
