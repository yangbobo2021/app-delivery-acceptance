function requirementDocument(text){
 const lines=String(text||'原始需求未记录。').replace(/\r\n/g,'\n').split('\n');
 const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
 const tableRow=s=>s.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());
 const isTable=s=>/^\s*\|.*\|\s*$/.test(s);
 let html='',i=0;
 while(i<lines.length){
  const line=lines[i];if(!line.trim()){i++;continue;}
  if(/^\s*```/.test(line)){const code=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);i++;html+=`<pre>${esc(code.join('\n'))}</pre>`;continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){const h=heading[1].length<3?'h3':'h4';html+=`<${h}>${inline(heading[2])}</${h}>`;i++;continue;}
  if(isTable(line)){
   const table=[];while(i<lines.length&&isTable(lines[i]))table.push(tableRow(lines[i++]));
   const header=table.length>1&&table[1].every(c=>/^:?-{3,}:?$/.test(c));
   html+='<div class="document-table"><table>'+table.filter((r,n)=>!header||n!==1).map((r,n)=>'<tr>'+r.map(c=>`<${header&&n===0?'th':'td'}>${inline(c)}</${header&&n===0?'th':'td'}>`).join('')+'</tr>').join('')+'</table></div>';continue;
  }
  const list=line.match(/^\s*(?:([-*])\s+|(\d+)[.)]\s+)(.+)$/);
  if(list){const ordered=Boolean(list[2]),tag=ordered?'ol':'ul',items=[];while(i<lines.length){const m=lines[i].match(/^\s*(?:([-*])\s+|(\d+)[.)]\s+)(.+)$/);if(!m||Boolean(m[2])!==ordered)break;items.push(`<li>${inline(m[3])}</li>`);i++;}html+=`<${tag}>${items.join('')}</${tag}>`;continue;}
  if(/^>\s?/.test(line)){const quote=[];while(i<lines.length&&/^>\s?/.test(lines[i]))quote.push(lines[i++].replace(/^>\s?/,''));html+=`<blockquote>${inline(quote.join('\n'))}</blockquote>`;continue;}
  const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|\s*```|\s*[-*]\s|\s*\d+[.)]\s|>\s?)/.test(lines[i])&&!isTable(lines[i]))paragraph.push(lines[i++]);
  html+=`<p>${inline(paragraph.join('\n'))}</p>`;
 }
 return html;
}

// Display-only relationships. Keys include acceptance, project and scene so a
// shared test remains distinct in each reading context.
const requirementCards=new Map(),traceCollapsed=new Set();
let traceGroups=null,traceSearch='',traceFilter='all',tracePriority='all';
let traceDetailKey='',traceDetailVersion='',traceDetailSnapshot=null,traceBack=[],traceOpener=null,tracePosition=null,traceTab='overview';
let traceComplete=true;
const traceTabs=['overview','original','source'];
const traceConfirmed=new Set(['passed','product_bug','accepted_risk','repair_required','blocked','inconclusive']);
const traceVerdicts={passed:'通过',product_bug:'产品 BUG',accepted_risk:'已接受风险',repair_required:'用例需修复',blocked:'受阻',inconclusive:'证据不足',pending_review:'等待确认',not_run:'尚无结论'};
const traceResults={passed:'执行通过',failed:'执行失败',executed:'已执行',error:'执行错误',aborted:'已中止',skipped:'已跳过',not_run:'未执行'};
const traceEvalLabels={sufficient:'支持充分',partial:'部分支持',gap:'存在缺口',uncertain:'无法判断'};
const traceVal=x=>Array.isArray(x)?x.map(traceVal).join('\n'):x&&typeof x==='object'?JSON.stringify(x,null,2):String(x??'');
const traceField=(label,value)=>`<section class="trace-field"><h3>${esc(label)}</h3>${value!==null&&value!==undefined&&traceVal(value).trim()?requirementDocument(traceVal(value)):'<p class="small">未记录</p>'}</section>`;
const traceTag=(text,tone='')=>`<span class="tag ${tone}">${esc(text)}</span>`;
const traceKey=(...parts)=>JSON.stringify([document.querySelector('#acceptanceId')?.value||'',...parts]);
function traceRegister(key,item){requirementCards.set(key,{...item,key});return key;}
function traceButton(key,label,cls='requirement-title',start='overview'){
 return `<button type="button" class="${cls}" data-requirement-key="${esc(key)}" data-detail-tab="${start}" aria-haspopup="dialog" onclick="openRequirement(this)">${esc(label)}</button>`;
}
function traceLink(key,label,start='overview'){return traceButton(key,label,'trace-link',start);}
function traceEval(entry){const p=entry.trace.case_presentations?.[entry.scene.id];return p?.evaluation?.status==='available'?p.evaluation.description:null;}
function traceEvaluationState(entry){const e=entry.trace.case_presentations?.[entry.scene.id]?.evaluation;
 return e?.status==='available'?(traceEvalLabels[e.description?.coverage]||'无法判断'):({off:'本轮未启用',unavailable:'评估暂不可用',stale:'评估待更新'})[e?.status]||'尚未评估';}
