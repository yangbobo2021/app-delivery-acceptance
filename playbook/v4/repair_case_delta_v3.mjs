import {acceptanceGuard,knowledgeContext,requireWorkspaceLease} from '../acceptance-guard.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {cligent} from '../v3/runtime-path.mjs';
const [inputArg,reviewArg,catalogArg,guideArg,outArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume');
if(!outArg)throw Error('usage: node repair_case_delta_v3.mjs case-input feedback catalog guide output-dir');
const input=JSON.parse(readFileSync(resolve(inputArg))),review=JSON.parse(readFileSync(resolve(reviewArg)));
const catalog=JSON.parse(readFileSync(resolve(catalogArg))),guide=JSON.parse(readFileSync(resolve(guideArg)));
const root=resolve(catalog.project_root),out=resolve(outArg);
const acceptanceBinding=acceptanceGuard(catalog,[out]);
const acceptanceKnowledge=knowledgeContext(acceptanceBinding);
requireWorkspaceLease(catalog);
if(resume){if(!existsSync(out))throw Error('repair output missing for resume');}
else mkdirSync(out,{recursive:false});
const debug=JSON.parse(execFileSync('python3',[new URL('./debug_case.py',import.meta.url).pathname,
 'create',resolve(catalogArg),resolve(inputArg),join(out,'debug-contract.json')],{encoding:'utf8'}));
mkdirSync(debug.request_root,{recursive:true});
const git=(...x)=>execFileSync('git',x,{cwd:root,encoding:'utf8'}).trim();
const roots=(catalog.write_roots??catalog.test_roots).map(x=>x.replace(/\/$/,'')+'/');
const changed=git('diff','--name-only','HEAD').split('\n').filter(Boolean);
if(git('rev-parse','HEAD')!==catalog.revision||changed.some(x=>!roots.some(root=>x.startsWith(root))))throw Error('source revision changed');
const brief={acceptance_knowledge:acceptanceKnowledge,revision:catalog.revision,test_roots:catalog.test_roots,runner_hints:catalog.runner_hints,
 guide_summary:guide.summary,fixture_isolation:guide.fixture_isolation,
 environment_contract:(guide.environment_contract??[]).filter(x=>x.must_match&&x.must_match!=='无')};
const coverageContract=readFileSync(new URL('../../references/coverage-tool-contract.md',import.meta.url),'utf8');
const prompt=`你负责一个验收场景用例在本地调试或独立审查后的差量修复，在同一个连续 Agent 过程中修改测试代码、运行并本地调试。工具初始目录为用户项目根目录 ${acceptanceBinding.project_root}，用于访问本验收执行资料；实际源码和测试的唯一工作目录为 ${root}，所有项目命令先切换到这个绝对目录，文件编辑使用该目录内的绝对路径，不修改初始目录中的另一份源码或 SPEC。当前场景持有独占执行权；保留前面场景的用例修改，运行状态与输出为本次新建。只处理反馈指出的具体缺口；保留已有有效测试和证据，不重新设计全部需求或场景。先读现有测试文件、失败摘要与相关片段；仅在需要时读取更多源码。勿读取项目外测试 SKILL、整仓扫描或重新安装依赖。

依照场景判据构造能区分正确与错误实现的输入，说明独立于产品返回值的观察方法。新增或修正的断言要在实际执行中验证；若发现产品问题，保存原始响应与状态，不能删断言、跳过或 mock 产品响应来制造通过。涉及自然语言说明的语义判断，保留完整原文交给独立复审，不用关键词伪造充分性。只修复测试自身缺口，禁止修改产品源码、需求和审查结论。

外部调度器负责版本、组件、文件哈希、冻结重跑与独立复审；不自建全仓哈希或审查凭证。修复后执行针对性测试，若失败先识别环境、测试、产品或合同原因，最多两次有依据的再次运行。test_files 列出本场景所有新增的非忽略测试与夹具文件，包括复用的配置和服务脚本；可额外列入依赖的已有测试文件。最终只输出 JSON：{"status":"passed_local|product_failure|needs_contract|blocked","test_files":["相对路径"],"test_command":["程序","参数"],"test_env":{"变量":"值"},"observations":["实际观察"],"evidence_paths":["路径"],"limitations":["..."],"reason":"一句话"}。本地结论仍需独立复审。

覆盖率强制执行规约：
${coverageContract}

本地调试契约：${JSON.stringify(debug)}。在request_root内写只含command/files/env及可选新output的请求，使用entry加请求路径执行；不要直接调用低层采集器或写/tmp输出。最终返回原始业务test_command。

场景输入：${JSON.stringify(input)}
具体反馈：${JSON.stringify(review)}
操作指南：${JSON.stringify(brief)}`;
const bound=JSON.stringify([inputArg,reviewArg,catalogArg,guideArg].map(p=>({path:resolve(p),
 sha256:createHash('sha256').update(readFileSync(resolve(p))).digest('hex')})),null,2)+'\n';
if(resume){
 if(readFileSync(join(out,'prompt.txt'),'utf8')!==prompt||
    readFileSync(join(out,'binding.json'),'utf8')!==bound)throw Error('repair resume binding changed');
}else{
 writeFileSync(join(out,'prompt.txt'),prompt);
 writeFileSync(join(out,'binding.json'),bound);
}
let resumeSession;
if(resume){
 const events=readFileSync(join(out,'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 resumeSession=events.find(x=>x.type==='init')?.sessionId;
 if(!resumeSession||events.some(x=>x.type==='done'&&x.payload?.status==='success'))
  throw Error('No interrupted repair session to resume');
}
const t=performance.now();let done,raw='',calls=0;try{
 writeFileSync(join(out,'runner.pid'),String(process.pid)+'\n');
 const task=resume?'继续同一场景的差量修复。核对已完成的测试文件及观察，只完成尚未完成的缺口；不要重复外部效果。最终仅输出原任务要求的 JSON。':prompt;
 for await(const e of new cligent.CodexAdapter().run(task,{cwd:acceptanceBinding.project_root,model:process.env.ACCEPTANCE_MODEL??'gpt-6.1-sol',effort:process.env.ACCEPTANCE_EFFORT??'high',
  ...(resume?{resume:resumeSession}:{}),
  permissions:{fileWrite:'allow',shellExecute:'allow',networkAccess:input.local_loopback_required?'allow':'deny',
   writablePaths:[`.acceptance-local/${acceptanceBinding.id}`]}})){
  appendFileSync(join(out,'agent.jsonl'),JSON.stringify(e)+'\n');if(e.type==='text')raw=e.payload?.content??'';if(e.type==='done')done=e.payload;if(e.type==='tool_use')calls++;
 }
}catch(e){writeFileSync(join(out,'error.txt'),String(e));}
finally{if(existsSync(join(out,'runner.pid')))unlinkSync(join(out,'runner.pid'));}
writeFileSync(join(out,'answer.txt'),raw+'\n');try{writeFileSync(join(out,'answer.json'),JSON.stringify(JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),null,2)+'\n');}catch{}
const metrics={seconds:(performance.now()-t)/1000,tool_calls:calls,status:done?.status,usage:done?.usage,
 ...(resume?{resumed_from_session:resumeSession}:{}),
 head_after:git('rev-parse','HEAD'),tracked_changes:git('diff','--name-only','HEAD')};
writeFileSync(join(out,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');console.log(JSON.stringify(metrics));
