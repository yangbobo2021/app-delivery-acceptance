## Choose only the requested work

The host can compose these entrances in any user-authorized order. A terminal subworkflow does not authorize the next one or end the AT.

| User intent | Workflow path and stopping point |
| --- | --- |
| Create a delivery test | `acceptance-create`; make an empty stable AT and stop. No scope or requirement is invented. |
| Create for a requirement, without testing yet | `create` → `freeze`; preserve the real original text/source and stop. |
| Test a requirement | Locate/create AT → freeze → analyze if needed → design/adopt scenes → runtime/coverage/project preparation → cases → execute → delivery-judge. |
| Continue in current delivery test | `acceptance-current`; preserve the matching AT, add explicit versions and call only the requested stages. |
| Only generate or revise scenes | `acceptance-scenarios` create/edit → explicitly adopt its freeze candidate; no runtime/cases/business execution. |
| Independently review scene design | `acceptance-assess-scenarios`; keep its design opinion separate from product execution. |
| Only find existing tests | `acceptance-find-cases`; static read/association and host ID comments only, with no build or test. |
| Find and debug without changing tests | `acceptance-cases` with `case_strategy: existing_only`; no logic additions/edits or automatic repair. |
| Prepare/reuse/extend tests | `acceptance-cases` with `implement`; same Agent searches first, checkpoints originals, then reuses or fills necessary gaps and actually debugs. |
| Only independently assess the current case group | `acceptance-assess-cases`; no generation, execution or change of execution list. |
| Existing cases are ready | `acceptance-execute` directly; keep source/definition/runtime/identity checks and skip generation. |
| Rerun only a named TC | `execute` with exact permanent IDs, actual business selector argv and selection basis; preserve unselected cases and whole-scene `not_revalidated`. |
| Prepare/fix collection only | `acceptance-coverage-prepare`; preserve failed attempts, use verified runtime and fresh zero/nonzero/failure probes, then stop before business tests. |
| Fix collection and rerun a TC | Coverage preparation/repair → bind new project catalog → execute the exact existing TC, without regenerating its assertions. |
| Code changed | `acceptance-rebind` → verify new runtime/coverage/project binding → reuse exact unchanged cases and execute a new attempt; preserve old evidence. |
| Definition changed | Freeze versions → `acceptance-change-plan`; follow actual history, complete-change or design-only as the user requested. |
| Interrupted work | `acceptance-recover` inspect/reconcile; prove processes, receipts, original bindings and effects before adopting completed work or explicitly superseding an uncertain attempt. |
| Actual manual/source-free black-box work | Perform the real authorized operator/tool actions, then `acceptance-manual-execute` freezes their receipts/observations/images and independently reviews them. Missing actual actions remain awaiting evidence. |
| Read/export/end | `acceptance-view` is read-only; `acceptance-report` exports a frozen report; `acceptance-archive`, `finish` and `cleanup` are separate explicit actions. |
| Accept a known risk | `acceptance-risk`; retain the original technical finding and actual user quote, confirmation and remaining impact. |
| Authorized requirement/scenario backfill | `acceptance-backfill`; follow actual conventions, or invoke real locked SPEX scaffold only when no applicable convention was found. |

Keep [entry contracts and examples](independent-workflows.md) available rather than reconstructing fields from names. The source layout has one current implementation per responsibility; see [source organization](source-layout.md). Existing records remain readable without replaying retired engines or rewriting evidence.

## Stable scope and frozen definitions

Use the user's project workspace as the sole store root: shared definitions/results under `.acceptance/<AT-ID>`, ignored local assets under `.acceptance-local/<AT-ID>`, and formal tests in the existing project test tree. An isolated source worktree is a source location, never a second store. Reuse one isolated mutable workspace per AT and preserve candidate test changes until explicit integration. Never claim these changes reached the development checkout, PR or main branch merely because acceptance passed.

Read `acceptance-current` before startup/continuation. Missing pointers require an explicit new creation or `acceptance-start` of a selected existing AT; do not infer from newest files or browser selection. Refuse replacing another active AT. Preserve the pointer across one completed scene, parked work and closed chats. Only `acceptance-finish` saves the whole AT's conclusions/unfinished limits and clears the matching pointer.

Read applicable layered `.acceptance/knowledge/INDEX.md` assets with hash-bound receipts at boundaries. Use `acceptance-knowledge` to publish explicitly reviewed portable methods from verified runtime evidence, with conflict-checked Markdown assets and all affected indexes; keep old versions and exclude private machine state. Broken links, unindexed assets, uncertain publication, stale knowledge, changed source/test bytes or a conflicting workspace claim block affected stages. On another machine, reuse indexed recipes but independently prepare and smoke-test the actual environment; old machine state is not proof of readiness.

The host reads actual SPECs, conversation statements, documents or external sources. Freeze complete original wording, stable IDs and real provenance in versioned `acceptance-catalog-v2` requirements/rules/scenes/context. Preserve original sources when adding references. A directly adopted standalone scene needs no invented parent. Do not build mandatory SPEC parsers, online synchronizers or source-type routers. A failed source read and confirmed deletion are distinct `acceptance-source-status` records; neither silently removes an admitted obligation.

Only original agreements, independently supported reverse rules and explicit user decisions authorize business oracles. For PR/source reversal, freeze merge base/head, all changed paths, declared components, non-test sources and independent contract revisions. One official Analyst performs the reverse analysis and internal self-check, without an automatic separate Reviewer. The deterministic gate verifies complete path dispositions, versions, citations and source independence. Same-change implementation/specification cannot prove one another. Keep unsupported observations as `needs_confirmation` with concrete questions, outside executable obligations.

