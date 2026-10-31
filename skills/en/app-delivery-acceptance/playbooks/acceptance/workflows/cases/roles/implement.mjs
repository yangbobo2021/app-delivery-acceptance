import {projectEnvironment} from "../../shared/runtime.mjs";
import {roleContinuation} from '../../../runtime/role-contract.mjs';
import {fileURLToPath} from 'node:url';
import {acceptanceGuard,knowledgeContext,requireWorkspaceLease} from '../../shared/guard.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {caseAdapter as createAgentRuntime,caseAgentPermissions} from '../../shared/case-agent.mjs';
import {verifyCase} from '../../shared/definitions.mjs';

const [inputArg,catalogArg,guideArg,outputArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume'),existingOnly=flags.includes('--existing-only');
if(!inputArg||!catalogArg||!guideArg||!outputArg)throw Error('usage: node implement.mjs input.json prepared-catalog.json project-guide.json new-output-dir');
const input=JSON.parse(readFileSync(resolve(inputArg),'utf8'));
if(input.case_strategy&&!['implement','existing_only'].includes(input.case_strategy))throw Error('Unknown case strategy');
if(input.case_strategy==='existing_only'&&!existingOnly)throw Error('Existing-only input requires the finder Agent');
if(existingOnly&&input.case_strategy==='implement')throw Error('Finder cannot resume an implementation input');
const discoveryOnly=existingOnly&&input.existing_case_mode==='discover_only';
if(input.existing_case_mode&&(!existingOnly||input.existing_case_mode!=='discover_only'))throw Error('Invalid existing case mode');
const catalogPath=resolve(catalogArg),catalogBytes=readFileSync(catalogPath),catalog=JSON.parse(catalogBytes);
const root=resolve(catalog.project_root),output=resolve(outputArg);
const acceptanceBinding=acceptanceGuard(catalog,[output]);
if(catalog.definitions){
 acceptanceGuard(input,[output]);
 if(JSON.stringify(catalog.definitions)!==JSON.stringify(input.definitions))throw Error('Case and catalog definitions differ');
}
const acceptanceKnowledge=knowledgeContext(acceptanceBinding);
requireWorkspaceLease(catalog,{output});
const guide=JSON.parse(readFileSync(resolve(guideArg),'utf8'));
if(catalog.schema!=='portable-project-catalog-v1')throw Error('Invalid project catalog');
verifyCase(input);
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==catalog.revision)throw Error('Project revision changed');
for(const part of catalog.components??[]){
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(root,part.path),encoding:'utf8'}).trim()!==part.revision)
  throw Error('Component revision changed: '+part.path);
}
const allowedRoots=(catalog.write_roots??catalog.test_roots).map(x=>x.replace(/\/$/,''));
if(git('diff','--name-only','HEAD').split('\n').filter(Boolean).some(x=>!allowedRoots.some(root=>x===root||x.startsWith(root+'/'))))
 throw Error('Tracked product/source changes in acceptance workspace');
if(resume){if(!existsSync(output))throw Error('resume output missing');}
else mkdirSync(output,{recursive:false});
const caseTool=fileURLToPath(new URL('../../../tools/case.mjs',import.meta.url));
const debug=discoveryOnly?null:JSON.parse(execFileSync(process.execPath,[caseTool,
 'debug-create',catalogPath,resolve(inputArg),join(output,'debug-contract.json')],{encoding:'utf8'}));
if(debug)mkdirSync(debug.request_root,{recursive:true});
const fingerprint=createHash('sha256').update(catalogBytes).digest('hex');
const guideBrief={coverage_tools:guide.coverage_tools,summary:guide.summary,fixture_isolation:guide.fixture_isolation,ui_state_notes:guide.ui_state_notes,
 environment_contract:(guide.environment_contract??[]).filter(x=>x.must_match&&x.must_match!=='无'),
 existing_test_examples:guide.existing_test_examples,uncertainties:guide.uncertainties};
