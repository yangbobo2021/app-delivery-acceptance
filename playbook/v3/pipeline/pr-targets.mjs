import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {reverseArtifactReady} from '../reverse/artifact.mjs';

const [approvedArg,outputArg]=process.argv.slice(2);
if(!approvedArg||!outputArg)throw Error('usage: node pr-targets.mjs approved.json targets.json');
const source=resolve(approvedArg),raw=readFileSync(source),approved=JSON.parse(raw);
if(!reverseArtifactReady(approved,source)||!approved.change?.inventory)
 throw Error('Complete frozen PR reverse analysis required');
const behaviors=approved.draft.behavior_impacts??[];
const reviewed=new Set(approved.schema==='commit-reverse-v1'
 ?(approved.review.behavior_reviews??[]).filter(x=>x.verdict==='accepted').map(x=>x.behavior_id)
 :behaviors.map(x=>x.id));
if(behaviors.some(x=>!reviewed.has(x.id))||approved.change.inventory.unclassified_paths?.length)throw Error('PR behavior or path analysis incomplete');
const targets=[],inventory=approved.change.inventory,modes=inventory.test_modes??['WHITE_BOX'];
for(const id of inventory.pr_requirement_ids??[]){
 if(modes.includes('BLACK_BOX'))targets.push({key:'BLACK_BOX:'+id,id,mode:'BLACK_BOX',kind:'original_requirement'});
}
for(const behavior of behaviors){
 if(['unresolved','no_behavior'].includes(behavior.coverage))continue;
 if(!modes.includes('WHITE_BOX'))continue;
 for(const target of behavior.target_ids){
  const key='WHITE_BOX:'+target;
  if(!targets.some(x=>x.key===key))targets.push({key,id:target,mode:'WHITE_BOX',kind:behavior.coverage==='requirement'?'original_requirement':'reverse_rule'});
 }
}
const unresolved=behaviors.filter(x=>x.coverage==='unresolved').map(x=>({id:x.id,description:x.description,reason:x.reason}));
const result={schema:'pr-targets-v1',change_sha256:createHash('sha256').update(raw).digest('hex'),
 base_revision:approved.change.base_revision,head_revision:approved.change.head_revision,
 inventory_sha256:approved.change.inventory_sha256,test_modes:modes,pr_requirement_ids:inventory.pr_requirement_ids??[],targets,unresolved,
 no_behavior:behaviors.filter(x=>x.coverage==='no_behavior').map(x=>x.id)};
writeFileSync(resolve(outputArg),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({targets:targets.length,unresolved:unresolved.length}));
