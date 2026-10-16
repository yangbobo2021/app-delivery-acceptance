# Black-box delivery scenarios

This Playbook takes a project, a user-selected test directory, a confirmed requirements JSON file, and the installed path of this Skill. Its sole deliverable is a reviewed set of black-box delivery acceptance scenarios. A runnable application, application code, devices, test accounts, credentials, third-party integrations, resource preflight, white-box scenarios, and execution evidence are not prerequisites. Never ask Boss for the location of an unimplemented app in this workflow. Never declare application delivery accepted here.

Fundamental REVIEW principle: A requirement's acceptance scenarios are sufficient only when passing their eventual real execution with the required evidence would support delivering that requirement to users within its agreed usage scope without an obvious defect. For each important operation mode, user state, boundary and transition, imagine a plausible incorrect implementation. If that implementation could still pass every linked scenario, the review must fail and identify the escaping fault. When unsure how to review a requirement, use this counterfactual question to decide what to inspect or add. Requirement-ID coverage and scenario count alone never establish sufficiency. Design review cannot itself prove the App works or that every possible bug is absent.

The ledger is `<test-dir>/delivery-acceptance/`, is Git-ignored, and follows `<skill>/references/data-model.md`. The deterministic stage checker is `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir> --stage black-box`. Never put real credentials in the ledger. This is already an active Playbook session: neither Captain nor any role may invoke `run_workflow.py`, `/black-box-scenarios`, or another Playbook from inside it. All role outcomes leave Git HEAD and Git-visible worktree unchanged.

Runtime preservation: BOSS_TASK admission validates and fixes project, testDir and skill before scenario work. For scenarioRepair BOSS_INTERRUPT, require scenariosReady, concrete failureDetails and fewer than three scenario rounds; do not repeat unrelated path-field admission checks. Preserve the script GATE-1 and synthesize its failure detail from the gate-report path, never a Captain verdict.

Roles:

- Analyst
- Reviewer

Analyst creates and repairs scenarios with embedded acceptance under the ignored ledger. Reviewer independently checks requirement coverage and scenario meaning. Captain reports the terminal result. Reviewer must not modify Analyst's ledger; only Analyst repairs it. The deterministic `script` actor independently reruns the stage checker after a positive Reviewer verdict. Only a zero exit may produce `scenariosReady`. A failed checker returns to Analyst for repair, at most three review rounds. No Tester role and no test execution in this workflow.

The outer launcher has already obtained the user-selected test directory `<test-dir>` (suggested default `<project>/tests`). Keep this directory fixed. Design ledgers, resources, reviews, results, screenshots and reports belong under `<test-dir>/delivery-acceptance/`. Case code and reusable test fixtures belong in the project normal test organization and are prepared only when a scenario enters execution. Use `--test-dir <test-dir>` for every checker operation; relative paths resolve against the project. Existing project test cases may be referenced in place.

Every black-box and white-box scenario needs `priority` (P0/P1/P2/P3) and a concrete `priority_reason` describing failure consequences. Use `<skill>/references/scenario-priority.md` for the grading criteria. Assess business risk, likelihood and affected users; do not use execution cost or dependency scheduling. Keep the complete design regardless of the selected execution scope. Do not automatically grade every happy path high or every exceptional/boundary path low, and do not impose a quota per grade. Reviewer independently challenges underestimation and indiscriminate inflation and records a reasoned judgment for every scenario. A priority or reason change invalidates its scoped review and prior run bindings. Legacy unclassified scenarios need explicit grading and fresh independent review before a new design/acceptance gate can pass.

### ENTRY-1

When the playbook receives the project, the selected test directory, the requirements JSON file, and the installed Skill path, Captain shall prompt Analyst:

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

### DESIGN-1

When the requirements are ready, Captain shall prompt Analyst:

> Map every confirmed requirement to at least one black-box scenario.
> Derive relevant operation modes, user states, normal and exceptional behavior, boundaries and transitions from the confirmed requirements; include important combinations, not just the easiest happy path.
> Scenario acceptance must start from a reproducible state, perform the actual user action, and assert an observable result that would fail for an incorrect implementation.
> Keep the scenario observable from the user or external system boundary, and do not claim a particular implementation.
> Record each complete scenario in `<test-dir>/delivery-acceptance/scenarios.json` with `kind: black_box`, `title`, `requirement_ids`, `expected`, `priority`, `priority_reason` and embedded `acceptance` containing `description`, `preconditions`, `actions`, `criteria`, `evidence_expected`.
> Each scenario owns its full acceptance instructions. Do not generate methods.json or independent method IDs. These are verification plans, not evidence of execution.
> Leave case reuse/creation and simulated manual-check choices to scenario execution; design records acceptance criteria and evidence requirements only.
> Set `black_box_complete` only after assessing every confirmed ID.
> Do not set `white_box_complete` without reviewing implemented design or code.
> Preserve any existing white-box scenarios and resource decisions; a new requirements import already invalidates completeness.
> Do not author or mark the independent `coverage_review.json` as passed.
> Follow the ledger structure in `<skill>/references/data-model.md`; keep the ledger Git-ignored and put no real credentials in it.
> Leave Git HEAD and the Git-visible worktree unchanged.
> Never ask Boss for the location of an unimplemented app in this workflow.
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

