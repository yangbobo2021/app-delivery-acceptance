# App delivery acceptance

This playbook accepts a target application project, a user-selected test directory, a confirmed requirements JSON file, and the installed path of this skill. It performs testing and delivery acceptance only; requirement extraction and business approval are outside this workflow. The project ledger lives at `<test-dir>/delivery-acceptance/` and follows the skill's `references/data-model.md`. The deterministic checker is `python3 <skill>/scripts/playbook.py`. Never put real credential values in the ledger or evidence, including files under an ignored fixture directory; refer to an external environment or credential store. Public synthetic fixture tokens are test data.

This is already an active Playbook session. Never invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session from any role or Captain step. Use `playbook.py` directly for ledger operations and script gates. The ledger must be ignored by Git because Playbook 16 rejects uncommitted worktree changes inside governed calls; the outer launcher verifies this before entry.

Roles:

- Analyst
- Tester
- Reviewer

Analyst inspects the project and manages resources, scenarios, and methods. Tester operates the actual application and tests and records run results and evidence. Reviewer independently inspects requirements, implementation, scenarios, actual evidence, and gate reports; Reviewer owns the black-box `coverage_review.json` and each run's `review.json`.

Fundamental review principle: For every selected requirement, a plausible wrong implementation in any important operation mode or user state must fail at least one linked acceptance scenario through an observable result. If an important fault could escape, reject the scenario set and name that counterexample. Passing scenario design review means only that later real execution of the scenarios, with sufficient evidence, could support delivery within the agreed usage scope without an obvious defect. It does not prove the App works or that every possible bug is absent. When unsure how to review, use this counterfactual principle.

Captain coordinates the roles and never declares acceptance from a player's assertion alone. After each positive Reviewer verdict, the Playbook `script` actor independently reruns the relevant checker. Its exit status, not the Reviewer's statement, decides the structural gate: nonzero cannot enter execution or full acceptance. A gate passes only when both the relevant script check and substantive Reviewer verdict pass. Keep the exact project revision fixed during one execution and review. If implementation or ledger definitions change, start a new run and repeat affected full scenario paths on the new revision. Do not silently treat a partial run as full acceptance. Every negative outcome must return an exact `failureDetails` string; after the required Captain settlement, the machine emits only that result and the terminal run ID for an incomplete final response. Missing requirements, unavailable resources, and actual product failures finish as incomplete acceptance.

Product files stay fixed for a run, including pre-existing dirty files. Scenario preparation alone may add or adjust test code in the project's documented test locations, recorded in project.json.test_layout (paths and basis). Case code, reusable fixtures, Mocks and harnesses live there, outside the result ledger; record precise file, selector/entry point, command and file hash in the run binding. Result ledgers contain results, issues and evidence only. Preparation returns ready with unchanged repository or testsPrepared with exactly one descendant test-only commit, using Playbook's native repository dispositions. Stage only this scenario's own test changes, never existing user changes. Do not modify product code or weaken assertions to conceal failures. Verify the pinned product manifest after preparation and before each subsequent gate. All other role outcomes and pauses keep HEAD/worktree unchanged. A preparation question must precede tracked edits; complete the test-only commit before returning testsPrepared. If project policy prevents a necessary commit, record a blocker and continue. Repairs to product code happen outside this run; a subsequent run pins the new product version.

## Scenario importance and limited execution

Every black-box and white-box scenario needs `priority` (P0/P1/P2/P3) and a concrete `priority_reason` describing failure consequences. Use `<skill>/references/scenario-priority.md` for the grading criteria. Assess business risk, likelihood and affected users; do not use execution cost or dependency scheduling. Keep the complete design regardless of the selected execution scope. Do not automatically grade every happy path high or every exceptional/boundary path low, and do not impose a quota per grade. Reviewer independently challenges underestimation and indiscriminate inflation and records a reasoned judgment for every scenario. A priority or reason change invalidates its scoped review and prior run bindings. Legacy unclassified scenarios need explicit grading and fresh independent review before a new design/acceptance gate can pass.

The outer launcher fixes `execution-policy.json` under the selected ledger: default max_priority P3 and no execution time limit. Explicit user choices may select P0 through a maximum grade or a positive per-run time limit. Resumes inherit those settings; no role may change them. `new-run` freezes an `execution-plan.json` with a stable P0 → P1 → P2 → P3 queue and a UTC start/deadline, bound to run.json by SHA-256. `next-scenario` checks the deadline between scenarios; finish the current action safely, never start another after expiry. `finish-run` preserves every unexecuted scenario as not_run with a reason. Never delete lower-priority scenarios or combine prior runs to claim completion. A scoped or unfinished run receives independent evidence review, then terminates incomplete with the selected-grade results and remaining risks; it must not enter evidence-repair or coverage-enhancement loops just to undo the user's limit. Full acceptance remains available only when full scope and all existing gates pass. The execution time limit measures the run's execution window, not scenario design or resource discovery.

## Preserved runtime interface

The existing runtime API is part of this workflow's contract. Export the FSM as `deliveryAcceptanceMachine` and default-export that same machine. Its host-owned MachineInput/runtime options contain required readonly string fields `project`, `testDir`, `requirementsFile`, `skill`, plus optional readonly `coverageMode: "standard" | "coverage"` with default standard. Bootstrap project/testDir/requirementsFile/skill from machine input, not from a Boss event or prose. Validate coverageMode before any actor work. Linking must retain these four required options and add only the optional enum option; the launcher supplies them as configured options. The runtime validateOptions function normalizes an omitted coverageMode to standard.

The parked entry event remains `BOSS_TASK` carrying `bossIntent` as nonempty task text; it does not carry or replace project paths or mode. Never introduce a START event. Keep the existing BOSS_INTERRUPT and BOSS_REPLY contracts for suspend/resume. Extra mode/path fields in role outputs or Boss replies cannot overwrite host-owned values. Host-owned values are readonly in context across every reset, retry and continuation.

Keep existing physical FSM state keys, public meta.stateId and actor input.stateId as `entry1`, `resource1`, `scenario1`, `scenario2`, `scenario3`, `scenario4`, `scenario5`, `execution1`, `execution2`, `execution3`, `execution4`, `execution5`, `completion1`, `ready`, `failed`, `awaitBossReply`, `done`, `incomplete`. Each existing working state retains its uppercase sourceItem, e.g. entry1 has sourceItem ENTRY-1. Add lower camel physical coverage1, coverage2, coverage3, coverage4 with their uppercase COVERAGE sourceItems. Also allow the transparent transient coordination states terminalBaseProof, terminalRunProof, terminalCoverageProof specified below; these add no prompts, actors, review rounds, work or Boss-facing steps. The success final key is `done`, not accepted; the failure final key is `incomplete`. Keep JSON output.response and output.runId terminal semantics. Script actor key is script, delegated actor key player, direct Captain actor key captain. Keep concurrentRoleSets empty.

## Existing default-path compatibility

Preserve the shipped standard-mode retry and terminal contracts. Standard EXECUTION-1 accepts any nonempty recorded runId as before, including the same runId returned by an existing test fixture; it does not add the enhanced mode's unique-measurement guard. Actual Tester work must still create a fresh run as instructed. Coverage mode requires a fresh unique runId for each new full measurement and retains the three-round budget.

The terminal machine output retains status "accepted" or "incomplete" and response. Incomplete output additionally exposes the exact fixed failureDetails and terminal runId; its response includes the terminal run ID followed by the fixed failure detail when a run exists. A generic Captain incomplete response is valid without echoing failureDetails or runId. If a negative context already exists, neither an accepted result nor an incomplete result with missing or different echoed fields can overwrite that context or prevent incomplete settlement. Ignore Captain replacement runId/failureDetails; emit the context's terminal values. If Captain reports incomplete without a prior fixed negative context, preserve its nonempty response and use its failureDetails when provided, otherwise the deterministic fallback "A required acceptance gate did not pass.". A missing run remains the empty string; do not create a run during settlement.

Script commands preserve the verbatim GEARS command during structural introspection where the four host path options are absent or unbound. Perform shell-safe placeholder substitution only with an actual bound host context; a default coverageMode alone must not substitute the coverage-mode token during introspection. This preserves verbatim script conformance and actual configured-mode execution without altering the checker.

