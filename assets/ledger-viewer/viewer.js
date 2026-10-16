"use strict";

const $ = id => document.getElementById(id);
const state = { data: null, trace: null, run: "", view: "overview", selected: "", search: "", package: "", coverage: "", kind: "", priority: "", unit: "" };
const obj = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const rows = (value, key = "items") => array(obj(value)[key]).filter(v => v && typeof v === "object" && !Array.isArray(v));
const text = value => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, (key, entry) => ["fault_probes", "state_probes"].includes(key) ? undefined : entry, 2);
const strings = value => array(value).filter(v => typeof v === "string");
const doc = name => obj(state.data?.documents?.[name]);
const confirmedRequirementRows = () => rows(doc("requirements.json"));
const requirementRows = () => [...confirmedRequirementRows(), ...AcceptanceTrace.ruleRows(state.data || {})];
const scenarioRows = () => AcceptanceTrace.ordered(rows(doc("scenarios.json")));
const reviewRows = () => rows(doc("coverage_review.json"));
const requirement = id => requirementRows().find(r => r.id === id);
const review = id => doc("source-analysis.json").stage === "white-box" ? AcceptanceTrace.whiteDesignReview(state.data,id) : reviewRows().find(r => r.requirement_id === id);
const designBasis = id => doc("source-analysis.json").stage === "white-box" ? AcceptanceTrace.whiteDesignBasis(state.data,id) : rows(doc("scenarios.json"), "design_basis").find(r => r.requirement_id === id);
const designCriteria = {requirement_alignment: "需求一致", coverage_completeness: "重要情况覆盖", method_discrimination: "验收判据能否区分对错", fault_detection: "错误发现能力", scope_boundaries: "范围与边界"};
const linkedScenarios = id => scenarioRows().filter(s => AcceptanceTrace.sceneLinks(s).includes(id));
const packageLabel = value => {
  const named = rows(doc("project.json"), "packages").find(p => p.id === value);
  return named?.name ? `${text(named.name)} · ${value}` : value;
};
const labels = { acceptance: "验收方法", execution_error: "AI 无法完成执行", passed: "执行通过", blocked: "受阻", failed: "失败", unproven: "未证明", unreviewed: "未审查", sufficient: "覆盖充分", gap: "有覆盖缺口", needs_clarification: "需求待澄清", current: "版本一致", stale: "已过期", unavailable: "不可核验", white_box_ready: "白盒设计就绪", black_box_ready: "黑盒设计就绪", black_box: "黑盒", white_box: "白盒", ai_check: "AI 操作方法", case: "已有测试引用", uncovered: "未关联场景", not_executed: "未执行", not_run: "明确未执行", invalid: "记录无效", reviewed: "证据审查通过" };
const el = (tag, className = "", ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  children.forEach(child => { if (child != null) node.append(child instanceof Node ? child : document.createTextNode(text(child))); });
  return node;
};
const button = (label, callback) => { const node = el("button", "", label); node.type = "button"; node.addEventListener("click", callback); return node; };
const badge = (status, caption) => el("span", "badge " + (["passed", "sufficient", "current", "black_box_ready", "white_box_ready", "reviewed"].includes(status) ? "good" : ["blocked", "failed", "gap", "stale", "invalid"].includes(status) ? "bad" : "warn"), caption || labels[status] || status || "未记录");
const raw = (value, title = "查看原始 JSON") => { const node = el("details", "raw", el("summary", "", title), el("pre", "", JSON.stringify(value, (key, entry) => ["fault_probes", "state_probes"].includes(key) ? undefined : entry, 2))); return node; };
const panel = (title, ...children) => el("section", "panel", el("h3", "", title), ...children);
const prose = (value, mono = false) => {
  if (Array.isArray(value)) return el("ol", "", ...value.map(v => el("li", "prose", text(v))));
  return el("div", "prose" + (mono ? " mono" : ""), text(value) || "未记录");
};
const field = (label, value) => el("div", "", el("h4", "", label), prose(value));

function navigate(view, id = "") {
  if (["history", "code-coverage", "iterations", "artifacts"].includes(view)) { view = "trace"; id = ""; }
  if (view === "requirements") view = "trace";
  if (view === "gates") { view = "overview"; id = ""; }
  if (view === "review") { if (id) openDesignReview(id); else navigate("trace"); return; }
  if (designModal) designModal.dialog.close();
  hidePriorityTooltip();
  state.view = view; state.selected = id;
  state.search = state.package = state.coverage = state.kind = state.priority = state.unit = "";
  ["search", "package", "coverage", "kind", "priority", "unit"].forEach(key => { if ($(key)) $(key).value = ""; });
  const hash = view + (id ? "/" + encodeURIComponent(id) : "");
  if (location.hash.slice(1) !== hash) history.replaceState(null, "", "#" + hash);
  render();
}

function links(ids, view) {
  const node = el("div", "links");
  strings(ids).forEach(id => node.append(button(id, () => navigate(view, id))));
  if (!node.childNodes.length) node.append(el("span", "muted", "无关联条目"));
  return node;
}

function packageOf(id) { const r = requirement(id); return text(r?.package) || text(id).replace(/-\d+$/, "") || "未分类"; }
function packagesFor(record) {
  if (state.view === "scenarios") return [...new Set(requirementIdsOf(record).map(packageOf))];
  return [packageOf(state.view === "review" ? record.requirement_id : record.id)];
}
function statusOf(record) {
  const scopeDoc = doc("acceptance-plan.json");
  if (state.view !== "scenarios" && scopeDoc.standard && !array(scopeDoc.checks).some(c=>c.requirement_id === record.id && c.disposition === "included")) return "out_of_scope";
  const ids = requirementIdsOf(record);
  const reverse = ids.map(id => requirement(id)).filter(r => r?.source_type === "white_box_reverse");
  if (reverse.length) { const values = reverse.map(r => AcceptanceTrace.ruleStatus(state.data,r)); return ["stale","unavailable","gap","needs_clarification"].find(s => values.includes(s)) || "sufficient"; }
  if (ids.some(id => !linkedScenarios(id).some(s => s.kind === (doc("source-analysis.json").stage === "white-box" ? "white_box" : "black_box")))) return "uncovered";
  const statuses = ids.map(id => doc("source-analysis.json").stage === "white-box" ? AcceptanceTrace.whiteDesignStatus(state.data,id) : AcceptanceTrace.designStatus(state.data, review(id)));
  for (const status of ["stale", "unavailable", "gap", "needs_clarification"]) if (statuses.includes(status)) return status;
  if (ids.length && statuses.every(status => status === "sufficient")) return "sufficient";
  return "unreviewed";
}
function requirementIdsOf(record) {
  return state.view === "scenarios" ? AcceptanceTrace.sceneLinks(record) : [state.view === "review" ? record.requirement_id : record.id];
}
function records() {
  if (state.view === "trace") return requirementRows().filter(r => !state.selected || r.id === state.selected);
  if (state.view === "review") return reviewRows().map(v => ({ ...v, id: v.requirement_id }));
  return scenarioRows();
}
function titleOf(record) {
  if (state.view === "scenarios") return text(record.title) || "未命名场景";
  const content = state.view === "review" ? requirement(record.requirement_id)?.text : record.text;
  return text(content).split("\n")[0] || "无需求正文";
}
function searchText(record) {
  let related = "";
  if (state.view === "scenarios") {
    related += AcceptanceTrace.sceneLinks(record).map(id => JSON.stringify(requirement(id) || {})).join(" ");
  } else related = linkedScenarios(record.id).map(s => JSON.stringify(s)).join(" ") + JSON.stringify(review(record.id) || {});
  return (JSON.stringify(record) + related).toLocaleLowerCase();
}

function renderOverview() {
  const data = state.data;
  const reqs = confirmedRequirementRows(), scenarios = scenarioRows();
  $("project").textContent = `${text(doc("project.json").name) || "所选项目"} · ${data.assets}`;
  $("loaded").textContent = "读取于 " + new Date(data.loaded_at).toLocaleString();
  const metric = (label, value, detail = "") => el("div", "metric", el("strong", typeof value === "string" && value.length > 8 ? "value-text" : "", value), el("span", "", label), detail ? el("span", "", detail) : null);
  const ready = ["black_box_ready","white_box_ready"].includes(data.current_check?.status);
  $("summary").replaceChildren(metric("已确认需求", reqs.length, AcceptanceTrace.ruleRows(data).length ? `${AcceptanceTrace.ruleRows(data).length} 条白盒逆向规则另列` : ""), metric("场景", scenarios.length, `${scenarios.filter(s => s.kind === "black_box").length} 黑盒 / ${scenarios.filter(s => s.kind === "white_box").length} 白盒`), metric("已关联需求", `${state.trace.requirementStats.linked} / ${state.trace.requirementStats.total}`), metric("当前场景设计", ready ? "就绪" : "待处理"));
  const alerts = [];
  if (data.scope_status?.status === "invalid") alerts.push(panel("确认范围需要处理", el("details","",el("summary","","查看当前范围与独立审查问题"),...array(data.scope_status.issues).map(v=>el("p","alert",v)))));
  if (data.scope_status?.status === "legacy") alerts.push(el("p","muted","历史台账未采用新的验收组织范围契约；不自动重新认证。"));
  if (data.review_freshness?.status === "stale") alerts.push(el("div", "alert error", "独立审查已过期：当前需求或完整场景与审查时的版本不同。已保存的门禁报告不能证明当前台账有效。"));
  if (data.review_freshness?.status === "unreviewed") alerts.push(el("div", "alert", "当前台账尚未完成独立审查。"));
  if (array(data.errors).length) alerts.push(panel("读取问题", ...data.errors.map(error => el("p", "muted", `${error.file} · ${error.code}: ${error.message}`))));
  if (!array(data.runs).length) alerts.push(el("div", "alert", "尚无应用执行记录。场景设计就绪仅表示设计门禁通过，不能作为应用验收通过的结论。"));
  $("alerts").replaceChildren(...alerts);
  if ($('unit')) {
    const plan = scopePlan();
    $('unit-label').hidden = !plan;
    $('unit').replaceChildren(new Option('全部验收组织', ''), ...array(plan?.units).map(u => new Option(u.title, u.id)));
    $('unit').value = state.unit;
  }
  const previous = state.package;
  $("package").replaceChildren(new Option("全部业务包", ""), ...[...new Set(requirementRows().map(r => packageOf(r.id)))].sort().map(value => new Option(packageLabel(value), value)));
  $("package").value = previous;
}

