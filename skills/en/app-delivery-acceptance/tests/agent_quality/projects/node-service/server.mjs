import http from 'node:http';
import {pathToFileURL} from 'node:url';

export function createService(initial=10) {
  let stock=initial;
  const receipts=new Map();
  return http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    const reply=(code,body)=>{res.writeHead(code);res.end(JSON.stringify(body));};
    if(req.method==='GET'&&req.url==='/stock')return reply(200,{stock});
    if(req.method!=='POST'||req.url!=='/reserve')return reply(404,{error:'not found'});
    let raw='';for await(const chunk of req)raw+=chunk;
    const {request_id,quantity}=JSON.parse(raw);
    if(receipts.has(request_id))return reply(200,receipts.get(request_id));
    if(stock<quantity)return reply(409,{error:'insufficient stock'});
    stock-=quantity;
    const receipt={id:'receipt-'+request_id};receipts.set(request_id,receipt);
    return reply(200,receipt);
  });
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.includes('--help'))console.log('Usage: node server.mjs [--help]');
  else createService().listen(0,'127.0.0.1',function(){console.log(this.address().port);});
}