function traceGaps(entry){return (traceEval(entry)?.findings||[]).filter(f=>f.kind==='gap');}
function traceExecution(entry){const {trace:t,scene:s}=entry;return t.execution_known??Boolean(t.execution_records_by_scene?.[s.id]?.length||t.executed_scene_ids?.includes(s.id)||(t.case_results||[]).some(r=>(t.bindings||[]).some(b=>b.id===r.binding_id&&b.scenario_id===s.id)&&['passed','failed','executed','error','aborted'].includes(r.status)));}
function traceVerdict(entry){const t=entry.trace;if(traceConfirmed.has(t.judgment?.status))return t.judgment.status;return traceExecution(entry)?'pending_review':'not_run';}
function traceValidity(entry){const t=entry.trace;if(!traceConfirmed.has(t.judgment?.status))return '';
 const codeChanged=t.judgment_source?.revision&&t.project.revision&&t.judgment_source.revision!==t.project.revision;
 if(t.definition_applicability==='needs_revalidation'||codeChanged)return '待重新验证';
 if(t.definition_applicability==='matches_current')return '与当前定义一致';
 if(t.definition_applicability==='equivalent_by_assessment')return '定义经对照等价';
 return '适用性未核对';}
function traceActivity(entry){const {trace:t,scene:s}=entry;
 const active=(typeof stages==='undefined'?[]:stages).find(x=>x.project_id===t.project.id&&!x.finished&&['running','repair','blocked'].includes(x.state)&&(x.target_id===s.id||x.scene_id===s.id));
 if(!active)return '';
 if(active.state==='blocked')return '当前处理受阻';if(active.state==='repair')return '正在修复用例';
 return active.kind==='case'?'用例处理中':active.kind==='scenario'?'场景整理中':'正在处理';}
function traceAttention(e){return traceGaps(e).length||['product_bug','repair_required','blocked','inconclusive','pending_review'].includes(traceVerdict(e))||traceValidity(e)==='待重新验证';}
function traceMatches(entry,parent){const s=entry.scene,t=entry.trace,p=t.case_presentations?.[s.id]||{};
 const q=traceSearch.trim().toLocaleLowerCase(),text=[parent.presentation?.title,parent.requirement.title,parent.requirement.id,s.title,s.id,...(p.cases||[]).flatMap(c=>[c.name,c.id])].join(' ').toLocaleLowerCase();
 if(q&&!text.includes(q))return false;if(tracePriority!=='all'&&s.priority!==tracePriority)return false;
 return ({all:true,attention:traceAttention(entry),not_run:!traceExecution(entry),executed:traceExecution(entry),passed:traceVerdict(entry)==='passed',pending_review:traceVerdict(entry)==='pending_review',revalidate:traceValidity(entry)==='待重新验证'})[traceFilter];
}
function traceHistory(entry){const t=entry.trace;if(Array.isArray(t.execution_history))return t.execution_history;
 return traceExecution(entry)?[{project:t.project,attempt_id:t.attempt_id,generated_at:t.generated_at,bindings:(t.bindings||[]).filter(b=>b.scenario_id===entry.scene.id),case_results:t.case_results||[],current_links:t.current_links||{}}]:[];}
