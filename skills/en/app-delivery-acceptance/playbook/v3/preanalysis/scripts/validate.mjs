import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const [requestPath, folder] = process.argv.slice(2);
const request=JSON.parse(readFileSync(requestPath,'utf8')); const errors=[];
let result;
try {result=JSON.parse(readFileSync(join(folder,'candidate.json'),'utf8'));}
catch(e){errors.push('Candidate JSON is missing/invalid: '+e.message);}
const text=x=>typeof x==='string'&&x.trim().length>0;
const strings=x=>Array.isArray(x)&&x.every(text);
const ids=request.requirements.items.map(x=>x.id);
if(new Set(ids).size!==ids.length)errors.push('Input requirement IDs are not unique');
if(result){
 if(!text(result.business_goal))errors.push('business_goal missing');
 const scope=result.confirmed_scope;
 if(!scope||!strings(scope.included_requirement_ids)||!strings(scope.exclusions)||!strings(scope.limitations))errors.push('scope structure invalid');
 else if(!isDeepStrictEqual([...scope.included_requirement_ids].sort(),[...ids].sort()))errors.push('scope omitted or invented requirements');
 if(!Array.isArray(result.requirement_groups)||!result.requirement_groups.length)errors.push('groups missing');
 else {
  const seen=new Set(), covered=new Set();
  for(const g of result.requirement_groups){
   if(!text(g.id)||seen.has(g.id)||!text(g.title)||!text(g.reason)||!strings(g.requirement_ids)||!g.requirement_ids.length)errors.push('invalid group');
   seen.add(g.id);
   if(new Set(g.requirement_ids??[]).size!==(g.requirement_ids??[]).length)errors.push('duplicate member within a group');
   for(const id of g.requirement_ids??[]){if(!ids.includes(id))errors.push('unknown group member '+id);covered.add(id);}
  }
  for(const id of ids)if(!covered.has(id))errors.push('ungrouped requirement '+id);
 }
 if(!strings(result.change_summary)||!result.change_summary.length)errors.push('change summary missing');
 if(request.mode==='edit'){
  if(!request.previous_analysis)errors.push('edit baseline missing');
  else for(const key of ['business_goal','confirmed_scope','requirement_groups']){
   if(!request.allowed_changes.includes(key)&&!isDeepStrictEqual(result[key],request.previous_analysis[key]))errors.push('unauthorized section change: '+key);
  }
  if(request.allowed_scope_changes&&request.previous_analysis){
   for(const key of ['included_requirement_ids','exclusions','limitations']){
    if(!request.allowed_scope_changes.includes(key)&&!isDeepStrictEqual(result.confirmed_scope?.[key],request.previous_analysis.confirmed_scope?.[key]))errors.push('unauthorized scope field change: '+key);
   }
  }
 }
}
const report={status:errors.length?'failed':'passed',errors,requirement_count:ids.length,group_count:result?.requirement_groups?.length??0,
  semantic_review_performed:false};
writeFileSync(join(folder,'validation.json'),JSON.stringify(report,null,2)+'\n');
if(!errors.length){result.version=(request.previous_analysis?.version??0)+1;
 writeFileSync(join(folder,'analysis.json.tmp'),JSON.stringify(result,null,2)+'\n');renameSync(join(folder,'analysis.json.tmp'),join(folder,'analysis.json'));}
process.exitCode=errors.length?1:0;
