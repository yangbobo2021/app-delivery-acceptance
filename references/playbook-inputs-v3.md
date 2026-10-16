# v3 Playbook request inputs

Place each request JSON and all resulting artifacts under the selected test-assets directory. These are data contracts; project paths and commands are inputs, never hard-coded Skill policy. Use a fresh output directory for a new invocation. Model roles receive the supplied data only and do not scan the project or execute tests.

## Whole-list analysis

Run `node <skill>/playbook/v3/preanalysis/run.mjs create|edit request.json output-dir`.

Skip this flow for a PR with zero original requirements. Its reverse-analysis request still carries `requirements.items: []`, `analysis.requirement_groups: []`, and a scope/goal grounded in independent project contracts or explicit user direction.

```json
{
  "mode": "create",
  "project_root": "/absolute/git/checkout",
  "requirements": {
    "version": "source-version",
    "shared_constraints": "verbatim confirmed shared text",
    "items": [{"id": "R1", "title": "...", "text": "verbatim original requirement"}]
  },
  "user_constraints": [{"id": "U1", "description": "...", "source_quote": "..."}]
}
```

For `edit`, add `previous_analysis`, `allowed_changes` (subset of `business_goal`, `confirmed_scope`, `requirement_groups`), optional `allowed_scope_changes`, and feedback with its source. The gate keeps all original IDs and refuses unauthorized section changes. Output `analysis.json` is versioned; it is not an approval for new requirements. The flow has one Analyst call and no Reviewer.

## One commit's white-box reverse analysis

Run `node <skill>/playbook/v3/reverse/run.mjs request.json NEW-output-dir` in an isolated Git checkout. For a PR, use the target branch/ref as `base_revision` and the frozen PR head as `head_revision`; the inventory computes their merge base. Fetch/resolve both refs before invocation and restart downstream work if the PR head changes. Supply complete original `requirements` (an empty `items` array is valid for a code-only PR), `analysis`, independent `contract_files`, and `existing_rules` if any. For PR coverage supply explicit `pr_requirement_ids`, `test_modes`, `source_paths` for **all** project-owned non-test source files at the head, and `test_paths`/`noncode_paths`/`deleted_source_paths` for other changed paths. Expand changed direct Git submodules using `submodule_paths` and classify their tracked files. Unknown paths, missing/nested submodule checkouts and changed heads block PR-wide conclusions. `selected_paths`, when supplied, must equal all changed source paths. Large diffs are frozen in hash-bound chunks and the Agent reads them from one continuous task; no language-specific caller parser or mandatory caller dump is needed. Optional `context_files` remain bounded hints, not a substitute for autonomous source reading.

The single Agent identifies important, direct, observable changes; distinguishes original requirements, existing rules, independently supported new rules, unresolved behavior and nonbehavior changes; then checks its own evidence, wording, overlaps and likely important omissions before final output. Complete identification is not promised. Conditions inferred only from source must be stated as conditional; neither code nor same-PR specification is its own independent oracle. The structural gate checks every changed product file's disposition, frozen source/contract hashes, requirement and rule IDs, and contract quotations. `result.json` has `schema: commit-reverse-selfcheck-v1`, a hash-bound Agent trace, structurally valid draft and `status: completed`. It does **not** contain an independent Reviewer verdict. Only supported rules and affected original requirements can enter scenario generation. `needs_confirmation` remains visible but cannot become an executable target. A contract edited in the same PR needs a prior user decision in `confirmed_contract_paths` to count as independent. Previously confirmed rules preserve their original text and basis.

`contract_files` accepts project-relative paths. For a contract from another Git repository, supply a snapshot descriptor such as `{"path":"/absolute/snapshot.txt","source_repo":"/absolute/other-repo","source_ref":"full-40-character-commit-SHA","source_path":"relative/path/in/other-repo.txt","sha256":"optional-declared-snapshot-hash"}`. The host verifies the snapshot against the immutable Git blob before the Agent runs and again at every downstream binding and case execution. The rule's `contract_source` is the descriptor's exact `path`. This is a project-neutral evidence binding, not a language parser or a claim that the external implementation is automatically the intended business contract.