## Admission and legacy snapshot compatibility

The four required host path strings are validated by linked validateOptions before actor work, as in the published runtime. FSM BOSS_TASK validates nonempty bossIntent and the closed coverageMode. Other actor-result guards retain the existing result/phase semantics; do not globally conjoin validation of all four paths or bossIntent into every actor result or BOSS_INTERRUPT guard. Working states already receive the validated immutable host context. Each interrupt checks only its relevant phase prerequisites, fixed mode when applicable, and retry budget. Invalid coverageMode is rejected before any actor work.

The installed runtime restores persisted XState context rather than reapplying fresh machine input. Support the prior published standard-mode snapshot shape, not only the launcher's old session binding. An old snapshot has scenarioReviewRounds/executionReviewRounds/scenarioReviewPassed/evidenceReviewPassed and no coverageMode. Normalize this legacy context before its first guard evaluation, invocation input, or context update. Do this within ordinary state handlers/helpers so machine.provide and native snapshot restoration preserve the behavior; do not override XState restoreSnapshot/provide methods or alter the shared engine. Modern context takes the unchanged fast path. Only the old field-shape marker with an absent coverageMode is eligible for legacy normalization, and it always becomes standard, with coverageRounds zero and empty measuredRunIds. Never infer coverage from a task, file, actor payload or fresh replacement option.

Map the old scenarioReviewRounds and executionReviewRounds counters without resetting consumed rounds; map scenarioReviewPassed to scenarioApproved, evidenceReviewPassed to evidenceSufficient, and preserve scenarioGatePassed/runGatePassed exactly. Preserve original project/testDir/requirementsFile/skill, bossIntent, runId, pendingBossQuestion, bossReply, response and original findings. Supply the new empty recordedRunIds array or seed it from the original runId; uniqueness never restricts standard-mode fixtures.

For required new phase bookkeeping, derive only ordinary navigation readiness from the persisted working state or pendingBossQuestion.resumeStateId: after entry1 implies requirementsReady; scenario1 and later imply resourcesReady; scenario2 and later imply scenariosReady. No navigation inference may turn a saved false scenario/evidence/run gate into passed. At scenario3/scenario5/execution4/execution5, restore the corresponding repair-kind flag from that actual saved phase and the original findings. At resource1, a saved resource1 question with a bossReply supplies the answered-resource flag. A snapshot parked at ready/failed restarts through entry1 when Boss supplies a task, with fixed standard mode and retained bounded counters.

For legacy completion1, or awaitBossReply with completion1 as resumeStateId, all recorded base gates and independent verdicts must already pass to permit accepted; otherwise create the fixed negative context from original reviewFindings, then scenarioFindings, then failureDetails, then the deterministic incomplete fallback. A saved outcome=incomplete remains negative. Do not let old historical findings negate a legacy completion whose actual independent verdicts and all base gates pass. Keep terminal runId and exact failure details; Captain replacement text cannot overwrite them. Completed snapshots preserve their published accepted/incomplete terminal output.

## Terminal gate proof

Keep the published standard-mode terminal proof: scenarioApproved (formerly scenarioReviewPassed), scenarioGatePassed, evidenceSufficient (formerly evidenceReviewPassed), runGatePassed, and a nonempty terminal runId. scenarioGatePassed is the independent script proof of the three pre-execution gates, including requirements and resources; runGatePassed is the independent script proof of all five base gates. requirementsReady/resourcesReady/scenariosReady are navigation bookkeeping, not extra terminal gates, and must not be conjoined into the baseGates/acceptance terminal predicate. The additional code_coverage proof applies only in coverage mode; retain its independent Reviewer/script conjunction. Fixed negative outcome is authoritative and can never be accepted. Its separate failureDetails string is report data, not an additional positive gate. Host paths are already validated at the linked construction boundary and fixed mode at entry; avoid redundantly imposing them in all terminal/result guards.

Compile terminal acceptance into transparent transient coordination states, rather than putting the entire conjunctive proof into one COMPLETION-1 onDone arm. This preserves all conditions while making each guard independently auditable. A valid accepted Captain result first stores its response and enters terminalBaseProof. That state immediately checks the four independent proof booleans scenarioApproved, scenarioGatePassed, evidenceSufficient, runGatePassed, all strictly true. Failure settles incomplete with the fixed negative context or deterministic fallback. Success enters terminalRunProof. In terminalRunProof, nonempty runId and outcome other than incomplete are required: standard mode then settles done; coverage mode enters terminalCoverageProof; all other cases settle incomplete. terminalCoverageProof checks coverageApproved and coverageGatePassed, both strictly true, and settles done only when both pass; otherwise incomplete. Each incomplete fallback preserves the terminal run ID and prior fixed failure details. Only done assigns accepted outcome. No actor or Boss payload may set these proof booleans or bypass these coordination states. An incomplete Captain result retains the original incomplete settlement rules and bypasses positive proof states. This is the same terminal conjunction evaluated in sequential guards, not a cached acceptance assertion or an omitted gate. Do not add a single combined acceptance predicate to the Captain accepted arm or duplicate the full conjunction in any proof arm.

This maintenance is incremental: preserve the existing 17 state/source mappings; extend only EXECUTION-1 and EXECUTION-2 results for limited execution and stable state/event interfaces; change only behavior required by these explicit source clauses.

## Fixed optional mode

All deterministic script failures preserve their JSON reports. At the final SCENARIO-4 failure the machine may use failureDetails "Pre-execution structural gate failed; inspect <test-dir>/delivery-acceptance/scenario-gate.json". At the final EXECUTION-3 failure it may use "Run structural gate failed; inspect <test-dir>/delivery-acceptance/runs/<run-id>/gate-report.json". Interpolate fixed directory/run values, never synthesize script prose. Analyst and Captain must read those reports to explain actual issues; the deterministic terminal fallback still identifies the exact original report if Captain improperly returns accepted. COVERAGE-3 uses the analogous current code-coverage/gate-report.json fallback.

A coverage collection round is counted once per unique recorded run ID: increment on first COVERAGE-1 entry for that run and remember its run ID. Re-entering COVERAGE-1 after a Boss question/resume on the same run does not increment it again or prematurely exhaust the budget. The three-round limit prevents creating a fourth measured full run.


If the procedure terminates before EXECUTION-1 creates any run, the terminal runId is the empty string "" and the terminal machine output includes runId: ""; Captain need not echo it. Do not fabricate a run. Once EXECUTION-1 records a run, only that terminal runId is reported: Captain settlement cannot replace it with another run or alter fixed mode. A negative completion remains incomplete even if Captain returns an accepted verdict. Before COVERAGE-3 clear any prior coverageFindings; on script failure COVERAGE-4 reads the current run's gate report rather than borrowing a prior round's Reviewer text. At the third failed COVERAGE-3, failureDetails identifies the current code-coverage/gate-report.json by its test directory and run ID; it never depends on script prose output.


The host-owned runtime option `coverageMode` is the enum `standard` or `coverage`, defaults to `standard` when omitted, and is immutable within a session. It is not a role verdict, not inferred from task prose or an existing report, and never set by Analyst/Reviewer. Include the fixed mode in every relevant role prompt as a quoted `<coverage-mode>` relay. Invalid values must be rejected before work. Old sessions without the option mean standard. Resume uses the saved mode and original requirements/runtime options.

Live execution coverage is a separate fixed collection policy in execution-coverage-policy.json, supplied and persisted by the outer launcher, inherited by resumes and copied into the hash-bound execution-plan.json and run.json. Acceptance runs default to `--execution-coverage required`; only an explicit user choice of `--execution-coverage off` disables it. Roles cannot change this policy; missing collection is a same-scene execution repair. This policy adds no enhancement round or state and does not change coverageMode.

