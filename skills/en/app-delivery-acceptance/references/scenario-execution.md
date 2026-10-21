# Per-scenario execution

Read [all artifact standards](output-standards.md) before generation or review. All new records must satisfy their mandatory content and independent output-quality checks. Existing free-text records do not meet the current generation contract; rerun rather than infer or silently backfill summaries.

Design only defines how to accept: preconditions, actions, criteria and required evidence. Test approach is decided when each scenario enters execution, based on requirements, white-box code, intent, embedded acceptance instructions and existing test code. Complete scenarios in stable P0–P3 order, without cost/dependency scheduling.

The workflow creates `new-run ... --scenario-loop` and verifies/persists every per-run dependency before any scenario begins. Both begin and prepared reject missing/failed dependency checks. Analyst records `project.json.test_layout: {paths: ["tests"], basis: "project testing conventions ..."}`; Reviewer checks this before execution. These locations are frozen, and may not include product code. Code is stored according to project conventions; results and evidence alone go in the selected Skill result directory. Product revision identifies the product under test, while each case binding pins its test file hash. New test-only commits do not change the product manifest.

## Lifecycle commands

All commands below also take `PROJECT --test-dir DIR --run RUN --scenario SCENARIO`. JSON payloads may be temporary files under the run; they reference code in project test directories. Use `scenario-step`, never hand-edit progress/results/verdicts. Writes are atomic and locked; a reader sees a consistent run snapshot.

If the user explicitly selects individual scenes, create the partial run with repeated `new-run --scenario <ID>` options and `--scenario-loop`. Freeze selected_scenario_ids in the run and plan, retain every scene in the design snapshot, and execute the selected subset in stable priority order. finish-run records the rest as outside_scenario_scope with their unverified risks. Selection cannot be changed during the run and cannot establish full acceptance. This uses the same lifecycle and independent gates; never skip preceding scenes by rewriting progress.

1. `next-scenario` selects the next permitted scenario or resumes the current phase. It cannot advance until the previous independent evaluation is recorded. The deadline prevents starting another scenario, while an active scenario can finish safely.
2. `scenario-step --action begin` persists preparing. Choose the approach and prepare only this scenario. Record binding `{mode: existing_case|new_case|human_simulation|combined, reason, cases: [{name, origin: existing_case|new_case, path, selector, command, sha256, procedure}], manual_operations: [{id, name, tool, entry_point, procedure}]}`. Cases require exact project-relative file, selector/entry point, command and current hash. The CLI also captures the exact committed test revision, so later test-only additions to a shared case file do not invalidate an earlier executed version. Every concrete case/manual task needs its own procedure (contract below); AI tasks need actual tool/entry point. `reason` explains the choice against the acceptance intent.
3. `scenario-step --action prepared --input binding.json` verifies product invariance and case placement/hashes, then persists executing. A preparation blocker instead uses observe with blocked/unproven and evidence. Playbook `testsPrepared` supports exactly one test-only descendant commit; `ready` and blocked outcomes keep the repository unchanged. Respect project commit policy and existing user changes.
4. `scenario-step --action observe --input observation.json` saves `{status: passed|failed|blocked|unproven, actual, evidence}`; evidence paths are relative to this run, present and nonempty. Evidence is hashed; the run enters evaluating. Persist dependency checks by `run-dependency PROJECT --test-dir DIR --run RUN --input dependency.json` with dependency_id, status and ledger-relative evidence. Product failures never trigger a repair in this run.
5. A separate Reviewer opens evidence and calls `scenario-step --action evaluate --input verdict.json` with `{status, reason, evidence, reviewer_kind: playbook|independent_ai, review_reference, result_sha256}`. Copy the observation hash from progress. Verdicts cannot promote failed observations to passed. This atomically saves the verdict and any issue, and marks completed.
6. `check-scenario` independently gates lifecycle, definition bindings, product invariance, exact case files, unchanged observations and unchanged evidence. Only final pass, confirmed BUG or demonstrated AI inability may pass this recording gate and continue. repair_required returns to the same scenario and cannot advance. Ordinary recording errors return to an independent diagnosis and `scenario-step --action reopen --input reopen.json` for this same scenario. The payload contains independent reason, reviewer_kind and review_reference; the earlier observation/verdict is archived and rerun is required. If evidence was already damaged or missing, preserve its discovered state and original expected hashes explicitly; fresh attempts use new evidence references and never recreate old proof. External product/definition changes invalidate this run and require a new one.
7. `finish-run` records remaining not_run items and closes the run. An active scenario must finish evaluation first. `--stopped` means an actual early stop. Final independent review summarizes saved per-scenario judgments and all remaining risks; the existing full-acceptance checker remains strict. Product fixes and retests use a new run, retaining old failures.

