// Project-facing coverage preparation. Internal acceptance/runtime/inventory
// records are created here, never assembled by the Skill caller.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAcceptance} from '../create/initialize.mjs';
import {freezeAcceptance} from '../freeze/freeze.mjs';
import {current,locations,inside,read,atomicJson,projectRoot} from '../shared/store.mjs';
import {digest} from '../shared/definitions.mjs';
import {git} from '../shared/workspace.mjs';
import {prepare as prepareRuntime,finalize as finishRuntime,fail as failRuntime} from '../runtime/stage.mjs';
import {createAgentRuntime} from '../../runtime/players.mjs';
import {validateRuntime} from '../shared/runtime.mjs';
import {isDeepStrictEqual as equal} from 'node:util';

const parse=text=>JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
const fileHashes=root=>Object.fromEntries(git(root,'ls-files','-z').split('\0').filter(Boolean).filter(name=>fs.existsSync(path.join(root,name))&&fs.statSync(path.join(root,name)).isFile()).map(name=>[name,digest(path.join(root,name))]));
async function discover(directory,input,signal){
 fs.mkdirSync(directory,{recursive:true});
 let agent;try{agent=createAgentRuntime({directory,role:'coverage_preparer'});}catch(error){error.configuration_failure=true;throw error;}
 const prompt=`为这个项目准备覆盖率执行环境，先检查项目并提出运行准备及采集范围。你在覆盖率工作流内部工作，不需要用户先提供验收 ID、源码哈希或运行清单。只读检查真实 README、构建/依赖清单、产品及已有测试入口，按项目实际情况选择，不能预设语言或框架。不生成业务需求、场景或业务用例。此时不要修改源码或安装依赖；后续程序会在隔离工作树真实执行你的运行方案，之后同一工作流会准备和修复覆盖率采集器。知识已读取的逻辑键为 INDEX.md。\n项目资料：${JSON.stringify(input)}\n如遇先前准备问题，读取所列日志并修正方案；内部修复由你自主决定，保留旧尝试。\n只返回 JSON：{source_paths:[实际需要采集的 Git 根相对源码文件],test_roots:[可写入采集及探针脚本的 Git 根相对目录],inspection_files:[需要用于运行准备的真实项目资料文件],runtime_plan:{dependency_files:[依赖清单相对路径],knowledge_used:["INDEX.md"],execution_env:{稳定项目环境字符串，不含秘密},setup_commands:[{command:[argv],cwd?,env?,timeout_seconds?}],executables:[{name,path:实际执行器绝对路径,version_command:[argv]}],smoke:{command:[argv],cwd?,env?,timeout_seconds?},recipe_candidate:非空可移植方法说明}}。命令支持 {workspace} 和 {runtime_root} 占位；使用实际 PATH 检查执行器，不猜测工具安装位置。setup 在隔离工作树运行；smoke 只验证真实运行路径，不执行业务用例。源码文件范围须来自实际项目，不将测试、文档或依赖安装物当产品源码。没有既有测试时选择合适测试目录，后续会创建；产品入口和依赖明确即可准备。若真实前提无法解决，返回 {status:"unavailable",reason:具体原因,limitations:[实际限制]}。`;
 fs.writeFileSync(path.join(directory,'prompt.txt'),prompt);
 let text,done,error;for await(const event of agent.run(prompt,{cwd:input.source_checkout,jsonOutput:true,signal,permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'allow'}})){
  if(signal?.aborted)throw signal.reason??Error('Coverage preparation cancelled');
  fs.appendFileSync(path.join(directory,'agent.jsonl'),JSON.stringify(event)+'\n');
  if(event.type==='text')text=event.payload?.content;
  if(event.type==='done')done=event.payload;
  if(event.type==='error')error=event.payload?.message;
 }
 if(done?.status!=='success'||!text){const failure=Error(error??'Project inspection Agent did not complete');failure.native_failure=true;throw failure;}
 fs.writeFileSync(path.join(directory,'answer.txt'),text+'\n');return parse(text);
}