If the read-only Agent is interrupted before submitting a valid draft, start a new immutable attempt after confirming the prior process stopped; this may repeat source reading but has no external effects. `--resume` with the same frozen request/output is only for a saved valid draft whose structural gate or artifact publication was interrupted. A changed request, source, scope, contract or PR head needs a new output directory. There is no separate reverse review or `--revise-from` loop. A business question stays `needs_confirmation` until an independent decision changes the frozen input.

## One requirement's scenario list

Run `node <skill>/playbook/v3/scenarios/run.mjs unique-label request.json output-dir`.

```json
{
  "project_root": "/absolute/git/checkout",
  "target_requirement_id": "R1",
  "scenario_kind": "BLACK_BOX",
  "requirements": {"version": "...", "shared_constraints": "...", "items": [{"id": "R1", "text": "..."}]},
  "analysis": {"business_goal": "...", "confirmed_scope": {}, "requirement_groups": []},
  "user_constraints": []
}
```

Pass *all* requirements to every single-requirement invocation. The target ID sets ownership; group members are only relevant context. The output is `scenarios.current.json`, `review.current.json`, gate reports, metrics and a terminal result. A review must approve before execution.

For a PR black-box target, additionally pass `pr_reviewed_reverse_path` and `pr_reviewed_reverse_sha256` from its completed frozen change analysis to the scene and case requests. The target must be one of the frozen `pr_requirement_ids` and `BLACK_BOX` must be selected. The case runner binds its trace to the same PR inventory/head; it does not import white-box rules into black-box scenario design.

For `WHITE_BOX`, keep the original `requirements` list and set `target_requirement_id` to an affected original requirement or a supported reverse-rule ID. Supply `reviewed_reverse_path` and its SHA-256 from the commit reverse-analysis `result.json` (the transport field retains its old name, but it no longer implies independent reverse review). The runner derives executable `reverse_rules` and `source_evidence`, checks current HEAD and source/contract hashes, and freezes the binding. Do not pass a hand-authored completion status. The scenario generator and its independent Reviewer then design scenes owned by that single target. Code-derived rules never replace the original list.

## One scene's cases and execution

Run `node <skill>/playbook/v3/cases/run.mjs unique-label request.json output-dir`, then `--resume` with the same request and output directory after a parked implementation or evidence handoff. The request has:

```json
{
  "project": {"id":"project-id","root":"/absolute/checkout","revision":"git HEAD","sources":["relative/original-source"]},
  "requirements": [{"id":"R1","text":"verbatim text","source":"source reference"}],
  "scene": {"id":"R1-S1","requirement_id":"R1","title":"...","description":"...","priority":"P1","priority_reason":"..."},
  "business_goal": "...",
  "confirmed_scope": {},
  "case_catalog": [
    {"id":"C1","kind":"automated","origin":"existing","title":"...","description":"...","selector":"...","test_file":"tests/example","command":["test-tool","..."],"success_markers":["specific result"]},
    {"id":"C2","kind":"manual","origin":"manual","title":"...","procedure":"concrete operator actions and observations"}
  ],
  "coverage": {"policy":"off"},
  "contract_evidence": {"source":"...","basis":"..."}
}
```

Supply a complete candidate catalog from shared project preparation, including useful existing tests, potential new tests and manual operations. Do not pass a preselected answer as if the designer chose it. A new case may point to a test file that does not yet exist. At `caseImplementation`, the host can ask a restricted repairer for an exact test-file edit, validate it against the selected catalog paths and project source inventory, record the intent and before/after hashes, then run the selected case. If it cannot produce a safe, grounded edit, the Playbook parks for inspection. A manual operation parks until an actual operator supplies `attempt-N/manual-results.json` with observations and local evidence. The script never simulates manual success.

Include the main requirement and only directly relevant upstream requirements in `requirements` when their contracts affect valid test inputs or expected outcomes. The runner sends the main item as the acceptance target and the others as read-only context for the designer and Reviewer. Do not expand scenario ownership or copy the entire unrelated requirement list into every case prompt.

For a `WHITE_BOX` scene, also supply `reviewed_reverse_path` and `reviewed_reverse_sha256` in the case request. The runner checks that the selected rule has independent basis or the original-requirement impact is present, that the project revision and source/contract files still match, then puts original requirements and reverse rules into separate manifest collections. An unresolved rule cannot execute. Preserve the scene's approved list review as the input to the case handoff.

