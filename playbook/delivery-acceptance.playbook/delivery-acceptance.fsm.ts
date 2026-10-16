import { assign, enqueueActions, fromPromise, raise, setup } from 'xstate';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type CoverageMode = 'standard' | 'coverage';
export interface MachineInput {
  readonly project: string;
  readonly testDir: string;
  readonly requirementsFile: string;
  readonly skill: string;
  readonly coverageMode?: CoverageMode;
}
export const concurrentRoleSets: readonly (readonly string[])[] = [];


const items = {
  "entry1": {
    "sourceItem": "ENTRY-1",
    "kind": "player",
    "role": "analyst",
    "prompt": "Check whether the supplied requirements file has confirmed, stable requirement IDs.\nPreserve all original requirement text/IDs and genuine scope decisions. Initialization/import only: do not generate units or scenarios in ENTRY-1. On ready proceed to ANALYSIS-1.\nIf IDs are absent or ambiguous, report the exact gap; do not generate or approve requirements.\nIf valid, run `python3 <skill>/scripts/playbook.py init <project> --test-dir <test-dir> --requirements <requirements-file>` on first use, or `import-requirements` when the approved source changed.\nFollow the ledger structure in the skill's `references/data-model.md`, keep the ledger under `<test-dir>/delivery-acceptance/` and ignored by Git, and put no real credential values in the ledger or evidence.\nUse `playbook.py` directly for ledger operations; never invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session.\n> <project>\n> <test-dir>\n> <requirements-file>\n> <skill>\n> <coverage-mode>",
    "result": {
      "ready": "The requirements file has confirmed, stable requirement IDs and the applicable first-use initialization or changed-source import is complete.",
      "requirementsGap": "Confirmed, stable requirement IDs are absent or ambiguous; the exact gap is reported without generating or approving requirements, and the workflow finishes as incomplete acceptance. Output shall include `failureDetails: <exact requirements gap>`.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "sourceAnalysis": {
    "sourceItem": "ANALYSIS-1",
    "kind": "player",
    "role": "analyst",
    "prompt": "Read references/design-pipeline.md and references/white-box-rules.md. Analyze the complete original requirements first. This workflow stage is acceptance.\nFor black-box stage, write an explicit empty reverse-rule inventory and explain that no implementation analysis is requested. For acceptance stage, inspect the actual implementation and record all material reverse rules before any acceptance organization. Use existing confirmed requirements when sufficient; separately assess supplemental-rule correctness and current-change applicability. Persist out-of-scope/pending candidates visibly, with reasons; never expand the agreed scope.\nWrite source-analysis.candidate.json with stage, complete original and discovered rule IDs, actual inspected code paths/hashes and substantive analysis bases. Run complete-analysis --input then check-analysis. Do not create units, scenarios, tests or resources in this phase. A newly discovered required business ambiguity needs the real user answer; never invent approval.\nUse playbook.py directly, keep fixed paths and confirmed exclusions, and never start another Playbook session.\n<project>\n<test-dir>\n<skill>",
    "result": {
      "done": "The source analysis was completed and persisted; proceed to ANALYSIS-GATE.",
      "requirementsGap": "Actual required business/source gap prevents analysis. Output shall include `failureDetails: <exact gap>`; finish incomplete.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "analysisGate": {
    "sourceItem": "ANALYSIS-GATE",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check-analysis '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/analysis-gate.json",
    "result": {
      "passed": "Zero exit verifies current complete source analysis; proceed to ORGANIZATION-DESIGN.",
      "failed": "Nonzero exit reports exact analysis-gate.json path and returns to ANALYSIS-1 while fewer than three attempts have occurred; otherwise finish incomplete. Increment sourceAnalysisRounds once per ANALYSIS-1; suspension/recovery never resets it. Captain claims cannot set analysisGatePassed."
    }
  },
  "organizationDesign": {
    "sourceItem": "ORGANIZATION-DESIGN",
    "kind": "player",
    "role": "analyst",
    "prompt": "Generate the entire acceptance-plan.candidate.json from frozen source-analysis.json, full original requirements and all reverse rules. Read references/acceptance-organization.md and references/design-pipeline.md. Include all original check dispositions and all active reverse-rule ownership via units[].rule_ids; pending/outside rules remain candidates outside units.\nBuild every acceptance unit and all global journeys before generating any scenario. Bind source_analysis_sha256 and semantic rules_sha256. Run check-plan --draft --input. Reuse an unchanged already published organization only after current check-plan; do not silently republish it.\nReturn done only with the entire candidate ready for independent review. Preserve current user scope and actual decisions.\n<project>\n<test-dir>\n<skill>",
    "result": {
      "done": "Entire organization is generated; proceed to ORGANIZATION-1 for independent review.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "organizationReview": {
    "sourceItem": "ORGANIZATION-1",
    "kind": "player",
    "role": "reviewer",
    "prompt": "Read references/design-pipeline.md and references/acceptance-organization.md, completed source-analysis.json, complete original requirements, all white_box_rules.json items and acceptance-plan.candidate.json. Independently reconstruct behavior/conditions/recovery/invariants from original text, then verify original-to-unit and unit-to-original mapping, overall business context and selected boundaries.\nWrite acceptance-plan-review.candidate.json with all five independent judgments including rule_provenance, every original requirement ID and every discovered rule ID (including out-of-scope/pending rules), plan_sha256 and actual independent reviewer identity. Independently check rule contract/invariant provenance, current-scope applicability and full rule-to-unit ownership. Regrouping must not invent or omit rules. Ordinary organization needs no Boss approval.\nIf sufficient, run publish-plan with the candidate, independent review and actual expected-version. Never overwrite formal scope directly. Reuse an unchanged published plan only after check-plan; do not increment unchanged plans. Confirmed exclusions apply across names and IDs.\nReturn passed only after substantive review and successful publication/check. On repairable gaps return gaps with exact failureDetails. Ask Boss only about genuine missing business decisions; persist the real answer before revalidation.\n<project>\n<test-dir>\n<skill>",
    "result": {
      "passed": "organization independently reviewed and published; proceed to ORGANIZATION-GATE.",
      "gaps": "Analyst repairs named gaps at ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred; otherwise finish incomplete with exact failureDetails. This counter is separate from scenario/coverage rounds and never reset by recovery.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "organizationRepair": {
    "sourceItem": "ORGANIZATION-REPAIR",
    "kind": "player",
    "role": "analyst",
    "prompt": "Repair only named organization gaps without changing original requirements or user decisions. If a genuine new source rule is required, return requirementsGap with exact reason and restart through source analysis in a new session; do not edit the frozen rule inventory in scene generation. Run check-plan --draft --input before returning done to ORGANIZATION-1. Never author independent review or overwrite the formal plan.\n<project>\n<test-dir>\n<skill>\n<failure-details>",
    "result": {
      "done": "candidate repaired; return to ORGANIZATION-1.",
      "requirementsGap": "genuine business ambiguity remains; finish incomplete with exact failureDetails.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "organizationGate": {
    "sourceItem": "ORGANIZATION-GATE",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check-plan '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/organization-gate.json",
    "result": {
      "passed": "Zero exit verifies current organization and independent review; proceed to RESOURCE-1.",
      "failed": "Nonzero exit sets failureDetails exactly to \"Organization gate failed; inspect <test-dir>/delivery-acceptance/organization-gate.json\" and enters ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred, otherwise finish incomplete. Never replace script execution with a Captain assertion. Increment the separate organization counter once per ORGANIZATION-1, maximum three; recovery never resets it."
    }
  },
  "resource1": {
    "sourceItem": "RESOURCE-1",
    "kind": "player",
    "role": "analyst",
    "prompt": "Read prior ledger decisions, project documentation, and configuration.\nVerify only resources required by selected acceptance units. Each decision needs scope.status in_scope/out_of_scope, unit_ids and basis; unrelated old integrations do not block. Explicit real-integration exclusions require actual user decision_id and remain unverified; Mock business dependencies still require preflight. Verify application commands, devices, identities and reset for the selected scope.\nPersist decisions and their verification evidence in `resources.json`, so future runs can reuse them after validity checks.\nOnly when the fixed coverageMode is coverage, verify this project's actual collection tools, original-source mapping and scope under references/code-coverage.md; standard mode without required live execution coverage must omit this work. Read the fixed execution-coverage-policy.json; when required, follow references/code-coverage.md for per-scene capability, collection and review. Coverage-only tool absence is not an application dependency failure. When live collection is required, derive the denominator from the confirmed test intent and explicit user scope: project, directories, files, commit changes or PR changes. Persist project.json.coverage_subjects with kind, intent, basis, immutable revision/diff references and complete source_paths/excluded_paths. Read code-coverage.md intent-scoped cumulative coverage. Never choose only files visited by tests. Ask Boss only if scope ambiguity cannot be resolved from the authorized target.\nFollow the ledger structure in the skill's `references/data-model.md`, keep the ledger under `<test-dir>/delivery-acceptance/` and ignored by Git, and put no real credential values in the ledger or evidence.\nFor each third-party service, assess whether a faithful Mock supports the full application flow.\nTest the real integration separately and keep its evidence and tested adapter and version.\nIf Mock is viable, use it for later E2E flows.\nIf a Mock is absent, record its required behavior; create it only when its scenario enters preparation, in project test locations. Do not change application source.\nRead project testing conventions and record test_layout.paths and a concrete basis in project.json; use the existing project organization, not the results directory. Independent scenario review must inspect these paths before execution.\nAllow real third-party E2E only when Mock cannot represent the flow and repeatable credentials and resources exist.\nNeither a Mock flow nor an existing token proves real integration correctness.\nIf a resource, authorization, or business decision cannot be obtained using available tools, ask Boss one specific question and suspend.\nDo not ask Boss to approve ordinary scenario lists, plans, or gate outcomes.\nResume with Boss's answer, persist the resulting decision, and repeat resource verification.\n> <project>\n> <test-dir>\n> <skill>\n> <coverage-mode>",
    "result": {
      "ready": "Required resources and decisions are verified and persisted with evidence.",
      "environmentBlocked": "A required resource remains unavailable after Boss's answer; the workflow finishes as an environment-blocked incomplete acceptance rather than claiming acceptance. Output shall include `failureDetails: <exact unavailable resource>`.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "scenario1": {
    "sourceItem": "SCENARIO-1",
    "kind": "player",
    "role": "analyst",
    "prompt": "Read references/design-pipeline.md. Call design-next; for exactly that next unit call start-unit --unit ID before writing scenes. Generate only scenes owned by that unit, with generation_unit_id and scope.unit_ids referencing published ownership. Preserve all other unit scenes and any completed-unit review provenance. Use only the frozen original checks and already discovered, admitted reverse rules; never discover new reverse rules here.\nPersist each complete scene atomically into scenarios.json as it is produced so the live viewer shows this unit's actual progress. Then call complete-unit --unit ID; it validates coverage and protected other-unit records. Call design-next again. Return more if a next unit exists, otherwise done. Do not mark global completeness before every unit is generated and independently reviewed.\nUse design-quality-v4 and only included checks of the published plan, keeping all original requirements as background. Each exact criterion needs scope admission and each scene needs structured global business risk. Contract correctness is separate from this change's applicability. Necessary related checks require omission counterexamples; affected regressions require change impact references. Pending/outside-scope proposals stay outside active scenarios, even if old context proposes them.\nMap every selected requirement within the published plan to black-box scenarios covering important operation modes and user states, including normal, exceptional, boundary, and state-change behavior relevant to that requirement.\nEach scenario in scenarios.json must embed its own acceptance object with description, preconditions, actions, criteria and evidence_expected. Do not write methods.json or method_ids; existing/new cases and human simulation are chosen only during execution.\nDesign describes how to accept, without selecting existing/new cases or human simulation and without implementing test code. The execution preparation step makes that choice using requirements, white-box code, scenario intent, acceptance instructions and existing tests.\nAssign every black-box and white-box scenario priority P0/P1/P2/P3 and a concrete priority_reason following references/scenario-priority.md. Keep all scenarios regardless of execution scope.\nRecord the completeness assessment and its basis in the ledger.\nDo not write or self-approve `coverage_review.json`.\nFollow the ledger structure in the skill's `references/data-model.md`, keep the ledger under `<test-dir>/delivery-acceptance/` and ignored by Git, and put no real credential values in the ledger or evidence.\n> <project>\n> <test-dir>\n> <skill>\n> <coverage-mode>",
    "result": {
      "more": "Current unit was completed and another pending unit exists; proceed to UNIT-ADVANCE without incrementing scenario review rounds.",
      "done": "No generation units remain; proceed to GENERATION-GATE.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "unitAdvance": {
    "sourceItem": "UNIT-ADVANCE",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py advance-unit '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/unit-advance-gate.json",
    "result": {
      "passed": "Actual zero exit verifies the prior unit completed and a next pending unit exists; return to scene design. Never repeat a stale completion as forward progress.",
      "failed": "Nonzero exit finishes incomplete with the exact unit-advance-gate.json path, without generating another unit."
    }
  },
  "generationGate": {
    "sourceItem": "GENERATION-GATE",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check-generation '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/generation-gate.json",
    "result": {
      "passed": "Zero exit proves every published unit generated its bound scenario set; proceed to independent scene review.",
      "failed": "Nonzero exit terminates incomplete with exact generation-gate.json findings; do not enter scene review or execution and do not manufacture completion from agent output."
    }
  },
  "scenario2": {
    "sourceItem": "SCENARIO-2",
    "kind": "player",
    "role": "reviewer",
    "prompt": "Review current scope first, then coverage and global causal risk. Write acceptance_scope_review with independent identity, plan_sha256, exact scenario/dependency hashes from scope-review-hashes, scope_reason/priority_reason/causal_chain_review and global_priority_calibration. Full acceptance additionally reviews every resource applicability and real-integration exclusion. Outside-scope suggestions are nonblocking. No P0 quota or keyword-based upgrade. Before local changes archive-scope-review; retain only unchanged original judgments with immutable retained_from and matching dependencies; recheck affected coverage and mappings.\nIndependently challenge every selected requirement within the published plan against the scenario set: enumerate important operation modes and user states, propose plausible wrong implementations, and identify which linked scenario would visibly fail.\nFundamental review principle: for every selected requirement, a plausible wrong implementation in any important operation mode or user state must fail at least one linked acceptance scenario through an observable result; if an important fault could escape, reject the scenario set and name that counterexample.\nIdentify omissions or contradictions in the scenario definitions with specific requirement and branch references.\nCheck the inspected code branches.\nRead references/white-box-rules.md and independently verify every reverse rule, code/contract source and check-item mapping; record rule_reviews in white_box_priority_review, including needs_confirmation for unresolved business policy. Check-item design completeness does not confirm the policy. Include all white-box-priority-hashes keys.\nIndependently review each scenario's priority and reason; challenge underestimated high-risk exceptions/boundaries and unjustified P0/P1 inflation. Record black-box priority_reviews in coverage_review.json. Run `python3 <skill>/scripts/playbook.py white-box-priority-hashes <project> --test-dir <test-dir>` and record the hash-bound white_box_priority_review in the same file, including an empty reviewed list when there are no white-box scenarios. Priority disagreements are scenario gaps repaired by Analyst, never self-approved.\nRun `python3 <skill>/scripts/playbook.py review-hashes <project> --test-dir <test-dir>` and write or revalidate your per-requirement `coverage_review.json` using the schema in the skill's `references/data-model.md`; do not edit Analyst's scenarios or embedded acceptance.\nIndependently verify project.json.test_layout follows documented project test organization and cannot exclude application files from the product manifest. When live collection is required, independently verify coverage_subjects matches the stated test intent, source inventory, versions, diff boundaries and justified exclusions. Run scripts/coverage_subjects.py <project> --test-dir <test-dir> and author coverage_review.json.coverage_subject_review with status passed, subjects_sha256, reviewer_kind independent_ai or playbook, review_reference and concrete reason. Reject scope drift or missing denominator files; no numerical threshold proves acceptance.\nRun `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir>` and report the exact script verdict; the check's JSON is saved as `<test-dir>/delivery-acceptance/scenario-gate.json`.\nA suspected product defect already covered by a scenario is not a scenario coverage gap: preserve that scenario and enter execution so the behavior can be observed and reported.\nUse `playbook.py` directly for ledger operations and script gates; never invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session.\n> <project>\n> <test-dir>\n> <skill>\n> <coverage-mode>",
    "result": {
      "passed": "Independent challenge finds no material scenario omission or contradiction against confirmed requirements and inspected code branches, substantive counterfactual coverage holds, and the three script gates pass. Passing scenario design review means only that later real execution of the scenarios, with sufficient evidence, could support delivery within the agreed usage scope without an obvious defect; it does not prove the App works or that every possible bug is absent.",
      "gaps": "Independent challenge finds material omissions or contradictions with exact requirement and branch references, or a required script gate does not pass; a suspected product defect already covered by a scenario is not a coverage gap. If this is the third scenario review round, the exact gaps are reported as unproven and the workflow finishes as incomplete acceptance. Output shall include `scenarioFindings: <verbatim final text>`.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "scenario3": {
    "sourceItem": "SCENARIO-3",
    "kind": "player",
    "role": "analyst",
    "prompt": "Before repairing scene definitions, archive-scope-review and reopen-units --unit for each affected owner. Regenerate affected units one at a time with start-unit/complete-unit, and pass check-generation before returning for review. Repair the identified scenario omissions or contradictions, preserving confirmed requirement links or separately reviewed reverse_rule_ids and actual target code sources. Never silently approve a pending rule.\nUpdate the ledger's completeness assessment and basis.\nFollow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.\n> <project>\n> <test-dir>\n> <scenario-findings>",
    "result": {
      "done": "The acting agent completed the behavior.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "scenario4": {
    "sourceItem": "SCENARIO-4",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/scenario-gate.json",
    "result": {
      "passed": "The script's requirements, resources, and scenarios gates all pass, so execution may start.",
      "failed": "At least one required pre-execution script gate does not pass; do not start execution or claim full acceptance, retain and report the exact failed gate, and return to Analyst for repair and another review while scenario review rounds remain, otherwise finishing as incomplete acceptance."
    }
  },
  "scenario5": {
    "sourceItem": "SCENARIO-5",
    "kind": "player",
    "role": "analyst",
    "prompt": "Repair the structural issue the failed pre-execution gate reported in the applicable ledger definitions.\nUpdate the ledger's completeness assessment and basis.\nFollow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.\n> <project>\n> <test-dir>",
    "result": {
      "done": "The acting agent completed the behavior.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "execution1": {
    "sourceItem": "EXECUTION-1",
    "kind": "player",
    "role": "tester",
    "prompt": "If run-id is empty or names a completed prior run after an authorized design repair, choose a unique run ID and create `python3 <skill>/scripts/playbook.py new-run <project> --test-dir <test-dir> --id RUN_ID --revision PRODUCT_REVISION --environment ENVIRONMENT --coverage-mode <coverage-mode> --scenario-loop`.\nRead execution-coverage-policy.json before new-run; the checker inherits and freezes it as coverage_policy in run.json and execution-plan.json. Never turn required into off or drop it after a repair/new run. It is separate from coverageMode and never starts enhancement rounds.\nImmediately verify all resource decisions for this run and persist run-dependency records with actual evidence before any scenario begins. Existing resource discovery does not substitute for per-run checks. Keep product files and reviewed definitions fixed. Read this run's progress and execution-plan.json. Run `python3 <skill>/scripts/playbook.py next-scenario <project> --test-dir <test-dir> --run RUN_ID`. Only select the returned priority scenario; do not prepare or execute later scenarios.\nReturn selected with runId and scenarioId when one is available. The preceding scenario must already have a persisted independent verdict and a passed check-scenario gate.\nIf none is available, call finish-run to record all not_run items and close the run. Use --stopped only for an actual early stop. A partial scope or any not_run returns partialRecorded; otherwise recorded. Do not reset the deadline or merge previous run results.\nResults are visible during execution; every phase transition uses scenario-step and atomic writes. Never write run.json by hand.\n> <project>\n> <test-dir>\n> <skill>\n> <coverage-mode>\n> <run-id>",
    "result": {
      "selected": "Next permitted scenario selected. Output shall include `runId: <run ID>` and `scenarioId: <scenario ID>`; proceed to EXECUTION-PREPARE.",
      "recorded": "All selected scenarios have completed independent evaluation; full scope has no not_run. Output shall include `runId: <run ID>`; standard goes to EXECUTION-2, coverage goes to COVERAGE-1.",
      "partialRecorded": "Partial scope or unexecuted scenarios recorded; Output shall include `runId: <run ID>`; proceed to EXECUTION-2, never coverage loops.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "executionPrepare": {
    "sourceItem": "EXECUTION-PREPARE",
    "kind": "player",
    "role": "tester",
    "prompt": "Read the selected scenario, confirmed requirements, implementation branches, embedded acceptance instructions, project testing conventions and existing test implementations. Decide how this scenario can be faithfully accepted: reuse existing cases, implement new cases, simulate human operations, or combine them. No automation is mandatory when human simulation provides the required evidence.\nRead execution-findings and the saved repair_reason/attempt history. Repair the execution issue before repeating this same scenario; preserve original evidence. Begin only when pending with scenario-step --action begin; preparing is already begun and must be resumed. Persist the preparing phase before test design/implementation. Respect next-scenario and its started_at; do not start another scenario or edit reviewed scenarios or acceptance instructions.\nPrepare only this scenario's tests and reusable fixtures in project.json.test_layout paths, outside the results ledger. Record an execution binding: mode, reason, cases [{name, origin: existing_case|new_case, path, selector, command, sha256, procedure}], and manual_operations [{id, name, tool, entry_point, procedure}] for AI human simulation. Each procedure independently contains objective, preconditions, test_data, steps [{action, expected}], and scenario_checks [{scenario_id, criterion, scope, covered_point_ids, step_numbers}]. Criterion references exact frozen acceptance criteria; scope states this case/task subset. Describe actual read existing code, final newly implemented code, or actual manual procedure; never copy a scene plan or call expected results observed facts. Independent Reviewer verifies descriptions against implementation and union coverage; missing/inaccurate descriptions require same-scene test_design repair. The item dialog shows only the clicked case/task, business sections first and technical metadata collapsed. Bindings are per-run decisions, not design method kinds. Name every case by its tested business behavior; classify each case separately in combined mode. Newly created means created during this run, not a file originally authored in an earlier run. Unprepared scenes have no inferred associations.\nWhen coverage_policy.mode is required, read references/code-coverage.md. Prepare binding.coverage_collection.projects for the main product and all frozen code-source projects: exact project ID/name/root/revision, scope targets/exclusions/basis, actual available tool/version/command and capability evidence. Try appropriate configuration when a tool is absent. If genuinely unavailable, record concrete reason, affected source scope and recovery_attempts with actual action/result/evidence. Never classify an unattempted installation or missing configuration as unavailability. For genuine target inability record unavailability_kind runtime_unsupported or access_restricted. Native Istanbul format supports JavaScript/TypeScript; record format istanbul, original source hashes and actual collector/converter provenance under references/code-coverage.md. Successful raw collection rejected by the SKILL parser is a processing defect, never target unavailability; repair it in this scene. prepared rejects a missing declaration. Keep tools/environments outside tracked product files. For PR acceptance coverage, read the PR modification coverage contract: freeze reviewed project.json.coverage_subjects before new-run with exact PR diff base/head and tested product commits, complete source_paths and explained excluded_paths. Include every PR source in component targets and enumerate unloaded/unhit original units; per-scene visited subsets cannot replace the PR denominator. Do not change the frozen ledger in an active run.\nIf tracked test code changed, commit exactly this scenario's test changes as one descendant commit before returning testsPrepared. Do not stage existing user changes, edit product files, weaken failed assertions, or commit results. A no-code preparation returns ready and keeps HEAD/worktree unchanged. Use native repository effects; never hide test code with Git ignore rules. If a commit is disallowed by project policy, record blocked.\nRead references/case-design.md (case-design-v1). Create binding.case_design covering every frozen criterion with concrete check_points; assign points and exact step_numbers to each procedure. The planned union must cover all checks. Do not duplicate a scene operation_plan. Use scenario-step --action prepared --input BINDING_JSON to validate product invariance and persist executing phase. Save payload JSON under this run; binding references locate code in project test directories.\nIf preparation cannot proceed, first correct test setup/operation problems. Persist any remaining inability with scenario-step --action observe, actual reason, the selected scenario ID and evidence; return blockedRecorded for independent judgment, not automatic completion. Reviewer returns repairRequired for ordinary execution problems; only a demonstrated AI inability to complete after recovery permits a final execution_error. Confirmed product BUGs are recorded, never fixed during this run. Execution-related problems must be repaired within this same scenario before advancing.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <scenario-id>\n> <execution-findings>",
    "result": {
      "ready": "Prepared without repository changes; go to EXECUTION-OPERATE.",
      "testsPrepared": "Prepared with exactly one test-only descendant commit; go to EXECUTION-OPERATE. Repository disposition is one-descendant-commit.",
      "blockedRecorded": "Preparation blocker durably observed; go to EXECUTION-EVALUATE.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "executionOperate": {
    "sourceItem": "EXECUTION-OPERATE",
    "kind": "player",
    "role": "tester",
    "prompt": "Execute only this scenario using the chosen binding and acceptance method. Use the actual application/test target and operate the running UI for UI paths. Save actual logs, screenshots and observations that prove asserted behavior, not only command startup. Keep real integration and Mock E2E evidence separate; persist each dependency check in the run through an atomic ledger update.\nWhen required, collect counters during this exact execution using the prepared tool/scope, including each concrete case; combine their hit sets only within the scene/attempt and same denominator. Include capability evidence, actual invocation, raw coverage JSON and source/version evidence in observe.evidence/evidence_details. After observe and before evaluation, save the current-attempt receipt with scripts/execution_coverage.py. Do not replay silently or borrow old counters. If an available collector fails, preserve the error and enter the same-scene correction loop; do not advance or silently hide coverage. Preserve native V8/Istanbul data and mapping/version evidence; do not disguise it as coverage.py. Unsupported adapter, conversion or parser errors require correction, not an unavailable exemption.\nDo not change product code or test bindings in this step. Record actual observations faithfully. A confirmed product BUG is recorded without repair; an execution mistake, invalid test or insufficient evidence must return to preparation of this same scenario for correction and rerun. One passing subpath cannot erase another failed method.\nUse scenario-step --action observe --input OBSERVATION_JSON with status, actual, evidence paths relative to this run and separate case_results for every bound task, factual summary and step_results for each actual procedure step. Each task owns its evidence; never inherit sibling observations. Immediately after each task finishes, save scenario-step --action case-result for live progress before aggregate observe; the final observation must preserve these facts. It stores evidence hashes and the observation hash and enters evaluating. Record any inability to operate as blocked/unproven with evidence; do not stop later scenarios merely because this one fails.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <scenario-id>",
    "result": {
      "observed": "Actual observation and evidence persisted; go to EXECUTION-EVALUATE.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "executionEvaluate": {
    "sourceItem": "EXECUTION-EVALUATE",
    "kind": "player",
    "role": "reviewer",
    "prompt": "Independently inspect this scenario's requirements, intent, method criteria, code and selected execution binding. Open the actual evidence. Verify case names, precise selectors and this-run existing/new origins against actual preparation and code history; manual bindings must describe actual AI tools/operations without invented human clicks. Read each case/manual procedure and compare its purpose, preconditions/data, action/expected pairs and assigned scenario_checks with actual code or operations. Check precise subset coverage and the union of all bound cases/tasks against the frozen criteria; no individual case pass proves the whole scene. Missing, copied or inaccurate descriptions require same-scene test_design repair. Read references/case-design.md and independently author assessment.case_coverage by actual code/operation inspection, every frozen criterion/check point and exact case step contribution; duplicate checks cannot replace missing points. Missing semantic coverage requires same-scene test_design repair. Case design coverage is distinct from execution pass. Judge whether it proves the scenario; do not infer success from a command exit alone or from Tester assertions.\nWhen coverage_policy.mode is required, independently inspect coverage_collection, actual commands/counters, original source/version/scope and current receipt, or the evidence and attempted recovery explaining unavailability. Author assessment.execution_coverage with status verified and one project row {project_id, status: measured|unavailable, reason, evidence}. Cite capability evidence and the actual raw JSON in measured rows; unavailable rows cite actual recovery evidence and explain affected scope. Available-but-missing/invalid counters require repair_required, not a product BUG or unavailable exemption. Verify unavailable claims are target runtime/access limitations with the explicit unavailability_kind; raw data already collected but awaiting SKILL parsing is a processing repair. For Istanbul independently audit raw collection, original-source mapping, tool version, all unhit AST units and compatible denominators before accepting measured. Normal final verdicts and check-scenario reject omitted coverage obligations. For PR indicators, independently verify coverage_subjects against exact Git diff and original bytes, justified nonexecuting exclusions, every changed-source inventory and all changed-decision exits. Cumulative PR data may union only compatible original-file units of completed scenes; state missing denominators rather than inventing zero or averaging scene percentages. For demonstrated AI inability before measurement, record execution_coverage status not_completed, concrete reason and cited capability evidence; never invent counters.\nClassify product behavior separately from execution quality. Final normal verdicts are passed or failed (confirmed BUG with bug_description). Missing evidence, invalid case/assertion/setup or incorrect operation is repair_required with problem_kind evidence/test_design/execution, a specific correction reason and cited evidence; return repairRequired to this same scenario preparation. Do not advance, mark these as BUGs or leave ordinary recording problems as final unproven.\nPersist scenario-step --action evaluate --input VERDICT_JSON: status passed/failed/repair_required/execution_error, reason, evidence, reviewer_kind playbook or independent_ai, review_reference and result_sha256 from this scenario progress record. execution_error is exceptional: describe capability_problem and recovery_attempts proving AI cannot complete; retry count alone never proves that. Scenario attempts are preserved in attempt_history and execution_repairs; do not overwrite old evidence. Product code remains fixed throughout retries. Never modify Tester observations, evidence, product code, acceptance instructions or cases.\nThe CLI binds the verdict to the observation/evidence. repair_required archives the attempt and returns to preparing, without completing the scenario or advancing priority. passed, confirmed BUG and exceptional AI execution_error complete this scenario; BUGs and AI exceptions create distinctly typed issues. These final verdicts proceed to EXECUTION-SCENARIO-GATE, then the next scenario. Do not repair product BUGs during this run.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <scenario-id>",
    "result": {
      "evaluated": "Independent final verdict (pass, confirmed BUG or exceptional AI inability) and any issue durably recorded; proceed to EXECUTION-SCENARIO-GATE.",
      "repairRequired": "Non-BUG execution problem recorded and attempt archived; Output shall include `executionFindings: <specific correction needed>`; return to EXECUTION-PREPARE for the same scenario.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "executionScenarioGate": {
    "sourceItem": "EXECUTION-SCENARIO-GATE",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check-scenario '<project>' --test-dir '<test-dir>' --run '<run-id>' --scenario '<scenario-id>'",
    "result": {
      "passed": "Lifecycle, binding, evidence hashes, independent evaluation and unchanged product validated; return to EXECUTION-1 after a final pass, confirmed BUG or exceptional AI inability. Ordinary execution problems cannot reach this gate.",
      "failed": "Recording invariants failed; proceed to EXECUTION-RECORD-REPAIR for independent diagnosis and correction of this same scenario, never advance or repair product code."
    }
  },
  "executionRecordRepair": {
    "sourceItem": "EXECUTION-RECORD-REPAIR",
    "kind": "player",
    "role": "reviewer",
    "prompt": "Rerun check-scenario and inspect the exact error and current scenario record. Ordinary execution/recording problems must be repaired in the same scenario, not accepted as final blocked/unproven or mistaken for BUGs.\nFor a repairable record problem, call scenario-step --action reopen --input REOPEN_JSON with reason, reviewer_kind and review_reference. Only the current completed scenario may reopen before any later one begins. The CLI archives its observation/verdict and retains prior findings, then returns it to preparing for correction, rerun and independent evaluation. Return repairRequired with exact executionFindings. If a dependency check is missing, require it before prepared/execute on the retry.\nDo not alter old evidence, product files or reviewed definitions. If product/definition invariance has been invalidated by external changes, preserve the run and return invalidated with exact failureDetails requiring a new run; this is a run validity failure, not a final ordinary execution verdict. Never repair product code in this workflow.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <scenario-id>",
    "result": {
      "repairRequired": "Current scenario reopened for correction and rerun; Output shall include `executionFindings: <exact recording problem to fix>`; return to EXECUTION-PREPARE.",
      "invalidated": "Product revision or reviewed definitions have externally changed, so this run cannot remain valid; Output shall include `failureDetails: <exact invariant failure and required new-run reason>`; finish incomplete preserving this run.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "execution2": {
    "sourceItem": "EXECUTION-2",
    "kind": "player",
    "role": "reviewer",
    "prompt": "Open the actual evidence and compare it with each executed scenario's expected behavior. Review remaining scenarios as unproven with the recorded not_run reason, without claiming evidence for unexecuted paths.\nInspect the frozen execution plan and ordered results. For a limited scope or any not_run item, produce the graded execution/evidence summary and remaining risks, run the checker for the reports, and return partial rather than sufficient or repairable. An actual product failure still returns productFailed. Budget/scope exhaustion is not itself a product defect and must not restart execution or coverage loops.\nIndependently inspect the confirmed requirements, implementation, scenarios, available gate reports, and actual evidence.\nCheck black-box coverage and material implementation branches.\nVerify the fixed coverage policy was satisfied by every completed scenario: real reviewed counters or independently supported unavailability, visible with reason in the coverage relationship view. finish-run and check-scenario must not let available-but-uncollected scenes silently settle. No percentage threshold or coverage-driven supplement loop is introduced.\nSummarize the persisted per-scenario verdicts in review.json without changing their status, reason or evidence. Review not_run scenarios as unproven. Include uncovered branches, review basis and pinned product revision. Per-scenario evaluation has already happened during execution.\nKeep the pinned product manifest fixed; test-only commits do not change the product revision.\nChange no application code or other ledger definitions during this review.\nRun `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir> --run <run-id> --coverage-mode <coverage-mode>`, inspect `gate-report.json`, `run.json` and `review.json`; the coverage relationship view is the user report, so create no extra report or supplement-process entry, and report the exact script verdict.\nA passing script report never substitutes for your substantive evidence judgment.\nFundamental review principle: for every selected requirement, a plausible wrong implementation in any important operation mode or user state must fail at least one linked acceptance scenario through an observable result; use this counterfactual principle when unsure how to review.\n> <project>\n> <test-dir>\n> <skill>\n> <coverage-mode>\n> <run-id>",
    "result": {
      "sufficient": "Every required scenario's outcome is proven by sufficient evidence and all five base script gates pass and the additional code_coverage gate passes only in coverage mode, with reasoned verdicts for the exact revision recorded in `review.json`.",
      "repairable": "The independently reviewed definitions or frozen run baseline require correction; Analyst corrects those definitions and Tester starts a new run repeating every required scenario. Ordinary case, operation, evidence or scenario-recording defects must already be corrected inside that scenario, never deferred to this aggregate branch. If this is the third execution and review round, the workflow reports incomplete acceptance with those items instead. Output shall include `reviewFindings: <verbatim final text>`.",
      "partial": "The frozen scope is partial or some scenarios are not_run, and independent review of available evidence is complete. Output shall include `reviewFindings: <verbatim final text>`. Treat this as a terminal negative settlement: evidenceSufficient and runGatePassed stay false; fix failureDetails from reviewFindings and preserve the terminal runId; go to COMPLETION-1 and then incomplete, never another execution/coverage round.",
      "productFailed": "Actual behavior fails or a required path cannot be operated; a product failure finishes as incomplete acceptance. Output shall include `reviewFindings: <verbatim final text>`.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "execution3": {
    "sourceItem": "EXECUTION-3",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' --run '<run-id>' --coverage-mode '<coverage-mode>' --require-scenario-loop",
    "result": {
      "passed": "The script's requirements, resources, scenarios, execution, and review gates pass for this run, and a zero exit permits full acceptance.",
      "failed": "At least one script gate fails for this run; retain and report its exact failures. Analyst then repairs the reported structural issue and Tester starts a fresh full run while execution and review rounds remain; otherwise the workflow reports incomplete acceptance."
    }
  },
  "execution4": {
    "sourceItem": "EXECUTION-4",
    "kind": "player",
    "role": "analyst",
    "prompt": "Correct the applicable ledger definitions so the recording gap is resolved.\nA new run and repetition of every required scenario are needed before another review.\nFollow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.\n> <project>\n> <test-dir>\n> <run-id>\n> <review-findings>",
    "result": {
      "done": "The acting agent completed the behavior.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "execution5": {
    "sourceItem": "EXECUTION-5",
    "kind": "player",
    "role": "analyst",
    "prompt": "Repair the structural issue the failed run gate reported in the applicable ledger definitions.\nA fresh full run of the required scenarios follows before another review.\nFollow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.\n> <project>\n> <test-dir>\n> <run-id>",
    "result": {
      "done": "The acting agent completed the behavior.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "coverage1": {
    "sourceItem": "COVERAGE-1",
    "kind": "player",
    "role": "tester",
    "prompt": "Collect actual code coverage from this full run using this project's verified tools and references/code-coverage.md.\nSave raw reports, actual tool versions, commands, environment, original-source mapping, measured line/branch counters, all uncovered units, tested Git/source SHA and frozen run ledger hashes in runs/<run-id>/code-coverage/measurement.json.\nInstrument copies only under ignored test assets. Do not alter product code or assertions, combine another run/revision's counters or remove defensive denominators.\nMissing collection or required unmeasured modules are blocked; never fabricate zero gaps or downgrade the mode.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <coverage-mode>",
    "result": {
      "measured": "Complete enhanced measurement recorded; proceed to COVERAGE-2.",
      "blocked": "Missing tool, source mapping or required module measurement; finish incomplete. Output shall include `failureDetails: <exact measurement blocker>`.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "coverage2": {
    "sourceItem": "COVERAGE-2",
    "kind": "player",
    "role": "reviewer",
    "prompt": "Independently inspect raw counters, original-source mapping and exact binding, complete scope/exclusions, material uncovered paths and important operation/user state and transition combinations, including already executed code.\nRead references/code-coverage.md and write runs/<run-id>/code-coverage/review.json bound to measurement SHA, run revision and frozen ledger hashes.\nDo not edit scenarios, embedded acceptance or measurement. Each deficit needs a reasoned disposition or concrete recommendation linked to confirmed requirements and scenarios.\nKeep defensive/nonmaterial uncovered exits in original denominators. Coverage percentage alone does not prove sufficiency.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <coverage-mode>",
    "result": {
      "sufficient": "No necessary testing recommendations remain and all residual paths have reviewed dispositions; proceed to COVERAGE-3. Does not replace EXECUTION-2's evidence review.",
      "gaps": "Concrete testing/recording gaps remain. Output shall include `coverageFindings: <verbatim final text>`. Proceed to COVERAGE-4 when coverageRounds is below three, otherwise incomplete with these exact findings.",
      "productFailed": "Actual behavior fails; finish incomplete. Output shall include `failureDetails: <exact product failure>`.",
      "blocked": "Required measurement/source scope is unproven; finish incomplete. Output shall include `failureDetails: <exact measurement blocker>`.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "coverage3": {
    "sourceItem": "COVERAGE-3",
    "kind": "script",
    "command": "python3 '<skill>'/scripts/playbook.py check-code-coverage '<project>' --test-dir '<test-dir>' --run '<run-id>' > '<test-dir>'/delivery-acceptance/runs/'<run-id>'/code-coverage/gate-report.json",
    "result": {
      "passed": "The optional code-coverage script gate passes; proceed to EXECUTION-2.",
      "failed": "Proceed to COVERAGE-4 while coverageRounds is below three. The script carries no prose payload and must not set coverageFindings. Analyst reads the existing gate report by the run/test directory path. At the limit finish incomplete with failureDetails identifying runs/<run-id>/code-coverage/gate-report.json, without inferring script output text."
    }
  },
  "coverage4": {
    "sourceItem": "COVERAGE-4",
    "kind": "player",
    "role": "analyst",
    "prompt": "Read runs/<run-id>/code-coverage/gate-report.json when present, including its exact failed issues; combine with Reviewer coverage-findings if supplied. Repair the exact findings under ignored test assets. Add or strengthen scenarios with embedded acceptance linked to confirmed requirements or independently justified reverse rules per references/white-box-rules.md; preserve existing IDs when refining.\nPreserve prior measurements, reviews and runs. Do not change requirements/product source, self-approve reviews, weaken assertions or erase uncovered deficits.\nProduct changes belong outside this workflow. Re-review changed design and start a fresh full run; old passing evidence cannot validate new definitions.\n> <project>\n> <test-dir>\n> <skill>\n> <run-id>\n> <coverage-mode>\n> <coverage-findings>",
    "result": {
      "done": "Reset the scenario-review counter for changed definitions, return to SCENARIO-2 and SCENARIO-4, then a fresh EXECUTION-1 full run. Never reset coverageRounds.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  },
  "completion1": {
    "sourceItem": "COMPLETION-1",
    "kind": "captain",
    "prompt": "Report full acceptance only when the script's five base gates all pass, plus code_coverage only in coverage mode and Reviewer finds sufficient evidence for every required scenario.\nOtherwise report by P0/P1/P2/P3: total, execution passed, independently evidence-reviewed, failed, blocked, unproven and not_run counts, plus each remaining scenario and its failure consequence from priority_reason. Show the selected scope and deadline stop reason. A P0 failure, blocker or insufficient evidence is an unresolved critical risk and blocks full delivery.\nA selected-grade verification conclusion such as P0/P1 verified is valid only for actually executed, independently proven scenarios in that grade; grades with zero scenarios are not verified. Label limited runs as partial verification / incomplete acceptance, never full acceptance. Otherwise report failed, uncovered, unproven, not_run and environment-blocked items with exact run and evidence paths where they exist.\nDo not infer acceptance from a player's assertion or a partial run.\nDo not ask Boss to click through ordinary tests; agents execute available tests and actual application paths themselves.\nIf AI truly cannot complete a required scenario after attempted recovery, report its saved independent execution_error verdict and supporting evidence. Ordinary case, operation or evidence defects require correction in that same scenario, not a final unproven verdict.\nNever invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session.\n> <project>\n> <test-dir>\n> <run-id>\n> <scenario-findings>\n> <review-findings>\n> <failure-details>\n> <coverage-mode>",
    "result": {
      "accepted": "All script gates and Reviewer's substantive evidence judgment support full acceptance. Output shall include `response: <nonempty full-acceptance report>`.",
      "incomplete": "Any required gate or substantive review does not support full acceptance, or a required path cannot be operated. Output shall include `response: <nonempty report of failed, uncovered, unproven, and environment-blocked items with exact run and evidence paths where they exist>`. Captain may echo failureDetails and runId, but the machine uses its fixed terminal context as specified above.",
      "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
    }
  }
} as const;

type WorkingId = keyof typeof items;
type ScriptId = 'unitAdvance' | 'analysisGate' | 'generationGate' | 'organizationGate' | 'scenario4' | 'execution3' | 'coverage3' | 'executionScenarioGate';
type AgentId = Exclude<WorkingId, ScriptId>;
type RoleId = 'analyst' | 'tester' | 'reviewer';
export interface PendingBossQuestion {
  questionId: AgentId;
  resumeStateId: AgentId;
  sourceItem: string;
  asker: { kind: 'captain' } | { kind: 'role'; roleId: RoleId };
  question: string;
}
interface Continuation {
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}
export type MachineOutput =
  | { status: 'accepted'; response: string; runId: string }
  | { status: 'incomplete'; response: string; failureDetails: string; runId: string };
interface Context extends Continuation {
  readonly project: string;
  readonly testDir: string;
  readonly requirementsFile: string;
  readonly skill: string;
  readonly coverageMode: CoverageMode;
  bossIntent: string;
  runId: string;
  scenarioId: string;
  executionFindings: string;
  scenarioPhase: 'none' | 'preparing' | 'executing' | 'evaluating' | 'completed';
  partialRun: boolean;
  scenarioFindings: string;
  reviewFindings: string;
  coverageFindings: string;
  failureDetails: string;
  response: string;
  outcome: 'pending' | 'accepted' | 'incomplete';
  sourceAnalysisRounds: number;
  analysisReady: boolean;
  analysisGatePassed: boolean;
  organizationReady: boolean;
  generationReady: boolean;
  generationGatePassed: boolean;
  organizationRounds: number;
  organizationApproved: boolean;
  organizationGatePassed: boolean;
  organizationRepair: boolean;
  requirementsReady: boolean;
  resourcesReady: boolean;
  scenariosReady: boolean;
  resourceAnswered: boolean;
  scenarioRounds: number;
  executionRounds: number;
  coverageRounds: number;
  scenarioApproved: boolean;
  scenarioGatePassed: boolean;
  evidenceSufficient: boolean;
  runGatePassed: boolean;
  coverageMeasured: boolean;
  coverageApproved: boolean;
  coverageGatePassed: boolean;
  scenarioRepair: 'none' | 'review' | 'gate';
  executionRepair: 'none' | 'review' | 'gate';
  coverageRepair: boolean;
  recordedRunIds: readonly string[];
  measuredRunIds: readonly string[];
  lastError?: { name: string; message: string; stack?: string };
  scenarioReviewRounds?: number;
  executionReviewRounds?: number;
  scenarioReviewPassed?: boolean;
  evidenceReviewPassed?: boolean;
}
export type Events =
  | { type: 'BOSS_TASK'; bossIntent: string }
  | { type: 'BOSS_INTERRUPT'; targetId: WorkingId | 'ready' | 'failed' }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };
type InputFor<K extends AgentId, F extends keyof Context> = Continuation & Pick<Context, F> & {
  stateId: K;
  sourceItem: (typeof items)[K]['sourceItem'];
  prompt: string;
  result: (typeof items)[K]['result'];
};
export type PlayerInput =
  | (InputFor<'sourceAnalysis', 'project' | 'testDir' | 'skill'> & { role: 'analyst' })
  | (InputFor<'organizationDesign', 'project' | 'testDir' | 'skill'> & { role: 'analyst' })
  | (InputFor<'entry1', 'skill' | 'project' | 'testDir' | 'requirementsFile' | 'coverageMode'> & { role: 'analyst' })
  | (InputFor<'organizationReview', 'project' | 'testDir' | 'skill'> & { role: 'reviewer' })
  | (InputFor<'organizationRepair', 'project' | 'testDir' | 'skill' | 'failureDetails'> & { role: 'analyst' })
  | (InputFor<'resource1', 'testDir' | 'project' | 'skill' | 'coverageMode'> & { role: 'analyst' })
  | (InputFor<'scenario1', 'testDir' | 'project' | 'skill' | 'coverageMode'> & { role: 'analyst' })
  | (InputFor<'scenario2', 'skill' | 'project' | 'testDir' | 'coverageMode'> & { role: 'reviewer' })
  | (InputFor<'scenario3', 'project' | 'testDir' | 'scenarioFindings'> & { role: 'analyst' })
  | (InputFor<'scenario5', 'project' | 'testDir'> & { role: 'analyst' })
  | (InputFor<'execution1', 'skill' | 'project' | 'testDir' | 'coverageMode' | 'runId'> & { role: 'tester' })
  | (InputFor<'executionPrepare', 'project' | 'testDir' | 'skill' | 'runId' | 'scenarioId' | 'executionFindings'> & { role: 'tester' })
  | (InputFor<'executionOperate', 'project' | 'testDir' | 'skill' | 'runId' | 'scenarioId'> & { role: 'tester' })
  | (InputFor<'executionEvaluate', 'project' | 'testDir' | 'skill' | 'runId' | 'scenarioId'> & { role: 'reviewer' })
  | (InputFor<'executionRecordRepair', 'project' | 'testDir' | 'skill' | 'runId' | 'scenarioId'> & { role: 'reviewer' })
  | (InputFor<'execution2', 'skill' | 'project' | 'testDir' | 'runId' | 'coverageMode'> & { role: 'reviewer' })
  | (InputFor<'execution4', 'project' | 'testDir' | 'runId' | 'reviewFindings'> & { role: 'analyst' })
  | (InputFor<'execution5', 'project' | 'testDir' | 'runId'> & { role: 'analyst' })
  | (InputFor<'coverage1', 'runId' | 'project' | 'testDir' | 'skill' | 'coverageMode'> & { role: 'tester' })
  | (InputFor<'coverage2', 'runId' | 'project' | 'testDir' | 'skill' | 'coverageMode'> & { role: 'reviewer' })
  | (InputFor<'coverage4', 'runId' | 'project' | 'testDir' | 'skill' | 'coverageMode' | 'coverageFindings'> & { role: 'analyst' });
export type CaptainInput =
  | InputFor<'completion1', 'project' | 'testDir' | 'runId' | 'scenarioFindings' | 'reviewFindings' | 'failureDetails' | 'coverageMode'>;

export type CaptainOutput =
  | { guard: 'accepted'; response: string }
  | { guard: 'incomplete'; response: string; failureDetails?: string; runId?: string }
  | { guard: 'needsBossReply'; question: string };
export type PlayerOutput =
  | { guard: 'more' }
  | { guard: 'ready' }
  | { guard: 'requirementsGap'; failureDetails: string }
  | { guard: 'environmentBlocked'; failureDetails: string }
  | { guard: 'done' }
  | { guard: 'passed' }
  | { guard: 'gaps'; scenarioFindings: string }
  | { guard: 'gaps'; coverageFindings: string }
  | { guard: 'invalidated'; failureDetails: string }
  | { guard: 'repairRequired'; executionFindings: string }
  | { guard: 'selected'; runId: string; scenarioId: string }
  | { guard: 'testsPrepared' }
  | { guard: 'blockedRecorded' }
  | { guard: 'observed' }
  | { guard: 'evaluated' }
  | { guard: 'gaps'; failureDetails: string }
  | { guard: 'recorded'; runId: string }
  | { guard: 'partialRecorded'; runId: string }
  | { guard: 'sufficient' }
  | { guard: 'repairable'; reviewFindings: string }
  | { guard: 'partial'; reviewFindings: string }
  | { guard: 'productFailed'; reviewFindings: string }
  | { guard: 'productFailed'; failureDetails: string }
  | { guard: 'measured' }
  | { guard: 'blocked'; failureDetails: string }
  | { guard: 'needsBossReply'; question: string };
export interface ScriptInput {
  stateId: ScriptId;
  sourceItem: string;
  command: string;
  result: { readonly passed: string; readonly failed: string };
}
export type ScriptOutput = { guard: 'passed'; exitStatus: number } | { guard: 'failed'; exitStatus: number };
const fallback = 'A required acceptance gate did not pass.';
const workingIds = Object.keys(items) as WorkingId[];
const agentIds = workingIds.filter((id): id is AgentId => items[id].kind !== 'script');
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const modeValid = (value: unknown): value is CoverageMode => value === 'standard' || value === 'coverage';

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function field(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function isJson(value: unknown, active = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1) return false;
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (!length || !('value' in length) || length.value !== value.length || length.enumerable || length.configurable) return false;
      for (let i = 0; i < value.length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !d.enumerable || !('value' in d) || !isJson(d.value, active)) return false;
      }
      return keys.every(k => k === 'length' || (typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < value.length));
    }
    return record(value) && keys.every(k => {
      if (typeof k !== 'string') return false;
      const d = Object.getOwnPropertyDescriptor(value, k);
      return !!d && d.enumerable === true && 'value' in d && isJson(d.value, active);
    });
  } finally { active.delete(value); }
}
function output(event: unknown): Record<string, unknown> | undefined {
  const value = field(event, 'output');
  return record(value) && isJson(value) ? value : undefined;
}
function textOutput(event: unknown, key: string): string {
  const value = output(event)?.[key];
  return typeof value === 'string' ? value : '';
}
function errorRecord(value: unknown): { name: string; message: string; stack?: string } {
  if (value instanceof Error) return { name: value.name, message: value.message, ...(typeof value.stack === 'string' ? { stack: value.stack } : {}) };
  return { name: 'Error', message: typeof value === 'string' ? value : 'Actor failed with a non-Error value.' };
}
function clearBossReplyContext(context: Context): Context {
  const next = { ...context };
  delete next.pendingBossQuestion;
  delete next.bossReply;
  return next;
}
function fresh(input: MachineInput): Context {
  return {
    project: input.project, testDir: input.testDir, requirementsFile: input.requirementsFile, skill: input.skill,
    coverageMode: input.coverageMode === undefined ? 'standard' : input.coverageMode,
    bossIntent: '', runId: '', scenarioId: '', executionFindings: '', scenarioPhase: 'none', partialRun: false, scenarioFindings: '', reviewFindings: '', coverageFindings: '', failureDetails: '', response: '', outcome: 'pending',
    sourceAnalysisRounds: 0, analysisReady: false, analysisGatePassed: false, organizationReady: false, generationReady: false, generationGatePassed: false,
    organizationRounds: 0, organizationApproved: false, organizationGatePassed: false, organizationRepair: false,
    requirementsReady: false, resourcesReady: false, scenariosReady: false, resourceAnswered: false,
    scenarioRounds: 0, executionRounds: 0, coverageRounds: 0,
    scenarioApproved: false, scenarioGatePassed: false, evidenceSufficient: false, runGatePassed: false,
    coverageMeasured: false, coverageApproved: false, coverageGatePassed: false,
    scenarioRepair: 'none', executionRepair: 'none', coverageRepair: false, recordedRunIds: [], measuredRunIds: [],
  };
}
function negative(context: Context, details: string): Context {
  return { ...context, outcome: 'incomplete', failureDetails: context.outcome === 'incomplete' && nonempty(context.failureDetails) ? context.failureDetails : nonempty(details) ? details : fallback };
}
function isLegacyContext(context: Context): boolean {
  return Object.hasOwn(context, 'scenarioReviewRounds') && Object.hasOwn(context, 'executionReviewRounds') && Object.hasOwn(context, 'scenarioReviewPassed') && Object.hasOwn(context, 'evidenceReviewPassed') && context.coverageMode === undefined && typeof context.scenarioReviewRounds === 'number' && typeof context.executionReviewRounds === 'number' && typeof context.scenarioReviewPassed === 'boolean' && typeof context.evidenceReviewPassed === 'boolean';
}
function normalize(context: Context, phase?: string): Context {
  if (!isLegacyContext(context)) return context;
  const actual = phase === 'awaitBossReply' ? context.pendingBossQuestion?.resumeStateId : phase;
  const ordered = ['entry1', 'resource1', 'scenario1', 'scenario2', 'scenario3', 'scenario4', 'scenario5', 'execution1', 'execution2', 'execution3', 'execution4', 'execution5', 'completion1'];
  const index = ordered.indexOf(actual ?? '');
  let next: Context = {
    ...fresh({ project: context.project, testDir: context.testDir, requirementsFile: context.requirementsFile, skill: context.skill }),
    ...context, coverageMode: 'standard', coverageRounds: 0, measuredRunIds: [],
    scenarioRounds: context.scenarioReviewRounds!, executionRounds: context.executionReviewRounds!,
    scenarioApproved: context.scenarioReviewPassed!, evidenceSufficient: context.evidenceReviewPassed!,
    scenarioGatePassed: context.scenarioGatePassed, runGatePassed: context.runGatePassed,
    requirementsReady: index > 0, resourcesReady: index >= 2, scenariosReady: index >= 3,
    scenarioRepair: actual === 'scenario3' ? 'review' : actual === 'scenario5' ? 'gate' : 'none',
    executionRepair: actual === 'execution4' ? 'review' : actual === 'execution5' ? 'gate' : 'none',
    resourceAnswered: actual === 'resource1' && context.pendingBossQuestion?.resumeStateId === 'resource1' && nonempty(context.bossReply),
    recordedRunIds: nonempty(context.runId) ? [context.runId] : [],
  };
  if (actual === 'completion1' && (context.outcome === 'incomplete' || !(next.scenarioApproved === true && next.scenarioGatePassed === true && next.evidenceSufficient === true && next.runGatePassed === true && nonempty(next.runId)))) {
    next = negative(next, nonempty(context.reviewFindings) ? context.reviewFindings : nonempty(context.scenarioFindings) ? context.scenarioFindings : context.failureDetails);
  }
  return next;
}
function snapshotPhase(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function continuation(context: Context, state: AgentId): Continuation {
  return context.pendingBossQuestion?.resumeStateId === state ? {
    pendingBossQuestion: context.pendingBossQuestion,
    ...(typeof context.bossReply === 'string' ? { bossReply: context.bossReply } : {}),
  } : {};
}
function agentInput(context: Context, state: AgentId): PlayerInput | CaptainInput {
  const c = normalize(context, state);
  const qa = continuation(c, state);
  switch (state) {
    case 'sourceAnalysis': return { stateId: 'sourceAnalysis', sourceItem: items.sourceAnalysis.sourceItem, prompt: items.sourceAnalysis.prompt, result: items.sourceAnalysis.result, role: items.sourceAnalysis.role, project: c.project, testDir: c.testDir, skill: c.skill, ...qa };
    case 'organizationDesign': return { stateId: 'organizationDesign', sourceItem: items.organizationDesign.sourceItem, prompt: items.organizationDesign.prompt, result: items.organizationDesign.result, role: items.organizationDesign.role, project: c.project, testDir: c.testDir, skill: c.skill, ...qa };
    case 'entry1': return { stateId: 'entry1', sourceItem: items.entry1.sourceItem, prompt: items.entry1.prompt, result: items.entry1.result, role: items.entry1.role, skill: c.skill, project: c.project, testDir: c.testDir, requirementsFile: c.requirementsFile, coverageMode: c.coverageMode, ...qa };
    case 'organizationReview': return { stateId: 'organizationReview', sourceItem: items.organizationReview.sourceItem, prompt: items.organizationReview.prompt, result: items.organizationReview.result, role: items.organizationReview.role, project: c.project, testDir: c.testDir, skill: c.skill, ...qa };
    case 'organizationRepair': return { stateId: 'organizationRepair', sourceItem: items.organizationRepair.sourceItem, prompt: items.organizationRepair.prompt, result: items.organizationRepair.result, role: items.organizationRepair.role, project: c.project, testDir: c.testDir, skill: c.skill, failureDetails: c.failureDetails, ...qa };
    case 'resource1': return { stateId: 'resource1', sourceItem: items.resource1.sourceItem, prompt: items.resource1.prompt, result: items.resource1.result, role: items.resource1.role, testDir: c.testDir, project: c.project, skill: c.skill, coverageMode: c.coverageMode, ...qa };
    case 'scenario1': return { stateId: 'scenario1', sourceItem: items.scenario1.sourceItem, prompt: items.scenario1.prompt, result: items.scenario1.result, role: items.scenario1.role, testDir: c.testDir, project: c.project, skill: c.skill, coverageMode: c.coverageMode, ...qa };
    case 'scenario2': return { stateId: 'scenario2', sourceItem: items.scenario2.sourceItem, prompt: items.scenario2.prompt, result: items.scenario2.result, role: items.scenario2.role, skill: c.skill, project: c.project, testDir: c.testDir, coverageMode: c.coverageMode, ...qa };
    case 'scenario3': return { stateId: 'scenario3', sourceItem: items.scenario3.sourceItem, prompt: items.scenario3.prompt, result: items.scenario3.result, role: items.scenario3.role, project: c.project, testDir: c.testDir, scenarioFindings: c.scenarioFindings, ...qa };
    case 'scenario5': return { stateId: 'scenario5', sourceItem: items.scenario5.sourceItem, prompt: items.scenario5.prompt, result: items.scenario5.result, role: items.scenario5.role, project: c.project, testDir: c.testDir, ...qa };
    case 'execution1': return { stateId: 'execution1', sourceItem: items.execution1.sourceItem, prompt: items.execution1.prompt, result: items.execution1.result, role: items.execution1.role, skill: c.skill, project: c.project, testDir: c.testDir, coverageMode: c.coverageMode, runId: c.runId, ...qa };
    case 'executionPrepare': return { stateId: 'executionPrepare', sourceItem: items.executionPrepare.sourceItem, prompt: items.executionPrepare.prompt, result: items.executionPrepare.result, role: items.executionPrepare.role, project: c.project, testDir: c.testDir, skill: c.skill, runId: c.runId, scenarioId: c.scenarioId, executionFindings: c.executionFindings, ...qa };
    case 'executionOperate': return { stateId: 'executionOperate', sourceItem: items.executionOperate.sourceItem, prompt: items.executionOperate.prompt, result: items.executionOperate.result, role: items.executionOperate.role, project: c.project, testDir: c.testDir, skill: c.skill, runId: c.runId, scenarioId: c.scenarioId, ...qa };
    case 'executionEvaluate': return { stateId: 'executionEvaluate', sourceItem: items.executionEvaluate.sourceItem, prompt: items.executionEvaluate.prompt, result: items.executionEvaluate.result, role: items.executionEvaluate.role, project: c.project, testDir: c.testDir, skill: c.skill, runId: c.runId, scenarioId: c.scenarioId, ...qa };
    case 'executionRecordRepair': return { stateId: 'executionRecordRepair', sourceItem: items.executionRecordRepair.sourceItem, prompt: items.executionRecordRepair.prompt, result: items.executionRecordRepair.result, role: items.executionRecordRepair.role, project: c.project, testDir: c.testDir, skill: c.skill, runId: c.runId, scenarioId: c.scenarioId, ...qa };
    case 'execution2': return { stateId: 'execution2', sourceItem: items.execution2.sourceItem, prompt: items.execution2.prompt, result: items.execution2.result, role: items.execution2.role, skill: c.skill, project: c.project, testDir: c.testDir, runId: c.runId, coverageMode: c.coverageMode, ...qa };
    case 'execution4': return { stateId: 'execution4', sourceItem: items.execution4.sourceItem, prompt: items.execution4.prompt, result: items.execution4.result, role: items.execution4.role, project: c.project, testDir: c.testDir, runId: c.runId, reviewFindings: c.reviewFindings, ...qa };
    case 'execution5': return { stateId: 'execution5', sourceItem: items.execution5.sourceItem, prompt: items.execution5.prompt, result: items.execution5.result, role: items.execution5.role, project: c.project, testDir: c.testDir, runId: c.runId, ...qa };
    case 'coverage1': return { stateId: 'coverage1', sourceItem: items.coverage1.sourceItem, prompt: items.coverage1.prompt, result: items.coverage1.result, role: items.coverage1.role, runId: c.runId, project: c.project, testDir: c.testDir, skill: c.skill, coverageMode: c.coverageMode, ...qa };
    case 'coverage2': return { stateId: 'coverage2', sourceItem: items.coverage2.sourceItem, prompt: items.coverage2.prompt, result: items.coverage2.result, role: items.coverage2.role, runId: c.runId, project: c.project, testDir: c.testDir, skill: c.skill, coverageMode: c.coverageMode, ...qa };
    case 'coverage4': return { stateId: 'coverage4', sourceItem: items.coverage4.sourceItem, prompt: items.coverage4.prompt, result: items.coverage4.result, role: items.coverage4.role, runId: c.runId, project: c.project, testDir: c.testDir, skill: c.skill, coverageMode: c.coverageMode, coverageFindings: c.coverageFindings, ...qa };
    case 'completion1': return { stateId: 'completion1', sourceItem: items.completion1.sourceItem, prompt: items.completion1.prompt, result: items.completion1.result, project: c.project, testDir: c.testDir, runId: c.runId, scenarioFindings: c.scenarioFindings, reviewFindings: c.reviewFindings, failureDetails: c.failureDetails, coverageMode: c.coverageMode, ...qa };
  }
}

function shellWord(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
function scriptInput(context: Context, state: ScriptId): ScriptInput {
  const c = normalize(context, state);
  let command: string = items[state].command;
  if ([c.project, c.testDir, c.requirementsFile, c.skill].every(nonempty)
    && c.project !== '<project>' && c.testDir !== '<test-dir>'
    && c.requirementsFile !== '<requirements-file>' && c.skill !== '<skill>') {
    const values: Readonly<Record<string, string>> = { skill: c.skill, project: c.project, 'test-dir': c.testDir, 'run-id': c.runId, 'scenario-id': c.scenarioId, 'coverage-mode': c.coverageMode };
    command = command.replace(/'<([a-z-]+)>'/g, (whole: string, key: string) => nonempty(values[key]) ? shellWord(values[key]) : whole);
  }
  return { stateId: state, sourceItem: items[state].sourceItem, command, result: items[state].result };
}
function validResult(state: WorkingId, event: unknown, guard: string): boolean {
  const result = output(event);
  if (!result || result.guard !== guard || !Object.hasOwn(items[state].result, guard)) return false;
  if (items[state].kind === 'script') return typeof result.exitStatus === 'number' && Number.isInteger(result.exitStatus) && (guard === 'passed' ? result.exitStatus === 0 : result.exitStatus !== 0);
  if (guard === 'needsBossReply') return nonempty(result.question);
  if (state === 'completion1') return nonempty(result.response);
  if (guard === 'invalidated') return nonempty(result.failureDetails);
  if (guard === 'requirementsGap' || guard === 'environmentBlocked' || guard === 'blocked' || (state === 'coverage2' && guard === 'productFailed')) return nonempty(result.failureDetails);
  if (state === 'organizationReview' && guard === 'gaps') return nonempty(result.failureDetails);
  if (state === 'scenario2' && guard === 'gaps') return nonempty(result.scenarioFindings);
  if ((state === 'executionEvaluate' || state === 'executionRecordRepair') && guard === 'repairRequired') return nonempty(result.executionFindings);
  if (state === 'execution1') return nonempty(result.runId) && (guard !== 'selected' || nonempty(result.scenarioId));
  if (state === 'execution2' && (guard === 'repairable' || guard === 'partial' || guard === 'productFailed')) return nonempty(result.reviewFindings);
  if (state === 'coverage2' && guard === 'gaps') return nonempty(result.coverageFindings);
  return true;
}
function canMeasureAgain(c: Context): boolean { return c.coverageMode === 'standard' || (c.coverageMode === 'coverage' && c.coverageRounds < 3); }
function canEnter(c: Context, id: WorkingId): boolean {
  if (id === 'completion1') return (c.outcome === 'incomplete' || nonempty(c.runId)) && modeValid(c.coverageMode);
  // Evaluate the target prerequisites before the shared eligibility checks.
  // This preserves routing while exposing the first unmet condition to bounded probes.
  const targetReady = (() => { switch (id) {
    case 'entry1': return nonempty(c.bossIntent);
    case 'sourceAnalysis': return c.requirementsReady && c.sourceAnalysisRounds < 3;
    case 'analysisGate': return c.analysisReady;
    case 'organizationDesign': return c.analysisGatePassed === true && c.organizationRounds < 3;
    case 'generationGate': return c.generationReady && c.organizationGatePassed === true;
    case 'organizationReview': return c.requirementsReady && c.organizationReady && c.analysisGatePassed === true && c.organizationRounds < 3;
    case 'organizationRepair': return c.analysisGatePassed === true && c.organizationRepair && nonempty(c.failureDetails) && c.organizationRounds < 3;
    case 'organizationGate': return c.analysisGatePassed === true && c.organizationApproved;
    case 'resource1': return c.requirementsReady && c.organizationApproved && c.organizationGatePassed;
    case 'scenario1': return c.requirementsReady && c.resourcesReady;
    case 'unitAdvance': return c.requirementsReady && c.resourcesReady;
    case 'scenario2': return c.scenariosReady && c.scenarioRounds < 3;
    case 'scenario3': return c.scenarioRepair === 'review' && nonempty(c.scenarioFindings) && c.scenarioRounds < 3;
    case 'scenario4': return c.scenarioApproved === true;
    case 'scenario5': return c.scenarioRepair === 'gate' && c.scenarioRounds < 3;
    case 'executionPrepare': return nonempty(c.runId) && nonempty(c.scenarioId) && c.scenarioPhase === 'preparing';
    case 'executionOperate': return nonempty(c.runId) && nonempty(c.scenarioId) && c.scenarioPhase === 'executing';
    case 'executionEvaluate': return nonempty(c.runId) && nonempty(c.scenarioId) && c.scenarioPhase === 'evaluating';
    case 'executionRecordRepair': return nonempty(c.runId) && nonempty(c.scenarioId) && c.scenarioPhase === 'completed';
    case 'executionScenarioGate': return nonempty(c.runId) && nonempty(c.scenarioId) && c.scenarioPhase === 'completed';
    case 'execution1': return (c.scenarioPhase === 'none') && c.scenarioGatePassed === true && c.executionRounds < 3 && canMeasureAgain(c);
    case 'execution2': return nonempty(c.runId) && c.executionRounds < 3 && (c.partialRun || c.coverageMode === 'standard' || c.coverageGatePassed === true);
    case 'execution3': return nonempty(c.runId);
    case 'execution4': return c.executionRepair === 'review' && nonempty(c.reviewFindings) && c.executionRounds < 3 && canMeasureAgain(c);
    case 'execution5': return c.executionRepair === 'gate' && c.executionRounds < 3 && canMeasureAgain(c);
    case 'coverage1': return c.coverageMode === 'coverage' && nonempty(c.runId) && (c.coverageRounds < 3 || c.measuredRunIds.includes(c.runId));
    case 'coverage2': return c.coverageMode === 'coverage' && nonempty(c.runId) && c.coverageMeasured;
    case 'coverage3': return c.coverageMode === 'coverage' && nonempty(c.runId) && c.coverageApproved;
    case 'coverage4': return c.coverageMode === 'coverage' && nonempty(c.runId) && c.coverageRepair && c.coverageRounds < 3;
  } })();
  // A known limited run must receive its evidence review, never another run or repair.
  const needsOrganization = ['resource1', 'scenario1', 'unitAdvance', 'generationGate'].includes(id);
  const needsGeneration = ['scenario2', 'scenario3', 'scenario4', 'scenario5', 'execution1', 'executionPrepare', 'executionOperate', 'executionEvaluate', 'executionRecordRepair', 'executionScenarioGate', 'execution2', 'execution3', 'execution4', 'execution5', 'coverage1', 'coverage2', 'coverage3', 'coverage4'].includes(id);
  return targetReady && (!needsOrganization || c.organizationGatePassed === true) && (!needsGeneration || c.generationGatePassed === true) && modeValid(c.coverageMode) && c.outcome !== 'incomplete' && (!c.partialRun || id === 'execution2');
}
type Condition = 'analysisRetry' | 'analysisLimit' | 'organizationRetry' | 'organizationLimit' | 'partialRunRecorded' | 'fullRun' | 'fullExecutionRetry' | 'fullExecutionLimit' | 'always' | 'resourceAnswered' | 'scenarioRetry' | 'scenarioLimit' | 'runStandard' | 'runCoverage' | 'executionRetry' | 'executionLimit' | 'coverageRetry' | 'coverageLimit' | 'executionAvailable' | 'executionExhausted';
function condition(c: Context, event: unknown, name: Condition): boolean {
  switch (name) {
    case 'analysisRetry': return c.sourceAnalysisRounds < 3;
    case 'analysisLimit': return c.sourceAnalysisRounds >= 3;
    case 'organizationRetry': return c.organizationRounds < 3;
    case 'organizationLimit': return c.organizationRounds >= 3;
    case 'always': return true;
    case 'partialRunRecorded': return modeValid(c.coverageMode) && c.executionRounds < 3;
    case 'fullRun': return !c.partialRun;
    case 'fullExecutionRetry': return canMeasureAgain(c) && c.executionRounds < 3 && !c.partialRun;
    case 'fullExecutionLimit': return !c.partialRun && (c.executionRounds >= 3 || !canMeasureAgain(c));
    case 'resourceAnswered': return c.resourceAnswered;
    case 'scenarioRetry': return c.scenarioRounds < 3;
    case 'scenarioLimit': return c.scenarioRounds >= 3;
    case 'runStandard': return c.coverageMode === 'standard';
    case 'runCoverage': return c.coverageMode === 'coverage' && c.coverageRounds < 3 && !c.recordedRunIds.includes(textOutput(event, 'runId'));
    case 'executionRetry': return c.executionRounds < 3 && canMeasureAgain(c);
    case 'executionLimit': return c.executionRounds >= 3 || !canMeasureAgain(c);
    case 'coverageRetry': return c.coverageRounds < 3;
    case 'coverageLimit': return c.coverageRounds >= 3;
    case 'executionAvailable': return c.executionRounds < 3;
    case 'executionExhausted': return c.executionRounds >= 3;
  }
}
type Operation = 'unitAdvanceFinal' | 'analysisReady' | 'analysisPassed' | 'analysisFailed' | 'analysisFinal' | 'organizationReady' | 'generationReady' | 'generationPassed' | 'generationFinal' | 'organizationPassed' | 'organizationGap' | 'organizationGatePassed' | 'organizationGateFailed' | 'organizationGateFinal' | 'repairScenarioExecution' | 'scenarioRecordInvalid' | 'selectScenario' | 'prepareScenario' | 'observeScenario' | 'evaluateScenario' | 'advanceScenario' | 'recordPartialRun' | 'partialFinal' | 'none' | 'requirementsReady' | 'resourcesReady' | 'scenariosReady' | 'scenarioPassed' | 'scenarioGap' | 'scenarioGapFinal' | 'scenarioGatePassed' | 'scenarioGateFailed' | 'scenarioGateFinal' | 'recordRun' | 'evidencePassed' | 'evidenceRepair' | 'evidenceFinal' | 'runGatePassed' | 'runGateFailed' | 'runGateFinal' | 'negative' | 'coverageMeasured' | 'coveragePassed' | 'coverageGap' | 'coverageGapFinal' | 'coverageGatePassed' | 'coverageGateFailed' | 'coverageGateFinal' | 'coverageRepaired' | 'acceptedReport' | 'incompleteReport' | 'budgetFinal';
function settleIncomplete(c: Context, response?: string, details?: string): Context {
  const wasNegative = c.outcome === 'incomplete';
  const next = negative(c, nonempty(details) ? details : fallback);
  return { ...next, response: wasNegative || !nonempty(response) ? (nonempty(next.runId) ? next.runId + '\n' : '') + next.failureDetails : response };
}
function update(context: Context, state: WorkingId, event: unknown, op: Operation): Context {
  let c = normalize(context, state);
  const report = (filename: string) => `Run structural gate failed; inspect ${c.testDir}/delivery-acceptance/runs/${c.runId}/${filename}`;
  switch (op) {
    case 'scenarioRecordInvalid': return negative(c, `Scenario recording gate failed; run check-scenario for ${c.runId}/${c.scenarioId}`);
    case 'selectScenario': return { ...c, runId: textOutput(event, 'runId'), scenarioId: textOutput(event, 'scenarioId'), scenarioPhase: 'preparing' };
    case 'repairScenarioExecution': return { ...c, scenarioPhase: 'preparing', executionFindings: textOutput(event, 'executionFindings') };
    case 'prepareScenario': return { ...c, scenarioPhase: 'executing' };
    case 'observeScenario': return { ...c, scenarioPhase: 'evaluating' };
    case 'evaluateScenario': return { ...c, scenarioPhase: 'completed' };
    case 'advanceScenario': return { ...c, scenarioId: '', executionFindings: '', scenarioPhase: 'none' };
    case 'unitAdvanceFinal': return negative(c, `Unit advance gate failed; inspect ${c.testDir}/delivery-acceptance/unit-advance-gate.json`);
    case 'analysisReady': return { ...c, analysisReady: true };
    case 'analysisPassed': return { ...c, analysisGatePassed: true };
    case 'analysisFailed': return { ...c, analysisGatePassed: false };
    case 'analysisFinal': return negative({ ...c, analysisGatePassed: false }, `Source analysis gate failed; inspect ${c.testDir}/delivery-acceptance/analysis-gate.json`);
    case 'organizationReady': return { ...c, organizationReady: true };
    case 'generationReady': return { ...c, generationReady: true, scenariosReady: true };
    case 'generationPassed': return { ...c, generationGatePassed: true };
    case 'generationFinal': return negative({ ...c, generationGatePassed: false }, `Generation gate failed; inspect ${c.testDir}/delivery-acceptance/generation-gate.json`);
    case 'none': return c;
    case 'organizationPassed': return { ...c, organizationApproved: true, organizationRepair: false };
    case 'organizationGap': return { ...c, organizationApproved: false, organizationRepair: true, failureDetails: textOutput(event, 'failureDetails') };
    case 'organizationGatePassed': return { ...c, organizationGatePassed: true, organizationRepair: false, failureDetails: '' };
    case 'organizationGateFailed': return { ...c, organizationGatePassed: false, organizationRepair: true, failureDetails: `Organization gate failed; inspect ${c.testDir}/delivery-acceptance/organization-gate.json` };
    case 'organizationGateFinal': return negative({ ...c, organizationGatePassed: false }, `Organization gate failed; inspect ${c.testDir}/delivery-acceptance/organization-gate.json`);
    case 'requirementsReady': return { ...c, requirementsReady: true };
    case 'resourcesReady': return { ...c, resourcesReady: true };
    case 'scenariosReady': return { ...c, scenariosReady: true };
    case 'scenarioPassed': return { ...c, scenarioApproved: true, scenarioRepair: 'none' };
    case 'scenarioGap': return { ...c, scenarioFindings: textOutput(event, 'scenarioFindings'), scenarioRepair: 'review', scenarioApproved: false };
    case 'scenarioGapFinal': return negative({ ...c, scenarioFindings: textOutput(event, 'scenarioFindings'), scenarioApproved: false }, textOutput(event, 'scenarioFindings'));
    case 'scenarioGatePassed': return { ...c, scenarioGatePassed: true };
    case 'scenarioGateFailed': return { ...c, scenarioGatePassed: false, scenarioRepair: 'gate' };
    case 'scenarioGateFinal': return negative({ ...c, scenarioGatePassed: false }, `Pre-execution structural gate failed; inspect ${c.testDir}/delivery-acceptance/scenario-gate.json`);
    case 'recordPartialRun':
    case 'recordRun': {
      const runId = textOutput(event, 'runId');
      return { ...c, runId, partialRun: op === 'recordPartialRun', recordedRunIds: c.recordedRunIds.includes(runId) ? c.recordedRunIds : [...c.recordedRunIds, runId], evidenceSufficient: false, runGatePassed: false, coverageMeasured: false, coverageApproved: false, coverageGatePassed: false };
    }
    case 'evidencePassed': return { ...c, evidenceSufficient: true, executionRepair: 'none' };
    case 'evidenceRepair': return { ...c, evidenceSufficient: false, reviewFindings: textOutput(event, 'reviewFindings'), executionRepair: 'review' };
    case 'partialFinal': return negative({ ...c, partialRun: true, evidenceSufficient: false, runGatePassed: false, reviewFindings: textOutput(event, 'reviewFindings') }, textOutput(event, 'reviewFindings'));
    case 'evidenceFinal': return negative({ ...c, evidenceSufficient: false, runGatePassed: false, reviewFindings: textOutput(event, 'reviewFindings') }, textOutput(event, 'reviewFindings'));
    case 'runGatePassed': return { ...c, runGatePassed: true };
    case 'runGateFailed': return { ...c, runGatePassed: false, executionRepair: 'gate' };
    case 'runGateFinal': return negative({ ...c, runGatePassed: false }, report('gate-report.json'));
    case 'negative': return negative(c, textOutput(event, 'failureDetails'));
    case 'coverageMeasured': return { ...c, coverageMeasured: true };
    case 'coveragePassed': return { ...c, coverageApproved: true, coverageRepair: false };
    case 'coverageGap': return { ...c, coverageFindings: textOutput(event, 'coverageFindings'), coverageApproved: false, coverageRepair: true };
    case 'coverageGapFinal': return negative({ ...c, coverageFindings: textOutput(event, 'coverageFindings'), coverageApproved: false }, textOutput(event, 'coverageFindings'));
    case 'coverageGatePassed': return { ...c, coverageGatePassed: true };
    case 'coverageGateFailed': return { ...c, coverageGatePassed: false, coverageRepair: true };
    case 'coverageGateFinal': return negative({ ...c, coverageGatePassed: false }, `Code-coverage structural gate failed; inspect ${c.testDir}/delivery-acceptance/runs/${c.runId}/code-coverage/gate-report.json`);
    case 'coverageRepaired': return { ...c, scenarioRounds: 0, scenarioApproved: false, scenarioGatePassed: false, coverageRepair: false };
    case 'acceptedReport': return { ...c, response: textOutput(event, 'response') };
    case 'incompleteReport': return settleIncomplete(c, textOutput(event, 'response'), textOutput(event, 'failureDetails'));
    case 'budgetFinal': c = negative(c, fallback); return c;
  }
}
function enter(context: Context, state: WorkingId): Context {
  let c = normalize(context, state);
  const resumed = c.pendingBossQuestion?.resumeStateId === state && nonempty(c.bossReply);
  if (resumed) return c;
  switch (state) {
    case 'entry1': return { ...c, analysisReady: false, analysisGatePassed: false, organizationReady: false, generationReady: false, generationGatePassed: false, organizationApproved: false, organizationGatePassed: false, organizationRepair: false, requirementsReady: false, resourcesReady: false, scenariosReady: false, scenarioApproved: false, scenarioGatePassed: false, evidenceSufficient: false, runGatePassed: false, coverageApproved: false, coverageGatePassed: false };
    case 'sourceAnalysis': return { ...c, sourceAnalysisRounds: c.sourceAnalysisRounds + 1, analysisReady: false, analysisGatePassed: false, organizationReady: false, organizationApproved: false, organizationGatePassed: false, generationReady: false, generationGatePassed: false };
    case 'analysisGate': return { ...c, analysisGatePassed: false };
    case 'organizationDesign': return { ...c, organizationReady: false, organizationApproved: false, organizationGatePassed: false };
    case 'generationGate': return { ...c, generationGatePassed: false };
    case 'organizationReview': return { ...c, organizationRounds: c.organizationRounds + 1, organizationApproved: false, organizationGatePassed: false };
    case 'organizationRepair': return { ...c, organizationApproved: false, organizationGatePassed: false };
    case 'organizationGate': return { ...c, organizationGatePassed: false };
    case 'resource1': return { ...c, resourcesReady: false, resourceAnswered: false, scenarioApproved: false, scenarioGatePassed: false, evidenceSufficient: false, runGatePassed: false, coverageApproved: false, coverageGatePassed: false };
    case 'scenario1': return { ...c, generationReady: false, generationGatePassed: false, scenarioApproved: false, scenarioGatePassed: false, evidenceSufficient: false, runGatePassed: false };
    case 'scenario3': case 'scenario5': return { ...c, scenarioApproved: false, scenarioGatePassed: false, evidenceSufficient: false, runGatePassed: false };
    case 'scenario2': return { ...c, scenarioRounds: c.scenarioRounds + 1, scenarioApproved: false, scenarioGatePassed: false, evidenceSufficient: false, runGatePassed: false };
    case 'scenario4': return { ...c, scenarioGatePassed: false };
    case 'execution1': return { ...c, evidenceSufficient: false, runGatePassed: false, coverageMeasured: false, coverageApproved: false, coverageGatePassed: false };
    case 'execution2': return { ...c, executionRounds: c.executionRounds + 1, evidenceSufficient: false, runGatePassed: false };
    case 'execution3': return { ...c, runGatePassed: false };
    case 'coverage1': {
      if (!c.measuredRunIds.includes(c.runId)) c = { ...c, coverageRounds: c.coverageRounds + 1, measuredRunIds: [...c.measuredRunIds, c.runId] };
      return { ...c, coverageMeasured: false, coverageApproved: false, coverageGatePassed: false };
    }
    case 'coverage2': return { ...c, coverageApproved: false, coverageGatePassed: false };
    case 'coverage3': return { ...c, coverageFindings: '', coverageGatePassed: false };
    default: return c;
  }
}
function legacyInterruptHandler(phase: string) {
  // Restored legacy context needs the actual source phase, never the jump target.
  // Normalize once in that state's handler, then retry the same event at the root.
  return { BOSS_INTERRUPT: {
    guard: 'legacyContext' as const,
    actions: [{ type: 'normalizePhase' as const, params: { phase } }, 'redispatchInterrupt' as const],
  } };
}
function metadata(stateId: string, description: string, role?: RoleId) {
  return { id: stateId, description, meta: { playbook: { stateId, description, ...(role ? { role } : {}) } }, on: legacyInterruptHandler(stateId) };
}
function arm(state: WorkingId, guard: string, target: string, op: Operation = 'none', test: Condition = 'always') {
  return {
    guard: { type: 'outcome' as const, params: { state, guard, test } }, target: '#' + target, reenter: state === target,
    actions: [
      ...(items[state].kind === 'player' ? [{ type: 'playbook.acceptedOutcome' as const, params: { source: state, target, acceptedOutcome: guard } }] : []),
      { type: 'update' as const, params: { state, op } },
      'clearBossReplyContext' as const,
    ],
  };
}
function pause(state: AgentId) {
  return {
    guard: { type: 'outcome' as const, params: { state, guard: 'needsBossReply', test: 'always' as const } }, target: '#awaitBossReply',
    actions: [
      ...(items[state].kind === 'player' ? [{ type: 'playbook.acceptedOutcome' as const, params: { source: state, target: 'awaitBossReply', acceptedOutcome: 'needsBossReply' } }] : []),
      { type: 'update' as const, params: { state, op: 'none' as const } },
      'clearBossReplyContext' as const,
      { type: 'setPendingBossQuestion' as const, params: { state } },
    ],
  };
}
function bossInterrupts(ids: readonly (WorkingId | 'ready' | 'failed')[]) {
  return ids.map(id => ({
    guard: { type: 'interrupt' as const, params: { id } },
    target: '#' + id, reenter: true, actions: ['normalizeCurrent' as const, 'clearBossReplyContext' as const],
  }));
}
function resumableStates(ids: readonly AgentId[]) {
  return ids.map(id => ({ guard: { type: 'reply' as const, params: { id } }, target: '#' + id, actions: 'rememberReply' as const }));
}
const malformed = { target: '#failed', actions: ['malformedOutput', 'clearBossReplyContext'] as const };
const actorError = { target: '#failed', actions: ['rememberError', 'clearBossReplyContext'] as const };
const task = { guard: 'validTask' as const, target: '#entry1', actions: ['rememberTask' as const, 'clearBossReplyContext' as const] };

export const deliveryAcceptanceMachine = setup({
  types: {
    context: {} as Context,
    events: {} as Events,
    input: {} as MachineInput,
    output: {} as MachineOutput,
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => { throw new Error('captain actor must be provided by the runner'); }),
    player: fromPromise<PlayerOutput, PlayerInput>(async () => { throw new Error('player actor must be provided by the runner'); }),
    script: fromPromise<ScriptOutput, ScriptInput>(async () => { throw new Error('script actor must be provided by the runner'); }),
  },
  guards: {
    outcome: ({ context, event }, params: { state: WorkingId; guard: string; test: Condition }) => validResult(params.state, event, params.guard) && condition(normalize(context, params.state), event, params.test),
    validTask: ({ context, event }) => event.type === 'BOSS_TASK' && nonempty(event.bossIntent) && modeValid(normalize(context, 'ready').coverageMode),
    legacyContext: ({ context }) => isLegacyContext(context),
    interrupt: ({ context, event }, params: { id: WorkingId | 'ready' | 'failed' }) => {
      if (event.type !== 'BOSS_INTERRUPT' || event.targetId !== params.id) return false;
      const c = normalize(context);
      return params.id === 'ready' || params.id === 'failed' ? modeValid(c.coverageMode) : canEnter(c, params.id);
    },
    reply: ({ context, event }, params: { id: AgentId }) => {
      const c = normalize(context, 'awaitBossReply');
      return event.type === 'BOSS_REPLY' && nonempty(event.answer) && c.pendingBossQuestion?.resumeStateId === params.id && c.pendingBossQuestion.questionId === params.id && (event.questionId === undefined || event.questionId === params.id) && modeValid(c.coverageMode);
    },
    baseProof: ({ context }) => { const c = normalize(context); return c.scenarioApproved === true && c.scenarioGatePassed === true && c.evidenceSufficient === true && c.runGatePassed === true; },
    standardRunProof: ({ context }) => { const c = normalize(context); return nonempty(c.runId) && c.outcome !== 'incomplete' && c.coverageMode === 'standard'; },
    coverageRunProof: ({ context }) => { const c = normalize(context); return nonempty(c.runId) && c.outcome !== 'incomplete' && c.coverageMode === 'coverage'; },
    analysisProof: ({ context }) => normalize(context).analysisGatePassed === true,
    organizationProof: ({ context }) => normalize(context).organizationGatePassed === true,
    generationProof: ({ context }) => normalize(context).generationGatePassed === true,
    coverageProof: ({ context }) => { const c = normalize(context); return c.coverageApproved === true && c.coverageGatePassed === true; },
  },
  actions: {
    'playbook.acceptedOutcome': (_args, _params: { source: string; target: string; acceptedOutcome: string }) => {},
    enter: assign(({ context }, params: { state: WorkingId }) => enter(context, params.state)),
    update: assign(({ context, event }, params: { state: WorkingId; op: Operation }) => update(context, params.state, event, params.op)),
    normalizeCurrent: assign(({ context, self }) => normalize(context, snapshotPhase(self.getSnapshot().value))),
    normalizePhase: assign(({ context }, params: { phase: string }) => normalize(context, params.phase)),
    redispatchInterrupt: raise(({ event }) => event),
    clearBossReplyContext: enqueueActions(({ enqueue }) => {
      // Clone first: remove optional members without mutating a prior snapshot
      // or introducing own undefined properties through assign's shallow merge.
      enqueue.assign(({ context }) => ({ ...context }));
      enqueue(({ context }) => { delete context.pendingBossQuestion; delete context.bossReply; });
    }),
    rememberTask: assign(({ context, event, self }) => {
      const c = normalize(context, snapshotPhase(self.getSnapshot().value));
      const next = { ...c, bossIntent: event.type === 'BOSS_TASK' ? event.bossIntent : c.bossIntent };
      return next;
    }),
    setPendingBossQuestion: assign(({ context, event }, params: { state: AgentId }) => {
      const c = normalize(context, params.state);
      const item = items[params.state];
      const asker: PendingBossQuestion['asker'] = item.kind === 'player' ? { kind: 'role', roleId: item.role } : { kind: 'captain' };
      return { ...clearBossReplyContext(c), pendingBossQuestion: { questionId: params.state, resumeStateId: params.state, sourceItem: item.sourceItem, asker, question: textOutput(event, 'question') } };
    }),
    rememberReply: assign(({ context, event }) => {
      const c = normalize(context, 'awaitBossReply');
      return event.type === 'BOSS_REPLY' ? { ...c, bossReply: event.answer, resourceAnswered: c.resourceAnswered || c.pendingBossQuestion?.resumeStateId === 'resource1' } : c;
    }),
    malformedOutput: assign(({ context, self }) => ({ ...normalize(context, snapshotPhase(self.getSnapshot().value)), lastError: { name: 'InvalidActorOutput', message: 'Actor output does not satisfy this state’s result contract or phase prerequisites.' } })),
    invalidReply: assign(({ context }) => ({ ...normalize(context, 'awaitBossReply'), lastError: { name: 'InvalidBossReply', message: 'A nonempty answer and the matching pending question are required.' } })),
    rememberError: assign(({ context, event, self }) => ({ ...normalize(context, snapshotPhase(self.getSnapshot().value)), lastError: errorRecord(field(event, 'error')) })),
    settleIncomplete: assign(({ context }) => settleIncomplete(normalize(context))),
    accept: assign(({ context }) => ({ ...normalize(context), outcome: 'accepted' as const })),
  },
}).createMachine({
  id: 'deliveryAcceptance',
  description: 'Test an application against confirmed requirements and report delivery acceptance.',
  initial: 'ready',
  context: ({ input }) => fresh(input),
  output: ({ context }) => {
    const c = normalize(context);
    return c.outcome === 'accepted'
      ? { status: 'accepted', response: c.response, runId: c.runId }
      : { status: 'incomplete', response: c.response, runId: c.runId, failureDetails: c.failureDetails };
  },
  on: {
    BOSS_INTERRUPT: bossInterrupts(['ready', ...workingIds, 'failed']),
    BOSS_REPLY: { target: '#failed', actions: ['invalidReply', 'clearBossReplyContext'] },
  },
  states: {
    ready: { ...metadata('ready', 'Waiting for Boss to provide the acceptance task.'), tags: 'playbook.parked', on: { ...legacyInterruptHandler('ready'), BOSS_TASK: task } },
    failed: { ...metadata('failed', 'Acceptance is paused after an execution or contract error.'), tags: 'playbook.parked', on: { ...legacyInterruptHandler('failed'), BOSS_TASK: task } },
    awaitBossReply: {
      ...metadata('awaitBossReply', "Waiting for Boss to answer the acting agent's question."), tags: 'playbook.parked',
      on: { ...legacyInterruptHandler('awaitBossReply'), BOSS_TASK: task, BOSS_REPLY: [...resumableStates(agentIds), { target: '#failed', actions: ['invalidReply', 'clearBossReplyContext'] }] },
    },
    entry1: {
      ...metadata('entry1', "Check confirmed requirement IDs and initialize or import the ledger.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'entry1' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'entry1') as PlayerInput,
        onDone: [
          arm('entry1', 'ready', 'sourceAnalysis', 'requirementsReady', 'analysisRetry'),
          arm('entry1', 'ready', 'completion1', 'budgetFinal', 'analysisLimit'),
          arm('entry1', 'requirementsGap', 'completion1', 'negative'),
          pause('entry1'),
          malformed,
        ],
        onError: actorError,
      },
    },
    sourceAnalysis: {
      ...metadata('sourceAnalysis', 'Analyze the original requirements and material source rules.', 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'sourceAnalysis' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'sourceAnalysis') as PlayerInput,
        onDone: [
          arm('sourceAnalysis', 'done', 'analysisGate', 'analysisReady'),
          arm('sourceAnalysis', 'requirementsGap', 'completion1', 'negative'),
          pause('sourceAnalysis'),
          malformed,
        ],
        onError: actorError,
      },
    },
    analysisGate: {
      ...metadata('analysisGate', 'Independently verify the complete source analysis.'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'analysisGate' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'analysisGate'),
        onDone: [
          arm('analysisGate', 'passed', 'organizationDesign', 'analysisPassed'),
          arm('analysisGate', 'failed', 'sourceAnalysis', 'analysisFailed', 'analysisRetry'),
          arm('analysisGate', 'failed', 'completion1', 'analysisFinal', 'analysisLimit'),
          malformed,
        ],
        onError: actorError,
      },
    },
    organizationDesign: {
      ...metadata('organizationDesign', 'Build the complete acceptance organization before scene generation.', 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'organizationDesign' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'organizationDesign') as PlayerInput,
        onDone: [
          arm('organizationDesign', 'done', 'organizationReview', 'organizationReady', 'organizationRetry'),
          arm('organizationDesign', 'done', 'completion1', 'budgetFinal', 'organizationLimit'),
          pause('organizationDesign'),
          malformed,
        ],
        onError: actorError,
      },
    },
    unitAdvance: {
      ...metadata('unitAdvance', 'Verify persisted unit completion and advance to the next pending unit.'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'unitAdvance' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'unitAdvance'),
        onDone: [
          arm('unitAdvance', 'passed', 'scenario1'),
          arm('unitAdvance', 'failed', 'completion1', 'unitAdvanceFinal'),
          malformed,
        ],
        onError: actorError,
      },
    },
    generationGate: {
      ...metadata('generationGate', 'Independently verify generation for every published unit.'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'generationGate' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'generationGate'),
        onDone: [
          arm('generationGate', 'passed', 'scenario2', 'generationPassed', 'scenarioRetry'),
          arm('generationGate', 'passed', 'completion1', 'budgetFinal', 'scenarioLimit'),
          arm('generationGate', 'failed', 'completion1', 'generationFinal'),
          malformed,
        ],
        onError: actorError,
      },
    },
    organizationReview: {
      ...metadata('organizationReview', 'Independently review and publish the acceptance organization.', 'reviewer'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'organizationReview' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'organizationReview') as PlayerInput,
        onDone: [
          arm('organizationReview', 'passed', 'organizationGate', 'organizationPassed'),
          arm('organizationReview', 'gaps', 'organizationRepair', 'organizationGap', 'organizationRetry'),
          arm('organizationReview', 'gaps', 'completion1', 'negative', 'organizationLimit'),
          pause('organizationReview'),
          malformed,
        ],
        onError: actorError,
      },
    },
    organizationRepair: {
      ...metadata('organizationRepair', 'Repair the named acceptance organization gaps.', 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'organizationRepair' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'organizationRepair') as PlayerInput,
        onDone: [
          arm('organizationRepair', 'done', 'organizationReview', 'none', 'organizationRetry'),
          arm('organizationRepair', 'requirementsGap', 'completion1', 'negative'),
          pause('organizationRepair'),
          malformed,
        ],
        onError: actorError,
      },
    },
    organizationGate: {
      ...metadata('organizationGate', 'Independently verify the published organization and review.'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'organizationGate' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'organizationGate'),
        onDone: [
          arm('organizationGate', 'passed', 'resource1', 'organizationGatePassed'),
          arm('organizationGate', 'failed', 'organizationRepair', 'organizationGateFailed', 'organizationRetry'),
          arm('organizationGate', 'failed', 'completion1', 'organizationGateFinal', 'organizationLimit'),
          malformed,
        ],
        onError: actorError,
      },
    },
    resource1: {
      ...metadata('resource1', "Verify and record resources, integration evidence, and required decisions.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'resource1' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'resource1') as PlayerInput,
        onDone: [
          arm('resource1', 'ready', 'scenario1', 'resourcesReady'),
          arm('resource1', 'environmentBlocked', 'completion1', 'negative', 'resourceAnswered'),
          pause('resource1'),
          malformed,
        ],
        onError: actorError,
      },
    },
    scenario1: {
      ...metadata('scenario1', "Map requirements and material implementation branches to acceptance scenarios.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'scenario1' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'scenario1') as PlayerInput,
        onDone: [
          arm('scenario1', 'more', 'unitAdvance'),
          arm('scenario1', 'done', 'generationGate', 'generationReady'),
          pause('scenario1'),
          malformed,
        ],
        onError: actorError,
      },
    },
    scenario2: {
      ...metadata('scenario2', "Independently challenge scenario coverage and record the review.", 'reviewer'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'scenario2' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'scenario2') as PlayerInput,
        onDone: [
          arm('scenario2', 'passed', 'scenario4', 'scenarioPassed'),
          arm('scenario2', 'gaps', 'scenario3', 'scenarioGap', 'scenarioRetry'),
          arm('scenario2', 'gaps', 'completion1', 'scenarioGapFinal', 'scenarioLimit'),
          pause('scenario2'),
          malformed,
        ],
        onError: actorError,
      },
    },
    scenario3: {
      ...metadata('scenario3', "Repair the independently identified scenario gaps.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'scenario3' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'scenario3') as PlayerInput,
        onDone: [
          arm('scenario3', 'done', 'scenario2'),
          pause('scenario3'),
          malformed,
        ],
        onError: actorError,
      },
    },
    scenario4: {
      ...metadata('scenario4', "Independently run the pre-execution structural gates."),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'scenario4' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'scenario4'),
        onDone: [
          arm('scenario4', 'passed', 'execution1', 'scenarioGatePassed', 'executionRetry'),
          arm('scenario4', 'passed', 'completion1', 'budgetFinal', 'executionLimit'),
          arm('scenario4', 'failed', 'scenario5', 'scenarioGateFailed', 'scenarioRetry'),
          arm('scenario4', 'failed', 'completion1', 'scenarioGateFinal', 'scenarioLimit'),
          malformed,
        ],
        onError: actorError,
      },
    },
    scenario5: {
      ...metadata('scenario5', "Repair the failed pre-execution structural gate.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'scenario5' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'scenario5') as PlayerInput,
        onDone: [
          arm('scenario5', 'done', 'scenario2'),
          pause('scenario5'),
          malformed,
        ],
        onError: actorError,
      },
    },
    execution1: {
      ...metadata('execution1', "Select the next scenario or close and record the frozen execution scope.", 'tester'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'execution1' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'execution1') as PlayerInput,
        onDone: [
          arm('execution1', 'selected', 'executionPrepare', 'selectScenario'),
          arm('execution1', 'recorded', 'execution2', 'recordRun', 'runStandard'),
          arm('execution1', 'recorded', 'coverage1', 'recordRun', 'runCoverage'),
          arm('execution1', 'partialRecorded', 'execution2', 'recordPartialRun', 'partialRunRecorded'),
          pause('execution1'),
          malformed,
        ],
        onError: actorError,
      },
    },
    executionPrepare: {
      ...metadata('executionPrepare', "Choose and prepare only this scenario tests in project locations.", 'tester'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'executionPrepare' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'executionPrepare') as PlayerInput,
        onDone: [
          arm('executionPrepare', 'ready', 'executionOperate', 'prepareScenario'),
          arm('executionPrepare', 'testsPrepared', 'executionOperate', 'prepareScenario'),
          arm('executionPrepare', 'blockedRecorded', 'executionEvaluate', 'observeScenario'),
          pause('executionPrepare'),
          malformed,
        ],
        onError: actorError,
      },
    },
    executionOperate: {
      ...metadata('executionOperate', "Execute one scenario and persist real evidence.", 'tester'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'executionOperate' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'executionOperate') as PlayerInput,
        onDone: [
          arm('executionOperate', 'observed', 'executionEvaluate', 'observeScenario'),
          pause('executionOperate'),
          malformed,
        ],
        onError: actorError,
      },
    },
    executionEvaluate: {
      ...metadata('executionEvaluate', "Independently evaluate this scenario and record issues without product repair.", 'reviewer'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'executionEvaluate' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'executionEvaluate') as PlayerInput,
        onDone: [
          arm('executionEvaluate', 'repairRequired', 'executionPrepare', 'repairScenarioExecution'),
          arm('executionEvaluate', 'evaluated', 'executionScenarioGate', 'evaluateScenario'),
          pause('executionEvaluate'),
          malformed,
        ],
        onError: actorError,
      },
    },
    executionScenarioGate: {
      ...metadata('executionScenarioGate', "Validate one completed scenario before advancing the queue."),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'executionScenarioGate' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'executionScenarioGate') ,
        onDone: [
          arm('executionScenarioGate', 'passed', 'execution1', 'advanceScenario'),
          arm('executionScenarioGate', 'failed', 'executionRecordRepair'),
          malformed

        ],
        onError: actorError,
      },
    },
    executionRecordRepair: {
      ...metadata('executionRecordRepair', 'Independently diagnose and reopen the current scenario for recording repair.', 'reviewer'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'executionRecordRepair' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'executionRecordRepair') as PlayerInput,
        onDone: [
          arm('executionRecordRepair', 'repairRequired', 'executionPrepare', 'repairScenarioExecution'),
          arm('executionRecordRepair', 'invalidated', 'completion1', 'negative'),
          pause('executionRecordRepair'),
          malformed,
        ],
        onError: actorError,
      },
    },
    execution2: {
      ...metadata('execution2', "Independently review the run’s actual evidence and script reports.", 'reviewer'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'execution2' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'execution2') as PlayerInput,
        onDone: [
          arm('execution2', 'sufficient', 'execution3', 'evidencePassed', 'fullRun'),
          arm('execution2', 'repairable', 'execution4', 'evidenceRepair', 'fullExecutionRetry'),
          arm('execution2', 'repairable', 'completion1', 'evidenceFinal', 'fullExecutionLimit'),
          arm('execution2', 'partial', 'completion1', 'partialFinal'),
          arm('execution2', 'productFailed', 'completion1', 'evidenceFinal'),
          pause('execution2'),
          malformed,
        ],
        onError: actorError,
      },
    },
    execution3: {
      ...metadata('execution3', "Independently run the terminal structural gates for the recorded run."),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'execution3' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'execution3'),
        onDone: [
          arm('execution3', 'passed', 'completion1', 'runGatePassed'),
          arm('execution3', 'failed', 'execution5', 'runGateFailed', 'executionRetry'),
          arm('execution3', 'failed', 'completion1', 'runGateFinal', 'executionLimit'),
          malformed,
        ],
        onError: actorError,
      },
    },
    execution4: {
      ...metadata('execution4', "Repair the evidence-recording definitions before a new full run.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'execution4' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'execution4') as PlayerInput,
        onDone: [
          arm('execution4', 'done', 'execution1'),
          pause('execution4'),
          malformed,
        ],
        onError: actorError,
      },
    },
    execution5: {
      ...metadata('execution5', "Repair the run’s structural gate issues before a new full run.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'execution5' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'execution5') as PlayerInput,
        onDone: [
          arm('execution5', 'done', 'execution1'),
          pause('execution5'),
          malformed,
        ],
        onError: actorError,
      },
    },
    coverage1: {
      ...metadata('coverage1', "Collect actual code coverage for the current enhanced run.", 'tester'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'coverage1' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'coverage1') as PlayerInput,
        onDone: [
          arm('coverage1', 'measured', 'coverage2', 'coverageMeasured'),
          arm('coverage1', 'blocked', 'completion1', 'negative'),
          pause('coverage1'),
          malformed,
        ],
        onError: actorError,
      },
    },
    coverage2: {
      ...metadata('coverage2', "Independently review enhanced coverage and residual testing gaps.", 'reviewer'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'coverage2' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'coverage2') as PlayerInput,
        onDone: [
          arm('coverage2', 'sufficient', 'coverage3', 'coveragePassed'),
          arm('coverage2', 'gaps', 'coverage4', 'coverageGap', 'coverageRetry'),
          arm('coverage2', 'gaps', 'completion1', 'coverageGapFinal', 'coverageLimit'),
          arm('coverage2', 'productFailed', 'completion1', 'negative'),
          arm('coverage2', 'blocked', 'completion1', 'negative'),
          pause('coverage2'),
          malformed,
        ],
        onError: actorError,
      },
    },
    coverage3: {
      ...metadata('coverage3', "Independently run the current enhanced code-coverage gate."),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'coverage3' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => scriptInput(context, 'coverage3'),
        onDone: [
          arm('coverage3', 'passed', 'execution2', 'coverageGatePassed', 'executionAvailable'),
          arm('coverage3', 'passed', 'completion1', 'budgetFinal', 'executionExhausted'),
          arm('coverage3', 'failed', 'coverage4', 'coverageGateFailed', 'coverageRetry'),
          arm('coverage3', 'failed', 'completion1', 'coverageGateFinal', 'coverageLimit'),
          malformed,
        ],
        onError: actorError,
      },
    },
    coverage4: {
      ...metadata('coverage4', "Repair enhanced testing gaps and prepare a new design review.", 'analyst'),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'coverage4' } },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => agentInput(context, 'coverage4') as PlayerInput,
        onDone: [
          arm('coverage4', 'done', 'scenario2', 'coverageRepaired'),
          pause('coverage4'),
          malformed,
        ],
        onError: actorError,
      },
    },
    completion1: {
      ...metadata('completion1', "Report acceptance or the fixed incomplete outcome for the terminal run."),
      tags: 'playbook.busy',
      entry: { type: 'enter', params: { state: 'completion1' } },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => agentInput(context, 'completion1') as CaptainInput,
        onDone: [
          arm('completion1', 'accepted', 'terminalBaseProof', 'acceptedReport'),
          arm('completion1', 'incomplete', 'incomplete', 'incompleteReport'),
          pause('completion1'),
          malformed,
        ],
        onError: actorError,
      },
    },
    terminalBaseProof: {
      ...metadata('terminalBaseProof', 'Check the four independent base acceptance proofs.'),
      always: [
        { guard: 'baseProof', target: '#terminalRunProof' },
        { target: '#incomplete', actions: 'settleIncomplete' },
      ],
    },
    terminalRunProof: {
      ...metadata('terminalRunProof', 'Check the terminal run and fixed acceptance mode.'),
      always: [
        { guard: 'standardRunProof', target: '#terminalAnalysisProof' },
        { guard: 'coverageRunProof', target: '#terminalCoverageProof' },
        { target: '#incomplete', actions: 'settleIncomplete' },
      ],
    },
    terminalCoverageProof: {
      ...metadata('terminalCoverageProof', 'Check the independent enhanced coverage verdict and script proof.'),
      always: [
        { guard: 'coverageProof', target: '#terminalAnalysisProof' },
        { target: '#incomplete', actions: 'settleIncomplete' },
      ],
    },
    terminalAnalysisProof: {
      ...metadata('terminalAnalysisProof', 'Check the independent source-analysis script proof.'),
      always: [
        { guard: 'analysisProof', target: '#terminalOrganizationProof' },
        { target: '#incomplete', actions: 'settleIncomplete' },
      ],
    },
    terminalOrganizationProof: {
      ...metadata('terminalOrganizationProof', 'Check the independent organization script proof.'),
      always: [
        { guard: 'organizationProof', target: '#terminalGenerationProof' },
        { target: '#incomplete', actions: 'settleIncomplete' },
      ],
    },
    terminalGenerationProof: {
      ...metadata('terminalGenerationProof', 'Check the independent complete-generation script proof.'),
      always: [
        { guard: 'generationProof', target: '#done' },
        { target: '#incomplete', actions: 'settleIncomplete' },
      ],
    },
    done: {
      id: 'done', type: 'final', description: 'Delivery acceptance completed successfully for the recorded run.',
      meta: { playbook: { stateId: 'done', description: 'Delivery acceptance completed successfully for the recorded run.', terminal: 'success' } },
      entry: 'accept',
    },
    incomplete: {
      id: 'incomplete', type: 'final', description: 'Delivery acceptance is incomplete; the terminal result reports the unproven or failed scope.',
      meta: { playbook: { stateId: 'incomplete', description: 'Delivery acceptance is incomplete; the terminal result reports the unproven or failed scope.', terminal: 'failure' } },
    },
  },
});
export default deliveryAcceptanceMachine;