If a live `case-result` froze evidence that later changed before scene observation (for example, a still-running log appended an exit error), retain the exact saved case facts and its original expected hashes. Record only a `blocked` or `unproven` scene observation with the current evidence and the concrete recording problem. The script derives `case_recording_damage`, preserving the original case record and discovered evidence hashes. The separate Reviewer must return `repair_required`; passing, product-BUG and AI-exception final verdicts are rejected for that attempt. The normal repair loop archives the damaged attempt and requires fresh execution/evidence in a new attempt. Never rewrite the old log or case result to restore its expected hash.

## Live viewing

### Readable execution records

Preparation records individual procedures and case_design under [the shared case standard](case-design.md). Scene operation_plan is no longer required or duplicated. Shared setup and source decisions may be recorded once in referenced preparation/input files.

New observations must attach `evidence_details: [{path, name, step, captured_at, criterion}]`, where path is an exact entry in observation.evidence, captured_at is the actual ISO acquisition timestamp with timezone, and step/criterion identify the recorded operation and what this file proves. Record this metadata when collecting evidence; do not infer acquisition time from filesystem modification time. Missing historical metadata remains explicitly unrecorded. Preserve attempt-specific paths. Artifact existence is not an execution observation or an independent verdict.

The coverage view is the report: requirement, scenario, concrete cases/manual tasks, final scene conclusion. Requirement design-review badges open the shared mapping dialog. Scene case-coverage badges open reviewed check-item-to-case-step mappings. Every case link opens only its procedure, actual observations and evidence. No extra scene operation/preparation/evidence column, execution-history tab or prose report is generated. The final conclusion remains an independently explained scene verdict, never a single-case pass. Default selection prefers an active run, otherwise the newest; all records come from that same run/attempt and frozen definitions. Pending/untested scenes do not inherit passes or case bindings. Live dialogs preserve scroll, focus and evidence preview when data refreshes.

### Readable execution observations

New executor observations retain `status`, complete `actual`,  `evidence`. Add per-task `case_results` under [case-design.md](case-design.md) and a short one-sentence `summary` (at most 180 characters) and nonempty `step_results`, each with nonempty `step` and `actual` text, optional `action` text describing the actual operation, and nonempty `evidence` that consists only of exact references from this observation. Record each meaningful action/observation separately at execution time; do not bundle a whole technical report in one item. For example (format only, not actual evidence):

```json
{
  "summary": "重复预订被拒绝，原预订保持不变。",
  "step_results": [{
    "step": "提交重复预订",
    "action": "在已有预订时间内提交另一预订",
    "actual": "页面显示冲突提示，预订记录没有新增",
    "evidence": ["evidence/SCENE/attempt-1/conflict.png"]
  }]
}
```

The Execution record tab shows saved status, summary, times, numbered actual step results with evidence, and collapsed complete actual result. Show repairs and prior attempts separately; archived results never substitute for current-attempt observations. New observations missing these fields are rejected before entering evaluation; the read-only viewer never invents missing summaries or observed steps. Execution status remains distinct from the independent verdict.

### Readable independent assessments

独立评估有两个职责：先核查测试过程本身可信，再根据可信事实认定场景通过或产品 BUG。产出格式与显示要求见 [independent-assessment.md](independent-assessment.md)。它是新写入的 evaluate / recording gate 必需内容，不能仅提交标签、笼统 summary 或照抄执行者结论。执行问题使用 repair_required 修正当前场景；AI 能力异常遵循既有特殊出口。

结果标签可点击：执行列的标签明确是执行者记录，已有独立结论时打开同场景同运行的独立评估说明；尚未评估时打开执行事实并提示尚无最终认定。独立列的标签打开独立评估。保留原有详情入口、键盘操作、关闭后返回位置和实时刷新。

Open the local ledger viewer at any time. The current trace shows each scenario’s latest actual execution across saved runs, including phase, status, independent verdict, issues and case references, without a run selector or run identifier. Pending/preparing-only/not_run entries do not erase earlier executions; newer actual executions and repair attempts replace older displayed results. Original execution sources and historical version warnings remain; this display does not change acceptance gates. The coverage relationship view refreshes every five seconds; a running schema-2 run also refreshes other visible views. Manual refresh works for all runs. Per-scene selection uses recorded observation/start times, falling back to run creation times for historical records; missing/equal timestamps do not establish chronology from directory names. Legacy progress summaries use the frozen scene snapshot/plan and existing observations/reviews; missing results are distinct from explicit not_run. Missing lifecycle phases remain unrecorded, and missing historical scope is disclosed instead of inferred from a changed current design. Pending is distinct from not_run, executing is distinct from evaluating, and an execution pass is distinct from an independently proven pass. Historical runs show their original records without invented lifecycle states or renewed certification.

