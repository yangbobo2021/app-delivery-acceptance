---
name: app-delivery-acceptance
description: Freeze requirements, design or find delivery scenarios and cases, execute or rerun selected tests, and inspect independent evidence, coverage and delivery reports through independent Playbook CLI workflows.
---

# App delivery acceptance

This Skill connects the host conversation to the complete [acceptance Playbook package](playbooks/acceptance/README.md). Use it for delivery acceptance and for an individually requested step, including create only, freeze only, finding cases, reassessment, one-case reruns, coverage repair/recomputation, reporting and recovery.

## Responsibilities

The host understands the user's whole conversation, identifies actual authorization and stopping point, preserves original wording and provenance, and selects or composes public workflows. Playbook does **not** inherit this conversation. Give it explicit project paths, stable acceptance identity, selected requirement/scenario/case IDs, version hashes, source references, requested operation and authorization basis. Do not invent missing scope or silently broaden work.

Each workflow owns its complete business operation: discovery, roles, internal sequencing, preparation and repair, tools, persistence, evidence and output. Give it its goal and relevant project facts; let it solve intermediate problems. Never perform its missing internal steps in Skill scripts or hand-edit generated results to obtain a pass. The package is also usable by humans/CI without installing this Skill.

The host remains responsible for the user's requested outcome across calls. A subworkflow's `blocked` result is a diagnosis, not automatically the stopping point for the whole task; `completed` with a `repair_required` review is also unfinished business. Inspect the actual outcome, reason and evidence, route a recoverable prerequisite or test gap to the owning public workflow, then continue the original selected work with the verified handoff. For example, when case debugging exposes a coverage process path omitted by an earlier ready preparation, pass the actual command/process facts and failed evidence to a new coverage preparation request; bind its verified profile through project preparation and continue the same scene and existing permanent cases. Preserve old attempts instead of regenerating the acceptance or rewriting a failed receipt. See [cross-workflow continuation](playbooks/acceptance/docs/intent-inputs.md#跨工作流接续).

Separate host orchestration from domain input. “Run the complete acceptance”, “execute one scene”, “record elapsed time”, and “do not change the workflow implementation if this diagnostic fails” guide the host's choice of calls and observations. Do not copy these into every workflow's prompt or frozen business constraints. Pass the actual selected scene/case IDs to the workflow that needs them. Coverage preparation needs the project and relevant execution entry/process facts, not the overall scene quota or a ban on repairing its environment. See [task-specific input boundaries](playbooks/acceptance/docs/intent-inputs.md).

Freeze relevant original product background and business operating constraints in the definition context, such as `context.shared_constraints`, including full source wording when required. Only put applicable domain requirements in `context.user_constraints`; keep host scheduling and implementation-change instructions in the host record. Workflows carry the frozen domain context to case generation, assessment and review. Do not rely on a role reading this conversation; background does not add unrelated requirements to the selected scope.

Before freezing file-based requirements, list the source documents and operating background required by the conversation (for example a README defining the real command). Supply that inventory and the complete byte-matching document text/hash in `source_inputs`; use actual inclusive lines in `origin.file` or `path:line[-line]` references. The freeze workflow verifies the files and embeds their complete snapshots in the downstream execution context. Do not guess line numbers, replace source text with a summary, or put unverified snapshots directly in `context.source_documents`. A workflow cannot discover context omitted from both the host's inventory and explicit input. For oral requirements, retain the actual message wording and locator; no project document is mandatory. See the [input quality contract](playbooks/acceptance/docs/frozen-definitions.md#输入质量检查).

Keep operative shared constraints explicit in `context.shared_constraints` or the relevant bound definitions; this field supports original text or structured JSON. Source snapshots preserve and deliver the full reference material, while an unrelated source inventory addition alone does not invalidate existing business evidence.

## Prepare and invoke

Prerequisites are Node.js >=22, npm, Git and the chosen Agents' real credentials/runtime. Project test languages/tools are separate project prerequisites; Python is not a Skill runtime requirement.

1. Locate the bundled `playbooks/acceptance` directory. Optionally run `node <skill>/scripts/setup.mjs`; it only invokes the package's dependency preparation and returns paths.
2. Read [public workflow inputs and stopping points](playbooks/acceptance/docs/independent-workflows.md), and the linked contract for the requested operation. [Business/evidence rules](playbooks/acceptance/docs/business-guide.md) belong to the package and apply equally to direct invocation.
3. Run `node <package>/bin/configure.mjs --agent <codex|claude-code|opencode> --model <actual-model> --output <new-absolute-overlay.json>`. Optional `--roles <file>` specifies `{role_id:{agent,model,effort?}}` for any declared role; the package discovers its complete registry/role list. Use the actual caller's selected Agent, model and service, without guessing or fallback.
4. Run the official `<package>/node_modules/.bin/playbook run --with <overlay> --no-provision --json`, passing exact `/acceptance-<workflow> JSON` through stdin. Credentials stay in the actual Agent environment/configuration, never in inputs or reports. See [runtime build and service boundaries](playbooks/acceptance/docs/native-cli-boundaries.md).
5. Inspect workflow receipt, frozen inputs, actual terminal state and evidence. Exit 0/Captain prose alone do not prove business success. Continue the calls needed for the authorized outcome, including recoverable preparation gaps; stop at the user's requested boundary or an actual unresolved prerequisite, cancellation, resource limit or unreconciled effect. Explain completed work and remaining limitations.

For runtime preparation, `source_checkout` is the complete Git checkout root (`git rev-parse --show-toplevel`), even when `project_root` is a nested application. Prefix `inspection_files` and `test_roots` relative to that checkout root. Runtime knowledge references use the supplied logical `knowledge_keys`, such as `INDEX.md`, rather than a `.acceptance/knowledge/...` filesystem path.

Run long official CLI calls in the host tool's persistent session or supervised background mode, retaining stdout, stderr, process identity and exit status. A host tool's shorter timeout must not cut off the declared workflow budget. On interruption, inspect/recover the original operation before retrying. Coverage preparation has a finite default budget and an explicitly bounded per-request budget; use the [coverage contract](playbooks/acceptance/docs/coverage-workflow.md) when measured progress justifies a different budget.

## Select the requested scope

| User request | Entry/composition |
| --- | --- |
| New delivery test only | `create`; empty container then stop |
| New delivery test for requirement, without testing | `create` → `freeze`; then stop |
| Test requirement | locate/create → freeze → requested design/preparation → cases → execute → judgment |
| Add requirement to current acceptance | `current` → freeze; continue only requested work |
| Design one requirement before others | `scenarios` for exact target; retain unrelated definitions |
| Find existing cases only / assess cases only | `find-cases` / `assess-cases` |
| Run ready cases / rerun one TC | `execute` with exact selection and basis; skip generation |
| Fix coverage and rerun | `coverage-prepare` → bind verified preparation → `execute` exact TC |
| Product code changed | `rebind` → verify runtime/project bindings → execute fresh attempt |
| Recover interrupted work | `recover`; inspect original effects/receipts before any retry |
| Report/archive/finish/cleanup | the independently named lifecycle entry; obey explicit stopping point |

No mandatory main router is required. The same source type may feed the same workflow: source can be SPEC or conversation; preserve its real original content and location.

For coverage preparation, normally send `/acceptance-coverage-prepare {"project_root":"/absolute/project"}`. An unambiguous current project allows the empty command. Add `execution_entry` only for actual entry/process facts the workflow cannot discover from project files. The workflow owns discovery, necessary runtime preparation, inventory, verification and internal repair; the host does not prebuild those files. Existing explicit bindings remain available for precise composition. A recoverable intermediate error does not by itself end preparation or mean coverage is unsupported.

Keep independent Reviewer judgment separate from implementation self-report. Missing evidence and unverified scope remain visible limitations. Preserve failed/uncertain attempts; do not confuse internal preparation and repair with restarting a terminated workflow or changing its implementation. Completing a subworkflow does not authorize product edits, cleanup, commits, push, deployment or messages to others.
