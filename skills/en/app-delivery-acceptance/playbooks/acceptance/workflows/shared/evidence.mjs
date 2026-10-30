import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import {inside,read,atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';
import {freezeCoverage} from './coverage-execution.mjs';

function selected(root,relative){
  const file=inside(root,relative);if(!fs.existsSync(file))throw Error('Frozen evidence missing: '+file);return file;
}
function walk(file){
  const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Evidence cannot use symlinks: '+file);
  if(stat.isFile())return [file];if(!stat.isDirectory())throw Error('Unsupported evidence file type: '+file);
  return fs.readdirSync(file).sort().flatMap(name=>walk(inside(file,name)));
}
export function freezeEvidence(config,answer,executionDirectory,output,{tag=''}={}){
  const receiptFile=path.join(executionDirectory,'execution.json'),log=path.join(executionDirectory,'execution.log'),receipt=read(receiptFile);
  if(digest(log)!==receipt.log_sha256)throw Error('Execution log changed before evidence capture');
  const coverage=freezeCoverage(config.coverage,executionDirectory,receiptFile,path.join(output,'coverage'+tag+'-report')),
    roots=[{file:log,primary:true},{file:receiptFile,primary:true},...coverage.evidence_paths.map(file=>({file,primary:true}))];
  for(const relative of config.evidence_execution_relative_paths??[])if(relative==='.'||relative==='')throw Error('Execution evidence selection must name a specific output');else roots.push({file:selected(executionDirectory,relative)});
  for(const key of config.evidence_env_dir_keys??[]){const file=receipt.env_changes[key];if(file)roots.push({file});}
  if(config.evidence_log_prefix){
    const lines=fs.readFileSync(log,'utf8').split('\n').filter(line=>line.includes(config.evidence_log_prefix));
    if(!lines.length)throw Error('Frozen log lacks configured evidence location prefix');roots.push({file:lines.at(-1).split(config.evidence_log_prefix).slice(1).join(config.evidence_log_prefix).trim()});
  }
  const started=Date.parse(receipt.start_utc);
  for(const file of answer.evidence_paths??[])if(fs.existsSync(file)&&!fs.lstatSync(file).isSymbolicLink()&&fs.statSync(file).isFile()&&fs.statSync(file).mtimeMs>=started)roots.push({file});
  const allowed=[output,...(config.evidence_roots??[])].map(file=>fs.realpathSync(file)),withinAllowed=file=>allowed.some(root=>file===root||file.startsWith(root+path.sep));
  const destination=path.join(output,'frozen-evidence'+tag),manifestFile=path.join(output,'frozen-evidence'+tag+'.json');
  if(fs.existsSync(destination)||fs.existsSync(manifestFile))throw Error('Frozen evidence output already exists; inspect completed receipt instead of overwriting');
  const match=config.evidence_globs?.length?picomatch(config.evidence_globs,{dot:true}):()=>true,exclude=config.evidence_exclude_globs?.length?picomatch(config.evidence_exclude_globs,{dot:true}):()=>false,plan=[];let total=0;
  for(const [index,item]of roots.entries()){
    const root=path.resolve(item.file),canonical=fs.realpathSync(root);
    // Project tool native files are already profile/receipt bound. Other paths
    // must be in explicitly frozen output roots, not arbitrary files in logs.
    if(!item.primary&&!withinAllowed(canonical))throw Error('Evidence is outside the explicitly selected output roots: '+root);
    if(root!==canonical&&!item.primary)throw Error('Evidence root uses a symlink or unnormalized path: '+root);
    const stat=fs.lstatSync(root);if(stat.isSymbolicLink())throw Error('Evidence root cannot be a symlink');
    const selections=item.primary||stat.isFile()?['.']:(config.evidence_relative_paths??['.']);
    for(const relative of selections){
      const source=relative==='.'?root:selected(root,relative);
      for(const file of walk(source)){
        const relativeFile=stat.isFile()?path.basename(file):path.relative(root,file);
        const matchPath=path.relative(source,file)||path.basename(file);
        if(!item.primary&&(!match(matchPath)||exclude(matchPath)))continue;
        total+=fs.statSync(file).size;if(total>(config.evidence_max_bytes??20000000))throw Error('Selected evidence exceeds configured byte limit');
        plan.push({source:file,path:inside(destination,index+'/'+relativeFile),sha256:digest(file)});
      }
    }
  }
  if(!plan.length)throw Error('No frozen raw evidence selected');
  for(const item of plan){fs.mkdirSync(path.dirname(item.path),{recursive:true});fs.copyFileSync(item.source,item.path,fs.constants.COPYFILE_EXCL);if(digest(item.path)!==item.sha256||digest(item.source)!==item.sha256)throw Error('Evidence changed while freezing: '+item.source);}
  const manifest={schema:'frozen-scene-evidence-v1',files:plan,source_execution_sha256:digest(receiptFile),coverage_path:coverage.path,selection:{include_globs:config.evidence_globs??[],exclude_globs:config.evidence_exclude_globs??[],scope_note:config.scope_note??''}};atomicJson(manifestFile,manifest);
  return {manifest:manifestFile,paths:plan.map(item=>item.path),file_count:plan.length,bytes:total,coverage_path:coverage.path};
}
