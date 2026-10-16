/* Portable report model. No coverage collection, project-specific paths or gate approval. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoverageView = factory();
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const object = x => x && typeof x === "object" && !Array.isArray(x) ? x : {};
  const list = x => Array.isArray(x) ? x : [];
  const kinds = ["lines", "branches", "functions", "statements"];
  const hash = x => typeof x === "string" && /^[a-f0-9]{64}$/i.test(x);
  const revision = x => typeof x === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(x);
  const environment = x => typeof x === "string" ? Boolean(x.trim()) : Boolean(x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length);
  const inputNames = ["project.json", "requirements.json", "resources.json", "scenarios.json", "coverage_review.json"];
  const canonical = x => JSON.stringify(normalize(x));
  function normalize(x) {
    if (Array.isArray(x)) return x.map(normalize);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map(k => [k, normalize(x[k])]));
    return x;
  }
  function counter(x) {
    x = object(x);
    if (!Number.isSafeInteger(x.covered) || !Number.isSafeInteger(x.total) || x.covered < 0 || x.covered > x.total) return null;
    return { covered: x.covered, total: x.total, percent: x.total ? 100 * x.covered / x.total : null };
  }
  function analyze(record) {
    record = object(record);
    const documents = object(record.documents), run = object(documents["run.json"]);
    const mode = Object.prototype.hasOwnProperty.call(run, "acceptance_mode") ? run.acceptance_mode : "standard";
    if (mode !== "coverage") return { enabled: false, mode, issues: mode === "standard" ? [] : ["未知验收模式"], sources: [], totals: {} };
    const measurement = object(documents["code-coverage/measurement.json"]), review = object(documents["code-coverage/review.json"]);
    const issues = [], sources = [], seen = new Set();
    if (measurement.status !== "measured") issues.push("尚无有效测量记录（状态须为 measured）");
    if (!environment(measurement.environment)) issues.push("测量环境未记录或无效");
    for (const raw of list(measurement.sources)) {
      const source = object(raw), metrics = {};
      if (typeof source.path !== "string" || !source.path || seen.has(source.path)) issues.push("源文件路径缺失或重复");
      if (typeof source.path !== "string" || source.path.startsWith("/") || source.path.includes("\\") || source.path.includes(":") || source.path.split("/").some(p => !p || p === "." || p === "..")) issues.push("源文件路径不是规范的项目相对路径");
      seen.add(source.path);
      if (!hash(source.sha256)) issues.push(`源文件哈希无效：${source.path || "未记录"}`);
      for (const kind of kinds) {
        if (kind in object(source.metrics) || ["lines", "branches"].includes(kind)) {
          metrics[kind] = counter(object(source.metrics)[kind]);
          if (!metrics[kind]) issues.push(`计数无效：${source.path || "未记录"} / ${kind}`);
        }
      }
      sources.push({ ...source, metrics });
    }
    if (!sources.length) issues.push("尚无源文件计数");
    const totals = {};
    for (const kind of kinds) {
      const counted = sources.filter(s => kind in s.metrics);
      const valid = counted.length && counted.every(s => s.metrics[kind]) && new Set(sources.map(s => s.path)).size === sources.length;
      const c = valid ? counter({ covered: counted.reduce((n, s) => n + s.metrics[kind].covered, 0), total: counted.reduce((n, s) => n + s.metrics[kind].total, 0) }) : null;
      totals[kind] = c ? { ...c, files: counted.length, sourceCount: sources.length } : null;
    }
    const sameRun = value => value.run_id === record.id && revision(run.revision) && value.revision === run.revision && inputNames.every(n => hash(object(run.ledger_hashes)[n])) && Object.keys(object(run.ledger_hashes)).length === inputNames.length && canonical(value.ledger_hashes) === canonical(run.ledger_hashes);
    if (!sameRun(measurement)) issues.push("测量与运行 ID、修订或台账哈希不一致");
    if (!sameRun(review)) issues.push("独立审查与运行绑定不一致");
    if (!hash(object(record.file_hashes)["code-coverage/measurement.json"]) || review.measurement_sha256 !== object(record.file_hashes)["code-coverage/measurement.json"]) issues.push("独立审查未绑定当前测量文件");
    if (record.read_consistent === false) issues.push("文件在读取期间发生变化");
    const targets = list(object(measurement.scope).targets);
    if (!targets.length || new Set(targets).size !== targets.length || canonical([...targets].sort()) !== canonical(sources.map(s => s.path).sort())) issues.push("测量范围与源文件清单不一致");
    if (record.ledger_match !== "current") issues.push("此运行与当前台账不一致；仅作历史记录展示");
    return { enabled: true, mode, measurement, review, sources, totals, issues,
      recordedConclusion: review.status === "sufficient" && Array.isArray(review.recommendations) && !review.recommendations.length ? "审查记录认为无需继续补测" : review.status === "product_failed" ? "发现产品缺陷" : review.status === "blocked" ? "覆盖率增强受阻" : "尚未记录收敛结论" };
  }
  function design(record, name) {
    const documents = object(object(record).documents), run = object(documents["run.json"]);
    const snapshot = documents[`${name}.snapshot.json`];
    const digest = object(object(record).file_hashes)[`${name}.snapshot.json`];
    if (!snapshot || !hash(digest) || digest !== object(run.ledger_hashes)[`${name}.json`] || record.read_consistent === false || !Array.isArray(snapshot.items)) return null;
    const items = snapshot.items;
    if (items.some(x => typeof object(x).id !== "string" || !x.id) || new Set(items.map(x => x.id)).size !== items.length) return null;
    return new Map(items.map(x => [x.id, x]));
  }
  function diffDesign(before, after, name) {
    const a = design(before, name), b = design(after, name);
    if (!a || !b) return { available: false, added: [], removed: [], changed: [] };
    return { available: true, added: [...b.keys()].filter(id => !a.has(id)), removed: [...a.keys()].filter(id => !b.has(id)), changed: [...b.keys()].filter(id => a.has(id) && canonical(a.get(id)) !== canonical(b.get(id))) };
  }
  function compare(before, after) {
    const a = analyze(before), b = analyze(after), ar = object(object(before).documents?.["run.json"]), br = object(object(after).documents?.["run.json"]);
    const reasons = [];
    if (!a.enabled || !b.enabled) reasons.push("两次运行都须明确启用 coverage 模式");
    if (!revision(ar.revision) || ar.revision !== br.revision) reasons.push("代码修订不同或缺少完整 Git 修订");
    if (!environment(ar.environment) || !environment(br.environment) || canonical(ar.environment) !== canonical(br.environment)) reasons.push("执行环境不同或缺失");
    if (!a.measurement?.environment || !b.measurement?.environment || canonical(a.measurement.environment) !== canonical(b.measurement.environment)) reasons.push("覆盖率采集环境不同或缺失");
    // Compare only reproducible recorded measurements, irrespective of current design freshness.
    for (const c of [a, b]) if (!c.measurement || c.measurement.status !== "measured" || c.sources.length === 0 || c.sources.some(s => !hash(s.sha256) || !s.metrics.lines || !s.metrics.branches) || new Set(c.sources.map(s => s.path)).size !== c.sources.length || c.issues.some(x => /测量与运行|文件在读取|测量范围|测量环境|源文件路径|计数无效/.test(x))) reasons.push("存在无效或不完整的测量记录");
    const inventory = c => c.sources.map(s => ({ path: s.path, sha256: s.sha256 })).sort((x, y) => String(x.path).localeCompare(String(y.path)));
    if (canonical(inventory(a)) !== canonical(inventory(b))) reasons.push("源文件清单或源码哈希不同");
    if (!object(a.measurement?.scope).basis || !object(b.measurement?.scope).basis || canonical(a.measurement?.scope) !== canonical(b.measurement?.scope)) reasons.push("测量范围或排除项不同或缺失");
    if (!list(a.measurement?.tools).length || !list(b.measurement?.tools).length || list(a.measurement?.tools).some(t => !t?.name || !t?.version || !t?.command) || canonical(a.measurement?.tools) !== canonical(b.measurement?.tools)) reasons.push("工具、版本或采集命令不同或缺失");
    const metrics = {};
    for (const kind of kinds) {
      const x = a.totals[kind], y = b.totals[kind];
      const basis = c => c.sources.filter(s => s.metrics[kind]).map(s => ({ path: s.path, total: s.metrics[kind].total })).sort((u, v) => String(u.path).localeCompare(String(v.path)));
      if (x && y && x.total === y.total && canonical(basis(a)) === canonical(basis(b))) metrics[kind] = { before: x, after: y, coveredDelta: y.covered - x.covered, percentDelta: x.percent == null || y.percent == null ? null : y.percent - x.percent };
      else if (x && y || ["lines", "branches"].includes(kind)) reasons.push(`${kind} 逐文件计数范围或分母不一致或不可用`);
    }
    return { comparable: reasons.length === 0, reasons: [...new Set(reasons)], metrics: reasons.length ? {} : metrics,
      scenarios: diffDesign(before, after, "scenarios") };
  }
  function executionProgress(record) {
    const run = object(record?.documents?.['run.json']);
    const scenes = list(record?.documents?.['scenarios.snapshot.json']?.items);
    const current = record?.ledger_match === 'current' && record?.plan_match !== 'stale' && record?.read_consistent !== false;
    const completed = scenes.filter(scene => {
      const progress = list(run.progress).filter(p => p.scenario_id === scene.id);
      const reviews = list(run.scenario_reviews).filter(r => r.scenario_id === scene.id);
      const observations = list(run.results).filter(r => r.scenario_id === scene.id);
      return progress.length === 1 && progress[0].phase === 'completed' && reviews.length === 1 &&
        ['passed', 'failed'].includes(reviews[0].status) && reviews[0].assessment?.execution_audit?.status === 'passed' &&
        observations.length === 1 && observations[0].attempt === progress[0].attempt && hash(progress[0].result_sha256) && reviews[0].result_sha256 === progress[0].result_sha256;
    });
    const remaining = scenes.filter(s => !completed.includes(s));
    const measured = object(record?.execution_coverage);
    const projects = current ? list(measured.projects).filter(p =>
      ['lines','branches'].every(k => counter(p.metrics?.[k])) && list(p.scenario_ids).length > 0 && new Set(p.scenario_ids).size === p.scenario_ids.length && list(p.scenario_ids).every(id => completed.some(s => s.id === id))) : [];
    const selectedIds=list(record?.documents?.['execution-plan.json']?.ordered_scenario_ids);
    return {current, total:scenes.length, completed:completed.length,
      selected:selectedIds.length, selectedCompleted:completed.filter(s=>selectedIds.includes(s.id)).length,
      bugs:list(run.scenario_reviews).filter(r => completed.some(s => s.id === r.scenario_id) && r.status === 'failed').length,
      remaining: Object.fromEntries(['P0','P1','P2','P3'].map(p => [p,remaining.filter(s => s.priority === p).length])),
      projects, measuredScenes: new Set(projects.flatMap(p => list(p.scenario_ids))).size,
      subjects: list(measured.subjects).map(p => current ? p : {...p,status:'invalid',metrics:null,reason:'运行版本未确认一致，不能展示当前被测范围的指标。'}),
      verificationState:measured.verification_state, verificationReason:measured.verification_reason,
      policy:object(run.coverage_policy).mode || 'off', collection:list(measured.collection),
      updatedAt:measured.updated_at, issues:list(measured.issues)};
  }
  return { analyze, compare, diffDesign, design, counter, kinds, executionProgress };
});
