// Human-facing description only. The host never uses this answer as a gate.
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createAgentRuntime} from '../v3/runtime-path.mjs';
import {acceptanceGuard,requireWorkspaceLease} from '../acceptance-guard.mjs';

const [inputArg,catalogArg,answerArg,outputArg]=process.argv.slice(2);
if(!outputArg)throw Error('usage: run_case_evaluation_v1.mjs case-input catalog case-answer new-output');
const input=JSON.parse(readFileSync(resolve(inputArg),'utf8'));
const catalog=JSON.parse(readFileSync(resolve(catalogArg),'utf8'));
const answer=JSON.parse(readFileSync(resolve(answerArg),'utf8'));
const output=resolve(outputArg);
acceptanceGuard(catalog,[output]);requireWorkspaceLease(catalog);
mkdirSync(output,{recursive:false});
const binding={scene:input.scene.id,input_sha256:createHash('sha256').update(readFileSync(inputArg)).digest('hex'),
  answer_sha256:createHash('sha256').update(readFileSync(answerArg)).digest('hex')};
writeFileSync(join(output,'input.json'),JSON.stringify({input,answer,binding},null,2)+'\n');
const here=dirname(fileURLToPath(import.meta.url));
const contract=readFileSync(resolve(here,'../../references/case-evaluation-contract.md'),'utf8');
const context=JSON.parse(execFileSync('python3',[join(here,'case_evaluation_contract.py'),resolve(inputArg),resolve(answerArg)],{encoding:'utf8'}));
writeFileSync(join(output,'context.json'),JSON.stringify(context,null,2)+'\n');
const prompt=`你是用例评估 Agent，只评估当前场景关联用例的设计充分性、质量和取舍，供用户阅读，不作产品验收判定或执行控制。
只读所选实际测试及必要 Fixture/辅助函数。不得改代码、查找或生成替代用例、运行测试、修补、删除关联、过滤执行列表或调整场景。
前一 Agent 的调试观察仅作背景，不能接受其覆盖声称或冒充本次运行证据；无执行不捏造。不要输出 passed/product_bug/repair_required。
遵循以下完整契约。提交前自查：每个必要缺口是否来自当前场景；有没有把可选增强当成缺口；重复判断是否对照双方实际断言；引用的路径、行号与连续原文是否准确；结论与逐项支持是否一致。无需追求问题数量。
${contract}
源码工作区：${catalog.project_root}
宿主用例标识与可引用的当前场景文本：${JSON.stringify(context)}
冻结输入（关联需求用于理解，不能替代当前场景范围）：${JSON.stringify(input)}
用例 Agent 结果（待核对，不能直接采信）：${JSON.stringify(answer)}`;
writeFileSync(join(output,'prompt.txt'),prompt);
const agent=createAgentRuntime({directory:output});
const result={agent_runtime:agent.metadata,binding,started_at:new Date().toISOString()};
const start=performance.now(),texts=[];let done;
try{
  writeFileSync(join(output,'runner.pid'),String(process.pid)+'\n');
  for await(const event of agent.run(prompt,{jsonOutput:true,cwd:catalog.project_root,model:agent.metadata.model,effort:agent.metadata.effort,
    permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}})){
    appendFileSync(join(output,'agent.jsonl'),JSON.stringify(event)+'\n');
    if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
    if(event.type==='done')done=event.payload;
    if(event.type==='error')result.error=event.payload?.message;
  }
  const raw=(texts.at(-1)??'').trim();writeFileSync(join(output,'answer.txt'),raw+'\n');
  try{writeFileSync(join(output,'answer.json'),JSON.stringify(JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),null,2)+'\n');}
  catch(error){result.parse_error=error.message;}
  result.status=done?.status;result.usage=done?.usage;
}catch(error){result.status='error';result.error=error.message;}
finally{if(existsSync(join(output,'runner.pid')))unlinkSync(join(output,'runner.pid'));}
result.seconds=(performance.now()-start)/1000;
writeFileSync(join(output,'metrics.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
