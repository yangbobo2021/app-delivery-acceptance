import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {createAgentRuntime} from '../runtime-path.mjs';
import {normalizeRuleCoverage} from './normalize.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const write=(folder,name,value)=>writeFileSync(join(folder,name),JSON.stringify(value,null,2)+'\n');
const read=(folder,name)=>JSON.parse(readFileSync(join(folder,name),'utf8'));

export async function runSingleAgent({folder,cwd,root,request,change,inventory,resume,acceptanceKnowledge={}}){
 const metricsPath=join(folder,'metrics.json');
 const prior=resume&&existsSync(metricsPath)?read(folder,'metrics.json'):null;
 if(resume&&(!prior||prior.final_state==='completed'))throw Error('Only an interrupted or blocked read-only reverse run may resume');
 if(resume&&!existsSync(join(folder,'draft.candidate.json'))&&!existsSync(join(folder,'draft.current.json')))
  throw Error('No saved reverse draft; start a new immutable read-only attempt');
 const agent=resume?null:createAgentRuntime({directory:folder,model:process.env.REVERSE_MODEL,effort:process.env.REVERSE_EFFORT});
 const metrics=prior??{agent_runtime:agent.metadata,schema:'reverse-selfcheck-metrics-v1',started_at:new Date().toISOString(),
  model:agent.metadata.model,effort:agent.metadata.effort,calls:[],
  input_sha256:sha(readFileSync(join(folder,'request.frozen.json'))),change_sha256:sha(readFileSync(join(folder,'change.json')))};
 if(metrics.input_sha256!==sha(readFileSync(join(folder,'request.frozen.json')))||
    metrics.change_sha256!==sha(readFileSync(join(folder,'change.json'))))throw Error('Reverse resume binding changed');
 const save=()=>write(folder,'metrics.json',metrics);
 const terminal=(state,reason)=>{
  metrics.final_state=state;metrics.finished_at=new Date().toISOString();if(reason)metrics.reason=reason;else delete metrics.reason;save();
  write(folder,'terminal.json',{final_state:state,finished_at:metrics.finished_at,
   input_sha256:metrics.input_sha256,change_sha256:metrics.change_sha256,reason:reason??null});
 };
 try{
  if(!existsSync(join(folder,'draft.candidate.json'))&&!existsSync(join(folder,'draft.current.json'))){
   const summary={base_revision:change.base_revision,head_revision:change.head_revision,
    change_sha256:metrics.change_sha256,changed_files:change.changed_files,
    inventory_path:inventory?join(folder,'inventory.json'):null,diff_chunks:change.diff_chunks};
   write(folder,'agent-input.json',summary);
   const prompt=`项目验收经验（操作参考，不是业务预期）：${JSON.stringify(acceptanceKnowledge)}\n你在**一次连续的 Agent 任务**中逆向本次提交/PR 直接影响的重要、可观察行为，并在同一次任务内自行检查最终清单。只读检查源码；不修改文件、不运行测试、不访问网络或生产服务。先读冻结差异、完整需求与独立合同，再针对具体疑问定向读取必要源码和调用方。无需证明绝无遗漏；重要主路径和明显跨模块后果优先，信息足够后停止，不为穷举假设反复扩大阅读。\n\n冻结输入：${join(folder,'request.frozen.json')}；变更及完整清单：${join(folder,'change.json')}；简明索引：${join(folder,'agent-input.json')}；差异分块目录：${join(folder,'diff-chunks')}。项目根目录：${cwd}。所有变更产品文件都要有归属；分块须按索引覆盖，不遗漏文件。原始需求、已确认范围和 existing_rules 以冻结输入为准。\n\n每个行为要说明具体触发条件、操作及可观察变化；区分独立合同支持的预期、已有需求/规则覆盖的行为及缺少业务判据的待确认问题。实现代码和本提交修改的测试/规格不能自证正确；仅冻结输入中的独立合同、已确认需求/决定可作判据。合同文件被本次变更修改时，除非 confirmed_contract_paths 明确允许，不作独立合同。未确认项不得进入场景生成。将同一可观察结果的正常/重试或多个调用方分支合并；仅在后果和恢复要求实质不同且有可达证据时分列。对条件性风险写明前提，不能声称它实际发生。与改动无直接因果关系、仅由不现实输入推导或只是旧流程延伸的低价值项不单列。\n\n交付前在内部检查：变更产品文件归属、重要直接行为遗漏、描述的条件及因果证据、合同来源、需求覆盖关系、重复项和明显跨模块影响。共用刷新或校验点若位于不可撤销操作之后，特别检查结果已提交但后续读取失败是否会产生不同恢复结论。自查不另起 Reviewer，也不输出冗长审查文字。\n\n只输出 JSON，无 Markdown。格式：{"base_revision":"${change.base_revision}","head_revision":"${change.head_revision}","change_sha256":"${metrics.change_sha256}","behavior_impacts":[{"id":"B1","description":"具体可观察变化或明确的非行为修改","code_paths":["变更产品文件相对路径"],"coverage":"requirement|existing_rule|new_rule|unresolved|no_behavior","target_ids":["对应需求或规则ID；非行为为空"],"reason":"简短条件和因果依据"}],"impacts":[{"requirement_id":"原始需求ID","reason":"具体受影响行为"}],"reverse_rules":[{"id":"稳定规则ID","title":"简短标题","text":"条件、操作、可观察结果；条件性影响明确标注","status":"supported|needs_confirmation","rationale":"变更的直接影响","basis_kind":"contract|invariant|confirmed_decision|candidate","basis":"独立依据或待确认缘由","contract_source":"冻结合同文件的原样 path，可为项目相对路径或跨仓库快照绝对路径；否则空字符串","contract_quote":"合同连续原文；否则空字符串","related_requirement_ids":[],"changed_paths":["变更产品文件相对路径"],"question":"待确认的具体问题；其他为空"}],"limits":["关键未核实边界"]}。behavior_impacts 中每个产品变更文件至少出现一次；已覆盖需求的行为只列 requirement impact，不重建规则；已有规则仅沿用其 ID 和原文/依据；新增支持规则使用 new_rule，待确认规则使用 unresolved。没有行为变化的文件用 no_behavior 且说明原因。不要输出代码哈希，宿主从冻结清单补齐。`;
   writeFileSync(join(folder,'prompt-selfcheck.txt'),prompt);
   const call={role:'single_agent',phase:'reverse_and_self_check',started_at:new Date().toISOString(),prompt_characters:prompt.length};
   metrics.calls.push(call);save();
   const adapter=agent,abort=new AbortController();
   const timer=setTimeout(()=>abort.abort('reverse time limit'),Number(process.env.REVERSE_TIME_LIMIT_MS??480000));
   const texts=[];let done,error,toolUses=0;const started=performance.now();
   try{
    for await(const event of adapter.run(prompt,{jsonOutput:true,cwd,model:metrics.model,effort:metrics.effort,
      abortSignal:abort.signal,permissions:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}})){
     appendFileSync(join(folder,'agent-selfcheck.jsonl'),JSON.stringify(event)+'\n');
     if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
     if(event.type==='tool_use')toolUses++;
     if(event.type==='error')error=event.payload?.message;
     if(event.type==='done')done=event.payload;
    }
    call.seconds=(performance.now()-started)/1000;call.usage=done?.usage??null;call.tool_uses=toolUses;
    call.status=done?.status??'error';
    if(call.status!=='success')throw Error(error??'Single Agent reverse did not complete');
    const raw=(texts.at(-1)??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
    writeFileSync(join(folder,'response-selfcheck.txt'),raw);
    const answer=JSON.parse(raw);
    if(!Array.isArray(answer.behavior_impacts)||!Array.isArray(answer.impacts)||!Array.isArray(answer.reverse_rules))
     throw Error('Single Agent reverse output is incomplete');
    const existing=new Map((request.existing_rules??[]).map(x=>[x.id,x]));
    for(const rule of answer.reverse_rules){
     const paths=rule.changed_paths??rule.code_sources?.map(x=>x.path);
     if(!Array.isArray(paths)||!paths.length)throw Error('Reverse rule missing changed paths: '+rule.id);
     rule.code_sources=paths.map(path=>{
      const file=change.changed_files.find(x=>x.path===path);
      if(!file)throw Error('Reverse rule names unknown changed source: '+path);
      return {path,revision:change.head_revision,sha256:file.sha256};
     });
     delete rule.changed_paths;
     if(existing.has(rule.id))for(const key of ['title','text','status','basis_kind','basis','contract_source','contract_quote'])
      rule[key]=existing.get(rule.id)[key];
     if(existing.has(rule.id)&&rule.status==='confirmed')rule.status='supported';
    }
    const candidate=normalizeRuleCoverage(answer,request.existing_rules??[]).candidate;
    delete candidate.limits;
    write(folder,'draft.candidate.json',candidate);
    save();
   }finally{clearTimeout(timer);call.seconds??=(performance.now()-started)/1000;save()}
  }
  // Non-product documentation is already accounted for by the frozen inventory.
  // A no_behavior note about it is not a product behavior and can be dropped
  // without changing the Agent's conclusions or buying another model call.
  if(!existsSync(join(folder,'draft.current.json'))){
   const candidate=read(folder,'draft.candidate.json');
   const changed=new Set(change.selected_paths);
   const removed=[];
   candidate.behavior_impacts=candidate.behavior_impacts.filter(item=>{
    if(item.coverage!=='no_behavior'||!item.code_paths?.length||
       item.code_paths.some(path=>changed.has(path)||
        !inventory?.files?.some(file=>file.path===path&&file.kind!=='source')))return true;
    removed.push({id:item.id,paths:item.code_paths,reason:'Non-product path is already classified in the frozen inventory'});
    return false;
   });
   if(removed.length){write(folder,'normalizations.json',removed);write(folder,'draft.candidate.json',candidate)}
  }
  // The historical draft gate still validates source hashes, contract quotes,
  // original IDs, path accounting and diff reconstruction. Agent tool reads are
  // preserved in agent-selfcheck.jsonl; no host-provided read bundle is claimed.
  write(folder,'analyst-read-evidence.json',{schema:'reverse-read-evidence-v2',
   source_inventory_sha256:inventory?sha(JSON.stringify(inventory)):null,results:[]});
  execFileSync(process.execPath,[join(root,'scripts/gate.mjs'),folder,'draft'],{cwd,stdio:'pipe'});
  const draft=read(folder,'draft.current.json'),draftBytes=readFileSync(join(folder,'draft.current.json'));
  const trace=readFileSync(join(folder,'agent-selfcheck.jsonl'));
  const artifact={schema:'commit-reverse-selfcheck-v1',status:'completed',change,draft,
   self_check:{method:'single_agent_internal',agent_trace_sha256:sha(trace),
    draft_sha256:sha(draftBytes),gate_sha256:sha(readFileSync(join(folder,'draft-gate.json')))}};
  write(folder,'result.json',artifact);
  terminal('completed');
  console.log(JSON.stringify({state:'completed',rules:draft.reverse_rules.length,
   behaviors:draft.behavior_impacts?.length??0,seconds:metrics.calls.at(-1)?.seconds??0,
   tokens:metrics.calls.at(-1)?.usage?.tokens?.totals??null,result:join(folder,'result.json')}));
  return 'completed';
 }catch(error){
  terminal('blocked',String(error.message??error));
  console.error(String(error.stack??error));
  return 'blocked';
 }
}
