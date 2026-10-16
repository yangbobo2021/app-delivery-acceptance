"use strict";
const resultState = { before: "", after: "", artifact: "", artifactRun: null, artifactSearch: "", preview: 0 };
const metricLabels = { lines: "行", branches: "分支", functions: "函数", statements: "语句" };
const countedText = c => c ? `${c.covered} / ${c.total} · ${c.percent == null ? "无可计数单元" : c.percent.toFixed(2) + "%"}` : "不可用";
const selectedRecord = () => array(state.data?.runs).find(r => r.id === state.run);
const coverageRecords = () => array(state.data?.runs).filter(r => r.acceptance_mode === "coverage");
const artifactURL = path => "/artifacts/" + path.split("/").map(encodeURIComponent).join("/");
function openArtifact(path) { resultState.artifact = path; resultState.artifactRun = path.startsWith("runs/") ? path.split("/")[1] : ""; navigate("artifacts"); }
function evidenceLinks(refs, runId) {
  const node = el("div", "links");
  for (const ref of array(refs)) {
    const path = typeof ref === "string" ? ref : obj(ref).path;
    if (typeof path !== "string") { node.append(prose(ref)); continue; }
    let relative;
    if (path.startsWith(state.data.assets + "/")) relative = path.slice(state.data.assets.length + 1);
    else if (!path.startsWith("/") && !path.includes(":") && !path.includes("\\") && path.split("/").every(p => p && p !== "." && p !== "..")) relative = path.startsWith("runs/") || !runId ? path : `runs/${runId}/${path}`;
    if (relative) node.append(button(path, () => openArtifact(relative)));
    else node.append(el("span", "muted", `${path}（所选台账之外的引用，请按原路径查看）`));
  }
  if (!node.childNodes.length) node.append(el("span", "muted", "无证据引用"));
  return node;
}
function codeCoverageView() {
  const record = selectedRecord();
  if (!record) return [panel("代码覆盖率", el("p", "", "请选择一次运行。统计使用该运行的测量范围、源文件和原始计数；不会合并历史覆盖率。"))];
  const c = CoverageView.analyze(record), run = obj(record.documents?.["run.json"]);
  if (!c.enabled) return [panel("代码覆盖率增强未启用", el("p", "", `运行 ${record.id} · ${c.mode === "standard" ? "标准模式" : "未知模式"}`), el("p", "muted", "此运行不读取覆盖率增强记录、不增加第六门禁、不执行补测循环。历史覆盖率文件不会改变验收模式。"), ...c.issues.map(v => prose(v)))];
  const m = c.measurement, review = c.review;
  const result = [panel(`代码覆盖率 · ${record.id}`, badge(record.ledger_match), field("测量修订 / 环境", `${text(m.revision || run.revision)} / ${text(m.environment || run.environment)}`),
    el("p", "muted", "以下为保存的测量与独立审查记录。查看器核对记录绑定和计数结构；不执行测试、不重新认证源码及原始证据，也不据此宣布可以发布。"),
    c.issues.length ? el("div", "alert", prose(c.issues)) : el("p", "muted", "测量、审查与所选运行的记录绑定一致。")),
    panel("测量范围内的汇总", el("div", "coverage-metrics", ...CoverageView.kinds.map(kind => el("div", "metric", el("strong", "value-text", countedText(c.totals[kind])), el("span", "", metricLabels[kind]), el("span", "", c.totals[kind] ? `${c.totals[kind].files} / ${c.totals[kind].sourceCount} 个文件提供此计数` : "无有效计数")))),
      el("p", "muted", "汇总采用 covered / total 加权计算。总数为 0 时不显示 100%。行、分支、函数和语句分别计算，排除范围仍须结合审查判断。")),
    panel("文件与模块", table(["项目相对路径 / 模块", ...CoverageView.kinds.map(k => metricLabels[k])], c.sources.map(s => [el("div", "", el("p", "file-label", s.path || "缺少路径"), s.module || s.component ? el("p", "muted", text(s.module || s.component)) : null), ...CoverageView.kinds.map(k => countedText(s.metrics[k]))]))),
    panel("范围、排除项与工具", field("包含范围", obj(m.scope).targets), field("范围依据", obj(m.scope).basis), field("排除范围及理由", obj(m.scope).exclusions), field("采集工具与命令", m.tools), evidenceLinks(m.raw_evidence, record.id)),
    panel("未覆盖路径与独立处置", table(["路径 ID", "文件 / 位置", "类型", "处置 / 理由", "关联场景"], rows(m, "uncovered").map(path => {
      const dispositions = rows(review, "dispositions").filter(d => d.path_id === path.id);
      return [text(path.id), `${text(path.file)} · ${text(path.location)}`, text(path.kind), dispositions.length ? prose(dispositions.map(d => `${text(d.decision)}：${text(d.reason)}`)) : "尚无处置记录", links(dispositions.flatMap(d => strings(d.scenario_ids)), "scenarios")];
    })), raw(review.dispositions, "全部处置原文")),
    panel("独立审查与补测建议", field("保存的审查结论", review.status), field("记录中的收敛判断", c.recordedConclusion), field("判断理由", review.reason), field("审查来源", review.review_reference),
      ...rows(review, "recommendations").map(v => panel(v.id || v.title || "补测建议", prose(v.reason || v.description || v), links(v.requirement_ids, "requirements"), links(v.scenario_ids, "scenarios"), raw(v))),
      Array.isArray(review.recommendations) ? review.recommendations.length ? raw(review.recommendations, "全部建议原文（含非标准字段）") : el("p", "muted", "审查记录的补测建议为空。完整验收还须检查全部门禁和实际证据。") : el("p", "muted", "未记录建议列表，不能推断无需补测。"), evidenceLinks(review.evidence, record.id)),
    panel("覆盖率门禁原始记录", raw(record.documents["code-coverage/gate-report.json"] || obj(record.documents["gate-report.json"]).gates?.code_coverage || null), raw(m, "measurement.json"), raw(review, "review.json")),
    button("比较运行与场景变化", () => { resultState.after = record.id; navigate("iterations"); })];
  if (state.data.documents["code-coverage-resources.json"]) result.push(panel("覆盖率资源记录", raw(state.data.documents["code-coverage-resources.json"])));
  return result;
}
function iterationsView() {
  const records = array(state.data.runs), enhanced = coverageRecords();
  const result = [panel("补测与运行比较", el("p", "", "选择两次运行作为比较基线。只有记录的源码、修订、环境、范围及采集工具一致，才展示覆盖率增量。"), el("p", "muted", "运行列表不推断循环顺序。轮次与会话只有在 run.json 明确记录时展示；缺少设计快照的旧运行无法还原新增场景。")),
    panel("覆盖率增强运行", table(["运行", "记录时间 / 会话 / 轮次", "场景快照数", "行 / 分支", "保存的审查 / 未解决建议"], enhanced.map(r => {
      const run = obj(r.documents["run.json"]), c = CoverageView.analyze(r), design = CoverageView.design(r, "scenarios");
      return [button(r.id, () => { state.run = r.id; state.trace = AcceptanceTrace.build(state.data, state.run); renderOverview(); navigate("code-coverage"); }), `${text(run.created_at) || "时间未记录"} / ${text(run.workflow_session_id) || "会话未记录"} / ${text(run.coverage_round) || "轮次未记录"}`, design ? design.size : "无可核验快照", `${countedText(c.totals.lines)} / ${countedText(c.totals.branches)}`, `${text(c.review.status) || "未记录"} / ${Array.isArray(c.review.recommendations) ? c.review.recommendations.length : "未知"}`];
    })), enhanced.length ? null : el("p", "muted", "尚无明确启用 coverage 的运行。标准验收无需进入补测循环。"))];
  const before = el("select", ""), after = el("select", ""); before.id = "compare-before"; after.id = "compare-after";
  for (const select of [before, after]) select.append(new Option("选择一次运行", ""), ...records.map(r => new Option(r.id, r.id)));
  before.value = records.some(r => r.id === resultState.before) ? resultState.before : "";
  after.value = records.some(r => r.id === resultState.after) ? resultState.after : "";
  const comparison = el("div", "");
  const update = () => {
    resultState.before = before.value; resultState.after = after.value;
    const a = records.find(r => r.id === before.value), b = records.find(r => r.id === after.value);
    if (!a || !b || a === b) { comparison.replaceChildren(el("p", "muted", "请选择两次不同运行。")); return; }
    const c = CoverageView.compare(a, b);
    const changes = (name, diff, view) => panel(name, diff.available ? el("div", "", field("新增数量", diff.added.length), el("h4", "", "新增 ID"), links(diff.added, view), el("h4", "", "修改 ID"), links(diff.changed, view), field("移除 ID", diff.removed), el("p", "muted", "ID 链接打开当前台账；当时的完整定义见对应运行的快照文件。"), evidenceLinks(["scenarios.snapshot.json"], a.id), evidenceLinks(["scenarios.snapshot.json"], b.id)) : el("p", "muted", "缺少与运行台账哈希匹配的设计快照，无法核验新增或修改数量。"));
    comparison.replaceChildren(c.comparable ? panel("覆盖率变化", table(["指标", before.value, after.value, "新增覆盖 / 百分点"], Object.entries(c.metrics).map(([kind, m]) => [metricLabels[kind], countedText(m.before), countedText(m.after), `${m.coveredDelta >= 0 ? "+" : ""}${m.coveredDelta} / ${m.percentDelta == null ? "无可计数单元" : m.percentDelta.toFixed(2)}`]))) : panel("覆盖率不可直接比较", prose(c.reasons)), changes("场景变化", c.scenarios, "scenarios"));
  };
  before.addEventListener("change", update); after.addEventListener("change", update); update();
  result.push(panel("选择比较基线", el("div", "comparison-controls", el("label", "", "之前的运行", before), el("label", "", "之后的运行", after)), comparison));
  return result;
}
function artifactsView() {
  let inventory = obj(state.data.artifacts), files = rows(inventory, "files");
  const runFilter = el("select", ""), search = el("input", ""), notices = el("div", ""), ledgerData = state.data;
  let inventoryRequest = 0;
  runFilter.id = "artifact-run"; search.id = "artifact-search"; search.type = "search"; search.placeholder = "搜索报告、截图、日志或路径"; search.value = resultState.artifactSearch;
  runFilter.append(new Option("整个项目台账", ""), ...array(state.data.runs).map(r => new Option(r.id, r.id)));
  if (resultState.artifactRun == null) resultState.artifactRun = state.run;
  runFilter.value = array(state.data.runs).some(r => r.id === resultState.artifactRun) ? resultState.artifactRun : "";
  const listing = el("div", ""), preview = el("div", "artifact-preview");
  const refresh = () => {
    resultState.artifactRun = runFilter.value; resultState.artifactSearch = search.value;
    const filtered = files.filter(f => (!runFilter.value || f.run_id === runFilter.value) && f.path.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    notices.replaceChildren(prose(array(inventory.notices)));
    listing.replaceChildren(table(["文件", "类型", "大小"], filtered.map(f => [button(f.path, () => { resultState.artifact = f.path; showArtifact(preview, f); }), f.kind, `${(f.size / 1024).toFixed(1)} KiB`])), el("p", "muted", `${filtered.length} / ${files.length} 个文件。所有路径均限定在当前项目所选测试台账内。`));
  };
  const loadInventory = async () => {
    const request = ++inventoryRequest, selected = runFilter.value;
    resultState.artifactRun = selected;
    listing.replaceChildren(el("p", "muted", "正在读取所选运行的文件…"));
    try {
      const response = await fetch("/api/artifacts" + (selected ? "?run=" + encodeURIComponent(selected) : ""), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const value = await response.json();
      if (request !== inventoryRequest || state.view !== "artifacts" || state.data !== ledgerData) return;
      inventory = obj(value); files = rows(inventory, "files"); refresh();
    } catch (error) {
      if (request === inventoryRequest && state.view === "artifacts" && state.data === ledgerData) { files = []; listing.replaceChildren(el("p", "alert error", "文件列表不可用：" + error.message)); }
    }
  };
  runFilter.addEventListener("change", loadInventory); search.addEventListener("input", refresh); refresh();
  if (runFilter.value) loadInventory();
  const path = resultState.artifact;
  if (path) showArtifact(preview, files.find(f => f.path === path) || { path, kind: /\.html?$/i.test(path) ? "html" : /\.(png|jpe?g|webp|gif)$/i.test(path) ? "image" : "text" });
  else preview.append(el("p", "muted", "选择文件预览。HTML 报告在禁用脚本的隔离框内展示；原始 Markdown、日志和代码按文本展示。"));
  return [panel("报告与证据文件", el("p", "muted", "直接读取现有文件，供核查实际证据。文件存在或预览成功不等于验收通过。大型台账可选择运行单独加载文件；超出预览或下载限制时请打开本地原文件。"), notices, el("div", "comparison-controls", el("label", "", "运行范围", runFilter), el("label", "", "路径搜索", search))), el("div", "artifact-layout", panel("文件列表", listing), panel("文件预览", preview))];
}
const artifactRequests = new WeakMap();
async function showArtifact(container, file, options = {}) {
  const request = (artifactRequests.get(container) || 0) + 1, path = file.path, url = artifactURL(path);
  artifactRequests.set(container, request);
  const download = el("a", "artifact-download", "下载原文件"); download.href = url + "?download=1"; download.setAttribute("download", "");
  container.replaceChildren(el("h4", "file-label", path), download, el("p", "muted", "正在读取…"));
  const current = () => request === artifactRequests.get(container) && container.isConnected && state.view === (options.view || "artifacts") && state.data;
  try {
    if (file.kind === "text") {
      const response = await fetch("/api/artifact-text/" + path.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json(); if (!current()) return;
      container.replaceChildren(...[el("h4", "file-label", path), download, data.truncated ? el("p", "alert", "预览仅显示前 1 MiB，请下载或打开本地完整文件。") : null, el("pre", "artifact-text", data.text)].filter(Boolean));
    } else {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      if (!current()) return;
      let content;
      if (file.kind === "html") { content = el("iframe", "artifact-frame"); content.setAttribute("sandbox", ""); content.title = path; content.src = url; }
      else if (file.kind === "image") { content = el("img", "artifact-image"); content.alt = path; content.src = url; content.addEventListener("error", () => { if (current()) content.replaceWith(el("p", "alert error", "图像已移除或无法解码，请检查原文件。")); }); }
      else content = el("p", "muted", "此格式请下载或打开本地文件查看。" );
      container.replaceChildren(el("h4", "file-label", path), download, content);
    }
  } catch (error) { if (current()) container.replaceChildren(el("h4", "file-label", path), el("p", "alert error", "文件不可用：" + error.message + "。引用可能缺失、超出限制或位于所选台账之外。")); }
}

/* Structured execution records; legacy operation text is never interpreted as observations. */
(function (root) {
  "use strict";
  const object = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const list = v => Array.isArray(v) ? v : [];
  const values = v => Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : [];
  const modes = {existing_case: "复用用例", new_case: "新增用例", human_simulation: "模拟人工操作", combined: "组合验证"};
  const opened = new Set(), previews = new Map();
  let modal = null;
  const phaseNames = {pending: "待执行", preparing: "准备测试", executing: "执行取证", evaluating: "独立评估中", completed: "已评估", not_run: "未执行"};
  function sceneOf(record, id) {
    return list(record.documents?.["scenarios.snapshot.json"]?.items).find(s => s?.id === id) || {id};
  }
  function progressOf(record, id, legacyItem = {}) {
    const run = object(record.documents?.["run.json"]);
    const attempt = list(run.results).find(v => v?.scenario_id === id)?.attempt;
    return run.execution_schema === 2 ? list(run.progress).find(v => v?.scenario_id === id) : {scenario_id: id, legacy: true, attempt, reviewStatus: legacyItem.reviewStatus, recordStatus: legacyItem.status};
  }
  function orderedProgress(record, items) {
    const queue = list(record.documents?.["execution-plan.json"]?.ordered_scenario_ids);
    const ranks = new Map(queue.map((id, index) => [id, index]));
    const priorities = {P0: 0, P1: 1, P2: 2, P3: 3};
    return [...items].sort((a, b) => (ranks.get(a.scenario_id) ?? Infinity) - (ranks.get(b.scenario_id) ?? Infinity) ||
      (priorities[sceneOf(record, a.scenario_id).priority] ?? 4) - (priorities[sceneOf(record, b.scenario_id).priority] ?? 4));
  }
  function phaseCounts(record) {
    const counts = Object.fromEntries([...Object.keys(phaseNames), "unrecorded"].map(k => [k, 0]));
    list(record.documents?.["run.json"]?.progress).forEach(v => counts[Object.hasOwn(counts, v?.phase) ? v.phase : "unrecorded"]++);
    return counts;
  }
  function observationData(record, scene) {
    const run = object(record.documents?.["run.json"]), observation = list(run.results).find(v => v?.scenario_id === scene.id) || null;
    return {observation, summary: observation?.summary || "产出不完整：缺少业务结果摘要。",
      steps: list(observation?.step_results).filter(v => v && typeof v === "object"), previous: list(run.attempt_history).filter(v => v?.scenario_id === scene.id && v.observation),
      repairs: list(run.execution_repairs).filter(v => v?.scenario_id === scene.id), issues: list(run.issues).filter(v => v?.scenario_id === scene.id)};
  }
  function artifactReference(record, ref) {
    if (typeof ref !== "string") return null;
    const assets = typeof state === "object" ? state.data?.assets : null;
    if (assets && ref.startsWith(assets + "/")) ref = ref.slice(assets.length + 1);
    const prefix = `runs/${record.id}/`;
    if (ref.startsWith("runs/")) return ref.startsWith(prefix) ? relative(ref.slice(prefix.length), record.id) : null;
    return relative(ref, record.id);
  }
  function plan(record, scene, binding) {
    const p = object(binding.operation_plan);
    if (Object.keys(p).length) return {source: "本轮执行准备方案", plans: [p]};
    const frozen = list(record.documents?.["scenarios.snapshot.json"]?.items).find(s => s?.id === scene.id);
    const a = object(frozen?.acceptance);
    return {source: "本轮冻结场景中的验收说明", plans: Object.keys(a).length ? [{objective: a.description, preconditions: a.preconditions, steps: a.actions, criteria: a.criteria, evidence_expected: a.evidence_expected}] : []};
  }
  function relative(ref, runId) {
    if (typeof ref !== "string" || ref.includes(":") || ref.includes("\\") || ref.split("/").some(p => !p || p === "." || p === "..")) return null;
    // Binding and observation references are relative to this run, never another run.
    return `runs/${runId}/${ref}`;
  }
  function evidenceGroups(run, progress, files, runId) {
    const sid = progress.scenario_id, attempts = list(run.attempt_history).filter(v => v?.scenario_id === sid).map(v => v.observation).filter(Boolean);
    const current = list(run.results).find(v => v?.scenario_id === sid);
    if (current) attempts.unshift(current);
    const groups = attempts.map(o => ({attempt: o.attempt, observed: true, current: o === current, items: values(o.evidence).map(ref => {
      const path = typeof ref === "string" ? ref : object(ref).path;
      if (typeof path !== "string") return null;
      const meta = list(o.evidence_details).find(v => v?.path === path) || {};
      return {...meta, path, captured_at: meta.captured_at || null};
    }).filter(Boolean)}));
    const prefix = `runs/${runId}/evidence/${sid}/attempt-${progress.attempt || 1}/`;
    const known = new Set(groups.flatMap(g => g.items.map(v => relative(v.path, runId))));
    const unlinked = Number.isInteger(progress.attempt) && progress.attempt > 0 ? files.filter(f => f.path?.startsWith(prefix) && !known.has(f.path)).map(f => ({path: f.path.slice(`runs/${runId}/`.length), kind: f.kind})) : [];
    if (unlinked.length) groups.push({attempt: progress.attempt || 1, observed: false, items: unlinked});
    return groups;
  }
  function section(label, value, code = false, ordered = false) {
    const items = values(value);
    const paragraphs = v => String(typeof v === "string" ? v : JSON.stringify(v, null, 2)).split(/\n+/).map(line => el("p", "prose", line));
    return el("section", "execution-section", el("h4", "", label), items.length ? code ? el("pre", "", items.join("\n")) : Array.isArray(value) ? el(ordered ? "ol" : "ul", ordered ? "" : "execution-facts", ...items.map(v => el("li", "", ...paragraphs(v)))) : el("div", "", ...paragraphs(value)) : el("p", "muted", "未记录"));
  }
  function disclosure(key, title, children, onOpen) {
    const node = el("details", "execution-details", el("summary", "", title), ...children);
    node.open = opened.has(key);
    let loaded = false;
    const update = () => {
      if (node.open) { opened.add(key); if (!loaded && onOpen) { loaded = true; onOpen(node); } }
      else opened.delete(key);
    };
    node.addEventListener("toggle", update);
    if (node.open && onOpen) queueMicrotask(update);
    return node;
  }
  const verdictNames = {passed: "通过", failed: "发现 BUG", execution_error: "AI 无法完成执行", repair_required: "需修正执行问题"};
  function reviewData(record, scene) {
    const run = object(record.documents?.["run.json"]);
    const verdict = list(run.execution_schema === 2 || Array.isArray(run.scenario_reviews) ? run.scenario_reviews : record.documents?.["review.json"]?.results).find(v => v?.scenario_id === scene.id) || null;
    return {verdict, summary: verdict?.summary || "产出不完整：缺少独立判定摘要。", assessment: object(verdict?.assessment),
      previous: list(run.attempt_history).filter(v => v?.scenario_id === scene.id && v.review).map(v => ({attempt: v.attempt, verdict: v.review}))};
  }
  function reviewSections(record, scene, verdict, suffix) {
    const a = object(verdict.assessment), key = record.id + "/" + scene.id + "/review/" + suffix;
    const preview = el("div", "execution-preview");
    const refs = (evidence, label) => disclosure(key + "/evidence/" + label, `引用证据 · ${list(evidence).length} 份`, [
      el("div", "execution-review-evidence", ...list(evidence).map(ref => {
        const path = artifactReference(record, typeof ref === "string" ? ref : object(ref).path);
        const meta = list(observationData(record, scene).observation?.evidence_details).find(v => v.path === ref);
        return path ? button(meta?.name || ref, async () => {
          await showArtifact(preview, {path, kind: fileKind(path)}, {view: "history"});
          if (preview.isConnected && !preview.closest("[hidden]")) preview.scrollIntoView({block: "start", behavior: "smooth"});
        }) : el("p", "alert", "引用不可预览：" + ref);
      }))]);
    const x = object(a.explanation), audit = object(a.execution_audit);
    const auditNames = {scenario_alignment: "场景与方法是否测对", test_implementation: "用例代码 / 操作实现是否合理", execution_authenticity: "执行过程是否真实", evidence_sufficiency: "证据是否充分且属于本次"};
    const failed = verdict.status === "failed", final = ["passed", "failed"].includes(verdict.status);
    const content = [el("div", "execution-review-heading", badge(verdict.status, verdictNames[verdict.status] || verdict.status),
      el("p", "prose", x.conclusion || verdict.summary || "此记录缺少结论说明。"))];
    if (final && Object.keys(x).length) {
      content.push(el("section", "execution-section", el("h3", "", "场景验收结论及依据"),
        section("1. 结论", x.conclusion),
        el("section", "execution-section", el("h4", "", "2. 需求依据"), ...list(x.requirements).map(r => el("div", "judgment-requirement", el("p", "", `${r.id}：${r.text}`), el("p", "muted", `来源：${r.source}`)))),
        el("section", "execution-section", el("h4", "", "3. 验证操作"), section("前置状态", x.preconditions), section("实际操作", x.actions, false, true)),
        el("section", "execution-section", el("h4", "", "4. 预期与实际对照"),
          table(["验收判据", "预期", "实际事实", "判定 / 证据"], list(a.checks).map((c, index) => ({c, index})).sort((u, v) => ({failed: 0, unproven: 1, passed: 2}[u.c.status] ?? 3) - ({failed: 0, unproven: 1, passed: 2}[v.c.status] ?? 3)).map(({c, index}) => [c.criterion, c.expected, c.actual, el("div", "", badge(c.status, {passed: "符合", failed: "不符合", unproven: "未证明"}[c.status] || c.status), refs(c.evidence, "check-" + index))]))),
        el("section", "execution-section", el("h4", "", "5. 决定性证据与推理"), ...list(x.decisive_evidence).map((e, index) => el("article", "judgment-evidence", section("证据事实", e.observation), section("精确定位", e.locator), section("支持判据", e.supports), refs([e.path], "decisive-" + index))), section(failed ? "为什么认定产品 BUG" : "为什么可以判定通过", x.reasoning)),
        section("6. 判断边界", a.limitations)));
      if (!failed) content.push(el("p", "muted", "通过仅表示本场景在上述范围内满足判据、未发现 BUG，不代表产品不存在 BUG。"));
    } else {
      content.push(el("p", "alert", final ? "此记录缺少完整判定说明，不能仅凭结果标签复核结论。" : "当前不是通过或产品 BUG 的最终结论，需先处理执行问题。"), section("核查范围", a.scope), section("诊断依据", a.basis), section("判断边界", a.limitations));
    }
    content.push(el("section", "execution-section", el("h3", "", "测试执行可信性核查"),
      el("p", "muted", "此核查是最终验收判定的前提；检查测试自身的问题是否已经排除。"),
      Object.keys(audit).length ? badge(audit.status, {passed: "测试执行核查通过", repair_required: "测试执行需修正", execution_error: "AI 执行异常"}[audit.status] || audit.status) : el("p", "alert", "此记录未提供执行可信性核查。"),
      ...list(audit.checks).map(c => el("article", "execution-review-check", el("h4", "", auditNames[c.aspect] || c.aspect), badge(c.status, {passed: "已核实", failed: "存在问题", unproven: "未核实"}[c.status] || c.status), section("核查对象", c.subject), section("核查发现", c.finding), refs(c.evidence, "audit-" + c.aspect))),
      list(audit.issues).length ? section("需处理的测试问题", audit.issues) : null));
    if (a.output_quality) {
      const q = object(a.output_quality), names = {operation_plan: "操作方案", execution: "执行结果", evidence: "证据记录"};
      content.push(disclosure(key + "/output-quality", "产出表达质量审查", [badge(q.status, {passed: "内容审查通过", repair_required: "需要修正产出"}[q.status] || q.status),
        ...list(q.checks).map(v => section(names[v.artifact] || v.artifact, v.reason)), list(q.findings).length ? section("需要修正的问题", q.findings) : null]));
    }
    content.push(refs(verdict.evidence, "all"), preview,
      disclosure(key + "/source", "评估来源", [section("评估时间", verdict.evaluated_at), section("审查身份", verdict.reviewer_kind), section("审查引用", verdict.review_reference, true), section("执行结果哈希", verdict.result_sha256, true)]),
      disclosure(key + "/original", Object.keys(a).length ? "原始评估理由" : "原始评估理由（未结构化）", [section("理由原文", verdict.reason)]));
    return content;
  }
  function reviewView(record, scene, progress) {
    const data = reviewData(record, scene), key = record.id + "/" + scene.id;
    const content = data.verdict ? reviewSections(record, scene, data.verdict, "current") : [el("p", "muted", "当前尝试尚未保存独立评估。")];
    if (progress.legacy) content.unshift(el("p", "alert", `历史评估原文 · 当前核验：${labels[progress.reviewStatus] || "未确认"} · 台账版本：${labels[record.ledger_match] || "未确认"}。原始状态不代表当前版本重新验收。`));
    data.previous.forEach(v => content.push(disclosure(key + "/previous-review/" + v.attempt, `尝试 ${v.attempt} · 历史评估（不代表当前尝试结论）`, reviewSections(record, scene, v.verdict, "attempt-" + v.attempt))));
    return content;
  }
  function observationSections(record, scene, observation, suffix) {
    const key = record.id + "/" + scene.id + "/observation/" + suffix;
    const content = [badge(observation.status), observation.summary ? el("p", "prose", observation.summary) : el("p", "muted", "此执行记录未保存简短摘要。"),
      section("开始时间", observation.started_at), section("观察记录时间", observation.observed_at)];
    list(observation.step_results).forEach((v, i) => content.push(el("article", "execution-review-check", el("h5", "", `${i + 1}. 步骤 ${v.step}`), v.action ? section("实际操作", v.action) : null,
      section("实际观察", v.actual), el("p", "muted", `${list(v.evidence).length} 份关联证据`), disclosure(key + "/step/" + i, "查看步骤证据", [el("div", "execution-review-evidence", ...list(v.evidence).map(ref => {
        const path = artifactReference(record, ref), preview = el("div", "execution-preview");
        return el("div", "", path ? button(ref, () => showArtifact(preview, {path, kind: fileKind(path)}, {view: "history"})) : el("p", "alert", "引用不可预览：" + ref), preview);
      }))]))));
    if (!list(observation.step_results).length) content.push(el("p", "muted", "此记录未保存分项实际观察，完整内容见原始执行结果。"));
    content.push(el("p", "muted", `登记证据：${list(observation.evidence).length} 份；完整文件列表和预览见“已收集证据”。`), disclosure(key + "/actual", "原始执行结果", [section("实际结果原文", observation.actual || observation.reason)]));
    if (observation.status === "not_run") content.push(section("未执行原因", observation.reason || observation.not_run_reason));
    return content;
  }
  function observationView(record, scene, progress) {
    const data = observationData(record, scene), key = record.id + "/" + scene.id;
    const content = [disclosure(key + "/frozen-scene", "本轮冻结的场景定义", [section("场景标题", scene.title), el("section", "execution-section", el("h4", "", "重要度"), priorityBadge(scene, record)), section("预期结果", scene.expected || scene.expected_result), section("关联需求", scene.requirement_ids)])];
    if (progress.legacy) content.push(el("p", "alert", `历史执行记录 · 当前核验：${labels[progress.recordStatus] || "未确认"} · 台账版本：${labels[record.ledger_match] || "未确认"}；阶段和尝试次数缺失时保持未记录。`));
    if (data.observation) content.push(...observationSections(record, scene, data.observation, "current"));
    else content.push(el("p", "muted", "当前尝试尚未登记执行结果。"));
    data.repairs.forEach((v, i) => {
      const archived = data.previous.find(a => a.attempt === v.attempt)?.review;
      const prior = archived?.status === "repair_required" || archived?.reason === v.reason ? archived : null;
      const node = disclosure(key + "/repair/" + i, `尝试 ${v.attempt || "未记录"} · 执行修正原因`, [section("问题类型", {evidence: "证据问题", test_design: "用例设计问题", execution: "执行问题", recording: "记录问题"}[v.problem_kind] || v.problem_kind), section("修正摘要", prior?.summary || v.summary),
        prior?.assessment ? section("独立诊断依据", prior.assessment.basis) : el("p", "muted", "未保存分项诊断；完整历史评估见“独立评估”。"), disclosure(key + "/repair-reason/" + i, "原始修正诊断", [section("独立诊断原文", v.reason)])]);
      node.dataset.executionSection = "repair"; node.dataset.attempt = String(v.attempt); content.push(node);
    });
    data.issues.forEach((v, i) => {
      const archived = data.previous.find(a => a.attempt === v.attempt);
      const current = Number.isInteger(v.attempt) && data.observation?.attempt === v.attempt;
      const observation = current ? data.observation : archived?.observation, verdict = current ? reviewData(record, scene).verdict : archived?.review;
      const node = disclosure(key + "/issue/" + i, (v.kind === "bug" ? "已记录产品 BUG" : v.kind === "ai_execution_error" ? "已记录 AI 执行异常" : "原始问题记录") + ` · 尝试 ${v.attempt || "未记录"}`, [section("问题标题", object(v.details).title || v.summary), section("执行摘要", observation?.summary), section("独立判定摘要", verdict?.summary), section("复现前置", object(v.details).preconditions), section("复现步骤", list(object(v.details).steps).map(step => step.step + "：" + (step.action || step.actual))), section("预期结果", object(v.details).expected), section("实际结果", object(v.details).actual), section("业务影响 / 能力问题", object(v.details).impact), list(object(v.details).recovery_attempts).length ? section("实际恢复尝试", object(v.details).recovery_attempts) : null, el("p", "muted", current ? "实际观察、证据和独立判据见对应页签。" : "此条为保存的问题记录，不能替代当前尝试判定；实际结果见原始记录及对应历史尝试。"), raw(v, "原始问题记录")]);
      node.dataset.executionSection = "issue"; node.dataset.attempt = String(v.attempt); content.push(node);
    });
    data.previous.forEach(v => content.push(disclosure(key + "/previous-observation/" + v.attempt, `尝试 ${v.attempt} · 历史执行记录`, observationSections(record, scene, v.observation, "attempt-" + v.attempt))));
    return content;
  }
  function planView(record, scene, binding) {
    const key = record.id + "/" + scene.id;
    const p = plan(record, scene, binding), content = [el("p", "muted", p.source + "；计划操作不代表已经执行。")];
    if (!p.plans.length) content.push(el("p", "muted", "本轮未保存可分节展示的验收方法，请查看原始操作记录。"));
    p.plans.forEach(v => content.push(el("div", "execution-plan", v.id ? el("p", "id-line", v.id) : null,
      section("测试目的", v.objective), section("前置状态", v.preconditions), section("操作步骤", v.steps, false, true), section("验收判据", v.criteria), section("证据要求", v.evidence_expected),
      v.technical && Object.keys(object(v.technical)).length ? disclosure(key + "/technical/" + (v.id || "plan"), "工具、命令与环境参数", Object.entries(v.technical).map(([k, x]) => section(({tool: "工具", entry_point: "入口", commands: "命令", environment: "环境"})[k] || k, typeof x === "string" || Array.isArray(x) ? x : JSON.stringify(x, null, 2), true))) : null)));
    if (binding.operation) content.push(disclosure(key + "/original", "原始操作记录（未结构化）", [el("pre", "", binding.operation)]));
    return content;
  }
  function associations(binding = {}) {
    const originLabels = {existing_case: "已有用例", new_case: "本轮新建用例"};
    const items = list(binding.cases).filter(c => c && typeof c === "object").map(c => {
      const origin = c.origin || (["existing_case", "new_case"].includes(binding.mode) ? binding.mode : "unrecorded");
      return {...c, key: "case:" + c.path + ":" + c.selector, kind: "case", origin, label: originLabels[origin] || "来源未记录", name: c.name || c.selector || "用例名称未记录"};
    });
    list(binding.manual_operations).filter(v => v && typeof v === "object").forEach(v => items.push({...v, key: "manual:" + v.id, kind: "manual", label: "AI模拟人工操作"}));
    // Old metadata is diagnostic only; never substitute a scene plan for a case procedure.
    if (!list(binding.manual_operations).length && ["human_simulation", "combined"].includes(binding.mode)) items.push({key: "manual:unrecorded", kind: "manual", label: "AI模拟人工操作", name: binding.operation_name || "操作说明未记录", tool: binding.operation_plan?.technical?.tool, entry_point: binding.operation_plan?.technical?.entry_point});
    return items;
  }
  function caseScopes(item, record, scene) {
    if (!record || item.kind !== "case") return list(item.procedure?.scenario_checks).filter(c => !scene || c.scenario_id === scene.id);
    const run = object(record.documents?.["run.json"]), mappings = [];
    list(run.progress).forEach(p => {
      const binding = p.binding || list(run.results).find(r => r.scenario_id === p.scenario_id)?.binding;
      associations(binding).filter(v => v.kind === "case" && v.key === item.key && v.revision === item.revision && v.sha256 === item.sha256).forEach(v => mappings.push(...list(v.procedure?.scenario_checks).filter(c => c.scenario_id === p.scenario_id)));
    });
    return [...new Map(mappings.map(c => [JSON.stringify(c), c])).values()];
  }
  function procedureTable(headers, rows) {
    return el("div", "table-wrap", el("table", "", el("thead", "", el("tr", "", ...headers.map(h => el("th", "", h)))),
      el("tbody", "", ...rows.map(row => el("tr", "", ...row.map((value, index) => { const cell = el("td", "", value); cell.setAttribute("data-label", headers[index]); return cell; }))))));
  }
  function associationView(binding, target, scene, record) {
    const item = associations(binding).find(v => v.key === target);
    if (!item) return [el("p", "alert", "此用例或人工任务在当前尝试中不存在关联记录。")];
    const p = object(item.procedure), checks = caseScopes(item, record, scene);
    const groups = [...new Set(checks.map(c => c.scenario_id))].map(id => ({id, checks: checks.filter(c => c.scenario_id === id)}));
    const technical = item.kind === "case" ? [section("项目内用例文件", item.path, true), section("精确用例标识", item.selector, true), section("执行命令", item.command, true), section("用例版本", item.revision, true), section("用例文件 SHA256", item.sha256, true)] : [section("实际操作工具", item.tool), section("实际操作入口", item.entry_point), el("p", "muted", "AI执行的人工测试过程，未关联自动化测试用例。")];
    return [el("p", "muted", item.label),
      Object.keys(p).length ? el("div", "case-procedure",
        section("测试目的", p.objective),
        el("section", "execution-section", el("h4", "", "前置条件与测试数据"), section("前置条件", p.preconditions), section("测试数据", p.test_data)),
        el("section", "execution-section", el("h4", "", "操作步骤与预期结果"), el("p", "muted", "以下说明该用例如何检查；本用例实际执行事实与证据见下方；场景最终结论由独立评估给出。"),
          procedureTable(["操作步骤", "预期结果"], list(p.steps).map((step, index) => [`${index + 1}. ${step.action}`, step.expected]))),
        el("section", "execution-section", el("h4", "", "对应的场景检查项"), ...groups.map(group => el("article", "execution-review-check",
          el("p", "", record ? sceneOf(record, group.id).title || group.id : scene?.title || group.id), el("p", "id-line", group.id),
          procedureTable(["场景检查项", "本用例承担的范围"], group.checks.map(c => [c.criterion, c.scope])))),
          !checks.length ? el("p", "alert", "未记录此用例承担的场景检查项。") : null)) : el("p", "alert", "产出不完整：此用例或人工任务缺少独立的过程说明，不能用场景方案代替。"),
      ...(record && scene ? caseExecutionView(record,scene,item) : []),
      disclosure("association/" + (record?.id || "") + "/" + item.key, "用例定位与方式选择说明", [...technical, section("选择测试方式的理由", binding.reason)])];
  }
  function caseExecutionView(record, scene, item) {
    const result=caseResult(record,scene,item.key);
    if (!result) {
      const empty = section("实际执行", "当前尝试尚未登记该用例的执行结果。");
      empty.dataset.executionSection = "case-execution";
      return [empty];
    }
    const preview=el("div","execution-preview");
    const content = el("section","execution-section case-procedure", el("h4","","实际执行与证据"),badge(result.status),el("p","prose",result.summary),
      ...list(result.step_results).map(row=>el("article","execution-review-check",section("步骤 "+row.step_number,item.procedure?.steps?.[row.step_number-1]?.action),section("实际检查结果",row.actual),
        el("div","links",...list(row.evidence).map(ref=>{const path=artifactReference(record,ref);return path ? button("查看证据 · "+ref.split("/").pop(),()=>showArtifact(preview,{path,kind:fileKind(path)},{view:"trace"})) : el("p","alert","证据引用不可定位");})))),preview);
    content.dataset.executionSection = "case-execution";
    return [content];
  }
  function caseResult(record, scene, key) {
    return list(observationData(record, scene).observation?.case_results || progressOf(record,scene.id).case_results).find(v => v.association_key === key);
  }
  function caseCoverageStatus(record,scene,binding) {
    const verdict=reviewData(record,scene).verdict, review=verdict?.assessment?.case_coverage;
    if (!review) return null;
    const observation=observationData(record,scene).observation, progress=progressOf(record,scene.id);
    const items=list(binding.case_design?.items), rows=list(review.items), tasks=associations(binding), criteria=list(scene.acceptance?.criteria);
    const unique=xs=>new Set(xs).size===xs.length;
    if (review.standard!=="case-design-v1" || binding.case_design?.standard!==review.standard || !observation || verdict.result_sha256!==progress.result_sha256 || !verdict.result_sha256 || JSON.stringify(observation.binding)!==JSON.stringify(binding) ||
      items.length!==criteria.length || !unique(items.map(v=>v.criterion)) || items.some(v=>!criteria.includes(v.criterion)) || rows.length!==items.length || !unique(rows.map(v=>v.criterion))) return "invalid";
    const statuses=[];
    for (const row of rows) {
      const item=items.find(v=>v.criterion===row.criterion); if (!item || !list(item.check_points).length || !unique(item.check_points.map(v=>v.id))) return "invalid";
      const expected=new Set(item.check_points.map(v=>v.id)), covered=new Set();
      for (const c of list(row.contributions)) {
        const task=tasks.find(v=>v.key===c.association_key), points=list(c.covered_point_ids), nums=list(c.step_numbers);
        if (!task || !points.length || points.some(id=>!expected.has(id)) || !nums.length || nums.some(n=>!Number.isInteger(n)||n<1||n>list(task.procedure?.steps).length)) return "invalid";
        if (!list(task.procedure?.scenario_checks).some(v=>v.scenario_id===scene.id && v.criterion===row.criterion && points.every(id=>list(v.covered_point_ids).includes(id)) && nums.every(n=>list(v.step_numbers).includes(n)))) return "invalid";
        points.forEach(id=>covered.add(id));
      }
      const status=covered.size===expected.size ? "covered" : covered.size ? "partial" : "gap";
      if (row.status!==status) return "invalid"; statuses.push(status);
    }
    const status=statuses.length && statuses.every(v=>v==="covered") ? "sufficient" : statuses.length && statuses.every(v=>v==="gap") ? "gap" : "partial";
    return review.status===status ? status : "invalid";
  }
  function caseCoverageView(record, scene, binding) {
    const review = caseCoverageStatus(record,scene,binding)==="invalid" ? null : reviewData(record, scene).verdict?.assessment?.case_coverage;
    const items = list(binding.case_design?.items), tasks = associations(binding);
    const rows = items.map(item => {
      const checked = list(review?.items).find(v => v.criterion === item.criterion);
      const covered = new Set(list(checked?.contributions).flatMap(v => list(v.covered_point_ids)));
      const missing = list(item.check_points).filter(v => !covered.has(v.id));
      const counts = new Map(); list(checked?.contributions).forEach(c => list(c.covered_point_ids).forEach(id => counts.set(id, (counts.get(id)||0)+1)));
      const overlaps = list(item.check_points).filter(v => counts.get(v.id)>1);
      return [el("div", "", el("p", "", item.criterion), checked ? badge(checked.status, {covered:"完整覆盖",partial:"部分覆盖",gap:"未覆盖"}[checked.status]) : el("p", "muted", "待独立审查"),
          checked && missing.length ? section("尚缺检查", missing.map(v=>v.text)) : null, overlaps.length ? section("重复范围（不增加覆盖）", overlaps.map(v=>v.text)) : null),
        section("具体测试项", list(item.check_points).map(v=>v.text)),
        el("div", "", ...list(checked?.contributions).map(c => {
          const task=tasks.find(v=>v.key===c.association_key), preview=el("details", "", el("summary", "", "查看具体检查依据"), el("p", "", c.reason), ...list(c.step_numbers).map(n=>section("步骤 "+n, [task?.procedure?.steps?.[n-1]?.action, "预期结果："+task?.procedure?.steps?.[n-1]?.expected])));
          return el("article", "execution-review-check", task ? entry(record,scene,progressOf(record,scene.id),binding,"association",task.name,{associationKey:task.key}) : el("p","alert","关联用例不可定位"), preview);
        }), !checked ? el("p","muted","已完成准备后，由独立评估核查实现与检查项的对应关系。") : !list(checked.contributions).length ? el("p","alert","缺少对应用例检查") : null)];
    });
    return [section("场景要验证的内容",scene.acceptance?.description), el("p","muted","这里说明测试设计是否完整；覆盖充分不代表已经执行通过。"),
      ...(!items.length ? [el("p","muted","尚未准备本轮用例；进入执行准备时建立具体对应关系。")]:[el("div","case-procedure",procedureTable(["场景检查项及覆盖情况","具体测试项","对应用例及检查依据"],rows))])];
  }
  function caseCoverageBadge(record, scene, progress, binding) {
    const status=caseCoverageStatus(record,scene,binding);
    const label = {sufficient:"用例覆盖充分",partial:"用例部分覆盖",gap:"用例覆盖不足",invalid:"覆盖审查不可核验"}[status] || (associations(binding).length ? "用例覆盖待审查" : "用例尚未设计");
    const b=entry(record,scene,progress,binding,"caseCoverage",label); b.dataset.caseCoverage="true";
    b.className="badge "+(status==="sufficient" ? "good" : "warn"); return b;
  }
  function renderAssociation(record, scene, progress, binding = {}) {
    const items = associations(binding);
    if (!items.length) return el("p", "muted", progress.phase === "not_run" ? "本轮未准备用例" : "尚未确定测试方式");
    return el("div", "execution-associations", ...items.map(v => {
      const result = caseResult(record, scene, v.key);
      const origin = el("span", "badge association-origin", v.kind === "manual" ? "人工" : {existing_case:"已", new_case:"新"}[v.origin] || "？");
      origin.title = v.label;
      origin.setAttribute("aria-label", v.label);
      origin.tabIndex = 0;
      const label = result ? {passed:"通过", failed:"失败", execution_error:"执行异常", blocked:"受阻", unproven:"未证明", not_run:"未执行"}[result.status] || labels[result.status] || result.status : (["pending","preparing"].includes(progress.phase) ? "待执行" : "待记录");
      const status = entry(record, scene, progress, binding, "association", label, {associationKey:v.key, section:"case-execution"});
      status.className = "badge association-status " + (result?.status === "passed" ? "good" : result?.status === "failed" ? "bad" : "warn");
      status.title = `查看此用例的实际执行结果与证据：${v.name}`;
      status.setAttribute("aria-label", `用例${label}：${v.name}`);
      const title = entry(record, scene, progress, binding, "association", v.name, {associationKey:v.key});
      title.className = "association-title";
      return el("div", "execution-association", origin, status, title);
    }));
  }
  const prepLabels = {run_id: "运行", scenario_id: "场景", phase_at_preparation: "准备时阶段", started_at: "开始时间", attempt: "执行尝试", requirements: "关联需求", history_assessment: "历史记录检查", repair_reason: "本次修正原因", implementation_branches: "实现分支", existing_tests_assessment: "已有用例评估", test_layout: "项目用例目录", new_case_code: "是否新增用例代码", generated_inputs: "测试输入记录", positive_control_execution: "正常路径验证状态"};
  async function preparation(container, record, binding) {
    const requestKey = JSON.stringify([record.id, binding]); container.dataset.preparationKey = requestKey;
    container.replaceChildren(section("选择测试方式的理由", binding.reason), section("关联工具或用例", list(binding.cases).map(c => `${c.path} · ${c.selector}`)));
    if (!list(binding.cases).length) container.lastChild.append(el("p", "muted", "本次未关联自动化用例；工具入口见操作方案或原始操作记录。"));
    if (list(binding.cases).length) container.append(el("details", "raw", el("summary", "", "用例命令与版本绑定"), ...binding.cases.map(c => section(c.path, [c.command || "命令未记录", "selector: " + (c.selector || "未记录"), "revision: " + (c.revision || "未记录"), "sha256: " + (c.sha256 || "未记录")], true))));
    const ref = relative(binding.preparation_reference, record.id);
    if (!ref) { container.append(el("p", "muted", "未记录准备文件引用。"), raw(binding, "原始绑定记录")); return; }
    try {
      const response = await fetch("/api/artifact-text/" + ref.split("/").map(encodeURIComponent).join("/"), {cache: "no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (container.dataset.preparationKey !== requestKey) return;
      if (data.truncated) throw new Error("准备文件超过预览限制");
      const value = JSON.parse(data.text);
      for (const [key, label] of Object.entries(prepLabels)) if (value[key] != null) container.append(section(label, typeof value[key] === "string" || Array.isArray(value[key]) ? value[key] : JSON.stringify(value[key], null, 2)));
      const generated = typeof value.generated_inputs === "string" ? binding.preparation_reference.split("/").slice(0, -1).concat(value.generated_inputs).join("/") : null;
      const refs = [...new Set([binding.inputs_reference, generated].filter(v => relative(v, record.id)))];
      if (refs.length) {
        const preview = el("div", "execution-preview");
        container.append(el("h4", "", "输入文件关联"), ...refs.map(ref => button(ref, () => showArtifact(preview, {path: relative(ref, record.id), kind: "text"}, {view: "history"}))), preview);
      }
      container.append(raw(value, "原始准备记录"), raw(binding, "原始绑定记录"));
    } catch (error) { if (container.dataset.preparationKey === requestKey) container.append(el("p", "alert error", "准备记录不可用：" + error.message)); }
  }
  function fileKind(path) { return /\.(png|jpe?g|gif|webp)$/i.test(path) ? "image" : /\.html?$/i.test(path) ? "html" : /\.(json|txt|log|md|csv|js|py)$/i.test(path) ? "text" : "download"; }
  async function collected(container, record, progress) {
    const request = (Number(container.dataset.request) || 0) + 1; container.dataset.request = String(request);
    if (!container.childNodes.length) container.append(el("p", "muted", "正在核对本场景的证据文件…"));
    let files = [], notice = null;
    try {
      const response = await fetch("/api/artifacts?run=" + encodeURIComponent(record.id), {cache: "no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json(); files = list(data.files); notice = list(data.notices).join("\n");
    } catch (error) { notice = "证据目录不可用：" + error.message; }
    if (!container.isConnected || Number(container.dataset.request) !== request) return;
    const groups = evidenceGroups(record.documents["run.json"], progress, files, record.id);
    const signature = JSON.stringify([groups, notice]);
    if (container.dataset.signature === signature) return;
    const previousListing = container.querySelector(".execution-file-list"), previousScroll = previousListing?.scrollTop || 0;
    const preview = container.querySelector(".execution-preview") || el("div", "execution-preview", el("p", "muted", "选择左侧文件，在这里预览证据。"));
    const listing = el("div", "execution-file-list");
    container.dataset.signature = signature;
    container.replaceChildren(...(notice ? [el("p", "alert", notice)] : []), el("div", "execution-evidence-layout", listing, preview));
    if (!groups.some(g => g.items.length)) listing.append(el("p", "muted", "尚未收集证据；没有已登记引用或当前尝试目录中的文件。"));
    groups.forEach(g => {
      if (!g.items.length) return;
      const steps = new Map();
      g.items.forEach(v => {
        const parts = v.path.split("/"), start = parts[0] === "evidence" && parts[1] === progress.scenario_id ? (/^attempt-\d+$/.test(parts[2] || "") ? 3 : 2) : 0;
        const directory = parts.slice(start, -1).join("/");
        const step = v.step ? "操作步骤：" + v.step : "目录分组（步骤未记录）：" + (directory || "证据根目录");
        if (!steps.has(step)) steps.set(step, []);
        steps.get(step).push(v);
      });
      const renderItem = v => {
        const path = artifactReference(record, v.path), existing = files.find(f => f.path === path), kind = existing?.kind || v.kind || fileKind(v.path);
        const open = () => { if (path) { previews.set(record.id + "/" + progress.scenario_id, path); showArtifact(preview, {path, kind}, {view: "history"}); } };
        return el("li", "execution-evidence", el("div", "", path ? button(v.name || v.path.split("/").pop(), open) : el("span", "muted", "引用不在本轮范围内"), el("span", "muted", " · " + ({image: "图片", text: "文本", html: "HTML", download: "文件"})[kind]), !existing ? el("span", "muted", " · 目录清单未包含（可打开引用核对）") : null),
          el("p", "file-label", v.path), el("p", "muted", "操作步骤：" + (v.step || "未记录") + " · 采集时间：" + (v.captured_at || "未记录")), el("p", "prose", "证明判据：" + (v.criterion || "未记录；需打开证据核查")));
      };
      listing.append(el("section", "execution-section", el("h4", "", `尝试 ${g.attempt || "未记录"} · ${g.observed ? g.current ? "本轮结果的执行证据" : "历史尝试的执行证据" : "已落盘，尚未登记为执行结果"} · ${g.items.length} 份文件`), ...[...steps].map(([step, items]) => disclosure(record.id + "/" + progress.scenario_id + "/files/" + g.attempt + "/" + g.observed + "/" + step, step + ` · ${items.length} 份`, [], node => { node.append(el("ul", "", ...items.map(renderItem))); }))));
    });
    listing.scrollTop = previousScroll;
    const path = previews.get(record.id + "/" + progress.scenario_id);
    if (path && groups.some(g => g.items.some(v => artifactReference(record, v.path) === path)) && !preview.querySelector(".artifact-download")) showArtifact(preview, {path, kind: files.find(f => f.path === path)?.kind || fileKind(path)}, {view: "history"});
  }
  function createModal(record, scene, progress, binding, trigger) {
    const dialog = el("dialog", "execution-modal"), heading = el("h2", "", scene.title || "场景执行详情"), context = el("p", "id-line"), live = el("p", "execution-modal-status"), notice = el("div", ""), tabs = el("div", "execution-modal-tabs"), body = el("div", "execution-modal-body");
    heading.id = "execution-modal-title"; dialog.setAttribute("aria-labelledby", heading.id); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "场景执行详情");
    const full = button("全屏", () => { const active = dialog.classList.toggle("is-fullscreen"); full.textContent = active ? "退出全屏" : "全屏"; full.setAttribute("aria-pressed", String(active)); });
    full.setAttribute("aria-pressed", "false");
    const close = button("关闭", () => dialog.close());
    dialog.append(el("div", "execution-modal-header", el("div", "", heading, context, live), el("div", "execution-modal-actions", full, close)), tabs, notice, body);
    modal = {dialog, heading, associationKey: trigger?.dataset.associationKey, caseCoverage: trigger?.dataset.caseCoverage, context, live, notice, tabs, body, record, scene, progress, binding, bindingAttempt: progress.attempt, active: null, panes: {}, signatures: {}, scrolls: {}, key: record.id + "/" + scene.id, returnScroll: window.scrollY, trigger, overflow: document.body.style.overflow};
    const items = modal.associationKey || modal.caseCoverage ? [] : [["review", "独立评估"]];
    tabs.hidden = !items.length;
    items.forEach(([id, label], index) => {
      const tab = button(label, () => selectTab(id)); tab.id = "execution-tab-" + id; tab.dataset.tab = id; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "execution-pane-" + id);
      tab.addEventListener("keydown", event => {
        let next;
        if (["ArrowRight", "ArrowLeft"].includes(event.key)) next = (index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
        else if (event.key === "Home") next = 0; else if (event.key === "End") next = items.length - 1; else return;
        event.preventDefault(); selectTab(items[next][0]); tabs.children[next].focus();
      });
      tabs.append(tab);
    });
    dialog.addEventListener("close", () => {
      const previous = modal; if (!previous || previous.dialog !== dialog) return;
      document.body.style.overflow = previous.overflow;
      modal = null; dialog.remove();
      const originalEntry = previous.trigger?.dataset.executionEntry;
      const replacement = [...document.querySelectorAll("[data-execution-key]")].find(v => v.dataset.executionKey === previous.key && (originalEntry ? v.dataset.executionEntry === originalEntry : v.dataset.executionTab === previous.active));
      const focus = previous.trigger?.isConnected ? previous.trigger : replacement;
      focus?.focus({preventScroll: true}); window.scrollTo({top: previous.returnScroll});
    });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog); document.body.style.overflow = "hidden"; dialog.showModal();
    if (trigger?.dataset.resultKind === "execution") notice.append(el("p", "muted result-origin", reviewData(record, scene).verdict ? "你点击的是执行者记录的结果；最终通过或 BUG 由独立评估认定。" : "当前尚未独立评估；这里是执行者记录的事实，不能据此认定最终通过或产品 BUG。"));
    updateHeader();
  }
  function updateHeader() {
    const m = modal;
    m.heading.textContent = m.associationKey ? associations(m.binding).find(v => v.key === m.associationKey)?.name || "用例关联不可用" : m.scene.title || "场景执行详情";
    m.context.textContent = `${m.associationKey ? (m.scene.title || m.scene.id) + " · " : ""}${m.scene.id}`;
    m.live.textContent = m.progress.legacy ? `历史记录 · 阶段未记录 · 尝试 ${m.progress.attempt || "未记录"} · 台账版本：${labels[m.record.ledger_match] || "未确认"}` : `当前尝试 ${m.progress.attempt || "未记录"} · ${phaseNames[m.progress.phase] || m.progress.phase || "阶段未记录"} · 台账版本：${labels[m.record.ledger_match] || "未确认"}${m.bindingAttempt !== m.progress.attempt ? ` · 当前方案记录来自尝试 ${m.bindingAttempt || "未记录"}` : ""}`;
  }
  function selectTab(id) {
    if (!modal) return;
    const m = modal;
    if (m.active) m.scrolls[m.active] = m.body.scrollTop;
    m.active = id;
    [...m.tabs.children].forEach(tab => { const selected = tab.dataset.tab === id; tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1; });
    if (!m.panes[id]) { const pane = el("div", "execution-modal-pane"); pane.id = "execution-pane-" + id; pane.setAttribute("role", m.associationKey || m.caseCoverage ? "region" : "tabpanel"); pane.setAttribute("aria-labelledby", m.associationKey || m.caseCoverage ? "execution-modal-title" : "execution-tab-" + id); pane.tabIndex = 0; m.panes[id] = pane; m.body.append(pane); }
    Object.entries(m.panes).forEach(([name, pane]) => { pane.hidden = name !== id; });
    m.body.classList.toggle("show-evidence", id === "evidence");
    refreshPane(); m.body.scrollTop = m.scrolls[id] || 0;
  }
  function refreshPane() {
    const m = modal, id = m.active, pane = m.panes[id];
    const signature = JSON.stringify(id === "review" ? [reviewData(m.record, m.scene), m.progress.reviewStatus, m.record.ledger_match] : id === "observation" ? [observationData(m.record, m.scene), m.progress.legacy, m.progress.recordStatus, m.record.ledger_match, m.scene] : [m.binding, id === "association" || id === "caseCoverage" ? [m.associationKey, m.record.documents?.["run.json"]] : id === "plan" ? plan(m.record, m.scene, m.binding) : null]);
    if (id === "evidence") { collected(pane, m.record, m.progress); return; }
    if (m.signatures[id] === signature) return;
    m.signatures[id] = signature;
    const scroll = m.body.scrollTop;
    if (id === "association") pane.replaceChildren(...associationView(m.binding, m.associationKey, m.scene, m.record));
    else if (id === "caseCoverage") pane.replaceChildren(...caseCoverageView(m.record,m.scene,m.binding));
    else if (id === "plan") pane.replaceChildren(...planView(m.record, m.scene, m.binding));
    else if (id === "review") pane.replaceChildren(...reviewView(m.record, m.scene, m.progress));
    else if (id === "observation") pane.replaceChildren(...observationView(m.record, m.scene, m.progress));
    else preparation(pane, m.record, m.binding).then(() => { if (modal === m && m.active === id) m.body.scrollTop = scroll; });
    m.body.scrollTop = scroll;
  }
  function open(record, scene, progress, binding, tab, trigger) {
    if (modal) modal.dialog.close();
    createModal(record, scene, progress, binding, trigger); selectTab(tab);
    (modal.tabs.querySelector(`[data-tab="${tab}"]`) || modal.panes[tab]).focus();
  }
  function sync(data) {
    if (!modal) return;
    const m = modal, record = list(data?.runs).find(r => r.id === m.record.id);
    const legacyItem = record && record.documents?.["run.json"]?.execution_schema !== 2 ? AcceptanceTrace.legacyProgress(data, record).items.find(v => v.scenario_id === m.scene.id) : null;
    const progress = record && (record.documents?.["run.json"]?.execution_schema === 2 || legacyItem) ? progressOf(record, m.scene.id, legacyItem) : null;
    if (!progress) { m.notice.replaceChildren(el("p", "alert error", "当前记录不可核验；以下保留上次读取的详情，不作为最新状态。")); return; }
    m.notice.replaceChildren(); m.record = record; m.progress = progress;
    const binding = progress.binding || list(record.documents["run.json"].results).find(v => v.scenario_id === m.scene.id)?.binding;
    if (binding) { m.binding = binding; m.bindingAttempt = progress.attempt; }
    else if (m.associationKey) { m.binding = {}; m.bindingAttempt = progress.attempt; }
    updateHeader(); refreshPane();
  }
  function entry(record, scene, progress, binding, tab, label, target) {
    const b = button(label, () => {
      open(record, scene, progress, binding || {}, tab, b);
      if (target?.section) {
        const candidates = [...modal.panes[tab].querySelectorAll("[data-execution-section]")].filter(node => node.dataset.executionSection === target.section && (target.attempt == null || node.dataset.attempt === String(target.attempt)));
        const node = candidates.at(-1);
        if (node) { if (node.tagName === "DETAILS") node.open = true; node.scrollIntoView({block: "start"}); }
      }
    });
    if (target?.associationKey) b.dataset.associationKey = target.associationKey;
    b.dataset.executionKey = record.id + "/" + scene.id; b.dataset.executionTab = tab; b.dataset.executionEntry = [tab, label, target?.section || "", target?.attempt ?? "", target?.associationKey || ""].join("/"); b.setAttribute("aria-haspopup", "dialog"); return b;
  }
  function renderScene(record, scene, progress, binding) {
    return el("div", "execution-scene", priorityBadge(scene, record), entry(record, scene, progress, binding, "observation", scene.title || "场景标题未记录"), el("p", "id-line", scene.id));
  }
  function renderPhase(record, progress, scene, binding) {
    if (progress.legacy) return el("div", "", el("p", "muted", "旧记录未提供阶段"), progress.attempt ? el("p", "muted", `第 ${progress.attempt} 次尝试`) : null);
    const count = observationData(record, scene).repairs.length;
    return el("div", "execution-phase", el("p", "", phaseNames[progress.phase] || "阶段未记录"), progress.attempt ? el("p", "muted", `第 ${progress.attempt} 次尝试`) : null,
      count ? el("p", "muted", progress.phase === "preparing" ? "修正执行问题中" : `修正记录 ${count} 次`) : null,
      count ? entry(record, scene, progress, binding, "observation", "查看修正记录", {section: "repair"}) : null);
  }
  function resultLabel(record, scene, progress, binding, status, label, kind) {
    const finalReview = reviewData(record, scene).verdict;
    const tab = kind === "independent" || finalReview ? "review" : "observation";
    const b = entry(record, scene, progress, binding, tab, label);
    b.className = "badge result-label " + (status === "passed" ? "good" : status === "failed" ? "bad" : "warn");
    b.dataset.resultKind = kind;
    b.title = kind === "execution" ? "查看执行结果及独立判定说明" : "查看最终判定及依据";
    return b;
  }
  function renderObservation(record, scene, progress, binding) {
    const data = observationData(record, scene);
    if (!data.observation) return el("p", "muted", "尚无结果");
    return el("div", "execution-review-summary", resultLabel(record, scene, progress, binding, progress.legacy ? progress.recordStatus || data.observation.status : data.observation.status, labels[data.observation.status] || data.observation.status, "execution"),
      el("p", data.observation.summary ? "execution-summary" : "execution-summary alert", data.observation.status === "not_run" ? data.observation.summary || "本轮未执行，原因见详情。" : data.summary),
      entry(record, scene, progress, binding, "observation", "查看执行详情"));
  }
  function renderEvidence(record, scene, progress, binding) {
    const count = list(observationData(record, scene).observation?.evidence).length;
    return el("div", "", el("p", "muted", `${count} 份登记证据`), entry(record, scene, progress, binding, "evidence", "查看证据"));
  }
  function render(record, scene, progress, binding) {
    const summary = binding.summary || "产出不完整：缺少操作方案摘要。";
    const link = (id, label) => entry(record, scene, progress, binding, id, label);
    return el("div", "execution-binding", el("p", "execution-mode", modes[binding.mode] || binding.mode), el("p", binding.summary ? "execution-summary" : "execution-summary alert", summary),
      el("div", "execution-entry-links", link("plan", "查看操作方案"), link("preparation", "准备记录"), link("evidence", "已收集证据")));
  }
  function renderReview(record, scene, progress, binding) {
    const data = reviewData(record, scene);
    if (!data.verdict) return el("p", "muted", "尚未评估");
    return el("div", "execution-review-summary", resultLabel(record, scene, progress, binding, data.verdict.status, (progress.legacy ? "原始评估：" : "") + (verdictNames[data.verdict.status] || data.verdict.status), "independent"),
      progress.legacy ? el("p", "", "当前核验：", badge(progress.reviewStatus)) : null, el("p", data.verdict.summary ? "execution-summary" : "execution-summary alert", data.summary));
  }
  const api = {caseCoverageStatus, caseResult, caseCoverageView, caseCoverageBadge, caseScopes, associations, associationView, renderAssociation, reviewSections, resultLabel, plan, relative, evidenceGroups, reviewData, sceneOf, progressOf, orderedProgress, phaseCounts, observationData, artifactReference, entry, renderScene, renderPhase, renderObservation, renderEvidence, render, renderReview, sync};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExecutionView = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
