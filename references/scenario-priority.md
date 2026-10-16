# Scenario importance and execution scope

Read [acceptance-organization.md](acceptance-organization.md) first. Analyst and independent Reviewer use this same standard for black-box, white-box, repairs and resumed work. Read the complete original requirements, confirmed scope decisions and published plan's overall objective and core/supporting journeys before grading any unit. Scope exclusions still apply; a critical-risk topic does not authorize an excluded test.

## Risk grades

Assign importance to scenarios, not blindly to requirements or organization roles. First identify the in-scope core business outcomes and the scenes that jointly demonstrate their complete delivery paths. Then assess concrete failure consequences, realistic likelihood, exposure, existing safeguards and acceptable alternatives across all units. These grades describe acceptance importance and business risk, not defect severity, execution cost or a preferred running order.

| Priority | Failure consequence | Execution |
| --- | --- | --- |
| P0 | An essential step or outcome of the current core business closure fails, or a concrete major risk such as serious data loss/corruption, money loss, access-control failure or exposure occurs | First; missing proof of core closure or a major-risk invariant leaves a critical delivery risk unresolved |
| P1 | Other important branches, common operations or recovery behavior substantially harm users while the core closure and major-risk invariants remain demonstrably available | Immediately after P0; normal acceptance focus |
| P2 | Secondary or less frequent functionality has lower impact and, when needed, a verified acceptable alternative | After P0/P1 |
| P3 | Minor experience issues or low-impact edge combinations | Last or in a targeted test |

### Core closure and major risks

The P0 set must collectively cover the admitted core business closures and identified major risks. Choose complementary scenes from the global plan: a scene can cover several linked requirements or units, and one closure may need several scenes. Trace each P0 scene to the core journey, the required outcome or invariant, and explain how its failure blocks that outcome or produces the major consequence. Do not require a P0 scene for every requirement/unit, or upgrade every normal path. An auxiliary operation is critical only when its failure actually blocks a core outcome without an acceptable alternative. Conversely, a rare exceptional or boundary failure may be P0 when it breaks an essential result or major-risk invariant.

Core closure failure is an independent P0 basis: it does not additionally require financial loss, irreversibility, system-wide outage or impact on every user. `risk.critical_consequence=core_blocked` and `materiality_basis` explain why this outcome is essential to the confirmed delivery goal. For other critical consequences, the materiality basis explains the concrete serious impact and real safeguards; money/security words alone do not establish it. Do not invent incident rates or affected-user scale.

### Repair is different from an acceptable alternative

Evaluate the intended operation with its valid baseline inputs, configuration and resources. A failed core path cannot be downgraded to P1 just because engineers could fix code, deploy a patch, roll back, repair database state, manually reconcile records, or adjust an already valid configuration to make the broken path work. Those are post-failure remediation, not evidence that the delivered business closure works. Similarly, preserving records, retryability or stopping the affected user does not by itself remove core blocking or a major consequence. A failed safeguard or recovery path can itself be P0.

An alternative can reduce importance only when it already works in the delivered implementation, is available to the affected user/operator in the agreed scope, produces the required business outcome without breaking amount/data/one-time invariants, and has acceptable effort and delay. State the actual path and supporting basis in `risk.recoverability`/`grade_basis`; an unverified 'can recover' sentence is insufficient. Correcting genuinely invalid user input or performing the documented normal configuration/retry operation is not automatically engineering remediation: judge the exact failure and its global consequence. Existing safeguards may reduce a major-risk consequence, but cannot substitute for proving a required successful outcome.

No fixed percentages, target counts, per-requirement quotas or forced P0/P1/P2/P3 distribution apply. Distribution is only a diagnostic cue for review. A genuinely minor scoped change can have no P0; a small critical set can be all P0. When the published scope includes core closures or major risks, having no P0 requires scrutiny of whether they were omitted or underestimated, not an automatic exemption or a quota-based upgrade. Representative-first ordering does not change grades. Retain the complete original requirements and admitted scenario coverage.

## Independent review

Analyst authors `priority`, `priority_reason` and structured risk; Reviewer independently rederives consequences from the same complete requirements, objective and scope. Check that the P0 set jointly covers the core closures and identified major risks, and compare equivalent consequences across units. Challenge unsupported downgrades based on post-failure repair/configuration changes, unverified alternatives, omitted critical exceptions, unsupported inflation and contradictory or copied grading reasons. Review each scenario's specific failure; a shared template does not establish its grade.

Record the cross-unit conclusions, core-closure/major-risk coverage and any verified alternatives in the existing `acceptance_scope_review.global_priority_calibration`, with concrete per-scene `priority_reason` and `causal_chain_review`. No new schema or grading quota is needed. Explain disagreements as concrete gaps; Analyst repairs affected scenes and Reviewer reassesses. Analyst cannot self-approve the review. P0 passing supports only the actually proven core outcomes and risk conditions; it does not certify the other scenarios or full delivery acceptance.

