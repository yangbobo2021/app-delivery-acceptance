/* Read-only joins and counts shared by the dashboard and trace views. */
(function (root) {
  "use strict";
  const array = value => Array.isArray(value) ? value : [];
  const rows = value => array(value?.items).filter(v => v && typeof v === "object" && !Array.isArray(v));
  const ids = value => [...new Set(array(value).filter(v => typeof v === "string" && v))];
  const present = value => typeof value === "string" && value.trim().length > 0;
  const counts = keys => Object.fromEntries(keys.map(key => [key, 0]));

  const hasAcceptance = scene => scene?.acceptance && present(scene.acceptance.description) && ["preconditions", "actions", "criteria", "evidence_expected"].every(k => Array.isArray(scene.acceptance[k]) && scene.acceptance[k].length && scene.acceptance[k].every(present));

  function checkCoverage(data, cover, result, requirementId) {
    const rawPoints = array(cover?.check_points), points = rawPoints.filter(p => p && typeof p === "object" && !Array.isArray(p)), pointIds = ids(points.map(p => p.id));
    const contributions = array(result?.scenario_coverage), scenes = rows(data.documents?.["scenarios.json"]);
    const sceneIds = ids(contributions.map(c => c?.scenario_id)), coverage = new Map(pointIds.map(id => [id, new Set()]));
    let valid = !!result && points.length > 0 && points.length === rawPoints.length && pointIds.length === points.length && points.every(p => present(p?.text)) &&
      present(cover?.identification_basis) && result.coverage_id === cover.id && present(result.reason) &&
      Array.isArray(result.scenario_coverage) && sceneIds.length === contributions.length;
    for (const contribution of contributions) {
      const scene = scenes.find(s => s.id === contribution?.scenario_id), covered = ids(contribution?.covered_point_ids);
      if (!scene || !hasAcceptance(scene) || !sceneLinks(scene).includes(requirementId) || !array(cover?.scenario_ids).includes(scene.id) ||
        !covered.length || covered.length !== array(contribution?.covered_point_ids).length || covered.some(p => !pointIds.includes(p)) || !present(contribution?.reason)) valid = false;
      covered.forEach(id => coverage.get(id)?.add(contribution.scenario_id));
    }
    const covered = points.filter(p => coverage.get(p.id)?.size), missing = points.filter(p => !coverage.get(p.id)?.size);
    const overlap = points.filter(p => coverage.get(p.id)?.size > 1);
    const aggregate = covered.length === points.length && points.length ? "covered" : covered.length ? "partial" : "gap";
    if (result?.status !== aggregate) valid = false;
    return {status: valid ? aggregate : "unavailable", covered, missing, overlap, scene_ids: sceneIds};
  }

  function designStatus(data, item) {
    if (data.scope_status?.status === "invalid") return "unavailable";
    if (!item) return "unreviewed";
    if (data.review_freshness?.status === "stale") return "stale";
    if (data.review_freshness?.status !== "current") return "unavailable";
    if (item.verdict === "sufficient" && data.current_check?.gates?.coverage_review?.status === "blocked") {
      // Another requirement's gap must not erase this requirement's valid review.
      const design = data.documents?.["scenarios.json"] || {}, review = data.documents?.["coverage_review.json"] || {};
      const basis = array(design.design_basis).find(b => b?.requirement_id === item.requirement_id);
      const expected = ids(array(basis?.coverage_items).map(c => c?.id));
      const actual = array(item.coverage_results), criteria = array(item.criteria_checks);
      const required = ["requirement_alignment", "coverage_completeness", "method_discrimination", "fault_detection", "scope_boundaries"];
      if (!["design-quality-v3", "design-quality-v4"].includes(design.design_standard) || review.design_standard !== design.design_standard || !expected.length ||
        actual.length !== expected.length || ids(actual.map(c => c?.coverage_id)).length !== expected.length ||
        actual.some(c => !expected.includes(c?.coverage_id) || checkCoverage(data, array(basis.coverage_items).find(b => b.id === c.coverage_id), c, item.requirement_id).status !== "covered") ||
        criteria.length !== required.length || ids(criteria.map(c => c?.criterion)).length !== required.length ||
        criteria.some(c => !required.includes(c?.criterion) || c.status !== "passed" || !present(c.reason)) ||
        !Array.isArray(item.findings) || item.findings.some(f => f?.kind !== "suggestion")) return "unavailable";
    }
    return ["sufficient", "gap", "needs_clarification"].includes(item.verdict) ? item.verdict : "unreviewed";
  }

  function execution(data, record, scenario) {
    const run = record?.documents?.["run.json"] || {};
    const review = record?.documents?.["review.json"] || {};
    const matches = array(run.results).filter(v => v?.scenario_id === scenario.id);
    const reviews = array(run.execution_schema === 2 ? run.scenario_reviews : review.results).filter(v => v?.scenario_id === scenario.id);
    const result = matches.length === 1 ? matches[0] : null;
    const evidenceReview = reviews.length === 1 ? reviews[0] : null;
    const status = !record || !matches.length ? "not_executed" : matches.length !== 1 ? "invalid" :
      result.status === "not_run" ? "not_executed" : ["passed", "failed", "blocked", "unproven", "execution_error"].includes(result.status) ? result.status : "invalid";
    const issues = [];
    if (record?.ledger_match !== "current") issues.push("运行与当前台账的版本未确认一致");
    if (!result || !present(result.actual)) issues.push("缺少唯一的执行结果或实际观察");
    const evidence = ids(result?.evidence), cited = ids(evidenceReview?.evidence);
    if (!evidence.length) issues.push("缺少执行证据引用");
    if (!present(run.revision) || (run.execution_schema !== 2 && review.revision !== run.revision)) issues.push("证据审查与执行修订不一致");
    if (!["playbook", "independent_ai"].includes((run.execution_schema === 2 ? evidenceReview : review)?.reviewer_kind) || !present((run.execution_schema === 2 ? evidenceReview : review)?.review_reference)) issues.push("缺少独立证据审查来源");
    if (!evidenceReview || !present(evidenceReview.reason)) issues.push("缺少唯一且有理由的证据审查");
    if (!cited.length || cited.some(ref => !evidence.includes(ref))) issues.push("审查未引用此场景的执行证据");
    let reviewStatus = "unreviewed";
    if (reviews.length > 1) reviewStatus = "invalid";
    else if (evidenceReview?.status === "failed") reviewStatus = "failed";
    else if (evidenceReview?.status === "execution_error") reviewStatus = "execution_error";
    else if (evidenceReview?.status === "blocked") reviewStatus = "blocked";
    else if (evidenceReview?.status === "unproven") reviewStatus = "unproven";
    else if (evidenceReview?.status === "passed") reviewStatus = status === "passed" && !issues.length ? "reviewed" : "unproven";
    return { status, reviewStatus, result, evidenceReview, issues, evidence, cited };
  }

  const priorities = ["P0", "P1", "P2", "P3"];
  const priorityOf = scenario => priorities.includes(scenario.priority) ? scenario.priority : "unclassified";
  const ordered = scenarios => [...scenarios].sort((a, b) => [...priorities, "unclassified"].indexOf(priorityOf(a)) - [...priorities, "unclassified"].indexOf(priorityOf(b)));
  const gradeReasons = {P0: "本轮核心业务闭环无法完成，或可能造成严重数据损失、资金损失、权限失效及信息泄露，优先执行；失败后可修复或调整有效配置不构成降级理由。", P1: "主要功能的其他重要分支、常用操作或恢复过程失败，明显影响用户；先排除核心闭环阻断和重大风险，紧随 P0 执行。", P2: "次要或较少使用的功能受影响，存在可接受的替代办法，在 P0/P1 后执行。", P3: "轻微体验问题或影响较小的边界组合，最后执行或按需专项检查。"};
  function priorityBasis(scenario, documents = {}) {
    const priority = priorityOf(scenario), review = documents["coverage_review.json"] || {};
    if (!scenario.id) return {priority, reason: gradeReasons[priority] || "尚未分级，不能推断重要度。", source: "等级标准", notes: []};
    const judgments = array(scenario.kind === "white_box" ? review.white_box_priority_review?.items : review.priority_reviews).filter(r => r?.scenario_id === scenario.id);
    if (judgments.length === 1 && present(judgments[0].reason)) {
      const record = judgments[0], notes = [];
      if (record.priority !== scenario.priority) notes.push(`审查记录为 ${record.priority || "未记录等级"}，与此场景等级不同。`);
      if (record.verdict === "gap") notes.push("独立审查认为此分级存在问题。");
      return {priority, reason: record.reason, source: "独立分级审查原因", notes};
    }
    return {priority, reason: present(scenario.priority_reason) ? scenario.priority_reason : "此场景尚未记录分级理由。", source: "场景分级理由", notes: judgments.length > 1 ? ["存在多条分级审查记录，无法唯一确认。"] : []};
  }

  function prioritySummary(data, record, latest = null) {
    const scenarios = ordered(rows(data.documents?.["scenarios.json"]));
    const byPriority = Object.fromEntries([...priorities, "unclassified"].map(p => [p, { total: 0, passed: 0, reviewed: 0, failed: 0, blocked: 0, unproven: 0, not_executed: 0, invalid: 0, execution_error: 0 }]));
    const remainingRisks = [];
    for (const scenario of scenarios) {
      const value = execution(data, latest ? latest.get(scenario.id)?.record : record, scenario), priority = priorityOf(scenario), stats = byPriority[priority];
      stats.total++; stats[value.status]++;
      if (value.reviewStatus === "reviewed") stats.reviewed++;
      else remainingRisks.push({ scenario, priority, ...value });
    }
    return { byPriority, remainingRisks, p0RiskUnresolved: remainingRisks.some(v => v.priority === "P0") };
  }

  const ruleRows = data => rows(data.documents?.["white_box_rules.json"]).map(r => ({...r, source_type:"white_box_reverse", package:"白盒逆向规则"}));
  const sceneLinks = scene => [...ids(scene.requirement_ids), ...ids(scene.reverse_rule_ids)];
  function ruleReview(data, id) { return array(data.documents?.["coverage_review.json"]?.white_box_priority_review?.rule_reviews).find(r => r?.rule_id === id); }
  const ruleConfirmation = rule => ["supported", "confirmed", "needs_confirmation"].includes(rule?.status) ? rule.status : "unavailable";
  const whiteDesignBasis = (data, id) => array(data.documents?.["white_box_rules.json"]?.design_basis).find(b => b?.requirement_id === id);
  const whiteDesignReview = (data, id) => array(data.documents?.["coverage_review.json"]?.white_box_priority_review?.design_reviews).find(r => r?.requirement_id === id);
  function whiteDesignStatus(data, id) {
    if (!whiteDesignReview(data,id)) { const attempted = data.documents?.["coverage_review.json"]?.white_box_priority_review; return attempted?.status === "passed" || array(attempted?.rule_reviews).length ? "unavailable" : "unreviewed"; }
    const freshness = data.white_box_rule_freshness?.status;
    if (freshness !== "current") return freshness === "stale" ? "stale" : "unavailable";
    const document = data.documents?.["white_box_rules.json"], reviewDocument = data.documents?.["coverage_review.json"]?.white_box_priority_review;
    const basis = whiteDesignBasis(data, id), record = whiteDesignReview(data, id), covers = array(basis?.coverage_items), results = array(record?.coverage_results);
    const criteria = array(record?.criteria_checks), required = ["requirement_alignment", "coverage_completeness", "method_discrimination", "fault_detection", "scope_boundaries"];
    if (!["design-quality-v3", "design-quality-v4"].includes(document?.design_standard) || reviewDocument?.design_standard !== document.design_standard || !covers.length ||
        covers.length !== ids(covers.map(c => c?.id)).length || results.length !== covers.length || ids(results.map(c => c?.coverage_id)).length !== covers.length ||
        criteria.length !== required.length || ids(criteria.map(c => c?.criterion)).length !== required.length ||
        criteria.some(c => !required.includes(c?.criterion) || !["passed", "gap", "needs_clarification"].includes(c.status) || !present(c.reason)) ||
        !present(record?.reason) || !Array.isArray(record?.findings)) return "unavailable";
    const coverage = covers.map(c => checkCoverage(data, c, results.find(r => r.coverage_id === c.id), id));
    if (coverage.some(c => c.status === "unavailable")) return "unavailable";
    if (record.verdict === "sufficient") return coverage.every(c => c.status === "covered") && criteria.every(c => c.status === "passed") && record.findings.every(f => f?.kind === "suggestion") ? "sufficient" : "unavailable";
    return ["gap", "needs_clarification"].includes(record.verdict) ? record.verdict : "unavailable";
  }
  function ruleStatus(data, rule) { return whiteDesignStatus(data, rule.id); }
  // Select each scene independently. Pending/not_run entries and snapshots are
  // plans, not executions; they must not erase an earlier actual execution.
  // Never prefer a pass or a current ledger over a newer failure/stale record.
  function latestExecutions(data) {
    const latest = new Map();
    const parsed = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
    for (const record of array(data.runs)) {
      const run = record.documents?.["run.json"] || {}, scenes = new Map();
      const add = (name, entries) => {
        for (const entry of array(entries)) {
          if (!present(entry?.scenario_id)) continue;
          if (!scenes.has(entry.scenario_id)) scenes.set(entry.scenario_id, {results: [], progress: [], history: []});
          scenes.get(entry.scenario_id)[name].push(entry);
        }
      };
      add("results", run.results); add("progress", run.progress); add("history", run.attempt_history);
      for (const [id, entries] of scenes) {
        const observations = entries.results.filter(r => r.status !== "not_run");
        const progress = entries.progress[0];
        const hasHistory = entries.history.some(h => h.observation && h.observation.status !== "not_run");
        const active = progress && ["executing", "evaluating", "completed"].includes(progress.phase);
        if (!observations.length && !active && !hasHistory) continue;
        const times = [...observations, ...array(progress?.case_results)].map(r => parsed(r.observed_at)).filter(v => v !== null);
        const historyTimes = entries.history.map(h => parsed(h.observation?.observed_at)).filter(v => v !== null);
        const timestamp = times.length ? Math.max(...times) : historyTimes.length ? Math.max(...historyTimes)
          : parsed(progress?.started_at) ?? parsed(run.created_at) ?? parsed(run.updated_at) ?? 0;
        const previous = latest.get(id);
        // Equal/missing times preserve the supplied order; directory IDs are not clocks.
        if (!previous || timestamp > previous.timestamp) latest.set(id, {record, timestamp, timeKnown: timestamp !== 0});
      }
    }
    return latest;
  }
  function buildLatest(data) { return build(data, "", latestExecutions(data)); }
  function build(data, runId = "", latest = null) {
    const documents = data.documents || {};
    const requirements = rows(documents["requirements.json"]);
    const designStage = documents["source-analysis.json"]?.stage;
    const scenarios = rows(documents["scenarios.json"]).filter(s => designStage === "white-box" ? s.kind === "white_box" : designStage === "acceptance" ? ["black_box","white_box"].includes(s.kind) : s.kind === "black_box");
    const reviews = rows(documents["coverage_review.json"]);
    const reviewMap = new Map(reviews.map(r => [r.requirement_id, r]));
    const reqMap = new Map(requirements.map(r => [r.id, r]));
    const record = array(data.runs).find(r => r.id === runId) || null;
    const sceneExecution = scene => ({...execution(data, latest ? latest.get(scene.id)?.record : record, scene),
      record: latest ? latest.get(scene.id)?.record || null : record});
    const scopePlan = documents["acceptance-plan.json"];
    const selectedIds = scopePlan ? new Set(array(scopePlan.checks).filter(c=>c.disposition === "included").map(c=>c.requirement_id)) : new Set(requirements.map(r=>r.id));
    const requirementStats = { total: selectedIds.size, linked: 0, unlinked: 0, sufficient: 0, gap: 0, needs_clarification: 0, unreviewed: 0, stale: 0, unavailable: 0 };
    if (scopePlan) Object.assign(requirementStats, {original_total:requirements.length, outside_scope:requirements.filter(r=>!selectedIds.has(r.id)).length});
    const executionStats = counts(["passed", "failed", "blocked", "unproven", "not_executed", "invalid", "execution_error"]);
    const evidenceStats = counts(["reviewed", "failed", "blocked", "unproven", "unreviewed", "invalid", "execution_error"]);
    const faults = [], edges = new Set();
    const byScenario = new Map();
    for (const scenario of scenarios) {
      for (const id of ids(scenario.requirement_ids)) {
        if (reqMap.has(id)) edges.add(JSON.stringify([id, scenario.id]));
        else faults.push(`场景 ${scenario.id} → 不存在的需求 ${id}`);
      }
      if (!hasAcceptance(scenario)) faults.push(`场景 ${scenario.id} 缺少验收说明`);
      const result = sceneExecution(scenario);
      byScenario.set(scenario.id, result);
      executionStats[result.status]++;
      evidenceStats[result.reviewStatus]++;
    }
    const entries = requirements.map(requirement => {
      const linked = scenarios.filter(s => ids(s.requirement_ids).includes(requirement.id));
      const review = designStage === "white-box" ? whiteDesignReview(data,requirement.id) : reviewMap.get(requirement.id);
      const admitted = selectedIds.has(requirement.id);
      const status = admitted ? (designStage === "white-box" ? whiteDesignStatus(data,requirement.id) : designStatus(data, review)) : "out_of_scope";
      if (admitted) { requirementStats[linked.length ? "linked" : "unlinked"]++; requirementStats[status]++; }
      const pkg = requirement.package || String(requirement.id || "未分类").replace(/-\d+$/, "");
      return { requirement, scenarios: linked, review, status, admitted, package: pkg,
        executed: linked.filter(s => byScenario.get(s.id).status !== "not_executed").length,
        reviewed: linked.filter(s => byScenario.get(s.id).reviewStatus === "reviewed").length };
    });
    const reverseRules = ruleRows(data);
    for (const rule of reverseRules) {
      const linked = rows(documents["scenarios.json"]).filter(s => s.kind === "white_box" && ids(s.reverse_rule_ids).includes(rule.id));
      entries.push({requirement:rule, scenarios:linked, review:ruleReview(data,rule.id), status:rule.applicability?.status === "out_of_scope" || rule.applicability?.status === "pending" ? "out_of_scope" : ruleStatus(data,rule), admitted:!["out_of_scope","pending"].includes(rule.applicability?.status), confirmation_status:ruleConfirmation(rule), package:rule.package,
        executed:linked.filter(s => sceneExecution(s).status !== "not_executed").length,
        reviewed:linked.filter(s => sceneExecution(s).reviewStatus === "reviewed").length});
      for (const scene of linked) byScenario.set(scene.id, sceneExecution(scene));
    }
    const packages = [...new Set(entries.map(e => e.package))].sort().map(name => {
      const items = entries.filter(e => e.package === name);
      const scenarioIds = new Set(items.flatMap(e => e.scenarios.map(s => s.id)));
      return { name, requirements: items.filter(e=>e.admitted !== false).length, linked: items.filter(e => e.admitted !== false && e.scenarios.length).length,
        sufficient: items.filter(e => e.status === "sufficient").length,
        attention: items.filter(e => e.admitted !== false && (!e.scenarios.length || e.status !== "sufficient")).length,
        scenarios: scenarioIds.size,
        executed: [...scenarioIds].filter(id => byScenario.get(id).status !== "not_executed").length,
        reviewed: [...scenarioIds].filter(id => byScenario.get(id).reviewStatus === "reviewed").length };
    });
    return { requirements, reverseRules, scenarios, entries, packages, record, latest, requirementStats, executionStats, evidenceStats,
      byScenario, faults, edges: edges.size };
  }
  function historyRuns(data) {
    const stamp = record => Date.parse(record.documents?.["run.json"]?.created_at) || 0;
    return [...array(data.runs)].sort((a, b) =>
      Number(b.documents?.["run.json"]?.lifecycle === "running") -
      Number(a.documents?.["run.json"]?.lifecycle === "running") || stamp(b) - stamp(a));
  }

  function selectedRun(data, selected = "", automatic = true) {
    if (!automatic) return array(data.runs).find(r => r.id === selected) || null;
    const stamp = r => Date.parse(r.documents?.["run.json"]?.created_at) || Date.parse(r.documents?.["run.json"]?.updated_at) || 0;
    return [...array(data.runs)].sort((a, b) => Number(b.documents?.["run.json"]?.lifecycle === "running") - Number(a.documents?.["run.json"]?.lifecycle === "running") || stamp(b) - stamp(a))[0] || null;
  }

  function legacyProgress(data, record) {
    const docs = record.documents || {}, run = docs["run.json"] || {};
    const snapshot = docs["scenarios.snapshot.json"];
    const planIds = ids(docs["execution-plan.json"]?.ordered_scenario_ids);
    const definitions = Array.isArray(snapshot?.items) ? rows(snapshot)
      : record.ledger_match === "current" ? rows(data.documents?.["scenarios.json"]) : [];
    const definitionIds = definitions.map(s => s.id);
    const observedIds = array(run.results).map(r => r?.scenario_id);
    const reviewIds = array(docs["review.json"]?.results).map(r => r?.scenario_id);
    const scenarioIds = ids([...planIds, ...definitionIds, ...observedIds, ...reviewIds]);
    const items = scenarioIds.map(id => {
      const scenario = definitions.find(s => s.id === id) || { id };
      const value = execution(data, record, scenario);
      const observations = array(run.results).filter(r => r?.scenario_id === id);
      return { scenario_id: id, ...value, hasResult: observations.length > 0,
        explicitNotRun: observations.length === 1 && observations[0].status === "not_run" };
    });
    return { items, total: items.length, recorded: items.filter(v => v.hasResult && !v.explicitNotRun).length,
      missing: items.filter(v => !v.hasResult).length, notRun: items.filter(v => v.explicitNotRun).length,
      reviewRecorded: items.filter(v => v.evidenceReview).length,
      reviewed: items.filter(v => v.reviewStatus === "reviewed").length,
      scopeKnown: Array.isArray(snapshot?.items) || planIds.length > 0 || record.ledger_match === "current" };
  }
  const api = { whiteDesignBasis, whiteDesignReview, whiteDesignStatus, ruleRows, sceneLinks, ruleReview, ruleStatus, ruleConfirmation, priorityBasis, selectedRun, build, buildLatest, latestExecutions, execution, designStatus, checkCoverage, prioritySummary, priorityOf, ordered, historyRuns, legacyProgress };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AcceptanceTrace = api;
})(typeof window !== "undefined" ? window : null);
