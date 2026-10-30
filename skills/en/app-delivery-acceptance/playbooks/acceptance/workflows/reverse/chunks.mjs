import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');

// Keep every changed byte in exactly one batch. A large file is divided at
// hunk boundaries; a single oversized hunk is divided by line as a last resort.
export function splitDiffEntries(entries,limit=30000){
 if(!Number.isInteger(limit)||limit<1000)throw Error('Invalid diff batch limit');
 const units=[];
 for(const entry of entries){
  if(!entry.path||typeof entry.patch!=='string')throw Error('Invalid diff entry');
  if(entry.patch.length<=limit){units.push(entry);continue}
  const marker='\n@@ ',positions=[];let at=entry.patch.indexOf(marker);
  while(at>=0){positions.push(at+1);at=entry.patch.indexOf(marker,at+marker.length)}
  if(!positions.length){for(let i=0;i<entry.patch.length;i+=limit)units.push({path:entry.path,patch:entry.patch.slice(i,i+limit)});continue}
  let pieces=[entry.patch.slice(0,positions[0])];
  for(let i=0;i<positions.length;i++)pieces.push(entry.patch.slice(positions[i],positions[i+1]??entry.patch.length));
  for(const piece of pieces){
   if(piece.length<=limit){units.push({path:entry.path,patch:piece});continue}
   const lines=piece.match(/[^\n]*\n|[^\n]+$/g)??[];let buffer='';
   for(const line of lines){
    if(buffer&&buffer.length+line.length>limit){units.push({path:entry.path,patch:buffer});buffer=''}
    for(let i=0;i<line.length;i+=limit){
     const part=line.slice(i,i+limit);
     if(buffer&&buffer.length+part.length>limit){units.push({path:entry.path,patch:buffer});buffer=''}
     buffer+=part;
    }
   }
   if(buffer)units.push({path:entry.path,patch:buffer});
  }
 }
 const chunks=[];let parts=[],size=0;
 const flush=()=>{if(!parts.length)return;const text=parts.map(x=>x.patch).join('');chunks.push({id:`chunk-${chunks.length+1}`,paths:[...new Set(parts.map(x=>x.path))],text,sha256:sha(text)});parts=[];size=0};
 for(const unit of units){
  if(parts.length&&size+unit.patch.length>limit)flush();
  parts.push(unit);size+=unit.patch.length;
 }
 flush();
 const reconstructed=chunks.map(x=>x.text).join('');
 if(reconstructed!==entries.map(x=>x.patch).join(''))throw Error('Diff chunking lost or reordered bytes');
 return chunks;
}
