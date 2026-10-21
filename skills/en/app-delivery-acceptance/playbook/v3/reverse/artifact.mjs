import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');

export function reverseArtifactReady(artifact,path){
 if(artifact?.schema==='commit-reverse-v1')
  return artifact.status==='approved'&&artifact.review?.status==='approved';
 if(artifact?.schema!=='commit-reverse-selfcheck-v1'||artifact.status!=='completed'||
    artifact.self_check?.method!=='single_agent_internal'||!path)return false;
 try{
  const folder=dirname(resolve(path));
  return artifact.self_check.draft_sha256===sha(JSON.stringify(artifact.draft,null,2)+'\n')&&
   artifact.self_check.draft_sha256===sha(readFileSync(join(folder,'draft.current.json')))&&
   artifact.self_check.gate_sha256===sha(readFileSync(join(folder,'draft-gate.json')))&&
   JSON.parse(readFileSync(join(folder,'draft-gate.json'),'utf8')).status==='ready'&&
   artifact.self_check.agent_trace_sha256===sha(readFileSync(join(folder,'agent-selfcheck.jsonl')));
 }catch{return false}
}

export function executableReverseRules(artifact){
 return (artifact.draft?.reverse_rules??[]).filter(rule=>rule.status==='supported'||rule.status==='confirmed');
}

export function executableReverseTarget(artifact,id){
 if(artifact.schema==='commit-reverse-v1')
  return artifact.review?.rule_reviews?.some(x=>x.rule_id===id&&x.verdict==='accepted')??false;
 return executableReverseRules(artifact).some(x=>x.id===id);
}

export function executableRequirementImpact(artifact,id){
 if(artifact.schema==='commit-reverse-v1')
  return artifact.draft?.impacts?.some(x=>x.requirement_id===id)&&
   artifact.review?.impact_reviews?.some(x=>x.requirement_id===id&&x.verdict==='accepted');
 return artifact.draft?.impacts?.some(x=>x.requirement_id===id)??false;
}
