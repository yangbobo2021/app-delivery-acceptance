import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {spawnSync} from 'node:child_process';
import {inside,read,atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';
import {cloneJson} from './json.mjs';
import {validateDiscovery} from './case-contract.mjs';
export const caseId='TC-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const marker=new RegExp('^\\s*(?:#|//|--|;|%|\'|/\\*|<!--|\\(\\*|REM)\\s*@case-id:\\s*('+caseId+')\\s*(?:\\*/|-->|\\*\\))?\\s*$');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const sourceLines=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])$/,'').split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
export function identitySource(root,name){
  if(typeof name!=='string'||!name||name.split('/').some(part=>['.git','.acceptance','.acceptance-local'].includes(part)))throw Error('case identity source outside test workspace');
  const file=inside(root,name);if(!fs.statSync(file).isFile())throw Error('case identity source missing: '+name);return file;
}
export function rebuildIdentityPatch(patch){
  if(typeof patch.before_base64!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(patch.before_base64))throw Error('identity patch preimage encoding invalid');
  const before=Buffer.from(patch.before_base64,'base64');if(hash(before)!==patch.before_sha256)throw Error('identity patch preimage changed');
  const bom=before.subarray(0,3).equals(Buffer.from([239,187,191]))?before.subarray(0,3):Buffer.alloc(0),raw=before.subarray(bom.length),lines=(raw.toString('latin1').match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)??[]).map(line=>Buffer.from(line,'latin1')),seen=new Set();
  for(const insertion of [...patch.insertions].sort((a,b)=>b.line-a.line)){
    const number=insertion.line,text=insertion.text;
    if(!Number.isSafeInteger(number)||number<1||number>lines.length||seen.has(number)||typeof text!=='string'||!marker.test(text.replace(/[\r\n]+$/,''))||sourceLines(Buffer.from(text)).length!==1)throw Error('invalid ID-only insertion');
    seen.add(number);lines.splice(number-1,0,Buffer.from(text));
  }
  const after=Buffer.concat([bom,...lines]);if(hash(after)!==patch.after_sha256)throw Error('identity patch contains non-ID edits');return after;
}
export function verifyIdentity(answer,root,{sceneId,acceptanceId,receiptHashes}={}){
  const ref=answer.case_identity;if(!ref||typeof ref!=='object')throw Error('case identity report missing');
  if(digest(ref.path)!==ref.sha256)throw Error('case identity report hash mismatch');
  const report=read(ref.path);
  if(digest(path.join(path.dirname(ref.path),'answer.agent.json'))!==report.raw_answer_sha256)throw Error('original Agent answer changed');
  if(report.schema!=='case-identities-v1'||report.status!=='finalized')throw Error('case identity finalization incomplete');
  if((sceneId!==undefined&&report.scene_id!==sceneId)||(acceptanceId!==undefined&&report.acceptance_id!==acceptanceId))throw Error('case identity scene/acceptance mismatch');
  if(!equal(report.cases,answer.case_descriptions??[]))throw Error('case identity selection changed');
  for(const item of report.cases){
    const src=item.source,file=identitySource(root,src.file),bytes=fs.readFileSync(file),lines=sourceLines(bytes),line=src.id_line;
    if(hash(bytes)!==src.file_sha256)throw Error('case identity source changed: '+src.file);
    if(![line,src.line_start,src.line_end].every(Number.isSafeInteger)||line<1||line!==src.line_start-1||src.line_start>src.line_end||src.line_end>lines.length)throw Error('case ID is not adjacent to its declaration');
    if(marker.exec(lines[line-1])?.[1]!==item.id)throw Error('case ID marker does not match declaration');
    if(receiptHashes&&receiptHashes[src.file]!==src.file_sha256)throw Error('execution did not bind selected case ID source');
  }
  for(const [name,patch]of Object.entries(report.patches)){
    const file=identitySource(root,name);if((fs.statSync(file).mode&0o777)!==patch.mode||!rebuildIdentityPatch(patch).equals(fs.readFileSync(file)))throw Error('source differs from ID-only patch');
  }
  return report;
}
const commentTemplates=new Set(['# {id}','// {id}','-- {id}','; {id}','% {id}',"' {id}",'/* {id} */','<!-- {id} -->','(* {id} *)','REM {id}']);
const keptLines=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes).match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)??[];
export function findCaseMarkers(catalog,selected=[]){
  const root=fs.realpathSync(catalog.project_root),found=new Map(),roots=catalog.write_roots??catalog.test_roots??[];
  for(const prefix of ['',...(catalog.components??[]).map(c=>c.path)]){
    const result=spawnSync('git',['grep','--untracked','-I','-l','-z','-e','@case-id:'],{cwd:inside(root,prefix),encoding:'utf8',maxBuffer:32*1024*1024});
    if(![0,1].includes(result.status))throw Error('Cannot check existing case ID conflicts: '+result.stderr);
    for(const name of result.stdout.split('\0').filter(Boolean)){
      const key=prefix?prefix+'/'+name:name;if(key.split('/').some(p=>['.acceptance','.acceptance-local','.git'].includes(p)))continue;
      if(roots.length&&!roots.some(r=>key===r||key.startsWith(r.replace(/\/$/,'')+'/')))continue;
      const lines=sourceLines(fs.readFileSync(identitySource(root,key)));
      for(const [index,line]of lines.entries()){
        const match=marker.exec(line);if(selected.includes(key)&&!match&&/^\s*(?:#|\/\/|--|;|%|'|\/\*|<!--|\(\*|REM)\s*@case-id:/.test(line))throw Error('malformed case ID marker: '+key+':'+(index+1));
        if(match){const location=[key,index+1];if(found.has(match[1])&&!equal(found.get(match[1]),location))throw Error('duplicate case ID: '+match[1]);found.set(match[1],location);}
      }
    }
  }
  return found;
}
export function preflightIdentity(catalog,answer){
  const root=fs.realpathSync(catalog.project_root),cases=answer.case_descriptions??[],roots=catalog.write_roots??catalog.test_roots??[],seen=new Set();findCaseMarkers(catalog,cases.map(c=>c.source?.file));
  for(const item of cases){
    const src=item.source,name=src.file,file=identitySource(root,name);
    if(!answer.test_files?.includes(name)||(roots.length&&!roots.some(r=>name===r||name.startsWith(r.replace(/\/$/,'')+'/'))))throw Error('case identity annotation outside selected test roots: '+name);
    const lines=sourceLines(fs.readFileSync(file)),start=src.line_start,end=src.line_end;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||start>end||end>lines.length)throw Error('case identity declaration range invalid: '+name);
    const body=lines.slice(start-1,end).join('\n');if(!src.title||(!body.includes(src.title)&&![name,path.basename(file)].includes(src.title)))throw Error('case identity declaration title not found: '+name);
    if(lines.slice(start-1,end).some(line=>marker.test(line)))throw Error('source range includes another ID: start after its marker: '+name);
    if(seen.has(item.id))throw Error('duplicate local case reference');seen.add(item.id);
    if(!(start>1&&marker.test(lines[start-2]))){if(start===1&&lines[0].startsWith('#!'))throw Error('preserve script shebang: '+name);if(!commentTemplates.has(src.id_comment))throw Error('source.id_comment needs a safe template containing {id} for unmarked declaration '+name);}
  }
}
export function finalizeIdentities(catalog,input,output){
  output=fs.realpathSync(output);const root=fs.realpathSync(catalog.project_root),answerFile=path.join(output,'answer.json'),rawBytes=fs.readFileSync(answerFile),raw=read(answerFile),at=input.acceptance.id,scene=input.scene.id;
  if(raw.case_identity)return verifyIdentity(raw,root,{sceneId:scene,acceptanceId:at});
  if(fs.existsSync(path.join(output,'case-identities.pending.json'))||fs.existsSync(path.join(output,'answer.agent.json')))throw Error('interrupted case identity finalization: recover recorded preimages before retry');
  preflightIdentity(catalog,raw);
  const registryFile=inside(fs.realpathSync(input.acceptance.project_root),'.acceptance/case-identities.json'),registry=fs.existsSync(registryFile)?read(registryFile):{schema:'project-case-identities-v1',cases:{}};
  if(registry.schema!=='project-case-identities-v1')throw Error('unsupported project case identity registry');
  const existing=findCaseMarkers(catalog,(raw.case_descriptions??[]).map(c=>c.source?.file));let answer=cloneJson(raw),searchCheckpoint;
  const checkpointFile=path.join(output,'case-reuse-discovery.json'),reuseFile=path.join(output,'case-reuse.json');
  if(input.case_strategy==='implement'&&answer.case_discovery&&fs.existsSync(checkpointFile)&&fs.existsSync(reuseFile)){
    const checkpoint=read(checkpointFile),reuse=read(reuseFile);
    if(checkpoint.schema==='case-reuse-checkpoint-v1'&&reuse.status==='available'&&reuse.binding?.answer_sha256===hash(rawBytes)&&equal(checkpoint.binding,{input_sha256:reuse.binding.input_sha256,catalog_sha256:reuse.binding.catalog_sha256})&&equal(answer.case_discovery,checkpoint.discovery?.case_discovery)){
      searchCheckpoint={path:checkpointFile,sha256:digest(checkpointFile),scope:'preparation_search_only',original_field:'case_discovery'};delete answer.case_discovery;
    }
  }
  if(!Object.hasOwn(answer,'case_descriptions')&&['blocked','needs_contract'].includes(answer.status))answer.case_descriptions=[];
  const cases=answer.case_descriptions;
  if(!Array.isArray(cases)||(!cases.length&&['passed_local','host_ready','product_failure'].includes(answer.status)))throw Error('actual associated cases must be described before ID assignment');
  const before=new Map(),plans={},mappings={},used=new Set(),records=[],patches={};
  for(const item of cases){
    const old=item.id,src=item.source,name=src.file,file=identitySource(root,name);if(!answer.test_files.includes(name))throw Error('case identity source is not selected test file');
    const data=before.get(name)??fs.readFileSync(file);before.set(name,data);const lines=keptLines(data),start=src.line_start,end=src.line_end,body=lines.slice(start-1,end).join(''),title=src.title;
    if(Object.hasOwn(mappings,old)||typeof old!=='string'||!old)throw Error('duplicate or missing local case reference');
    const match=start>1?marker.exec(lines[start-2].replace(/[\r\n]+$/,'')):null,logical=start-lines.slice(0,start-1).filter(line=>marker.test(line.replace(/[\r\n]+$/,''))).length,fp=hash(Buffer.from(name+'\0'+logical+'\0'+title+'\0'+body));
    const matches=Object.entries(registry.cases).filter(([,record])=>record.fingerprints?.includes(fp)).map(([id])=>id);if(matches.length>1)throw Error('ambiguous prior case identity');
    let id;
    if(match){id=match[1];if(matches.length&&matches[0]!==id)throw Error('source marker conflicts with recorded case identity');}
    else{
      id=matches[0]??'TC-'+randomUUID();if(existing.has(id))throw Error('recorded case ID already exists at another declaration');
      const indent=/^[ \t]*/.exec(lines[start-1])[0],newline=data.includes(Buffer.from('\r\n'))?'\r\n':'\n',text=indent+src.id_comment.replace('{id}','@case-id: '+id)+newline;(plans[name]??=[]).push({line:start,text});
    }
    if(used.has(id))throw Error('same test declaration described twice; merge its contributions');used.add(id);mappings[old]=id;item.id=id;records.push({id,fp,name,title});
  }
  for(const [name,insertions]of Object.entries(plans)){
    const data=before.get(name),bom=data.subarray(0,3).equals(Buffer.from([239,187,191]))?data.subarray(0,3):Buffer.alloc(0),lines=(data.subarray(bom.length).toString('latin1').match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)??[]).map(line=>Buffer.from(line,'latin1'));
    for(const item of [...insertions].sort((a,b)=>b.line-a.line))lines.splice(item.line-1,0,Buffer.from(item.text));
    const patch={before_base64:data.toString('base64'),before_sha256:hash(data),insertions,mode:fs.statSync(identitySource(root,name)).mode&0o777,after_sha256:hash(Buffer.concat([bom,...lines]))};rebuildIdentityPatch(patch);patches[name]=patch;
  }
  function relocate(loc){
    const name=loc.file;if(!before.has(name)||!Number.isSafeInteger(loc.line_start))return;
    const start=loc.line_start,end=loc.line_end,insertions=plans[name]??[];loc.line_start+=insertions.filter(i=>i.line<=start).length;loc.line_end+=insertions.filter(i=>i.line<=end).length;loc.file_sha256=patches[name]?.after_sha256??hash(before.get(name));
    if(Object.hasOwn(loc,'quote')&&insertions.some(i=>start<i.line&&i.line<=end)){loc.quote_before_identity=loc.quote;loc.quote=sourceLines(rebuildIdentityPatch(patches[name])).slice(loc.line_start-1,loc.line_end).join('\n');}
  }
  for(const item of cases){relocate(item.source);item.source.id_line=item.source.line_start-1;}
  for(const evidence of answer.case_discovery?.evidence??[])relocate(evidence);
  for(const item of answer.case_discovery?.associations??[]){if(!mappings[item.case_id])throw Error('Unknown local association');item.case_id=mappings[item.case_id];}
  for(const item of answer.case_discovery?.obligations??[])item.case_ids=item.case_ids.map(id=>{if(!mappings[id])throw Error('Unknown local obligation case');return mappings[id];});
  for(const item of answer.case_reuse?.decisions??[]){if(!mappings[item.case_id])throw Error('Unknown reuse decision case');item.case_id=mappings[item.case_id];}
  const report={schema:'case-identities-v1',status:'finalized',acceptance_id:at,scene_id:scene,revision:catalog.revision,raw_answer_sha256:hash(rawBytes),cases,local_id_map:mappings,patches,...(searchCheckpoint?{search_checkpoint:searchCheckpoint}:{}),execution_scope:'selected cases only; command receipts do not prove individual case execution'},reportFile=path.join(output,'case-identities.json');
  atomicJson(path.join(output,'case-identities.pending.json'),report);fs.writeFileSync(path.join(output,'answer.agent.json'),rawBytes,{flag:'wx'});
  try{
    for(const [name,patch]of Object.entries(patches))fs.writeFileSync(identitySource(root,name),rebuildIdentityPatch(patch));
    if(input.case_strategy==='existing_only'){answer=validateDiscovery(answer,input,root,null,{discoveryOnly:input.existing_case_mode==='discover_only'});report.cases=answer.case_descriptions;}
    atomicJson(reportFile,report);answer.case_identity={path:reportFile,sha256:digest(reportFile)};verifyIdentity(answer,root,{sceneId:scene,acceptanceId:at});
    for(const {id,fp,name,title}of records){const record=registry.cases[id]??={fingerprints:[],relationships:[]};if(!record.fingerprints.includes(fp))record.fingerprints.push(fp);const relation={acceptance_id:at,scene_id:scene,definitions:input.definitions??null,revision:catalog.revision,file:name,title,artifact_scope:'isolated_worktree',report:reportFile};if(!record.relationships.some(r=>equal(r,relation)))record.relationships.push(relation);}
    atomicJson(answerFile,answer);atomicJson(registryFile,registry);fs.unlinkSync(path.join(output,'case-identities.pending.json'));return report;
  }catch(error){for(const [name,data]of before)fs.writeFileSync(identitySource(root,name),data);atomicJson(answerFile,raw);throw error;}
}
