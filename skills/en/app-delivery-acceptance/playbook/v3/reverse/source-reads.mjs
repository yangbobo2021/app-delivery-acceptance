import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
const MAX_REQUESTS=6,MAX_EVIDENCE_CHARS=12000,MAX_REVISION_CHARS=32000,MAX_MATCHES=8;

export function collectSourceReads(requests, inventory, projectRoot,{revision=false}={}){
 if(!inventory||!Array.isArray(requests)||requests.length>MAX_REQUESTS)throw Error('Source requests must be at most six declared reads');
 const evidenceLimit=revision?MAX_REVISION_CHARS:MAX_EVIDENCE_CHARS;
 const hashes={...inventory.source_hashes};
 for(const file of inventory.files??[])if(file.kind==='noncode'&&file.sha256)hashes[file.path]=file.sha256;
 const declared=new Set(Object.keys(hashes)),results=[];
 const linesFor=path=>{
  if(!declared.has(path))throw Error('Undeclared source read: '+path);
  const absolute=resolve(projectRoot,path);
  if(!absolute.startsWith(resolve(projectRoot)+'/'))throw Error('Source read outside checkout');
  const raw=readFileSync(absolute);
  if(sha(raw)!==hashes[path])throw Error('Source changed after inventory: '+path);
  return raw.toString('utf8').split(/\r?\n/);
 };
 for(const item of requests){
  if(!item||!['lines','search'].includes(item.kind)||JSON.stringify(item).length>1000||
     Array.isArray(item.paths)&&item.paths.length>8){
   results.push({kind:'denied',request_sha256:sha(JSON.stringify(item)),matches:[],total_hits:0,
    limited:true,denied:'Source request shape or metadata exceeds the bounded read contract'});
   continue;
  }
  const matches=[];let totalHits=0;
  try{
  if(item.kind==='lines'){
   const {path,start,end}=item;
   if(typeof path!=='string'||!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end-start>80)
    throw Error('Source line request must name a declared path and at most 81 lines');
   const lines=linesFor(path);
   if(end>lines.length)throw Error('Source line request exceeds file: '+path+' ('+lines.length+' lines)');
   matches.push(makeMatch(path,start,end,lines));totalHits=1;
  }else{
   if(typeof item.pattern!=='string'||!item.pattern||item.pattern.length>120)throw Error('Source search needs a short literal pattern');
   const paths=item.paths??inventory.source_paths;
   if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!declared.has(p)))throw Error('Source search names undeclared paths');
   for(const path of paths){
    const lines=linesFor(path);
    for(let i=0;i<lines.length;i++)if(lines[i].includes(item.pattern)){
     totalHits++;
     if(matches.length<MAX_MATCHES)matches.push(makeMatch(path,Math.max(1,i),Math.min(lines.length,i+2),lines));
    }
   }
  }
  }catch(e){
   results.push({kind:item.kind,request:item,matches:[],total_hits:0,limited:true,denied:String(e.message)});
   continue;
  }
  const entry={kind:item.kind,request:item,matches,total_hits:totalHits,limited:totalHits>matches.length};
  results.push(entry);
  // Truncate only the displayed excerpt, never the source binding. The complete
  // source slice remains verifiable by hash and a narrower read can be requested.
  while(JSON.stringify(results).length>evidenceLimit){
   const candidates=results.flatMap(r=>r.matches.map(m=>({entry:r,match:m})));
   const owner=(candidates.filter(x=>x.entry.kind==='search'&&x.match.excerpt.length>120)
    .sort((a,b)=>b.match.excerpt.length-a.match.excerpt.length)[0])??
    candidates.filter(x=>x.entry.kind==='lines'&&x.match.excerpt.length>1200)
     .sort((a,b)=>b.match.excerpt.length-a.match.excerpt.length)[0];
   const largest=owner?.match;
   if(!largest){
    const owner=results.findLast(r=>r.matches.length);
    if(!owner)throw Error('Source-read metadata exceeds the evidence budget');
    owner.matches.pop();owner.limited=true;continue;
   }
   const floor=owner.entry.kind==='search'?120:1200;
   largest.excerpt=largest.excerpt.slice(0,Math.max(floor,largest.excerpt.length-200));
   largest.truncated=true;
   owner.entry.limited=true;
  }
 }
 return {schema:'reverse-read-evidence-v2',source_inventory_sha256:sha(JSON.stringify(inventory)),
  ...(revision?{evidence_char_limit:evidenceLimit}:{}),results};
}