Output language is a separate fixed session policy. If the user explicitly supplies `--language`, use that language for authored business text throughout scenario titles, case names and review prose. If no language is supplied, each scenario and case inherits the primary language of its linked requirement item; mixed-language requirement sets may therefore produce mixed-language business text. Keep stable IDs, JSON field names, paths, selectors, commands, code symbols and literal application messages unchanged. The outer launcher persists this policy in `output-language-policy.json`; every role reads it and repairs a title or case name that violates the applicable language before advancing.

For EXECUTION-1 recorded only, standard mode transitions directly to EXECUTION-2 and never invoke any COVERAGE enhancement state or enhancement script gate, even if prior enhancement files exist or are malformed. Required live execution coverage runs inside the ordinary per-scene execution loop and does not enable enhancement. Standard mode retains the existing material-branch/state review and five gates. When live coverage policy is off, do not install coverage tools or request coverage configuration in standard mode. When required, verify and configure actual collection tools during scenario preparation; do not mistake an absent package for proven unavailability.

For EXECUTION-1 recorded only, coverage mode transitions to COVERAGE-1. Select actual tools for this project's language/runtime; no universal Python/JavaScript assumption or fixed global percentage target. Missing required collection capabilities finish incomplete with the exact blocked scope, never silently downgrade to standard. Each new full run explicitly records `acceptance_mode=coverage`; the checker enforces the additional code_coverage gate only for this mode. Reports record the mode. The fixed mode cannot be overwritten by a player result or task reply.

Preserve existing ENTRY, RESOURCE, SCENARIO, EXECUTION and COMPLETION stable item IDs. Add organizationReview/organizationRepair/organizationGate physical states for the three ORGANIZATION items. ENTRY-1 ready enters sourceAnalysis, not organization or resources. All new states inherit existing readonly host paths, BOSS_TASK admission and suspend/resume contracts. Coverage rounds are a separate bounded counter, initially zero, incremented once per COVERAGE-1. At most three measured full runs are allowed per session; a third unresolved gap or structural coverage failure finishes incomplete with exact findings. Never loop indefinitely. Coverage repairs reset only the scenario-review counter for the changed design, then pass SCENARIO-2/4 again and start a fresh full run; they never reset coverage rounds or remove a failed product outcome.

### ENTRY-1

When the playbook receives the project, the selected test directory, the requirements JSON file, the skill path and optional host-owned coverageMode, Captain shall prompt Analyst:

> Check whether the supplied requirements file has confirmed, stable requirement IDs.
> Preserve all original requirement text/IDs and genuine scope decisions. Initialization/import only: do not generate units or scenarios in ENTRY-1. On ready proceed to ANALYSIS-1.
> If IDs are absent or ambiguous, report the exact gap; do not generate or approve requirements.
> If valid, run `python3 <skill>/scripts/playbook.py init <project> --test-dir <test-dir> --requirements <requirements-file>` on first use, or `import-requirements` when the approved source changed.
> Follow the ledger structure in the skill's `references/data-model.md`, keep the ledger under `<test-dir>/delivery-acceptance/` and ignored by Git, and put no real credential values in the ledger or evidence.
> Use `playbook.py` directly for ledger operations; never invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session.
> > <project>
> > <test-dir>
> > <requirements-file>
> > <skill>
> > <coverage-mode>

Results:
- `ready`: The requirements file has confirmed, stable requirement IDs and the applicable first-use initialization or changed-source import is complete.
- `requirementsGap`: Confirmed, stable requirement IDs are absent or ambiguous; the exact gap is reported without generating or approving requirements, and the workflow finishes as incomplete acceptance. Output shall include `failureDetails: <exact requirements gap>`.

### ANALYSIS-1

After ENTRY-1 ready or an analysis gate repair while fewer than three source analysis attempts have occurred, Captain shall prompt Analyst:

> Read references/design-pipeline.md and references/white-box-rules.md. Analyze the complete original requirements first. This workflow stage is acceptance.
> For black-box stage, write an explicit empty reverse-rule inventory and explain that no implementation analysis is requested. For acceptance stage, inspect the actual implementation and record all material reverse rules before any acceptance organization. Use existing confirmed requirements when sufficient; separately assess supplemental-rule correctness and current-change applicability. Persist out-of-scope/pending candidates visibly, with reasons; never expand the agreed scope.
> Write source-analysis.candidate.json with stage, complete original and discovered rule IDs, actual inspected code paths/hashes and substantive analysis bases. Run complete-analysis --input then check-analysis. Do not create units, scenarios, tests or resources in this phase. A newly discovered required business ambiguity needs the real user answer; never invent approval.
> Use playbook.py directly, keep fixed paths and confirmed exclusions, and never start another Playbook session.
> <project>
> <test-dir>
> <skill>

Results:
- `done`: The source analysis was completed and persisted; proceed to ANALYSIS-GATE.
- `requirementsGap`: Actual required business/source gap prevents analysis. Output shall include `failureDetails: <exact gap>`; finish incomplete.

### ANALYSIS-GATE

After ANALYSIS-1 done, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check-analysis '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/analysis-gate.json

Results:
- `passed`: Zero exit verifies current complete source analysis; proceed to ORGANIZATION-DESIGN.
- `failed`: Nonzero exit reports exact analysis-gate.json path and returns to ANALYSIS-1 while fewer than three attempts have occurred; otherwise finish incomplete. Increment sourceAnalysisRounds once per ANALYSIS-1; suspension/recovery never resets it. Captain claims cannot set analysisGatePassed.

### ORGANIZATION-DESIGN

After ANALYSIS-GATE passed, Captain shall prompt Analyst:

> Generate the entire acceptance-plan.candidate.json from frozen source-analysis.json, full original requirements and all reverse rules. Read references/acceptance-organization.md and references/design-pipeline.md. Include all original check dispositions and all active reverse-rule ownership via units[].rule_ids; pending/outside rules remain candidates outside units.
> Build every acceptance unit and all global journeys before generating any scenario. Bind source_analysis_sha256 and semantic rules_sha256. Run check-plan --draft --input. Reuse an unchanged already published organization only after current check-plan; do not silently republish it.
> Return done only with the entire candidate ready for independent review. Preserve current user scope and actual decisions.
> <project>
> <test-dir>
> <skill>

Results:
- `done`: Entire organization is generated; proceed to ORGANIZATION-1 for independent review.

### ORGANIZATION-1

After ORGANIZATION-DESIGN done, before resource discovery or scenario generation, Captain shall prompt Reviewer:

> Read references/design-pipeline.md and references/acceptance-organization.md, completed source-analysis.json, complete original requirements, all white_box_rules.json items and acceptance-plan.candidate.json. Independently reconstruct behavior/conditions/recovery/invariants from original text, then verify original-to-unit and unit-to-original mapping, overall business context and selected boundaries.
> Write acceptance-plan-review.candidate.json with all five independent judgments including rule_provenance, every original requirement ID and every discovered rule ID (including out-of-scope/pending rules), plan_sha256 and actual independent reviewer identity. Independently check rule contract/invariant provenance, current-scope applicability and full rule-to-unit ownership. Regrouping must not invent or omit rules. Ordinary organization needs no Boss approval.
> If sufficient, run publish-plan with the candidate, independent review and actual expected-version. Never overwrite formal scope directly. Reuse an unchanged published plan only after check-plan; do not increment unchanged plans. Confirmed exclusions apply across names and IDs.
> Return passed only after substantive review and successful publication/check. On repairable gaps return gaps with exact failureDetails. Ask Boss only about genuine missing business decisions; persist the real answer before revalidation.
> <project>
> <test-dir>
> <skill>

Results:
- `passed`: organization independently reviewed and published; proceed to ORGANIZATION-GATE.
- `gaps`: Analyst repairs named gaps at ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred; otherwise finish incomplete with exact failureDetails. This counter is separate from scenario/coverage rounds and never reset by recovery.

### ORGANIZATION-REPAIR

On organization gaps while review rounds remain, Captain shall prompt Analyst:

> Repair only named organization gaps without changing original requirements or user decisions. If a genuine new source rule is required, return requirementsGap with exact reason and restart through source analysis in a new session; do not edit the frozen rule inventory in scene generation. Run check-plan --draft --input before returning done to ORGANIZATION-1. Never author independent review or overwrite the formal plan.
> <project>
> <test-dir>
> <skill>
> <failure-details>

