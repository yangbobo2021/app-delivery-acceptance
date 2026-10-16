# Optional code-coverage enhancement

Business acceptance scope follows [acceptance-organization.md](acceptance-organization.md) and is separate from the measured denominator. User-selected full PR coverage keeps its complete denominator even when a test topic is excluded. Missing coverage never authorizes additional business scenarios; opt-in enhancement must remain within the published scope.

Read this reference when the fixed acceptance `coverageMode` is `coverage`, or when the user requests the optional live execution indicator described below.
Standard acceptance without that indicator never requires these files, tools or gates. Existing code-coverage reports do not enable enhancement. The unrelated `coverage_review.json` remains the requirement/scenario counterfactual review used in both modes.

Apply the [artifact standard](output-standards.md) to measurement, risk/disposition prose, independent reviews and recommendations; the final enhanced review includes an explicit code_coverage output-quality check. Percentages alone are not an acceptance explanation.

## Collection and decisions

Select tools from the actual project's language, test configuration and runtime. Verify executable versions and commands instead of assuming one stack. Measure the full current acceptance run, including existing project tests and actual UI/API paths where applicable. A collection-only replay must preserve the scenario's original assertions and record its relation to that run. Combine counters only from this run, identical original source bytes and compatible measurement settings. Never use old passing executions or raw counters from another run/revision.

Pin the original tracked application sources to the tested Git revision and working bytes. Instrument copies only under ignored testing assets. Record source maps and independently establish that metrics refer to original sources. Inventory relevant first-party modules (frontend/backend/services as applicable); a tool omitting a component is a measurement limitation, not 100% coverage. Scope exclusions need concrete reasons and independent review. Keep defensive exits and nonmaterial uncovered paths in measured denominators.

Coverage-only tool prerequisites belong in optional `<test-dir>/delivery-acceptance/code-coverage-resources.json` and the enhanced run's collection record, not the shared required `resources.json.decisions` list. Standard mode does not inspect this optional preflight record. When reusing resources from an earlier enhanced session, Analyst distinguishes coverage-only prerequisites from dependencies actually required for the selected standard scenarios; historical collection tools cannot impose new collection work on standard acceptance.

Tester writes `runs/<run-id>/code-coverage/measurement.json`. Reviewer independently inspects raw counters, source mapping and scope, then writes `code-coverage/review.json`. A plausible fault in a covered branch or state transition may still need a strengthened scenario. Every necessary recommendation links to confirmed requirements and concrete scenario/method work; preserve IDs when refining existing scenarios. Analyst repairs definitions; Reviewer revalidates the changed design before a fresh full run. A product defect ends incomplete and must be fixed outside the testing workflow.

The coverage relationship view shows optional verified counters alongside completed scenes. There is no separate coverage, supplement/round, or report tab and no supplement-process entry. Internal measurement and gate records remain authoritative; absence of measurement does not imply full coverage.

Convergence means no necessary path/state/transition recommendations remain, all residual uncovered units have independently supported dispositions, the code-coverage script gate passes, and the ordinary evidence review and five gates pass for the same final run. There is no universal percentage threshold. At most three coverage rounds per session; unresolved gaps at the limit remain incomplete. Missing collection capability, unresolved source mapping or required unmeasured modules are blocked, never silently skipped or downgraded.

## Measurement record

`measurement.json` is a JSON object with:

- `status`: `measured` only when the declared scope has usable real counters; otherwise `blocked` with concrete details.
- `run_id`, `revision`, `ledger_hashes`: exact current run values, including all six frozen ledger hashes.
- `environment`: actual operating system/runtime and collection conditions.
- `tools`: nonempty array of `{name, version, command}`, recording commands actually run.
- `scope`: `{targets: [original project-relative source paths], exclusions: [{path, reason}], basis: "source inventory and selection evidence"}`. Targets are distinct and must match sources exactly. An omitted required module cannot be justified merely by lacking a tool.
- `raw_evidence`: nonempty array of `{path, sha256}` relative to this run, pointing to nonempty raw report/counter files. Include original/instrumented source mapping evidence where relevant.
- `sources`: one record per target, `{path, sha256, metrics}`. SHA is original source bytes in both the tested Git revision and current working tree. `metrics.lines` and `metrics.branches` each have integer `covered` and `total`; `0 <= covered <= total`. Zero branch count represents branch-free code only with real tool evidence. Optional functions/statements metrics may accompany these required counters. Unsupported counters are a recorded blocker, never invented zero totals.
- `uncovered`: array of `{id, file, kind, location}` for every unhit original-source line/branch counter unit; `kind` is `line` or `branch`. IDs are distinct; `location` distinguishes counter units (including separate branch arms). Per source/kind, item count equals `total-covered`. An unhit line and its branch arms appear separately when counted in both denominators.

