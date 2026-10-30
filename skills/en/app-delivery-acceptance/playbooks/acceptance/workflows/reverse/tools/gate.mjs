import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyReverseReadEvidence} from '../source-reads.mjs';
import {verifyContract,contractPath} from '../contracts.mjs';
const [folder,stage]=process.argv.slice(2);
const read=name=>JSON.parse(readFileSync(join(folder,name),'utf8'));
const save=(name,value)=>{const p=join(folder,name),tmp=p+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');renameSync(tmp,p)};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const meaningful=x=>typeof x==='string'&&!!x.trim();
const frozen=read('request.frozen.json'),change=read('change.json'),errors=[];
let readEvidence;
try{readEvidence=read('analyst-read-evidence.json')}
catch{errors.push('Analyst source-read evidence missing')}
const project=resolve(frozen.project_root);
if(readEvidence&&(change.inventory
 ? !verifyReverseReadEvidence(readEvidence,change.inventory,project)
 : readEvidence.schema!=='reverse-read-evidence-v2'||readEvidence.source_inventory_sha256!==null||
   !Array.isArray(readEvidence.results)||readEvidence.results.length))errors.push('Analyst source-read evidence invalid');
if(existsSync(join(folder,'revision-parent.json'))){
 try{
  const meta=read('revision-parent.json'),parentDraft=readFileSync(join(folder,'parent-draft.json')),
   parentReview=read('parent-review.json'),parentReviewBytes=readFileSync(join(folder,'parent-review.json')),
   parentEvidenceBytes=readFileSync(join(folder,'parent-read-evidence.json'));
  if(meta.schema!=='reverse-review-revision-v1'||![1,2].includes(meta.depth)||
     meta.parent_change_sha256!==sha(readFileSync(join(folder,'change.json')))||
     meta.parent_draft_sha256!==sha(parentDraft)||meta.parent_review_sha256!==sha(parentReviewBytes)||
     meta.parent_read_evidence_sha256!==sha(parentEvidenceBytes)||
     parentReview.status!=='changes_required'||parentReview.draft_sha256!==sha(parentDraft)||
     parentReview.read_evidence_sha256!==sha(parentEvidenceBytes)||
     !verifyReverseReadEvidence(JSON.parse(parentEvidenceBytes),change.inventory,project))
   errors.push('Review revision parent binding invalid');
 }catch{errors.push('Review revision parent evidence missing or invalid')}
}
if(!Array.isArray(change.diff_chunks)||change.diff_chunks.length<1||
   change.diff_chunks.map(x=>{try{
    const bytes=readFileSync(join(folder,'diff-chunks',x.id+'.patch'));
    if(sha(bytes)!==x.sha256||bytes.toString().length!==x.characters)errors.push('Frozen diff chunk changed: '+x.id);
    return bytes.toString();
   }catch{errors.push('Frozen diff chunk missing: '+x.id);return ''}}).join('')!==change.diff)
 errors.push('Frozen diff chunks do not reconstruct the reviewed change');
let status='invalid';
try{if(execFileSync('git',['rev-parse','HEAD'],{cwd:project,encoding:'utf8'}).trim()!==change.head_revision)errors.push('Commit changed during reverse review')}
catch{errors.push('Commit unavailable during reverse review')}
for(const file of [...change.changed_files,...(change.context_files??[])]){
 try{if(sha(readFileSync(join(project,file.path)))!==file.sha256)errors.push('Frozen source or contract changed: '+file.path)}
 catch{errors.push('Frozen source or contract missing: '+file.path)}
}
for(const file of change.contract_files){try{verifyContract(file,project)}catch(e){errors.push(String(e.message??e))}}
if(change.inventory){
 if(change.inventory.schema!=='change-inventory-v1'||change.inventory.head_revision!==change.head_revision||change.inventory.base_revision!==change.base_revision||
    change.inventory.unclassified_paths?.length||sha(JSON.stringify(change.inventory))!==change.inventory_sha256)errors.push('Complete PR inventory invalid');
 for(const [path,hash] of Object.entries(change.inventory.source_hashes??{})){
  try{if(sha(readFileSync(join(project,path)))!==hash)errors.push('Project source inventory changed: '+path)}
  catch{errors.push('Project source inventory missing: '+path)}
 }
 for(const link of change.inventory.gitlinks??[]){
  try{if(execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(project,link.path),encoding:'utf8'}).trim()!==link.head_revision||
     execFileSync('git',['rev-parse',`${change.head_revision}:${link.path}`],{cwd:project,encoding:'utf8'}).trim()!==link.head_revision)
    errors.push('Submodule revision moved after inventory freeze: '+link.path)}
  catch{errors.push('Submodule revision unavailable: '+link.path)}
 }
 if(change.inventory.target_revision){
  try{if(execFileSync('git',['rev-parse',change.inventory.base_ref],{cwd:project,encoding:'utf8'}).trim()!==change.inventory.target_revision)
   errors.push('PR target ref moved after inventory freeze')}
  catch{errors.push('PR target ref unavailable after inventory freeze')}
 }
}
if(stage==='draft'){
 let doc;try{doc=read('draft.candidate.json')}catch(e){errors.push('Invalid draft JSON: '+e.message)}
 if(doc){
  if(doc.base_revision!==change.base_revision||doc.head_revision!==change.head_revision||doc.change_sha256!==sha(readFileSync(join(folder,'change.json'))))errors.push('Change binding mismatch');
  if(!Array.isArray(doc.impacts)||!Array.isArray(doc.reverse_rules)||(!change.inventory&&!(doc.impacts.length+doc.reverse_rules.length)))errors.push('No affected target');
  const req=new Set(frozen.requirements.items.map(x=>x.id)),seen=new Set();
  const existing=new Map((frozen.existing_rules??[]).map(x=>[x.id,x]));
  if(change.inventory){
   const behaviors=doc.behavior_impacts;
   if(!Array.isArray(behaviors)||!behaviors.length)errors.push('PR behavior impact inventory missing');
   const ids=new Set(),covered=new Set(),changed=new Set(change.inventory.changed_source_paths);
   for(const item of behaviors??[]){
    if(!meaningful(item.id)||ids.has(item.id)||!meaningful(item.description)||!meaningful(item.reason)||
       !['requirement','existing_rule','new_rule','unresolved','no_behavior'].includes(item.coverage)||
       !Array.isArray(item.code_paths)||!item.code_paths.length||!Array.isArray(item.target_ids))errors.push('Invalid behavior impact');
    ids.add(item.id);
    for(const path of item.code_paths??[]){if(!changed.has(path))errors.push('Behavior references unchanged/unknown product code: '+path);covered.add(path)}
    if(item.coverage==='requirement'&&(!item.target_ids.length||item.target_ids.some(id=>!req.has(id)||!doc.impacts.some(x=>x.requirement_id===id))))errors.push('Requirement behavior target not present in impacts');
    if(item.coverage==='existing_rule'&&(!item.target_ids.length||item.target_ids.some(id=>!existing.has(id)||!doc.reverse_rules.some(x=>x.id===id))))errors.push('Existing rule behavior target missing');
    if(item.coverage==='new_rule'&&(!item.target_ids.length||item.target_ids.some(id=>existing.has(id)||!doc.reverse_rules.some(x=>x.id===id))))errors.push('New rule behavior target missing');
    if(['new_rule','existing_rule'].includes(item.coverage)&&item.target_ids.some(id=>!doc.reverse_rules.some(x=>x.id===id&&x.status==='supported')))errors.push('Executable behavior rule needs supported status');
    if(item.coverage==='no_behavior'&&item.target_ids.length)errors.push('Nonbehavior impact cannot claim target');
    if(item.coverage==='unresolved'&&item.target_ids.some(id=>!doc.reverse_rules.some(x=>x.id===id&&x.status==='needs_confirmation')))errors.push('Unresolved behavior may reference only pending rules');
   }
   for(const path of changed)if(!covered.has(path))errors.push('Changed product source has no behavior disposition: '+path);
   for(const impact of doc.impacts??[])if(!(behaviors??[]).some(x=>x.coverage==='requirement'&&x.target_ids.includes(impact.requirement_id)))errors.push('Requirement impact has no behavior basis');
   for(const rule of doc.reverse_rules??[])if(!(behaviors??[]).some(x=>['new_rule','existing_rule','unresolved'].includes(x.coverage)&&x.target_ids.includes(rule.id)))errors.push('Rule has no behavior basis');
  }
  for(const impact of doc.impacts??[]){if(!req.has(impact.requirement_id)||!meaningful(impact.reason))errors.push('Invalid existing-requirement impact')}
  for(const rule of doc.reverse_rules??[]){
   if(!meaningful(rule.id)||seen.has(rule.id)||req.has(rule.id)||!meaningful(rule.title)||!meaningful(rule.text)||!meaningful(rule.rationale))errors.push('Invalid rule identity/content');seen.add(rule.id);
   if(!['supported','needs_confirmation'].includes(rule.status)||!['contract','invariant','confirmed_decision','candidate'].includes(rule.basis_kind)||!meaningful(rule.basis))errors.push('Invalid rule status/basis');
   if(rule.status==='needs_confirmation'&&!meaningful(rule.question))errors.push('Unresolved rule needs a specific question');
   if(rule.status==='supported'&&rule.basis_kind==='candidate')errors.push('Current implementation alone cannot establish a supported rule');
   if(!Array.isArray(rule.code_sources)||!rule.code_sources.length)errors.push('Rule needs changed code source');
   for(const source of rule.code_sources??[]){
    const changed=change.changed_files.find(x=>x.path===source.path);
    if(!changed||source.revision!==change.head_revision||source.sha256!==changed.sha256)errors.push('Rule source is not bound to changed file');
    if(source.line_start!==undefined||source.line_end!==undefined){
     const lines=readFileSync(join(project,source.path),'utf8').split(/\r?\n/);
     if(!Number.isInteger(source.line_start)||!Number.isInteger(source.line_end)||source.line_start<1||source.line_end<source.line_start||source.line_end>lines.length||source.excerpt!==lines.slice(source.line_start-1,source.line_end).join('\n'))errors.push('Source excerpt/lines mismatch');
    }
   }
   if(rule.status==='supported'&&rule.basis_kind==='contract'){
    const contract=change.contract_files.find(x=>x.path===rule.contract_source);
    if(!contract||!meaningful(rule.contract_quote)||
       !(contract.content??readFileSync(contractPath(contract,project),'utf8')).includes(rule.contract_quote))errors.push('Independent contract quote missing');
    if(change.inventory?.files.some(x=>x.path===rule.contract_source)&&
       !(frozen.confirmed_contract_paths??[]).includes(rule.contract_source))errors.push('PR-modified contract is not independently confirmed: '+rule.contract_source);
   }
   if(!Array.isArray(rule.related_requirement_ids)||rule.related_requirement_ids.some(id=>!req.has(id)))errors.push('Invalid related original requirements');
   const prior=existing.get(rule.id);
   if(prior&&['title','text','basis_kind','basis','contract_source','contract_quote'].some(key=>prior[key]!==rule[key]))errors.push('Existing rule contract was rewritten: '+rule.id);
  }
  if(!errors.length){save('draft.current.json',doc);status='ready'}
 }
}else if(stage==='review'){
 let review;try{review=read('review.candidate.json')}catch(e){errors.push('Invalid review JSON: '+e.message)}
 const draft=read('draft.current.json'),draftHash=sha(readFileSync(join(folder,'draft.current.json')));
 if(review){
  if(review.draft_sha256!==draftHash||review.read_evidence_sha256!==sha(readFileSync(join(folder,'analyst-read-evidence.json')))||
     !['approved','changes_required','needs_clarification'].includes(review.status)||!meaningful(review.reason))errors.push('Invalid independent review binding/status');
  if(review.source_requests!==undefined){
   const declared=new Set([...Object.keys(change.inventory?.source_hashes??{}),
    ...(change.inventory?.files??[]).filter(x=>x.kind==='noncode'&&x.sha256).map(x=>x.path)]);
   if(!Array.isArray(review.source_requests)||review.source_requests.length>6||
      review.status!=='changes_required'&&review.source_requests.length>0||
      review.source_requests.some(x=>{
       if(!x||JSON.stringify(x).length>1000)return true;
       if(x.kind==='lines')return !declared.has(x.path)||!Number.isInteger(x.start)||!Number.isInteger(x.end)||
        x.start<1||x.end<x.start||x.end-x.start>80;
       if(x.kind==='search')return !meaningful(x.pattern)||x.pattern.length>120||
        !Array.isArray(x.paths)||!x.paths.length||x.paths.length>8||x.paths.some(p=>!declared.has(p));
       return true;
      }))errors.push('Reviewer supplemental source request invalid');
  }
  const ids=new Set(draft.reverse_rules.map(x=>x.id));
  if(!Array.isArray(review.rule_reviews)||review.rule_reviews.length!==ids.size||new Set(review.rule_reviews.map(x=>x.rule_id)).size!==ids.size)errors.push('Review every reverse rule exactly once');
  for(const item of review.rule_reviews??[]){if(!ids.has(item.rule_id)||!['accepted','needs_confirmation','gap'].includes(item.verdict)||!meaningful(item.reason))errors.push('Invalid rule review')}
  const impacted=new Set(draft.impacts.map(x=>x.requirement_id));
  if(!Array.isArray(review.impact_reviews)||new Set(review.impact_reviews.map(x=>x.requirement_id)).size!==review.impact_reviews.length||
     [...impacted].some(id=>!review.impact_reviews.some(x=>x.requirement_id===id))||
     review.impact_reviews.some(x=>!frozen.requirements.items.some(r=>r.id===x.requirement_id)||!['accepted','gap'].includes(x.verdict)||!meaningful(x.reason)))errors.push('Review every impacted original requirement with valid IDs');
  if(review.status==='approved'&&((review.rule_reviews??[]).some(x=>x.verdict==='gap')||(review.impact_reviews??[]).some(x=>x.verdict==='gap')))errors.push('Approval contradicts findings');
  if(change.inventory){
   const behaviorIds=new Set((draft.behavior_impacts??[]).map(x=>x.id));
   if(!Array.isArray(review.behavior_reviews)||review.behavior_reviews.length!==behaviorIds.size||
      new Set(review.behavior_reviews.map(x=>x.behavior_id)).size!==behaviorIds.size||
      review.behavior_reviews.some(x=>!behaviorIds.has(x.behavior_id)||!['accepted','gap'].includes(x.verdict)||!meaningful(x.reason)))errors.push('Review every behavior impact exactly once');
   if(review.status==='approved'&&review.behavior_reviews?.some(x=>x.verdict==='gap'))errors.push('Approval contradicts behavior gap');
  }
  if(review.status==='approved'&&(review.rule_reviews??[]).some(x=>x.verdict==='needs_confirmation'&&draft.reverse_rules.some(r=>r.id===x.rule_id&&r.status==='supported')))errors.push('Supported rule cannot be approved while reviewer requests confirmation');
  if(!errors.length){save('review.current.json',review);status=review.status;
   if(status==='approved')save('approved.json',{schema:'commit-reverse-v1',status:'approved',change,draft,review,
    analyst_read_evidence:readEvidence,read_evidence_sha256:review.read_evidence_sha256,
    draft_sha256:draftHash,review_sha256:sha(readFileSync(join(folder,'review.current.json')))});
  }
 }
}else errors.push('Unknown stage');
save(stage+'-gate.json',{stage,status,errors});
process.exitCode=status==='ready'||status==='approved'?0:1;
