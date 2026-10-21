# Black-box delivery scenarios

This Playbook takes a project, a user-selected test directory, a confirmed requirements JSON file, and the installed path of this Skill. Its sole deliverable is a reviewed set of black-box delivery acceptance scenarios. A runnable application, application code, devices, test accounts, credentials, third-party integrations, resource preflight, white-box scenarios, and execution evidence are not prerequisites. Never ask Boss for the location of an unimplemented app in this workflow. Never declare application delivery accepted here.

Fundamental REVIEW principle: A requirement's acceptance scenarios are sufficient only when passing their eventual real execution with the required evidence would support delivering that requirement to users within its agreed usage scope without an obvious defect. For each important operation mode, user state, boundary and transition, imagine a plausible incorrect implementation. If that implementation could still pass every linked scenario, the review must fail and identify the escaping fault. When unsure how to review a requirement, use this counterfactual question to decide what to inspect or add. Requirement-ID coverage and scenario count alone never establish sufficiency. Design review cannot itself prove the App works or that every possible bug is absent.

The ledger is `<test-dir>/delivery-acceptance/`, is Git-ignored, and follows `<skill>/references/data-model.md`. The deterministic stage checker is `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir> --stage design`. Never put real credentials in the ledger. This is already an active Playbook session: neither Captain nor any role may invoke `run_workflow.py`, `/black-box-scenarios`, or another Playbook from inside it. All role outcomes leave Git HEAD and Git-visible worktree unchanged.

Runtime preservation: BOSS_TASK admission validates and fixes project, testDir and skill before scenario work. For scenarioRepair BOSS_INTERRUPT, require scenariosReady, concrete failureDetails and fewer than three scenario rounds; do not repeat unrelated path-field admission checks. Preserve the script GATE-1 and synthesize its failure detail from the gate-report path, never a Captain verdict.

Roles:

- Analyst
- Reviewer

Analyst creates and repairs scenarios with embedded acceptance under the ignored ledger. Reviewer independently checks requirement coverage and scenario meaning. Captain reports the terminal result. Reviewer must not modify Analyst's ledger; only Analyst repairs it. The deterministic `script` actor independently reruns the stage checker after a positive Reviewer verdict. Only a zero exit may produce `scenariosReady`. A failed checker returns to Analyst for repair, at most three review rounds. No Tester role and no test execution in this workflow.

The outer launcher has already obtained the user-selected test directory `<test-dir>` (suggested default `<project>/tests`). Keep this directory fixed. Design ledgers, resources, reviews, results, screenshots and reports belong under `<test-dir>/delivery-acceptance/`. Case code and reusable test fixtures belong in the project normal test organization and are prepared only when a scenario enters execution. Use `--test-dir <test-dir>` for every checker operation; relative paths resolve against the project. Existing project test cases may be referenced in place.

Every black-box and white-box scenario needs `priority` (P0/P1/P2/P3) and a concrete `priority_reason` describing failure consequences. Use `<skill>/references/scenario-priority.md` for the grading criteria. Assess business risk, likelihood and affected users; do not use execution cost or dependency scheduling. Keep the complete design regardless of the selected execution scope. Do not automatically grade every happy path high or every exceptional/boundary path low, and do not impose a quota per grade. Reviewer independently challenges underestimation and indiscriminate inflation and records a reasoned judgment for every scenario. A priority or reason change invalidates its scoped review and prior run bindings. Legacy unclassified scenarios need explicit grading and fresh independent review before a new design/acceptance gate can pass.

### ENTRY-1

When the playbook receives the project, the selected test directory, the requirements JSON file, and the installed Skill path, Captain shall prompt Analyst:

> Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.
> Preserve all original requirement text/IDs and genuine scope decisions. Initialization/import only: do not generate units or scenarios in ENTRY-1. On ready proceed to ANALYSIS-1.
> Verify that the supplied requirements file contains a confirmed version with source and stable, unique IDs with nonempty text.
> If it is absent or ambiguous, report the exact gap; do not invent or approve requirements.
> Otherwise run `python3 <skill>/scripts/playbook.py init <project> --test-dir <test-dir> --requirements <requirements-file>` on first use, or `import-requirements` when the approved source changed.
> If an initialized ledger already has the same requirements snapshot, reuse it without deleting prior decisions.
> A changed approved requirements snapshot invalidates prior scenario completeness.
> Never put real credentials in the ledger.
> Do not invoke `run_workflow.py`, `/black-box-scenarios`, or another Playbook from inside this session.
> Keep the user-selected test directory fixed; the outer launcher already obtained it, with suggested default `<project>/tests`.
> Keep requirements snapshots, resource decisions, scenarios with embedded acceptance, reviews, results, screenshots and reports under `<test-dir>/delivery-acceptance/`. Executable cases, reusable Mocks, fixtures and harnesses follow project test conventions outside this ledger; precise case bindings are chosen only during scenario execution.
> Use `--test-dir <test-dir>` for every checker operation; relative paths resolve against the project.
> > <project>
> > <test-dir>
> > <requirements-file>
> > <skill>

Results:
- `ready`: The requirements file contains a confirmed version with source and stable, unique IDs with nonempty text, and the successful first-use initialization or changed-source import is complete.
- `requirementsGap`: The requirements file is absent or ambiguous; do not invent or approve requirements. Output shall include `failureDetails: <exact requirements gap>`.

### ANALYSIS-1

After ENTRY-1 ready or an analysis gate repair while fewer than three source analysis attempts have occurred, Captain shall prompt Analyst:

> Read fixed design-stage-policy.json and references/design-pipeline.md and references/white-box-rules.md. Analyze the complete original requirements first. Read the fixed design-stage-policy.json. The stage is black-box or white-box design-only; if no policy is present the explicit current task determines the stage.
> For black-box stage, write an explicit empty reverse-rule inventory and explain that no implementation analysis is requested. For white-box stage, inspect the actual implementation and record all material reverse rules before any acceptance organization. Use existing confirmed requirements when sufficient; separately assess supplemental-rule correctness and current-change applicability. Persist out-of-scope/pending candidates visibly, with reasons; never expand the agreed scope.
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

> Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.
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

> Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.
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

> Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.
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
- `passed`: Zero exit verifies current organization and independent review; proceed to DESIGN-1.
- `failed`: Nonzero exit sets failureDetails exactly to "Organization gate failed; inspect <test-dir>/delivery-acceptance/organization-gate.json" and enters ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred, otherwise finish incomplete. Never replace script execution with a Captain assertion. Increment the separate organization counter once per ORGANIZATION-1, maximum three; recovery never resets it.


### DESIGN-1

When the requirements are ready, Captain shall prompt Analyst:

> Read the fixed design-stage-policy.json (black-box or white-box) and references/design-pipeline.md, acceptance-organization.md, design-quality.md, output-standards.md and scenario-priority.md. Preserve full original sources, the published plan and confirmed user exclusions.
> Call design-next, then start-unit --unit ID for exactly that next unit. Generate only this unit's scenes, each with generation_unit_id and admitted scope.unit_ids; preserve every other unit's scene bytes. Persist each complete scene atomically as produced so live progress remains visible. Each scene embeds acceptance(description/preconditions/actions/criteria/evidence_expected), exact per-criterion scope admission and structured global business risk. Assign concrete P0/P1/P2/P3 consequences against all requirements and business journeys, never grade quotas or execution-order preferences.
> In black-box mode create only kind=black_box scenes from included original checks, with requirement_ids and scenarios.json.design_basis. No implementation/resources are required. Set black_box_complete only after all units are generated and assessed; do not set white_box_complete.
> In white-box mode create only kind=white_box scenes from this unit's original checks and admitted rule_ids. Read actual source to design target_condition and code_sources, but do not add or modify frozen reverse rules. Save white_box_rules.json root design_standard/design_basis and scenarios.json.white_box_complete only after all units are generated and assessed. Do not require or generate black-box scenes or execution resources.
> Complete-unit --unit ID must pass after this unit's actual scenes cover all its checks/rules. Then call design-next: return more if another unit remains, otherwise done. Never claim global completion early. New source/required policy changes require renewed analysis and organization review in a new session; do not expand scope here.
> Do not create executable test code, methods.json, method_ids, cases or execution observations. Do not author the independent coverage_review.json. Use playbook.py directly with fixed project/test-dir/skill paths, keep ledger Git-ignored, and never invoke another Playbook.
> > <project>
> > <test-dir>
> > <skill>


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