The designer's compact plan maps scene checks to selected catalog IDs. The deterministic gate freezes a manifest; `portable.py` executes exact commands; the independent Reviewer reads actual test code, logs and observations before a final judgment. A `repair_required` result keeps the scene in place and routes to scene, design, case-code or evidence repair. If the review marks case design as a gap, that route takes precedence over code editing. A selected automated test can then be repaired by a bounded edit and rerun in a new immutable attempt; an unresolved edit intent requires inspection before retry. External evidence repair resumes the same Playbook session. A `product_bug` judgment needs actual failed evidence from a credible test. For code coverage, replace the example `off` object with a project-supplied required collector contract from [portable-workflow-v3.md](portable-workflow-v3.md). If reliable original-source collection is impossible, use `{"policy":"unavailable","reason":"..."}`; retain `off` only when collection was explicitly skipped. `case_binding_ids: "selected"` is expanded to the actual selected automated cases by the plan gate; `{manifest}` in the collector argv resolves to the frozen manifest so a project adapter can run those exact selectors. The independent Reviewer verifies that relationship. If it cannot be proven, report coverage as unavailable or keep the run incomplete rather than borrowing a global suite's counters.

Each output directory records model calls, token usage, stage durations, frozen requests, checkpoints, effect receipts, plan/review gates and attempt artifacts. A blocked code repair writes `attempt-N/code-repair-handoff.json` with the reason and test-file hashes. An unchanged resume remains parked without another repairer call; an external test-only correction may resume into the next execution attempt, while a new independent business contract requires a new frozen request. An unresolved code-write intent or execution intent without a frozen result requires inspection before retry. On a process interruption, use `--resume` only after checking the previous process is gone and the checkpoint/input hashes still match. The runner checks the parked state and handoff before sending any continue event. A terminal output is never resumed.

## White-box handoffs

`playbook/v3/pipeline/materialize.mjs` has `reverse`, `scenario` and `case` modes. It takes a project-supplied template and writes one frozen child request plus `terminal.json` in a new output directory. Scenario mode requires a completed reverse result and target ID. Case mode additionally verifies the selected scene is in an independently approved scenario list. These deterministic handoffs can be ordinary dependency jobs in `pipeline/orchestrator.mjs`: whole-list analysis → reverse handoff → reverse analysis → scenario handoff → scenario design → case handoff → case execution. Include each terminal artifact and frozen input in scheduler receipts; on interruption, adopt only an accepted terminal with unchanged hashes. The scheduler does not make semantic decisions or replay an uncertain external execution.

For a full single-target PR pipeline, `materialize.mjs reverse` may first bind an approved whole-list `analysis.json` into a project-supplied reverse-request template. `scenario` accepts `scenario_kind: "BLACK_BOX"` for an original requirement in the frozen PR inventory as well as the white-box route. `case` accepts either kind and can pass a small, explicitly selected set of related original requirements as context; the selected scene still has one owner. The materializer verifies original IDs, approved scene identity, PR head and frozen reverse result, and records input hashes in its terminal artifact. The scheduler may run these handoffs consecutively without a model or human deciding the next stage.

Case handoff chooses either an exact `scene_id` or a nonnegative `scene_index` from the frozen, independently approved scenario list. Use `scene_index` only when the pilot intentionally chooses a position in that list; the chosen scene ID is then frozen into the case request. A generated scene ID from an earlier run is not a stable selector for a new list.

Scheduler job inputs and commands can refer to an accepted upstream output directory with `{{job.<job-id>.attempt}}`. The placeholder resolves only after that dependency has a completed, hash-bound receipt; use it when a downstream job must follow a retried upstream handoff rather than a fixed `-1` path.

For PR-wide scheduling, run `node <skill>/playbook/v3/pipeline/pr-targets.mjs result.json targets.json` after reverse completion. This lists all selected-mode requirement/rule targets, each with a unique `key` such as `BLACK_BOX:R1` or `WHITE_BOX:R1`, plus unresolved behaviors. Set `spec.pr_completion` to the targets file plus one entry per key, containing `key`, independently approved `scenarios_file` and `review_file`, and `case_jobs` mapping every approved `scenario_id` to its scheduler `job_id` and `trace_file`. Include the trace in that job's terminal artifacts. The scheduler rejects missing targets, missing scene judgments, or traces from a different head/inventory; unresolved behavior yields a `blocked` PR-wide state even if other jobs finish. Individual scenario and case Playbooks still own their model reviews and execution evidence.
