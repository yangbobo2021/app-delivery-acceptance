// Read-only path transport. Dedicated provider/Istanbul own every counter and summary.
// Frozen report bytes, embedded paths, timestamps and tool implementation stay intact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const config=process.env.ACCEPTANCE_EVIDENCE_MAP;
if(!config)throw Error('Explicit evidence map required');
const read=fs.readFileSync.bind(fs),readdir=fs.readdirSync.bind(fs);
const spec=JSON.parse(read(config,'utf8'));
if(spec.schema!=='acceptance-path-map-v1')throw Error('Unsupported evidence transport');
const root=path.dirname(path.resolve(config)),checked=new Set();
const resolveFile=p=>{
 if(typeof p!=='string')return p;
 const canonical=path.resolve(p),item=spec.files[canonical];
 if(item){
  const dest=path.resolve(root,item.path);
  if(!dest.startsWith(root+path.sep))throw Error('Evidence transport escapes import directory');
  if(!checked.has(dest)){
   const actual=crypto.createHash('sha256').update(read(dest)).digest('hex');
   if(actual!==item.sha256)throw Error('Relocated raw evidence changed');
   checked.add(dest);
  }
  return dest;
 }
 if((spec.legacy_roots||[]).some(base=>canonical===base||canonical.startsWith(base+path.sep)))
  throw Error('Unmapped legacy dependency; original directory fallback is forbidden: '+canonical);
 return p;
};
fs.readFileSync=(p,...args)=>read(resolveFile(p),...args);
fs.readdirSync=(p,...args)=>{
 const canonical=typeof p==='string'?path.resolve(p):p;
 if(spec.directories?.[canonical]){
  if(args.length&&args[0]?.withFileTypes)throw Error('Dirent transport is not supported');
  return [...spec.directories[canonical]];
 }
 resolveFile(p);return readdir(p,...args);
};