function render() {
  if (!state.data) return;
  hidePriorityTooltip();
  document.querySelectorAll("nav button").forEach(node => { if (node.dataset.view === state.view) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current"); });
  const extra = ["overview", "trace"].includes(state.view);
  $("filters").hidden = $("workspace").hidden = extra;
  if (state.view === "trace") $("filters").hidden = false;
  $("extra").hidden = !extra;
  $("kind-label").hidden = $("priority-label").hidden = state.view !== "scenarios";
  if (extra && state.view !== "trace") {
    const views = { overview: dashboardView };
    $("extra").replaceChildren(...views[state.view]()); return;
  }
  if ($("coverage")) $("coverage").disabled=state.view==="trace" && !!state.trace?.record && state.trace.record.ledger_match!=="current";
  if (state.view === "trace") { $("extra").replaceChildren(...traceView()); if(typeof requestAnimationFrame==="function") requestAnimationFrame(syncTracePreviews); return; }
  const filtered = records().filter(record =>
    (!state.unit || AcceptanceScope.matches(scopePlan(), record, state.unit, state.view === "scenarios")) &&
    (!state.package || packagesFor(record).includes(state.package)) &&
    (!state.coverage || statusOf(record) === state.coverage) &&
    (!state.kind || state.view !== "scenarios" || record.kind === state.kind) &&
    (!state.priority || state.view !== "scenarios" || AcceptanceTrace.priorityOf(record) === state.priority) &&
    (!state.search || searchText(record).includes(state.search.toLocaleLowerCase())));
  $("count").textContent = `${filtered.length} / ${records().length} 个条目`;
  if (!filtered.some(r => r.id === state.selected)) state.selected = text(filtered[0]?.id);
  $("list").replaceChildren(...filtered.map(record => {
    const node = button("", () => { state.selected = record.id; history.replaceState(null, "", `#${state.view}/${encodeURIComponent(record.id)}`); render(); });
    node.className = "list-item"; node.setAttribute("aria-pressed", String(record.id === state.selected));
    node.append(el("span", "id", record.id || "缺少 ID"), el("span", "title", titleOf(record)));
    if (state.view === "scenarios") node.append(priorityBadge(record));
    node.append(badge(statusOf(record)));
    return node;
  }));
  if (!filtered.length) { $("detail").replaceChildren(el("p", "empty", "没有匹配的条目。可以清除筛选或重新加载台账。")); return; }
  const selected = filtered.find(r => r.id === state.selected) || filtered[0];
  $("detail").replaceChildren(...(state.view === "scenarios" ? scenarioView(selected) : reviewView(selected)));
}

function filterView(view, filters) {
  navigate(view);
  Object.entries(filters).forEach(([key, value]) => { state[key] = value; $(key).value = value; });
  render();
}
function table(headers, values) {
  return el("div", "table-wrap", el("table", "", el("thead", "", el("tr", "", ...headers.map(h => el("th", "", h)))),
    el("tbody", "", ...values.map(row => el("tr", "", ...row.map(value => el("td", "", value)))))));
}
function stage(label, count, detail, callback) {
  const node = button("", callback); node.className = "stage";
  node.append(el("span", "muted", label), el("strong", "", count), el("span", "", detail)); return node;
}
function dashboardView() {
  const t = state.trace, r = t.requirementStats;
  const result = [el("div", "detail-heading", el("h2", "", "覆盖与验收总览"), el("p", "muted", "覆盖关系展示当前设计，每个场景显示最近一次实际执行及其证据审查。历史结果的版本提示保留；此汇总不代替完整验收。")),
    pipelinePanel(),
    priorityOverview(),
    el("div", "grid", panel("需求设计统计", table(["状态", "需求数"], [
      [button("已关联场景", () => navigate("trace")), r.linked],
      [button("未关联场景", () => filterView("trace", { coverage: "uncovered" })), r.unlinked],
      ...["sufficient", "gap", "unreviewed", "stale", "unavailable"].map(s => [button(labels[s], () => filterView("trace", { coverage: s })), r[s]])]),
      el("p", "muted", "已关联与审查充分分别计算。本轮范围外的原始需求保留可见，不计为遗漏场景。")),
    panel("场景最近执行结果", table(["执行状态", "场景数", "证据审查状态", "场景数"], [
      ...["passed", "failed", "blocked", "unproven", "not_executed", "invalid", "execution_error"].map((s, i) => {
        const v = ["reviewed", "failed", "blocked", "unproven", "unreviewed", "invalid", "execution_error"][i];
        return [labels[s], t.executionStats[s], v ? labels[v] : "—", v ? t.evidenceStats[v] : "—"];
      })]), el("p", "muted", "证据审查通过需要唯一结果、实际观察、冻结场景、证据引用、独立审查与修订一致；此计数不代替完整验收门禁，也不检查证据文件内容。"))),
    panel("业务包统计", table(["业务包", "需求", "已关联", "审查充分", "需关注", "场景", "已执行", "证据审查通过"],
      t.packages.map(p => [button(packageLabel(p.name), () => filterView("trace", { package: p.name })), p.requirements, p.linked, p.sufficient, p.attention, p.scenarios, p.executed, p.reviewed])),
      el("p", "muted", "跨业务包场景会在相关包内各计一次；总场景数已去重。需关注包含未关联、缺口、未审查或过期等需求。")),
    panel("关联完整性", el("p", "", `${t.edges} 条需求 → 场景关系 · ${t.faults.length} 个结构问题`),
      t.faults.length ? prose(t.faults) : el("p", "muted", "未发现指向不存在需求的引用或缺失的场景验收说明。语义充分性仍依赖独立审查。")),
    panel("最终验收规则", acceptanceRules())];
  return result;
}
let priorityTip = null;
const priorityShows = new WeakMap();
function capturePriorityTooltip() {
  if (!priorityTip) return null;
  const node = priorityTip.node, key = node.dataset.priorityKey;
  const matching = [...document.querySelectorAll("[data-priority-key]")].filter(n => n.dataset.priorityKey === key);
  return {key, index: matching.indexOf(node), focused: document.activeElement === node};
}
function restorePriorityTooltip(saved) {
  if (!saved) return;
  const node = [...document.querySelectorAll("[data-priority-key]")].filter(n => n.dataset.priorityKey === saved.key)[saved.index];
  if (!node) return;
  if (saved.focused) node.focus({preventScroll: true});
  priorityShows.get(node)?.();
}
function hidePriorityTooltip() {
  if (!priorityTip) return;
  priorityTip.node.removeAttribute("aria-describedby"); priorityTip.tip.remove(); priorityTip = null;
  window.removeEventListener("scroll", hidePriorityTooltip, true); window.removeEventListener("resize", hidePriorityTooltip);
}
function priorityInfo(scenario, record) {
  const documents = record ? record.ledger_match === "current" ? state.data?.documents || {} : {} : state.data?.documents || {};
  const info = AcceptanceTrace.priorityBasis(scenario, documents);
  if (record && record.ledger_match !== "current") info.notes.push("依据来自本轮冻结场景；未使用当前版本的审查理由。");
  else if (scenario.kind !== "white_box" && info.source === "独立分级审查原因" && state.data?.review_freshness?.status === "stale") info.notes.push("该审查记录已过期，仅展示其原始判断原因。");
  return info;
}
function wirePriorityTooltip(node, info) {
  const label = info.priority === "unclassified" ? "未分级" : info.priority;
  node.dataset.priorityReason = info.reason; node.dataset.prioritySource = info.source;
  node.dataset.priorityKey = info.key || "grade/" + info.priority;
  node.setAttribute("aria-label", `${label}：${info.reason}${info.notes.length ? " " + info.notes.join(" ") : ""}`);
  const show = () => {
    hidePriorityTooltip();
    const tip = el("div", "priority-tooltip", el("strong", "", label + " · " + info.source), el("p", "", info.reason), ...info.notes.map(note => el("p", "muted", note)));
    tip.id = "priority-tooltip"; tip.setAttribute("role", "tooltip"); (node.closest("dialog") || document.body).append(tip);
    priorityTip = {node, tip}; node.setAttribute("aria-describedby", tip.id);
    const rect = node.getBoundingClientRect(), width = tip.getBoundingClientRect().width;
    tip.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + "px";
    const height = tip.getBoundingClientRect().height;
    tip.style.top = Math.max(12, rect.bottom + height + 10 <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8) + "px";
    window.addEventListener("scroll", hidePriorityTooltip, true); window.addEventListener("resize", hidePriorityTooltip);
  };
  priorityShows.set(node, show);
  node.addEventListener("mouseenter", show); node.addEventListener("focus", show);
  const hide = () => { if (priorityTip?.node === node) hidePriorityTooltip(); };
  node.addEventListener("mouseleave", hide); node.addEventListener("blur", hide);
  node.addEventListener("keydown", event => { if (event.key === "Escape") { hide(); event.stopPropagation(); } });
  return node;
}
function priorityBadge(scenario, record) {
  const info = priorityInfo(scenario, record), priority = info.priority;
  const node = el("span", "badge priority " + priority.toLowerCase(), priority === "unclassified" ? "未分级" : priority);
  node.tabIndex = 0; node.addEventListener("click", event => event.stopPropagation());
  info.key = JSON.stringify([scenario.id, record?.id || "design"]);
  return wirePriorityTooltip(node, info);
}
function priorityOverview() {
  const record = state.trace.record, summary = AcceptanceTrace.prioritySummary(state.data, record, state.trace.latest);
  const policy = obj(record?.documents?.["execution-plan.json"]?.policy);
  const selection = record?.documents?.["execution-plan.json"]?.selected_scenario_ids;
  const scopeLabel = Array.isArray(selection) ? `指定 ${selection.length} 个场景，按重要度顺序执行` : `测试 P0 至 ${policy.max_priority || "P3（历史默认）"}`;
  return panel("按重要度统计 · 黑盒与白盒",
    el("p", "muted", state.trace.latest ? "按当前场景的重要度汇总各场景最近执行结果。" : record ? `${scopeLabel} · 执行时间上限 ${policy.time_limit_minutes == null ? "未设置" : policy.time_limit_minutes + " 分钟"}` : "当前完整场景计划；尚无执行结果。"),
    table(["等级", "总数", "执行通过", "证据审查通过", "失败", "阻塞", "未证明", "未测", "记录无效", "AI 执行异常"],
      Object.entries(summary.byPriority).map(([p, c]) => [wirePriorityTooltip(button(p === "unclassified" ? "未分级" : p, () => filterView("scenarios", { priority: p })), AcceptanceTrace.priorityBasis({priority:p})), ...["total", "passed", "reviewed", "failed", "blocked", "unproven", "not_executed", "invalid", "execution_error"].map(k => c[k])])),
    el("p", "muted", "零场景等级不表示已验证。最近结果统计不能替代证据内容检查和全部验收门禁。"),
    (record || state.trace.latest) && summary.p0RiskUnresolved ? el("div", "alert error", "P0 关键风险尚未排除，阻断完整交付验收。") : null,
    (record || state.trace.latest) ? table(["剩余风险场景", "等级", "执行 / 审查", "失败后果", "未测原因 / 实际结果"], summary.remainingRisks.map(v => [button(v.scenario.id, () => navigate("scenarios", v.scenario.id)), priorityBadge(v.scenario), `${labels[v.status]} / ${labels[v.reviewStatus]}`, text(v.scenario.priority_reason) || "未分级，需补充理由", text(v.result?.reason || v.result?.actual) || "未执行"])) : null);
}

function acceptanceRules() {
  return prose([
    "按 P0 → P1 → P2 → P3 执行，完整保留场景；用户选择有限测试时，明确记录未测原因和剩余风险。",
    "按场景内的验收说明执行：建立可复现的前置状态，操作真实应用，将实际结果逐项对照预期，并保留要求的证据。",
    "在同一次运行中记录执行修订、环境、场景 ID、用例或操作关联、实际观察和证据路径。未执行、失败、受阻或未证明的场景不能按通过计。",
    "独立审查执行证据，说明为什么证据足以证明预期，引用此场景的证据，并与执行修订一致。设计阶段的充分性审查不替代执行后的证据审查。",
    "全部场景及需求、资源、黑盒、白盒、执行和证据门禁满足后，才支持完整交付验收。设计就绪或部分场景通过不足以得出应用验收通过。"
  ]);
}
let designModal = null, pendingDesignReview = "";
function designReviewButton(id, status) {
  const isRule = requirement(id)?.source_type === "white_box_reverse";
  const caption = isRule && status === "sufficient" ? "规则覆盖充分" : labels[status] || status;
  const node = button(caption, () => openDesignReview(id, node));
  node.className = badge(status).className + " result-label";
  node.dataset.designReview = id; node.setAttribute("aria-haspopup", "dialog"); node.title = "查看需求检查项与场景设计审查";
  return node;
}
function ruleConfirmationBadge(rule) {
  const status = AcceptanceTrace.ruleConfirmation(rule);
  const caption = {needs_confirmation: "规则待确认", confirmed: "规则已确认", supported: "有独立依据", unavailable: "规则状态未核实"}[status];
  const node = button(caption, () => openDesignReview(rule.id, node));
  node.className = badge(status === "confirmed" ? "current" : status).className + " result-label";
  node.dataset.designReview = rule.id; node.setAttribute("aria-haspopup", "dialog"); node.title = "查看规则依据与确认事项";
  return node;
}
function syncDesignReview() {
  if (!designModal) return;
  const m = designModal;
  if (!state.data) { m.body.replaceChildren(el("p", "alert error", "当前台账无法读取，审查不可核验。")); m.signature = ""; return; }
  const rule = requirement(m.id)?.source_type === "white_box_reverse" ? requirement(m.id) : null;
  const record = review(m.id) || {requirement_id: m.id}, signature = JSON.stringify([record, rule, AcceptanceTrace.ruleReview(state.data,m.id), state.data.white_box_rule_freshness, doc("white_box_rules.json"), doc("coverage_review.json").white_box_priority_review, designBasis(m.id), doc("scenarios.json"), state.data.review_freshness, state.data.current_check]);
  if (m.signature === signature) return;
  const scroll = m.body.scrollTop, expanded = [...m.body.querySelectorAll("details")].map(n => n.open);
  m.signature = signature; m.body.replaceChildren(...(rule ? reverseRuleView(rule) : reviewView(record).slice(1)));
  [...m.body.querySelectorAll("details")].forEach((n, i) => { n.open = expanded[i] || false; }); m.body.scrollTop = scroll;
}
function openDesignReview(id, trigger) {
  if (designModal) designModal.dialog.close();
  const dialog = el("dialog", "execution-modal design-review-modal"), heading = el("h2", "", "场景设计审查 · " + id), body = el("div", "execution-modal-body");
  heading.id = "design-review-title"; dialog.setAttribute("aria-labelledby", heading.id);
  const full = button("全屏", () => { const active = dialog.classList.toggle("is-fullscreen"); full.textContent = active ? "退出全屏" : "全屏"; full.setAttribute("aria-pressed", String(active)); }); full.setAttribute("aria-pressed", "false");
  const close = button("关闭", () => dialog.close()), previousOverflow = document.body.style.overflow, previousScroll = window.scrollY;
  dialog.append(el("div", "execution-modal-header", heading, el("div", "execution-modal-actions", full, close)), body);
  designModal = {dialog, body, id, signature: ""}; syncDesignReview();
  dialog.addEventListener("close", () => { if (designModal?.dialog === dialog) designModal = null; dialog.remove(); document.body.style.overflow = previousOverflow;
    const replacement = [...document.querySelectorAll("[data-design-review]")].find(n => n.dataset.designReview === id);
    (trigger?.isConnected ? trigger : replacement)?.focus({preventScroll: true}); window.scrollTo({top: previousScroll}); });
  dialog.addEventListener("click", event => { if (event.target !== dialog) return; const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); });
  document.body.append(dialog); document.body.style.overflow = "hidden"; dialog.showModal(); close.focus();
}
function traceScenarioCells(scene, record) {
  if (state.trace?.latest) record = state.trace.byScenario.get(scene.id)?.record || state.trace.latest.get(scene.id)?.record || null;
  const title = !state.trace?.latest && record && record.ledger_match!=="current" ? frozenSceneLink(record,scene) : button(scene.title || "场景标题未记录", () => navigate("scenarios", scene.id)); title.className = "trace-scene-title";
  const heading = el("div", "trace-scene", el("div", "trace-scene-heading", priorityBadge(scene,state.trace?.latest ? null : record), tracePreview("scene-title/"+scene.id,title)), scene.kind === "white_box" ? el("span", "muted", "白盒场景") : null);
  const pendingRules = strings(scene.reverse_rule_ids).map(id=>!state.trace?.latest && record && record.ledger_match!=="current" ? array(AcceptanceScope.snapshot(record,"white_box_rules.json")?.items).find(r=>r.id===id) : requirement(id)).filter(r => r?.status === "needs_confirmation");
  if (pendingRules.length) return [el("div","",heading,el("p","muted","规则待确认；用例尚未设计")),el("p","muted","确认后再准备用例"),el("p","muted","尚无产品判定")];
  if (!record) {
    const preparation = state.trace?.latest && AcceptanceTrace.selectedRun(state.data);
    const pending = preparation && rows(preparation.documents?.["run.json"], "progress").find(p=>p.scenario_id===scene.id && ["pending","preparing"].includes(p.phase));
    return pending ? [heading, ExecutionView.renderAssociation(preparation, scene, pending, pending.binding || {}), el("p","muted",pending.phase==="preparing" ? "准备测试" : "待执行")]
      : [el("div","",heading,el("p","muted","用例尚未设计")),el("p","muted","尚未确定测试方式"),el("p","muted","尚未评估")];
  }
  const frozen=ExecutionView.sceneOf(record,scene.id), hasSnapshot=array(record.documents?.["scenarios.snapshot.json"]?.items).some(s=>s.id===scene.id);
  const run=obj(record.documents?.["run.json"]), value=AcceptanceTrace.execution(state.data,record,scene);
  const included=hasSnapshot || rows(run,"progress").some(p=>p.scenario_id===scene.id) || rows(run,"results").some(p=>p.scenario_id===scene.id);
  if (!included) return [heading,el("p","muted","该轮未包含此场景"),el("p","muted","尚未评估")];
  const context=hasSnapshot ? frozen : scene, progress=ExecutionView.progressOf(record,scene.id,value)||{scenario_id:scene.id}, binding=progress.binding||value.result?.binding||{};
  let final=ExecutionView.renderReview(record,context,progress,binding);
  if (!ExecutionView.reviewData(record,context).verdict) final=el("p","muted",progress.phase==="not_run" ? "本轮未执行" : progress.phase==="pending" && Array.isArray(run.selected_scenario_ids) && !run.selected_scenario_ids.includes(scene.id) ? "本轮未选中" : {pending:"待执行",preparing:"准备测试",executing:"执行取证",evaluating:"独立评估中"}[progress.phase]||"尚未评估");
  if (run.lifecycle === 'aborted' && !ExecutionView.reviewData(record,context).verdict) final=el('p','muted',progress.phase==='pending' ? '本轮已中止，未执行' : '本轮已中止，未完成评估');
  return [el("div","",heading,el("p","",ExecutionView.caseCoverageBadge(record,context,progress,binding))),ExecutionView.renderAssociation(record,context,progress,binding),
    el("div",record.ledger_match!=="current"?"trace-old-result":"",record.ledger_match!=="current"?el("p","trace-version-note","旧版本 / 版本未确认"):null,final)];
}
function executionCoveragePanel(record) {
  if (!record) return null;
  const value = CoverageView.executionProgress(record);
  const panelNode = panel(value.policy === 'required' || value.projects.length ? "最近采集的代码覆盖与进度" : "最近执行进度", el("p", "muted", `已完成评估 ${value.selectedCompleted} / ${value.selected} 个选定场景 · 冻结设计已评估 ${value.completed} / ${value.total} 个场景 · 发现 BUG ${value.bugs} 个`),
    el("p", "", `全部设计中尚未完成：P0 ${value.remaining.P0} 个 · P1 ${value.remaining.P1} 个 · P2 ${value.remaining.P2} 个 · P3 ${value.remaining.P3} 个`));
  panelNode.dataset.executionCoverage = record.id;
  panelNode.append(el('p', 'muted', value.policy === 'required' ? '此处为最近一次执行采集的独立统计，只累计其中完成独立评估的场景；不合并下方各场景的历史覆盖率。' : '最近一次执行未启用代码覆盖率采集。'));
  if (value.policy === 'required') {
    panelNode.append(el('h3','','被测范围累计覆盖率'));
    if (value.verificationReason) panelNode.append(el('p',value.verificationState==='invalid'?'alert':'muted',value.verificationReason));
    if (!value.subjects.length && !value.verificationReason) panelNode.append(el('p','alert','尚未根据测试意图确定并冻结覆盖率分母范围，无法计算被测对象整体覆盖率。下方已采集的文件范围不能代替整体指标。'));
    for (const subject of value.subjects) {
      const kindLabel={project:'整个项目',directories:'指定目录',files:'指定文件',commit_changes:'提交修改',pr_changes:'PR修改'}[subject.kind]||'范围未确认';
      const changed=['pr_changes','commit_changes'].includes(subject.kind);
      const details=el('details','',el('summary','','查看统计范围与依据'),field('测试意图',subject.intent),field('范围依据',subject.basis),field('被测版本',subject.revision),field('项目',subject.project_root),
        array(subject.directories).length ? field('指定目录',subject.directories.join('、')):null,
        array(subject.selected_paths).length ? field('指定文件',subject.selected_paths.join('、')):null,
        field('被测源码清单',array(subject.source_paths).join('、')),
        ...array(subject.changes).map(c=>field(c.pr_url||'提交基线',`${c.base_revision} → ${c.head_revision}`)),
        ...Object.entries(obj(subject.changed_lines)).map(([name,lines])=>field(name,`修改行：${array(lines).join('、')||'无新增/修改行'}`)),
        ...array(subject.excluded_paths).map(e=>field('非执行内容',`${e.path}：${e.reason}`)));
      const section=el('section','execution-coverage-project',el('h4','',`${subject.project_label} · ${kindLabel}`));
      if (subject.intent) section.append(el('p','',subject.intent));
      if (subject.status==='measured' && subject.metrics) section.append(el('div','execution-coverage-metrics',...['lines','branches'].map(kind=>{
        const count=CoverageView.counter(subject.metrics[kind]);
        return el('div','metric',el('strong','',count?.total ? count.percent.toFixed(1)+'%' : '不适用'),el('span','',kind==='lines' ? (changed?'修改行覆盖率':'行覆盖率') : (changed?'修改分支覆盖率':'分支覆盖率')),el('span','',count ? `${count.covered} / ${count.total}` : '计数无效'));
      })),el('p','muted',`累计 ${array(subject.scenario_ids).length} 个已完成独立评估的场景；0个可计数单元显示不适用。`));
      section.append(el('p',subject.status==='measured' ? 'muted':'alert',subject.reason));
      if (array(subject.missing_paths).length) section.append(field('尚未采集的被测文件',subject.missing_paths.join('、')));
      section.append(details);
      panelNode.append(section);
    }
    panelNode.append(el('p','muted','覆盖率分母按已审查的测试意图固定，不随已执行场景或页面筛选变化。提交/PR修改范围只计修改行及修改判定位置的分支出口；其他范围计全部可执行单元。覆盖率不代表验收通过。'));
  }
  // Collection receipts remain evidence; the report presents only limitations
  // affecting the user's interpretation of cumulative coverage.
  const limitations = new Map();
  for (const item of value.collection) {
    if (!['unavailable', 'unavailable_pending', 'missing', 'invalid', 'collection_error'].includes(item.status)) continue;
    const label = item.project_label || '被测对象';
    const reasons = limitations.get(label) || new Set();
    reasons.add(item.reason || '缺少有效覆盖数据，原因尚未记录。');
    limitations.set(label, reasons);
  }
  if (limitations.size) panelNode.append(el('div', 'coverage-limitations', el('h3', '', '覆盖率限制'),
    ...[...limitations].map(([label, reasons]) => el('p', 'alert', `${label}：${[...reasons].join('；')} 当前累计指标只包含已核验的有效数据。`))));
  if (!value.current) panelNode.append(el("p", "alert", "运行版本未确认一致，代码覆盖率不作为当前测试指标展示。"));
  if (value.projects.length) panelNode.append(el('h3','','文件范围覆盖率（辅助信息）'));
  for (const project of value.projects) {
    const scopeDetails = el("details", "", el("summary", "", "查看统计范围与来源"), field("项目", project.root), field("产品版本", project.revision), field("范围说明", project.scope?.basis),
      ...array(project.scope?.exclusions).map(e => field("未计入范围", `${e.path}：${e.reason}`)), scenarioTitleLinks(project.scenario_ids));
    scopeDetails.dataset.executionCoverageScope = JSON.stringify([record.id, project.id, project.root, project.revision, project.scope]);
    panelNode.append(el("section", "execution-coverage-project", el("h4", "", project.label),
      el("div", "execution-coverage-metrics", ...["lines","branches"].map(kind => {
        const count = CoverageView.counter(project.metrics[kind]);
        return el("div", "metric", el("strong", "", count.total ? count.percent.toFixed(1) + "%" : "无可计数单元"),
          el("span", "", kind === "lines" ? "代码行覆盖率" : "代码分支覆盖率"), el("span", "", `${count.covered} / ${count.total}`));
      })), el("p", "muted", `范围：${strings(project.scope?.targets).join("、")} · 累计 ${project.scenario_ids.length} 个已评估场景（通过或 BUG）`),
      scopeDetails));
  }
  if (value.projects.length) panelNode.append(el("p", "muted", `已完成场景中 ${value.measuredScenes} / ${value.completed} 个提供可核验覆盖数据 · 最近采集：${value.updatedAt ? new Date(value.updatedAt).toLocaleString("zh-CN") : "未记录"}`),
    el("p", "muted", "相同代码行与分支只累计一次。覆盖率表示代码被执行到，不代表验收通过；是否继续测试还需结合未测重要场景与已发现 BUG。"));
  // Superseded receipts are expected exclusions, not current coverage limitations.
  for (const issue of new Set(value.issues)) {
    if (typeof issue === 'string' && issue.endsWith('：旧尝试或观察绑定已变化，未计入')) continue;
    panelNode.append(el("p", "alert", issue));
  }
  return panelNode;
}
function frozenSceneLink(record,scene) {
  const progress=ExecutionView.progressOf(record,scene.id)||{scenario_id:scene.id};
  return ExecutionView.entry(record,scene,progress,progress.binding||{},'observation',scene.title||scene.id);
}
function traceSceneLink(context,scene) {
  return context.historical ? frozenSceneLink(context.record,scene) : button(scene.title||scene.id,()=>navigate('scenarios',scene.id));
}
function traceContext() {
  const record=state.trace?.record, historical=!!record && record.ledger_match !== 'current';
  const sources=historical ? [
    ...array(AcceptanceScope.snapshot(record,'requirements.json')?.items),
    ...array(AcceptanceScope.snapshot(record,'white_box_rules.json')?.items).map(r=>({...r,source_type:'white_box_reverse'}))
  ] : requirementRows();
  return {record,historical,plan:scopePlan(),sources,
    scenes:historical ? AcceptanceTrace.ordered(array(AcceptanceScope.snapshot(record,'scenarios.json')?.items)) : scenarioRows(),
    progress:historical ? AcceptanceScope.snapshot(record,'design-progress.json') : doc('design-progress.json')};
}
function selectOrganization(id) {
  navigate('trace'); state.unit=id; if ($('unit')) $('unit').value=id; render();
}
function traceGeneration(context, unit) {
  const progress=(!context.historical ? array(state.data?.pipeline_status?.units).find(p=>p.unit_id===unit.id) : null) || array(context.progress?.units).find(p=>p.unit_id===unit.id);
  return {pending:'待生成场景',in_progress:'场景生成中',generated:'场景已生成 · 仍需核验独立审查',stale:'组织已变更 · 需重新生成'}[progress?.status] || '生成进度不可核验';
}
function traceSourceLink(id, context) {
  const source=context.sources.find(r=>r.id===id);
  return el('div','trace-source-heading',button(id,()=>navigate('requirements',id)),
    source?.source_type==='white_box_reverse' ? badge('white_box','白盒逆向规则') : null);
}
function traceDetails(key,...children) {
  const node=el('details',key.startsWith('inventory/')?'trace-source-inventory':'',...children);node.dataset.traceKey=state.run+'/'+key;return node;
}
// Expansion is view state only, keyed by run and stable object IDs.
const traceExpansions = new Set();
function tracePreview(key,...children) {
  const identity=state.run+'/'+key, expanded=traceExpansions.has(identity);
  const content=el('div','trace-preview-content',...children);content.id='trace-preview-'+encodeURIComponent(identity);
  const node=el('div','trace-preview'+(expanded?' is-expanded':''),content);
  node.dataset.tracePreview=identity;
  const toggle=button(expanded?'收起':'展开全部',()=>{
    const next=!traceExpansions.has(identity);
    if(next) traceExpansions.add(identity); else traceExpansions.delete(identity);
    node.className='trace-preview'+(next?' is-expanded':'');
    toggle.textContent=next?'收起':'展开全部';toggle.setAttribute('aria-expanded',String(next));
  });
  toggle.className='trace-preview-toggle';toggle.hidden=true;
  toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-controls',content.id);
  node.append(toggle);return node;
}
function syncTracePreviews() {
  // Wrap case names only; origin and current execution status stay outside.
  document.querySelectorAll('.trace-table .association-title').forEach(title=>{
    if(title.parentElement?.className==='trace-preview-content') return;
    const parent=title.parentNode, next=title.nextSibling;
    const preview=tracePreview('case-title/'+title.dataset.executionKey+'/'+title.dataset.executionEntry,title);
    parent.insertBefore(preview,next);
  });
  document.querySelectorAll('.trace-table [data-trace-preview]').forEach(node=>{
    const content=node.querySelector('.trace-preview-content'),toggle=node.querySelector('.trace-preview-toggle');
    if(!content?.clientWidth) return;
    const lineHeight=parseFloat(getComputedStyle(content).lineHeight);
    toggle.hidden=!(content.scrollHeight>lineHeight*3+1);
  });
}
function traceSources(group, context) {
  const ids=[...new Set([...array(group.unit.requirement_ids),...group.checks.map(c=>c.requirement_id),...array(group.unit.rule_ids)])];
  const requirements=ids.filter(id=>!array(group.unit.rule_ids).includes(id));
  const rules=ids.filter(id=>array(group.unit.rule_ids).includes(id));
  const content=ids.flatMap(id=>{
    const source=context.sources.find(r=>r.id===id),checks=group.checks.filter(c=>c.requirement_id===id);
    return checks.length ? checks.map(c=>el('p','trace-owned-check',(ids.length>1?id+' · ':'')+c.behavior)) : [el('p','trace-owned-check',(ids.length>1?id+' · ':'')+(source?.title||source?.text||'补充规则；来源正文不可核验'))];
  });
  return el('div','trace-sources',el('div','trace-source-ids',...ids.map(id=>traceSourceLink(id,context))),
    el('p','trace-source-count',`${requirements.length} 条需求${rules.length?'、'+rules.length+' 条规则':''} · ${group.checks.length} 个检查项`),
    tracePreview('source-checks/'+group.unit.id,...content),
    traceDetails('source/'+group.unit.id,el('summary','','查看原文与承担内容'),...ids.map(id=>{
      const source=context.sources.find(r=>r.id===id),checks=group.checks.filter(c=>c.requirement_id===id);
      return el('section','trace-source',traceSourceLink(id,context),
        source ? prose(source.text) : el('p','muted','来源正文快照不可核验；以下仅展示组织保存的原始引句。'),
        ...checks.map(c=>el('section','',el('strong','',c.id+' · '+c.behavior),field('原始引句',c.source_quote),field('纳入依据',c.reason))));
    })));
}
function traceMappedChecks(context, unit, scene) {
  const mappings=AcceptanceScope.mapping(context.plan,unit,scene);
  const node=traceDetails('mapping/'+unit.id+'/'+scene.id,el('summary','',mappings.length ? '查看本组织的判据映射（待审查核验）' : '未提供本组织的具体检查项映射'),
    ...mappings.map(m=>el('section','',el('p','',m.criterion),
      ...m.check_ids.map(id=>el('p','muted',array(context.plan.checks).find(c=>c.id===id)?.behavior||id)),
      ...m.rule_ids.map(id=>el('p','muted',id+' · '+(context.sources.find(r=>r.id===id)?.text||'补充规则'))))));
  node.className='trace-mapping';return node;
}
function requirementReversePanel(context) {
  if (!state.selected) return null;
  const source=context.sources.find(r=>r.id===state.selected), checks=AcceptanceScope.checks(context.plan,state.selected);
  const groups=AcceptanceScope.organizationTrace(context.plan,context.scenes);
  const statuses={included:'本轮纳入',excluded:'用户排除 · 未验证',context:'全局背景 · 未验证'};
  const node=panel('按来源反查 · '+state.selected,source ? prose(source.text) : el('p','muted','来源正文不可核验。'));
  checks.forEach(check=>{
    const owners=groups.filter(g=>array(g.unit.check_ids).includes(check.id));
    const mappings=context.scenes.filter(scene=>owners.some(g=>AcceptanceScope.mapping(context.plan,g.unit,scene).some(m=>m.check_ids.includes(check.id))));
    node.append(el('section','reverse-check',el('strong','',check.behavior),el('p','muted',statuses[check.disposition]||check.disposition),
      el('div','links',...owners.map(g=>button(g.unit.title,()=>selectOrganization(g.unit.id)))),
      mappings.length ? el('div','links',...mappings.map(scene=>traceSceneLink(context,scene)),el('p','muted','已记录判据映射；覆盖充分性以独立审查为准。')) :
        el('p','muted',check.disposition!=='included' ? '此项不进入本轮测试。' : !owners.length ? '尚未分配验收组织；需完成组织分析与审查。' : owners.some(g=>array(context.progress?.units).find(p=>p.unit_id===g.unit.id)?.status!=='generated') ? '组织场景尚未生成完成。' : '已完成生成，但此检查项尚无有效判据映射。')));
  });
  if (!checks.length) {
    const owners=groups.filter(g=>array(g.unit.rule_ids).includes(state.selected));
    node.append(el('div','links',...owners.map(g=>button(g.unit.title,()=>selectOrganization(g.unit.id)))));
    const linked=context.scenes.filter(scene=>owners.some(g=>AcceptanceScope.mapping(context.plan,g.unit,scene).some(m=>m.rule_ids.includes(state.selected))));
    if (linked.length) node.append(...linked.map(scene=>el('section','reverse-check',traceSceneLink(context,scene),
      ...array(scene.scope?.criteria).filter(c=>array(c.rule_ids).includes(state.selected) && array(scene.acceptance?.criteria).includes(c.criterion)).map(c=>el('p','',c.criterion)))),el('p','muted','规则判据已映射；具体检查点覆盖充分性以独立审查为准。'));
    else node.append(el('p','muted',owners.length ? '补充规则已有责任组织；尚无可核验的场景判据映射。' : '尚无组织映射，或该来源不在本轮验收范围内。'));
  }
  if (!context.historical && source && context.plan && array(context.progress?.units).length && array(context.progress?.units).every(u=>u.status==='generated')) node.append(designReviewButton(source.id, state.trace.entries.find(e=>e.requirement.id===source.id)?.status||'unreviewed'));
  return node;
}
function traceView() {
  const context=traceContext(), headers=['验收组织','需求来源及承担内容','测试场景','关联用例／手动测试','最终结论'];
  const groups=AcceptanceScope.organizationTrace(context.plan,context.scenes).filter(g=>{
    const ids=[...array(g.unit.requirement_ids),...g.checks.map(c=>c.requirement_id),...array(g.unit.rule_ids)];
    return (!state.unit||g.unit.id===state.unit) && (!state.selected||ids.includes(state.selected)) &&
      (!state.package||ids.some(id=>(context.sources.find(r=>r.id===id)?.package||id.replace(/-\d+$/,''))===state.package)) &&
      (context.historical||!state.coverage||ids.some(id=>state.trace.entries.some(e=>e.requirement.id===id && e.status===state.coverage))) &&
      (!state.search||JSON.stringify([g,context.sources.filter(r=>ids.includes(r.id))]).toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  });
  const body=el('tbody','');
  groups.forEach(group=>{
    const owned=AcceptanceTrace.ordered(group.owned), count=Math.max(1,owned.length)+(group.references.length?1:0);
    const unit=el('td','trace-organization',el('p','id-line',group.unit.id),el('strong','',group.unit.title),
      el('p','muted',traceGeneration(context,group.unit)),
      el('p','trace-scene-count',context.historical && !AcceptanceScope.snapshot(context.record,'scenarios.json') ? '场景数量不可核验' : `本组织生成 ${owned.length} 个场景`),
      group.references.length ? el('p','muted',`另有 ${group.references.length} 个关联覆盖引用`) : null,traceDetails('boundary/'+group.unit.id,el('summary','','查看验收边界'),prose(group.unit.boundary),field('排除内容',group.unit.exclusions)));
    unit.dataset.unitId=group.unit.id;
    if(!context.historical && state.data?.pipeline_status?.active_unit===group.unit.id) unit.className+=' is-generating';
    const sources=el('td','trace-requirement',traceSources(group,context));
    for (const [node,label] of [[unit,headers[0]],[sources,headers[1]]]) {node.setAttribute('rowspan',String(count));node.setAttribute('data-label',label);}
    (owned.length ? owned : [null]).forEach((scene,i)=>{
      const row=el('tr',i===0?'trace-group-start':''); if (!i) row.append(unit,sources);
      const cells=scene ? traceScenarioCells(scene,context.record) : [el('p','muted',group.references.length ? '暂无本组织生成的场景；有其他组织的关联场景。' : traceGeneration(context,group.unit)),'—','—'];
      if (scene) cells[0]=el('div','',el('span','scene-ownership','本组织生成'),cells[0],traceMappedChecks(context,group.unit,scene));
      cells.forEach((value,index)=>{const cell=el('td','',value);cell.setAttribute('data-label',headers[index+2]);row.append(cell);});body.append(row);
    });
    if (group.references.length) {
      const cell=el('td','trace-references',el('strong','','其他组织场景的关联覆盖'),el('p','muted','这里只列引用；用例、执行结果和场景数量归生成责任组织，避免重复统计。'),
        ...group.references.map(ref=>{
          const owner=array(context.plan.units).find(u=>u.id===ref.scene.generation_unit_id);
          return el('section','trace-reference',traceSceneLink(context,ref.scene),
            el('p','muted','生成责任组织：',owner ? button(owner.title,()=>selectOrganization(owner.id)) : ref.scene.generation_unit_id||'未记录'),
            tracePreview('reference-checks/'+group.unit.id+'/'+ref.scene.id,...ref.mapping.flatMap(m=>m.check_ids.map(id=>el('p','trace-owned-check','映射检查：'+(array(context.plan.checks).find(c=>c.id===id)?.behavior||id))).concat(m.rule_ids.map(id=>el('p','trace-owned-check','映射规则：'+id))))),
            traceMappedChecks(context,group.unit,ref.scene));
        }));
      cell.setAttribute('colspan','3');cell.setAttribute('data-label','关联覆盖引用');body.append(el('tr','',cell));
    }
  });
  const table=el('div','table-wrap trace-table',el('table','',el('thead','',el('tr','',...headers.map(h=>el('th','',h)))),body)); table.dataset.historyTable='organization/'+state.run;
  const heading=el('div','detail-heading',el('h2','','验收组织与场景追踪'),state.selected ? button('查看全部验收组织',()=>navigate('trace')) : null,
    el('p','muted',`${groups.length} / ${array(context.plan?.units).length} 个验收组织。一个组织可承担多个需求；每个场景只有一个生成责任组织，也可关联检查其他组织的内容。点击需求 ID 反查；同组织自有场景按 P0 → P3 排列。`));
  const sourceInventory=el(context.plan?'details':'section',context.plan?'panel':'panel',el(context.plan?'summary':'h3','','原始需求与白盒规则 · '+context.sources.length+' 项'),...context.sources.filter(r=>!state.selected||r.id===state.selected).map(r=>traceDetails('inventory/'+r.id,el('summary','',r.id+' · '+(r.title||text(r.text).split('\n')[0])),traceSourceLink(r.id,context),prose(r.text),
    el('p','muted',context.plan ? ({excluded:'用户排除 · 未验证',context:'全局背景 · 未验证',mixed:'本轮仅纳入部分原始检查',included:'组织关联见追踪表',unmapped:'未纳入组织或仍待分析'}[AcceptanceScope.disposition(context.plan,r.id)]||'补充规则；组织关联见追踪表') : '需求与规则分析中；验收组织尚未生成。'))));
  const orphaned=context.scenes.filter(s=>!array(context.plan?.units).some(u=>u.id===s.generation_unit_id));
  const output = [heading,context.historical ? el('p','alert','当前展示旧版本或版本未确认的运行记录，不能据此认定最新测试设计已通过。仅展示可核验的冻结组织、来源与场景；不混入当前设计。') : pipelinePanel(),
    sourceInventory,requirementReversePanel(context),
    orphaned.length ? panel('场景责任组织需要处理',el('p','alert','以下场景未归属有效的验收组织，不能推断追踪完整。'),...orphaned.map(scene=>traceSceneLink(context,scene))) : null,
    context.historical && !AcceptanceScope.snapshot(context.record,'scenarios.json') ? el('p','alert','场景快照不可核验；不会使用当前场景补齐历史追踪。') : null,
    executionCoveragePanel(state.trace?.latest ? AcceptanceTrace.selectedRun(state.data) : context.record),
    panel('验收组织 → 测试场景 → 用例／手动测试 → 最终结论',groups.length ? table : el('p','empty',context.plan ? '没有匹配的验收组织。可以清除筛选或按需求反查范围处置。' : context.historical ? '组织快照不可核验，无法展示本轮追踪关系。' : '先完成需求与规则分析，再生成并审查全部验收组织；随后逐组织生成场景。当前尚无组织追踪数据。'))].filter(Boolean);
  const mark=(node,path)=>{if(node.tagName==='DETAILS' && !node.dataset.traceKey) node.dataset.traceKey=state.run+'/'+path; [...node.childNodes].forEach((child,i)=>mark(child,path+'/'+i));}; output.forEach((node,i)=>mark(node,String(i)));
  return output;
}
function executionPanel(scenario) {
  const record = state.trace?.latest ? state.trace.latest.get(scenario.id)?.record : state.trace?.record;
  if (!record) return panel("执行结果与证据审查", badge("not_executed"), el("p", "muted", "尚无此场景的实际执行记录；验收方法中的步骤是计划。"));
  const value = AcceptanceTrace.execution(state.data, record, scenario), run = obj(record.documents["run.json"]);
  let progress = ExecutionView.progressOf(record, scenario.id, value);
  if (!progress && !value.result) return panel("执行结果与证据审查", badge(record.ledger_match), el("p", "muted", "该轮未包含此场景，不能使用其他轮次的结果。"));
  progress ||= {scenario_id: scenario.id};
  const binding = value.result?.binding || progress.binding || {};
  const context = state.trace?.latest && array(record.documents?.["scenarios.snapshot.json"]?.items).some(s=>s.id===scenario.id) ? ExecutionView.sceneOf(record,scenario.id) : scenario;
  return panel("最近执行结果与证据审查", badge(record.ledger_match),
    el("div", "grid", el("div", "", el("h4", "", "关联用例／手动测试"), ExecutionView.caseCoverageBadge(record, context, progress, binding), ExecutionView.renderAssociation(record, context, progress, binding)),
      el("div", "", el("h4", "", "场景最终结论"), ExecutionView.renderReview(record, context, progress))),
    value.issues.length ? field("尚缺条件 / 版本问题", value.issues) : null);

}

function acceptancePanel(scenario) {
  const a = obj(scenario.acceptance);
  return el("section", "panel", field("场景说明", a.description), field("前置条件", a.preconditions), field("检查操作", a.actions), field("预期结果", a.criteria), field("证据要求", a.evidence_expected));
}

function scenarioView(scenario) {
  return [el("div", "detail-heading", el("p", "id-line", scenario.id), el("h2", "", scenario.title), badge(scenario.kind), priorityBadge(scenario)),
    acceptancePanel(scenario), scopePanel(scenario), executionPanel(scenario),
    el("details", "raw", el("summary", "", "如何完成最终验收"), acceptanceRules()), raw(scenario)].filter(Boolean);
}

function scenarioTitleLinks(ids) {
  const node = el("div", "check-scenarios");
  [...new Set(strings(ids))].forEach(id => {
    const scene = scenarioRows().find(s => s.id === id);
    if (scene) node.append(el("div", "check-scene", priorityBadge(scene), button(scene.title || "场景缺少标题", () => navigate("scenarios", id)), el("small", "id-line", id)));
    else node.append(el("p", "muted", `关联场景不存在：${id}`));
  });
  if (!node.childNodes.length) node.append(el("p", "muted", "缺少对应场景"));
  return node;
}

function designChecklist(record, white = false) {
  const basis = white ? AcceptanceTrace.whiteDesignBasis(state.data, record.requirement_id) : designBasis(record.requirement_id), covers = rows(basis, "coverage_items"), results = rows(record, "coverage_results");
  const values = covers.map(cover => {
    const matches = results.filter(c => c.coverage_id === cover.id), result = matches.length === 1 ? matches[0] : null;
    const coverage = AcceptanceTrace.checkCoverage(state.data, cover, result, record.requirement_id);
    const fresh = white ? state.data.white_box_rule_freshness?.status === "current" && ["design-quality-v3","design-quality-v4"].includes(doc("white_box_rules.json").design_standard) && doc("coverage_review.json").white_box_priority_review?.design_standard === doc("white_box_rules.json").design_standard : state.data.review_freshness?.status === "current" && ["design-quality-v3","design-quality-v4"].includes(doc("scenarios.json").design_standard) && doc("coverage_review.json").design_standard === doc("scenarios.json").design_standard;
    const status = fresh ? coverage.status : "unavailable";
    const caption = {covered: "完整覆盖", partial: "部分覆盖", gap: "未覆盖", unavailable: fresh ? "覆盖不可核验" : "审查已过期或未核验"}[status];
    const item = el("div", "check-item", el("p", "check-condition", el("strong", "", "检查操作："), text(cover.condition)), el("p", "check-expected", el("strong", "", "预期结果："), text(cover.expected)), badge(status === "covered" ? "sufficient" : status === "gap" ? "gap" : "unavailable", caption));
    if (status === "partial" || status === "gap") item.append(el("div", "check-missing", el("strong", "", "尚缺检查："), prose(coverage.missing.map(p => p.text))));
    if (status !== "unavailable" && coverage.overlap.length) item.append(el("div", "check-overlap", el("strong", "", "重复检查："), prose(coverage.overlap.map(p => p.text))));
    if (status === "unavailable") item.append(el("p", "muted", "当前记录不能证明该检查项的覆盖情况。"));
    if (result) item.append(el("details", "raw", el("summary", "", "查看核验记录"), prose(result.reason), ...rows(result, "scenario_coverage").map(c => el("section", "probe", field("场景", scenarioRows().find(s => s.id === c.scenario_id)?.title || c.scenario_id), c.reason !== result.reason ? prose(c.reason) : null, button("查看完整场景", () => navigate("scenarios", c.scenario_id))))));
    return [item, prose(cover.identification_basis), scenarioTitleLinks(coverage.scene_ids)];
  });
  // Omitted conditions found independently belong in the main list, not just a hidden findings log.
  rows(record, "findings").filter(f => f.kind === "coverage_gap" && !covers.some(c => c.id === f.coverage_id)).forEach(f => values.push([
    el("div", "check-item", el("p", "check-condition", el("strong", "", "检查操作："), text(f.condition)), el("p", "check-expected", el("strong", "", "预期结果："), text(f.expected_detection)), badge("gap", "未覆盖")),
    prose(f.requirement_basis), scenarioTitleLinks([])
  ]));
  const headers = ["需求检查项及覆盖情况", "为什么需要检查", "对应场景"];
  return panel("需求检查项与测试场景对应关系", el("p", "muted", "按各场景合计覆盖判断；重复检查不增加完整度。这里表示测试设计覆盖，产品尚未执行。"),
    values.length ? el("div", "table-wrap review-checklist", el("table", "", el("thead", "", el("tr", "", ...headers.map(h => el("th", "", h)))), el("tbody", "", ...values.map(row => el("tr", "", ...row.map((value, i) => { const cell = el("td", "", value); cell.setAttribute("data-label", headers[i]); return cell; })))))) : el("p", "muted", "尚无检查项记录，不能判断覆盖是否完整。"));
}

function reviewView(record, white = false) {
  return [el("div", "detail-heading", el("p", "id-line", record.requirement_id), el("h2", "", "场景设计独立审查"), badge(AcceptanceTrace.designStatus(state.data, record))),
    panel("需求", badge(white ? AcceptanceTrace.whiteDesignStatus(state.data,record.requirement_id) : AcceptanceTrace.designStatus(state.data, record)), prose(requirement(record.requirement_id)?.text), links([record.requirement_id], "requirements")),
    designChecklist(record, white),
    !white && AcceptanceTrace.whiteDesignBasis(state.data, record.requirement_id) ? el("section", "", el("h3", "", "同一需求的白盒补充检查"), ...reviewView(AcceptanceTrace.whiteDesignReview(state.data, record.requirement_id) || {requirement_id:record.requirement_id}, true).slice(2)) : null,
    ...rows(record, "findings").filter(f => f.kind === "requirement_clarification").map(f => panel("需求待澄清", field("具体情况", f.condition), field("需要确认", f.question))),
    el("details", "raw review-technical", el("summary", "", "查看完整审查过程与专业核验记录"),
      panel("按共同质量标准逐项核验", field("生成 / 审查标准版本", `${text(white ? doc("white_box_rules.json").design_standard : doc("scenarios.json").design_standard)} / ${text(white ? doc("coverage_review.json").white_box_priority_review?.design_standard : doc("coverage_review.json").design_standard)}`), field("审查判断理由", record.reason),
        ...rows(record, "criteria_checks").map(c => el("section", "probe", el("h4", "", designCriteria[c.criterion] || c.criterion), badge(c.status, c.status === "passed" ? "设计检查通过" : c.status === "needs_clarification" ? "需求待澄清" : "有缺口"), prose(c.reason)))),
      designBasisPanel(record.requirement_id, "", white),
      panel("缺口、需求澄清与建议", ...rows(record, "findings").map(f => el("section", "probe", el("h4", "", {coverage_gap:"覆盖缺口",requirement_clarification:"需求待澄清",suggestion:"非阻断建议"}[f.kind] || f.kind), field("需求依据", f.requirement_basis), field("具体情况", f.condition),
        ...[{key:"escaping_fault",label:"可能漏出的错误"},{key:"why_existing_misses",label:"现有设计为什么发现不了"},{key:"expected_detection",label:"补充后如何发现"},{key:"question",label:"需要澄清的问题"},{key:"recommendation",label:"建议"},{key:"reason_nonblocking",label:"为什么不影响审查通过"}].filter(v => f[v.key]).map(v => field(v.label, f[v.key])), f.scenario_ids ? links(f.scenario_ids,"scenarios") : null)), rows(record,"findings").length ? null : el("p","","没有未解决的设计缺口或需求澄清事项。")),
      panel("操作模式与用户状态", field("操作模式", record.operation_modes), field("用户状态", record.user_states)),
      panel("审查范围与判断边界", field("范围", record.scope), field("限制", record.limitations)),
      array(record.uncovered_paths).length ? panel("未覆盖路径", prose(record.uncovered_paths)) : null, raw(record))].filter(Boolean);
}

function reverseRuleView(rule) {
  const record = AcceptanceTrace.whiteDesignReview(state.data, rule.id) || {requirement_id:rule.id};
  return [panel("需求", badge("white_box", "白盒逆向"), ruleConfirmationBadge(rule), badge(AcceptanceTrace.ruleStatus(state.data,rule), AcceptanceTrace.ruleStatus(state.data,rule) === "sufficient" ? "规则覆盖充分" : labels[AcceptanceTrace.ruleStatus(state.data,rule)]), prose(rule.text),
      rule.status === "needs_confirmation" ? el("p", "alert", "以下只审查已列候选情况的设计覆盖。业务确认后须明确产品判据并重新审查，当前不能执行或判定通过 / BUG。") : null),
    rule.question ? panel("需要确认的问题", prose(rule.question)) : null,
    ...reviewView(record, true).slice(2),
    el("details", "raw review-technical", el("summary", "", "查看规则来源与代码依据"),
      panel("规则来源", field("代码提示的业务风险", rule.rationale), field("独立判断依据", rule.basis), field("来源核验", AcceptanceTrace.ruleReview(state.data,rule.id)?.reason)),
      panel("代码与约束来源", ...rows(rule, "code_sources").map(source => el("section", "probe",
        field("文件与位置", `${source.root || state.data.project_root}/${source.path} · ${source.symbol}${source.line_start ? ` · ${source.line_start}–${source.line_end}行` : ""}`),
        source.excerpt ? el("pre", "", source.excerpt) : null, field("代码版本", source.revision), field("文件哈希", source.sha256)))) )].filter(Boolean);
}

function designBasisPanel(id, scenarioId = "", white = false) {
  const basis = white ? AcceptanceTrace.whiteDesignBasis(state.data, id) : designBasis(id), covers = rows(basis, "coverage_items").filter(c => !scenarioId || strings(c.scenario_ids).includes(scenarioId));
  return panel("生成时的覆盖分析 · " + id, field("纳入范围", basis?.scope),
    ...rows(basis, "techniques").map(t => el("section", "probe", el("h4", "", t.name), prose(t.reason))),
    el("details", "raw", el("summary", "", `具体计划覆盖项 · ${covers.length} 项`), ...covers.map(c => el("section", "probe", el("p", "id-line", c.id), field("需要验证的情况", c.condition), field("预期行为", c.expected), links(c.scenario_ids, "scenarios"), button("查看完整场景", () => navigate("scenarios", c.scenario_id))))),
    array(basis?.exclusions).length ? field("明确排除", basis.exclusions) : null,
    array(basis?.limitations).length ? field("设计边界", basis.limitations) : null);
}

function historyView() {
  const result = [panel("应用执行记录", el("p", "muted", "这里只展示已经存在的运行记录。没有记录时不推断应用已经测试；已有记录也需结合版本、证据与完整验收门禁判断。"))];
  if (!array(state.data.runs).length) result.push(panel("尚无执行记录", el("p", "muted", "本台账当前用于场景设计。")));
  AcceptanceTrace.historyRuns(state.data).forEach(record => {
    const run = obj(record.documents?.["run.json"]);
    const evidenceReview = obj(record.documents?.["review.json"]), savedGate = obj(record.documents?.["gate-report.json"]);
    const historyTable = (kind, headers, items) => { const node = table(headers, items); node.dataset.historyTable = record.id + "/" + kind; return node; };
    if (run.execution_schema === 2) {
      const phaseLabels = { pending: "待执行", preparing: "准备测试", executing: "执行取证", evaluating: "独立评估中", completed: "已评估", not_run: "明确未执行", unrecorded: "阶段未记录" };
      const observations = new Map(rows(run, "results").map(v => [v.scenario_id, v]));
      result.push(panel("本轮进度 · " + record.id,
        field("运行状态", run.lifecycle === "running" ? "执行中（自动刷新）" : run.lifecycle === "completed" ? "已结束" : run.lifecycle === "aborted" ? "已中止：" + (run.termination?.reason || '原因未记录') : "运行状态未记录"), field("最近更新", run.updated_at),
        el("div", "execution-phase-counts", ...Object.entries(ExecutionView.phaseCounts(record)).filter(([key, count]) => key !== "unrecorded" || count).map(([key, count]) => el("div", "", el("strong", "", count), el("span", "", phaseLabels[key])))),
        el("p", "muted", array(record.documents?.["execution-plan.json"]?.ordered_scenario_ids).length ? "按本轮冻结执行计划排列；阶段数量按已保存记录统计。" : "执行计划未记录，仅按本轮快照重要度排列；不能据此还原实际执行顺序。"),
        historyTable("progress", ["场景", "阶段", "执行结果", "独立评估", "用例 / 操作关联"], ExecutionView.orderedProgress(record, rows(run, "progress")).map(v => {
          const observation = observations.get(v.scenario_id), binding = v.binding || observation?.binding;
          const scene = ExecutionView.sceneOf(record, v.scenario_id);
          return [ExecutionView.renderScene(record, scene, v, binding), ExecutionView.renderPhase(record, v, scene, binding), ExecutionView.renderObservation(record, scene, v, binding), ExecutionView.renderReview(record, scene, v, binding), binding ? ExecutionView.render(record, scene, v, binding) : "尚未记录测试方式"];
        }))));
    } else {
      const progress = AcceptanceTrace.legacyProgress(state.data, record);
      result.push(panel("本轮进度 · " + record.id,
        el("p", "muted", "按此轮保存的场景与执行记录展示。旧记录没有准备、执行或评估中的阶段，不推断当前是否仍在执行，也不代表当前版本重新验收。"),
        field("结果记录", `共 ${progress.total} 个场景 · 已记录执行结果 ${progress.recorded} · 尚无结果 ${progress.missing} · 明确未执行 ${progress.notRun}`),
        field("独立证据评估", `已记录评估 ${progress.reviewRecorded} · 尚无评估 ${progress.total - progress.reviewRecorded} · 当前核验通过 ${progress.reviewed} · 台账版本${labels[record.ledger_match] || record.ledger_match || "未确认"}`),
        !progress.scopeKnown ? el("p", "muted", "缺少此轮场景快照和执行计划，仅展示已有记录，无法统计完整未测范围。") : null,
        historyTable("progress", ["场景", "阶段记录", "执行结果", "独立评估", "证据"], ExecutionView.orderedProgress(record, progress.items).map(v => {
          const scene = ExecutionView.sceneOf(record, v.scenario_id), phase = ExecutionView.progressOf(record, v.scenario_id, v), binding = v.result?.binding;
          return [ExecutionView.renderScene(record, scene, phase, binding), ExecutionView.renderPhase(record, phase, scene, binding), ExecutionView.renderObservation(record, scene, phase, binding), ExecutionView.renderReview(record, scene, phase, binding), ExecutionView.renderEvidence(record, scene, phase, binding)];
        }))));
    }
    result.push(panel("运行 " + record.id, button("使用此运行查看追踪与统计", () => { state.run = record.id; state.trace = AcceptanceTrace.build(state.data, state.run); renderOverview(); navigate("overview"); }),
      field("修订 / 环境", `${text(run.revision)} / ${text(run.environment)}`), field("验收模式", record.acceptance_mode === "coverage" ? "覆盖率增强" : record.acceptance_mode === "standard" ? "标准" : "未知模式"), field("与当前台账版本的关系", labels[record.ledger_match] || record.ledger_match),
      button("查看此运行报告与证据", () => { resultState.artifactRun = record.id; resultState.artifact = ""; navigate("artifacts"); }),
      field("独立证据审查来源", evidenceReview.review_reference),
      field("已保存完整门禁的结论（历史记录）", savedGate.status || "未记录"),
      savedGate.gates ? historyTable("gates", ["完整门禁", "保存状态", "问题数 / 详情"], Object.entries(obj(savedGate.gates)).map(([name, gate]) => [name, obj(gate).status, array(obj(gate).issues).length ? el("details", "raw", el("summary", "", `${array(obj(gate).issues).length} 项问题`), prose(obj(gate).issues)) : obj(gate).issues ? prose(obj(gate).issues) : "未列出问题"])) : null,
      ...["execution_repairs", "issues"].map(key => panel(key === "execution_repairs" ? "场景内执行修正与重测" : "确认的 BUG / AI 执行异常",
        rows(run, key).length ? historyTable(key, ["场景", "记录类型", "详情"], rows(run, key).map(value => {
          const scene = ExecutionView.sceneOf(record, value.scenario_id), phase = ExecutionView.progressOf(record, value.scenario_id) || {scenario_id: value.scenario_id}, binding = phase.binding || rows(run, "results").find(v => v.scenario_id === value.scenario_id)?.binding;
          return [scene.title || value.scenario_id, key === "execution_repairs" ? `尝试 ${value.attempt || "未记录"} · ${{evidence: "证据修正", test_design: "用例设计修正", execution: "执行修正", recording: "记录修正"}[value.problem_kind] || "执行修正"}` : value.kind === "bug" ? "产品 BUG" : value.kind === "ai_execution_error" ? "AI 执行异常" : "问题类型未记录", ExecutionView.entry(record, scene, phase, binding, "observation", "查看场景记录", {section: key === "execution_repairs" ? "repair" : "issue", attempt: value.attempt})];
        })) : el("p", "muted", "尚无已记录条目。"))),
      ...Object.entries(obj(record.documents)).filter(([, value]) => value !== null).map(([name, value]) => raw(value, name))));
  });
  result.push(panel("审查历史", el("p", "muted", "历史文件按原版本展示，不作为当前台账的有效审查。")));
  array(state.data.history).forEach(record => {
    const coverage = obj(record.documents?.["coverage_review.json"]);
    const gaps = rows(coverage).filter(value => value.verdict === "gap");
    result.push(panel("历史 " + record.id, badge(coverage.status), field("审查依据", coverage.basis),
      el("p", "muted", `${rows(coverage).length} 项审查 · ${gaps.length} 项缺口`),
      ...gaps.map(value => el("details", "raw", el("summary", "", value.requirement_id), field("理由", value.reason), field("未覆盖路径", value.uncovered_paths))),
      ...Object.entries(obj(record.documents)).filter(([, value]) => value !== null).map(([name, value]) => raw(value, name))));
  });
  return result;
}


function pipelinePanel() {
  const value = state.data?.pipeline_status;
  if (!value) return panel('当前验收流程', el('p','muted','等待流程数据。'));
  const stageNames = {pending:'待开始', in_progress:'进行中', completed:'已完成', incomplete:'未完成',not_requested:'本轮仅设计'};
  const active=array(value.units).find(u=>u.unit_id===value.active_unit && u.status==='in_progress');
  return panel('当前验收流程',
    el('ol','pipeline-stages',...array(value.stages).map(s=>el('li','pipeline-stage '+s.status,el('strong','',s.title),el('span','',stageNames[s.status]||s.status)))),
    el('p','muted',`验收组织生成场景：${value.generated_units} / ${value.total_units} 个已完成。场景生成完成后仍需独立审查，执行结果来自实际运行。`),
    el('div','pipeline-active-unit',el('span','muted','当前生成组织：'),active ? button(active.title||active.unit_id,()=>{
      selectOrganization(active.unit_id);
      [...document.querySelectorAll('.trace-organization')].find(n=>n.dataset.unitId===active.unit_id)?.scrollIntoView({block:'center'});
    }) : el('span','muted','暂无正在生成的组织')),
    array(value.issues).length ? el('details','',el('summary','','当前流程阻塞原因'),prose(value.issues)) : null);
}
function scopePlan() {
  return typeof AcceptanceScope === 'undefined' ? null : AcceptanceScope.plan(state.data, state.trace?.record);
}
function scopePanel(scene) {
  if (!scene.scope) return null;
  const names={direct:'直接需求验收',necessary_related:'必要关联检查',affected_regression:'受影响回归'};
  return panel('本轮纳入依据',field('类型',names[scene.scope.kind]||scene.scope.kind),field('验收组织',typeof AcceptanceScope==='undefined'?scene.scope.unit_ids:AcceptanceScope.units(scopePlan(),scene).map(u=>u.title)),field('必要性',scene.scope.basis),
    el('details','',el('summary','','逐判据来源与业务风险'),...array(scene.scope.criteria).map(c=>el('section','',field('验收判据',c.criterion),field('原始检查 / 补充规则',[...array(c.check_ids),...array(c.rule_ids)]),field('适用依据',c.basis))),field('实际失败链条',scene.risk?.causal_chain),field('整体业务影响',scene.risk?.business_impact),field('受影响用户',scene.risk?.affected_users),field('恢复与替代路径',scene.risk?.recoverability),field('严重程度依据',scene.risk?.materiality_basis||scene.risk?.grade_basis)));
}

let loadingLedger = false;
async function load() {
  if (loadingLedger) return;
  loadingLedger = true;
  $("refresh").disabled = true;
  try {
    const response = await fetch("/api/ledger", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("读取失败：HTTP " + response.status);
    state.data = await response.json();
    state.run = "";
    state.trace = AcceptanceTrace.buildLatest(state.data);
    const savedPriorityTooltip = capturePriorityTooltip();
    const focusedPreview = document.activeElement?.className==='trace-preview-toggle' ? document.activeElement.parentElement?.dataset.tracePreview : null;
    const focusedEntry = document.activeElement?.dataset?.executionKey ? {key: document.activeElement.dataset.executionKey, tab: document.activeElement.dataset.executionTab, entry: document.activeElement.dataset.executionEntry} : null;
    const expandedCoverage = new Set([...document.querySelectorAll("[data-execution-coverage-scope]")].filter(n => n.open).map(n => n.dataset.executionCoverageScope));
    const expandedTrace = new Set([...document.querySelectorAll("#extra details[data-trace-key]")].filter(n=>n.open).map(n=>n.dataset.traceKey));
    const tableScrolls = new Map([...document.querySelectorAll("[data-history-table]")].map(node => [node.dataset.historyTable, node.scrollLeft]));
    renderOverview(); render(); ExecutionView.sync(state.data); syncDesignReview();
    if (pendingDesignReview) { const id = pendingDesignReview; pendingDesignReview = ""; openDesignReview(id); }
    document.querySelectorAll("[data-history-table]").forEach(node => { if (tableScrolls.has(node.dataset.historyTable)) node.scrollLeft = tableScrolls.get(node.dataset.historyTable); });
    document.querySelectorAll("[data-execution-coverage-scope]").forEach(n => { n.open = expandedCoverage.has(n.dataset.executionCoverageScope); });
    document.querySelectorAll("#extra details[data-trace-key]").forEach(n=>{n.open=expandedTrace.has(n.dataset.traceKey);});
    restorePriorityTooltip(savedPriorityTooltip);
    if(focusedPreview) [...document.querySelectorAll("[data-trace-preview]")].find(n=>n.dataset.tracePreview===focusedPreview)?.querySelector(".trace-preview-toggle")?.focus({preventScroll:true});
    if (focusedEntry) [...document.querySelectorAll("[data-execution-key]")].find(v => v.dataset.executionKey === focusedEntry.key && (focusedEntry.entry ? v.dataset.executionEntry === focusedEntry.entry : v.dataset.executionTab === focusedEntry.tab))?.focus({preventScroll: true});
  } catch (error) {
    // A connection failure must not leave old green badges looking current.
    hidePriorityTooltip();
    state.data = null;
    state.trace = null;
    const reason = ['TimeoutError','AbortError'].includes(error.name) ? '读取超过15秒，查看器尚未响应' : error.message;
    $("alerts").replaceChildren(el("div", "alert error", "无法读取当前台账：" + reason + "。请确认本地查看器仍在运行，然后重新加载。"));
    $("summary").replaceChildren(); $("list").replaceChildren(); $("detail").replaceChildren(); $("extra").replaceChildren();
    $("loaded").textContent = "当前数据不可核验";
    ExecutionView.sync(null); syncDesignReview();
  } finally { loadingLedger = false; $("refresh").disabled = false; }
}

document.querySelectorAll("nav button").forEach(node => node.addEventListener("click", () => navigate(node.dataset.view)));
["search", "package", "coverage", "kind", "priority", "unit"].forEach(key => $(key)?.addEventListener(key === "search" ? "input" : "change", event => { state[key] = event.target.value; if (state.view === "trace") { state.selected = ""; history.replaceState(null, "", "#trace"); } render(); }));
$("refresh").addEventListener("click", load);
function readHash() {
  const [view, ...parts] = location.hash.slice(1).split("/");
  if (["overview", "trace", "scenarios", "requirements", "review", "gates", "history", "code-coverage", "iterations", "artifacts"].includes(view)) state.view = view;
  try { state.selected = decodeURIComponent(parts.join("/")); } catch { state.selected = ""; }
  if (["history", "code-coverage", "iterations", "artifacts"].includes(state.view)) { state.view = "trace"; state.selected = ""; history.replaceState(null, "", "#trace"); }
  if (state.view === "gates") { state.view = "overview"; state.selected = ""; history.replaceState(null, "", "#overview"); }
  if (state.view === "requirements") { state.view = "trace"; history.replaceState(null, "", "#trace" + (state.selected ? "/" + encodeURIComponent(state.selected) : "")); }
  if (state.view === "review") { pendingDesignReview = state.selected; state.view = "trace"; state.selected = ""; history.replaceState(null, "", "#trace"); }
}
readHash();
window.addEventListener("resize",syncTracePreviews);
document.addEventListener?.("toggle",syncTracePreviews,true);
if(document.fonts?.ready) document.fonts.ready.then(syncTracePreviews);
window.addEventListener("hashchange", () => { readHash(); render(); if (pendingDesignReview && state.data) { const id = pendingDesignReview; pendingDesignReview = ""; openDesignReview(id); } });
load();

setInterval(() => { if (!document.hidden && (["history", "trace"].includes(state.view) || array(state.data?.runs).some(r => obj(r.documents?.["run.json"]).execution_schema === 2 && obj(r.documents?.["run.json"]).lifecycle === "running"))) load(); }, 5000);
