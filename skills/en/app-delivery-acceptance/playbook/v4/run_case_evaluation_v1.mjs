// Human-facing description only. The host never uses this answer as a gate.
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
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
const prompt=`你是用例评估Agent，只生成供人阅读的场景关联用例评估，不作产品验收判定，不参与任何执行控制。
只读所选实际测试代码与必要Fixture/辅助函数，核对冻结需求、场景的条件、操作、预期与用例组的共同贡献。
给出覆盖充分/部分/缺口/无法判断的描述和依据；分别说明覆盖不足、用例质量问题（含过度约束）和可能重复的范围。
不能把附加消息文案约束和缺少关键业务断言混为一谈。相似名称、命中同一行和局部测试拼接均不足以证明完整链路。
不得改代码、生成或查找一批替代用例、运行测试、修补、删除关联、过滤执行列表、调整场景或授权执行。
前一个Agent的调试观察可作背景，明确本地调试与后续正式证据不同；无执行时不捏造。不能直接接受前一个Agent的覆盖声称。
你的描述无论指出何种问题，都不会阻止后续执行；由用户阅读决策。不要返回passed/product_bug/repair_required等正式判定。
只输出JSON：{"summary":"简明评估","coverage":"sufficient|partial|gap|uncertain","supported":["有依据的支持范围"],"gaps":["未支持或待确认项"],"quality_issues":["质量风险及其影响"],"redundancy":["可能重复的范围及理由，仅供参考"],"test_assessments":[{"test":"文件和测试项标识","contribution":"实际条件、步骤、断言与场景预期的对应依据","limitations":"限制"}]}。
不创建自己的覆盖率统计或将静态评估冒充业务执行结果。源码工作区：${catalog.project_root}
冻结输入：${JSON.stringify(input)}
用例Agent结果：${JSON.stringify(answer)}`;
writeFileSync(join(output,'prompt.txt'),prompt);
const agent=createAgentRuntime({directory:output});
const result={agent_runtime:agent.metadata,binding,started_at:new Date().toISOString()};
const start=performance.now(),texts=[];let done;
try{
  writeFileSync(join(output,'runner.pid'),String(process.pid)+'\n');
  for await(const event of agent.run(prompt,{cwd:catalog.project_root,model:agent.metadata.model,effort:agent.metadata.effort,
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