function traceTone(status){return status==='passed'?'passed':status==='product_bug'?'failed':['repair_required','blocked','inconclusive'].includes(status)?'pending':'';}
function traceTime(at){if(!at)return '时间未记录';const d=new Date(at);return Number.isNaN(d.getTime())?String(at):d.toLocaleString('zh-CN',{hour12:false});}
function traceBrief(value,max=72){const text=traceVal(value).replace(/\s+/g,' ');return text.length>max?text.slice(0,max)+'…':text;}
function renderTraceTable(reqs,grouped){
 grouped=new Map([...grouped].map(([key,items])=>[key,items.map(e=>({...e,scene:e.scene||e.scenario}))]));
 traceGroups={reqs,grouped};requirementCards.clear();
 // Register the full relation graph before filtering. A requirement opened from
 // one matching row must still link to every one of its scenes.
 for(const [group,parent] of reqs){const entries=grouped.get(group)||[],reqKey=traceRegister(traceKey(parent.project.id,'req',parent.kind,parent.requirement.id),{type:'req',parent,entries});
  for(const entry of entries){const s=entry.scene,base={entry,parent,reqKey,activity:traceActivity(entry)};for(const type of ['scene','evaluation','run','verdict'])traceRegister(traceKey(parent.project.id,type,s.id),{...base,type});
   (entry.trace.case_presentations?.[s.id]?.cases||[]).forEach((c,i)=>traceRegister(traceKey(parent.project.id,'case',s.id,c.id||i),{...base,type:'case',item:c,scene:s}));
  }
 }
 let html='',shown=0;const total=[...grouped.values()].reduce((n,v)=>n+v.length,0);
 for(const [key,parent] of reqs){const {project,requirement:r,kind,presentation={}}=parent,all=grouped.get(key)||[],entries=all.filter(e=>traceMatches(e,parent));
  if(all.length&&!entries.length)continue;
  if(!all.length&&(traceFilter!=='all'||tracePriority!=='all'||(traceSearch.trim()&&![presentation.title,r.title,r.id].join(' ').toLocaleLowerCase().includes(traceSearch.trim().toLocaleLowerCase()))))continue;
  shown+=entries.length;
  const reqKey=traceRegister(traceKey(project.id,'req',kind,r.id),{type:'req',parent,entries:all}),folded=traceCollapsed.has(key),span=folded?1:Math.max(1,entries.length);
  const executed=all.filter(traceExecution).length,passed=all.filter(e=>traceExecution(e)&&traceVerdict(e)==='passed').length,stale=all.filter(e=>traceValidity(e)==='待重新验证').length;
  const sourceLabel=kind==='reverse'?'逆向规则'+(r.status==='needs_confirmation'?' · 待确认':''):kind==='scenario'?'独立场景':'需求';
  const req=`<th scope="rowgroup" data-trace-owner="${esc(key)}" rowspan="${span}"><div class="small">${esc(project.label||project.id)} · ${esc(sourceLabel)}</div>${traceButton(reqKey,presentation.title||r.title||r.id)}<div class="trace-id">${esc(r.id)}</div><div class="trace-stat">${all.length?(traceComplete?`${all.length} 个场景 · 已执行 ${executed}/${all.length}<br>最近确认通过 ${passed}/${all.length}${stale?` · ${stale} 项待重新验证`:''}`:`已发现 ${all.length} 个场景 · 已执行 ${executed} 个<br>最近确认通过 ${passed} 个；非完整清单`):'尚无场景'}</div>${entries.length!==all.length?`<div class="small">筛选显示 ${entries.length}/${all.length} 个场景</div>`:''}${all.length?`<button type="button" class="trace-fold" data-trace-group="${esc(key)}" aria-expanded="${!folded}" onclick="toggleTraceGroup(this)">${folded?'展开场景':'收起场景'}</button>`:''}</th>`;
  if(folded||!all.length){html+=`<tr>${req}<td colspan="4" class="small">${folded?`${entries.length} 个匹配场景已收起`:'尚无测试场景 · 用例与执行尚未建立'}</td></tr>`;continue;}
  entries.forEach((entry,index)=>{const {trace:t,scene:s}=entry,p=t.case_presentations?.[s.id]||{},cases=p.cases||[];
   const base={entry,parent,reqKey,activity:traceActivity(entry)},sceneKey=traceRegister(traceKey(project.id,'scene',s.id),{...base,type:'scene'}),evalKey=traceRegister(traceKey(project.id,'evaluation',s.id),{...base,type:'evaluation'}),runKey=traceRegister(traceKey(project.id,'run',s.id),{...base,type:'run'}),verdictKey=traceRegister(traceKey(project.id,'verdict',s.id),{...base,type:'verdict'});
   const cards=cases.map((c,i)=>{const caseKey=traceRegister(traceKey(project.id,'case',s.id,c.id||i),{...base,type:'case',item:c,scene:s});return i<3?`<article class="case-card">${traceButton(caseKey,c.name||'未命名用例')}</article>`:'';}).join('');
   const gap=traceGaps(entry).length,v=traceVerdict(entry),valid=traceValidity(entry),history=traceHistory(entry),activity=traceActivity(entry);
   const executionLabel=traceExecution(entry)?'已执行':'未执行';
   html+=`<tr>${index===0?req:''}<td>${traceTag(s.priority||'重要程度未记录')}${s.kind==='WHITE_BOX'?traceTag('白盒'):''}${traceButton(sceneKey,s.title||s.id)}<div class="trace-id">${esc(s.id)}</div>${activity?traceTag(activity,'pending'):''}</td><td><div class="small">${cases.length} 个关联用例</div>${cards}${cases.length>3?traceButton(sceneKey,`查看全部 ${cases.length} 项`,'trace-fold','original'):''}${!cases.length?`<p class="small">${esc(p.empty_reason||'尚未关联用例')}</p>`:''}<div class="trace-evaluation">${traceButton(evalKey,'设计评估：'+traceEvaluationState(entry),'trace-state')}${gap?traceButton(evalKey,`${gap} 项必要缺口 · 查看原因`,'trace-gap'):''}${p.title_warning?'<div class="trace-gap">展示资料待核对</div>':''}</div></td><td>${traceButton(runKey,executionLabel,'trace-state trace-neutral')}${history.length?`<div class="small">${esc(traceTime(history[0].generated_at))}</div><div class="small">${history.length} 条执行记录</div>`:''}</td><td>${traceButton(verdictKey,traceVerdicts[v]||v,'trace-state trace-verdict-'+v)}${valid?`<div>${traceTag(valid,valid==='待重新验证'?'pending':'')}</div>`:''}${['product_bug','repair_required','blocked','inconclusive'].includes(v)?`<div class="trace-gap">${esc(traceBrief(t.judgment?.reason))}</div>`:''}${t.judgment?.ui_review?`<div class="small">UI：${esc({passed:'视觉通过',failed:'视觉缺陷',unverified:'未验证',not_applicable:'不适用'}[t.judgment.ui_review.status]||'未记录')}</div>`:''}</td></tr>`;
  });
 }
 document.querySelector('#rows').innerHTML=html||'<tr><td colspan="5" class="trace-empty">没有匹配的记录。可清除筛选查看完整关系。</td></tr>';
 const count=document.querySelector('#traceShown');if(count)count.textContent=`显示 ${shown}/${total} 个场景${traceComplete?' · 统计以完整场景集合为准':' · 当前清单不完整，不能作为全量统计'}`;
 traceCheckDetailUpdate();
}
function toggleTraceGroup(button){const k=button.dataset.traceGroup;traceCollapsed.has(k)?traceCollapsed.delete(k):traceCollapsed.add(k);if(traceGroups)renderTraceTable(traceGroups.reqs,traceGroups.grouped);Array.from(document.querySelectorAll('[data-trace-group]')).find(x=>x.dataset.traceGroup===k)?.focus({preventScroll:true});}
function traceReset(){traceSearch='';traceFilter='all';tracePriority='all';traceCollapsed.clear();for(const [id,val] of [['traceSearch',''],['traceFilter','all'],['tracePriority','all']]){const e=document.getElementById(id);if(e)e.value=val;}const d=document.getElementById('requirementDialog');if(d?.open)d.close();traceBack=[];traceDetailKey='';}
function traceSourceFields(source={}){return traceField('文件位置',(source.file||'未记录')+(source.line_start?':'+source.line_start+(source.line_end?'–'+source.line_end:''):''))+traceField('原始代码标题',source.title)+traceField('源码版本',source.revision)+traceField('源码核对',{matches:'源码文件哈希与记录一致',changed:'源码已变化，原说明保留供核对',unavailable:'源码快照当前不可用'}[source.verification]||'未记录')+(source.file_sha256?`<details><summary>文件校验记录</summary>${traceField('SHA-256',source.file_sha256)}</details>`:'');}
function traceExternal(refs){return (refs||[]).map(x=>traceField('外部引用',x.locator)+traceField('引用版本',x.revision)).join('');}
function traceRelatedCases(base){const {entry:e}=base,p=e.trace.case_presentations?.[e.scene.id]||{},cases=p.cases||[];
 return `<h3>关联用例 · ${cases.length} 项</h3>`+cases.map((c,i)=>traceLink(traceKey(e.trace.project.id,'case',e.scene.id,c.id||i),c.name||'未命名用例')).join('')+(!cases.length?traceField('用例关联',p.empty_reason||'尚未关联用例'):'');}