Results:
- `done`: candidate repaired; return to ORGANIZATION-1.
- `requirementsGap`: genuine business ambiguity remains; finish incomplete with exact failureDetails.

### ORGANIZATION-GATE

After ORGANIZATION-1 passed, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check-plan '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/organization-gate.json

Results:
- `passed`: Zero exit verifies current organization and independent review; proceed to RESOURCE-1.
- `failed`: Nonzero exit sets failureDetails exactly to "Organization gate failed; inspect <test-dir>/delivery-acceptance/organization-gate.json" and enters ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred, otherwise finish incomplete. Never replace script execution with a Captain assertion. Increment the separate organization counter once per ORGANIZATION-1, maximum three; recovery never resets it.


### RESOURCE-1

Boss's answer resumes this same behavior with continuation context. The framework suspends this task for the Boss question and resumes it with the question and answer in the next prompt; a resumed question continues the same task.

When independently published organization and ORGANIZATION-GATE pass, Captain shall prompt Analyst:

> Read prior ledger decisions, project documentation, and configuration.
> Verify only resources required by selected acceptance units. Each decision needs scope.status in_scope/out_of_scope, unit_ids and basis; unrelated old integrations do not block. Explicit real-integration exclusions require actual user decision_id and remain unverified; Mock business dependencies still require preflight. Verify application commands, devices, identities and reset for the selected scope.
> Persist decisions and their verification evidence in `resources.json`, so future runs can reuse them after validity checks.
> Only when the fixed coverageMode is coverage, verify this project's actual collection tools, original-source mapping and scope under references/code-coverage.md; standard mode without required live execution coverage must omit this work. Read the fixed execution-coverage-policy.json; when required, follow references/code-coverage.md for per-scene capability, collection and review. Coverage-only tool absence is not an application dependency failure. When live collection is required, derive the denominator from the confirmed test intent and explicit user scope: project, directories, files, commit changes or PR changes. Persist project.json.coverage_subjects with kind, intent, basis, immutable revision/diff references and complete source_paths/excluded_paths. Read code-coverage.md intent-scoped cumulative coverage. Never choose only files visited by tests. Ask Boss only if scope ambiguity cannot be resolved from the authorized target.
> Follow the ledger structure in the skill's `references/data-model.md`, keep the ledger under `<test-dir>/delivery-acceptance/` and ignored by Git, and put no real credential values in the ledger or evidence.
> For each third-party service, assess whether a faithful Mock supports the full application flow.
> Test the real integration separately and keep its evidence and tested adapter and version.
> If Mock is viable, use it for later E2E flows.
> If a Mock is absent, record its required behavior; create it only when its scenario enters preparation, in project test locations. Do not change application source.
> Read project testing conventions and record test_layout.paths and a concrete basis in project.json; use the existing project organization, not the results directory. Independent scenario review must inspect these paths before execution.
> Allow real third-party E2E only when Mock cannot represent the flow and repeatable credentials and resources exist.
> Neither a Mock flow nor an existing token proves real integration correctness.
> If a resource, authorization, or business decision cannot be obtained using available tools, ask Boss one specific question and suspend.
> Do not ask Boss to approve ordinary scenario lists, plans, or gate outcomes.
> Resume with Boss's answer, persist the resulting decision, and repeat resource verification.
> > <project>
> > <test-dir>
> > <skill>
> > <coverage-mode>

Results:
- `ready`: Required resources and decisions are verified and persisted with evidence.
- `environmentBlocked`: A required resource remains unavailable after Boss's answer; the workflow finishes as an environment-blocked incomplete acceptance rather than claiming acceptance. Output shall include `failureDetails: <exact unavailable resource>`.

### SCENARIO-1

When confirmed requirements and verified resources are ready, Captain shall prompt Analyst:

> Read references/design-pipeline.md. Call design-next; for exactly that next unit call start-unit --unit ID before writing scenes. Generate only scenes owned by that unit, with generation_unit_id and scope.unit_ids referencing published ownership. Preserve all other unit scenes and any completed-unit review provenance. Use only the frozen original checks and already discovered, admitted reverse rules; never discover new reverse rules here.
> Persist each complete scene atomically into scenarios.json as it is produced so the live viewer shows this unit's actual progress. Then call complete-unit --unit ID; it validates coverage and protected other-unit records. Call design-next again. Return more if a next unit exists, otherwise done. Do not mark global completeness before every unit is generated and independently reviewed.
> Use design-quality-v4 and only included checks of the published plan, keeping all original requirements as background. Each exact criterion needs scope admission and each scene needs structured global business risk. Contract correctness is separate from this change's applicability. Necessary related checks require omission counterexamples; affected regressions require change impact references. Pending/outside-scope proposals stay outside active scenarios, even if old context proposes them.
> Map every selected requirement within the published plan to black-box scenarios covering important operation modes and user states, including normal, exceptional, boundary, and state-change behavior relevant to that requirement.
> Each scenario in scenarios.json must embed its own acceptance object with description, preconditions, actions, criteria and evidence_expected. Do not write methods.json or method_ids; existing/new cases and human simulation are chosen only during execution.
> Design describes how to accept, without selecting existing/new cases or human simulation and without implementing test code. The execution preparation step makes that choice using requirements, white-box code, scenario intent, acceptance instructions and existing tests.
> Assign every black-box and white-box scenario priority P0/P1/P2/P3 and a concrete priority_reason following references/scenario-priority.md. Keep all scenarios regardless of execution scope.
> Record the completeness assessment and its basis in the ledger.
> Do not write or self-approve `coverage_review.json`.
> Follow the ledger structure in the skill's `references/data-model.md`, keep the ledger under `<test-dir>/delivery-acceptance/` and ignored by Git, and put no real credential values in the ledger or evidence.
> > <project>
> > <test-dir>
> > <skill>
> > <coverage-mode>

Results:
- `more`: Current unit was completed and another pending unit exists; proceed to UNIT-ADVANCE without incrementing scenario review rounds.
- `done`: No generation units remain; proceed to GENERATION-GATE.

### UNIT-ADVANCE

After scene design more, Captain shall run:

> python3 '<skill>'/scripts/playbook.py advance-unit '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/unit-advance-gate.json

Results:
- `passed`: Actual zero exit verifies the prior unit completed and a next pending unit exists; return to scene design. Never repeat a stale completion as forward progress.
- `failed`: Nonzero exit finishes incomplete with the exact unit-advance-gate.json path, without generating another unit.

### GENERATION-GATE

After the per-unit design phase returns done, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check-generation '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/generation-gate.json

Results:
- `passed`: Zero exit proves every published unit generated its bound scenario set; proceed to independent scene review.
- `failed`: Nonzero exit terminates incomplete with exact generation-gate.json findings; do not enter scene review or execution and do not manufacture completion from agent output.

### SCENARIO-2

When the scenario set is ready for independent review or has been repaired, and fewer than three scenario review rounds have occurred, Captain shall prompt Reviewer:

