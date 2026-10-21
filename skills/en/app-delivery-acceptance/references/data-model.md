# Project ledger and evidence rules

New workflow launches require [acceptance-plan-v1](acceptance-organization.md): acceptance-plan.json, acceptance-plan-review.json, append-only scope-decisions.json and persistent acceptance-scope-policy.json. Complete requirements.json remains verbatim. Plans organize selected checks without trimming global context. Scenes add scope/risk; coverage_review.json adds independently authored acceptance_scope_review. Formal plan publication is versioned and archived; runs freeze all four files plus original requirements snapshots and hashes. Missing files or changed user decisions block recovery. Historical v3 remains readable; new CLI runs require organization.

## Intent-scoped live coverage

When live execution coverage is required, `project.json.coverage_subjects` defines one fixed denominator per tested component. Each entry records `kind` (`project`, `directories`, `files`, `commit_changes`, `pr_changes`), readable `intent` and `basis`, project identity/root/frozen revision, complete `source_paths`, and `excluded_paths` with concrete reasons. Directory/file scopes additionally record `directories`/`selected_paths`; change scopes record verified base/head commits and PR identity when applicable. The choice follows the user's test intent, never the files a test happened to execute.

`coverage_review.json.coverage_subject_review` independently reviews that choice and inventory, binding `subjects_sha256`, `status`, `reviewer_kind`, `review_reference`, and a specific `reason`. Required-coverage new-run rejects missing, invalid or stale reviews before creating a run. The existing frozen ledger hashes protect this definition during execution. Changing the denominator requires a reviewed new run. See [code-coverage.md](code-coverage.md#intent-scoped-cumulative-coverage) for exact scope and counter rules.

Viewer `execution_coverage.subjects` contains verified cumulative scope metrics or an explicit incomplete/invalid reason and missing paths. Only independently completed, current, compatible original-source receipts contribute hits. File-scope receipt metrics are auxiliary; they cannot stand in for the intended overall denominator.

All newly generated artifacts must satisfy [output-standards.md](output-standards.md), including per-artifact independent output_quality reviews. Existing free-text records are not accepted as compliant new output.

Before launch, the user chooses a test directory; suggest `<project>/tests` when none has been supplied. The Playbook writes all generated assets under `<test-dir>/delivery-acceptance/`. Relative `--test-dir` paths resolve against the target project, not the shell working directory; absolute paths are also supported. The launcher requires an explicit selection. Direct checker commands use `--test-dir`, the inherited `DELIVERY_ACCEPTANCE_TEST_DIR`, or the standalone default `tests`. Treat `requirements.json` as a snapshot supplied by the requirements-confirmation stage; acceptance work does not edit its content. The adjacent `project.json` stores its SHA-256 and source path. Importing a revised requirements list invalidates the black-box and white-box completeness flags.

## Input and project records

`requirements.json`:

```json
{"source":"approved-requirements.md","version":"2026-09-29","items":[{"id":"REQ-1","text":"A valid code registers an account; an expired code does not."}]}
```

`project.json` binds the assets to `project_root` and records the selected `test_dir`; it also describes `name`, `app_start`, `test_commands`, and `device_targets`. Fill only commands and targets actually used by this project. The Playbook does not execute arbitrary commands from this file; Codex uses them when appropriate.

`resources.json` has `discovery_complete`, `discovery_basis` (the files/configuration and systems inspected), and `decisions`. Each decision has `id`, `kind` (`local` or `third_party`), `description`, and `verification` (`status`, `evidence`). Third-party decisions also need:

- `mock_available`: boolean, assessed for the full-flow behavior being tested.
- `mode`: `mock`, `real`, or `blocked`. If Mock is viable, mode must be `mock`. Real E2E requires `mock_available: false`, `credential_reusable: true`, and a nonempty `credential_ref` pointing to a secure store or managed secret.
- `reason`: why this mode applies; `mock_ref` when mode is `mock`.
- `integration`: `status: passed`, `evidence`, and `tested_version` for the separately checked real integration. Reassess it if the adapter, service contract, or configuration changes. A failing or missing integration check blocks full acceptance even when Mock flows pass.

Evidence paths in `resources.json` are relative to the asset directory (`<test-dir>/delivery-acceptance/`), for example `evidence/resources/sms-integration.txt`. These paths must remain inside that directory, including when it is outside the project. Execution bindings reference project-native test code from run.json. Keep sensitive values out of this ledger and its evidence.

## Complete test scenarios

`scenarios.json` is the sole design artifact for test scenarios and their acceptance instructions. It has `black_box_complete`, `white_box_complete`, `items`, `design_standard: "design-quality-v4"` and per-selected-requirement `design_basis` following [design-quality.md](design-quality.md). Each item has `id`, `kind` (black_box/white_box), `title`, `requirement_ids`, `expected`, `priority`, `priority_reason`, and one embedded `acceptance` object. White-box items additionally have `target_condition`.

`acceptance` contains `description`, `preconditions`, `actions`, `criteria`, `evidence_expected`. Description is a self-contained plain-language paragraph explaining the business context, behavior being checked and purpose; the four lists contain concrete individually readable preparation, operations, expected results and evidence requirements. Multiple inputs or groups remain inside this scenario. No separate method ID, method_ids, methods.json or methods snapshot is produced. Existing cases, new cases and human operations are selected during scenario preparation; references to reusable test code belong to per-run execution bindings. A shared code helper does not create a shared design artifact.

Confirmed requirements remain verbatim. Authored business prose uses the explicit user language, otherwise the linked original requirement’s primary language. Technical identifiers are for evidence/case location, and business-facing prose must define its subjects and inputs without relying on unexplained aliases. Changing acceptance instructions changes the scenario design and invalidates its review and previous execution binding.

`coverage_review.json` is independently authored. `review-hashes` returns requirements_sha256 and scenarios_sha256; the scoped scenario hash includes black-box items with acceptance, design_basis and design_standard, excluding unrelated white-box drafts. Requirements, all acceptance steps/criteria/evidence and check-item contributions must actually be reviewed before refreshing hashes. Root status is passed only when every selected requirement is sufficient. Per-requirement records retain reason, operation_modes, user_states, internal fault_probes, uncovered_paths, coverage_results, criteria_checks, findings, scope and limitations. Contributions now identify scenario_id, covered_point_ids and a concrete reason locating the scenario's own actions and criteria; there are no method references.

Internal fault_probes express possible escaping mistakes and the linked checks that would expose them. They remain reviewer work material and are not displayed, counted, linked or exported as user-facing probe artifacts. Concrete missing behavior must appear in the check-item table/findings and be fixed in the scenario's acceptance instructions. Design review does not claim actual execution or actual fault injection. User-visible raw design reviews also omit internal fault_probes.

The black-box checker verifies the supplied requirements, complete scenarios and independent coverage review; full acceptance additionally requires resources, white-box review, real execution and independent evidence judgment. A scenario's expected outcome and acceptance instructions describe future verification, not measured success.

Read these JSON files with the bundled `scripts/serve_ledger.py <project> --test-dir <test-dir>` web viewer. It joins records by their existing IDs without copying or translating them and exposes original JSON alongside the linked views. The overview and matrix trace each requirement to black-box scenarios with embedded acceptance, the independent check-item coverage judgments, and each scene’s latest actual execution and its evidence review across saved runs. Counts distinguish association, current design sufficiency, execution claims and independent evidence review; the latest display selects one execution source per scene, without merging observations or reviews within a scene or changing backend acceptance gates. Per-package scenario counts include shared scenarios, while overall counts deduplicate across packages. It also presents optional `pending-business-inputs.json`, `repair-summary.json`, `workflow-sessions.json`, `review-history/<round>/` snapshots and `runs/<run-id>/` records when present; these optional records are not additional acceptance gates. Current black-box checks and review-hash freshness are distinct from the saved `black-box-gate.json` conclusion. Existing execution records are labelled against the five pinned ledger hashes and are not re-certified by the viewer. Do not generate `black-box-scenarios.md` as a parallel readable ledger; use the viewer by default.

Live coverage verification runs in the background. Skip native coverage verification for runs bound to a stale ledger; they cannot supply current metrics. Overlapping browser refreshes share one in-flight consistent ledger reading; the next separate refresh reads the files again, without a timed stale snapshot cache. Do not scan the complete artifact tree during automatic ledger refresh: load evidence inventories on demand through their separate endpoint. Parse the reviewed test-directory rules once per dependency scan, preserving exact path boundaries and product-change invalidation. Its cache follows completed contributors, their original evidence, committed case versions, frozen design and denominator, and current product files. Unfinished scenes' phase changes, retries, test edits and provisional receipts must not remove verified cumulative metrics. While newly completed scenes are being verified, retain the still-valid earlier subset and explicitly state that the new scenes have not yet been counted. If an earlier contributor is reopened, or its evidence, frozen case version, product or denominator changes, hide the affected cached metrics and verify again. Collection stages remain live independently of these metrics in execution records. The coverage report does not list per-scenario collection stages or receipts: it presents cumulative coverage for the frozen tested scope, remaining important scenarios, and concrete collection limitations grouped by tested object. Collection details remain available with the associated execution evidence. This viewer cache does not replace or weaken the full-run acceptance gates and never writes execution records.

Importance grading, `coverage_review.json.priority_reviews` and the hash-bound `white_box_priority_review` follow [scenario-priority.md](scenario-priority.md). Reviewer owns both review sections; grading disagreements fail design review. Scoped hashes include importance and reasons. Viewing historical unclassified scenarios never assigns grades or rewrites evidence.

## One execution

For schema-2 lifecycle details and normal final verdicts (passed/confirmed BUG), with the exceptional AI execution_error, read [scenario-execution.md](scenario-execution.md). Raw observations and legacy statuses below are distinct from final scenario verdicts.

`runs/<run-id>/run.json` contains `acceptance_mode` (`standard` by default, `coverage` only when explicitly selected; historical missing values mean standard), `revision`, `environment`, `ledger_hashes` captured by `new-run`, `dependency_checks`, `execution_plan_sha256`, and `results`. The separately frozen `execution-plan.json` records the fixed policy, creation/deadline times and selected P0 → P3 queue; see [scenario-priority.md](scenario-priority.md). Preserve both the plan binding and original created_at when recording results. Preserve `ledger_hashes` when filling the run; if the ledger changes afterward, start a new run so old evidence cannot validate a new scenario definition. Every decision needs a dependency check with `status: passed` and asset-directory-relative resource evidence for this run. Every scenario needs one result with `scenario_id`, `status` (`passed`, `failed`, `unproven`, `blocked`, `execution_error`, or `not_run`), `actual`, and `evidence`. Result evidence paths are relative to the run directory. A `not_run` result instead records `not_run_reason` and a concrete `reason`, with empty evidence and no invented actual observations. It blocks full acceptance. A test log or screenshot should show the checked outcome, not merely that a command was started.

`runs/<run-id>/review.json` contains `revision`, `reviewer_kind` (`playbook`, `independent_ai`, or `self`), `review_reference` for an independent review, `coverage`, and one review for every scenario under `results`. `coverage` needs `status`, `reason`, `requirements_reviewed` (all confirmed IDs), `white_box_basis` (a nonempty string or nonempty list of nonempty strings naming the design/code and any coverage report inspected), and `uncovered_branches` (an empty list for full acceptance). Each scenario review has `scenario_id`, `status` (`passed`, `failed`, or `unproven`), `reason`, and `evidence`. The reviewer opens the evidence and judges the expectation against actual behavior. An AI reviewer can identify semantic gaps that the checker cannot; do not copy the executor's verdict without inspection. Structural checks do not independently prove that the reviewer was right.

## Viewer result semantics

- `new-run` saves a UTC `created_at` and exact `scenarios.snapshot.json` / `scenarios.snapshot.json` bytes next to `run.json`. The viewer compares these only when their SHA-256 matches the run's pinned `scenarios.json` / `scenarios.json` hash. Never populate historical snapshots from the current design. Comparison shows added, changed and removed IDs for both black-box and white-box scenarios; links open the current ledger, while artifact links open the historical definitions.
- `run.json` may include `workflow_session_id` and `coverage_round` when the producing workflow actually knows them. These are display metadata, not new mandatory gate inputs. Without them the viewer does not infer loop membership/order from directory names. Select two runs explicitly for a comparison.
- Only a run explicitly declaring `acceptance_mode: "coverage"` loads its `code-coverage/measurement.json`, `review.json`, and optional `gate-report.json`. Missing mode means standard. Optional root `code-coverage-resources.json` is loaded only if at least one such enhanced run exists. An invalid mode is not interpreted as coverage.
- Code coverage totals are sums of valid `covered` / `total` counters within the recorded file inventory, never averages of percentages. A zero denominator is **无可计数单元**, missing/invalid counters are **不可用**. Optional function/statement totals state how many files provided that metric. Source paths and optional `module`/`component` values come from the actual report; no frontend/backend split is presumed. Optional `project.json.packages` entries `{id, name}` supply business-package labels; otherwise the original package ID is used.
- Coverage deltas require the same tested code revision, source inventory and hashes, scope/exclusions, runtime environment, tool versions/commands and counter denominators. Scope changes can still be viewed separately, but are not presented as a coverage improvement. Snapshot comparison is independent of whether measurements can be compared. Record-binding warnings, historical conclusions and current acceptance remain separate; the viewer does not rerun source/raw-evidence verification or certify release readiness.
- The artifact browser lists existing files within the selected `delivery-acceptance/` root, including run evidence, original JSON and optional raw measurement files. It rejects absolute/traversal paths, symlinks and external-project references. Text previews show up to 1 MiB with an explicit truncation notice; downloads are limited to 32 MiB. The inventory scans up to 5000 entries and 16 directory levels per selection and reports any limit reached. Selecting a run loads its own inventory through the read-only `/api/artifacts?run=<id>` endpoint, so large unrelated histories do not hide its reports. Hidden/runtime dependency directories are skipped. HTML is sandboxed with scripts/forms disabled; unknown formats are download-only. No server write endpoint exists. Legacy tool-specific reports can be opened as original artifacts; structured coverage summaries require the portable measurement/review contract rather than guessing unknown report formats.

The checker creates `runs/<run-id>/gate-report.json`. The record summarizes the gate verdict and scenario execution claims, not a substitute for the underlying evidence or `review.json`. Keep historical runs immutable when possible; corrections after a code change belong to a new run on the new revision.

## Optional measured code coverage

Only enhanced runs add `runs/<run-id>/code-coverage/measurement.json` and an independent `review.json`, following [code-coverage.md](code-coverage.md). These are distinct from requirement/scenario `coverage_review.json`. Standard runs never read or require them. A recorded enhanced run requires the additional `code_coverage` gate; changing or omitting a check flag cannot downgrade its mode. The original five gates are unchanged in standard mode.

## Asset layout and resuming

```text
<test-dir>/delivery-acceptance/
  project.json, requirements.json, execution-policy.json
  resources.json, scenarios.json, coverage_review.json
  workflow-sessions.json
  evidence/resources/             Resource verification logs and screenshots
  black-box-gate.json, scenario-gate.json
  runs/<run-id>/
    run.json, execution-plan.json, review.json, gate-report.json
    evidence/                    Execution logs, screenshots and observations
```

`workflow-sessions.json` records each launched session's project, selected test directory, workflow stage, fixed `coverage_mode`, `execution_policy` (maximum priority and optional per-run execution minutes), and original `requirements_file` path. Missing mode in historical bindings means standard. Resume inherits its original mode/options; an explicit conflicting mode is rejected before agent work. Resume with the same project, `--test-dir` and `--stage`; a different directory must not create a parallel ledger for that session. Existing assets are reused after their project binding is checked. Historical directories are not migrated automatically. The launcher locally ignores only the generated asset subtree when it is inside the project repository; it does not ignore the whole test directory or change tracked test code.

## Complete scenarios and incremental execution (schema 2)

Each scenario embeds `acceptance` with `description`, `preconditions`, `actions`, `criteria`, `evidence_expected`, all nonempty. These describe acceptance without selecting case reuse/creation or human simulation. No standalone method file, method kind, ID, association or snapshot is generated. Old runs do not certify the new design; start fresh rather than rewriting their evidence.

The workflow creates `new-run --scenario-loop`. `project.json.test_layout` has project-relative `paths` and a concrete `basis` from project conventions, independently reviewed. All case code and reusable fixtures live there, outside the result ledger. Run schema 2 adds lifecycle running/completed, updated_at, test_code_paths, product_manifest, progress, scenario_reviews and issues. The execution plan pins execution_schema 2; removing it from run.json is rejected. See [scenario-execution.md](scenario-execution.md) for transition payloads.

Each observation carries execution binding, evidence_sha256, observed_at and started_at. New observations must author a substantive short summary and step_results with step, actual and evidence (optional action), while preserving the complete actual result; see [Readable execution observations](scenario-execution.md#readable-execution-observations). Each independent scenario review pins result_sha256, reviewer_kind, review_reference, verdict, reason and cited evidence. New reviews also author a short summary and assessment with scope, per-criterion expected/actual/status/evidence checks, basis and limitations; see [Readable independent assessments](scenario-execution.md#readable-independent-assessments). Current writes require these sections plus assessment.output_quality; missing sections are rejected, and cannot be waived as historical compatibility. Final review preserves summary/assessment alongside the original judgment. Issues retain scenario_id, both statuses, observed failure/blocker, evidence and recorded_for_separate_repair. Final review.json summarizes identical scenario status/reason/evidence; it cannot rewrite the earlier judgment.

New execution bindings carry a short `summary`, complete per-case/manual-task `procedure`, scene-to-case `case_design` check mappings, and run-relative preparation/input references. Do not duplicate these procedures in a scenario operation_plan. Mandatory observation `evidence_details` covers every referenced file and adds business names, step/criterion associations and actual acquisition timestamps, without changing the required evidence references/hashes. See [readable execution records](scenario-execution.md#readable-execution-records). Legacy free-text operations and missing metadata remain readable without migration or invented observations.

### Execution problems are repaired within the current scenario

A normal final scenario verdict is **passed** or **failed (confirmed product BUG)**. An insufficient evidence record, unreasonable case/assertion, setup mistake or incorrect operation is an execution problem: independently record `repair_required` with problem_kind evidence/test_design/execution and return to this same scenario's preparation, correction, rerun and independent evaluation. No next scenario starts while repair is pending. Preserve old observations, reviews and evidence in attempt_history/execution_repairs; do not hide earlier findings. Product BUGs are recorded and execution continues without product repair.

`execution_error` is a special final exception only when AI demonstrably cannot finish execution after attempted recovery; record capability_problem, recovery_attempts and independent supporting evidence. A retry count alone, missing evidence or an ordinary test defect cannot justify this exception. The viewer distinguishes execution quality repairs, confirmed BUGs and AI exceptions. Final acceptance requires every scenario independently passed.

Final review.json requires summary, scope (included/excluded/limitations lists), recommendations and output_quality covering project/resources/execution/evidence/issues, plus code_coverage in enhanced mode. Design coverage_review.json and white_box_priority_review each require output_quality with complete reviewed scenario IDs for scenarios and acceptance categories. See the single maintained artifact standard for the exact contract.

### Independent judgment argument

New per-scene assessments require `execution_audit` (test credibility) and, for final passed/failed verdicts, `explanation` (business argument), in addition to checks and output_quality. See [independent-assessment.md](independent-assessment.md) for the maintained schema and semantic review requirements. Result labels open the saved argument rather than inferring it from status or raw prose.

设计审查对应表使用 design-quality-v4：coverage_items 含 identification_basis 和 check_points；coverage_results 含 scenario_coverage 的实际 covered_point_ids 与场景引用，覆盖状态按并集为 covered/partial/gap。详见 [完整契约](design-quality.md#面向用户的检查项对应表)。

白盒场景与补充逆向规则按 [white-box-rules.md](white-box-rules.md) 区分来源、独立判据与待确认状态；逆向规则是单独产物，不改写已确认需求。其正文、检查项、来源和审查原因也必须自包含、易于理解。

## Current user report

The coverage relationship view is the report. It displays all scene rows, per-scene latest-execution phases, results, verdicts, optional separately sourced measurable coverage and exact test associations. No separate execution/history, code-coverage, supplement/round or report/evidence tab, no supplement-process link and no extra prose report are produced. Run controls and identifiers are hidden; each scene’s case/result dialog opens that scene’s exact selected execution. Pending/not_run entries do not erase earlier executions; newer actual executions, failures and repairs do. Historical version labels remain, and the display does not certify cross-run acceptance. Case bindings add business name and per-run origin existing_case/new_case; combined records classify each case individually. AI manual records contain separately identified manual_operations and per-item procedures. Case links open only the clicked item; scene results remain separate.

## 逐用例与人工任务的过程说明

一个场景可以关联多个用例或人工任务。每个 cases[i] 必须单独记录 name、本轮 origin、精确代码绑定和 procedure；人工任务保存到 manual_operations [{id,name,tool,entry_point,procedure}]，支持多个任务和 combined。procedure 必含 objective、preconditions（文本列表）、test_data（文本列表）、steps [{action,expected}]、scenario_checks [{scenario_id,criterion,scope}]。criterion 精确引用冻结场景 acceptance.criteria；scope 用白话说明该用例承担的子范围，一个用例无需承担整个场景。多个用例的覆盖并集由独立评估核实，不能因为单个用例通过就认定场景通过。

四部分展示为“测试目的”“前置条件与测试数据”“操作步骤与预期结果”“对应的场景检查项”。步骤的 expected 是计划检查的结果，不能冒充已经观察到的事实。已有用例根据实际阅读的代码、数据和断言写说明，新建用例根据最终实际实现写说明，人工任务根据将实际执行的操作过程写说明。不能从场景验收说明照抄、自动摘要或补造具体用例内容。缺失或与实现不符须修正；没有历史豁免。描述只在场景进入执行准备时产生，设计阶段仍只确定场景的验收说明。

覆盖关系每条关联可点击，弹窗标题为该用例或人工任务名称，仅展示该项的四部分；场景及本轮是辅助信息。路径、精确标识、命令、版本、哈希及选择理由默认折叠。没有场景级执行页签；执行事实、证据与最终判定使用场景行原有入口。相同路径+精确标识+版本+哈希的用例可汇合本轮实际绑定的场景检查项；不能汇合兄弟用例、不同版本或旧轮结果。

场景与用例的信息分工、逐检查点联合覆盖、独立审查case_coverage、逐用例case_results及四列报告遵循 [case-design.md](case-design.md)。场景级operation_plan不是新记录的必需内容；用例过程与证据在具体用例中维护，整体最终结论仍归场景。

## 有序设计流程数据

见 [design-pipeline.md](design-pipeline.md)。source-analysis.json 为完成且绑定来源的分析清单，白盒规则全部先于组织出现。acceptance-plan-v2 绑定 source_analysis_sha256/rules_sha256，每个 unit 包含 rule_ids。publish-plan 一次性初始化所有单元 design-progress.json：pending → in_progress → generated，并绑定当前计划、分析、来源与每单元实际场景清单/哈希。场景有 generation_unit_id；生成/审查全部完成后才能创建执行轮次。服务端 pipeline_status 为四阶段及逐单元状态的只读派生视图，不能由角色直接写状态冒充完成。