function traceSafeLink(label,url){const value=String(url||'');return /^(?:\/(?!\/)|https?:\/\/)/.test(value)?`<div><a href="${esc(value)}" target="_blank" rel="noopener">${esc(label)}</a></div>`:'';}
function traceLinks(links){return Object.entries(links||{}).map(([label,url])=>traceSafeLink(label,url)).join('');}
function traceExecutionParts(record,entry){
 const bindings=record.bindings||[],results=record.case_results||[],p=entry.trace.case_presentations?.[entry.scene.id]||{},cases=p.cases||[];
 const items=bindings.map(b=>{const result=results.find(r=>r.binding_id===b.id);const c=cases.find(c=>c.id===b.id||c.id===b.catalog_id||c.id===b.case_id);const label=c?.name||b.title||b.id;
  return `<section class="trace-field"><h3>${esc(label)}</h3><p>${esc(result?(traceResults[result.status]||result.status):'该记录未提供此执行项结果')}</p>${result?.actual?requirementDocument(result.actual):''}${c?traceLink(traceKey(entry.trace.project.id,'case',entry.scene.id,c.id),'查看关联用例'):''}${traceSafeLink('查看原始执行证据',result?.evidence_url)}${result?.evidence_path&&!result.evidence_url?'<p class="small">原始证据当前不可用，保留执行记录。</p>':''}${b.command?`<details><summary>执行入口</summary><pre>${esc(Array.isArray(b.command)?b.command.join(' '):b.command)}</pre></details>`:''}</section>`;
 }).join('');
 // No guessed matching by order, title or file. Group-level receipts remain group-level.
 const matched=new Set(bindings.flatMap(b=>[b.id,b.catalog_id,b.case_id]).filter(Boolean));
 const unbound=cases.filter(c=>!matched.has(c.id));
 return items+(unbound.length?traceField('未提供逐用例对应结果',unbound.map(c=>c.name)):'')+(!bindings.length?traceField('执行记录',record.execution_records?.length?'存在场景级执行回执；未记录逐用例对应结果。':'此记录没有逐用例对应结果。'):'');
}
function traceEvaluationParts(entry){
 const e=entry.trace.case_presentations?.[entry.scene.id]?.evaluation,d=traceEval(entry),cases=entry.trace.case_presentations?.[entry.scene.id]?.cases||[];
 if(!d)return {overview:traceField('支持程度',traceEvaluationState(entry))+traceField('原因',e?.reason||'当前没有有效的独立用例设计评估。'),related:'',source:traceField('评价边界','用例设计评价不构成执行事实或产品结论。')};
 const citation=id=>`<button type="button" class="trace-cite" data-trace-cite="${esc(id)}" onclick="traceOpenCitation(this)">查看引用 ${esc(id)}</button>`;
 const cites=x=>(x.evidence_ids||[]).map(citation).join('');
 const finding=f=>`<section class="trace-field"><p>${esc(f.statement)}</p>${cites(f)}<details><summary>影响与建议</summary>${traceField('影响',f.impact)}${traceField('建议',f.recommendation)}</details></section>`;
 if(d.schema!=='case-evaluation-v2')return {overview:traceField('支持程度',traceEvaluationState(entry))+traceField('评估摘要',d.summary)+traceField('必要缺口',d.gaps||'原记录未列出'),related:traceField('支持范围',d.supported)+traceField('质量问题',d.quality_issues)+traceField('重复范围',d.redundancy)+traceField('各用例贡献与限制',d.test_assessments),source:traceField('来源','独立评估 Agent · 历史描述性意见，不构成执行结论。')};
 const gaps=(d.findings||[]).filter(f=>f.kind==='gap'),other=(d.findings||[]).filter(f=>f.kind!=='gap');
 const obligationStates={supported:'有支持',partial:'部分支持',unsupported:'缺少支持',uncertain:'待确认'};
 const roles={essential:'关键',complementary:'互补',duplicate:'重复',out_of_scope:'场景外',uncertain:'待确认'};
 const related=(d.obligations||[]).map(o=>`<section class="trace-field"><h3>${esc(obligationStates[o.status]||o.status)} · ${esc(o.quote)}</h3>${requirementDocument(o.assessment)}${cites(o)}</section>`).join('')+'<h3>各用例贡献与取舍</h3>'+(d.case_assessments||[]).map(a=>{const ref=(d.cases||[]).find(c=>c.case_id===a.case_id),c=cases.find(c=>c.id===ref?.original_id||c.id===a.case_id);return `<section class="trace-field">${c?traceLink(traceKey(entry.trace.project.id,'case',entry.scene.id,c.id),c.name):traceField('用例',a.case_id)}${traceField('角色',roles[a.role]||a.role)}${traceField('贡献',a.contribution)}${cites(a)}${a.compared_with?.length?traceField('对照用例',a.compared_with):''}${(a.checks||[]).map(x=>`<details><summary>${esc(x.target)}</summary>${traceField('核对意见',x.assessment)}${x.counterexample?traceField('反例核验',x.counterexample):''}${cites(x)}</details>`).join('')}</section>`;}).join('');
 const evidence=(d.evidence||[]).map(x=>`<details data-trace-evidence="${esc(x.id)}"><summary>${esc(x.id)} · ${esc(x.file)}:${esc(x.line_start)}–${esc(x.line_end)}</summary><pre>${esc(x.quote)}</pre><div class="small">SHA-256：${esc(x.file_sha256)}</div>${x.citation_resolution?`<div class="small">引用行号已按唯一源码原文校正；原结束行 ${esc(x.reported_line_end)}。</div>`:''}</details>`).join('');
 return {overview:traceField('支持程度',traceEvaluationState(entry))+traceField('评估摘要',d.summary)+`<h3>必要缺口 · ${gaps.length} 项</h3>`+gaps.map(finding).join('')+(!gaps.length?'<p>未列出必要缺口；这不代替实际执行和正式结论。</p>':'')+traceField('用例取舍',d.selection_advice)+(other.length?`<details><summary>设计质量、待确认及可选增强 · ${other.length} 项</summary>${other.map(f=>'<h4>'+esc({quality:'设计质量',uncertainty:'待确认',enhancement:'可选增强'}[f.kind]||f.kind)+'</h4>'+finding(f)).join('')}</details>`:''),related,source:traceField('评价来源','独立评估 Agent · 用例设计意见，不构成正式验收结论。')+traceField('引用核对',d.citation_check==='source_quotes_verified'?'生成时已核对引用原文与哈希；语义判断仍需审阅。':'引用尚未完成自动核对。')+evidence+traceField('评估边界',d.limitations)+(e.binding?`<details><summary>评估版本绑定</summary><pre>${esc(JSON.stringify(e.binding,null,2))}</pre></details>`:'')};
}
function traceContent(item){
 if(!item)return null;
 let title,id,kind,overview='',related='',source='',crumbs=[];
 if(item.type==='req'){
  const {parent,entries}=item,{requirement:r,project,presentation:p={}}=parent;title=p.title||r.title||r.id;id=r.id;kind=parent.kind==='scenario'?'独立场景':parent.kind==='reverse'?'规则':'需求';
  overview=(p.warning?traceField('阅读说明状态',p.warning):'')+traceField('需求说明',p.summary||'当前未提供阅读摘要，可在依据与记录中查看完整原始约定。')+(p.rules?.length?traceField('关键规则',p.rules):'')+traceField('场景状态',entries.length?`${entries.length} 个场景；${entries.filter(traceExecution).length} 个已执行；最近确认通过 ${entries.filter(e=>traceVerdict(e)==='passed').length} 个。场景通过数不代表需求已完整验收。`:'尚无场景。');
  related=entries.map(e=>traceLink(traceKey(project.id,'scene',e.scene.id),`${e.scene.title||e.scene.id} · ${e.scene.id} · ${traceExecution(e)?'已执行':'未执行'}／${traceVerdicts[traceVerdict(e)]}`)).join('')||traceField('场景','尚无场景');
  source=traceField('原始约定',r.text)+traceField('项目',project.label||project.id)+traceField('来源',r.origin?.reference||r.source)+traceField('定义版本',r.version)+traceExternal(r.external_refs)+(r.contract_source?traceField('规则依据',r.contract_source):'');
 }else{
  const {entry,parent,reqKey}=item,{trace:t,scene:s}=entry,p=t.case_presentations?.[s.id]||{},req=parent.requirement,reqTitle=parent.presentation?.title||req.title||req.id;
  const sceneKey=traceKey(t.project.id,'scene',s.id),evaluationKey=traceKey(t.project.id,'evaluation',s.id),runKey=traceKey(t.project.id,'run',s.id),verdictKey=traceKey(t.project.id,'verdict',s.id);
  crumbs=[{key:reqKey,title:reqTitle},{key:sceneKey,title:s.title||s.id}];id=s.id;
  if(item.type==='scene'){
   title=s.title||s.id;kind='场景';overview=traceField('场景说明',s.description);
   for(const [key,label] of [['conditions','条件'],['preconditions','前置条件'],['operation','操作'],['steps','步骤'],['expected','预期结果'],['expected_result','预期结果']])if(s[key])overview+=traceField(label,s[key]);
   overview+=traceField('重要程度',s.priority)+traceField('重要性理由',s.priority_reason)+(s.ui_acceptance?traceField('视觉要求',s.ui_acceptance.visual_expectation||s.ui_acceptance):'');
   related=traceLink(reqKey,'关联'+(parent.kind==='scenario'?'约定':'需求')+'：'+reqTitle)+(s.related_refs?.length?traceField('相关约定',s.related_refs):'')+traceRelatedCases(item)+traceLink(evaluationKey,'设计评估：'+traceEvaluationState(entry))+traceLink(runKey,'实际执行：'+(traceExecution(entry)?'已执行':'未执行'))+traceLink(verdictKey,'独立结论：'+traceVerdicts[traceVerdict(entry)])+(p.association_basis?traceField('用例组关联依据',p.association_basis):'');
   source=traceField('场景来源',s.origin?.reference)+traceField('定义版本',s.version)+traceExternal(s.external_refs)+(s.check?traceField('场景采用依据',s.check.basis||s.check):'')+(p.search_limitations?`<details><summary>检索范围与限制</summary>${traceField('原查找记录',p.search_limitations)}</details>`:'')+(t.workspace_case?`<details><summary>当前候选用例位置</summary>${traceField('文件位置',(t.workspace_case.files||[]).map(f=>f.path))}${traceField('执行入口',t.workspace_case.command)}<p class="small">当前候选位置与历史执行版本分别保留。</p></details>`:'');
  }else if(item.type==='case'){
   const c=item.item,src=c.source||{};title=c.name||'未命名用例';id=c.id;kind='用例';overview=traceField('测试方法',c.method)+traceField('实际验证内容',c.assertions)+traceField('验证边界',c.boundary);
   related=traceLink(sceneKey,'关联场景：'+s.title)+(c.association_reason?traceField('关联原因',c.association_reason):'<p class="small">未单独记录逐用例关联原因；可查看场景中的用例组关联依据。</p>')+traceLink(evaluationKey,'查看该场景整组用例的设计评估')+traceLink(runKey,'查看实际执行与逐项对应结果');
   source=traceField('用例来源',{existing:'复用已有用例',generated:'本轮新增用例',unknown:'来源未记录'}[src.origin]||src.origin)+traceSourceFields(src)+traceField('执行入口',Array.isArray(c.command)?c.command.join(' '):c.command)+(p.title_warning?traceField('展示资料状态',p.title_warning):'');
  }else if(item.type==='evaluation'){
   title='用例设计评估';kind='评估';const parts=traceEvaluationParts(entry);overview=parts.overview;related=traceLink(sceneKey,'评估场景：'+s.title)+parts.related;source=parts.source;
  }else if(item.type==='run'){
   title='实际执行';kind='执行';const history=traceHistory(entry);overview=traceField('执行事实',traceExecution(entry)?'已执行':'未执行')+(item.activity?traceField('当前活动',item.activity):'');
   overview+=history.length?traceField('最近执行记录',history[0].attempt_id)+traceField('记录时间',traceTime(history[0].generated_at))+traceField('原始执行结果',(history[0].case_results||[]).map(r=>`${r.binding_id}：${traceResults[r.status]||r.status}`))+traceField('执行与结论','执行结果仅说明实际发生的事情，正式确认结论在独立结论中查看。'):traceField('说明','尚无实际执行记录。关联用例、代码已生成和设计评估都不代表已执行。');
   related=traceLink(sceneKey,'所属场景：'+s.title)+(history.length?history.map((h,i)=>`<details${i===0?' open':''}><summary>${esc(h.attempt_id||'执行记录')} · ${esc(traceTime(h.generated_at))}</summary>${traceExecutionParts(h,entry)}</details>`).join(''):traceRelatedCases(item))+traceLink(verdictKey,'查看独立结论');
   source=history.map(h=>`<details><summary>${esc(h.attempt_id||'执行记录')} · 依据</summary>${traceField('实际代码版本',h.project?.revision)}${traceExecutionParts(h,entry)}${traceLinks(h.current_links)}</details>`).join('')||traceField('执行证据','尚无已登记的执行证据。');
  }else{
   title='独立结论';kind='结论';const v=traceVerdict(entry),confirmed=traceConfirmed.has(t.judgment?.status),record=t.judgment_record;
   overview=traceField('最近确认结论',traceVerdicts[v])+traceField('结论说明',t.judgment?.reason)+(confirmed?traceField('当前适用性',traceValidity(entry)+'。定义一致仍需结合实际产品版本，不据此推断新版本已通过。'):'');
   const ui=t.judgment?.ui_review;if(ui)overview+=traceField('界面验证',{passed:'视觉通过',failed:'视觉缺陷',unverified:'未验证',not_applicable:'不适用'}[ui.status]||ui.status)+traceField('视觉说明',ui.reason)+(ui.screenshots||[]).map(x=>traceSafeLink('查看冻结截图：'+x.label,x.url)).join('');
   related=traceLink(sceneKey,'所属场景：'+s.title)+traceLink(runKey,'查看实际执行与历史记录')+(record?traceField('结论依据的执行记录',record.attempt_id)+traceExecutionParts(record,entry):'');
   source=traceField('结论来源',confirmed?'已保存的独立确认记录':'尚无已确认的独立结论')+traceField('实际代码版本',t.judgment_source?.revision||record?.project?.revision)+traceField('确认时间',t.judgment_source?.confirmed_at||t.judgment?.confirmed_at)+traceField('依据的尝试',t.judgment_source?.attempt_id||record?.attempt_id)+traceLinks(t.current_links)+(confirmed?`<details><summary>完整确认记录</summary><pre>${esc(JSON.stringify(t.judgment,null,2))}</pre></details>`:'');
  }
 }
 return {title,id,kind,crumbs,tabs:[['概览',overview],['关联关系',related],['依据与记录',source]]};
}
function traceReadState(){const dialog=document.querySelector('#requirementDialog');return {key:traceDetailKey,tab:traceTab,scroll:dialog.querySelector('.requirement-reading').scrollTop,snapshot:traceDetailSnapshot,open:Array.from(dialog.querySelectorAll('details[open]')).map(x=>x.dataset.traceEvidence||x.querySelector('summary')?.textContent)};}
function selectRequirementTab(name,focus=false){traceTab=name;const d=document.querySelector('#requirementDialog');d.querySelectorAll('[data-requirement-tab]').forEach(tab=>{const selected=tab.dataset.requirementTab===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus();});for(const key of traceTabs)document.querySelector('#requirementPanel-'+key).hidden=key!==name;d.querySelector('.requirement-reading').scrollTop=0;}
function openRequirement(button){traceOpen(button.dataset.requirementKey,button.dataset.detailTab||'overview',button);}
function traceOpen(key,start='overview',button=null,saved=null){
 const current=requirementCards.get(key);if(!current&&!saved)return;const snapshot=saved?.snapshot||JSON.parse(JSON.stringify(current)),content=traceContent(snapshot);if(!content)return;
 const dialog=document.querySelector('#requirementDialog');if(dialog.open&&!saved)traceBack.push(traceReadState());
 if(!dialog.open){traceOpener=button||document.activeElement;tracePosition={x:window.scrollX,y:window.scrollY,containers:Array.from(document.querySelectorAll('.scroll')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))};}
 traceDetailKey=key;traceDetailSnapshot=snapshot;traceDetailVersion=JSON.stringify(snapshot);document.querySelector('#requirementDialogTitle').textContent=content.title;document.querySelector('#requirementDialogId').textContent=content.kind+' · '+(content.id||'编号未记录');
 document.querySelector('#traceCrumbs').innerHTML=content.crumbs.filter(x=>x.key!==key).map(x=>traceButton(x.key,x.title,'trace-crumb')).join('<span class="small"> / </span>');
 dialog.querySelector('.requirement-close').setAttribute('aria-label','关闭'+content.kind+'详情');
 traceTabs.forEach((name,i)=>{document.querySelector('#requirementTab-'+name).textContent=content.tabs[i][0];document.querySelector('#requirementPanel-'+name).innerHTML=content.tabs[i][1];});
 selectRequirementTab(saved?.tab||start);document.querySelector('#traceBack').disabled=!traceBack.length;document.querySelector('#traceCopyStatus').textContent='';
 if(saved){for(const d of dialog.querySelectorAll('details'))if(saved.open?.includes(d.dataset.traceEvidence||d.querySelector('summary')?.textContent))d.open=true;dialog.querySelector('.requirement-reading').scrollTop=saved.scroll;}
 if(!dialog.open){document.body.classList.add('requirement-modal-open');dialog.showModal();}else{const title=document.querySelector('#requirementDialogTitle');title.tabIndex=-1;title.focus({preventScroll:true});}
 traceCheckDetailUpdate();
}
function traceCheckDetailUpdate(){const d=document.querySelector('#requirementDialog'),notice=document.querySelector('#traceDetailUpdate');if(!d?.open||!notice)return;const latest=requirementCards.get(traceDetailKey);notice.hidden=!!latest&&JSON.stringify(latest)===traceDetailVersion;notice.textContent=latest?'有更新，查看最新':'当前列表已变化，正在阅读已打开的记录';notice.disabled=!latest;}
function traceOpenCitation(button){selectRequirementTab('source',true);const id=button.dataset.traceCite,target=Array.from(document.querySelectorAll('#requirementPanel-source [data-trace-evidence]')).find(e=>e.dataset.traceEvidence===id);if(!target)return;target.open=true;target.querySelector('summary')?.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
function initRequirementDialog(){const d=document.querySelector('#requirementDialog');if(d.dataset.initialized)return;d.dataset.initialized='true';
 d.querySelector('.requirement-close').addEventListener('click',()=>d.close());d.addEventListener('close',()=>{document.body.classList.remove('requirement-modal-open');const target=traceOpener?.isConnected?traceOpener:Array.from(document.querySelectorAll('[data-requirement-key]')).find(x=>x.dataset.requirementKey===traceOpener?.dataset.requirementKey);target?.focus({preventScroll:true});if(tracePosition){for(const p of tracePosition.containers){p.node.scrollLeft=p.x;p.node.scrollTop=p.y;}window.scrollTo(tracePosition.x,tracePosition.y);}traceBack=[];traceDetailKey='';});
 let backdrop=false;d.addEventListener('pointerdown',e=>{const r=d.getBoundingClientRect();backdrop=e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);});d.addEventListener('click',e=>{if(backdrop&&e.target===d)d.close();backdrop=false;});
 d.querySelectorAll('[data-requirement-tab]').forEach(tab=>{tab.addEventListener('click',()=>selectRequirementTab(tab.dataset.requirementTab));tab.addEventListener('keydown',e=>{const i=traceTabs.indexOf(tab.dataset.requirementTab);const n={ArrowRight:(i+1)%3,ArrowLeft:(i+2)%3,Home:0,End:2}[e.key];if(n===undefined)return;e.preventDefault();selectRequirementTab(traceTabs[n],true);});});
 document.querySelector('#traceBack').addEventListener('click',()=>{const previous=traceBack.pop();if(previous)traceOpen(previous.key,previous.tab,null,previous);});
 document.querySelector('#traceDetailUpdate').addEventListener('click',()=>{const key=traceDetailKey;const latest=requirementCards.get(key);if(latest){traceDetailSnapshot=null;traceOpen(key,traceTab,null,{snapshot:latest,tab:traceTab,open:[],scroll:0});}});
 document.querySelector('#traceCopy').addEventListener('click',async()=>{const item=traceDetailSnapshot,c=traceContent(item),entry=item?.entry;const text=[`验收：${document.querySelector('#acceptanceId')?.value||'当前查看记录'}`,`对象：${c.kind} ${c.id} ${c.title}`,...c.crumbs.map(x=>`关联：${traceContent(requirementCards.get(x.key))?.id||''} ${x.title}`),entry?`当前记录：设计评估 ${traceEvaluationState(entry)}；执行 ${traceExecution(entry)?'已执行':'未执行'}；独立结论 ${traceVerdicts[traceVerdict(entry)]}；${traceValidity(entry)}`:'','请结合已有依据解释这个对象及当前尚未验证的部分。'].filter(Boolean).join('\n');try{await navigator.clipboard.writeText(text);document.querySelector('#traceCopyStatus').textContent='已复制';}catch{document.querySelector('#traceCopyStatus').textContent='浏览器未允许复制，请使用对象编号追问。';}});
 for(const [id,set] of [['traceSearch',v=>traceSearch=v],['traceFilter',v=>traceFilter=v],['tracePriority',v=>tracePriority=v]])document.getElementById(id)?.addEventListener(id==='traceSearch'?'input':'change',e=>{set(e.target.value);if(traceGroups)renderTraceTable(traceGroups.reqs,traceGroups.grouped);});
 document.querySelector('#traceClear').addEventListener('click',()=>{traceSearch='';traceFilter='all';tracePriority='all';document.querySelector('#traceSearch').value='';document.querySelector('#traceFilter').value='all';document.querySelector('#tracePriority').value='all';if(traceGroups)renderTraceTable(traceGroups.reqs,traceGroups.grouped);});
 document.querySelector('#traceLocate').addEventListener('change',e=>{const key=e.target.value;if(!key)return;traceSearch='';traceFilter='all';tracePriority='all';document.querySelector('#traceSearch').value='';document.querySelector('#traceFilter').value='all';document.querySelector('#tracePriority').value='all';if(traceGroups)renderTraceTable(traceGroups.reqs,traceGroups.grouped);const entry=Array.from(document.querySelectorAll('[data-trace-owner]')).find(x=>x.dataset.traceOwner===key);entry?.closest('tr')?.scrollIntoView({block:'center'});});
}
