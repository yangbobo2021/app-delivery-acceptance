import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

const skip=new Set(['node_modules','.git','.runtime-install.lock.d','.DS_Store','.spex-runtime-source.json']);
export function assertReleaseEntry(name){
 if(['.npmrc','.netrc','.git-credentials','.env'].includes(name)||name.startsWith('.env.'))throw Error('Credential/config entry must not ship in a release: '+name);
}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function packageFiles(root){
 const files={};
 const walk=(dir,prefix='')=>{for(const name of fs.readdirSync(dir).sort()){
  if(skip.has(name))continue;assertReleaseEntry(name);const file=path.join(dir,name),relative=prefix+name,stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error('Runtime source contains a non-regular entry: '+relative);
  if(stat.isDirectory())walk(file,relative+'/');else files[relative]=hash(file);
 }};walk(root);return files;
}
const canonical=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
export function skillRuntimeRoot(skillRoot,{cacheBase=path.join(os.homedir(),'.cache','app-delivery-acceptance','spex')}={}){
 skillRoot=fs.realpathSync(skillRoot);const source=path.join(skillRoot,'playbooks/acceptance'),file=path.join(skillRoot,'SPEX-INSTALL.json');
 if(!fs.existsSync(file))return source;
 const marker=JSON.parse(fs.readFileSync(file));
 if(marker.schema!=='acceptance-spex-skill-v1'||marker.package_root!=='playbooks/acceptance'||!marker.package_files||typeof marker.package_files!=='object'||Array.isArray(marker.package_files))throw Error('Invalid SPEX Skill installation manifest');
 if(canonical(packageFiles(source))!==canonical(marker.package_files))throw Error('SPEX Skill package differs from its installation manifest');
 const fingerprint=createHash('sha256').update(canonical(marker.package_files)).digest('hex');
 if(!path.isAbsolute(cacheBase))throw Error('Absolute external Skill runtime cache required');
 if(path.resolve(cacheBase)===skillRoot||path.resolve(cacheBase).startsWith(skillRoot+path.sep))throw Error('Runtime cache must be outside the SPEX-managed Skill');
 fs.mkdirSync(cacheBase,{recursive:true,mode:0o700});cacheBase=fs.realpathSync(cacheBase);
 const root=path.join(cacheBase,fingerprint);
 if(root===skillRoot||root.startsWith(skillRoot+path.sep))throw Error('Runtime cache must be outside the SPEX-managed Skill');
 const validate=()=>{
  if(fs.lstatSync(root).isSymbolicLink()||!fs.statSync(root).isDirectory())throw Error('Runtime cache must be a regular directory');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'.spex-runtime-source.json')));
  if(receipt.fingerprint!==fingerprint||canonical(packageFiles(root))!==canonical(marker.package_files))throw Error('Cached Skill runtime source changed; preserve it for inspection');
 };
 if(fs.existsSync(root)){validate();return root;}
 const staging=path.join(cacheBase,'.staging-'+randomUUID());
 try{
  fs.cpSync(source,staging,{recursive:true,filter:file=>!path.relative(source,file).split(path.sep).some(name=>skip.has(name))});
  fs.writeFileSync(path.join(staging,'.spex-runtime-source.json'),JSON.stringify({schema:'acceptance-spex-runtime-source-v1',fingerprint,source_skill:skillRoot,package_version:marker.package_version})+'\n',{flag:'wx',mode:0o600});
  try{fs.renameSync(staging,root);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;validate();}
  validate();return root;
 }finally{if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true});}
}
