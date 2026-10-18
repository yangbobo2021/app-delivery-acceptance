import {acceptanceGuard} from '../../acceptance-guard.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {reverseArtifactReady,executableReverseRules} from '../reverse/artifact.mjs';
const [mode,templateArg,outputArg]=process.argv.slice(2);
if(!['reverse','scenario','case'].includes(mode)||!templateArg||!outputArg)throw Error('usage: node materialize.mjs reverse|scenario|case template.json NEW-output-dir');
const templatePath=resolve(templateArg),out=resolve(outputArg);
if(existsSync(out))throw Error('Handoff output already exists');
const template=JSON.parse(readFileSync(templatePath,'utf8'));
acceptanceGuard(template,[out]);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const analysisPath=template.analysis_path?resolve(template.analysis_path):null;
const analysis=analysisPath?JSON.parse(readFileSync(analysisPath,'utf8')):template.analysis;
const ids=new Set(template.requirements?.items?.map(x=>x.id)??
  (Array.isArray(template.requirements)?template.requirements.map(x=>x.id):[]));
if(analysis&&(!analysis.business_goal||!analysis.confirmed_scope||
   JSON.stringify([...analysis.confirmed_scope.included_requirement_ids].sort())!==JSON.stringify([...ids].sort())))
 throw Error('Analysis is missing or bound to different original requirements');
const approvedPath=mode==='reverse'?null:resolve(template.reviewed_reverse_path);
const approved=approvedPath?JSON.parse(readFileSync(approvedPath,'utf8')):null;
if(mode!=='reverse'&&!reverseArtifactReady(approved,approvedPath))throw Error('Reverse analysis has no validated final result');
let request;
if(mode==='reverse'){
 if(!template.reverse_request||!analysisPath||!analysis||!template.requirements)throw Error('Reverse handoff fields missing');
 request={...template.reverse_request,requirements:template.requirements,analysis};
}else if(mode==='scenario'){
 if(!template.project_root||!template.requirements||!analysis||!template.target_requirement_id)throw Error('Scenario handoff fields missing');
 const kind=template.scenario_kind??'WHITE_BOX';
 if(!['BLACK_BOX','WHITE_BOX'].includes(kind))throw Error('Unknown scenario kind');
 const targets=[...executableReverseRules(approved).map(x=>x.id),...approved.draft.impacts.map(x=>x.requirement_id)];
 if(!targets.includes(template.target_requirement_id))throw Error('Target absent from approved change');
 if(kind==='BLACK_BOX'&&(!approved.change.inventory?.test_modes?.includes('BLACK_BOX')||
    !approved.change.inventory?.pr_requirement_ids?.includes(template.target_requirement_id)))
  throw Error('Black-box target absent from frozen PR inventory');
 request={project_root:template.project_root,target_requirement_id:template.target_requirement_id,scenario_kind:kind,
  requirements:template.requirements,analysis,user_constraints:template.user_constraints??[],
  selected_commit_scope:template.selected_commit_scope,
  ...(kind==='BLACK_BOX'?{pr_reviewed_reverse_path:approvedPath,pr_reviewed_reverse_sha256:sha(approvedPath)}:
    {reviewed_reverse_path:approvedPath,reviewed_reverse_sha256:sha(approvedPath)})};
}else{
 const sceneDir=resolve(template.scenario_run_path),scenePath=join(sceneDir,'scenarios.current.json'),reviewPath=join(sceneDir,'review.current.json');
 const scenes=JSON.parse(readFileSync(scenePath,'utf8')),review=JSON.parse(readFileSync(reviewPath,'utf8'));
 if(review.status!=='approved'||review.scenarios_sha256!==sha(scenePath))throw Error('Scenario list not independently approved');
 const scene=template.scene_id?scenes.scenarios.find(x=>x.id===template.scene_id):
  Number.isInteger(template.scene_index)&&template.scene_index>=0?scenes.scenarios[template.scene_index]:null;
 if(!scene||!['WHITE_BOX','BLACK_BOX'].includes(scene.kind)||!review.passed_scene_ids.includes(scene.id))throw Error('Chosen scene not approved');
 if(template.project?.revision!==approved.change.head_revision)throw Error('Case project revision differs from approved commit');
 const caseRequirements=template.case_requirements??template.requirements;
 if(!Array.isArray(caseRequirements)||!caseRequirements.some(x=>x.id===scene.requirement_id)||
    !Array.isArray(template.case_catalog)||!template.coverage||!(analysis||template.business_goal&&template.confirmed_scope))
  throw Error('Case handoff fields missing');
 if(caseRequirements.some(x=>!ids.has(x.id)))throw Error('Case context contains a requirement outside the frozen original list');
 request={project:template.project,requirements:caseRequirements,scene,business_goal:analysis?.business_goal??template.business_goal,
  confirmed_scope:analysis?.confirmed_scope??template.confirmed_scope,case_catalog:template.case_catalog,coverage:template.coverage,
  contract_evidence:template.contract_evidence,
  approved_scenario_review_path:reviewPath,approved_scenario_review_sha256:sha(reviewPath),
  ...(scene.kind==='BLACK_BOX'?{pr_reviewed_reverse_path:approvedPath,pr_reviewed_reverse_sha256:sha(approvedPath)}:
    {reviewed_reverse_path:approvedPath,reviewed_reverse_sha256:sha(approvedPath)})};
}
request.acceptance=template.acceptance;
mkdirSync(out,{recursive:true});
const target=join(out,'request.json');writeFileSync(target,JSON.stringify(request,null,2)+'\n');
const result={final_state:'done',finished_at:new Date().toISOString(),mode,
 template_sha256:sha(templatePath),request_sha256:sha(target),
 ...(analysisPath?{analysis_sha256:sha(analysisPath)}:{}),
 ...(approvedPath?{reviewed_reverse_sha256:sha(approvedPath)}:{})};
writeFileSync(join(out,'terminal.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({mode,request:target}));