### REVIEW-1

When the scenario draft is ready for independent review or has been repaired, and fewer than three review rounds have occurred, Captain shall prompt Reviewer:

> Read the fixed design-stage-policy.json and the same design-pipeline/organization/design-quality/output-standards/scenario-priority contracts. Review current scope before coverage and global risk; suggestions outside scope are nonblocking. Independently inspect all exact scenario criteria, challenge escaping wrong implementations in every important operation/state, and compare importance across units.
> Write acceptance_scope_review in coverage_review.json with actual independent identity/reference, plan_sha256, per-scene scenario/dependency hashes from scope-review-hashes, scope_reason, priority_reason, causal_chain_review and global_priority_calibration. Original unchanged judgments may be retained only with archive-scope-review provenance and matching current dependencies. Never modify Analyst's scenes or invent scope.
> In black-box mode independently review scenarios.json.design_basis against every selected requirement using the full v4 coverage_results/check_points/scenario_coverage/five criteria/findings/scope/limitations contract. Write one priority_reviews entry per black scene, root design_standard/output_quality and exact review-hashes. No implementation or white-box review is required.
> In white-box mode inspect actual code_sources and target_condition, frozen original requirements and all discovered reverse rules. Write white_box_priority_review with actual white-box-priority-hashes, one grade judgment per white scene, rule_reviews for every discovered rule (out-of-scope/pending remains visible and nonblocking), and v4 design_reviews for precisely the active linked original requirements/rules against white_box_rules.json root design_basis. Include output_quality for every white scene/acceptance. No black-box coverage, resources or execution evidence is required.
> Run check-generation, then playbook.py check --stage design; return passed only if the substantive independent review and exact current design gate pass. Otherwise return gaps with exact failureDetails. Never self-approve Analyst artifacts, request ordinary user list approval or start another Playbook.
> > <project>
> > <test-dir>
> > <skill>


Results:
- `passed`: Independent review finds every selected requirement sufficient and no important path uncovered, all current-stage scene priorities, sources and criteria have passed independent review with no grade disagreement, and the direct design-stage checker passes.
- `gaps`: Independent review finds a plausible important fault that a linked scenario could not expose, a method that cannot produce its claimed failure signal, a requirement too ambiguous to know the intended outcome, a priority or reason disagreement, an unclassified scenario lacking explicit grading and fresh independent review, or any failure of the requirements, black-box-scenarios, or coverage-review checker gates. Output shall include `failureDetails: <exact gaps, including applicable requirement IDs, missing modes/states, counterexamples, scenario references, priority disagreements, and checker failures>`.

### GATE-1

When independent scenario review has passed, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' --stage design > '<test-dir>'/delivery-acceptance/black-box-gate.json

Results:
- `passed`: The stage checker exited with status zero and its black-box gate report is written; `scenariosReady` may follow only on this zero exit.
- `failed`: The stage checker exited with a nonzero status; do not report `scenariosReady`, and return to Analyst for repair while review rounds remain.

### REPAIR-1

When Reviewer identifies material gaps or the black-box stage checker exits nonzero, and fewer than three review rounds have occurred, Captain shall prompt Analyst:

> Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.
> Archive-scope-review and reopen-units for affected owners, then regenerate one unit at a time with start-unit/complete-unit and pass check-generation. Repair only the named gaps in the ignored ledger files, preserving confirmed requirement IDs and existing valid scenarios.
> Read the black-box gate report at `<test-dir>/delivery-acceptance/black-box-gate.json` when the stage checker failed.
> Leave Git HEAD and the Git-visible worktree unchanged.
> Do not invoke `run_workflow.py`, `/black-box-scenarios`, or another Playbook from inside this session.
> Keep the user-selected test directory fixed; the outer launcher already obtained it, with suggested default `<project>/tests`.
> Keep requirements snapshots, resource decisions, scenarios with embedded acceptance, reviews, results, screenshots and reports under `<test-dir>/delivery-acceptance/`. Executable cases, reusable Mocks, fixtures and harnesses follow project test conventions outside this ledger; precise case bindings are chosen only during scenario execution.
> Use `--test-dir <test-dir>` for every checker operation; relative paths resolve against the project.
> Every black-box and white-box scenario needs `priority` (P0/P1/P2/P3) and a concrete `priority_reason` describing failure consequences.
> Use `<skill>/references/scenario-priority.md` for the grading criteria; assess business risk, likelihood and affected users, not execution cost or dependency scheduling.
> Keep the complete design regardless of the selected execution scope.
> Do not automatically grade every happy path high or every exceptional/boundary path low, and do not impose a quota per grade.
> A priority or reason change invalidates its scoped review and prior run bindings.
> Legacy unclassified scenarios need explicit grading and fresh independent review before a new design/acceptance gate can pass.
> > <project>
> > <test-dir>
> > <skill>
> > <failureDetails>

### COMPLETION-1

When the Reviewer verdict and the black-box stage gate have passed, or the workflow cannot proceed after the allowed repairs or because the requirements are unavailable, Captain shall report the terminal result:

The workflow returns a nonempty `response` to the caller in either terminal outcome, with the contents required by that outcome.

> Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.
> Report `scenariosReady` with a nonempty `response` naming the scenario ledger path, the number of black-box scenarios and P0/P1/P2/P3 counts plus unclassified gaps, the requirement coverage, and the black-box gate report.
> Completion is read-only: do not edit any file, including tracked documentation or ledger files, or run more design or checker work.
> Explicitly state that no App behavior was executed or accepted.
> A `scenariosReady` result is a successful design deliverable, not full application acceptance.
> Otherwise report `incomplete` with the exact failure details.
> Never declare application delivery accepted here.
> > <project>
> > <test-dir>
> > <failureDetails>

Results:
- `scenariosReady`: The Reviewer verdict and the black-box stage gate both pass. Output shall include `response: <nonempty report naming the scenario ledger path, the number of black-box scenarios and P0/P1/P2/P3 counts plus unclassified gaps, requirement coverage, and the black-box gate report>`.
- `incomplete`: A black-box gate fails after the allowed repairs, material gaps remain after three rounds, or the requirements are unavailable. Output shall include `response: <nonempty report of the exact failure details>`.

## Optimizations

- GATE-1: captain → script

Organization states have physical IDs organizationReview, organizationRepair and organizationGate. Preserve all existing IDs, exports, BOSS_TASK admission, fixed paths and suspend/resume. Separate three-round organization review bound. Latest user scope decisions precede old context; persist decisions, revalidate bindings and never restore excluded scenes.

Runtime admission invariants: BOSS_INTERRUPT to scenarioDesign is permitted only by organizationGatePassed; fixed admitted paths do not need repeated admission checks there. BOSS_INTERRUPT to completion retains the original nonempty-project prerequisite. Successful terminal scenariosReady must require organizationGatePassed as well as scenarioReviewPassed and blackBoxGatePassed. These guards cannot be bypassed by Captain output.

## Complete preserved black-box runtime contract