export async function projectCoverageInput(input={}, {signal}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Coverage input must identify a project');
 // Existing explicit, immutable bindings remain usable by composed workflows.
 if(input.definitions_sha256||input.runtime_manifest||input.inventory_path)return input;
 const allowed=['project_root','request_id','acceptance_id','goal','execution_entry','source_checkout','revision','policy','basis','preparation_timeout_seconds'];
 if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Project coverage input has unknown fields; provide project_root and optional execution_entry');
 const root=projectRoot(path.resolve(input.project_root??process.cwd())),source=fs.realpathSync(git(input.source_checkout??root,'rev-parse','--show-toplevel').trim()),revision=git(source,'rev-parse',input.revision??'HEAD').trim();
 const requestId=input.request_id??'coverage-'+randomUUID(),active=current(root),id=input.acceptance_id??active??'AT-coverage-'+randomUUID();
 if(!active)createAcceptance({project_root:root,acceptance_id:id,request_id:requestId+'-create',title:'项目覆盖率准备',user_request:input.goal??'为此项目准备可采集测试用例覆盖率的执行环境。'});
 else if(active!==id)throw Error('Another acceptance is current: '+active);
 const {local,shared}=locations(root,id),definitions=path.join(shared,'scenarios.json');
 if(!fs.existsSync(definitions))freezeAcceptance({project_root:root,acceptance_id:id,request_id:requestId+'-context',base_definitions_sha256:null,basis:'覆盖率准备工作流建立技术任务上下文，不生成业务需求或场景。',scope:{kind:'coverage-environment',project:root},definitions:{context:{business_goal:'准备项目覆盖率执行环境，或说明不能支持的实际原因。'}}});
 if(input.policy&&input.policy!=='required')return {project_root:root,acceptance_id:id,request_id:requestId,definitions_sha256:digest(definitions),policy:input.policy,basis:input.basis??input.goal??'用户显式选择覆盖率策略。',...(input.preparation_timeout_seconds?{preparation_timeout_seconds:input.preparation_timeout_seconds}:{})};
 const inputsRoot=inside(local,'workflows/coverage-inputs');
 if(!input.request_id&&!input.goal&&!fs.existsSync(inside(local,'workspace-owner.json'))&&fs.existsSync(inputsRoot)){
  for(const name of fs.readdirSync(inputsRoot).reverse())try{
   const prior=read(path.join(inputsRoot,name,'input.json')),resolved=read(path.join(inputsRoot,name,'resolved.json'));
   if(resolved.unavailable||resolved.policy!=='required'||resolved.definitions_sha256!==digest(definitions)||!equal(prior.execution_entry??null,input.execution_entry??null))continue;
   const result=read(inside(local,'workflows/coverage/'+resolved.request_id+'/result.json'));
   if(result.status!=='ready')continue;
   const runtime=validateRuntime(resolved.runtime_manifest,{resmoke:true});
   if(runtime.revision!==revision||Object.entries(resolved.source_hashes).some(([file,hash])=>digest(inside(source,file))!==hash||digest(inside(runtime.workspace,file))!==hash))continue;
   // The normal cached-result verifier still checks profile, tools and frozen
   // evidence. A damaged/stale candidate falls through to fresh preparation.
   const {coveragePreparation}=await import('../shared/coverage.mjs');coveragePreparation(result.coverage,{runCheck:false});
   const checks=path.join(inputsRoot,name,'reuse-checks');fs.mkdirSync(checks,{recursive:true});atomicJson(path.join(checks,randomUUID()+'.json'),{at:new Date().toISOString(),status:'verified',runtime,prepared:result.coverage,source_revision:revision});
   return resolved;
  }catch{/* A stale environment is work to prepare again, not a permanent stop. */}
 }
 const folder=inside(local,'workflows/coverage-inputs/'+requestId);fs.mkdirSync(folder,{recursive:true});
 const saved=path.join(folder,'resolved.json');if(fs.existsSync(saved)){const result=read(saved);if(JSON.stringify(read(path.join(folder,'input.json')))!==JSON.stringify(input))throw Error('Coverage project request identity conflict');return result;}
 const priorInput=path.join(folder,'input.json');if(fs.existsSync(priorInput))throw Error('Project input preparation was interrupted; inspect '+folder);atomicJson(priorInput,input);
 const start=Date.now(),budget=input.preparation_timeout_seconds??1800,deadline=start+budget*1000,previous=[],files=git(source,'ls-files','-z').split('\0').filter(Boolean),original=fileHashes(source);
 let plan,runtime,attempt=0;
 for(;;){
  if(signal?.aborted)throw signal.reason??Error('Coverage preparation cancelled');
  if(Date.now()>=deadline)throw Error('Project runtime preparation exhausted its actual budget; unresolved: '+JSON.stringify(previous.at(-1)));
  const directory=path.join(folder,'inspection-'+String(++attempt).padStart(3,'0'));
  try{
   const remaining=Math.max(1,deadline-Date.now()),cancel=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
   plan=await discover(directory,{project_root:root,source_checkout:source,revision,tracked_files:files,execution_entry:input.execution_entry??null,prior_preparation:previous},cancel);
   if(JSON.stringify(fileHashes(source))!==JSON.stringify(original))throw Error('Project inspection changed tracked source bytes');
   if(plan.status==='unavailable'){
    if(typeof plan.reason!=='string'||!plan.reason.trim())throw Error('Unavailable preparation needs an actual reason');
    const resultFolder=inside(local,'workflows/coverage/'+requestId);fs.mkdirSync(resultFolder,{recursive:true});
    const result={schema:'acceptance-coverage-result-v1',status:'unavailable',reason:plan.reason,limitations:plan.limitations??[],project_root:root,acceptance_id:id,request_id:requestId,receipt_path:path.join(resultFolder,'result.json'),business_tests:'not_executed',product_judgment:'not_performed'};
    atomicJson(path.join(resultFolder,'input.json'),input);atomicJson(result.receipt_path,result);atomicJson(saved,{...result,unavailable:true});return {...result,unavailable:true};
   }
   for(const key of ['source_paths','test_roots','inspection_files'])if(!Array.isArray(plan[key])||!plan[key].length)throw Error('Project inspection must identify actual '+key);
   for(const name of plan.source_paths)if(!files.includes(name)||!fs.statSync(inside(source,name)).isFile())throw Error('Source inventory is not an actual project file: '+name);
   const spec=prepareRuntime({project_root:root,acceptance_id:id,request_id:requestId+'-runtime-'+attempt,definitions_sha256:digest(definitions),source_checkout:source,revision,test_roots:plan.test_roots,inspection_files:plan.inspection_files});
   try{runtime=finishRuntime(spec,JSON.stringify(plan.runtime_plan));}catch(error){failRuntime(spec,error.message);throw error;}
   break;
  }catch(error){previous.push({directory,reason:error.message});atomicJson(path.join(directory,'failure.json'),{reason:error.message});if(error.configuration_failure||signal?.aborted)throw error;}
 }
 const hashes=Object.fromEntries(plan.source_paths.map(name=>[name,digest(inside(runtime.workspace,name))])),inventory=path.join(folder,'inventory.json');
 atomicJson(inventory,{schema:'change-inventory-v1',project_root:runtime.workspace,base_ref:revision,target_revision:revision,base_revision:revision,head_revision:revision,source_paths:plan.source_paths,source_hashes:hashes,files:[],gitlinks:[],changed_source_paths:[],unclassified_paths:[],pr_requirement_ids:[],test_modes:[]});
 const resolved={project_root:root,acceptance_id:id,request_id:requestId,definitions_sha256:digest(definitions),policy:input.policy??'required',basis:input.basis??'用户请求为该项目准备覆盖率执行环境。',runtime_manifest:runtime.runtime.manifest,runtime_sha256:runtime.runtime.sha256,inventory_path:inventory,inventory_sha256:digest(inventory),source_hashes:hashes,test_roots:plan.test_roots,preparation_timeout_seconds:budget,...(input.execution_entry?{preparation_instructions:'实际测试执行入口及进程要求：'+JSON.stringify(input.execution_entry)}:{})};
 atomicJson(saved,resolved);return resolved;
}
