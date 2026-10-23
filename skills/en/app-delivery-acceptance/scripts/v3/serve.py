#!/usr/bin/env python3
"""Read-only trace viewer for project-neutral acceptance slices."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from coverage_views import summarize
from progress_views import collect as collect_progress
from project_statistics import project_state
from case_presentations import attach_case_presentations
from requirement_views import DIALOG_CSS, DIALOG_HTML, DIALOG_SCRIPT


HTML = r'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>交付验收追踪</title><style>
:root{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#243832;background:#f3f6f3}*{box-sizing:border-box}body{margin:0;padding:24px}main{max-width:1600px;margin:auto}h1{font-size:27px;margin:0 0 6px}p{color:#62756d;margin:5px 0 18px}.panel{background:white;border:1px solid #dbe5df;border-radius:16px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 3px #253c3210}.metrics{display:flex;gap:12px;flex-wrap:wrap}.overview{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.metric{min-width:0;padding:14px;border:1px solid #e2e9e5;border-radius:12px}.metric strong{display:block;font-size:21px}.work-item{border-top:1px solid #e2e9e5;padding:12px 0}.work-item:first-child{border-top:0}.work-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:#667970}.tag{display:inline-block;border-radius:7px;background:#e8f1ec;color:#176346;padding:3px 7px;margin:2px 4px 2px 0;font-weight:600;font-size:13px}.pending{background:#fff0ca;color:#775100}.passed{background:#dcf4e4;color:#21613d}.failed{background:#fde3df;color:#a33b31}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border-top:1px solid #e2e9e5;text-align:left;vertical-align:top;padding:12px 10px;overflow-wrap:anywhere}th{font-size:13px;color:#667970}td{font-size:14px;line-height:1.5}th:nth-child(1){width:15%}th:nth-child(2){width:22%}th:nth-child(3){width:22%}th:nth-child(4){width:13%}th:nth-child(5){width:13%}th:nth-child(6){width:15%}.title{font-weight:700}.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.clamp.open{display:block}button{border:0;background:none;color:#176346;cursor:pointer;padding:4px 0;font:inherit}button:hover{text-decoration:underline}.small{font-size:12px;color:#667970}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}select{padding:7px 10px;border-radius:8px;border:1px solid #cddbd2;background:white}a{color:#176346}.case-card>details>summary{font-weight:700;color:#243832;line-height:1.6}.case-card>details{margin-top:0}.case-evaluation>details>summary{font-weight:600}.case-card{border-top:1px solid #e2e9e5;margin-top:10px;padding-top:10px}.case-field{margin-top:8px}.case-label{display:block;font-size:12px;font-weight:600;color:#667970}.case-section-title{font-weight:700;margin-bottom:6px}.case-evaluation{margin-top:16px;border-top:2px solid #dbe5df;padding-top:12px}.case-info details{margin-top:10px}.case-info .clamp{white-space:pre-line}details{margin-top:5px}summary{cursor:pointer;color:#176346}@media(max-width:1050px){.overview{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:900px){body{padding:12px}.scroll{overflow:auto}table{min-width:950px}}@media(max-width:560px){.overview{grid-template-columns:1fr}}
</style></head><body><main><h1>交付验收追踪</h1><p>需求 → 测试场景 → 用例／操作 → 实际执行 → 独立结论。覆盖率来自对应场景尝试的真实采集。</p>
<section class="panel" id="activePanel" hidden><div class="toolbar"><h2 style="margin:0;flex:1">正在处理</h2><span id="currentWork" class="small"></span></div><div id="progress"></div></section><section class="panel"><h2 style="margin:0 0 12px">验收概览</h2><div id="metrics" class="overview"></div><p class="small">场景指标统一以项目全部场景数为分母。执行过就算已执行，重复执行只计一次；结果保留最近一次已确认结论，换版或准备重跑不会清空结果。接受风险单列，不计通过或待处理 BUG。<span id="resultBalance"></span></p></section><section class="panel"><div class="toolbar"><h2 style="margin:0;flex:1">代码覆盖率</h2><label>分母 <select id="coverageScope"><option value="project">整个项目用户代码</option><option value="changed_files">修改文件</option><option value="changed_lines">提交／PR 修改行</option></select></label></div><div id="coverageSummary" class="metrics"></div><p class="small">由专用工具合并所选场景的兼容报告；切换统计范围同步更新行与分支。缺少报告不推断为零覆盖。</p></section><section class="panel trace-panel"><div class="toolbar"><h2 style="margin:0;flex:1">追踪关系</h2><label>项目 <select id="project"><option value="">全部项目</option></select></label></div><p class="small trace-purpose">从需求追踪关联用例、实际执行与已确认结论。点击名称或状态查看详情。</p><div class="trace-tools"><input type="search" id="traceSearch" aria-label="搜索需求、场景或用例" placeholder="搜索名称或编号"><select id="traceFilter" aria-label="状态筛选"><option value="all">全部状态</option><option value="attention">需要关注</option><option value="not_run">未执行</option><option value="executed">已执行</option><option value="passed">已有通过结论</option><option value="pending_review">等待确认</option><option value="revalidate">待重新验证</option></select><select id="tracePriority" aria-label="重要程度"><option value="all">全部重要程度</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select><button type="button" class="trace-clear" id="traceClear">清除筛选</button><select id="traceLocate" aria-label="定位需求或规则"><option value="">定位需求／规则</option></select></div><p class="trace-mobile-hint small">横向滑动查看完整五列关系。</p><div class="scroll trace-scroll" tabindex="0" aria-label="追踪关系表格，可横向滚动"><table><thead><tr><th scope="col">需求／规则</th><th scope="col">测试场景</th><th scope="col">用例／操作</th><th scope="col">实际执行</th><th scope="col">独立结论</th></tr></thead><tbody id="rows"></tbody></table></div><div id="traceShown" class="small" aria-live="polite"></div></section><p id="updated" class="small"></p></main>
<script>
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const expanded=new Set();
function block(text){const raw=String(text??''),key=Array.from(raw).reduce((h,c)=>((h*33)^c.codePointAt(0))>>>0,5381).toString(36),open=expanded.has(key);
 return `<div class="clamp${open?' open':''}">${esc(raw)}</div><button type="button" data-expand="${key}" onclick="toggleBlock(this)">${open?'收起':'展开'}</button>`}
function toggleBlock(button){const key=button.dataset.expand;if(expanded.has(key))expanded.delete(key);else expanded.add(key);button.previousElementSibling.classList.toggle('open');button.textContent=expanded.has(key)?'收起':'展开'}
function clipButtons(){document.querySelectorAll('.clamp').forEach(el=>{const button=el.nextElementSibling;if(button?.dataset.expand)button.hidden=!el.classList.contains('open')&&el.scrollHeight<=el.clientHeight+1})}
function status(text){let cls=/^passed$/.test(text)?'passed':/failed|bug|repair/.test(text)?'failed':'pending';let labels={passed:'通过',pending_review:'待确认结论',product_bug:'产品 BUG',accepted_risk:'接受风险',inconclusive:'证据不足',executed:'已执行',repair_required:'需修复测试',not_run:'未执行',failed:'失败',blocked:'受阻'};return `<span class="tag ${cls}">${esc(labels[text]||text)}</span>`}
function renderProgress(stages){const project=document.querySelector('#project').value,names={analysis:'全部需求分析',reverse:'代码逆向规则',scenario:'场景生成与审查',case:'用例设计、执行与判定'};
 const active=stages.filter(s=>(!project||s.project_id===project)&&!s.finished&&['running','repair','blocked'].includes(s.state))
  .sort((a,b)=>Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0));
 const panel=document.querySelector('#activePanel');panel.hidden=!active.length;
 if(!active.length){document.querySelector('#progress').innerHTML='';document.querySelector('#currentWork').textContent='';return}
 const item=s=>{const target=[s.requirement_id,s.target_id].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' · ')||
  (s.kind==='analysis'?'全部需求':'代码变更');
  const blocked=s.state==='blocked'||s.state==='repair';
  return `<div class="work-item"><div class="work-head"><span class="tag ${blocked?'pending':'passed'}">${blocked?'等待处理':'进行中'}</span><strong>${esc(s.project_label)} · ${esc(target)}</strong><span class="small">${esc(names[s.kind]||s.kind)}</span></div><div>${esc(s.detail)}</div>${s.blocker?`<div class="small">阻塞原因：${block(s.blocker)}</div>`:''}<div class="small">最近更新：${esc(s.updated_at?new Date(s.updated_at).toLocaleString('zh-CN'):'尚无')}${s.attempt?' · 第 '+esc(s.attempt)+' 次尝试':''}</div></div>`};
 document.querySelector('#currentWork').textContent=`${active.length} 项`;
 document.querySelector('#progress').innerHTML=item(active[0])+(active.length>1?`<details><summary>查看其余 ${active.length-1} 项</summary>${active.slice(1).map(item).join('')}</details>`:'');clipButtons();}
function toolPct(v){return typeof v?.pct==='number'?v.pct.toLocaleString('zh-CN',{maximumFractionDigits:2})+'%':'工具提供计数'}
function pct(v){return v.total?Math.round(v.covered/v.total*100)+'%':'无分母'}
function cover(c){
 if(c?.protocol==='project-coverage-v1'){
  if(!c.verified)return `<span class="muted">项目覆盖率等待工具证据校验</span>`;
  const metric=(label,v)=>v&&typeof v.total==='number'?`${label} ${v.covered}/${v.total}（${v.total?(toolPct(v)):'不适用'}）`:`${label}：${v?.reason||'不可计算'}`;
  return (c.components||[]).map(x=>`<div><strong>${esc(x.label||x.id)}</strong></div><div>${esc(metric('行',x.line))}</div><div>${esc(metric('分支',x.branch))}</div>`).join('')+`<div class="small">${c.status==='incomplete'?'采集不完整；':''}${esc(c.capture_note||'同轮真实采集')} ${esc(c.capture_end||'')}</div>`;
 }
 if(c?.provider!=='istanbul-source-v1'||!c.summary)return `<span class="muted">${esc(c?.reason||({pending:'待采集',off:'已关闭采集',unavailable:'无法测量'})[c?.status]||'历史报告未按当前专用工具规约验证')}</span>`;
 const l=c.summary.lines,b=c.summary.branches;
 return `<div>行 ${l.covered}/${l.total}（${l.total?l.pct+'%':'不适用'}）</div><div>分支 ${b.covered}/${b.total}（${b.total?b.pct+'%':'不适用'}）</div><div class="small">${c.status==='incomplete'?'已测范围；存在采集缺口。':''}同轮真实采集，覆盖率不代表验收通过。</div>`;
}
function render(items){
 const chosen=document.querySelector('#project').value,visible=items.filter(x=>!chosen||x.project.id===chosen);
 const reqs=new Map(),scenes=new Map();
 for(const t of visible){
  for(const r of t.requirements)reqs.set(t.project.id+':'+r.id,{project:t.project,requirement:r,kind:'original',presentation:t.requirement_presentations?.[r.id]});
  for(const r of t.reverse_rules||[])reqs.set(t.project.id+':'+r.id,{project:t.project,requirement:r,kind:'reverse',change:t.change,presentation:t.requirement_presentations?.[r.id]});
  for(const s of t.scenarios){const key=t.project.id+':'+s.id,old=scenes.get(key),attempt=x=>Number(String(x.attempt_id||'').match(/\d+/)?.[0]||0);
   const newerAttempt=t.provisional&&t.progress_kind==='case'&&t.progress_state!=='done'&&old&&attempt(t)>attempt(old.trace);
   const olderThanActive=old?.trace.provisional&&old.trace.progress_kind==='case'&&old.trace.progress_state!=='done'&&attempt(old.trace)>attempt(t);
   if(!olderThanActive&&(!old||newerAttempt||Date.parse(old.trace.generated_at)<Date.parse(t.generated_at)||
      (old.trace.provisional&&!t.provisional&&Date.parse(old.trace.generated_at)===Date.parse(t.generated_at))))scenes.set(key,{trace:t,scenario:s});}
 }
 const grouped=new Map([...reqs.keys()].map(key=>[key,[]]));
 for(const entry of scenes.values()){
  const {trace:t,scenario:s}=entry,key=t.project.id+':'+(s.requirement_id||('scenario:'+s.id));
  if(!reqs.has(key)){reqs.set(key,{project:t.project,requirement:{id:s.requirement_id||s.id,text:s.requirement_id?'需求或规则文本缺失':'采用场景本身的冻结约定；没有单独上层需求。'},kind:s.requirement_id?'original':'scenario'});grouped.set(key,[])}
  grouped.get(key).push(entry);
 }
 const executed=({trace:t,scenario:s})=>t.execution_known??Boolean(t.execution_records_by_scene?.[s.id]?.length||t.case_results.some(r=>t.bindings.some(b=>b.id===r.binding_id&&b.scenario_id===s.id)&&['passed','failed','executed','error','aborted'].includes(r.status)));
 const approved=[...scenes.values()];
 const total=approved.length,linked=new Set(approved.map(({trace:t,scenario:s})=>t.project.id+':'+s.requirement_id)).size;
 const executedScenes=approved.filter(executed).length;
 const resultScenes=approved.filter(executed);
 const passed=resultScenes.filter(({trace:t})=>t.judgment?.status==='passed').length;
 const bugs=resultScenes.filter(({trace:t})=>t.judgment?.status==='product_bug').length;
 const acceptedRisk=resultScenes.filter(({trace:t})=>t.judgment?.status==='accepted_risk').length;
 const needsAttention=resultScenes.filter(({trace:t})=>['repair_required','blocked','inconclusive'].includes(t.judgment?.status)).length;
 const pendingResults=resultScenes.length-passed-bugs-acceptedRisk-needsAttention;
 renderTraceTable(reqs,grouped);
 const locate=document.querySelector('#traceLocate');
 if(locate){const current=locate.value;locate.innerHTML='<option value="">定位需求／规则</option>'+[...reqs].map(([key,v])=>`<option value="${esc(key)}">${esc(v.presentation?.title||v.requirement.title||v.requirement.id)}</option>`).join('');locate.value=current;}
 const metric=(label,value,denominator)=>`<div class="metric"><span>${label}</span><strong>${value}/${denominator}</strong><span class="small">${denominator?Math.round(value/denominator*100)+'%':'暂无分母'}</span></div>`;
 document.querySelector('#metrics').innerHTML=metric('已有场景的需求／规则',linked,[...reqs.values()].filter(r=>r.kind==='original'||r.requirement.status!=='needs_confirmation').length)+metric('已执行场景',executedScenes,total)+
  metric('通过场景',passed,total)+metric('发现 BUG 场景',bugs,total)+metric('接受风险场景',acceptedRisk,total)+metric('需修复／受阻场景',needsAttention,total)+
  (pendingResults?metric('待确认结论场景',pendingResults,total):'');
 const sum=passed+bugs+acceptedRisk+needsAttention+pendingResults;
 document.querySelector('#resultBalance').textContent=`结果合计：${passed} 通过＋${bugs} BUG＋${acceptedRisk} 接受风险＋${needsAttention} 需修复／受阻＋${pendingResults} 待确认结论＝${sum} 已执行。`+(sum!==executedScenes?'统计错误：分类合计与已执行数不一致。':'');
}
let traces=[],previews=[],stages=[],coverageRows=[],projectRows=null;
function renderCoverage(){
 const project=document.querySelector('#project').value,scope=document.querySelector('#coverageScope').value;
 const rows=coverageRows.filter(x=>!project||x.project_id===project);
 document.querySelector('#coverageSummary').innerHTML=rows.map(x=>{
  const m=x.scopes[scope]||{},tools=(x.tools||[]).map(t=>`${t.name} ${t.version||'版本未记录'}`).join('；');
  const metric=(label,v)=>{const ready=v&&typeof v.total==='number'&&typeof v.covered==='number';return `<div class="metric"><span>${esc(label)}</span><strong>${ready?(v.total?(esc(toolPct(v))):'不适用'):'暂不可计算'}</strong><span class="small">${ready?`${v.covered} / ${v.total}`:''}</span><span class="small">${esc(v?.status==='incomplete'||m.status==='incomplete'?'已测范围，数据尚不完整':m.reason||'')}</span></div>`;};
  const values=m.components?.length?m.components.map(c=>`<div class="title">${esc(c.label||c.id)}</div>`+metric('行覆盖率',c.line)+metric('分支覆盖率',c.branch)).join(''):metric('行覆盖率',m.line)+metric('分支覆盖率',m.branch);
  return values+`<div class="small">${esc(m.reason||'')} ${esc(tools?'工具：'+tools:'工具信息未记录')}</div><div class="small">${x.scenes_with_coverage}/${x.scenes} 场景有采集记录 · ${esc(x.collection_note||'')}</div>`;
 }).join('')||'<span class="muted">暂无可计算的执行数据</span>';
}
async function refresh(){try{const data=await(await fetch('/api/traces',{cache:'no-store'})).json();traces=data.traces;previews=data.progress?.previews||[];stages=data.progress?.stages||[];coverageRows=data.coverage;projectRows=data.project_state?.traces||null;const select=document.querySelector('#project'),current=select.value,options=[...new Map([...traces,...previews].map(x=>[x.project.id,x.project.label||x.project.id])).entries()];select.innerHTML='<option value="">全部项目</option>'+options.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');select.value=current;render(projectRows||[...previews,...traces]);renderProgress(stages);renderCoverage();document.querySelector('#updated').textContent='最后更新：'+new Date().toLocaleString()}catch(e){document.querySelector('#updated').textContent='读取失败：'+e.message}}
initRequirementDialog();
document.querySelector('#project').addEventListener('change',()=>{render(projectRows||[...previews,...traces]);renderProgress(stages);renderCoverage()});document.querySelector('#coverageScope').addEventListener('change',renderCoverage);refresh();setInterval(refresh,5000);
</script></body></html>'''

HTML = HTML.replace('</style>', DIALOG_CSS + '</style>', 1).replace(
    '</main>', '</main>' + DIALOG_HTML, 1).replace(
    'const expanded=new Set();', 'const expanded=new Set();\n' + DIALOG_SCRIPT, 1)


def coverage_inputs(traces, progress, trace_folders=None):
    """Keep a new pending attempt from inheriting an older attempt's coverage."""
    latest = {}
    for index, trace in enumerate(traces):
        project = trace.get('project') or {}
        match = re.search(r'attempt-(\d+)', str(trace.get('attempt_id') or ''))
        attempt = int(match.group(1)) if match else 0
        folder = trace_folders[index] if trace_folders else ''
        for scene in trace.get('scenarios') or []:
            key = (project.get('id'), project.get('revision'), scene.get('id'))
            if key not in latest or trace.get('generated_at', '') > latest[key][0]:
                latest[key] = (trace.get('generated_at', ''), attempt, folder)
    result = list(traces)
    for preview in progress.get('previews') or []:
        if preview.get('progress_kind') != 'case':
            continue
        project = preview.get('project') or {}
        scene = (preview.get('scenarios') or [{}])[0]
        key = (project.get('id'), project.get('revision'), scene.get('id'))
        old = latest.get(key)
        if old and preview.get('attempt_number', 0) <= old[1] and (
                not old[2] or preview.get('progress_folder') == old[2]):
            continue
        result.append(preview)
    return result