## Independent coverage record

`review.json` is a JSON object with:

- `run_id`, `revision`, `ledger_hashes`: exact run values.
- `measurement_sha256`: exact measurement bytes reviewed; changing it invalidates review.
- `reviewer_kind: "independent_ai"`, nonempty `review_reference` and reasoned `reason`.
- `status`: `sufficient`, `gaps`, `blocked` or `product_failed`.
- `scope_reviewed: true`, `raw_counters_verified: true` only after actual independent inspection.
- `evidence`: nonempty `{path, sha256}` array pointing to independent checks/observations in this run.
- `dispositions`: one record for every uncovered unit, `{path_id, decision, reason, scenario_ids?}`. A sufficient review allows `covered_by_existing` (with current scenario links and why the unhit path is already behaviorally proven), `defensive_unreachable` (concrete reachability/fault analysis), or `out_of_scope` (confirmed scope reason). Important unproven branches cannot use these labels as an exemption.
- `state_probes`: nonempty array of `{state, plausible_fault, failure_signal, scenario_ids}` challenging meaningful user/operation states and transitions, including covered code. Links must identify current scenarios whose observable assertions would catch the fault.
- `recommendations`: concrete unresolved actions when gaps exist, with requirement/scenario/method links and the escaping fault. Must be `[]` for sufficient. No actions solely to inflate percentages.

## Checks and mode binding

`playbook.py new-run ... --coverage-mode coverage` records `acceptance_mode: "coverage"`; the launcher fixes and persists this mode per session. Standard runs record `standard`; historical runs without it retain standard semantics.

`playbook.py check-code-coverage ... --run <id>` validates only the enhanced measurement/review; it refuses a standard run. `playbook.py check ... --run <id>` enforces `code_coverage` in addition to the five existing gates for a recorded enhanced run. Explicit `--coverage-mode` must match the recorded mode; it cannot downgrade an enhanced run or retroactively upgrade a standard run. Standard checks never read optional code-coverage files, even malformed historical ones.

Report mode, scope, final counters, dispositions, iterations and unresolved blockers alongside the ordinary acceptance outcome. Coverage measures execution and informs scenario review; it never substitutes for behavior assertions or independent evidence review.

## Optional live execution indicator (not enhancement)

When the user wants current test coverage as a progress indicator, collect available real counters during each selected scenario's actual execution without enabling the coverage-driven repair rounds. Standard acceptance still has no coverage prerequisite or extra gate. A project without usable counters shows the concrete inability reason, affected source scope, attempted remedies and independent review state, and retains scenario progress; never substitute a scenario-completion ratio or a zero for missing measurement.

Store one immutable receipt per scene/attempt/project in `runs/<id>/execution-coverage.json` through `scripts/execution_coverage.py PROJECT --test-dir DIR --run ID --input receipt.json`. Supported formats are branch-enabled coverage.py JSON and original-source Istanbul JSON, including actual V8 counters converted with source maps. Choose the actual project's collector; keep original counters, exported JSON, actual invocation/version and source mapping evidence in this attempt. The JSON export and provenance must be part of observe.evidence and its metadata, not retrospective evidence from another run. Independently justified target inability does not prevent ordinary product assessment. Missing or invalid collection when a tool is available is an execution problem requiring same-scene correction. An unsupported SKILL adapter, parser error or conversion failure is a collection-processing problem, never evidence that the project cannot collect. Preserve actual data and correct the adapter/mapping within the scene; do not advance using an unavailable exemption.

