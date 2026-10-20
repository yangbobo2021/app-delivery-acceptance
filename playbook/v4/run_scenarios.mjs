import {acceptanceGuard,knowledgeContext} from '../acceptance-guard.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {cligent} from '../v3/runtime-path.mjs';
import {bindReviewedReverse} from '../v3/reverse/binding.mjs';
import {reverseArtifactReady} from '../v3/reverse/artifact.mjs';

const [requestArg,outputArg,...flags]=process.argv.slice(2),resume=flags.includes('--resume');
if(!requestArg||!outputArg||flags.some(x=>x!=='--resume'))throw Error('usage: node run_scenarios.mjs request.json NEW-output-dir [--resume]');
const here=dirname(fileURLToPath(import.meta.url)),v3=resolve(here,'../v3');
const requestPath=resolve(requestArg),output=resolve(outputArg);
let supplied=JSON.parse(execFileSync('python3',[new URL('../../scripts/acceptance_definitions.py',import.meta.url).pathname,
 'scenario-request',requestPath],{encoding:'utf8'}));
// Old create runs did not carry revision inputs. Preserve their exact frozen request/prompt on resume.
let legacyCreate=false;
if(resume&&existsSync(join(output,'request.frozen.json'))){
  const prior=JSON.parse(readFileSync(join(output,'request.frozen.json'),'utf8'));
  legacyCreate=!prior.mode&&!JSON.parse(readFileSync(requestPath,'utf8')).mode;
  if(legacyCreate){delete supplied.mode;delete supplied.all_existing_scenarios;}
}
const acceptanceBinding=acceptanceGuard(supplied,[output]);
const acceptanceKnowledge=knowledgeContext(acceptanceBinding);
if(!['BLACK_BOX','WHITE_BOX'].includes(supplied.scenario_kind))throw Error('Invalid scenario kind');
const request=bindReviewedReverse(supplied),root=resolve(request.project_root);
const editing=request.mode==='edit';
if(supplied.definitions&&request.scenario_kind==='WHITE_BOX'){
  const reversed=request.reverse_rules?.find(x=>x.id===request.target_requirement_id);
  const frozen=supplied.reverse_rules?.find(x=>x.id===request.target_requirement_id);
  if(reversed&&(!frozen||['id','text','status','basis_kind','basis','contract_source','contract_quote']
    .some(key=>reversed[key]!==frozen[key])))throw Error('Reverse target differs from adopted frozen definitions');
}
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
if(request.scenario_kind==='BLACK_BOX'&&request.pr_reviewed_reverse_path){
  const path=resolve(request.pr_reviewed_reverse_path),result=JSON.parse(readFileSync(path));
  if(sha(path)!==request.pr_reviewed_reverse_sha256||!reverseArtifactReady(result,path)||
     !result.change?.inventory?.test_modes?.includes('BLACK_BOX')||
     !result.change.inventory.pr_requirement_ids?.includes(request.target_requirement_id)||
     execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==result.change.head_revision)
    throw Error('Black-box PR target is not bound to the frozen change');
}
const target=(request.scenario_kind==='WHITE_BOX'?request.reverse_rules?.find(x=>x.id===request.target_requirement_id)??request.requirements.items.find(x=>x.id===request.target_requirement_id):request.requirements.items.find(x=>x.id===request.target_requirement_id));
if(!target)throw Error('Target requirement/rule absent');
const frozenText=JSON.stringify(request,null,2)+'\n',frozen=join(output,'request.frozen.json');
if(resume){
  if(!existsSync(frozen)||readFileSync(frozen,'utf8')!==frozenText)throw Error('Scenario resume input changed');
}else{
  if(existsSync(output))throw Error('Output exists; use --resume only for an interrupted run');
  mkdirSync(output,{recursive:true});writeFileSync(frozen,frozenText);
}
if(editing){
  const baseline=join(output,'scenarios.base.json');
  if(resume){if(!existsSync(baseline)||readFileSync(baseline,'utf8')!==request.scenario_base_text)throw Error('Scenario edit baseline changed');}
  else writeFileSync(baseline,request.scenario_base_text);
}
const terminalPath=join(output,'terminal.json');
if(resume&&existsSync(terminalPath)){
  const terminal=JSON.parse(readFileSync(terminalPath));
  if(terminal.final_state==='done'&&terminal.request_sha256===sha(frozen)&&
     terminal.scenarios_sha256===sha(join(output,'scenarios.current.json'))&&
     (!editing||terminal.delta_sha256===sha(join(output,'draft.candidate.json')))){
    console.log(JSON.stringify({target:target.id,state:'done',reused:true}));process.exit(0);
  }
  throw Error('Scenario terminal is not a valid completed artifact');
}
const groups=(request.analysis.requirement_groups??[]).filter(g=>g.requirement_ids?.includes(target.id));
const related=[...new Set(groups.flatMap(g=>g.requirement_ids))].filter(id=>id!==target.id);
const input={acceptance_knowledge:acceptanceKnowledge,target_requirement:target,business_goal:request.analysis.business_goal,
  confirmed_scope:request.analysis.confirmed_scope,relevant_groups:groups,
  related_requirement_ids:related,all_requirements:request.requirements.items,
  shared_constraints:request.requirements.shared_constraints,
  genuine_user_constraints:request.user_constraints??[],scenario_kind:request.scenario_kind,
  ...(!legacyCreate?{mode:request.mode,all_existing_scenarios:request.all_existing_scenarios??[]}:{}),
  ...(editing?{previous_target:request.previous_target,previous_context:request.previous_context,
    previous_scenarios:request.previous_scenarios,existing_scenarios:request.existing_scenarios,
    base_sha256:request.scenario_base_sha256,reserved_definition_ids:request.reserved_definition_ids}:{}),
  source_evidence:request.scenario_kind==='WHITE_BOX'?request.source_evidence:undefined};