function makeMatch(path,start,end,lines){
 const full=lines.slice(start-1,end).join('\n');
 return {path,line_start:start,line_end:end,excerpt:full,truncated:false};
}

export function verifySourceReads(evidence,inventory,projectRoot){
 const limit=evidence?.evidence_char_limit??MAX_EVIDENCE_CHARS;
 if(evidence?.schema!=='reverse-read-evidence-v2'||!Array.isArray(evidence.results)||
    ![MAX_EVIDENCE_CHARS,MAX_REVISION_CHARS].includes(limit)||
    evidence.results.length>MAX_REQUESTS||JSON.stringify(evidence.results).length>limit||
    evidence.source_inventory_sha256!==sha(JSON.stringify(inventory)))return false;
 try{
  const hashes={...inventory.source_hashes};
  for(const file of inventory.files??[])if(file.kind==='noncode'&&file.sha256)hashes[file.path]=file.sha256;
  for(const entry of evidence.results){
   if(entry.kind==='denied'){
    if(!entry.denied||!entry.request_sha256||entry.matches?.length)return false;
    continue;
   }
   if(!['lines','search'].includes(entry.kind)||!Array.isArray(entry.matches))return false;
   for(const match of entry.matches){
    if(!hashes[match.path]||!Number.isInteger(match.line_start)||
       !Number.isInteger(match.line_end)||match.line_start<1||match.line_end<match.line_start)return false;
    const raw=readFileSync(resolve(projectRoot,match.path));
    if(sha(raw)!==hashes[match.path])return false;
    const full=raw.toString('utf8').split(/\r?\n/).slice(match.line_start-1,match.line_end).join('\n');
    if(match.full_excerpt_sha256&&sha(full)!==match.full_excerpt_sha256)return false;
    if(match.source_sha256&&match.source_sha256!==hashes[match.path])return false;
    if(typeof match.excerpt!=='string'||!full.startsWith(match.excerpt)||(!match.truncated&&full!==match.excerpt))return false;
   }
  }
  return true;
 }catch{return false}
}

export function combineSourceReadRounds(initial,supplemental,inventory,projectRoot){
 if(!verifyReverseReadEvidence(initial,inventory,projectRoot)||!verifySourceReads(supplemental,inventory,projectRoot))
  throw Error('Source-read round invalid');
 const rounds=initial.schema==='reverse-read-evidence-v2'?[{kind:'initial',evidence:initial}]:initial.rounds;
 if((rounds[0].evidence.evidence_char_limit??MAX_EVIDENCE_CHARS)!==MAX_EVIDENCE_CHARS)
  throw Error('Initial source-read budget cannot be expanded during revision');
 if(rounds.length>=3)throw Error('Review revision evidence round limit reached');
 return {schema:'reverse-read-evidence-v3',source_inventory_sha256:sha(JSON.stringify(inventory)),
  rounds:[...rounds,{kind:'review_revision',evidence:supplemental}]};
}

export function verifyReverseReadEvidence(evidence,inventory,projectRoot){
 if(evidence?.schema==='reverse-read-evidence-v2')return verifySourceReads(evidence,inventory,projectRoot);
 return evidence?.schema==='reverse-read-evidence-v3'&&
  evidence.source_inventory_sha256===sha(JSON.stringify(inventory))&&
  Array.isArray(evidence.rounds)&&evidence.rounds.length>=2&&evidence.rounds.length<=3&&
  evidence.rounds[0]?.kind==='initial'&&evidence.rounds.slice(1).every(x=>x?.kind==='review_revision')&&
  (evidence.rounds[0].evidence.evidence_char_limit??MAX_EVIDENCE_CHARS)===MAX_EVIDENCE_CHARS&&
  evidence.rounds.every(x=>verifySourceReads(x.evidence,inventory,projectRoot));
}

export const sourceReadLimits={MAX_REQUESTS,MAX_EVIDENCE_CHARS,MAX_REVISION_CHARS};
