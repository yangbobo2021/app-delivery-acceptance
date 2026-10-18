import {acceptanceGuard,knowledgeContext} from '../../acceptance-guard.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {splitDiffEntries} from './chunks.mjs';
import {runSingleAgent} from './single-agent.mjs';
import {freezeContract} from './contracts.mjs';
const root=dirname(fileURLToPath(import.meta.url)),[requestArg,outArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume');
if(!requestArg||!outArg||flags.some(x=>x!=='--resume'))
 throw Error('usage: node run.mjs request.json output-dir [--resume]');
const requestPath=resolve(requestArg),folder=resolve(outArg),request=JSON.parse(readFileSync(requestPath,'utf8'));
const acceptanceBinding=acceptanceGuard(request,[folder]);
const acceptanceKnowledge=knowledgeContext(acceptanceBinding);
if(existsSync(folder)&&!resume)throw Error('Output exists; preserve previous reverse analysis');
if(!existsSync(folder)&&resume)throw Error('Resume output missing');
if(resume&&!readFileSync(join(folder,'request.frozen.json')).equals(readFileSync(requestPath)))throw Error('Reverse resume request changed');
const cwd=resolve(request.project_root);
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:2_000_000}).trim();
const base=git('rev-parse',request.base_revision),head=git('rev-parse',request.head_revision);
if(head!==git('rev-parse','HEAD'))throw Error('HEAD/head binding invalid');
if(!Array.isArray(request.requirements?.items)||!Array.isArray(request.contract_files)||
   !Array.isArray(request.source_paths)||
   (request.context_files!==undefined&&!Array.isArray(request.context_files)))throw Error('Requirements, contract_files and optional context_files required');
const effectiveBase=git('merge-base',base,head);
const paths=git('diff','--name-only',effectiveBase,head).split('\n').filter(Boolean);
let inventory=null;
if(Array.isArray(request.source_paths)){
 mkdirSync(folder,{recursive:true});
 const script=resolve(root,'../../../scripts/v3/change_inventory.py');
 const inventoryPath=join(folder,'inventory.json');
 execFileSync('python3',[script,requestPath,inventoryPath],{cwd,encoding:'utf8'});
 inventory=JSON.parse(readFileSync(inventoryPath,'utf8'));
 if(inventory.head_revision!==head||inventory.unclassified_paths.length)throw Error('PR inventory has stale head or unclassified changes: '+inventory.unclassified_paths.join(', '));
 if(inventory.files.some(x=>x.kind==='source'&&!x.sha256))throw Error('Deleted product source needs deletion-aware reverse analysis; PR-wide analysis cannot silently omit it');
 if(request.selected_paths&&JSON.stringify([...request.selected_paths].sort())!==JSON.stringify([...inventory.changed_source_paths].sort()))throw Error('PR reverse analysis must include every changed source path');
}
const chosen=inventory?.changed_source_paths??request.selected_paths??paths;
if(!Array.isArray(chosen)||!chosen.length||new Set(chosen).size!==chosen.length||
   (!inventory&&chosen.some(x=>!paths.includes(x))))throw Error('Selected paths must be changed files');
const sha=b=>createHash('sha256').update(b).digest('hex');
const evidencePath=p=>{const target=resolve(cwd,p);if(!target.startsWith(cwd+'/')||!existsSync(target))throw Error('Evidence file missing/outside project: '+p);return target};
const diffEntries=chosen.map(path=>{
 const file=inventory?.files.find(x=>x.path===path);
 if(file?.repo_root){
  const link=inventory.gitlinks.find(x=>x.path===file.repo_root),inner=file.repo_relative_path;
  if(!link)throw Error('Changed submodule file has no frozen gitlink: '+path);
  const patch=execFileSync('git',['diff','--no-ext-diff','--unified=3',link.base_revision,link.head_revision,'--',inner],
   {cwd:resolve(cwd,link.path),encoding:'utf8',maxBuffer:20_000_000});
  const prefixed=patch.split('\n').map(line=>{
   if(line.startsWith('diff --git a/'))return line.replace('diff --git a/','diff --git a/'+link.path+'/').replace(' b/',' b/'+link.path+'/');
   if(line.startsWith('--- a/'))return line.replace('--- a/','--- a/'+link.path+'/');
   if(line.startsWith('+++ b/'))return line.replace('+++ b/','+++ b/'+link.path+'/');
   return line;
  }).join('\n');
  return {path,patch:prefixed};
 }
 return {path,patch:execFileSync('git',['diff','--no-ext-diff','--unified=3',effectiveBase,head,'--',path],
  {cwd,encoding:'utf8',maxBuffer:20_000_000})};
});
const diff=diffEntries.map(x=>x.patch).join('');
const chunks=splitDiffEntries(diffEntries,48000);
const changed_files=chosen.map(path=>({path,sha256:sha(readFileSync(evidencePath(path)))}));
const contract_files=request.contract_files.map(item=>freezeContract(item,cwd));
const context_files=(request.context_files??[]).map(path=>({path,sha256:sha(readFileSync(evidencePath(path)))}));
const change={base_revision:effectiveBase,head_revision:head,selected_paths:chosen,changed_files,contract_files,context_files,diff,diff_sha256:sha(diff),
 diff_chunks:chunks.map(x=>({id:x.id,paths:x.paths,sha256:x.sha256,characters:x.text.length})),
 ...(inventory?{inventory,inventory_sha256:sha(JSON.stringify(inventory))}:{})};
mkdirSync(folder,{recursive:true});
if(!resume)copyFileSync(requestPath,join(folder,'request.frozen.json'));
const frozenChange=JSON.stringify(change,null,2)+'\n';
if(resume){
 if(sha(readFileSync(join(folder,'request.frozen.json')))!==sha(readFileSync(requestPath))||
    readFileSync(join(folder,'change.json'),'utf8')!==frozenChange)throw Error('Reverse resume binding changed');
}else writeFileSync(join(folder,'change.json'),frozenChange);
mkdirSync(join(folder,'diff-chunks'),{recursive:true});
for(const chunk of chunks){
 const path=join(folder,'diff-chunks',chunk.id+'.patch');
 if(resume){if(readFileSync(path,'utf8')!==chunk.text)throw Error('Frozen diff chunk changed: '+chunk.id)}
 else writeFileSync(path,chunk.text);
}
if(!inventory)throw Error('Single-Agent reverse requires a complete classified source inventory');
const state=await runSingleAgent({folder,cwd,root,request,change,inventory,resume,acceptanceKnowledge});
process.exitCode=state==='completed'?0:2;