Receipt fields: scenario_id, attempt, result_sha256 (current observed result), project_id, project_label, project_root, revision (original product revision), captured_at (actual capture with timezone), tool {name, version, command}, scope {targets:[project-relative source files], basis, exclusions:[{path,reason}]}, raw_evidence {path,sha256} (run-relative JSON). The collector command, version, source hashes, raw covered/missing units and full denominators are verified. Targets are original first-party code; tests, fixture helpers and other unmeasured components need explicit scope/exclusion reasons. Do not claim a module subset is the whole application's coverage.

For JavaScript/TypeScript, declare `format: "istanbul"` in both the prepared project and receipt. `raw_evidence` points to the native Istanbul coverage map: original file path → `{path, statementMap, s, branchMap, b, fnMap, f}`. Keep actual collector/converter name, version and command in tool (for example ast-v8-to-istanbul, not coverage.py). Add `source_sha256: {"original/project-relative.ts": "sha256"}` for every target and `provenance_evidence: [{path,sha256}]` with actual tool/version invocation, original raw V8 data when converted, and mapping validation to frozen original source bytes. Reviewer opens this chain and checks every case contributes real counters; the script rechecks hashes and source positions. Mapping/AST generation must include unhit statements and branch arms, not only paths observed by V8. A mapped module that cannot recover the original AST denominator is a limitation/repair, not 100%. Ignore pragmas/excluded paths require explicit scope review, never silently shrink denominators. Code lines are unique statement-start lines (a hit in any statement on that line counts); branches are separate typed source-location arms. Summary percentages are ignored. Reports with missing files/arms, invalid counts, changed source/provenance or incompatible denominators are rejected. Merge using original units; do not rename tool data as Python JSON. Missing branch units are not assumed to mean branch-free code without actual AST/tool evidence.

A receipt may be recorded after observation while independent evaluation is pending, but its counters are not displayed yet. The read-only viewer includes only current passed or confirmed-BUG scenes that satisfy the independent execution/evidence recording gate. Repairs, stale observations/source versions, damaged evidence, pending reviews, and AI inability do not contribute. Merge actual line/branch hit sets only for matching project, revision, source bytes, scope, collector version and denominators. Different projects remain separate; overlapping hits count once. Original source includes unhit lines/branches in the denominator, and zero-unit metrics never show 100%.

Coverage relationship scene rows show each scene’s latest actual execution across saved runs, without run controls or identifiers. Code measurement and its completed/remaining-scene counts remain a separately labeled recent collection; do not combine counters or imply this collection covers all displayed latest scene results. Where valid counters exist, show each project's line/branch percent with covered/total, measured source scope, measured/completed scene counts and capture time; scope/version/exclusions and linked contributing scene titles expand in place. Global statistics do not change when filtering the relationship table. Auto-refresh follows existing five-second live records, and finishing the run retains the last cumulative result. This indicator does not prescribe a stop threshold or assert full acceptance.


### Fixed collection policy and per-scene obligations

For every acceptance run, use live execution coverage by default. The launcher applies `run_workflow.py ... --execution-coverage required` unless the user explicitly selects `--execution-coverage off`. This is independent of `--coverage-mode coverage` enhancement. The launcher writes execution-coverage-policy.json `{mode: required|off}`, persists it in workflow-sessions.json, rejects resume changes and supplies it to the active roles. `playbook.py new-run` inherits it (or accepts the explicit flag outside a session) and freezes the same coverage_policy in run.json and hash-bound execution-plan.json. Read it on each new/repaired run; no role may drop/disable it. An already ended run cannot be backfilled; rerun actual scenes on a fresh run.

In required mode, scenario preparation must save binding.coverage_collection.projects. Include the main product and every code-source project of the frozen scene, each once. Every entry includes project_id, project_label, project_root, revision, scope {targets, exclusions, basis}, a concrete reason, evidence (current-run capability outputs), and status available or unavailable. Available entries also have tool {name, version, command} and format (`coverage.py` by default, or `istanbul`); verify/configure appropriate tools, using isolated environments where suitable. The command identifies the actual collection invocation and must match the receipt. Unavailable entries instead include `unavailability_kind: runtime_unsupported|access_restricted` and recovery_attempts [{action, result, evidence:[refs]}], explaining actual target/runtime or authorization limits, remedies tried and why the declared sources cannot be measured. An absent package alone, SKILL parser rejection or successful raw collection awaiting conversion is not evidence of target inability. Preparation pins these evidence hashes; include them in observe.evidence as well.