def serve(roots, port):
    roots = [p.resolve() for p in roots]
    def current_paths():
        found = []
        for root in roots:
            found.extend(sorted(root.rglob("trace.json")) if root.is_dir() else [root])
        return list(dict.fromkeys(p for p in found if p.is_file()))
    def key(path):
        return hashlib.sha256(str(path).encode()).hexdigest()[:16]
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/":
                raw, mime = HTML.encode(), "text/html; charset=utf-8"
            elif parsed.path == "/api/traces":
                traces = []
                trace_folders = []
                for path in current_paths():
                    trace = json.loads(path.read_text())
                    if trace.get("schema") != "delivery-trace-v1":
                        self.send_error(422, "invalid trace schema"); return
                    for result in trace.get("case_results", []):
                        evidence = Path(result.get("evidence_path", ""))
                        if evidence.is_file() and evidence.resolve().is_relative_to(path.parent):
                            result["evidence_url"] = f"/api/evidence?trace={key(path)}&binding={result['binding_id']}"
                    traces.append(trace)
                    trace_folders.append(str(path.parent.parent if path.parent.name.startswith('attempt-') else path.parent))
                progress = collect_progress(roots, traces)
                state = project_state(traces, progress)
                attach_case_presentations(state["traces"])
                raw, mime = json.dumps({"traces": traces, "progress": progress,
                                        "project_state": state,
                                        "coverage": summarize(coverage_inputs(traces, progress, trace_folders))},
                                       ensure_ascii=False).encode(), "application/json; charset=utf-8"
            elif parsed.path == "/api/evidence":
                args = parse_qs(parsed.query)
                try:
                    path = next(p for p in current_paths() if key(p) == args["trace"][0])
                    binding = args["binding"][0]
                    trace = json.loads(path.read_text())
                    result = next(x for x in trace["case_results"] if x["binding_id"] == binding)
                    evidence = Path(result["evidence_path"]).resolve()
                    if not evidence.is_relative_to(path.parent) or not evidence.is_file():
                        raise ValueError("evidence outside trace")
                    raw, mime = evidence.read_bytes(), "text/plain; charset=utf-8"
                except (KeyError, IndexError, ValueError, StopIteration):
                    self.send_error(404); return
            else:
                self.send_error(404); return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers(); self.wfile.write(raw)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}/", "traces": [str(x) for x in current_paths()]}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("traces", nargs="+", type=Path)
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--acceptance-id", help="Select an acceptance within one project directory")
    ap.add_argument("--legacy-assets", action="store_true", help="Read historical unregistered artifact roots without migration")
    args = ap.parse_args()
    if args.legacy_assets:
        if args.acceptance_id:
            ap.error("--acceptance-id requires project mode")
        serve(args.traces, args.port)
    else:
        if len(args.traces) != 1 or not args.traces[0].is_dir():
            ap.error("supply exactly one project directory; use --legacy-assets only for old artifact roots")
        from project_view import serve_project
        serve_project(args.traces[0], args.port, args.acceptance_id)