> Review current scope first, then coverage and global causal risk. Write acceptance_scope_review with independent identity, plan_sha256, exact scenario/dependency hashes from scope-review-hashes, scope_reason/priority_reason/causal_chain_review and global_priority_calibration. Full acceptance additionally reviews every resource applicability and real-integration exclusion. Outside-scope suggestions are nonblocking. No P0 quota or keyword-based upgrade. Before local changes archive-scope-review; retain only unchanged original judgments with immutable retained_from and matching dependencies; recheck affected coverage and mappings.
> Independently challenge every selected requirement within the published plan against the scenario set: enumerate important operation modes and user states, propose plausible wrong implementations, and identify which linked scenario would visibly fail.
> Fundamental review principle: for every selected requirement, a plausible wrong implementation in any important operation mode or user state must fail at least one linked acceptance scenario through an observable result; if an important fault could escape, reject the scenario set and name that counterexample.
> Identify omissions or contradictions in the scenario definitions with specific requirement and branch references.
> Check the inspected code branches.
> Read references/white-box-rules.md and independently verify every reverse rule, code/contract source and check-item mapping; record rule_reviews in white_box_priority_review, including needs_confirmation for unresolved business policy. Check-item design completeness does not confirm the policy. Include all white-box-priority-hashes keys.
> Independently review each scenario's priority and reason; challenge underestimated high-risk exceptions/boundaries and unjustified P0/P1 inflation. Record black-box priority_reviews in coverage_review.json. Run `python3 <skill>/scripts/playbook.py white-box-priority-hashes <project> --test-dir <test-dir>` and record the hash-bound white_box_priority_review in the same file, including an empty reviewed list when there are no white-box scenarios. Priority disagreements are scenario gaps repaired by Analyst, never self-approved.
> Run `python3 <skill>/scripts/playbook.py review-hashes <project> --test-dir <test-dir>` and write or revalidate your per-requirement `coverage_review.json` using the schema in the skill's `references/data-model.md`; do not edit Analyst's scenarios or embedded acceptance.
> Independently verify project.json.test_layout follows documented project test organization and cannot exclude application files from the product manifest. When live collection is required, independently verify coverage_subjects matches the stated test intent, source inventory, versions, diff boundaries and justified exclusions. Run scripts/coverage_subjects.py <project> --test-dir <test-dir> and author coverage_review.json.coverage_subject_review with status passed, subjects_sha256, reviewer_kind independent_ai or playbook, review_reference and concrete reason. Reject scope drift or missing denominator files; no numerical threshold proves acceptance.
> Run `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir>` and report the exact script verdict; the check's JSON is saved as `<test-dir>/delivery-acceptance/scenario-gate.json`.
> A suspected product defect already covered by a scenario is not a scenario coverage gap: preserve that scenario and enter execution so the behavior can be observed and reported.
> Use `playbook.py` directly for ledger operations and script gates; never invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session.
> > <project>
> > <test-dir>
> > <skill>
> > <coverage-mode>

Results:
- `passed`: Independent challenge finds no material scenario omission or contradiction against confirmed requirements and inspected code branches, substantive counterfactual coverage holds, and the three script gates pass. Passing scenario design review means only that later real execution of the scenarios, with sufficient evidence, could support delivery within the agreed usage scope without an obvious defect; it does not prove the App works or that every possible bug is absent.
- `gaps`: Independent challenge finds material omissions or contradictions with exact requirement and branch references, or a required script gate does not pass; a suspected product defect already covered by a scenario is not a coverage gap. If this is the third scenario review round, the exact gaps are reported as unproven and the workflow finishes as incomplete acceptance. Output shall include `scenarioFindings: <verbatim final text>`.

### SCENARIO-3

When independent scenario review identifies material scenario gaps and fewer than three scenario review rounds have occurred, Captain shall prompt Analyst:

> Before repairing scene definitions, archive-scope-review and reopen-units --unit for each affected owner. Regenerate affected units one at a time with start-unit/complete-unit, and pass check-generation before returning for review. Repair the identified scenario omissions or contradictions, preserving confirmed requirement links or separately reviewed reverse_rule_ids and actual target code sources. Never silently approve a pending rule.
> Update the ledger's completeness assessment and basis.
> Follow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.
> > <project>
> > <test-dir>
> > <scenario-findings>

### SCENARIO-4

When independent scenario review has passed, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/scenario-gate.json

Results:
- `passed`: The script's requirements, resources, and scenarios gates all pass, so execution may start.
- `failed`: At least one required pre-execution script gate does not pass; do not start execution or claim full acceptance, retain and report the exact failed gate, and return to Analyst for repair and another review while scenario review rounds remain, otherwise finishing as incomplete acceptance.

### SCENARIO-5

When the pre-execution structural gate fails and fewer than three scenario review rounds have occurred, Captain shall prompt Analyst:

> Repair the structural issue the failed pre-execution gate reported in the applicable ledger definitions.
> Update the ledger's completeness assessment and basis.
> Follow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.
> > <project>
> > <test-dir>

### EXECUTION-1

When pre-execution gates pass, or the preceding scenario evaluation gate passes, Captain shall prompt Tester:

> If run-id is empty or names a completed prior run after an authorized design repair, choose a unique run ID and create `python3 <skill>/scripts/playbook.py new-run <project> --test-dir <test-dir> --id RUN_ID --revision PRODUCT_REVISION --environment ENVIRONMENT --coverage-mode <coverage-mode> --scenario-loop`.
> Read execution-coverage-policy.json before new-run; the checker inherits and freezes it as coverage_policy in run.json and execution-plan.json. Never turn required into off or drop it after a repair/new run. It is separate from coverageMode and never starts enhancement rounds.
> Immediately verify all resource decisions for this run and persist run-dependency records with actual evidence before any scenario begins. Existing resource discovery does not substitute for per-run checks. Keep product files and reviewed definitions fixed. Read this run's progress and execution-plan.json. Run `python3 <skill>/scripts/playbook.py next-scenario <project> --test-dir <test-dir> --run RUN_ID`. Only select the returned priority scenario; do not prepare or execute later scenarios.
> Return selected with runId and scenarioId when one is available. The preceding scenario must already have a persisted independent verdict and a passed check-scenario gate.
> If none is available, call finish-run to record all not_run items and close the run. Use --stopped only for an actual early stop. A partial scope or any not_run returns partialRecorded; otherwise recorded. Do not reset the deadline or merge previous run results.
> Results are visible during execution; every phase transition uses scenario-step and atomic writes. Never write run.json by hand.
> > <project>
> > <test-dir>
> > <skill>
> > <coverage-mode>
> > <run-id>

Results:
- `selected`: Next permitted scenario selected. Output shall include `runId: <run ID>` and `scenarioId: <scenario ID>`; proceed to EXECUTION-PREPARE.
- `recorded`: All selected scenarios have completed independent evaluation; full scope has no not_run. Output shall include `runId: <run ID>`; standard goes to EXECUTION-2, coverage goes to COVERAGE-1.
- `partialRecorded`: Partial scope or unexecuted scenarios recorded; Output shall include `runId: <run ID>`; proceed to EXECUTION-2, never coverage loops.

### EXECUTION-PREPARE

When one scenario has been selected, Captain shall prompt Tester:

> Read the selected scenario, confirmed requirements, implementation branches, embedded acceptance instructions, project testing conventions and existing test implementations. Decide how this scenario can be faithfully accepted: reuse existing cases, implement new cases, simulate human operations, or combine them. No automation is mandatory when human simulation provides the required evidence.
> Read execution-findings and the saved repair_reason/attempt history. Repair the execution issue before repeating this same scenario; preserve original evidence. Begin only when pending with scenario-step --action begin; preparing is already begun and must be resumed. Persist the preparing phase before test design/implementation. Respect next-scenario and its started_at; do not start another scenario or edit reviewed scenarios or acceptance instructions.
> Prepare only this scenario's tests and reusable fixtures in project.json.test_layout paths, outside the results ledger. Record an execution binding: mode, reason, cases [{name, origin: existing_case|new_case, path, selector, command, sha256, procedure}], and manual_operations [{id, name, tool, entry_point, procedure}] for AI human simulation. Each procedure independently contains objective, preconditions, test_data, steps [{action, expected}], and scenario_checks [{scenario_id, criterion, scope, covered_point_ids, step_numbers}]. Criterion references exact frozen acceptance criteria; scope states this case/task subset. Describe actual read existing code, final newly implemented code, or actual manual procedure; never copy a scene plan or call expected results observed facts. Independent Reviewer verifies descriptions against implementation and union coverage; missing/inaccurate descriptions require same-scene test_design repair. The item dialog shows only the clicked case/task, business sections first and technical metadata collapsed. Bindings are per-run decisions, not design method kinds. Name every case by its tested business behavior; classify each case separately in combined mode. Newly created means created during this run, not a file originally authored in an earlier run. Unprepared scenes have no inferred associations.
> When coverage_policy.mode is required, read references/code-coverage.md. Prepare binding.coverage_collection.projects for the main product and all frozen code-source projects: exact project ID/name/root/revision, scope targets/exclusions/basis, actual available tool/version/command and capability evidence. Try appropriate configuration when a tool is absent. If genuinely unavailable, record concrete reason, affected source scope and recovery_attempts with actual action/result/evidence. Never classify an unattempted installation or missing configuration as unavailability. For genuine target inability record unavailability_kind runtime_unsupported or access_restricted. Native Istanbul format supports JavaScript/TypeScript; record format istanbul, original source hashes and actual collector/converter provenance under references/code-coverage.md. Successful raw collection rejected by the SKILL parser is a processing defect, never target unavailability; repair it in this scene. prepared rejects a missing declaration. Keep tools/environments outside tracked product files. For PR acceptance coverage, read the PR modification coverage contract: freeze reviewed project.json.coverage_subjects before new-run with exact PR diff base/head and tested product commits, complete source_paths and explained excluded_paths. Include every PR source in component targets and enumerate unloaded/unhit original units; per-scene visited subsets cannot replace the PR denominator. Do not change the frozen ledger in an active run.
> If tracked test code changed, commit exactly this scenario's test changes as one descendant commit before returning testsPrepared. Do not stage existing user changes, edit product files, weaken failed assertions, or commit results. A no-code preparation returns ready and keeps HEAD/worktree unchanged. Use native repository effects; never hide test code with Git ignore rules. If a commit is disallowed by project policy, record blocked.
> Read references/case-design.md (case-design-v1). Create binding.case_design covering every frozen criterion with concrete check_points; assign points and exact step_numbers to each procedure. The planned union must cover all checks. Do not duplicate a scene operation_plan. Use scenario-step --action prepared --input BINDING_JSON to validate product invariance and persist executing phase. Save payload JSON under this run; binding references locate code in project test directories.
> If preparation cannot proceed, first correct test setup/operation problems. Persist any remaining inability with scenario-step --action observe, actual reason, the selected scenario ID and evidence; return blockedRecorded for independent judgment, not automatic completion. Reviewer returns repairRequired for ordinary execution problems; only a demonstrated AI inability to complete after recovery permits a final execution_error. Confirmed product BUGs are recorded, never fixed during this run. Execution-related problems must be repaired within this same scenario before advancing.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <scenario-id>
> > <execution-findings>

Results:
- `ready`: Prepared without repository changes; go to EXECUTION-OPERATE.
- `testsPrepared`: Prepared with exactly one test-only descendant commit; go to EXECUTION-OPERATE. Repository disposition is one-descendant-commit.
- `blockedRecorded`: Preparation blocker durably observed; go to EXECUTION-EVALUATE.

### EXECUTION-OPERATE

When the selected scenario is prepared, Captain shall prompt Tester:

> Execute only this scenario using the chosen binding and acceptance method. Use the actual application/test target and operate the running UI for UI paths. Save actual logs, screenshots and observations that prove asserted behavior, not only command startup. Keep real integration and Mock E2E evidence separate; persist each dependency check in the run through an atomic ledger update.
> When required, collect counters during this exact execution using the prepared tool/scope, including each concrete case; combine their hit sets only within the scene/attempt and same denominator. Include capability evidence, actual invocation, raw coverage JSON and source/version evidence in observe.evidence/evidence_details. After observe and before evaluation, save the current-attempt receipt with scripts/execution_coverage.py. Do not replay silently or borrow old counters. If an available collector fails, preserve the error and enter the same-scene correction loop; do not advance or silently hide coverage. Preserve native V8/Istanbul data and mapping/version evidence; do not disguise it as coverage.py. Unsupported adapter, conversion or parser errors require correction, not an unavailable exemption.
> Do not change product code or test bindings in this step. Record actual observations faithfully. A confirmed product BUG is recorded without repair; an execution mistake, invalid test or insufficient evidence must return to preparation of this same scenario for correction and rerun. One passing subpath cannot erase another failed method.
> Use scenario-step --action observe --input OBSERVATION_JSON with status, actual, evidence paths relative to this run and separate case_results for every bound task, factual summary and step_results for each actual procedure step. Each task owns its evidence; never inherit sibling observations. Immediately after each task finishes, save scenario-step --action case-result for live progress before aggregate observe; the final observation must preserve these facts. It stores evidence hashes and the observation hash and enters evaluating. Record any inability to operate as blocked/unproven with evidence; do not stop later scenarios merely because this one fails.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <scenario-id>

Results:
- `observed`: Actual observation and evidence persisted; go to EXECUTION-EVALUATE.

### EXECUTION-EVALUATE

When the current scenario has observations, Captain shall prompt Reviewer:

> Independently inspect this scenario's requirements, intent, method criteria, code and selected execution binding. Open the actual evidence. Verify case names, precise selectors and this-run existing/new origins against actual preparation and code history; manual bindings must describe actual AI tools/operations without invented human clicks. Read each case/manual procedure and compare its purpose, preconditions/data, action/expected pairs and assigned scenario_checks with actual code or operations. Check precise subset coverage and the union of all bound cases/tasks against the frozen criteria; no individual case pass proves the whole scene. Missing, copied or inaccurate descriptions require same-scene test_design repair. Read references/case-design.md and independently author assessment.case_coverage by actual code/operation inspection, every frozen criterion/check point and exact case step contribution; duplicate checks cannot replace missing points. Missing semantic coverage requires same-scene test_design repair. Case design coverage is distinct from execution pass. Judge whether it proves the scenario; do not infer success from a command exit alone or from Tester assertions.
> When coverage_policy.mode is required, independently inspect coverage_collection, actual commands/counters, original source/version/scope and current receipt, or the evidence and attempted recovery explaining unavailability. Author assessment.execution_coverage with status verified and one project row {project_id, status: measured|unavailable, reason, evidence}. Cite capability evidence and the actual raw JSON in measured rows; unavailable rows cite actual recovery evidence and explain affected scope. Available-but-missing/invalid counters require repair_required, not a product BUG or unavailable exemption. Verify unavailable claims are target runtime/access limitations with the explicit unavailability_kind; raw data already collected but awaiting SKILL parsing is a processing repair. For Istanbul independently audit raw collection, original-source mapping, tool version, all unhit AST units and compatible denominators before accepting measured. Normal final verdicts and check-scenario reject omitted coverage obligations. For PR indicators, independently verify coverage_subjects against exact Git diff and original bytes, justified nonexecuting exclusions, every changed-source inventory and all changed-decision exits. Cumulative PR data may union only compatible original-file units of completed scenes; state missing denominators rather than inventing zero or averaging scene percentages. For demonstrated AI inability before measurement, record execution_coverage status not_completed, concrete reason and cited capability evidence; never invent counters.
> Classify product behavior separately from execution quality. Final normal verdicts are passed or failed (confirmed BUG with bug_description). Missing evidence, invalid case/assertion/setup or incorrect operation is repair_required with problem_kind evidence/test_design/execution, a specific correction reason and cited evidence; return repairRequired to this same scenario preparation. Do not advance, mark these as BUGs or leave ordinary recording problems as final unproven.
> Persist scenario-step --action evaluate --input VERDICT_JSON: status passed/failed/repair_required/execution_error, reason, evidence, reviewer_kind playbook or independent_ai, review_reference and result_sha256 from this scenario progress record. execution_error is exceptional: describe capability_problem and recovery_attempts proving AI cannot complete; retry count alone never proves that. Scenario attempts are preserved in attempt_history and execution_repairs; do not overwrite old evidence. Product code remains fixed throughout retries. Never modify Tester observations, evidence, product code, acceptance instructions or cases.
> The CLI binds the verdict to the observation/evidence. repair_required archives the attempt and returns to preparing, without completing the scenario or advancing priority. passed, confirmed BUG and exceptional AI execution_error complete this scenario; BUGs and AI exceptions create distinctly typed issues. These final verdicts proceed to EXECUTION-SCENARIO-GATE, then the next scenario. Do not repair product BUGs during this run.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <scenario-id>

Results:
- `evaluated`: Independent final verdict (pass, confirmed BUG or exceptional AI inability) and any issue durably recorded; proceed to EXECUTION-SCENARIO-GATE.
- `repairRequired`: Non-BUG execution problem recorded and attempt archived; Output shall include `executionFindings: <specific correction needed>`; return to EXECUTION-PREPARE for the same scenario.