const catalogBrief={execution_env:projectEnvironment(catalog),acceptance_knowledge:acceptanceKnowledge,project_root:catalog.project_root,revision:catalog.revision,components:catalog.components,coverage:catalog.coverage,
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
const searchGuidance=readFileSync(new URL('../../../contracts/case-search-guidance.md',import.meta.url),'utf8');
const reuseTools=existingOnly?null:JSON.parse(execFileSync(process.execPath,[caseTool,'reuse-start',catalogPath,resolve(inputArg),output],{encoding:'utf8'}));
const coverageContract=readFileSync(new URL('../../../contracts/coverage-tool-contract.md',import.meta.url),'utf8');
const uiInstruction=input.ui_acceptance?.required?`本场景另有 UI 可用性判据：${input.ui_acceptance.visual_expectation}。在项目准备确定的实际窗口/视口中，通过真实界面完成业务操作；对操作前、关键交互、成功或错误反馈等与判据相关的状态保存真实截图，并记录窗口尺寸与状态说明。将正式执行截图写入项目声明且由宿主冻结的输出绑定：执行相对路径 ${JSON.stringify(input.ui_acceptance.evidence_execution_relative_paths)}，或运行时环境变量目录 ${JSON.stringify(input.ui_acceptance.evidence_env_dir_keys)}。调试截图不算正式证据。不要用 DOM、坐标或程序判断代替截图的人工视觉审查。若截图无法由正式命令生成，报告限制，不能自称 UI 通过。`:'本场景未声明 UI 视觉验收；不要为非 UI 目标虚构截图要求。';
const implementationPrompt=`你负责一个验收场景的“用例实现与本地调试”，在同一个连续 Agent 过程中完成。工具初始目录为用户项目根目录 ${acceptanceBinding.project_root}，用于合法访问该验收的执行资料。实际源码和测试的唯一工作目录是 ${root}；所有项目命令必须先切换到这个绝对目录，文件编辑使用该目录内的绝对路径，不能修改初始目录中的另一份源码或 SPEC。当前场景持有独占执行权；前面场景的测试修改需要保留，运行状态与输出须为本次新建。允许修改项目常规测试目录，以及按调试契约写入请求和真实运行数据；禁止修改产品源码、需求、流程框架文件、真实外部数据或部署。全部验收信息在本任务输入中；无需查阅项目外的测试 SKILL 或 Playbook。${uiInstruction}

input.preparation_basis 是调用者本次准备或修补的具体操作要求，应按该显式输入执行；它不是新增业务判据，不能替代冻结需求和场景。

项目公共准备已完成。复用测试工具、依赖和环境能力，不重新安装或重新发现整个项目。目录与指南仅是操作路标，不是业务预期证据。你可自主读取项目代码与测试；先用 rg 定位，再读所需短片段。日志只看失败摘要与相关上下文，避免整仓读取或重复贴大日志。

只以给定需求与场景为目标。相关需求仅提供上下文。动手前用不超过三句话列出：本场景最重要的错误实现假设、能让正确与错误实现得出不同结果的输入，以及独立观察方法。尤其面对“资源可用、状态正确、数据一致”等判据，考虑仅凭浅层格式、状态码或非空值检查会放过什么；选择真实消费方仍无法使用的反例，而不是仅提供明显无效的值。不要强制使用某语言、格式或项目特定反例。先找一个最小但可判定的测试路径：真实输入、操作、可观察断言和隔离环境；先让它实际运行，再补足场景内尚未覆盖的不同错误机理。不要把同一机理的值与状态做无意义笛卡尔积；场景明确要求的每个状态和每类错误仍须覆盖，可用有依据的代表组合，先写覆盖清单。每个业务断言都要能追溯到原需求或冻结场景；本次新写断言应删除仅由当前实现习惯推断出的默认状态、数字文本写法、字段或输出顺序等额外约束；已有断言未被当前场景提及不代表错误，不得因此删除或放宽，同时保留数值、身份和状态的必要检查。测试结束后的清理异常也必须如实反映在命令退出码与结论中，不能自报通过。依据已有用例检查结果复用或补充，新测试放项目常规测试目录。若判据涉及说明是否具体、易懂或准确等语义，自动用例保留完整原始文本和对应状态，只断言可机械判定的事实；不要用关键词、当前文案或永远失败的断言冒充语义判定，交由独立审查判断。进入页面后先用当前 DOM 或截图识别所处状态，再选择定位器；不要假定上一场景的页面状态恒定。对尚未出现的元素先用约 5 秒的小超时检查，失败后检查页面，不要等待整场测试超时。测试失败时先分清环境、测试导航、产品或合同；修正具体原因后才重跑。不要反复运行同一失败命令，也不要靠删除断言、跳过测试或 mock 产品响应制造通过。若三次有针对性重跑后仍未完成，诚实输出 blocked 和已验证部分。

外部调度器会自动校验仓库与组件版本、文件变更并冻结重跑；不要自己扫描或哈希整仓，也不要自建审查凭证。你只需保留场景每项判据的真实执行观察，并给出可重跑的命令、环境变量和测试文件。test_command 将在固定的 workspace 根目录运行，不继承你调试 shell 临时 cd 的目录；文件路径和测试模块必须在该根目录可解析，不能只因从测试子目录可运行就认为宿主也可导入。统一入口的每次新 attempt 使用 debug-observation.json 完成标记、execution/execution.json 真实退出回执和 execution/execution.log 合并 stdout/stderr 日志，不产生 execution/stdout.log 或 stderr.log。先读取标记指向的回执与该合并日志；回执有 end_utc 和真实 exit_code、完成标记 status 为 observed 时，调试命令已经结束。product_verdict: not_performed 表示宿主尚未作正式产品判定，不表示调试还在运行；根据实际断言、日志和退出码报告本地结果，仍保留正式执行及独立复审。缺少完成标记、回执不完整或日志不匹配时保留失败，不声称本地通过。不要轮询不存在的分流日志或重跑已经有完整回执的命令。test_command 必须是原始业务用例命令（例如 node e2e/run-case.mjs），不能返回 run_coverage.py、run_evidence_v2.py 等采集包装命令；调度器会自动且只包装一次。本地调试仍须按覆盖率规约通过统一入口执行；不要把本地调试目录和请求包装成最终业务命令。如果统一调试入口因 Agent 运行环境无法启动原生应用，而公共准备已有该环境可运行的证据，且测试代码、命令、必要状态隔离与静态检查均已完成，可返回 host_ready：清楚记录本地未执行的业务判据与环境错误，交由调度器在正式宿主执行和独立复审；绝不能称本地通过或产品失败。若公共准备也不能运行，或测试命令仍不可执行，返回 blocked。test_files 必须列出本场景新增的所有非忽略测试与夹具文件，包括借用的配置和服务脚本；可额外列入依赖的已有测试文件。只输出 JSON 对象：{"status":"passed_local|product_failure|needs_contract|host_ready|blocked","test_files":["相对路径"],"test_command":["命令","参数"],"test_env":{"变量名":"值"},"observations":["真实观察"],"evidence_paths":["路径"],"limitations":["..."],"reason":"一句话"}。本地通过仍需独立审查。

场景输入中的 user_constraints 是本轮冻结的用户操作约束，须与场景和原文背景一同遵守，不新增无关验收义务。如果用户指定真实 CLI、HTTP 或 GUI 入口，不得仅为使覆盖率有命中而额外调用产品内部函数或把黑盒入口改为进程内调用。已验证准备不支持实际测试进程拓扑时，保留调试错误和原生数据，返回 blocked 并明确需要新的覆盖率准备；不能用该变通结果自称本地就绪。原本授权的函数级测试仍使用它的实际函数入口。

覆盖率强制执行规约：
${coverageContract}

本地调试契约（请求 JSON 必须写在 request_root 内，entry 后追加请求路径；只含 command、files、env，可选新 output。状态目录和项目声明的输出变量由入口绑定，禁止另写 /tmp 采集请求或直接调用底层执行器；最终 test_command 仍返回原始业务命令）：${JSON.stringify(debug)}

公共准备目录：${catalogPath}
必要操作信息：${JSON.stringify(catalogBrief)}
项目级操作指南：${JSON.stringify(guideBrief)}
场景输入：${JSON.stringify(input)}
定义来源说明：外部已有或用户直接给出的场景可以本身就是验收依据；requirement 为 null 表示没有单独上层需求，不补造需求。场景的 check 与 origin 记录实际采用方式，不将它冒称为独立审查。所有预期仍须可追溯到冻结的用户约定，不能从实现生成额外业务要求。`;
const displayContract=readFileSync(new URL('../../../contracts/case-display-contract.md',import.meta.url),'utf8');
const reuseContract=existingOnly?'':readFileSync(new URL('../../../contracts/case-reuse-contract.md',import.meta.url),'utf8');
const prompt=(existingOnly?`你负责一个验收场景的“已有用例查找${discoveryOnly?'（只读静态模式）':'与本地调试'}”。从当前冻结项目已有测试中寻找并选择适用用例，${discoveryOnly?'不得运行测试、收集、构建或启动应用':'按统一入口实际调试执行'}，输出与原用例Agent相同的JSON字段。项目资料根为 ${acceptanceBinding.project_root}，唯一源码/测试工作目录为 ${root}。公共环境已就绪，复用现有依赖，不重新准备环境。

硬约束：不得新建、修改、删除任何用例、断言、Fixture、测试辅助、产品源码、SPEC、配置或锁文件。不能生成新断言/业务请求/包装测试脚本冒充已有用例。${discoveryOnly?'本模式禁止写入任何项目文件或运行产物。':'只允许按下列统一调试契约在其request_root与隔离运行目录写入请求、日志、截图等真实运行产物。'}主项目与组件的既有文件和可跟踪文件集合由宿主前后核对；违规修改会被拒绝。不要修改原开发目录或个人真实App配置。

${searchGuidance}
先用rg定位，再阅读候选测试及必要辅助函数，检查条件、操作、断言、Mock和隔离方法。可选择多个互补的已有测试，使用项目既有命令与筛选参数。相似名称、覆盖同一代码或历史通过都不能证明本场景已覆盖。不强行补齐缺口，不修改断言以制造通过；部分支持、冗余、无法确认的预期如实写入limitations。多个测试的命令使用既有框架支持的组合方式；没有合法组合入口时保留限制，不临时编写新测试入口。

${discoveryOnly?'仅静态查找，允许读取、检索源码和查询项目元数据；不运行测试、构建、应用命令或调试请求。返回 status: not_executed；observations 和 evidence_paths 必须为空。已有运行入口仅作为建议记录，不声称已验证可运行。没有关联仍返回 not_executed，说明实际查找范围和限制。':`使用统一调试入口真实运行所选现有测试，保留实际观察与失败原因，不能只做静态查找就自称passed_local。测试失败时区分环境、测试、产品或合同；仅可针对已确认的临时运行条件调整后重试，最多三次，不编辑业务测试。没有找到用例或无法运行时返回blocked并保留查找范围、观察和限制。运行环境确实限制Agent而宿主已证明可执行时可按既有规则返回host_ready，明确未执行部分；合同未明返回needs_contract。测试退出成功仅为本地结果，仍需正式执行和独立复审。`}

输出同一结构：{"status":"${discoveryOnly?'not_executed':'passed_local|product_failure|needs_contract|host_ready|blocked'}","test_files":["已有测试及必要辅助文件相对路径"],"test_command":["原始业务命令","参数"],"test_env":{},"observations":["实际调试观察，注明具体测试项与支持的预期"],"evidence_paths":["实际证据路径"],"limitations":["缺口、查找范围或环境限制"],"reason":"一句话"}。blocked且没有合法命令时test_command可以为空。所有test_files必须在本Agent启动之前已经存在。禁止捏造执行观察。

${discoveryOnly?'仅静态识别显式 UI 判据的测试支持和边界，不启动界面。':uiInstruction}
${discoveryOnly?'没有调试/覆盖率执行授权。':`覆盖率规约：${coverageContract}\n统一调试契约：${JSON.stringify(debug)}。每次 attempt 的完成标记是 debug-observation.json，实际回执与合并日志分别为 execution/execution.json、execution/execution.log；不产生分流 stdout.log/stderr.log。observed 且回执已结束表示本地执行完成，product_verdict:not_performed 仅表示宿主未作正式产品判定。请求只含command/files/env及可选新output；最终test_command返回原始业务命令，不返回采集器包装命令。`}
已有用例选择与引用契约：
${readFileSync(new URL('../../../contracts/case-discovery-contract.md',import.meta.url),'utf8')}
公共准备：${JSON.stringify(catalogBrief)}
项目指南：${JSON.stringify(guideBrief)}
冻结场景与需求：${JSON.stringify(input)}`:implementationPrompt+`\n\n共用的场景查找标准：\n${searchGuidance}\n生成前复用检查（先完成再修改或运行测试）：\n${reuseContract}\n已有用例结构与引用要求（checkpoint请求使用此结构，仅描述原已有用例）：\n${readFileSync(new URL('../../../contracts/case-discovery-contract.md',import.meta.url),'utf8')}\n宿主复用检查工具：${JSON.stringify(reuseTools)}。先将checkpoint请求写到request_path，再执行checkpoint数组并追加该请求文件路径。成功后才进入测试修改和统一调试；恢复时若record_path已存在则复用冻结记录，不覆盖checkpoint。查找检查点已由宿主保存，最终实现答案不要再回填 case_discovery；最终当前关联只列 case_descriptions，历史取舍列 case_reuse。最终JSON还须包含case_reuse，且必须写明 case_reuse.schema 为固定字符串 case-reuse-plan-v1；不能省略此协议字段。提交之前，将完整最终候选 JSON 写到 final_request_path，执行 final_check 数组并追加该文件路径；按实际校验错误修正候选，直至 valid，再原样提交同一对象。此预检不运行业务测试，也不是独立复审。source.title 必须是源码选定行段内实际连续出现的原始声明名；不要把类名和方法名拼成源码中不存在的限定字符串。`)+`\n\n用例说明输出契约（在原JSON中增加case_descriptions，不另输出文档）：\n${displayContract}\n提交前执行契约中的标题自查：只读 name 列表也能看懂各项实际验证的行为；删去不必要的实现步骤，保留区分条件与真实观察边界。`;
if(existingOnly)execFileSync(process.execPath,[caseTool,'policy-start',catalogPath,output],{encoding:'utf8'});
if(resume){if(readFileSync(join(output,'prompt.txt'),'utf8')!==prompt)throw Error('resume prompt changed');}
else writeFileSync(join(output,'prompt.txt'),prompt);
let resumeSession;
if(resume){
 const events=readFileSync(join(output,'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 resumeSession=events.find(x=>x.type==='init')?.sessionId;
 if(!resumeSession||events.some(x=>x.type==='done'&&x.payload?.status==='success'))
  throw Error('No interrupted Agent session to resume');
}
const agent=createAgentRuntime({directory:output,resume,role:existingOnly?'finder':'implementer'});
const result={agent_runtime:agent.metadata,model:agent.metadata.model,effort:agent.metadata.effort,started_at:new Date().toISOString(),
 input_sha256:createHash('sha256').update(readFileSync(resolve(inputArg))).digest('hex'),
 catalog_sha256:fingerprint,revision:catalog.revision,scene_id:input.scene.id,prompt_characters:prompt.length,
 ...(resume?{resumed_from_session:resumeSession}:{})};
const t=performance.now(),texts=[];let done,error,tools=0;
const strings={type:'array',items:{type:'string'}};
const jsonResultSchema=existingOnly?undefined:{type:'object',additionalProperties:true,
 properties:{status:{type:'string',enum:['passed_local','product_failure','needs_contract','host_ready','blocked']},
  test_files:strings,test_command:strings,test_env:{type:'object',additionalProperties:{type:'string'}},
  observations:strings,evidence_paths:strings,limitations:strings,reason:{type:'string'},
  case_descriptions:{type:'array',items:{type:'object',additionalProperties:true}},
  case_reuse:{type:'object',additionalProperties:true,
   properties:{schema:{type:'string',enum:['case-reuse-plan-v1']},
    decisions:{type:'array',items:{type:'object',additionalProperties:true,
     properties:{case_id:{type:'string'},action:{type:'string',enum:['reuse','extend','new']},existing_case_ids:strings,obligation_ids:strings,reason:{type:'string'}},
     required:['case_id','action','existing_case_ids','obligation_ids','reason']}},
    not_selected:{type:'array',description:'Only IDs from the frozen checkpoint discovery.case_descriptions that were not selected. Never excluded_candidates or filenames; [] when all existing cases selected.',
     items:{type:'object',additionalProperties:false,properties:{case_id:{type:'string',description:'Exact existing case ID, not a file path or excluded candidate'},reason:{type:'string'}},required:['case_id','reason']}},limitations:strings},
   required:['schema','decisions','not_selected','limitations']}},
 required:['status','test_files','test_command','test_env','observations','evidence_paths','limitations','reason','case_descriptions','case_reuse']};
try{
 writeFileSync(join(output,'runner.pid'),String(process.pid)+'\n');
 const task=resume?(existingOnly?`继续同一冻结场景的已有用例查找${discoveryOnly?'（只读，不运行测试或应用）':'与调试'}；保留原有测试和产品文件，不新增不修改，只完成未完成步骤，最后返回原格式JSON。`:'继续同一场景用例实现与本地调试。先核对当前测试文件和已执行观察，只完成尚未做完的工作；不要重复已确认的外部效果。最终仅输出原任务要求的 JSON。'):prompt;
 for await(const event of agent.run(task,{jsonOutput:true,jsonResultSchema,cwd:acceptanceBinding.project_root,model:result.model,effort:result.effort,
  ...(resume?{resume:resumeSession}:{}),
  permissions:discoveryOnly?{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}:caseAgentPermissions})){
  appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
  if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
  if(event.type==='tool_use')tools++;
  if(event.type==='done')done=event.payload;
  if(event.type==='error')error=event.payload?.message;
 }
 let raw=(texts.at(-1)??'').trim(),answer;
 const parse=value=>JSON.parse(value.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 try{answer=parse(raw);}catch(e){result.parse_error=e.message;}
 // A native structured tool can still omit a nested required field. Keep the
 // original submission and ask the SAME session to repair only that literal.
 // No business content, command, observation or source may change.
 if(!existingOnly&&done?.status==='success'&&answer?.case_reuse&&answer.case_reuse.schema===undefined){
  writeFileSync(join(output,'answer.protocol-original.txt'),raw+'\n');
  writeFileSync(join(output,'answer.protocol-original.json'),JSON.stringify(answer,null,2)+'\n');
  const session=roleContinuation(output)??readFileSync(join(output,'agent.jsonl'),'utf8').trim().split('\n').map(JSON.parse).find(e=>e.type==='init')?.sessionId;
  if(!session)throw Error('Protocol correction has no originating session');
  result.protocol_correction={reason:'missing case_reuse.schema',session,initial_usage:done.usage,
   original_sha256:createHash('sha256').update(raw).digest('hex')};
  const expected=structuredClone(answer);expected.case_reuse.schema='case-reuse-plan-v1';
  const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
   ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const fix='Your native structured submission omitted the mandatory fixed protocol field case_reuse.schema. Submit the SAME task JSON object with only case_reuse.schema added as the exact string "case-reuse-plan-v1". Preserve every other value, list item, command, observation, source and conclusion byte-for-byte as JSON values. Do not run tools, read or change files, debug, or repeat tests. This is one protocol correction, not a new test or review. Original task object: '+JSON.stringify(answer);
  let correctionDone;
  for await(const event of agent.run(fix,{jsonOutput:true,jsonResultSchema,resume:session,cwd:acceptanceBinding.project_root,
   model:result.model,effort:result.effort,permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}})){
   appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
   if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
   if(event.type==='tool_use'){tools++;if(event.payload?.toolName!=='StructuredOutput')throw Error('Protocol correction attempted a non-submission tool');}
   if(event.type==='done')correctionDone=event.payload;
   if(event.type==='error')throw Error(event.payload?.message??'Protocol correction failed');
  }
  if(correctionDone?.status!=='success')throw Error('Protocol correction did not complete');
  raw=(texts.at(-1)??'').trim();const fixed=parse(raw);
  if(canonical(fixed)!==canonical(expected))throw Error('Protocol correction changed content beyond the missing fixed marker');
  answer=fixed;result.protocol_correction.status='corrected';result.protocol_correction.usage=correctionDone.usage;
 }
 writeFileSync(join(output,'answer.txt'),raw+'\n');
 if(answer)writeFileSync(join(output,'answer.json'),JSON.stringify(answer,null,2)+'\n');
 result.status=done?.status;result.usage=done?.usage;result.error=error;
}catch(e){result.status='error';result.error=e.message;}
finally{if(existsSync(join(output,'runner.pid')))unlinkSync(join(output,'runner.pid'));}
result.seconds=(performance.now()-t)/1000;result.tool_calls=agent.metadata.transport?.profile==='standard'?null:tools;result.finished_at=new Date().toISOString();
result.head_after=git('rev-parse','HEAD');result.tracked_changes=git('diff','--name-only','HEAD');
result.status_after=git('status','--short','--untracked-files=all');
result.components_after=(catalog.components??[]).map(part=>({path:part.path,
 revision:execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(root,part.path),encoding:'utf8'}).trim()}));
const writeRoots=(catalog.write_roots??catalog.test_roots).map(x=>x.replace(/\/$/,''));
const changed=result.tracked_changes.split('\n').filter(Boolean);
if(result.head_after!==catalog.revision||changed.some(x=>!writeRoots.some(root=>x===root||x.startsWith(root+'/')))||
 result.components_after.some((part,i)=>part.revision!==catalog.components[i].revision))result.invalid_source_change=true;
if(existingOnly){
 try{execFileSync(process.execPath,[caseTool,'policy-verify',catalogPath,output],{encoding:'utf8'});}
 catch(e){result.invalid_source_change=true;result.status='error';result.error='Existing-only file protection failed: '+String(e.stderr??e.message);}
}
if(existingOnly&&result.status==='success'&&existsSync(join(output,'answer.json'))){
 try{
  const checked=execFileSync(process.execPath,[caseTool,'discovery',catalogPath,resolve(inputArg),output,...(discoveryOnly?['--discovery-only']:[])],{encoding:'utf8'});
  writeFileSync(join(output,'case-discovery.json'),checked+'\n');result.discovery_validated=true;
 }catch(e){result.invalid_discovery=true;result.status='error';result.error='Existing case discovery contract failed: '+String(e.stderr??e.message);}
}
if(!existingOnly&&result.status==='success'&&existsSync(join(output,'answer.json'))){
 try{
  const checked=JSON.parse(execFileSync(process.execPath,[caseTool,'reuse-verify',catalogPath,resolve(inputArg),output],{encoding:'utf8'}));
  result.reuse_validated=checked.status==='available';
 }catch(e){result.invalid_reuse=true;result.status='error';result.error='Case reuse contract failed: '+String(e.stderr??e.message);}
}
if(result.status==='success'&&!result.parse_error&&!result.invalid_source_change&&existsSync(join(output,'answer.json'))){
 try{
  const rawAnswer=JSON.parse(readFileSync(join(output,'answer.json'),'utf8'));
  if(rawAnswer.case_identity)throw Error('Agent must not manufacture host identity reports');
  execFileSync(process.execPath,[caseTool,'identity',catalogPath,resolve(inputArg),output],{encoding:'utf8',maxBuffer:16*1024*1024});
  result.identities_validated=true;
  if(!existingOnly)execFileSync(process.execPath,[caseTool,'reuse-verify',catalogPath,resolve(inputArg),output],{encoding:'utf8'});
  if(existingOnly){
   execFileSync(process.execPath,[caseTool,'policy-verify',catalogPath,output],{encoding:'utf8'});
   writeFileSync(join(output,'case-discovery.json'),readFileSync(join(output,'answer.json')));
  }
 }catch(e){result.status='error';result.error='Case identity finalization failed: '+String(e.stderr??e.message);}
}
writeFileSync(join(output,'metrics.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({scene:input.scene.id,status:result.status,seconds:result.seconds,tool_calls:result.tool_calls,
 usage:result.usage,parse_error:result.parse_error,invalid_source_change:result.invalid_source_change,error:result.error}));
