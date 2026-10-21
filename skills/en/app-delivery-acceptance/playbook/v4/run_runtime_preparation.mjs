#!/usr/bin/env node
// Independent, one-shot runtime-environment Agent. Host runs and verifies its plan.
import {acceptanceGuard,knowledgeContext} from '../acceptance-guard.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createAgentRuntime} from '../v3/runtime-path.mjs';

const [requestArg,outputArg,...extra]=process.argv.slice(2);
if(!requestArg||!outputArg||extra.length)throw Error('usage: node run_runtime_preparation.mjs request.json NEW-workflow-output-dir');
const requestPath=resolve(requestArg),output=resolve(outputArg),request=JSON.parse(readFileSync(requestPath));
if(request.schema!=='project-runtime-agent-request-v1')throw Error('Invalid runtime Agent request schema');
if(!Array.isArray(request.test_roots)||!request.test_roots.length||
   !request.test_roots.every(name=>typeof name==='string'&&name.length))
  throw Error('Runtime Agent request must declare the project test roots used by later preparation');
const binding=acceptanceGuard(request,[output]);
const knowledge=knowledgeContext(binding);
if(existsSync(output))throw Error('Runtime Agent output already exists; preserve it and use a new attempt');
const here=dirname(fileURLToPath(import.meta.url));
const host=resolve(here,'../../scripts/runtime_preparation.py');
const python=process.env.ACCEPTANCE_PYTHON??'python3';
const bootstrap=JSON.parse(execFileSync(python,[host,'bootstrap',requestPath,output],{encoding:'utf8'}));
const workspace=bootstrap.workspace;
const git=(...args)=>execFileSync('git',args,{cwd:workspace,encoding:'utf8'}).trim();
const beforeStatus=git('status','--short','--untracked-files=all');
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'request.frozen.json'),JSON.stringify(request,null,2)+'\n');
const prompt=`你是本次交付验收独立的“被测项目运行环境准备 Agent”。只负责给冻结项目建立可重复的测试运行环境；不要生成、执行或评判业务场景，不选择覆盖率工具，不修改产品源码。你有实际项目目录的只读检查能力；先阅读随附的已索引项目知识，再只检查必要的依赖清单、现有测试入口和目录。已有知识若可用，优先验证与复用其步骤，记录知识文件名；不要重复选型或尝试过去已排除的错误方案。安装与轻量 smoke 由宿主按你返回的 argv 执行，你此阶段不要自行安装依赖或改文件。运行环境先于覆盖率准备；工作树中若留有前一次覆盖率准备生成的测试适配器或依赖文件，不要把它们当成本阶段的依赖清单。若提供前次失败收据，请先只读核对，修正造成失败的具体步骤，保留旧尝试。\n\n请输出且只输出 JSON 对象，字段：dependency_files（相对于冻结 workspace 根目录的路径数组，不是相对于项目子目录；仅列冻结项目既有依赖清单，无清单可空数组并在 recipe_candidate 说明）、knowledge_used（确实从输入读到的已索引知识名，必须含 INDEX.md）、setup_commands（有序的 {command:argv,cwd?,env?,timeout_seconds?}；可空）、executables（至少一个 {name,path,version_command:argv}；path 必须是执行后的绝对路径，准备阶段新建的路径可用 {runtime_root} 占位符；version_command 首项必须等于 path）、smoke（可重复、无业务断言的最小 {command:argv,cwd?,env?,timeout_seconds?}，必须走项目将给测试用例用的入口）、recipe_candidate（非空 Markdown 字符串，说明跨验收可复用的操作步骤、目录和新电脑重建方法；不能输出对象或数组，不含本机秘密或旧验收 ID 的路径）。命令数组不使用 shell 插值；路径占位符只有 {workspace} 和 {runtime_root}。运行环境可放在本 ID 的 runtime_root，也可使用工作树内 Git 忽略的安装目录。不要要求安装到全局。由测试驱动启动、只在 smoke 中使用的程序无需列入 executables；但 smoke 必须证明它确实可用。若知识或环境不足，诚实输出 blocked_reason；宿主会保留首次异常。\n\n验收绑定：${JSON.stringify({acceptance:binding,source_checkout:request.source_checkout,revision:request.revision,workspace})}\n已索引知识：${JSON.stringify(knowledge)}\n前次失败尝试（只读）：${JSON.stringify(request.prior_attempts ?? [])}`;
writeFileSync(join(output,'prompt.txt'),prompt+'\n');
const agent=createAgentRuntime({directory:output});
const metrics={agent_runtime:agent.metadata,model:agent.metadata.model,effort:agent.metadata.effort,
  started_at:new Date().toISOString(),request_sha256:createHash('sha256').update(readFileSync(requestPath)).digest('hex')};
const started=performance.now(),texts=[];let done,error,tools=0;
try{
  for await(const event of agent.run(prompt,{cwd:workspace,model:metrics.model,effort:metrics.effort,
    permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}})){
    appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
    if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
    if(event.type==='tool_use')tools++;
    if(event.type==='done')done=event.payload;
    if(event.type==='error')error=event.payload?.message;
  }
  if(done?.status!=='success')throw Error(error??'Runtime Agent did not complete');
  const raw=(texts.at(-1)??'').trim();
  writeFileSync(join(output,'answer.txt'),raw+'\n');
  const draft=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  writeFileSync(join(output,'draft.json'),JSON.stringify(draft,null,2)+'\n');
  if(draft.blocked_reason)throw Error('Runtime Agent blocked: '+draft.blocked_reason);
  if(typeof draft.recipe_candidate!=='string'||!draft.recipe_candidate.trim())
    throw Error('Runtime Agent recipe_candidate must be a nonempty Markdown string; preserve this attempt and retry');
  if(git('rev-parse','HEAD')!==request.revision||git('status','--short','--untracked-files=all')!==beforeStatus)
    throw Error('Runtime Agent changed the frozen workspace during read-only discovery');
  const spec={schema:'project-runtime-spec-v1',acceptance:binding,
    source_checkout:request.source_checkout,revision:request.revision,
    components:request.components??[],component_sources:request.component_sources??{},
    test_roots:request.test_roots??[],
    dependency_files:draft.dependency_files,knowledge_used:draft.knowledge_used,
    setup_commands:draft.setup_commands,executables:draft.executables,smoke:draft.smoke,
    recipe_candidate:draft.recipe_candidate};
  const specPath=join(output,'agent-spec.json');
  writeFileSync(specPath,JSON.stringify(spec,null,2)+'\n');
  const prepared=JSON.parse(execFileSync(python,[host,'prepare',specPath,join(output,'runtime')],{encoding:'utf8'}));
  writeFileSync(join(output,'terminal.json'),JSON.stringify({state:'ready',...prepared,
    spec_sha256:createHash('sha256').update(readFileSync(specPath)).digest('hex'),
    finished_at:new Date().toISOString()},null,2)+'\n');
  metrics.status='ready';metrics.usage=done.usage;
  console.log(JSON.stringify(prepared));
}catch(e){metrics.status='blocked';metrics.error=e.message;throw e;}
finally{
  metrics.seconds=(performance.now()-started)/1000;metrics.tool_calls=tools;
  metrics.finished_at=new Date().toISOString();
  writeFileSync(join(output,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
}