### EXECUTION-SCENARIO-GATE

When this scenario's evaluation is recorded, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check-scenario '<project>' --test-dir '<test-dir>' --run '<run-id>' --scenario '<scenario-id>'

Results:
- `passed`: Lifecycle, binding, evidence hashes, independent evaluation and unchanged product validated; return to EXECUTION-1 after a final pass, confirmed BUG or exceptional AI inability. Ordinary execution problems cannot reach this gate.
- `failed`: Recording invariants failed; proceed to EXECUTION-RECORD-REPAIR for independent diagnosis and correction of this same scenario, never advance or repair product code.

### EXECUTION-RECORD-REPAIR

When the current scenario's record gate fails, Captain shall prompt Reviewer:

> Rerun check-scenario and inspect the exact error and current scenario record. Ordinary execution/recording problems must be repaired in the same scenario, not accepted as final blocked/unproven or mistaken for BUGs.
> For a repairable record problem, call scenario-step --action reopen --input REOPEN_JSON with reason, reviewer_kind and review_reference. Only the current completed scenario may reopen before any later one begins. The CLI archives its observation/verdict and retains prior findings, then returns it to preparing for correction, rerun and independent evaluation. Return repairRequired with exact executionFindings. If a dependency check is missing, require it before prepared/execute on the retry.
> Do not alter old evidence, product files or reviewed definitions. If product/definition invariance has been invalidated by external changes, preserve the run and return invalidated with exact failureDetails requiring a new run; this is a run validity failure, not a final ordinary execution verdict. Never repair product code in this workflow.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <scenario-id>

Results:
- `repairRequired`: Current scenario reopened for correction and rerun; Output shall include `executionFindings: <exact recording problem to fix>`; return to EXECUTION-PREPARE.
- `invalidated`: Product revision or reviewed definitions have externally changed, so this run cannot remain valid; Output shall include `failureDetails: <exact invariant failure and required new-run reason>`; finish incomplete preserving this run.

### EXECUTION-2

When a standard run or a partialRecorded run is recorded, or enhanced COVERAGE-3 passed, and fewer than three execution and review rounds have occurred, Captain shall prompt Reviewer:

> Open the actual evidence and compare it with each executed scenario's expected behavior. Review remaining scenarios as unproven with the recorded not_run reason, without claiming evidence for unexecuted paths.
> Inspect the frozen execution plan and ordered results. For a limited scope or any not_run item, produce the graded execution/evidence summary and remaining risks, run the checker for the reports, and return partial rather than sufficient or repairable. An actual product failure still returns productFailed. Budget/scope exhaustion is not itself a product defect and must not restart execution or coverage loops.
> Independently inspect the confirmed requirements, implementation, scenarios, available gate reports, and actual evidence.
> Check black-box coverage and material implementation branches.
> Verify the fixed coverage policy was satisfied by every completed scenario: real reviewed counters or independently supported unavailability, visible with reason in the coverage relationship view. finish-run and check-scenario must not let available-but-uncollected scenes silently settle. No percentage threshold or coverage-driven supplement loop is introduced.
> Summarize the persisted per-scenario verdicts in review.json without changing their status, reason or evidence. Review not_run scenarios as unproven. Include uncovered branches, review basis and pinned product revision. Per-scenario evaluation has already happened during execution.
> Keep the pinned product manifest fixed; test-only commits do not change the product revision.
> Change no application code or other ledger definitions during this review.
> Run `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir> --run <run-id> --coverage-mode <coverage-mode>`, inspect `gate-report.json`, `run.json` and `review.json`; the coverage relationship view is the user report, so create no extra report or supplement-process entry, and report the exact script verdict.
> A passing script report never substitutes for your substantive evidence judgment.
> Fundamental review principle: for every selected requirement, a plausible wrong implementation in any important operation mode or user state must fail at least one linked acceptance scenario through an observable result; use this counterfactual principle when unsure how to review.
> > <project>
> > <test-dir>
> > <skill>
> > <coverage-mode>
> > <run-id>

Results:
- `sufficient`: Every required scenario's outcome is proven by sufficient evidence and all five base script gates pass and the additional code_coverage gate passes only in coverage mode, with reasoned verdicts for the exact revision recorded in `review.json`.
- `repairable`: The independently reviewed definitions or frozen run baseline require correction; Analyst corrects those definitions and Tester starts a new run repeating every required scenario. Ordinary case, operation, evidence or scenario-recording defects must already be corrected inside that scenario, never deferred to this aggregate branch. If this is the third execution and review round, the workflow reports incomplete acceptance with those items instead. Output shall include `reviewFindings: <verbatim final text>`.
- `partial`: The frozen scope is partial or some scenarios are not_run, and independent review of available evidence is complete. Output shall include `reviewFindings: <verbatim final text>`. Treat this as a terminal negative settlement: evidenceSufficient and runGatePassed stay false; fix failureDetails from reviewFindings and preserve the terminal runId; go to COMPLETION-1 and then incomplete, never another execution/coverage round.
- `productFailed`: Actual behavior fails or a required path cannot be operated; a product failure finishes as incomplete acceptance. Output shall include `reviewFindings: <verbatim final text>`.

### EXECUTION-3

A Boss interruption may re-enter this run-gate check after a run ID exists even if the in-memory Reviewer verdict is not present; such a re-entry can only produce incomplete acceptance, because full acceptance requires both the script gates and the independent Reviewer verdict in the current session. Do not let an interrupted gate check infer that the missing verdict passed.

When independent evidence review finds the run sufficient for the exact revision, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' --run '<run-id>' --coverage-mode '<coverage-mode>' --require-scenario-loop

Results:
- `passed`: The script's requirements, resources, scenarios, execution, and review gates pass for this run, and a zero exit permits full acceptance.
- `failed`: At least one script gate fails for this run; retain and report its exact failures. Analyst then repairs the reported structural issue and Tester starts a fresh full run while execution and review rounds remain; otherwise the workflow reports incomplete acceptance.

### EXECUTION-4

When review classifies a gap as repairable and fewer than three execution and review rounds have occurred, Captain shall prompt Analyst:

> Correct the applicable ledger definitions so the recording gap is resolved.
> A new run and repetition of every required scenario are needed before another review.
> Follow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.
> > <project>
> > <test-dir>
> > <run-id>
> > <review-findings>

### EXECUTION-5

When the run gate fails and fewer than three execution and review rounds have occurred, Captain shall prompt Analyst:

> Repair the structural issue the failed run gate reported in the applicable ledger definitions.
> A fresh full run of the required scenarios follows before another review.
> Follow the ledger structure in the skill's `references/data-model.md` and put no real credential values in the ledger or evidence.
> > <project>
> > <test-dir>
> > <run-id>

### COVERAGE-1

When EXECUTION-1 records an enhanced run and fewer than three coverage collection rounds have occurred, Captain shall prompt Tester:

> Collect actual code coverage from this full run using this project's verified tools and references/code-coverage.md.
> Save raw reports, actual tool versions, commands, environment, original-source mapping, measured line/branch counters, all uncovered units, tested Git/source SHA and frozen run ledger hashes in runs/<run-id>/code-coverage/measurement.json.
> Instrument copies only under ignored test assets. Do not alter product code or assertions, combine another run/revision's counters or remove defensive denominators.
> Missing collection or required unmeasured modules are blocked; never fabricate zero gaps or downgrade the mode.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <coverage-mode>

Results:
- `measured`: Complete enhanced measurement recorded; proceed to COVERAGE-2.
- `blocked`: Missing tool, source mapping or required module measurement; finish incomplete. Output shall include `failureDetails: <exact measurement blocker>`.

### COVERAGE-2

When fresh enhanced coverage is measured, Captain shall prompt Reviewer:

> Independently inspect raw counters, original-source mapping and exact binding, complete scope/exclusions, material uncovered paths and important operation/user state and transition combinations, including already executed code.
> Read references/code-coverage.md and write runs/<run-id>/code-coverage/review.json bound to measurement SHA, run revision and frozen ledger hashes.
> Do not edit scenarios, embedded acceptance or measurement. Each deficit needs a reasoned disposition or concrete recommendation linked to confirmed requirements and scenarios.
> Keep defensive/nonmaterial uncovered exits in original denominators. Coverage percentage alone does not prove sufficiency.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <coverage-mode>