The supplied existing Target FSM is the baseline for existing public contracts. Export blackBoxScenariosMachine and default-export the same machine; retain MachineInput, MachineOutput, PendingBossQuestion, CaptainInput, PlayerInput, ScriptInput, ScriptOutput, CaptainOutput, PlayerOutput, and concurrentRoleSets exports. MachineInput is Record<string, never>; MachineOutput has response:string. Existing physical/public state IDs are ready, entry, scenarioDesign, scenarioReview, scenarioRepair, blackBoxGate, completion, failed, awaitBossReply, scenariosReady and incomplete. Add sourceAnalysis, analysisGate, organizationDesign, organizationReview, organizationRepair, organizationGate and generationGate. Preserve START as the existing backwards-compatible alias of BOSS_TASK; both admit nonempty project/testDir/requirementsFile/skill paths once and fix them for that task. This is not the full-acceptance host-owned input contract. Native runtime options remain optional cwd only. BOSS_INTERRUPT has targetId naming a declared working state; BOSS_REPLY has nonempty answer and optional questionId, resumes the original acting task without resetting either review counter. Source path fields cannot be overwritten by role outcomes or subsequent replies. Existing terminal guards remain scenariosReady/incomplete; successful scenariosReady additionally requires the organization script gate. Reviewer and Captain outcomes must not manufacture these script flags.

## Ordered design pipeline runtime contract

The host and outer launcher contracts remain fixed, including public exports and working-state paths. New physical states/sourceItems are sourceAnalysis/ANALYSIS-1 (Analyst), analysisGate/ANALYSIS-GATE (script), organizationDesign/ORGANIZATION-DESIGN (Analyst), generationGate/GENERATION-GATE (script). ENTRY-1 ready -> sourceAnalysis -> analysisGate -> organizationDesign -> organizationReview -> organizationGate; never jump directly from entry to organizationReview. Source analysis has a separate maximum-three-attempt counter, never reset on recovery. Both source analysis and organization script gates are required for design admission and successful completion. Design more enters unitAdvance/UNIT-ADVANCE, whose actual zero-exit returns to scene design; done goes to generationGate; generationGate passed enters the original independent scene review, failed terminates incomplete with the exact gate path. Successful completion additionally requires generationGatePassed. BOSS_INTERRUPT cannot enter design, review or execution without the actual preceding script gate flags; acting outcomes cannot set them. Units and per-unit completion are authoritative in design-progress.json, not generated FSM context guesses. Preserve a paused current unit and frozen protected-scene hashes when resuming; current requirements/rules/decisions must match the session. No new model configuration or external services are needed.

For white-box design-only stage, the same physical role flow applies without resources/execution. ANALYSIS-1 uses actual implementation and already confirmed requirements; DESIGN-1 generates only white_box scenes for the current unit and preserves confirmed source inventory. REVIEW-1 independently reviews white_box_rules root design_basis, code source/provenance, white_box_priority_review and per-source design_reviews/output_quality plus the same global scope review. Do not require black_box scenes in this mode or set black_box_complete. GATE-1 check --stage design selects the fixed analyzed design stage. All role prompts must read design-stage-policy.json and use its exact fixed stage, never infer stage from stale context.

## Probeable ordered admissions and unit continuation

Use unitAdvance/UNIT-ADVANCE as a real script state for the more result. This makes a distinct observable transition and validates persisted per-unit progress. The more onDone arm itself only requires the exact well-formed more output, with no target admission rechecks. New script gate flags are assigned only on exact zero-exit script outputs. Existing pipeline edges ensure earlier gates transitively; do not add all earlier boolean flags to every downstream guard. For BOSS_INTERRUPT retain original target readiness but use only the nearest required script gate: organizationDesign requires analysisGatePassed, resource1 and scene design require organizationGatePassed, scene review and later require generationGatePassed. Existing per-scene/evidence/coverage readiness still applies. Successful Captain result moves to three transparent terminal proof states terminalAnalysisProof, terminalOrganizationProof, terminalGenerationProof, each checking exactly one corresponding flag before the original success terminal; failed proof yields incomplete. They have no actors or work. Do not put a conjunction of all three flags into completion output guard or every old entry arm. Keep each guard's domain result validation explicit, and do not weaken final proofs or script gates. This replacement supersedes earlier repeated compound admission clauses.
