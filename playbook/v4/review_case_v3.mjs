import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {cligent} from '../v3/runtime-path.mjs';

const [checkoutArg,inputArg,outputArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume');
if(!checkoutArg||!inputArg||!outputArg)throw Error('usage: node review-case.mjs checkout input-json output-dir');
const checkout=resolve(checkoutArg),input=JSON.parse(readFileSync(resolve(inputArg),'utf8')),output=resolve(outputArg);
const gatePath=resolve(input.handoff_gate_path??'');
if(!input.handoff_gate_path)throw Error('handoff_gate_path required');
const gate=JSON.parse(readFileSync(gatePath,'utf8'));
if(gate.status!=='ready_for_review'||gate.scene_id!==input.scene.id)throw Error('review handoff not ready');
const inputText=JSON.stringify(input,null,2)+'\n';
if(resume){
 if(!existsSync(output)||readFileSync(join(output,'input.json'),'utf8')!==inputText)
  throw Error('review resume input changed or output missing');
}else{
 mkdirSync(output,{recursive:false});writeFileSync(join(output,'input.json'),inputText);
}
const coverageContract=readFileSync(new URL('../../references/coverage-tool-contract.md',import.meta.url),'utf8');
const prompt=`你是独立测试审查者，判断一个场景的测试结论是否可靠。不能沿用实现者的 passed_local 自评。所有需求、场景和范围都在本任务输入中；无需读取项目外的测试 SKILL 或 Playbook。只读检查：选用的测试断言能否识别该场景的错误实现，预期是否来自需求与独立夹具，是否运行真实产品路径，冻结日志与观察是否支撑全部判据，失败究竟来自产品还是测试。若有逐行覆盖率，核对它来自本次冻结用例；覆盖率不能替代业务判断。

调度器已做确定性门禁：本次冻结重跑的版本、组件、测试文件哈希、日志哈希和证据路径均通过，门禁结果为 ${JSON.stringify(gate)}。不重复计算文件哈希、不扫描整仓，不重新运行测试。先读目标测试代码和执行摘要，必要时再读少量相关产品路径与原始观察。读取大型 JSON 证据时，先列记录标签和键，再只抽取判定所需字段；单次命令输出尽量不超过 12 KB，不打印完整嵌套响应、状态快照或大日志。若有明确疑点，可以扩大读取并说明原因。只审查给定场景。若输入包含 previous_review，只核对具体缺口与新证据，保留已通过的检查，除非发生冲突。

涉及截图布局、遮挡或可读性时，必须用可用的图片查看工具打开真实冻结截图后才能声称截图支持结论；不能仅从文件存在、DOM文字或几何检查推断已经看过图片。优先查看支持的窄窗口及关键阶段代表截图。若当前工具确实不能查看图片，如实说明审查能力缺口，不虚构视觉观察。

只输出简洁 JSON：{"status":"passed|repair_required|product_bug|inconclusive","coverage":"判定与缺口","oracle":"预期依据","evidence":"关键实际证据","findings":[{"kind":"case_code|case_design|evidence|scenario|product|contract","reason":"具体原因","requested_change":"具体修复"}],"summary":"一句话"}。本地命令成功本身不足以证明场景通过。不修改文件或运行测试。


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
const result={model:process.env.ACCEPTANCE_MODEL??'gpt-6.1-sol',effort:process.env.ACCEPTANCE_EFFORT??'high',started_at:new Date().toISOString(),prompt_characters:prompt.length,
 ...(resume?{resumed_from_session:resumeSession}:{})};
const t=performance.now(),texts=[];let done,error,tools=0;
try{
 writeFileSync(join(output,'runner.pid'),String(process.pid)+'\n');
 const task=resume?'继续对同一冻结场景作独立审查；先核对先前已读证据，只完成剩余判断。最终仅输出原任务要求的 JSON。':prompt;
 for await(const event of new cligent.CodexAdapter().run(task,{cwd:checkout,model:result.model,effort:result.effort,
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