### REVIEW-1

When the scenario draft is ready for independent review or has been repaired, and fewer than three review rounds have occurred, Captain shall prompt Reviewer:

> Judge a requirement's acceptance scenarios sufficient only when passing their eventual real execution with the required evidence would support delivering that requirement to users within its agreed usage scope without an obvious defect.
> For each important operation mode, user state, boundary and transition, imagine a plausible incorrect implementation.
> If that implementation could still pass every linked scenario, fail the review and identify the escaping fault.
> When unsure how to review a requirement, use this counterfactual question to decide what to inspect or add.
> Requirement-ID coverage and scenario count alone never establish sufficiency.
> Design review cannot itself prove the App works or that every possible bug is absent.
> Independently inspect the confirmed requirements, and the scenario ledger with embedded acceptance.
> Apply the fundamental principle to every requirement: enumerate its important operation modes and user states, including relevant normal, exceptional, boundary, and transition behavior.
> For each important mode and state, propose a plausible incorrect implementation and determine which linked scenario would actually fail and what observable result would expose it.
> Challenge the operation-mode and state list itself; do not merely review the Analyst's selected cases.
> If a plausible important fault can escape, if a method cannot produce its claimed failure signal, or if a requirement is too ambiguous to know the intended outcome, report the exact requirement IDs, missing modes/states, and counterexamples.
> Do not treat one scenario per ID, an unchanged screen, or a vague assertion as sufficient evidence.
> Independently challenge priority underestimation and indiscriminate inflation and record a reasoned judgment for every scenario.
> Independently review each black-box scenario's priority and reason, including high-risk exception/boundary cases and unjustified P0/P1 inflation, and write one `priority_reviews` entry per black-box scenario in `coverage_review.json`.
> Report grade disagreements for Analyst to repair and independently re-review them.
> You alone write `<test-dir>/delivery-acceptance/coverage_review.json` following `<skill>/references/data-model.md`: one record per requirement with `operation_modes`, `user_states`, `fault_probes` (mode, state, plausible_fault, linked scenario_ids, observable failure_signal), a reasoned verdict, and `uncovered_paths`.
> Obtain the two scoped snapshot hashes with `python3 <skill>/scripts/playbook.py review-hashes <project> --test-dir <test-dir>` after reading the current scenarios with embedded acceptance.
> Mark the review `passed` only if every requirement is sufficient and no important path remains uncovered.
> Do not modify Analyst's ledger; only Analyst repairs it.
> Then run `python3 <skill>/scripts/playbook.py check <project> --test-dir <test-dir> --stage black-box` and report its exact requirements, black-box-scenarios, and coverage-review gate results.
> Return `passed` only when the substantive counterfactual review and all three direct checker gates pass; otherwise return `gaps` with exact `failureDetails`.
> Resource, white-box, execution, and run-evidence gates are not prerequisites to this design review.
> Do not ask Boss to approve an ordinary scenario list.
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

Results:
- `passed`: Independent review finds every requirement sufficient and no important path uncovered, all black-box scenario priorities and reasons have passed independent review with one reasoned priority_reviews entry per black-box scenario and no grade disagreement, legacy unclassified scenarios have explicit grading and fresh independent review, and the direct stage checker reports its requirements, black-box-scenarios, and coverage-review gates pass.
- `gaps`: Independent review finds a plausible important fault that a linked scenario could not expose, a method that cannot produce its claimed failure signal, a requirement too ambiguous to know the intended outcome, a priority or reason disagreement, an unclassified scenario lacking explicit grading and fresh independent review, or any failure of the requirements, black-box-scenarios, or coverage-review checker gates. Output shall include `failureDetails: <exact gaps, including applicable requirement IDs, missing modes/states, counterexamples, scenario references, priority disagreements, and checker failures>`.

### GATE-1

When independent scenario review has passed, Captain shall run:

> python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' --stage black-box > '<test-dir>'/delivery-acceptance/black-box-gate.json

Results:
- `passed`: The stage checker exited with status zero and its black-box gate report is written; `scenariosReady` may follow only on this zero exit.
- `failed`: The stage checker exited with a nonzero status; do not report `scenariosReady`, and return to Analyst for repair while review rounds remain.

### REPAIR-1

When Reviewer identifies material gaps or the black-box stage checker exits nonzero, and fewer than three review rounds have occurred, Captain shall prompt Analyst:

> Repair only the named gaps in the ignored ledger files, preserving confirmed requirement IDs and existing valid scenarios.
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