Analyze the complete original requirement set into a goal, confirmed scope and context groups without losing identities/text. Groups do not own scenes or assign priorities. Generate scenes one confirmed target at a time with the full original context; adopt already-valid scenes directly. The normal Designer performs internal self-check, not independent scenario approval. Every must-have obligation needs scenes or an explicit design gap. Use edit deltas against the current adopted set to retain unchanged human work, IDs and origins. Invoke `assess-scenarios` separately if independent design review was requested.

Adding an independent target or changing organization alone does not require unrelated revalidation. Real common-constraint or dependent business changes do. `change-plan` compares from the snapshot before the whole change: complete-change includes every affected scene, including new/unexecuted ones; follow-history selects affected previously executed scenes; design-only starts no preparation or tests. Preserve old judgments and disclose their current applicability separately.

## Actual execution and judgments

Prepare the real runtime, then required mature coverage toolchain, then the immutable project catalog and operation guide. The guide is operational knowledge, never a business oracle. Environment setup belongs to runtime preparation, not repeated case Agents. Freeze actual source/component versions, dependency bindings and project-owned adapters. Scope narrows only from the user's priority/time/target choice; ordinary requested acceptance covers P0–P3. Follow [the common importance standard](../contracts/scenario-priority.md); do not force a ratio or a P0 for every target.

Use [case preparation](cases-workflow.md) and [formal execution](execute-workflow.md) separately. Reuse sufficient existing tests; extend only concrete gaps or add a necessary new case. Preserve checkpointed existing assertions. `existing_only` may receive only the host's verified ID-comment patches, with no logic/config/file-set changes. All strategies use [permanent TC identities](../contracts/case-display-contract.md#永久用例-id关联后由宿主统一落地) on real declarations and preserve them through associations, evaluations, repairs and reruns. If declaration/comment placement is unsafe, report the limitation rather than guessing.

Each debug/formal attempt receives isolated state/output paths and actual command receipts. Do not reuse prior state, fabricate observations, run nested collector wrappers or edit product code to manufacture a pass. Formal execution freezes selected files, versions, logs, native coverage and explicit evidence before independent review. A successful command, generated test or implementer's self-assessment is not product acceptance. An advisory case-design evaluation neither changes execution selection nor supplies product judgment.

For UI obligations, record real desktop viewport/window and before/after key states. Attach the exact frozen screenshot pixels to an independent Reviewer. DOM text, paths, geometry and file existence do not prove pixel review. Missing/unviewable images leave UI unverified. A clear frozen visual defect can justify a product finding even with command exit 0. Preserve and archive the images actually cited in the judgment.

Only concrete test/evidence findings enter the finite repair budget. Keep failures, apply a test-only delta, freeze a new execution and independently review it. Contract/scenario questions stop for a new agreed version. Product fixes require separate authorization outside the acceptance run and a new product binding. Existing-only work never automatically becomes test modification. Unchanged parked failures are not infinitely retried.

Use the [coverage-tool contract](../contracts/coverage-tool-contract.md): mature project tools own instrumentation, executable units, zero-hit denominators, merge/statistics and source maps. Node binds provenance and invokes those tools; do not implement custom hit/denominator recognition. Required collection cannot silently become off; explicit off needs the actual user basis. Coverage preparation probes are not business coverage. `coverage-recompute` uses existing compatible native reports and the project summarizer without rerunning cases or creating a fresh-code coverage claim.

## Recovery, reporting and closure

On interruption, inspect original configuration, Agent/model/service/session, process PIDs and detached process groups, frozen source/test effects and actual receipts. Adopt only verified completed work. A failed official role's root session ID alone does not prove provider continuation; the current pinned CLI can start fresh after losing/rejecting its hint, so this recovery route blocks automatic failed-role replay. Reconcile effects and explicitly supersede a preserved uncertain attempt before a new request. Missing execution receipts remain unknown; do not interpret them as failed or repeatable. Rebind under the same AT when definitions or product versions change; never edit old requests to match new inputs.

Use `acceptance-delivery-judge` for a whole selected requirement/PR conclusion. It must inspect all required obligations, necessary design gaps and same-version independent scene results. Partial TC passes cannot certify a whole scene, and completed scheduling cannot certify a requirement or PR. Always disclose exclusions, unexecuted work, pending questions and evidence/coverage limits. Keep accepted risk separate from pass and unresolved product BUG.

The Node [view/report/lifecycle workflows](lifecycle-workflows.md) show five columns: frozen requirement/rule → scenario → actual cases/operations → execution → independent conclusion. Preserve orphan requirements, standalone scenes, unexecuted work and actual source/definition versions. Default rows are concise; full wording, methods/assertions/boundaries, source locations, commands, evidence and hashes belong in one navigable detail dialog. Distinguish design assessment, actual execution, last confirmed judgment and current applicability. Read-only views never dispatch tests or change pointers; ID switches clear old data, filters retain the full denominator, and read failures preserve the last good snapshot.

Count stable scenes once from the complete selected AT catalog, including unexecuted items. Preserve an actual historical execution regardless of success/version. Evidence copies and archived copies are not extra runs; group receipts do not prove individual TCs passed. Keep the latest confirmed judgment while separately marking revalidation. Reconcile executed = passed + product BUG + accepted risk + repair/blocked/inconclusive + pending; total = executed + unexecuted. Missing complete catalogs disable overall ratios.

Archive only explicit/protocol-required reviewed files, with original-path mappings and hashes; never recursively publish environments, all sessions, credentials or business databases. `finish` saves scope, relationships, versions, conclusions and unfinished limits before clearing only this AT. `cleanup` requires explicit selected inactive local assets, verified evidence and recoverable candidate-test backups; keep shared records/other ATs/Git objects and disclose lost attachments or recomputation ability. Closing a conversation or completing a subworkflow does not authorize cleanup, integration, commit, push or product deployment.