Results:
- `sufficient`: No necessary testing recommendations remain and all residual paths have reviewed dispositions; proceed to COVERAGE-3. Does not replace EXECUTION-2's evidence review.
- `gaps`: Concrete testing/recording gaps remain. Output shall include `coverageFindings: <verbatim final text>`. Proceed to COVERAGE-4 when coverageRounds is below three, otherwise incomplete with these exact findings.
- `productFailed`: Actual behavior fails; finish incomplete. Output shall include `failureDetails: <exact product failure>`.
- `blocked`: Required measurement/source scope is unproven; finish incomplete. Output shall include `failureDetails: <exact measurement blocker>`.

### COVERAGE-3

When independent coverage review is sufficient in enhanced mode, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check-code-coverage '<project>' --test-dir '<test-dir>' --run '<run-id>' > '<test-dir>'/delivery-acceptance/runs/'<run-id>'/code-coverage/gate-report.json

Results:
- `passed`: The optional code-coverage script gate passes; proceed to EXECUTION-2.
- `failed`: Proceed to COVERAGE-4 while coverageRounds is below three. The script carries no prose payload and must not set coverageFindings. Analyst reads the existing gate report by the run/test directory path. At the limit finish incomplete with failureDetails identifying runs/<run-id>/code-coverage/gate-report.json, without inferring script output text.

### COVERAGE-4

When enhanced coverage identifies repairable testing/recording gaps and fewer than three coverage rounds have occurred, Captain shall prompt Analyst:

> Read runs/<run-id>/code-coverage/gate-report.json when present, including its exact failed issues; combine with Reviewer coverage-findings if supplied. Repair the exact findings under ignored test assets. Add or strengthen scenarios with embedded acceptance linked to confirmed requirements or independently justified reverse rules per references/white-box-rules.md; preserve existing IDs when refining.
> Preserve prior measurements, reviews and runs. Do not change requirements/product source, self-approve reviews, weaken assertions or erase uncovered deficits.
> Product changes belong outside this workflow. Re-review changed design and start a fresh full run; old passing evidence cannot validate new definitions.
> > <project>
> > <test-dir>
> > <skill>
> > <run-id>
> > <coverage-mode>
> > <coverage-findings>

Results:
- `done`: Reset the scenario-review counter for changed definitions, return to SCENARIO-2 and SCENARIO-4, then a fresh EXECUTION-1 full run. Never reset coverageRounds.

### COMPLETION-1

Captain settles the terminal run without creating a new run, executing more tests, or changing ledger files. On an incomplete outcome the machine emits the terminal run's exact failure detail string and the terminal run ID, even if Captain's summary mentions other evidence.

When the workflow reaches a gate outcome, the applicable review-round limit, or another terminal outcome such as absent requirements or an unavailable resource, Captain shall report delivery acceptance:

> Report full acceptance only when the script's five base gates all pass, plus code_coverage only in coverage mode and Reviewer finds sufficient evidence for every required scenario.
> Otherwise report by P0/P1/P2/P3: total, execution passed, independently evidence-reviewed, failed, blocked, unproven and not_run counts, plus each remaining scenario and its failure consequence from priority_reason. Show the selected scope and deadline stop reason. A P0 failure, blocker or insufficient evidence is an unresolved critical risk and blocks full delivery.
> A selected-grade verification conclusion such as P0/P1 verified is valid only for actually executed, independently proven scenarios in that grade; grades with zero scenarios are not verified. Label limited runs as partial verification / incomplete acceptance, never full acceptance. Otherwise report failed, uncovered, unproven, not_run and environment-blocked items with exact run and evidence paths where they exist.
> Do not infer acceptance from a player's assertion or a partial run.
> Do not ask Boss to click through ordinary tests; agents execute available tests and actual application paths themselves.
> If AI truly cannot complete a required scenario after attempted recovery, report its saved independent execution_error verdict and supporting evidence. Ordinary case, operation or evidence defects require correction in that same scenario, not a final unproven verdict.
> Never invoke `run_workflow.py`, `/delivery-acceptance`, or another Playbook session.
> > <project>
> > <test-dir>

> > <run-id>
> > <scenario-findings>
> > <review-findings>
> > <failure-details>
> > <coverage-mode>

Results:
- `accepted`: All script gates and Reviewer's substantive evidence judgment support full acceptance. Output shall include `response: <nonempty full-acceptance report>`.
- `incomplete`: Any required gate or substantive review does not support full acceptance, or a required path cannot be operated. Output shall include `response: <nonempty report of failed, uncovered, unproven, and environment-blocked items with exact run and evidence paths where they exist>`. Captain may echo failureDetails and runId, but the machine uses its fixed terminal context as specified above.

## Optimizations

- SCENARIO-4: captain → script
- EXECUTION-3: captain → script

## Scope recovery invariant

Every actor reads current published plan and scope-decisions before work. Latest genuine human decisions precede old conversation context; persist them first, check content bindings and stop superseded execution. New scene suggestions cannot alter formal scope/queue. All execution writes and next-scenario use scope-checked CLI. A scope change requires stopping workers, abort-run preserving history, local review and next-plan publication, then a new run. Never reset deadlines or certify old evidence under changed scope. Opt-in coverage enhancement cannot expand business scope. Final outputs distinguish selected-scope completion from all-original-requirements acceptance.

The mode-specific recorded transitions never apply to selected or partialRecorded: selected always enters EXECUTION-PREPARE, partialRecorded always enters EXECUTION-2 in either mode and cannot enter coverage loops. The existing Target is supplied as baseline; preserve its exports and old public IDs while adding the organization states.

## Ordered design pipeline runtime contract

The host and outer launcher contracts remain fixed, including public exports and working-state paths. New physical states/sourceItems are sourceAnalysis/ANALYSIS-1 (Analyst), analysisGate/ANALYSIS-GATE (script), organizationDesign/ORGANIZATION-DESIGN (Analyst), generationGate/GENERATION-GATE (script). ENTRY-1 ready -> sourceAnalysis -> analysisGate -> organizationDesign -> organizationReview -> organizationGate; never jump directly from entry to organizationReview. Source analysis has a separate maximum-three-attempt counter, never reset on recovery. Both source analysis and organization script gates are required for design admission and successful completion. Design more enters unitAdvance/UNIT-ADVANCE, whose actual zero-exit returns to scene design; done goes to generationGate; generationGate passed enters the original independent scene review, failed terminates incomplete with the exact gate path. Successful completion additionally requires generationGatePassed. BOSS_INTERRUPT cannot enter design, review or execution without the actual preceding script gate flags; acting outcomes cannot set them. Units and per-unit completion are authoritative in design-progress.json, not generated FSM context guesses. Preserve a paused current unit and frozen protected-scene hashes when resuming; current requirements/rules/decisions must match the session. No new model configuration or external services are needed.

## Probeable ordered admissions and unit continuation

Use unitAdvance/UNIT-ADVANCE as a real script state for the more result. This makes a distinct observable transition and validates persisted per-unit progress. The more onDone arm itself only requires the exact well-formed more output, with no target admission rechecks. New script gate flags are assigned only on exact zero-exit script outputs. Existing pipeline edges ensure earlier gates transitively; do not add all earlier boolean flags to every downstream guard. For BOSS_INTERRUPT retain original target readiness but use only the nearest required script gate: organizationDesign requires analysisGatePassed, resource1 and scene design require organizationGatePassed, scene review and later require generationGatePassed. Existing per-scene/evidence/coverage readiness still applies. Successful Captain result moves to three transparent terminal proof states terminalAnalysisProof, terminalOrganizationProof, terminalGenerationProof, each checking exactly one corresponding flag before the original success terminal; failed proof yields incomplete. They have no actors or work. Do not put a conjunction of all three flags into completion output guard or every old entry arm. Keep each guard's domain result validation explicit, and do not weaken final proofs or script gates. This replacement supersedes earlier repeated compound admission clauses.
