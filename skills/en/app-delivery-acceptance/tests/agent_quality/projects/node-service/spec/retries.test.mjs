import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server.mjs';

async function withServer(fn){
  const server=createService();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{await fn(base);}finally{await new Promise(resolve=>server.close(resolve));}
}
const reserve=(base,id,quantity)=>fetch(base+'/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request_id:id,quantity})});

test('repeat operation',()=>withServer(async base=>{
  const first=await reserve(base,'a',3);const receipt=await first.json();
  assert.equal(first.status,200);assert.ok(receipt.id);
  const second=await reserve(base,'a',3);assert.equal(second.status,200);
  assert.deepEqual(await second.json(),receipt);
  assert.deepEqual(await(await fetch(base+'/stock')).json(),{stock:7});
}));

test('separate operations',()=>withServer(async base=>{
  const first=await(await reserve(base,'a',3)).json();
  const second=await(await reserve(base,'b',2)).json();
  assert.notEqual(first.id,second.id);
  assert.deepEqual(await(await fetch(base+'/stock')).json(),{stock:5});
}));
