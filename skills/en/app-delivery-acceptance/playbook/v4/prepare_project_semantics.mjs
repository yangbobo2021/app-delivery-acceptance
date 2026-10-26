import {acceptanceGuard,knowledgeContext} from '../acceptance-guard.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createAgentRuntime} from '../v3/runtime-path.mjs';

const [catalogArg,outputArg]=process.argv.slice(2);
if(!catalogArg||!outputArg)throw Error('usage: node prepare_project_semantics.mjs prepared-catalog.json new-output-dir');
const catalogPath=resolve(catalogArg),bytes=readFileSync(catalogPath),catalog=JSON.parse(bytes);
if(catalog.schema!=='portable-project-catalog-v1')throw Error('Invalid project catalog');
const output=resolve(outputArg);
const acceptanceBinding=acceptanceGuard(catalog,[output]);
const acceptanceKnowledge=knowledgeContext(acceptanceBinding);
mkdirSync(output,{recursive:false});
const coverageContract=readFileSync(new URL('../../references/coverage-tool-contract.md',import.meta.url),'utf8');
const prompt=`你负责一次性项目测试准备补充，只发现项目运行测试所需的操作事实，不设计需求、场景或用例，也不执行测试。项目目录：${catalog.project_root}。确定性准备目录已经存在，见输入。优先读取测试命令配置、测试助手和一份代表性既有测试，最多十次短源码读取，单次输出尽量不超过4KB。禁止读取正式测试SKILL或扫描整仓；禁止修改文件、安装依赖或连接外部服务。不要把具体业务预期硬编码为所有测试的规则。

最终只输出 JSON：{"runner_command_hint":["程序","参数"],"environment_contract":[{"name":"变量名","purpose":"用途","must_match":"与哪个服务/测试路径共享或无"}],"fixture_isolation":"每次尝试如何隔离状态","existing_test_examples":["相对路径"],"smoke_command_hint":["程序","参数"],"source_basis":[{"path":"项目内相对路径","why":"依据"}],"coverage_tools":[{"role":"collector|converter|source_map|statistics","name":"工具名","version":"实测版本或未记录","invocation":"实际命令或API","supported_metrics":["lines","branches"],"basis":"项目证据或明确未知"}],"uncertainties":["..."],"summary":"一两句话"}。发现不了的字段用空数组或明确不确定，不要猜测。此结果只作为后续Agent的项目级操作路标，不是验收预期证据。

source_basis 只引用工作区内已经读取的真实文件，path 是不带注释的精确相对路径。项目外运行环境/覆盖率 manifest 只能在 coverage_tools.basis 等说明字段引用，不能伪装成项目内 source_basis 路径。可核对的已冻结项目文件：${JSON.stringify([...new Set([...(catalog.source_paths??[]),...Object.keys(catalog.binding_files??{}),...Object.keys(catalog.coverage_test_files??{})])])}。

覆盖率强制执行规约：
${coverageContract}

项目验收经验（操作参考，不是业务预期）：${JSON.stringify(acceptanceKnowledge)}\n确定性准备：${JSON.stringify(catalog)}`;
writeFileSync(join(output,'prompt.txt'),prompt);
const agent=createAgentRuntime({directory:output});
const result={agent_runtime:agent.metadata,model:agent.metadata.model,effort:agent.metadata.effort,started_at:new Date().toISOString(),
 catalog_sha256:createHash('sha256').update(bytes).digest('hex'),prompt_characters:prompt.length};
const t=performance.now(),texts=[];let done,error,tools=0;
try{
 for await(const event of agent.run(prompt,{jsonOutput:true,cwd:resolve(catalog.project_root),model:result.model,effort:result.effort,
  permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}})){
  appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
  if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
  if(event.type==='tool_use')tools++;
  if(event.type==='done')done=event.payload;
  if(event.type==='error')error=event.payload?.message;
 }
 const raw=(texts.at(-1)??'').trim();writeFileSync(join(output,'answer.txt'),raw+'\n');
 const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 if(!Array.isArray(parsed.source_basis)||!parsed.source_basis.length)throw Error('Source basis missing');
 for(const item of parsed.source_basis){
  const path=resolve(catalog.project_root,item.path);
  if(!path.startsWith(resolve(catalog.project_root)+'/'))throw Error('Invalid basis path');
  readFileSync(path);
 }
 writeFileSync(join(output,'guide.json'),JSON.stringify(parsed,null,2)+'\n');
 result.status=done?.status;result.usage=done?.usage;result.error=error;
}catch(e){result.status='error';result.error=e.message;}
result.seconds=(performance.now()-t)/1000;result.tool_calls=tools;result.finished_at=new Date().toISOString();
writeFileSync(join(output,'metrics.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,seconds:result.seconds,tool_calls:tools,usage:result.usage,error:result.error}));

if(result.status!=='success')process.exitCode=2;