const standard=readFileSync(join(here,'scenario-standard.md'),'utf8');
const format=readFileSync(join(v3,'scenarios/generation-format.md'),'utf8');
const selfCheck=readFileSync(join(here,'scenario-selfcheck.md'),'utf8');
const editInstructions=editing?`这是现有场景的修订模式。对照旧/新需求及完整当前需求上下文，以 existing_scenarios 为唯一修改基线，逐项检查并保留未受影响和人工编辑的内容。同一测试点保留 ID，只有新测试点才新增 ID；退役必须有需求/范围依据。all_existing_scenarios 用于检查重复和其他关联影响，但不改其他目标的场景，相关影响写入 change_summary 供宿主继续处理。最终仅输出 {"base_sha256":"输入的base_sha256","upsert":[完整五字段的新增/修改场景],"remove_ids":[退役ID],"change_reasons":{"每个新增/修改/退役ID":"依据新旧约定说明原因"},"change_summary":["修订说明"]}。没有变化时两个数组和change_reasons均为空。未改场景不要出现在upsert；不修改来源、外部引用或执行结论。是否执行由宿主按用户要求和真实执行历史决定，本阶段只修订设计。`:'首次生成，只输出完整场景列表。';
const prompt=`这是只读场景分析；全部需求和已冻结白盒依据均在输入中，不读取项目文件、不运行测试。只给目标${request.scenario_kind==='WHITE_BOX'?'需求或逆向规则':'需求'}${legacyCreate?'生成':'生成或修订'}${request.scenario_kind==='WHITE_BOX'?'白盒':'黑盒'}场景，相关需求仅作上下文。内部完成生成与自审，最终只输出合法 JSON；不声称独立审查。\n${standard}\n${format}\n${selfCheck}\n${legacyCreate?'':editInstructions+'\n'}输入：\n${JSON.stringify(input)}`;
const promptPath=join(output,'prompt.txt');
if(resume){if(readFileSync(promptPath,'utf8')!==prompt)throw Error('Scenario prompt changed');}
else writeFileSync(promptPath,prompt);
const eventsPath=join(output,'agent.jsonl');
let events=[];
if(resume){
  if(!existsSync(eventsPath))throw Error('Interrupted scenario has no session trace');
  events=readFileSync(eventsPath,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x));
}
const session=events.find(x=>x.type==='init')?.sessionId;
if(resume&&!session)throw Error('Interrupted scenario has no session ID');
if(resume&&events.some(x=>x.type==='done'&&x.payload?.status==='success')){
  const raw=[...events].reverse().find(x=>x.type==='text')?.payload?.content;
  if(!raw)throw Error('Completed scenario has no final text');
  writeFileSync(join(output,'draft.candidate.json'),JSON.stringify(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),null,2)+'\n');
}else{
  const metrics={model:process.env.ACCEPTANCE_MODEL??'gpt-6.1-sol',effort:process.env.ACCEPTANCE_EFFORT??'high',
    target_requirement_id:target.id,scenario_kind:request.scenario_kind,started_at:new Date().toISOString(),
    prompt_characters:prompt.length,...(resume?{resumed_from_session:session}:{})};
  const tick=performance.now(),texts=[];let done,error,tools=0;
  try{
    const task=resume?'继续同一需求的场景生成。核对已完成的内部自审，只提交尚未完成的最终场景 JSON。':prompt;
    for await(const event of new cligent.CodexAdapter().run(task,{cwd:root,model:metrics.model,effort:metrics.effort,
      ...(resume?{resume:session}:{}),permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}})){
      appendFileSync(eventsPath,JSON.stringify(event)+'\n');
      if(event.type==='text'&&typeof event.payload?.content==='string')texts.push(event.payload.content);
      if(event.type==='done')done=event.payload;
      if(event.type==='error')error=event.payload?.message;
      if(event.type==='tool_use')tools++;
    }
    if(done?.status!=='success')throw Error(error??'Scenario Agent did not complete');
    const raw=texts.at(-1)?.trim();if(!raw)throw Error('Scenario Agent returned no final text');
    writeFileSync(join(output,'answer.txt'),raw+'\n');
    writeFileSync(join(output,'draft.candidate.json'),JSON.stringify(JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),null,2)+'\n');
    metrics.status='success';metrics.usage=done.usage;
  }catch(e){metrics.status='error';metrics.error=e.message;}
  metrics.seconds=(performance.now()-tick)/1000;metrics.tool_calls=tools;
  writeFileSync(join(output,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
  if(metrics.status!=='success')throw Error(metrics.error);
}
const gate=editing?spawnSync('python3',[new URL('../../scripts/acceptance_definitions.py',import.meta.url).pathname,
  'scenario-gate',frozen,output],{encoding:'utf8'}):
  spawnSync(process.execPath,[join(v3,'scenarios/scripts/gate.mjs'),frozen,output,'draft','1'],{encoding:'utf8'});
if(gate.status!==0)throw Error('Scenario structure gate failed: '+(gate.stdout+gate.stderr).slice(-2000));
const terminal={final_state:'done',review_kind:'internal_self_check',semantic_review:'not_independent',
  request_sha256:sha(frozen),scenarios_sha256:sha(join(output,'scenarios.current.json')),
  ...(editing?{mode:'edit',base_sha256:request.scenario_base_sha256,
    delta_sha256:sha(join(output,'draft.candidate.json')),previous_definitions:request.previous_definitions}:{}),
  finished_at:new Date().toISOString()};
writeFileSync(terminalPath,JSON.stringify(terminal,null,2)+'\n');
console.log(JSON.stringify({target:target.id,state:'done',scenarios:JSON.parse(readFileSync(join(output,'scenarios.current.json'))).scenarios.length}));
