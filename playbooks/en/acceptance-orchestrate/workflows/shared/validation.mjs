import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,ownedAbsolute,requireCurrent} from './store.mjs';
import {digest,fingerprint,object,validateCatalog,loadBinding} from './definitions.mjs';
import {validateKnowledge} from './knowledge.mjs';

function list(folder,match){return fs.existsSync(folder)?fs.readdirSync(folder).filter(match).sort().map(name=>inside(folder,name)):[];}
function pendingScope(root,shared,id){
  const file=inside(shared,'creation.json');if(!fs.existsSync(file))return false;
  const value=read(file);
  return value.schema==='acceptance-creation-v1'&&value.acceptance_id===id&&value.mode==='create_only'&&value.stop_reason==='created_without_scope'
    &&fs.statSync(inside(root,'.acceptance-local/'+id)).isDirectory()&&!fs.existsSync(inside(shared,'scope.json'))&&!fs.existsSync(inside(shared,'scenarios.json'))&&!list(inside(shared,'records'),n=>/^scope-.*\.json$/.test(n)).length;
}
export function validateStore(project,id,{checkKnowledge=true,requireScope=true}={}){
  const {root,shared,local}=locations(project,id),manifest=read(inside(shared,'manifest.json'));
  if(manifest.schema!=='acceptance-manifest-v1'||manifest.acceptance_id!==id||!manifest.owner||!manifest.project_id)throw Error('invalid acceptance identity manifest');
  if(!/^\/?\.acceptance-local\/\s*$/m.test(fs.readFileSync(inside(root,'.gitignore'),'utf8')))throw Error('.gitignore must contain a root .acceptance-local/ directory rule');
  const top=spawnSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'});
  if(top.status===0){
    const ignored=spawnSync('git',['check-ignore','--no-index','--',inside(local,'acceptance-guard-probe')],{cwd:root}),tracked=spawnSync('git',['ls-files','-z','--','.acceptance-local'],{cwd:root,encoding:'utf8'});
    if(ignored.status!==0||tracked.status!==0||tracked.stdout)throw Error('.acceptance-local must actually be Git-ignored and contain no tracked files');
  }
  const records=inside(shared,'records'),scopes=list(records,n=>/^scope-.*\.json$/.test(n));let previous=null;
  if(!scopes.length&&(requireScope||!pendingScope(root,shared,id)))throw Error('acceptance has no scope snapshot; define the real scope before dependent stages');
  for(const [index,file] of scopes.entries()){
    const item=read(file),version=index+1;
    if(path.basename(file)!=='scope-'+String(version).padStart(4,'0')+'.json'||item.version!==version||item.acceptance_id!==id||item.previous_sha256!==previous||!object(item.scope)||!item.basis)throw Error('invalid scope history: '+file);
    previous=digest(file);
  }
  const scope=scopes.length?read(inside(shared,'scope.json')):null;
  if(scopes.length&&!equal(scope,{version:scopes.length,path:'records/'+path.basename(scopes.at(-1)),sha256:previous}))throw Error('scope pointer does not match immutable scope history');
  for(const folder of list(records,()=>true)){
    if(!fs.statSync(folder).isDirectory())continue;
    const file=inside(folder,'record.json');if(!fs.existsSync(file))continue;
    const record=read(file);
    if(record.schema!=='acceptance-evidence-record-v1'||record.acceptance_id!==id||!object(record.files)||!Object.keys(record.files).length)throw Error('invalid archived evidence record');
    for(const [name,expected]of Object.entries(record.files)){
      const artifact=inside(folder,name);
      if(!fs.existsSync(artifact)||!fs.statSync(artifact).isFile()||digest(artifact)!==expected)throw Error('archived evidence changed or missing: '+artifact);
    }
  }
  const indexPath=inside(shared,'evidence-index.json');
  if(fs.existsSync(indexPath)){
    const index=read(indexPath);
    if(index.schema!=='acceptance-evidence-index-v1'||index.acceptance_id!==id)throw Error('invalid project evidence index');
    for(const [hash,item]of Object.entries(index.artifacts??{})){
      if(!/^[0-9a-f]{64}$/.test(hash)||item.sha256!==hash)throw Error('invalid artifact identity');
      const separator=item.storage?.indexOf(':'),kind=item.storage?.slice(0,separator),name=item.storage?.slice(separator+1);
      if(!['local','shared'].includes(kind))throw Error('invalid artifact storage');inside(kind==='local'?local:shared,name);
    }
  }
  const tests=inside(shared,'tests.json');
  if(fs.existsSync(tests))for(const item of read(tests).items??[]){
    const file=inside(root,item.path);
    if(['.acceptance','.acceptance-local'].includes(path.sep === '\\' ? path.relative(root,file).split(path.sep)[0].replace(/[. ]+$/,'').toLowerCase() : path.relative(root,file).split(path.sep)[0])||!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('formal tests must belong to the existing project test tree');
    if(!item.command?.length||!item.scenario_ids?.length)throw Error('formal test mapping needs command and stable scene IDs');
  }
  const catalogPath=inside(shared,'scenarios.json');
  if(fs.existsSync(catalogPath)){
    const catalog=validateCatalog(read(catalogPath)),histories=list(records,n=>/^catalog-.*\.json$/.test(n)).map(file=>({file,value:read(file)})),byHash=new Map(histories.map(({file,value})=>[digest(file),value]));
    for(const {file,value}of histories)if(value.schema==='acceptance-catalog-v2'){
      validateCatalog(value);
      if(value.definition_record!==path.relative(shared,file))throw Error('definition record identity changed');
      if(value.previous_catalog_sha256&&!byHash.has(value.previous_catalog_sha256))throw Error('frozen definition history changed or missing');
      if(value.definition_version!==(byHash.get(value.previous_catalog_sha256)?.definition_version??0)+1)throw Error('invalid frozen definition version chain');
    }
    const latest=histories.reduce((a,b)=>!a||String(b.value.updated_at??'')>String(a.value.updated_at??'')?b:a,null);
    if(catalog.acceptance_id!==id||!latest||!equal(catalog,latest.value))throw Error('scenario catalog does not match its latest frozen history');
  }
  const inventory=checkKnowledge?validateKnowledge(root):{};
  return {manifest,scope,knowledge_inventory:inventory,knowledge_sha256:fingerprint(inventory)};
}
export function guard(config,outputs=[],env=process.env){
  const binding=config.acceptance;if(!object(binding))throw Error('acceptance binding required; read current knowledge before starting');
  const {root,local}=locations(binding.project_root,binding.id);requireCurrent(root,binding.id);
  const state=validateStore(root,binding.id);
  if(binding.scope_sha256!==state.scope.sha256)throw Error('scope changed: keep acceptance ID, create new dependent frozen attempts');
  if(config.definitions)loadBinding(config);
  const file=ownedAbsolute(inside(local,'knowledge-reads'),env.ACCEPTANCE_KNOWLEDGE_RECEIPT||binding.knowledge_receipt),receipt=read(file);
  if(receipt.schema!=='acceptance-knowledge-read-v1'||receipt.project_root!==root||receipt.acceptance_id!==binding.id||receipt.scope_sha256!==binding.scope_sha256||receipt.knowledge_sha256!==state.knowledge_sha256||!receipt.read_files?.['INDEX.md'])throw Error('knowledge changed or was not read; read current layered indexes before continuing');
  for(const [name,expected]of Object.entries(receipt.read_files))if(state.knowledge_inventory[name]!==expected)throw Error('knowledge read receipt changed');
  const source=config.source_checkout||config.project_root||config.project?.root;
  if(source){
    const canonical=fs.realpathSync(source);
    if(canonical!==root){
      if(canonical.startsWith(root+path.sep)||path.resolve(source).startsWith(root+path.sep))ownedAbsolute(root,path.resolve(source));
      else{
        const common=where=>{const result=spawnSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:where,encoding:'utf8'});if(result.status!==0)throw Error('source checkout belongs to another project');return fs.realpathSync(result.stdout.trim());};
        if(common(source)!==common(root))throw Error('source checkout belongs to another project');
      }
    }
  }
  for(const output of outputs){const base=inside(local,'workflows'),target=ownedAbsolute(base,output);if(target===base)throw Error('workflow output must be .acceptance-local/<AT-ID>/workflows/<attempt>');}
  for(const name of [...(config.test_roots??[]),...(config.write_roots??[]),...(config.allowed_test_roots??[])]){
    const target=inside(root,name),relative=path.relative(root,target);
    if(!relative||['.acceptance','.acceptance-local'].includes(path.sep === '\\' ? relative.split(path.sep)[0].replace(/[. ]+$/,'').toLowerCase() : relative.split(path.sep)[0]))throw Error('test roots must use the existing project test tree, not acceptance storage');
  }
  return {...binding,knowledge_receipt:file};
}