During actual case/manual execution, collect raw counters for the declared original sources without weakening assertions; record command/exit/tool version and same-attempt raw JSON alongside behavior evidence. Multi-case scenes collect each case and merge compatible hit sets, never percentages. Save the immutable receipt after observe and before independent evaluate. No receipt from another scene/attempt/run can satisfy the obligation.

Reviewer opens capability evidence, actual invocation, original source bytes, scope and raw counter units. Author assessment.execution_coverage `{status: verified, projects:[{project_id, status: measured|unavailable, reason, evidence:[refs]}]}`. Each measured row cites capability evidence and raw JSON; each unavailable row cites actual remedy evidence, validates the reason and describes affected scope. The CLI requires every available project to have a matching current receipt and independent verification before a normal passed/confirmed-BUG conclusion; unavailable projects require the independently supported explanation. Missing/invalid counters return repair_required in the same scene, with no BUG classification or automatic exemption. check-scenario, next-scenario and finish-run repeat this obligation. For demonstrated AI inability before measurement, assessment.execution_coverage instead records status not_completed, a concrete reason and cited capability evidence; no counters are fabricated.

The UI always states the fixed policy and, when required, shows per-scene collection states: waiting for preparation, collecting, awaiting independent review, collected/verified, unavailable pending/verified, or missing/invalid collection requiring correction. Unavailability exposes reason, affected file scope and attempts; it is never silently hidden. Only current independently completed scenes contribute to numerical totals. No collection percentage or counter threshold decides a product pass, BUG or stopping condition.

### Intent-scoped cumulative coverage

The denominator follows the test intent, not a universal PR setting and not the set of files already visited by tests. Explicit user scope wins. Otherwise infer from the confirmed target: whole-project regression -> project; a module/directory task -> directories; explicitly selected files -> files; a single-commit verification -> commit_changes; PR acceptance -> pr_changes. If several materially different scopes remain plausible, explain the concrete alternatives and ask before freezing; do not make the user choose ordinary technical exclusions. Independent Reviewer checks the same intent and inventory used for collection.

Before new-run in required live-coverage mode, Analyst records `project.json.coverage_subjects`, one entry per component. Every entry has kind, intent (what is being verified), basis (why this denominator matches that intent), project_id/project_label/project_root/revision, complete source_paths and excluded_paths [{path,reason}]. Kinds and selection fields:

| kind | Selection | Denominator |
|---|---|---|
| project | Entire frozen repository component | All original executable line and branch units; explain excluded tracked content |
| directories | directories: project-relative directory paths | All original units under these directories |
| files | selected_paths: explicitly selected project-relative files | All original units in these files |
| commit_changes | changes: actual parent base_revision and commit head_revision | Executable new-side modified lines and changed-decision exits |
| pr_changes | changes: verified PR diff base_revision/head_revision and pr_url | Executable new-side modified lines and changed-decision exits |

Full-file kinds enumerate the frozen Git tree, not just loaded files. Changes kinds enumerate the full Git diff. Every selected/nondeleted file is either source or a justified exclusion. Client/server can have different scope kinds if their intents differ; label each separately. Original file hashes and complete native units are mandatory, including unloaded/unhit units. Missing coverage is neither zero nor a reason to remove the file from the denominator. Invalid/incomplete/unavailable coverage shows a reason and affected scope rather than a percentage or a hidden section. A known inability must cite the actual capability/recovery evidence through the existing collection records.

Reviewer runs `python3 <skill>/scripts/coverage_subjects.py <project> --test-dir <test-dir>` and saves `coverage_review.json.coverage_subject_review` with status passed, returned subjects_sha256, reviewer_kind independent_ai|playbook, review_reference and a concrete reason. new-run rejects missing, invalid or unreviewed scopes before creating the run directory. project.json and coverage_review.json are already hash-frozen for the run. Updating the intent or denominator requires fresh review and a fresh run, never rewriting completed results. Old runs without this definition show an explicit missing-scope explanation and cannot claim a current overall metric.

