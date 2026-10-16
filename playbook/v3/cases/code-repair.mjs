import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');

export function applyCaseCodeRepair({projectRoot,outputDir,attempt,catalog,selected,productSources,candidate}){
 if(!Array.isArray(candidate?.edits)||!candidate.edits.length||candidate.edits.length>4)
  throw Error('Repair must contain one to four explicit test-file edits');
 const allowed=new Map(selected.map(id=>{const item=catalog.find(x=>x.id===id);
  return [item?.test_file,item];}));
 const root=realpathSync(resolve(projectRoot)),prepared=[],seen=new Set();
 for(const edit of candidate.edits){
  const item=allowed.get(edit.test_file),path=resolve(root,edit.test_file);
  if(!item||item.kind!=='automated'||seen.has(edit.test_file)||!path.startsWith(root+'/')||
     productSources.includes(edit.test_file))throw Error('Repair may edit only a selected declared test file');
  let ancestor=dirname(path);
  while(!existsSync(ancestor)&&ancestor!==root)ancestor=dirname(ancestor);
  const physicalParent=realpathSync(ancestor);
  if((physicalParent!==root&&!physicalParent.startsWith(root+'/'))||physicalParent!==ancestor||
     existsSync(path)&&realpathSync(path)!==path)
   throw Error('Selected test path contains a symlink or resolves outside the isolated checkout');
  seen.add(edit.test_file);
  const exists=existsSync(path),old=exists?readFileSync(path,'utf8'):null;
  if(edit.expected_sha256!==(old===null?null:sha(old)))throw Error('Test code changed before repair: '+edit.test_file);
  let updated;
  if(old===null){
   if(item.origin!=='new'||typeof edit.content!=='string')throw Error('Only a new catalog case may create a test file');
   updated=edit.content;
  }else{
   if(!Array.isArray(edit.replacements)||!edit.replacements.length||edit.replacements.length>12)
    throw Error('Existing test repair needs bounded exact replacements');
   updated=old;
   for(const pair of edit.replacements){
    if(typeof pair.old!=='string'||!pair.old||typeof pair.new!=='string')throw Error('Invalid replacement');
    const index=updated.indexOf(pair.old);
    if(index<0||updated.indexOf(pair.old,index+pair.old.length)>=0)throw Error('Replacement anchor missing or ambiguous');
    updated=updated.slice(0,index)+pair.new+updated.slice(index+pair.old.length);
   }
  }
  if(!updated.trim()||updated===old||item.selector&&!updated.includes(item.selector))
   throw Error('Repair is empty, unchanged, or loses the selected test: '+edit.test_file);
  prepared.push({path,relative:edit.test_file,old,updated,before_sha256:old===null?null:sha(old),after_sha256:sha(updated)});
 }
 const receiptPath=join(outputDir,`attempt-${attempt}`,'code-repair-receipt.json');
 const intentPath=join(outputDir,`attempt-${attempt}`,'code-repair-intent.json');
 if(existsSync(receiptPath))throw Error('Code repair already recorded for this attempt');
 if(existsSync(intentPath))throw Error('Unresolved prior code-repair intent requires inspection before retry');
 const receipt={schema:'case-code-repair-v1',attempt,files:prepared.map(({relative,before_sha256,after_sha256})=>
  ({path:relative,before_sha256,after_sha256}))};
 writeFileSync(intentPath,JSON.stringify(receipt,null,2)+'\n');
 for(const item of prepared){
  mkdirSync(dirname(item.path),{recursive:true});
  const temp=item.path+'.acceptance-repair.tmp';
  writeFileSync(temp,item.updated);renameSync(temp,item.path);
 }
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
 return receipt;
}