Black-box judgments are `coverage_review.json.priority_reviews`:

```json
[{"scenario_id":"SC-B","priority":"P0","verdict":"appropriate","reason":"跨用户读取会泄露他人的数据，必须优先排除该风险。"}]
```

`verdict` is `appropriate` or `gap`; a passing gate requires one unique, matching, reasoned appropriate judgment for every black-box scenario. Existing requirement/scenario scoped hashes bind the full scenario objects, including priority and reason. Get them from `playbook.py review-hashes`.

Full acceptance additionally requires `coverage_review.json.white_box_priority_review`: `status`, concrete `basis`, `requirements_sha256`, `scenarios_sha256`, and `items` using the same judgments for every white-box scenario. Get these two hashes from `playbook.py white-box-priority-hashes`. If there are no white-box scenarios, record `items: []` with the empty-scope hashes and an explicit basis. Black-box-only design ignores that section and unfinished white-box drafts. Changing a grade/reason invalidates its review and any pinned run; fresh independent review is required, not merely rewriting hashes.

Historical scenarios without grading display **未分级**. Never infer or fill a grade during viewing. New design and acceptance gates require explicit grading and current review. Historical results are not rewritten or re-certified automatically.

## Fixed execution scope

Full acceptance defaults to P0 through P3, no time limit. Only explicit user instructions select a smaller scope or time limit. The launcher accepts `--max-priority P0|P1|P2|P3` and `--time-limit-minutes N` (finite positive number). Design always covers all requirements; these flags apply only to acceptance. Coverage enhancement remains a separate option and does not change scope.

The launcher writes `execution-policy.json` in the selected ledger:

```json
{"max_priority":"P1","time_limit_minutes":30}
```

The session binding saves this exact policy. Resume inherits omitted options and rejects conflicting ones, a missing saved policy or a changed policy. A new session can intentionally select another policy. Historical bindings without a policy mean full scope and no time limit. Actors cannot change the policy.

`new-run` freezes `runs/<id>/execution-plan.json`: `policy`, `created_at`, optional `deadline_at`, and `ordered_scenario_ids`. The queue includes P0 through max_priority, sorted P0 → P3, preserving original ledger order within each grade. `run.json.execution_plan_sha256` binds its exact bytes, and the existing ledger hashes/design snapshots bind all scenario definitions. Preserve these fields when recording results. Scope and time are fixed per run; never reset the deadline during resume.

Call `playbook.py next-scenario <project> --test-dir <dir> --run <id>` before each scenario. It returns one scenario ID or null with `selected_scope_complete` / `time_limit`. Results must be appended in queue order. Copy the returned UTC `started_at` into each attempted result; timed runs require monotonic starts between created_at and deadline_at, so a late start cannot pass the execution gate. Check deadlines between scenarios; complete a started action safely but start no next scenario after expiry. The execution window starts at new-run, after design/resource preparation. It does not limit the whole Playbook's wall time. Resuming the same run consumes the same window.

When the selected queue is complete or the deadline expires, call `playbook.py finish-run ... --run <id>`. It records every missing scenario as `status: not_run` with `not_run_reason` (`outside_priority_scope`, `time_limit` or `stopped`) and a concrete `reason`, empty method/evidence lists. Use `--stopped` only for an actual early stop; never claim time exhaustion before the deadline. Failure, blocked resources and attempted-but-unproven behavior remain distinct statuses with their observations/evidence. Do not fabricate observations or evidence for not_run records.

## Conclusions

Reviewer opens evidence for attempted scenarios; not_run scenarios receive an unproven review explaining the missing execution, without fabricated evidence. Limited runs terminate as **部分验证，完整验收未完成**, without retries or coverage loops aimed at silently expanding the selected scope. An actual product failure is still reported as a failure. A subset may be described as verified only when it has scenarios and every included scenario is actually passed and independently evidenced.

Reports/viewer show grade totals, execution claims, evidence reviews, failures, blockers, unproven paths, untested paths and each remaining scenario's failure consequence. Zero scenarios in a grade is **无该等级场景**, not verified. Missing records mean not executed, never passed. Counts alone do not establish acceptance. Only a full-scope run satisfying every scenario and all original gates can receive full acceptance. A time-limited full-scope run may still pass if all scenarios were completed and independently proven within the permitted starts. Evidence from multiple runs is never combined.

Importance labels share one hover/focus tooltip in scenario lists/details, requirement coverage rows, overview and remaining-risk tables, execution history and frozen-scene dialogs. Show the unique corresponding independent priority judgment's reason when present; otherwise show the scenario's authored priority_reason. Duplicate or mismatched judgments must be identified without inventing approval. Historical labels use frozen scenario reasons unless the run is bound to the current ledger; never borrow new design review reasons for an old run. Aggregate grade filters show the grade standard rather than a made-up scenario explanation. Do not add a standalone importance-basis panel or a raw priority-review expansion in scenario details. Keep the underlying authored fields, independent review and gate/hash checks intact.