The UI primary block is 被测范围累计覆盖率. It displays each component's scope kind, line/branch covered/total and percentages (zero denominator -> 不适用), contributing completed scenes, test intent, identification basis, versions, concrete files, diff lines and exclusions. Filtering or completing new scenes changes the numerator only; it never changes the predefined scope. All scenes union per-file hit sets only with matching original hashes, complete denominators and tool/version. Different scene subset scopes can combine, but incompatible original-file units cannot. Whole-file per-scene groups remain auxiliary diagnostics, never a substitute for the defined denominator. Code execution is an indicator and does not determine the product verdict or a stopping threshold.

### PR and commit modification details

When the tested object is a PR and the user wants its changed-code coverage, the primary metric is the PR's changed executable lines and changed decisions, not each scene's selected whole files or the entire application. Before creating the run, record reviewed `project.json.coverage_subjects`, one entry per component:

```json
{
  "kind": "pr_changes",
  "intent": "验收该PR修改的客户端行为",
  "basis": "用户指定被测对象为该PR修改代码",
  "project_id": "client",
  "project_label": "客户端",
  "project_root": "/absolute/client/root",
  "revision": "FULL_FROZEN_PRODUCT_COMMIT",
  "changes": [{"pr_url": "https://github.com/owner/repo/pull/123", "base_revision": "FULL_DIFF_BASE_COMMIT", "head_revision": "FULL_PR_HEAD_COMMIT"}],
  "source_paths": ["src/changed.ts"],
  "excluded_paths": [{"path": "README.md", "reason": "文档没有可执行语句"}]
}
```

Use actual PR diff base (normally the verified merge base) and PR head, never the current moving target branch or a merge commit's arbitrary parent. Every nondeleted changed file belongs to source_paths or a concretely explained excluded_paths entry. Reviewer verifies that the exclusions are nonproduct/nonexecutable, not omitted hard-to-test code. Full immutable commits are required. The PR head bytes must match the frozen/current measured bytes for each selected original source. If later PRs changed the same file, first establish a reviewed combined PR baseline or exact line remapping; this implementation rejects stale line numbers. It does not infer PR identity from a branch name. Deleted-only code has no executable units in the new version. Renames use deletion/addition semantics and are disclosed through the Git diff.

Required preparation includes the subject's entire source_paths for each relevant component, even if this scene visits only a subset. Configure native collectors to enumerate unhit original executable units, including unloaded files. A missing inventory is not zero coverage, and cannot be excluded to improve a percentage. Preserve genuine runtime/access inability reasons; if the complete PR denominator is unavailable, show which changed files are missing and why, with no overall percentage. Freeze this definition in project.json before new-run; a scope change invalidates the old run's ledger binding and requires a fresh run, never reinterpret old completed results in place.

The changed-line set is the union of new-side Git diff hunks. Line units are the collector's original executable line anchors that fall in this set. Branch units are ALL exits of decisions whose original source anchor falls in this set: coverage.py arc source line, Istanbul parent decision start line, including implicit else. This is changed-decision coverage, not every unchanged enclosing branch or all branches in a modified file. A multiline condition change whose anchor was not changed is outside this anchor metric and must be disclosed in independent review; do not claim semantic coverage of every modified expression. The UI names it PR修改分支覆盖率 and explains this rule. Comments, blanks, removed code and zero branch denominators never fabricate 100%; a zero executable denominator is 不适用.

Only verified, independently completed current-attempt receipts enter the cumulative metric. Union hit sets per original file across scenes with different subset scopes, retaining source hashes and identical complete per-file denominators and tool versions. Never add covered counts or average percentages. Each client/server component has one PR metric with covered/total, contributing scene count, PR links/base/head, changed lines and exclusions. Whole-file scope groups remain secondary diagnostics, explicitly not the PR metric. Missing PR metadata, missing file inventories, inconsistent mappings or source versions display the precise reason instead of hiding the section.
