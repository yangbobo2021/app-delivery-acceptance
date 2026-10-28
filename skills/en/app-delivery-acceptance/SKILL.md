---
name: app-delivery-acceptance
description: Freeze requirements, design or find delivery scenarios and cases, execute or rerun selected tests, and inspect independent evidence, coverage and delivery reports through independent Playbook CLI workflows.
---

# App delivery acceptance

This Skill connects the host conversation to the complete [acceptance Playbook package](playbooks/acceptance/README.md). Use it for delivery acceptance and for an individually requested step, including create only, freeze only, finding cases, reassessment, one-case reruns, coverage repair/recomputation, reporting and recovery.

## Responsibilities

The host understands the user's whole conversation, identifies actual authorization and stopping point, preserves original wording and provenance, and selects or composes public workflows. Playbook does **not** inherit this conversation. Give it explicit project paths, stable acceptance identity, selected requirement/scenario/case IDs, version hashes, source references, requested operation and authorization basis. Do not invent missing scope or silently broaden work.

Each workflow owns its complete business operation: roles, internal sequencing, deterministic tools, gates, persistence, evidence and output. Never perform a workflow's missing internal steps in Skill scripts or hand-edit its generated results to obtain a pass. The package is also usable by humans/CI without installing this Skill.

Freeze relevant original background and operating constraints in the definition context, such as `context.shared_constraints`, including full source wording when required. The workflows carry that frozen execution context and verbatim `context.user_constraints` to case generation, assessment and execution review and verify it against the definitions. Do not substitute a summary or rely on a role reading this conversation; background does not add unrelated requirements to the selected test scope.

## Prepare and invoke

Prerequisites are Node.js >=22, npm, Git and the chosen Agents' real credentials/runtime. Project test languages/tools are separate project prerequisites; Python is not a Skill runtime requirement.

1. Locate the bundled `playbooks/acceptance` directory. Optionally run `node <skill>/scripts/setup.mjs`; it only invokes the package's dependency preparation and returns paths.
2. Read [public workflow inputs and stopping points](playbooks/acceptance/docs/independent-workflows.md), and the linked contract for the requested operation. [Business/evidence rules](playbooks/acceptance/docs/business-guide.md) belong to the package and apply equally to direct invocation.
3. Run `node <package>/bin/configure.mjs --agent <codex|claude-code|opencode> --model <actual-model> --output <new-absolute-overlay.json>`. Optional `--roles <file>` specifies `{role_id:{agent,model,effort?}}` for any declared role; the package discovers its complete registry/role list. Use the actual caller's selected Agent, model and service, without guessing or fallback.
4. Run the official `<package>/node_modules/.bin/playbook run --with <overlay> --no-provision --json`, passing exact `/acceptance-<workflow> JSON` through stdin. Credentials stay in the actual Agent environment/configuration, never in inputs or reports. See [runtime build and service boundaries](playbooks/acceptance/docs/native-cli-boundaries.md).
5. Inspect workflow receipt, frozen inputs, actual terminal state and evidence. Explain what completed, what remains and any limitation. Exit 0/Captain prose alone do not prove business success. Call only further workflows authorized by the user.

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

Keep independent Reviewer judgment separate from implementation self-report. Missing images, coverage, case-level receipts or unchanged source bindings must remain visible limitations. Preserve failed/uncertain attempts; never automatically restart stopped work. Completing a subworkflow does not authorize product edits, cleanup, commits, push, deployment or messages to others.
