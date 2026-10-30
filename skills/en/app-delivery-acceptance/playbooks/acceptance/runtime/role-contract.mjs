import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';

export function rolePrompt(request){
 const {options={},attachments=[]}=request;
 const contract={role:request.role,working_directory:options.cwd,permissions:options.permissions,
  attachments:attachments.map(item=>item.path),output_schema:options.outputSchema??null};
 return 'This is one task in your assigned Playbook role. Follow the complete current task, not earlier task assumptions.\n'+
  'The working_directory below is a task convention, not a claim that the host changed its process cwd. Use absolute paths or explicitly cd there before commands.\n'+
  'Follow the permissions as task restrictions. deny means do not perform that capability, even if your tools allow it. A shellExecute deny also forbids shell read commands: use the supplied task context and return the requested structured decision.\n'+
  'Do not invoke Skills or start other workflows; the parent Playbook owns scheduling. Do not edit product files outside the task authorization. Preserve original outputs and evidence, and report missing tools or access instead of inventing results.\n'+
  'For each image attachment, use an actual image-viewing tool on its absolute path before drawing visual conclusions. If unavailable, report the limitation.\n'+
  (options.outputSchema?'Return only the complete requested JSON object. Do not wrap it in prose or scrape a JSON fragment.\n':'')+
  'Task execution contract:\n'+JSON.stringify(contract)+'\n\nCurrent task:\n'+request.prompt;
}

// Workflow-level check of repository bytes, not a sandbox or a host permission override.
// Record violations without undoing unknown effects. Evidence directories are host-owned.
export function readOnlyProjection(root,output){
 const files={};
 function add(file){
  const relative=path.relative(root,file);if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return;
  if(relative.split(path.sep).some(x=>['node_modules','.git','.acceptance-local','.venv','venv','__pycache__'].includes(x)))return;
  if(file===output||file.startsWith(output+path.sep))return;
  let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT'){files[relative]=null;return;}throw e;}
  if(stat.isSymbolicLink())files[relative]='link:'+fs.readlinkSync(file);
  else if(stat.isFile())files[relative]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 }
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','.acceptance-local','.venv','venv','__pycache__'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(file===output||file.startsWith(output+path.sep))continue;if(entry.isDirectory())walk(file);else add(file);}};walk(root);
 return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}

// Run the identical projection outside an embedding APP's event loop.
// Await worker exit before accepting bytes or cancellation; no role starts on a partial snapshot.
export async function readOnlyProjectionAsync(root,output,{signal}={}){
 signal?.throwIfAborted();
 return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./readonly-projection-worker.mjs',import.meta.url),{workerData:{root,output}});
  let value,received=false,failure;
  const abort=()=>{void worker.terminate();};
  worker.once('message',projection=>{value=projection;received=true;});
  worker.once('error',error=>{failure=error;});
  worker.once('exit',code=>{
   signal?.removeEventListener('abort',abort);
   if(signal?.aborted)return reject(signal.reason??Error('Read-only projection cancelled'));
   if(failure)return reject(failure);
   if(code!==0||!received)return reject(Error('Read-only projection worker exited without a complete snapshot: '+code));
   resolve(value);
  });
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
 });
}

export function roleContinuation(directory){
 const folder=path.join(directory,'official-player');
 if(!fs.existsSync(folder))return null;
 const calls=fs.readdirSync(folder).filter(n=>/^[a-f0-9-]+\.json$/.test(n)).map(n=>({file:path.join(folder,n),value:JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))})).sort((a,b)=>(a.value.invocation_sequence??0)-(b.value.invocation_sequence??0)||a.value.started_at.localeCompare(b.value.started_at));
 const last=calls.at(-1);if(!last)return null;const file=last.file.replace(/\.json$/,'.result.json');
 if(!fs.existsSync(file))return null;const value=JSON.parse(fs.readFileSync(file,'utf8'));
 return value.status==='ok'&&typeof value.resumeToken==='string'&&value.resumeToken?value.resumeToken:null;
}
