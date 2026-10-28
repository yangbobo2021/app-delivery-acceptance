import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {commandRegistry} from '../shared/command.mjs';
import {AcceptanceView} from './data.mjs';
export default commandRegistry({id:'acceptance-view',intent:'Read selected current or historical acceptance without changing its pointer or executing any test, and open a local Node trace viewer.',successState:'viewing',operation:async input=>{
 if(!input||Object.keys(input).some(k=>!['project_root','acceptance_id','port'].includes(k)))throw Error('Read-only view request contains unknown fields');const view=new AcceptanceView(input.project_root,input.acceptance_id),id=view.select(input.acceptance_id);view.snapshot(id);
 const port=input.port??0;if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Invalid local view port');
 const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url)),view.root,id,String(port)],{detached:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stderr.on('data',v=>stderr+=v);
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Local view startup timed out'));},10000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{if(!stdout.trim()){clearTimeout(timer);reject(Error('Local view did not start: '+stderr.slice(-1000)));}});child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(stdout.split('\n')[0]));}catch(e){reject(e);}}});});child.stdout.destroy();child.stderr.destroy();child.unref();return {status:'viewing',...result,read_only:true};
}});
