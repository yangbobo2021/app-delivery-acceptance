#!/usr/bin/env node
import {read} from '../workflows/shared/store.mjs';
import {guard} from '../workflows/shared/validation.mjs';
import {verifyCase} from '../workflows/shared/definitions.mjs';
import {finalizeIdentities,preflightIdentity} from '../workflows/shared/identity.mjs';
import {requireWorkspaceLease} from '../workflows/shared/guard.mjs';
import {createDebugContract,runDebug} from '../workflows/shared/debug.mjs';
import {reuseOperation} from '../workflows/shared/case-reuse.mjs';
import {existingPolicy} from '../workflows/shared/existing-policy.mjs';
import {validateDiscovery} from '../workflows/shared/case-contract.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
const argv=process.argv.slice(2);
if(argv[0]==='--lease-file'){
 const file=path.resolve(argv[1]??'');if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('Regular tool-authority file required');
 const value=read(file);if(Object.keys(value).sort().join(',')!=='claim,lease'||typeof value.lease!=='string'||typeof value.claim!=='string'||!value.claim)throw Error('Invalid tool authority');
 process.env.ACCEPTANCE_WORKSPACE_LEASE=value.lease;process.env.ACCEPTANCE_WORKSPACE_CLAIM=value.claim;argv.splice(0,2);
}
const [operation,...args]=argv;
try{
  let result;
  if(operation==='identity'&&args.length===3){
    const [catalogFile,inputFile,output]=args,catalog=read(catalogFile),input=read(inputFile);guard(catalog,[output]);guard(input,[output]);requireWorkspaceLease(catalog,{allowLegacy:false});verifyCase(input);
    if(!equal(catalog.definitions,input.definitions))throw Error('Case identity catalog definitions differ');result=finalizeIdentities(catalog,input,output);
  }else if(operation==='debug-create'&&args.length===3)result=createDebugContract(...args);
  else if(operation==='debug-run'&&args.length===2){result=await runDebug(...args);process.exitCode=result.exit_code;}
  else if(operation==='preflight'&&args.length===2){preflightIdentity(read(args[0]),read(args[1]));result={status:'valid'};}
  else if(/^reuse-(start|checkpoint|check|verify)$/.test(operation)&&[3,4].includes(args.length))result=reuseOperation(operation.slice(6),...args);
  else if(/^policy-(start|verify)$/.test(operation)&&args.length===2){const catalog=read(args[0]);guard(catalog,[args[1]]);requireWorkspaceLease(catalog,{allowLegacy:false});result=existingPolicy(operation.slice(7),catalog,args[1]);}
  else if(operation==='discovery'&&[3,4].includes(args.length)){
    const [catalogFile,inputFile,output,flag]=args,catalog=read(catalogFile),input=read(inputFile);guard(catalog,[output]);requireWorkspaceLease(catalog,{allowLegacy:false});verifyCase(input);
    if(flag&&flag!=='--discovery-only')throw Error('Unknown discovery control');result=validateDiscovery(read(path.join(output,'answer.json')),input,catalog.project_root,read(path.join(output,'existing-files.json')),{discoveryOnly:flag==='--discovery-only'});
  }
  else throw Error('usage: node case-tool.mjs identity CATALOG INPUT OUTPUT | debug-create CATALOG INPUT CONTRACT | debug-run CONTRACT REQUEST | preflight CATALOG ANSWER');
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({status:'blocked',reason:error.message}));process.exitCode=2;}
