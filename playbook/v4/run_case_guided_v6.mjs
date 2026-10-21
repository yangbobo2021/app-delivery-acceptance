import {acceptanceGuard,knowledgeContext,requireWorkspaceLease} from '../acceptance-guard.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {caseAdapter as createAgentRuntime,caseAgentPermissions} from './case_agent_access.mjs';

const [inputArg,catalogArg,guideArg,outputArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume');
if(!inputArg||!catalogArg||!guideArg||!outputArg)throw Error('usage: node run_case_guided_v6.mjs input.json prepared-catalog.json project-guide.json new-output-dir');
const input=JSON.parse(readFileSync(resolve(inputArg),'utf8'));
const catalogPath=resolve(catalogArg),catalogBytes=readFileSync(catalogPath),catalog=JSON.parse(catalogBytes);
const root=resolve(catalog.project_root),output=resolve(outputArg);
const acceptanceBinding=acceptanceGuard(catalog,[output]);
if(catalog.definitions){
 acceptanceGuard(input,[output]);
 if(JSON.stringify(catalog.definitions)!==JSON.stringify(input.definitions))throw Error('Case and catalog definitions differ');
}
const acceptanceKnowledge=knowledgeContext(acceptanceBinding);
requireWorkspaceLease(catalog);
const guide=JSON.parse(readFileSync(resolve(guideArg),'utf8'));
if(catalog.schema!=='portable-project-catalog-v1')throw Error('Invalid project catalog');
execFileSync('python3',[new URL('../../scripts/acceptance_definitions.py',import.meta.url).pathname,
 'verify-case',resolve(inputArg)],{encoding:'utf8'});
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==catalog.revision)throw Error('Project revision changed');
for(const part of catalog.components??[]){
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(root,part.path),encoding:'utf8'}).trim()!==part.revision)
  throw Error('Component revision changed: '+part.path);
}
const allowedRoots=(catalog.write_roots??catalog.test_roots).map(x=>x.replace(/\/$/,'')+'/');
if(git('diff','--name-only','HEAD').split('\n').filter(Boolean).some(x=>!allowedRoots.some(root=>x.startsWith(root))))
 throw Error('Tracked product/source changes in acceptance workspace');
if(resume){if(!existsSync(output))throw Error('resume output missing');}
else mkdirSync(output,{recursive:false});
const debug=JSON.parse(execFileSync('python3',[new URL('./debug_case.py',import.meta.url).pathname,
 'create',catalogPath,resolve(inputArg),join(output,'debug-contract.json')],{encoding:'utf8'}));
mkdirSync(debug.request_root,{recursive:true});
const fingerprint=createHash('sha256').update(catalogBytes).digest('hex');
const guideBrief={coverage_tools:guide.coverage_tools,summary:guide.summary,fixture_isolation:guide.fixture_isolation,ui_state_notes:guide.ui_state_notes,
 environment_contract:(guide.environment_contract??[]).filter(x=>x.must_match&&x.must_match!=='无'),
 existing_test_examples:guide.existing_test_examples,uncertainties:guide.uncertainties};
const catalogBrief={acceptance_knowledge:acceptanceKnowledge,project_root:catalog.project_root,revision:catalog.revision,components:catalog.components,coverage:catalog.coverage,
 test_roots:catalog.test_roots,source_roots:catalog.source_roots,runner_hints:catalog.runner_hints,
 capability_checks:(catalog.capability_checks??[]).map(x=>({command:x.command,env:x.env,exit_code:x.exit_code}))};
const inputText=JSON.stringify(input,null,2)+'\n';
const bindingText=JSON.stringify({path:catalogPath,sha256:fingerprint,
 guide_path:resolve(guideArg),guide_sha256:createHash('sha256').update(readFileSync(resolve(guideArg))).digest('hex')},null,2)+'\n';
