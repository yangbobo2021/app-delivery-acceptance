import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,atomicJson} from '../shared/store.mjs';
import {digest} from '../shared/definitions.mjs';
import {AcceptanceView,inventory} from '../view/data.mjs';
import {noSecrets} from '../archive/stage.mjs';
export function generateReport(input){
 if(!input||Object.keys(input).some(k=>!['project_root','acceptance_id','request_id','basis'].includes(k))||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||!String(input.basis??'').trim())throw Error('Explicit selected AT, report identity and basis required');
 const {root,local}=locations(input.project_root,input.acceptance_id),folder=inside(local,'workflows/report/'+input.request_id);
 if(fs.existsSync(folder)){if(!equal(read(path.join(folder,'input.json')),input))throw Error('Report request identity conflicts');const result=read(path.join(folder,'result.json'));for(const [file,hash]of Object.entries(result.immutable_files))if(digest(file)!==hash)throw Error('Report artifact changed');return {...result,reused:true};}
 const view=new AcceptanceView(root,input.acceptance_id),snapshot=view.snapshot(input.acceptance_id),links=new Map();fs.mkdirSync(path.dirname(folder),{recursive:true});fs.mkdirSync(folder);atomicJson(path.join(folder,'input.json'),input);const files=[path.join(folder,'input.json')];
 for(const [ref,item]of view.allowed){noSecrets(item.file);const name='evidence/'+ref+path.extname(item.file),destination=inside(folder,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(item.file,destination,fs.constants.COPYFILE_EXCL);if(digest(destination)!==item.sha256)throw Error('Report evidence changed during copy');files.push(destination);links.set('/api/file?'+new URLSearchParams({acceptance_id:input.acceptance_id,ref}),name);}
 let raw=JSON.stringify(snapshot);for(const [original,replacement]of links)raw=raw.replaceAll(original,replacement);const frozen=JSON.parse(raw);atomicJson(path.join(folder,'snapshot.json'),frozen);files.push(path.join(folder,'snapshot.json'));
 const safe=value=>JSON.stringify(value).replaceAll('<','\\u003c'),acceptances={acceptances:inventory(root),acceptance_id:input.acceptance_id,...view.currentStatus()},shim=`<script>const frozenAcceptance=${safe(frozen)},frozenInventory=${safe(acceptances)};window.fetch=async function(url){const name=String(url);if(name.startsWith('/api/traces'))return {ok:true,json:async()=>structuredClone(frozenAcceptance)};if(name.startsWith('/api/acceptances'))return {ok:true,json:async()=>({...structuredClone(frozenInventory),acceptances:frozenInventory.acceptances.filter(x=>x.id===frozenAcceptance.acceptance_id)})};throw Error('Frozen report does not execute live operations');};</script>`;
 let html=fs.readFileSync(fileURLToPath(new URL('../view/viewer/index.html',import.meta.url)),'utf8').replace('<title>交付验收追踪</title>','<title>冻结交付验收报告</title>').replace('</head>',shim+'</head>');html=html.replace('setInterval(refresh,5000);setInterval(loadAcceptances,30000);','');fs.writeFileSync(path.join(folder,'report.html'),html);files.push(path.join(folder,'report.html'));
 const result={schema:'acceptance-report-result-v1',status:'reported',acceptance_id:input.acceptance_id,generated_at:new Date().toISOString(),report:path.join(folder,'report.html'),snapshot:path.join(folder,'snapshot.json'),statistics:frozen.statistics,read_only_sources:true,execution_started:false,immutable_files:Object.fromEntries(files.map(file=>[file,digest(file)]))};atomicJson(path.join(folder,'result.json'),result);return result;
}
