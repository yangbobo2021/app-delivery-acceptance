import {toolCommand} from './tool-command.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {guard} from './validation.mjs';
import {read,inside,ownedAbsolute,atomicJson} from './store.mjs';
import {digest,verifyCase} from './definitions.mjs';
import {requireWorkspaceLease} from './guard.mjs';
import {recordExecution} from './recorder.mjs';
import {runCoverage} from './coverage-execution.mjs';
import {projectEnvironment} from './runtime.mjs';
const cli=fileURLToPath(new URL('../../tools/case.mjs',import.meta.url));
export function createDebugContract(catalogFile,inputFile,contractFile){
  const catalog=read(catalogFile),input=read(inputFile);verifyCase(input);guard(catalog,[contractFile]);requireWorkspaceLease(catalog,{output:contractFile});
  const value={schema:'acceptance-debug-contract-v1',acceptance:catalog.acceptance,project_root:catalog.project_root,workspace_policy:catalog.workspace_policy,revision:catalog.revision,scene_id:input.scene.id,catalog_path:path.resolve(catalogFile),catalog_sha256:digest(catalogFile),input_path:path.resolve(inputFile),input_sha256:digest(inputFile),debug_root:path.join(path.dirname(contractFile),'debug'),coverage:catalog.coverage??input.coverage??{},environment:input.debug_environment??{},...(input.definitions?{definitions:input.definitions}:{})};
  if(fs.existsSync(contractFile)){if(!equal(read(contractFile),value))throw Error('Debug contract changed; preserve it and create a new bound attempt');}
  else{fs.mkdirSync(path.dirname(contractFile),{recursive:true});fs.writeFileSync(contractFile,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
  return {entry:[...toolCommand(cli,path.dirname(path.resolve(contractFile))),'debug-run',path.resolve(contractFile)],request_root:value.debug_root,required_test_files:value.coverage.required_test_files??{}};
}
export async function runDebug(contractFile,requestFile,{signal}={}){
  const contract=read(contractFile);if(contract.schema!=='acceptance-debug-contract-v1')throw Error('Invalid debug contract');
  guard(contract,[contract.debug_root]);requireWorkspaceLease(contract,{output:contract.debug_root});
  for(const key of ['catalog','input'])if(digest(contract[key+'_path'])!==contract[key+'_sha256'])throw Error('Debug '+key+' binding changed');
  createDebugContract(contract.catalog_path,contract.input_path,contractFile);
  requestFile=ownedAbsolute(contract.debug_root,requestFile);const request=read(requestFile);
  if(Object.keys(request).some(key=>!['command','files','env','output'].includes(key))||!request.command?.length||!request.files?.length)throw Error('Debug request accepts exact command, files, env and optional new output only');
  const output=ownedAbsolute(contract.debug_root,request.output??path.join(contract.debug_root,'attempt-'+randomUUID()));
  if(output===contract.debug_root||fs.existsSync(output))throw Error('Debug output must be a new attempt beneath debug_root');
  const env={...projectEnvironment(read(contract.catalog_path)),...(request.env??{})},settings=contract.environment,state=path.join(output,'state');
  if(settings.fresh_env_root_key)env[settings.fresh_env_root_key]=state;
  for(const [key,relative]of Object.entries(settings.fresh_env_paths??{}))env[key]=inside(state,relative);
  for(const key of settings.evidence_env_dir_keys??[])if(env[key])ownedAbsolute(output,env[key]);
  const bound={acceptance:contract.acceptance,cwd:contract.project_root,revision:contract.revision,scene_id:contract.scene_id,output:path.join(output,'execution'),files:request.files,command:request.command,env,fresh_dirs:[state],output_env_dir_keys:settings.evidence_env_dir_keys??[]};
  guard(contract,[bound.output,...bound.fresh_dirs]);
  const receipt=contract.coverage.policy==='required'?await runCoverage({...bound,coverage:contract.coverage,prepared:contract.coverage.prepared,inventory_path:contract.coverage.inventory_path},{signal}):await recordExecution(bound,{signal});
  atomicJson(path.join(output,'debug-observation.json'),{status:'observed',exit_code:receipt.exit_code,receipt:path.join(bound.output,'execution.json'),product_verdict:'not_performed'});return receipt;
}
