import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as same} from 'node:util';
import {canonical,parseJson} from '../shared/json.mjs';
import {projectRoot,inside,atomicJson} from '../shared/store.mjs';
import {packageRoot} from '../../root.mjs';
export const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const fileHash=f=>digest(fs.readFileSync(f));
export const callKey=(workflow,input,text)=>digest(workflow+'\0'+(text??canonical(input)));
const stable=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id);
export function normalize(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Task delegation object required');
 const allowed=['project_root','task_id','request_id','message','context','source_checkout','source_files','budget_seconds','inspect'];
 if(Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Unknown orchestration request field');
 if(!stable(value.task_id)||!stable(value.request_id))throw Error('Stable task_id and request_id required');
 if(!value.inspect&&!(typeof value.message==='string'&&value.message.trim()))throw Error('Original user message/goal required');
 if(value.context!==undefined&&(!value.context||typeof value.context!=='object'||Array.isArray(value.context)))throw Error('context must be a JSON object');
 const budget=value.budget_seconds??3600;if(!Number.isSafeInteger(budget)||budget<1)throw Error('Positive finite budget_seconds required');
 return {...value,project_root:projectRoot(value.project_root),context:value.context??{},budget_seconds:budget};
}
export function taskLocation(input){return inside(input.project_root,'.acceptance-local/orchestration/'+input.task_id);}
export function ownerState(folder){const lock=path.join(folder,'active.lock.d'),file=path.join(lock,'owner.json');if(!fs.existsSync(lock))return null;let owner;try{owner=read(file);}catch{return{uncertain:true};}let alive=false;try{process.kill(owner.pid,0);alive=true;}catch{}return{...owner,alive,uncertain:!alive};}
export function openTask(input){
 const folder=taskLocation(input);fs.mkdirSync(folder,{recursive:true});
 const stateFile=path.join(folder,'state.json');let state=fs.existsSync(stateFile)?read(stateFile):{schema:'acceptance-orchestration-task-v1',task_id:input.task_id,project_root:input.project_root,messages:[],calls:[],notes:'',pending:null,created_at:new Date().toISOString()};
 if(state.task_id!==input.task_id||state.project_root!==input.project_root)throw Error('Task identity mismatch');
 const requestFolder=inside(folder,'requests/'+input.request_id),inputFile=path.join(requestFolder,'input.json');
 if(fs.existsSync(inputFile)&&!same(read(inputFile),input))throw Error('request_id conflicts with its immutable delegation');
 const cached=path.join(requestFolder,'result.json');if(fs.existsSync(cached))return{folder,requestFolder,state,cached:read(cached)};
 const owner=ownerState(folder);if(owner)throw Error('Orchestration has an active or uncertain owner; inspect/resume the official parent session, do not replay its children: '+JSON.stringify(owner));
 if(state.pending)throw Error('Interrupted child call requires official parent-session recovery; no automatic replay: '+JSON.stringify(state.pending));
 const lock=path.join(folder,'active.lock.d');fs.mkdirSync(lock);const token=randomUUID();fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,token,request_id:input.request_id,at:new Date().toISOString()}),{flag:'wx'});
 fs.mkdirSync(requestFolder,{recursive:true});if(!fs.existsSync(inputFile))fs.writeFileSync(inputFile,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
 if(!state.messages.some(m=>m.request_id===input.request_id))state.messages.push({request_id:input.request_id,message:input.message,context:input.context,source_files:input.source_files??[],source_checkout:input.source_checkout??null,at:new Date().toISOString()});
 state.status='running';atomicJson(stateFile,state);
 return{folder,requestFolder,state,token,input,save(){atomicJson(stateFile,state);},release(){const file=path.join(lock,'owner.json');if(fs.existsSync(file)&&read(file).token===token){fs.unlinkSync(file);fs.rmdirSync(lock);}}};
}
const registeredModules=new Map();
export async function discover(){
 const entries=[];for(const name of fs.readdirSync(path.join(packageRoot,'workflows')).sort()){
  const file=path.join(packageRoot,'workflows',name,'registry.mjs');if(name==='orchestrate'||name==='native-role'||!fs.existsSync(file))continue;
  const module=await import(pathToFileURL(file).href),item=module.default;registeredModules.set(item.id,module);
  entries.push({id:item.id,intent:item.intent,roles:item.requiredRoleIds,...(typeof module.preflightInput==='function'?{input_preflight:true,input_contract:module.inputContract??null}:{})});
 }
 return{workflows:entries,package_root:packageRoot,contracts:['docs/independent-workflows.md','docs/lifecycle-workflows.md','docs/intent-inputs.md'].map(name=>({path:path.join(packageRoot,name),text:fs.readFileSync(path.join(packageRoot,name),'utf8')}))};
}
export async function preflightChildInput(workflow,input,text){
 if(!registeredModules.has(workflow))await discover();
 const module=registeredModules.get(workflow);if(!module)throw Error('Unknown public child workflow: '+workflow);
 if(typeof module.preflightInput!=='function')return null;
 const checked=await module.preflightInput(text===undefined?input:parseJson(text));
 if(!checked||!['ready','invalid'].includes(checked.status)||!Array.isArray(checked.issues))throw Error('Invalid read-only child preflight result: '+workflow);
 return checked;
}
export function inspectPath(input,name,options={}){
 if(typeof name!=='string')throw Error('Inspection path required');
 const file=path.resolve(input.project_root,name),explicit=(input.source_files??[]).map(x=>path.resolve(input.project_root,typeof x==='string'?x:x.path));
 const roots=[input.project_root,packageRoot,...(input.source_checkout?[fs.realpathSync(input.source_checkout)]:[])];
 const real=fs.realpathSync(file);if(!roots.some(root=>real===fs.realpathSync(root)||real.startsWith(fs.realpathSync(root)+path.sep))&&!explicit.some(x=>fs.realpathSync(x)===real))throw Error('Inspection path was not delegated: '+name);
 const stat=fs.statSync(real);if(stat.isDirectory())return{path:real,entries:fs.readdirSync(real,{withFileTypes:true}).map(x=>({name:x.name,kind:x.isDirectory()?'directory':x.isFile()?'file':'link'}))};
 const bytes=fs.readFileSync(real),extension=path.extname(real).toLowerCase(),image=['.png','.jpg','.jpeg','.webp'].includes(extension);
 if(image||bytes.includes(0))return{path:real,bytes:bytes.length,sha256:digest(bytes),kind:image?'local_image':'binary'};
 const text=bytes.toString('utf8'),lines=text.split('\n'),start=options.start_line??1,end=options.end_line??lines.length;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start)throw Error('Valid inclusive line range required');
 return{path:real,bytes:bytes.length,sha256:digest(bytes),line_count:lines.length,start_line:start,end_line:Math.min(end,lines.length),text:start===1&&end>=lines.length?text:lines.slice(start-1,end).join('\n')};
}
export function executablePath(name){
 if(typeof name!=='string'||!name.trim())return null;
 const suffixes=process.platform==='win32'?['',...(process.env.PATHEXT??'.EXE;.CMD;.BAT').split(';')]:[''];
 for(const directory of path.isAbsolute(name)?['']:(process.env.PATH??'').split(path.delimiter))for(const suffix of suffixes){const file=path.resolve(directory,name+suffix);try{if(fs.statSync(file).isFile()){fs.accessSync(file,process.platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);return file;}}catch{}}
 return null;
}
export function projectFacts(input){
 const result=spawnSync('git',['ls-files','-z'],{cwd:input.source_checkout??input.project_root,encoding:'utf8'});
 const head=spawnSync('git',['rev-parse','HEAD'],{cwd:input.source_checkout??input.project_root,encoding:'utf8'});
 const pointer=path.join(input.project_root,'.acceptance-local/current.json');
 return{project_root:input.project_root,source_checkout:input.source_checkout??input.project_root,revision:head.status===0?head.stdout.trim():null,tracked_files:result.status===0?result.stdout.split('\0').filter(Boolean):[],current:fs.existsSync(pointer)?read(pointer):null,acceptances:fs.existsSync(path.join(input.project_root,'.acceptance'))?fs.readdirSync(path.join(input.project_root,'.acceptance')).filter(n=>n.startsWith('AT-')):[],source_documents:(input.source_files??[]).map(x=>inspectPath(input,typeof x==='string'?x:x.path)),available_executables:(input.executable_names??['node','npm','git']).flatMap(name=>{const file=executablePath(name);return file?[{name,path:file}]:[];})};
}
export function compact(value){if(Array.isArray(value))return value.map(compact);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='immutable_files').map(([key,v])=>[key,compact(v)]));}
export function childInput(task,decision){
 let input=decision.input;
 if(decision.input_file){const item=inspectPath(task.input,decision.input_file),raw=item.text.trim();if(raw.startsWith('/')){const split=raw.indexOf(' ');if(raw.slice(1,split)!==decision.workflow)throw Error('Generated command names another workflow');input=JSON.parse(raw.slice(split+1));}else input=JSON.parse(raw);}
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Explicit child input object required');
 if(input.project_root!==undefined&&fs.realpathSync(input.project_root)!==task.input.project_root)throw Error('Child targets another undelegated project');
 return{...input,project_root:task.input.project_root};
}
export function childRequest(task,decision){
 const input=childInput(task,decision);
 if(decision.input_file){const raw=inspectPath(task.input,decision.input_file).text.trim(),text=raw.startsWith('/')?raw.slice(raw.indexOf(' ')+1):raw,original=JSON.parse(text);if(original.project_root===task.input.project_root)return{input,text};}
 return{input,text:JSON.stringify(input)};
}