### Execution problems are repaired within the current scenario

A normal final scenario verdict is **passed** or **failed (confirmed product BUG)**. An insufficient evidence record, unreasonable case/assertion, setup mistake or incorrect operation is an execution problem: independently record `repair_required` with problem_kind evidence/test_design/execution and return to this same scenario's preparation, correction, rerun and independent evaluation. No next scenario starts while repair is pending. Missing or damaged evidence before evaluation also requires repair_required; archive its discovered state and collect fresh evidence, never accept a normal final verdict from it. Preserve old observations, reviews and evidence in attempt_history/execution_repairs; do not hide earlier findings. Product BUGs are recorded and execution continues without product repair.

`execution_error` is a special final exception only when AI demonstrably cannot finish execution after attempted recovery; record capability_problem, recovery_attempts and independent supporting evidence. A retry count alone, missing evidence or an ordinary test defect cannot justify this exception. The viewer distinguishes execution quality repairs, confirmed BUGs and AI exceptions. Final acceptance requires every scenario independently passed.

## 测试关联与展示

覆盖关系就是用户报告，无单独执行历史、代码覆盖率、补测过程、报告与证据 TAB，也不另生成文字报告。逐场景记录本轮关联：每个用例必须有业务名称、existing_case/new_case 来源、项目路径、精确 selector、实际命令和文件哈希；是否新建以本轮为准。combined 的每个用例单独标明来源。AI 模拟人工操作逐任务写 manual_operations 的名称、真实 tool/entry_point 和 procedure，步骤及证据保持可核验；没有界面则不得声称点击过界面。未准备场景不从旧轮继承关联。

## 逐用例与人工任务的过程说明

一个场景可以关联多个用例或人工任务。每个 cases[i] 必须单独记录 name、本轮 origin、精确代码绑定和 procedure；人工任务保存到 manual_operations [{id,name,tool,entry_point,procedure}]，支持多个任务和 combined。procedure 必含 objective、preconditions（文本列表）、test_data（文本列表）、steps [{action,expected}]、scenario_checks [{scenario_id,criterion,scope}]。criterion 精确引用冻结场景 acceptance.criteria；scope 用白话说明该用例承担的子范围，一个用例无需承担整个场景。多个用例的覆盖并集由独立评估核实，不能因为单个用例通过就认定场景通过。

四部分展示为“测试目的”“前置条件与测试数据”“操作步骤与预期结果”“对应的场景检查项”。步骤的 expected 是计划检查的结果，不能冒充已经观察到的事实。已有用例根据实际阅读的代码、数据和断言写说明，新建用例根据最终实际实现写说明，人工任务根据将实际执行的操作过程写说明。不能从场景验收说明照抄、自动摘要或补造具体用例内容。缺失或与实现不符须修正；没有历史豁免。描述只在场景进入执行准备时产生，设计阶段仍只确定场景的验收说明。

覆盖关系每条关联可点击，弹窗标题为该用例或人工任务名称，仅展示该项的四部分；场景及本轮是辅助信息。路径、精确标识、命令、版本、哈希及选择理由默认折叠。没有场景级执行页签；执行事实和证据在该用例弹窗中展示，场景行最终结论打开整体独立判定。相同路径+精确标识+版本+哈希的用例可汇合本轮实际绑定的场景检查项；不能汇合兄弟用例、不同版本或旧轮结果。

场景→用例的具体检查点、贡献并集、独立覆盖审查和逐用例实测记录按 [case-design.md](case-design.md) 执行；不再要求复制场景级operation_plan。

Required live coverage follows [code-coverage.md](code-coverage.md#fixed-collection-policy-and-per-scene-obligations): preparation records coverage_collection, observe binds capability outputs and actual raw counters, and independent assessment.execution_coverage verifies each measured/unavailable project. A missing available measurement cannot complete a scene; repair and rerun the current attempt.

## Superseded runs

When the authorized retest replaces a run, its owning task first stops that run's workers and waits for in-flight writes to settle. Then call `playbook.py abort-run PROJECT --test-dir DIR --run ID --reason "concrete replacement reason"`. This atomically records lifecycle aborted and termination reason/time, retaining all observations, scene phases, attempts, issues and evidence. It does not terminate OS processes, certify acceptance, fabricate not_run observations or classify cancellation as AI inability. Closed runs reject further execution writes. Start a fresh run for actual retesting; do not rewrite old conclusions/counters. The viewer identifies aborted runs and their reason; they never outrank an active run.
