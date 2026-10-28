import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,ownedAbsolute,inside,read} from './store.mjs';
import {canonical,copyNumbers,cloneJson} from './json.mjs';
export {canonical} from './json.mjs';

export const schema='acceptance-catalog-v2';
export const collections=['requirements','reverse_rules','scenarios'];
const generated=new Set(['version','content_sha256']);
const metadata=new Set(['title','priority','priority_reason','external_refs']);
const organization=new Set(['business_goal','confirmed_scope','requirement_groups','user_constraints']);
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&Boolean(v.trim());
export const fingerprint=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const content=item=>copyNumbers(item,Object.fromEntries(Object.entries(item).filter(([k])=>!generated.has(k))));
export const executionContext=context=>copyNumbers(context,Object.fromEntries(Object.entries(context).filter(([k])=>!organization.has(k))));
export const refs=scene=>new Set([...(scene.related_refs??[]),...(scene.requirement_id?[scene.requirement_id]:[])]);
export function validateDesignGaps(value,owners){
  const gaps=value.design_gaps??[],texts=Object.fromEntries([...value.requirements,...(value.reverse_rules??[])].map(r=>[r.id,r.text??'']));
  if(!Array.isArray(gaps))throw Error('design_gaps must be a list');
  for(const gap of gaps)if(!object(gap)||!owners.has(gap.requirement_id)||!text(gap.quote)||!texts[gap.requirement_id]?.includes(gap.quote)||!text(gap.reason))throw Error('design gap needs an owner, exact source quote and reason');
}
export function validateDefinitions(value){
  if(value.schema!==schema||!object(value.project))throw Error('complete acceptance-catalog-v2 required');
  if(!object(value.context)||!value.context.business_goal)throw Error('frozen context.business_goal required');
  const ids=new Set();
  for(const group of collections){
    if(!Array.isArray(value[group]))throw Error('complete definition collection required: '+group);
    for(const item of value[group]){
      if(!object(item)||!text(item.id))throw Error('definition needs a stable ID');
      if(ids.has(item.id))throw Error('duplicate definition ID: '+item.id);ids.add(item.id);
      if(!text(item[group==='scenarios'?'description':'text']))throw Error('complete frozen definition missing: '+item.id);
      if(!object(item.origin)||!['kind','reference'].every(k=>text(item.origin[k])))throw Error('origin.kind and reference required: '+item.id);
      if(!Array.isArray(item.external_refs))throw Error('external_refs must be an array (may be empty)');
      for(const ref of item.external_refs)if(!object(ref)||!['locator','revision','text'].every(k=>text(ref[k])))throw Error('external reference needs locator, revision and frozen text');
      if('version'in item&&(!Number.isSafeInteger(item.version)||item.version<1))throw Error('invalid definition version');
      if('content_sha256'in item&&item.content_sha256!==fingerprint(content(item)))throw Error('frozen definition changed: '+item.id);
    }
  }
  const targets=new Map([...value.requirements,...value.reverse_rules].map(r=>[r.id,r]));
  for(const rule of value.reverse_rules){
    if(!Array.isArray(rule.code_sources)||!rule.code_sources.length||rule.code_sources.some(s=>!object(s)||!['path','revision','sha256'].every(k=>text(s[k]))))throw Error('reverse rule needs frozen code_sources: path, revision, sha256');
    if(!['supported','needs_confirmation'].includes(rule.status))throw Error('reverse rule needs supported or needs_confirmation status');
    if(rule.status==='supported'&&(!['contract','invariant','confirmed_decision'].includes(rule.basis_kind)||!rule.basis))throw Error('supported reverse rule needs independent expected-behavior basis');
    if(rule.status==='needs_confirmation'&&!rule.question)throw Error('pending reverse rule needs a concrete question');
  }
  validateDesignGaps(value,new Set([...targets].filter(([,r])=>r.status!=='needs_confirmation').map(([id])=>id)));
  for(const scene of value.scenarios){
    if(!['P0','P1','P2','P3'].includes(scene.priority)||!scene.priority_reason)throw Error('scene priority/reason required');
    const ui=scene.ui_acceptance;
    if(ui!==undefined&&(!object(ui)||typeof ui.required!=='boolean'||typeof ui.visual_expectation!=='string'||(ui.required&&(!ui.visual_expectation.trim()||!scene.description.includes(ui.visual_expectation)))))throw Error('UI scene needs its frozen visual expectation in the description');
    if(!scene.check?.method||!scene.check?.basis)throw Error('adopted/generated scene needs its actual check method and basis');
    if(!Array.isArray(scene.related_refs??[]))throw Error('related_refs must be an array');
    for(const id of refs(scene)){
      if(!targets.has(id))throw Error('unknown scene target/context: '+id);
      if(targets.get(id).status==='needs_confirmation')throw Error('pending reverse rule cannot enter an executable scene');
    }
  }
  return value;
}
export function validateCatalog(value){
  if(value.schema===schema)return validateDefinitions(value);
  if(value.schema!=='acceptance-catalog-v1'||!Array.isArray(value.requirements)||!Array.isArray(value.scenarios)||!object(value.project)||!Object.keys(value.project).length)throw Error('complete project scenario catalog with project object required');
  const ids=value.scenarios.map(s=>s.id);if(new Set(ids).size!==ids.length)throw Error('duplicate stable scene IDs');
  const owners=new Set([...value.requirements,...(value.reverse_rules??[]).filter(r=>r.status!=='needs_confirmation')].map(r=>r.id));
  for(const scene of value.scenarios)if(!scene.id||!owners.has(scene.requirement_id))throw Error('scene needs an original requirement or admitted rule');
  validateDesignGaps(value,owners);return value;
}
export function loadBinding(config,{current=true,required=false}={}){
  const at=config.acceptance,supplied=config.definitions;
  if(!at){if(required)throw Error('acceptance binding required');return null;}
  const {shared}=locations(at.project_root,at.id),latestPath=inside(shared,'scenarios.json'),latest=fs.existsSync(latestPath)?read(latestPath):{};
  if(!supplied){if(required||latest.schema===schema)throw Error('frozen definitions binding required; create a new stage/plan');return null;}
  const file=ownedAbsolute(shared,supplied.path);
  if(digest(file)!==supplied.sha256)throw Error('frozen definitions changed');
  const value=validateDefinitions(read(file));
  if(value.acceptance_id!==at.id)throw Error('definition identity mismatch');
  if(current&&(!equal(value,latest)||value.scope_sha256!==at.scope_sha256))throw Error('definitions changed; compare inputs and create affected frozen attempts');
  return value;
}
export function currentBinding(project,id){
  const {shared}=locations(project,id),latest=validateDefinitions(read(inside(shared,'scenarios.json'))),file=inside(shared,latest.definition_record);
  if(!equal(read(file),latest))throw Error('Definition snapshot differs from immutable record');return {path:file,sha256:digest(file)};
}
function sceneClosure(value,id,legacyContext=false){
  const scene=value.scenarios.find(s=>s.id===id);if(!scene)throw Error('scene absent from frozen definitions');
  const targets=new Map([...value.requirements,...value.reverse_rules].map(r=>[r.id,r]));
  const execution=item=>copyNumbers(item,{...Object.fromEntries(Object.entries(content(item)).filter(([k])=>!metadata.has(k))),external_basis_texts:[...new Set(item.external_refs.map(r=>r.text))].filter(t=>t!==(item.text??item.description)).sort()});
  return {scene:execution(scene),target:targets.has(scene.requirement_id)?execution(targets.get(scene.requirement_id)):null,
    related:[...refs(scene)].filter(r=>r!==scene.requirement_id).sort().map(r=>execution(targets.get(r))),
    context:legacyContext?value.context:executionContext(value.context)};
}
export const sceneFingerprint=(value,id,{legacyContext=false}={})=>fingerprint(sceneClosure(value,id,legacyContext));
export function sceneInput(config,id){
  const value=loadBinding(config,{required:true}),scene=value.scenarios.find(s=>s.id===id);if(!scene)throw Error('scene absent from frozen definitions');
  const targets=new Map([...value.requirements,...value.reverse_rules].map(r=>[r.id,r]));
  const sources=value.reverse_rules.filter(r=>refs(scene).has(r.id)).flatMap(r=>r.code_sources);
  return cloneJson({definitions:config.definitions,scene,requirement:targets.get(scene.requirement_id)??null,
    related_requirements:[...refs(scene)].filter(r=>r!==scene.requirement_id).sort().map(r=>targets.get(r)),business_goal:value.context.business_goal,
    confirmed_scope:value.context.confirmed_scope??{},scenario_self_check:scene.check.method,definition_binding_sha256:sceneFingerprint(value,id),
    ...(scene.ui_acceptance?{ui_acceptance:scene.ui_acceptance}:{}),...(sources.length?{source_evidence:{revision:sources[0].revision,items:sources}}:{})});
}
export function verifyCase(config){
  const value=loadBinding(config);
  if(!value){if(!config.scene?.id||!config.requirement?.id||config.scene.requirement_id!==config.requirement.id)throw Error('case input has no bound scene owner');return;}
  const expected=sceneInput(config,config.scene?.id);
  if(expected.ui_acceptance&&Object.entries(expected.ui_acceptance).some(([k,v])=>!equal(config.ui_acceptance?.[k],v)))throw Error('case differs from frozen UI contract');
  for(const key of ['scene','requirement','related_requirements','business_goal','confirmed_scope','scenario_self_check','definition_binding_sha256',...(expected.source_evidence?['source_evidence']:[])]){
    if(key==='definition_binding_sha256'&&config[key]===sceneFingerprint(value,config.scene.id,{legacyContext:true}))continue;
    if(!equal(config[key],expected[key]))throw Error('case differs from frozen definitions: '+key);
  }
}
export function verifyStage(request){
  const value=loadBinding(request);if(!value)return;
  const actual=request.requirements?.items??[],expected=value.requirements;
  if(actual.length!==expected.length||!equal(Object.fromEntries(actual.map(r=>[r.id,r.text])),Object.fromEntries(expected.map(r=>[r.id,r.text]))))throw Error('stage requirements differ from complete frozen definitions');
  if((request.requirements?.shared_constraints??'')!==(value.context.shared_constraints??''))throw Error('stage shared constraints differ from frozen context');
  if(request.base_revision){
    const existing=request.existing_rules??[];
    if(existing.length!==value.reverse_rules.length||!equal(existing.map(r=>r.id).sort(),value.reverse_rules.map(r=>r.id).sort()))throw Error('reverse stage must retain the complete frozen existing rules');
    for(const rule of existing){const frozen=value.reverse_rules.find(r=>r.id===rule.id);if(['text','status','basis_kind','basis'].some(k=>!equal(rule[k],frozen[k])))throw Error('reverse stage rewrote a frozen rule');}
  }
}
const definitionIndex=value=>new Map(collections.flatMap(group=>(value?.[group]??[]).map(item=>[group+':'+item.id,item])));
export function versioned(value,previous=null){
  const result=cloneJson(value),prior=definitionIndex(previous);
  for(const group of collections)for(const item of result[group]){
    const old=prior.get(group+':'+item.id),raw=content(item);
    item.version=old?(equal(content(old),raw)?old.version??1:(old.version??1)+1):1;
    item.content_sha256=fingerprint(raw);
  }
  return validateDefinitions(result);
}
export function compareDefinitions(previous,candidate,assessment={}){
  candidate=cloneJson(candidate);
  for(const group of collections)for(const item of candidate[group]??[])for(const key of generated)delete item[key];
  validateDefinitions(candidate);
  const old=definitionIndex(previous),next=definitionIndex(candidate),changes=[],affected=new Set(),changedTargets=new Set(),scenarioChecks=new Set();let analysis=false;
  const notes=assessment?.changes??{};
  for(const key of [...new Set([...old.keys(),...next.keys()])].sort()){
    const before=old.get(key),after=next.get(key);
    if(before&&after&&equal(content(before),content(after)))continue;
    const fields=[...new Set([...Object.keys(content(before??{})),...Object.keys(content(after??{}))])].filter(k=>!equal(before?.[k]??null,after?.[k]??null)).sort();
    let onlyMetadata=Boolean(before&&after&&fields.every(k=>metadata.has(k)));
    if(onlyMetadata&&fields.includes('external_refs')){
      const oldTexts=new Set(before.external_refs.map(r=>r.text)),newTexts=new Set(after.external_refs.map(r=>r.text)),own=before.text??before.description;
      onlyMetadata=[...oldTexts].every(t=>newTexts.has(t))&&[...newTexts].every(t=>oldTexts.has(t)||t===own);
    }
    const note=notes[key]??{},equivalent=note.classification==='equivalent';
    if(equivalent&&(!note.reason||!before||!after||before.status!==after.status))throw Error('equivalence needs two definitions, unchanged admission and an Agent reason');
    const semantic=!onlyMetadata&&!equivalent,separator=key.indexOf(':'),group=key.slice(0,separator),id=key.slice(separator+1);
    changes.push({ref:key,operation:!before?'added':!after?'removed':'modified',fields,classification:equivalent?'equivalent':onlyMetadata?'metadata':'definition',assessment:note,before_sha256:before?fingerprint(content(before)):null,after_sha256:after?fingerprint(content(after)):null});
    if(semantic&&group!=='scenarios'){analysis=true;if(after&&after.status!=='needs_confirmation')changedTargets.add(id);}
    if(semantic&&group==='scenarios'&&after)affected.add(id);
  }
  const contextChanged=Boolean(previous&&!equal(previous.context,candidate.context));
  const executionChanged=Boolean(previous&&(previous.schema!==schema||!equal(executionContext(previous.context),executionContext(candidate.context))));
  if(contextChanged)analysis=true;
  if(executionChanged)for(const target of [...candidate.requirements,...candidate.reverse_rules])if(target.status!=='needs_confirmation')changedTargets.add(target.id);
  const dependencies=new Set(changes.filter(c=>c.classification==='definition'&&!c.ref.startsWith('scenarios:')).map(c=>c.ref.slice(c.ref.indexOf(':')+1)));
  for(const scene of candidate.scenarios){if(executionChanged||[...refs(scene)].some(r=>dependencies.has(r)))affected.add(scene.id);if(analysis)scenarioChecks.add(scene.id);}
  const extra=assessment?.affected_scene_ids??[],known=new Set(candidate.scenarios.map(s=>s.id));
  if(!Array.isArray(extra)||extra.some(id=>!known.has(id)))throw Error('Agent impact assessment references unknown scenes');
  if(extra.length&&!assessment?.reason)throw Error('additional impact needs an Agent reason');for(const id of extra)affected.add(id);
  const covered=new Set(candidate.scenarios.map(s=>s.requirement_id)),pending=candidate.reverse_rules.filter(r=>r.status==='needs_confirmation').map(r=>r.id),missing=[...candidate.requirements,...candidate.reverse_rules].filter(r=>r.status!=='needs_confirmation'&&!covered.has(r.id)).map(r=>r.id),equivalents={};
  for(const scene of candidate.scenarios)if(!affected.has(scene.id)&&previous?.scenarios.some(s=>s.id===scene.id)){
    const current=sceneFingerprint(candidate,scene.id),inherited=previous.change?.equivalent_bindings?.[scene.id]??[];
    equivalents[scene.id]=[...new Set([sceneFingerprint(previous,scene.id),...inherited])].filter(hash=>hash!==current).sort();
  }
  return {schema:'acceptance-definition-change-v1',base_sha256:previous?fingerprint(previous):null,candidate_sha256:fingerprint(candidate),changes,context_changed:contextChanged,execution_context_changed:executionChanged,analysis_required:analysis,coverage_check_scene_ids:[...scenarioChecks].sort(),scenario_target_ids:[...new Set([...changedTargets,...missing])].sort(),rerun_scene_ids:[...affected].sort(),missing_scenario_target_ids:missing,pending_rule_ids:pending,assessment:assessment??{},equivalent_bindings:equivalents,decision:'proposed_only',product_revision_policy:'same-version completion still required'};
}
