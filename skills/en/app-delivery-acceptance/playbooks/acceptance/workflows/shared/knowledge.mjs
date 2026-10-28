import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {locations,projectRoot,inside,requireCurrent} from './store.mjs';
import {digest,fingerprint} from './definitions.mjs';
import {validateStore} from './validation.mjs';

const links=text=>[...text.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)].map(m=>decodeURIComponent(m[1].trim().replace(/^<|>$/g,'')).split('#',1)[0]);
export function validateKnowledge(project,{stagedBase}={}){
  const root=projectRoot(project),base=stagedBase??inside(root,'.acceptance/knowledge'),inventory={};
  if(!stagedBase&&fs.existsSync(inside(root,'.acceptance/knowledge-publish.lock.d')))throw Error('Knowledge publication is active or uncertain; inspect its transaction before reading');
  function visit(directory){
    const index=inside(directory,'INDEX.md');
    if(!fs.existsSync(index)||!fs.statSync(index).isFile())throw Error('missing directory index: '+index);
    const text=fs.readFileSync(index,'utf8');
    for(const heading of ['职责','何时读取'])if(!new RegExp('^## '+heading+'\\s*\\n+[^#\\s]','m').test(text))throw Error('index needs a nonempty section: '+heading+' in '+index);
    const listed=new Set();
    for(const href of links(text)){
      if(!href||href.startsWith('https://')||href.startsWith('http://'))continue;
      if(href.startsWith('project:')){
        const target=inside(root,href.slice(8));
        if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw Error('broken project asset reference: '+href);
        inventory['project:'+path.relative(root,target)]=digest(target);continue;
      }
      const target=inside(directory,href);
      if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw Error('broken knowledge index link: '+href);
      const parts=href.split('/').filter(x=>x!=='.'&&x);
      if(parts.length>1&&(parts.length!==2||parts[1]!=='INDEX.md'))throw Error('link immediate files or child/INDEX.md; do not skip hierarchy: '+href);
      listed.add(parts[0]);
    }
    for(const name of fs.readdirSync(directory).sort()){
      if(['__pycache__','.DS_Store'].includes(name))continue;
      const file=inside(directory,name);
      if(name!=='INDEX.md'&&!listed.has(name))throw Error('unindexed knowledge entry: '+file);
      if(fs.statSync(file).isDirectory())visit(file);
      else if(fs.statSync(file).isFile())inventory[path.relative(base,file)]=digest(file);
    }
  }
  visit(base);return inventory;
}
export function readKnowledge(project,id,paths=[]){
  requireCurrent(project,id);
  const {root,local}=locations(project,id),state=validateStore(root,id),base=inside(root,'.acceptance/knowledge'),selected=new Set(['INDEX.md']);
  const parentIndexes=file=>{
    let parent=path.dirname(file);
    for(;;){selected.add(parent==='.'?'INDEX.md':parent+'/INDEX.md');if(parent==='.')break;parent=path.dirname(parent);}
  };
  for(const name of paths){
    if(!state.knowledge_inventory[name])throw Error('knowledge asset must be indexed: '+name);
    selected.add(name);
    if(name.startsWith('project:')){
      for(const indexed of Object.keys(state.knowledge_inventory).filter(n=>n==='INDEX.md'||n.endsWith('/INDEX.md'))){
        if(links(fs.readFileSync(inside(base,indexed),'utf8')).includes(name)){selected.add(indexed);parentIndexes(indexed);}
      }
    }else parentIndexes(name);
  }
  const ordered=[...selected].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b)),contents={},hashes={};
  for(const name of ordered){
    const file=name.startsWith('project:')?inside(root,name.slice(8)):inside(base,name);
    contents[name]=fs.readFileSync(file,'utf8');hashes[name]=digest(file);
  }
  const folder=inside(local,'knowledge-reads');fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const receipt=inside(folder,randomUUID().replaceAll('-','')+'.json');
  fs.writeFileSync(receipt,JSON.stringify({schema:'acceptance-knowledge-read-v1',acceptance_id:id,project_root:root,created_at:new Date().toISOString(),scope_sha256:state.scope.sha256,knowledge_sha256:fingerprint(state.knowledge_inventory),read_files:hashes},null,2)+'\n',{flag:'wx',mode:0o600});
  return {acceptance:{project_root:root,id,scope_sha256:state.scope.sha256,knowledge_receipt:receipt},contents};
}
