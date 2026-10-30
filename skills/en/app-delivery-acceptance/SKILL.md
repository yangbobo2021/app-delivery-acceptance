---
name: app-delivery-acceptance
description: "Run or continue delivery acceptance through a goal-owning Playbook orchestrator: create or freeze requirements, design or find scenarios/cases, execute or rerun selected tests, repair preparation, and inspect independent evidence and reports."
---

# App delivery acceptance

Use this Skill for complete delivery acceptance or a requested individual operation, including create only, freeze only, selected-case reruns, coverage repair, reporting and viewing history.
The bundled [Playbook package](playbooks/acceptance/README.md) owns the complete business process.
For native SPEX installation instead of this host's CLI, use the package's [SPEX release workflow](playbooks/acceptance/docs/spex-installation.md); role binding and execution stay inside SPEX.

## One business conversation

The host communicates only with `/acceptance-orchestrate` for acceptance business.
Do not select, compose or directly invoke the child workflows, their private stages or deterministic business tools.
The orchestrator owns sequencing, child input preparation, result checking, prerequisite repair and continuation to the requested outcome.
The original independent entry points remain available to human/CI callers; they are not the host Skill's routing instructions.

The host understands the user's conversation and transfers the actual user wording, project location, necessary original context/source references, authorized effects and stopping point.
Playbook does not inherit the host conversation.
Do not silently broaden scope, replace user choices, or send credentials in the delegation.
Keep task-level scheduling and implementation-change boundaries distinct from product requirements; the orchestrator selects what each child actually needs.
A new user correction or request is another message to the same task, not an instruction to take over its children.

## Prepare and delegate

Prerequisites are Node.js >=22, npm, Git and actual configured Agent credentials/runtime.
Project test languages/tools are project-owned.

1. Locate this Skill and run `node <skill>/scripts/setup.mjs` when dependencies need preparation. For a SPEX-installed Skill (`SPEX-INSTALL.json` present), always run this first; use its returned `package_root` for all package commands below. It prepares a verified CLI cache outside SPEX's managed export folder. Ordinary installations may use their existing prepared `playbooks/acceptance` directly.
2. Read the [delegation contract](playbooks/acceptance/docs/orchestration-workflow.md).
3. Run `node <package>/bin/configure.mjs --agent <actual-agent> --model <actual-model> --output <new-overlay.json>`; use the actual caller's selected model, effort and service. Optional `--roles` configures declared role differences, including `orchestrator`.
4. Invoke the official `<package>/node_modules/.bin/playbook run --with <overlay> --no-provision --json`, passing `/acceptance-orchestrate JSON` through stdin.
5. Inspect the parent result and referenced evidence; explain the real completed scope or relay a concrete question. Do not treat CLI exit 0 or task completion as whole-product acceptance.

Supply a stable task_id and a new request_id for each user message.
`message` states the actual request and stop; `context` holds relevant original background, selections, policies and authorization, with source references.
Use actual complete project/checkout paths; source_files can identify README/SPEC files to be read with byte hashes by the orchestrator.
For oral requirements retain the original wording and actual message provenance; do not invent a SPEC.
The task may be “new delivery test” without any requirement, or a single step in an existing acceptance; do not invent missing business scope to start it.

Run long official calls in a persistent host tool session, retaining output and process identity.
On interruption, preserve the original parent/child journals and inspect/resume the official parent session; do not delete locks or blindly repeat calls.
For follow-up goals, send a new message to the orchestrator with the same task identity and the new information.
