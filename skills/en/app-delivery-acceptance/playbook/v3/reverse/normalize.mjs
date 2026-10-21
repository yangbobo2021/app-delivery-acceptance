export function normalizeRuleCoverage(candidate,existingRules=[]){
 const existing=new Set(existingRules.map(x=>x.id));
 const rules=new Map((candidate.reverse_rules??[]).map(x=>[x.id,x]));
 const changes=[];
 for(const item of candidate.behavior_impacts??[]){
  if(item.coverage!=='existing_rule'||!Array.isArray(item.target_ids)||!item.target_ids.length||
     item.target_ids.some(id=>existing.has(id)||!rules.has(id)))continue;
  const statuses=item.target_ids.map(id=>rules.get(id).status);
  const next=statuses.every(x=>x==='needs_confirmation')?'unresolved':
   statuses.every(x=>x==='supported')?'new_rule':null;
  if(next){changes.push({id:item.id,from:item.coverage,to:next});item.coverage=next;}
 }
 return {candidate,changes};
}
