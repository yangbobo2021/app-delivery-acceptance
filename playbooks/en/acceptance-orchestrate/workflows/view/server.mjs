import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AcceptanceView,inventory} from './data.mjs';
const html=fs.readFileSync(fileURLToPath(new URL('./viewer/index.html',import.meta.url)));
export function createViewServer(project,{selected=null}={}){
 const view=new AcceptanceView(project,selected);
 return http.createServer((request,response)=>{
  let status=200,mime='application/json; charset=utf-8',body;
  try{
   if(request.method!=='GET')throw Error('Read-only viewer accepts GET only');const url=new URL(request.url,'http://127.0.0.1');
   if(url.pathname==='/'){body=html;mime='text/html; charset=utf-8';}
   else if(url.pathname==='/api/acceptances'){const acceptances=inventory(view.root);body={acceptances,acceptance_id:acceptances.length?view.select():null,...view.currentStatus()};}
   else if(url.pathname==='/api/traces')body=view.snapshot(url.searchParams.get('acceptance_id')||undefined);
   else if(url.pathname==='/api/file'){
    const id=view.select(url.searchParams.get('acceptance_id')),file=view.artifact(id,url.searchParams.get('ref'));body=fs.readFileSync(file);mime=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.log':'text/plain; charset=utf-8'})[path.extname(file).toLowerCase()]??'text/plain; charset=utf-8';
   }else{status=404;body={status:'unavailable',reason:'Unknown read-only route'};}
  }catch(error){status=422;body={status:'unavailable',reason:error.message};}
  if(!Buffer.isBuffer(body))body=Buffer.from(JSON.stringify(body));response.writeHead(status,{'Content-Type':mime,'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});response.end(body);
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [project,selectedArg,portArg]=process.argv.slice(2),server=createViewServer(project,{selected:selectedArg||null});server.listen(Number(portArg??0),'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/',pid:process.pid,project,acceptance_id:selectedArg||null})+'\n'));
}