if(resume){
 if(readFileSync(join(output,'input.json'),'utf8')!==inputText||
    readFileSync(join(output,'catalog-binding.json'),'utf8')!==bindingText)
  throw Error('resume input/catalog binding changed');
}else{
 writeFileSync(join(output,'input.json'),inputText);
 writeFileSync(join(output,'catalog-binding.json'),bindingText);
}
const coverageContract=readFileSync(new URL('../../references/coverage-tool-contract.md',import.meta.url),'utf8');
const uiInstruction=input.ui_acceptance?.required?`本场景另有 UI 可用性判据：${input.ui_acceptance.visual_expectation}。在项目准备确定的实际窗口/视口中，通过真实界面完成业务操作；对操作前、关键交互、成功或错误反馈等与判据相关的状态保存真实截图，并记录窗口尺寸与状态说明。将正式执行截图写入项目声明且由宿主冻结的输出绑定：执行相对路径 ${JSON.stringify(input.ui_acceptance.evidence_execution_relative_paths)}，或运行时环境变量目录 ${JSON.stringify(input.ui_acceptance.evidence_env_dir_keys)}。调试截图不算正式证据。不要用 DOM、坐标或程序判断代替截图的人工视觉审查。若截图无法由正式命令生成，报告限制，不能自称 UI 通过。`:'本场景未声明 UI 视觉验收；不要为非 UI 目标虚构截图要求。';
const prompt=`你负责一个验收场景的“用例实现与本地调试”，在同一个连续 Agent 过程中完成。工具初始目录为用户项目根目录 ${acceptanceBinding.project_root}，用于合法访问该验收的执行资料。实际源码和测试的唯一工作目录是 ${root}；所有项目命令必须先切换到这个绝对目录，文件编辑使用该目录内的绝对路径，不能修改初始目录中的另一份源码或 SPEC。当前场景持有独占执行权；前面场景的测试修改需要保留，运行状态与输出须为本次新建。允许修改项目常规测试目录，以及按调试契约写入请求和真实运行数据；禁止修改产品源码、需求、流程框架文件、真实外部数据或部署。全部验收信息在本任务输入中；无需查阅项目外的测试 SKILL 或 Playbook。${uiInstruction}

项目公共准备已完成。复用测试工具、依赖和环境能力，不重新安装或重新发现整个项目。目录与指南仅是操作路标，不是业务预期证据。你可自主读取项目代码与测试；先用 rg 定位，再读所需短片段。日志只看失败摘要与相关上下文，避免整仓读取或重复贴大日志。

只以给定需求与场景为目标。相关需求仅提供上下文。动手前用不超过三句话列出：本场景最重要的错误实现假设、能让正确与错误实现得出不同结果的输入，以及独立观察方法。尤其面对“资源可用、状态正确、数据一致”等判据，考虑仅凭浅层格式、状态码或非空值检查会放过什么；选择真实消费方仍无法使用的反例，而不是仅提供明显无效的值。不要强制使用某语言、格式或项目特定反例。先找一个最小但可判定的测试路径：真实输入、操作、可观察断言和隔离环境；先让它实际运行，再补足场景内尚未覆盖的不同错误机理。不要把同一机理的值与状态做无意义笛卡尔积；场景明确要求的每个状态和每类错误仍须覆盖，可用有依据的代表组合，先写覆盖清单。每个业务断言都要能追溯到原需求或冻结场景；删除仅由当前实现习惯推断出的默认状态、数字文本写法、字段或输出顺序等额外约束，同时保留数值、身份和状态的必要检查。测试结束后的清理异常也必须如实反映在命令退出码与结论中，不能自报通过。优先复用已有用例，新测试放项目常规测试目录。若判据涉及说明是否具体、易懂或准确等语义，自动用例保留完整原始文本和对应状态，只断言可机械判定的事实；不要用关键词、当前文案或永远失败的断言冒充语义判定，交由独立审查判断。进入页面后先用当前 DOM 或截图识别所处状态，再选择定位器；不要假定上一场景的页面状态恒定。对尚未出现的元素先用约 5 秒的小超时检查，失败后检查页面，不要等待整场测试超时。测试失败时先分清环境、测试导航、产品或合同；修正具体原因后才重跑。不要反复运行同一失败命令，也不要靠删除断言、跳过测试或 mock 产品响应制造通过。若三次有针对性重跑后仍未完成，诚实输出 blocked 和已验证部分。

外部调度器会自动校验仓库与组件版本、文件变更并冻结重跑；不要自己扫描或哈希整仓，也不要自建审查凭证。你只需保留场景每项判据的真实执行观察，并给出可重跑的命令、环境变量和测试文件。test_command 必须是原始业务用例命令（例如 node e2e/run-case.mjs），不能返回 run_coverage.py、run_evidence_v2.py 等采集包装命令；调度器会自动且只包装一次。本地调试仍须按覆盖率规约通过统一入口执行；不要把本地调试目录和请求包装成最终业务命令。如果统一调试入口因 Agent 运行环境无法启动原生应用，而公共准备已有该环境可运行的证据，且测试代码、命令、必要状态隔离与静态检查均已完成，可返回 host_ready：清楚记录本地未执行的业务判据与环境错误，交由调度器在正式宿主执行和独立复审；绝不能称本地通过或产品失败。若公共准备也不能运行，或测试命令仍不可执行，返回 blocked。test_files 必须列出本场景新增的所有非忽略测试与夹具文件，包括借用的配置和服务脚本；可额外列入依赖的已有测试文件。只输出 JSON 对象：{"status":"passed_local|product_failure|needs_contract|host_ready|blocked","test_files":["相对路径"],"test_command":["命令","参数"],"test_env":{"变量名":"值"},"observations":["真实观察"],"evidence_paths":["路径"],"limitations":["..."],"reason":"一句话"}。本地通过仍需独立审查。

覆盖率强制执行规约：
${coverageContract}

本地调试契约（请求 JSON 必须写在 request_root 内，entry 后追加请求路径；只含 command、files、env，可选新 output。状态目录和项目声明的输出变量由入口绑定，禁止另写 /tmp 采集请求或直接调用底层执行器；最终 test_command 仍返回原始业务命令）：${JSON.stringify(debug)}

公共准备目录：${catalogPath}
必要操作信息：${JSON.stringify(catalogBrief)}
项目级操作指南：${JSON.stringify(guideBrief)}
场景输入：${JSON.stringify(input)}
定义来源说明：外部已有或用户直接给出的场景可以本身就是验收依据；requirement 为 null 表示没有单独上层需求，不补造需求。场景的 check 与 origin 记录实际采用方式，不将它冒称为独立审查。所有预期仍须可追溯到冻结的用户约定，不能从实现生成额外业务要求。`;
if(resume){if(readFileSync(join(output,'prompt.txt'),'utf8')!==prompt)throw Error('resume prompt changed');}
else writeFileSync(join(output,'prompt.txt'),prompt);
let resumeSession;
if(resume){
 const events=readFileSync(join(output,'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 resumeSession=events.find(x=>x.type==='init')?.sessionId;
 if(!resumeSession||events.some(x=>x.type==='done'&&x.payload?.status==='success'))
  throw Error('No interrupted Agent session to resume');
}
const agent=createAgentRuntime({directory:output,resume});
const result={agent_runtime:agent.metadata,model:agent.metadata.model,effort:agent.metadata.effort,started_at:new Date().toISOString(),
 input_sha256:createHash('sha256').update(readFileSync(resolve(inputArg))).digest('hex'),
 catalog_sha256:fingerprint,revision:catalog.revision,scene_id:input.scene.id,prompt_characters:prompt.length,
 ...(resume?{resumed_from_session:resumeSession}:{})};
const t=performance.now(),texts=[];let done,error,tools=0;
try{
 writeFileSync(join(output,'runner.pid'),String(process.pid)+'\n');
 const task=resume?'继续同一场景用例实现与本地调试。先核对当前测试文件和已执行观察，只完成尚未做完的工作；不要重复已确认的外部效果。最终仅输出原任务要求的 JSON。':prompt;
 for await(const event of agent.run(task,{cwd:acceptanceBinding.project_root,model:result.model,effort:result.effort,
  ...(resume?{resume:resumeSession}:{}),
  permissions:caseAgentPermissions})){
  appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
  if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
  if(event.type==='tool_use')tools++;
  if(event.type==='done')done=event.payload;
  if(event.type==='error')error=event.payload?.message;
 }
 const raw=(texts.at(-1)??'').trim();writeFileSync(join(output,'answer.txt'),raw+'\n');
 try{writeFileSync(join(output,'answer.json'),JSON.stringify(JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),null,2)+'\n');}
 catch(e){result.parse_error=e.message;}
 result.status=done?.status;result.usage=done?.usage;result.error=error;
}catch(e){result.status='error';result.error=e.message;}
finally{if(existsSync(join(output,'runner.pid')))unlinkSync(join(output,'runner.pid'));}
result.seconds=(performance.now()-t)/1000;result.tool_calls=tools;result.finished_at=new Date().toISOString();
result.head_after=git('rev-parse','HEAD');result.tracked_changes=git('diff','--name-only','HEAD');
result.status_after=git('status','--short','--untracked-files=all');
result.components_after=(catalog.components??[]).map(part=>({path:part.path,
 revision:execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(root,part.path),encoding:'utf8'}).trim()}));
const writeRoots=(catalog.write_roots??catalog.test_roots).map(x=>x.replace(/\/$/,'')+'/');
const changed=result.tracked_changes.split('\n').filter(Boolean);
if(result.head_after!==catalog.revision||changed.some(x=>!writeRoots.some(root=>x.startsWith(root)))||
 result.components_after.some((part,i)=>part.revision!==catalog.components[i].revision))result.invalid_source_change=true;
writeFileSync(join(output,'metrics.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({scene:input.scene.id,status:result.status,seconds:result.seconds,tool_calls:tools,
 usage:result.usage,parse_error:result.parse_error,invalid_source_change:result.invalid_source_change,error:result.error}));
