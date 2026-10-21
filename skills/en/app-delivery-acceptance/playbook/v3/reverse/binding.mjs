import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {reverseArtifactReady,executableReverseRules,executableReverseTarget,executableRequirementImpact} from './artifact.mjs';
import {verifyContract} from './contracts.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function bindReviewedReverse(request){
 if(request.scenario_kind!=='WHITE_BOX')return request;
 if(!request.reviewed_reverse_path||!request.reviewed_reverse_sha256)throw Error('White-box request needs frozen reverse result path and hash');
 const raw=readFileSync(resolve(request.reviewed_reverse_path));
 if(sha(raw)!==request.reviewed_reverse_sha256)throw Error('Reverse result changed');
 const approved=JSON.parse(raw),cwd=resolve(request.project_root);
 if(!reverseArtifactReady(approved,request.reviewed_reverse_path))throw Error('Reverse result lacks a valid self-check and structural gate');
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
 if(revision!==approved.change?.head_revision)throw Error('Commit changed after reverse analysis');
 if(approved.schema==='commit-reverse-v1'&&sha(JSON.stringify(approved.draft,null,2)+'\n')!==approved.draft_sha256)throw Error('Reviewed draft changed');
 for(const file of approved.change.changed_files){
  const path=resolve(cwd,file.path);if(!path.startsWith(cwd+'/')||sha(readFileSync(path))!==file.sha256)throw Error('Changed source drift: '+file.path);
 }
 for(const file of approved.change.contract_files)verifyContract(file,cwd);
 for(const file of approved.change.context_files??[]){
  const path=resolve(cwd,file.path);if(!path.startsWith(cwd+'/')||sha(readFileSync(path))!==file.sha256)throw Error('Caller context drift: '+file.path);
 }
 if(approved.change.inventory){
  const inventory=approved.change.inventory;
  if(inventory.head_revision!==revision||inventory.unclassified_paths?.length)throw Error('PR inventory incomplete or stale');
  if(inventory.target_revision&&execFileSync('git',['rev-parse',inventory.base_ref],{cwd,encoding:'utf8'}).trim()!==inventory.target_revision)
   throw Error('PR target ref moved after review');
  for(const [path,hash] of Object.entries(inventory.source_hashes??{})){
   const absolute=resolve(cwd,path);if(!absolute.startsWith(cwd+'/')||sha(readFileSync(absolute))!==hash)throw Error('Project source inventory drift: '+path);
  }
  for(const link of inventory.gitlinks??[]){
   const child=resolve(cwd,link.path);
   if(!child.startsWith(cwd+'/')||
      execFileSync('git',['rev-parse','HEAD'],{cwd:child,encoding:'utf8'}).trim()!==link.head_revision||
      execFileSync('git',['rev-parse',`${revision}:${link.path}`],{cwd,encoding:'utf8'}).trim()!==link.head_revision)
    throw Error('Reviewed submodule revision drift: '+link.path);
  }
 }
 const target=approved.draft.reverse_rules.find(x=>x.id===request.target_requirement_id);
 const reverse_rules=executableReverseRules(approved);
 const original=request.requirements.items.find(x=>x.id===request.target_requirement_id);
 if(!target&&!original)throw Error('White-box target absent from approved sources');
 if(target){
  if(target.status==='needs_confirmation')throw Error('Reverse rule needs business confirmation before executable scene design');
  if(!executableReverseTarget(approved,target.id))throw Error('Target reverse rule lacks an executable independent basis');
 }else if(!executableRequirementImpact(approved,original.id))throw Error('Original requirement impact is absent from frozen reverse result');
 const relevantPaths=target?.code_sources??(approved.draft.behavior_impacts?[...new Set((approved.draft.behavior_impacts??[])
  .filter(x=>x.coverage==='requirement'&&x.target_ids.includes(original.id)).flatMap(x=>x.code_paths))]
  .map(path=>approved.change.changed_files.find(x=>x.path===path)).filter(Boolean):approved.change.changed_files);
 if(!relevantPaths.length)throw Error('White-box target has no reviewed changed source');
 return {...request,reverse_rules,source_evidence:{status:'approved',revision,
  items:relevantPaths.map(x=>({path:x.path,sha256:x.sha256,basis:target?.basis??'Frozen behavior impact on original requirement'}))},
  reviewed_reverse_sha256:sha(raw),base_revision:approved.change.base_revision,diff_sha256:approved.change.diff_sha256,
  changed_files:approved.change.changed_files,change_inventory:approved.change.inventory};
}
