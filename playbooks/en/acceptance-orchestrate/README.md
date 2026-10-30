# Standalone acceptance Playbooks

This directory is a complete package, bundled with the Skill for distribution convenience. It reads no Skill instructions, scripts, references or conversation at runtime. Copy this directory alone, or install its `npm pack` tarball in a fresh directory. Node.js >=22, npm, Git and configured Agent runtimes/authentication are required; project test languages/tools remain project-owned.

```sh
npm ci --no-audit --no-fund
node runtime/dependencies.mjs
node bin/configure.mjs --agent codex --model ACTUAL_MODEL --output /absolute/new-overlay.json
./node_modules/.bin/playbook run --with /absolute/new-overlay.json --no-provision --json
```

The last command reads exact `/acceptance-<name> JSON` from stdin. See [workflow inputs](docs/independent-workflows.md) and [runtime provenance](docs/native-cli-boundaries.md). Configure roles with `--roles /absolute/bindings.json`; both direct and internal roles use the same official player/role bindings. No required environment-based second role map or private CLI launcher exists.

```text
bin/          public configuration generation
workflows/    independent entry, stage, roles and tools owned by each workflow
contracts/    genuinely shared business output/evidence contracts
tools/        deterministic tools used by multiple workflows
runtime/      dependency checks, public Player-port relay, configuration identity
docs/         complete workflow input, stopping and evidence contracts
vendor/       pinned local official runtime builds and source provenance
```

`runtime/players.mjs` projects official Player events to one-shot role programs; `runtime/session.mjs` calls the official session port. It creates no SDK session, picks no alternate model and invokes no private CLI. `workflows/shared/process.mjs` preserves subprocess isolation, receipts, timeout/cancellation and forwards role requests over IPC. Official Playbook/Cligent own actual Agent invocation and session journals. Per-call permissions can only narrow the declared configuration ceiling.

`acceptance-create` stops at an empty AT. Other entries may legitimately require frozen definitions, a prepared runtime/catalog or prior receipts: missing prerequisites are explicit blocked results, not an invitation to run additional business stages. Reports judge actual receipts/evidence, not only command exit status.

Skill/host business requests now enter only `/acceptance-orchestrate`; see [task delegation](docs/orchestration-workflow.md). Independent entries remain public for human/CI use; the orchestrator owns child selection and continuation.
