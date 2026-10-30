import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign,verify,createPublicKey,randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {inside} from './store.mjs';

const protocol='acceptance-lease-liveness-v1';
export const leaseDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const payload=value=>JSON.stringify({schema:protocol,nonce:value.nonce,claim_sha256:value.claim_sha256,owner_sha256:value.owner_sha256,pid:value.pid,responded_at:value.responded_at});

// Only this live lease holder keeps the private key. The sandboxed tool gets a
// public key pinned by the same authority handoff as its existing lease token.
export function leaseProofServer(owner,claimFile,sceneOwnerFile){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const directory=inside(owner.output_dir,'lease-proof/'+randomUUID());fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const key=publicKey.export({type:'spki',format:'der'}).toString('base64');
 owner.liveness={protocol,directory,public_key:key};
 const expected=leaseDigest(owner),answered=new Set();let closed=false,watcher,timer;
 const scan=()=>{
  if(closed)return;
  try{
   const sceneOwner=read(sceneOwnerFile);
   if(leaseDigest(read(claimFile))!==expected||sceneOwner.schema!=='acceptance-workspace-owner-v1'||sceneOwner.acceptance_id!==owner.acceptance_id||sceneOwner.output_dir!==owner.output_dir)return;
   for(const name of fs.readdirSync(directory)){
    if(!/^[a-f0-9]{64}\.request\.json$/.test(name)||answered.has(name))continue;
    const file=inside(directory,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)continue;
    let request;try{request=read(file);}catch{continue;}
    if(request.schema!==protocol||request.nonce!==name.slice(0,64)||request.claim_sha256!==expected)continue;
    const response={schema:protocol,nonce:request.nonce,claim_sha256:expected,owner_sha256:leaseDigest(sceneOwner),pid:process.pid,responded_at:new Date().toISOString()};
    response.signature=sign(null,Buffer.from(payload(response)),privateKey).toString('base64');
    const output=inside(directory,request.nonce+'.response.json');
    try{fs.writeFileSync(output,JSON.stringify(response)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
    answered.add(name);
   }
  }catch{ /* A changed/missing claim or malformed challenge never authorizes a tool. */ }
 };
 return {key,start(){watcher=fs.watch(directory,scan);watcher.unref();timer=setInterval(scan,250);timer.unref();},close(){closed=true;watcher?.close();clearInterval(timer);}};
}

export function verifyLeaseProof(claim,claimFile,pinnedKey,sceneOwner){
 const binding=claim.liveness;
 if(!binding||binding.protocol!==protocol||!pinnedKey||binding.public_key!==pinnedKey)throw Error('Workspace liveness public key is not bound to this tool authority');
 const parent=inside(claim.output_dir,'lease-proof');
 if(typeof binding.directory!=='string'||path.dirname(binding.directory)!==parent||!/^[-a-f0-9]{36}$/.test(path.basename(binding.directory)))throw Error('Workspace liveness directory is outside this lease');
 const directory=inside(parent,path.basename(binding.directory)),key=createPublicKey({key:Buffer.from(pinnedKey,'base64'),type:'spki',format:'der'});
 if(key.asymmetricKeyType!=='ed25519')throw Error('Workspace liveness needs its pinned Ed25519 key');
 const nonce=randomBytes(32).toString('hex'),digest=leaseDigest(claim),request={schema:protocol,nonce,claim_sha256:digest};
 fs.writeFileSync(inside(directory,nonce+'.request.json'),JSON.stringify(request)+'\n',{flag:'wx',mode:0o600});
 const responseFile=path.join(directory,nonce+'.response.json'),deadline=performance.now()+3000;
 while(performance.now()<deadline){
  if(fs.existsSync(responseFile)){
   const file=inside(directory,nonce+'.response.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>4096)throw Error('Invalid workspace liveness response file');
   let response;try{response=read(file);}catch{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);continue;}
   if(response.schema!==protocol||response.nonce!==nonce||response.claim_sha256!==digest||response.owner_sha256!==leaseDigest(sceneOwner)||response.pid!==claim.pid||typeof response.responded_at!=='string'||typeof response.signature!=='string'||!verify(null,Buffer.from(payload(response)),key,Buffer.from(response.signature,'base64')))throw Error('Workspace liveness response signature or invocation binding is invalid');
   if(leaseDigest(read(claimFile))!==digest)throw Error('Workspace claim changed during liveness verification');
   return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
 }
 throw Error('Workspace owner did not answer this fresh liveness challenge; preserve the uncertain lease');
}
