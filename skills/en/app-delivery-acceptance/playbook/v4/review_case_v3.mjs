import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {createAgentRuntime} from '../v3/runtime-path.mjs';

const [checkoutArg,inputArg,outputArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume');
if(!checkoutArg||!inputArg||!outputArg)throw Error('usage: node review-case.mjs checkout input-json output-dir');
const checkout=resolve(checkoutArg),input=JSON.parse(readFileSync(resolve(inputArg),'utf8')),output=resolve(outputArg);
const gatePath=resolve(input.handoff_gate_path??'');
if(!input.handoff_gate_path)throw Error('handoff_gate_path required');
const gate=JSON.parse(readFileSync(gatePath,'utf8'));
if(gate.status!=='ready_for_review'||gate.scene_id!==input.scene.id)throw Error('review handoff not ready');
execFileSync('python3',[fileURLToPath(new URL('../../scripts/acceptance_definitions.py',import.meta.url)),
 'verify-case',resolve(inputArg)],{encoding:'utf8'});
const inputText=JSON.stringify(input,null,2)+'\n';
if(resume){
 if(!existsSync(output)||readFileSync(join(output,'input.json'),'utf8')!==inputText)
  throw Error('review resume input changed or output missing');
}else{
 mkdirSync(output,{recursive:false});writeFileSync(join(output,'input.json'),inputText);
}
const coverageContract=readFileSync(new URL('../../references/coverage-tool-contract.md',import.meta.url),'utf8');
const imageInputs=[];
const imageAliases={};
if(input.ui_acceptance?.required){
 const manifest=JSON.parse(readFileSync(input.frozen_evidence_manifest,'utf8'));
 const firstByHash=new Map();
 for(const item of manifest.files??[]){
  if(!/\.(png|jpe?g|webp)$/i.test(item.path))continue;
  const bytes=readFileSync(item.path),actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==item.sha256)throw Error('Frozen UI image changed: '+item.path);
  if(firstByHash.has(actual))imageAliases[item.path]=firstByHash.get(actual);
  else{firstByHash.set(actual,item.path);imageInputs.push({path:item.path,sha256:actual});}
 }
 if(imageInputs.length>24)throw Error('UI scene has more than 24 distinct frozen images; select representative states in the case');
}
const uiInstruction=input.ui_acceptance?.required?`本场景包含 UI 可用性验收。下列 ${imageInputs.length} 张不同内容的冻结图片以多模态输入直接附在本消息后，并与相同顺序的绝对路径一一对应：${JSON.stringify(imageInputs.map(x=>x.path))}。相同像素的其他冻结路径复用已附图片：${JSON.stringify(imageAliases)}。必须直接观察这些图片像素，分别判断用户任务能否完成，以及关键状态下控件和内容是否无遮挡/裁切、可读、布局和基本视觉完成度是否合理。按冻结场景的视觉判据和项目依据审查；没有设计稿时核对排版层次、间距、对齐、字体与控件的一致性，不能因为当前项目一直使用裸默认样式就自动放行，但不强加具体品牌、配色或像素规格。在回答中新增 ui_review={"status":"passed|failed|unverified","screenshot_paths":["实际观察的冻结图片绝对路径"],"reason":"具体视觉观察和项目依据"}。若没有附图、图片不可读或缺窗口/状态上下文，用 unverified，整体返回 repair_required 或 inconclusive。不能从源码、DOM、文件存在或自己的想象声称看过图片。若像素清楚证明视觉缺陷，即使业务命令退出码为 0，仍可用 product_bug 和 product finding；此时 ui_review 必须 failed，指出可复现状态和缺陷，不以纯主观偏好判 BUG。`:'本场景未声明 UI 视觉验收；ui_review={"status":"not_applicable","screenshot_paths":[],"reason":"目标不涉及 UI"}。';
const prompt=`你是独立测试审查者，判断一个场景的测试结论是否可靠。不能沿用实现者的 passed_local 自评。所有需求、场景和范围都在本任务输入中；无需读取项目外的测试 SKILL 或 Playbook。只读检查：选用的测试断言能否识别该场景的错误实现，预期是否来自需求与独立夹具，是否运行真实产品路径，冻结日志与观察是否支撑全部判据，失败究竟来自产品还是测试。若有逐行覆盖率，核对它来自本次冻结用例；覆盖率不能替代业务判断。${uiInstruction}

调度器已做确定性门禁：本次冻结重跑的版本、组件、测试文件哈希、日志哈希和证据路径均通过，门禁结果为 ${JSON.stringify(gate)}。不重复计算文件哈希、不扫描整仓，不重新运行测试。先读目标测试代码和执行摘要，必要时再读少量相关产品路径与原始观察。读取大型 JSON 证据时，先列记录标签和键，再只抽取判定所需字段；单次命令输出尽量不超过 12 KB，不打印完整嵌套响应、状态快照或大日志。若有明确疑点，可以扩大读取并说明原因。只审查给定场景。先把每条会导致失败的预期追溯到原始需求或独立确认的合同：生成场景本身不构成新增合同，用户确认原文也不等于确认生成后的附加策略。区分用于证明原文违约的测试方法与原文未限定的交互、额外字段处理、同步时机、输出完整性或展示格式；允许各种满足原文的实现。缺乏独立依据时保留实际观察，不能因“场景明确要求”或补上失败断言就判产品 BUG；旧的产品判定也不能充当预期依据。区分缺口所在层次：若只是测试代码额外要求无关字段、顺序、响应结构或内部机制不变，原场景仍可按原文判定，则返回 repair_required 和 case_code/case_design finding，明确移除超额约束并保留必要业务断言，交给有限修补；不要把能修测试解决的缺口标为 contract。只有冻结场景自身引入额外业务策略，或修补必须选择原文未定的业务行为时，才用 scenario/contract finding 停下等待场景/合同新版本。若输入包含 previous_review，只核对具体缺口与新证据，保留已通过的检查，除非发生冲突。

对原文明确的业务决策阈值，检查代表样本能否区分两侧及边界本身。若只改一个比较关系就会错误拒绝原文明示允许的边界，而全部现有断言仍能通过，应指出这个具体测试缺口；分支覆盖率达到100%也不能替代它。不据此要求穷举或增加未约定的精度、舍入与业务政策。

若 requirement 为 null，且场景 origin/check 表明来自用户或外部有效约定，则用该场景冻结的原文和出处作直接依据；不要求补造上层需求，也不把它当作无依据的生成附加策略。采用或内部自审均不等于独立场景审查。

涉及截图布局、遮挡或可读性时，必须直接检查本消息附带的真实冻结图片像素后才能声称截图支持结论；不能仅从文件存在、DOM文字、源码或几何检查推断视觉效果。优先审查关键阶段截图；若没有收到或看不清图片，如实说明审查能力缺口，不虚构视觉观察。

结论结构门禁：passed 必须是冻结命令退出码为 0 且 findings 为空；product_bug 必须有失败的冻结执行和 product finding，或有冻结截图直接证明的 UI 缺陷、ui_review.failed 与 product finding。若命令通过但发现断言缺口，即使原始页面提示产品问题，也应返回 repair_required 并列出具体测试缺口及保留的产品观察，先修补测试后重新冻结执行。涉及场景或合同争议时列明 scenario/contract finding，不能通过改测试预设业务答案。若输入含 decision_gate_correction，只针对原有证据补正一次结构冲突，不执行测试、不改变原始观察或范围。

只输出简洁 JSON：{"status":"passed|repair_required|product_bug|inconclusive","coverage":"判定与缺口","oracle":"预期依据","evidence":"关键实际证据","ui_review":{"status":"passed|failed|unverified|not_applicable","screenshot_paths":["冻结图片绝对路径"],"reason":"具体观察"},"findings":[{"kind":"case_code|case_design|evidence|scenario|product|contract","reason":"具体原因","requested_change":"具体修复"}],"summary":"一句话"}。本地命令成功本身不足以证明场景通过。不修改文件或运行测试。


覆盖率强制执行规约：
${coverageContract}
输入：${JSON.stringify(input)}`;
if(resume){if(readFileSync(join(output,'prompt.txt'),'utf8')!==prompt)throw Error('review resume prompt changed');}
else writeFileSync(join(output,'prompt.txt'),prompt);
let resumeSession;
if(resume){
 const events=readFileSync(join(output,'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 resumeSession=events.find(x=>x.type==='init')?.sessionId;
 if(!resumeSession||events.some(x=>x.type==='done'&&x.payload?.status==='success'))
  throw Error('No interrupted review session to resume');
}
const agent=createAgentRuntime({directory:output,resume});
const result={agent_runtime:agent.metadata,model:agent.metadata.model,effort:agent.metadata.effort,started_at:new Date().toISOString(),prompt_characters:prompt.length,image_inputs:imageInputs,image_aliases:imageAliases,
 ...(resume?{resumed_from_session:resumeSession}:{})};
const t=performance.now(),texts=[];let done,error,tools=0;
try{
 writeFileSync(join(output,'runner.pid'),String(process.pid)+'\n');
 const task=resume?'继续对同一冻结场景作独立审查；先核对先前已读证据及已收到的冻结图片，只完成剩余判断。最终仅输出原任务要求的 JSON。':
   imageInputs.length?[{type:'text',text:prompt},...imageInputs.map(item=>({type:'local_image',path:item.path}))]:prompt;
 for await(const event of agent.run(task,{cwd:checkout,model:result.model,effort:result.effort,
   ...(resume?{resume:resumeSession}:{}),
   permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}})){
  appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
  if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
  if(event.type==='error')error=event.payload?.message;
  if(event.type==='tool_use')tools++;
  if(event.type==='done')done=event.payload;
 }
 const raw=(texts.at(-1)??'').trim();writeFileSync(join(output,'answer.txt'),raw+'\n');
 try{writeFileSync(join(output,'answer.json'),JSON.stringify(JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),null,2)+'\n');}catch(e){result.parse_error=e.message;}
 result.status=done?.status;result.usage=done?.usage;result.error=error;
}catch(e){result.status='error';result.error=e.message;}
finally{if(existsSync(join(output,'runner.pid')))unlinkSync(join(output,'runner.pid'));}
result.seconds=(performance.now()-t)/1000;result.tool_calls=tools;result.finished_at=new Date().toISOString();
writeFileSync(join(output,'metrics.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
