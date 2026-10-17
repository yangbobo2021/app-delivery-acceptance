# Continuous source coverage provider

The provider supports the registered JS/TS compilation and runtime adapters only.
Install the pinned dependencies with `npm ci` in this directory. Do not substitute
package versions without repeating the synthetic runtime probe and preparation.

1. Freeze the complete project source inventory and hashes. Classify nonexecutable
   assets and unsupported languages explicitly; never drop unsupported paths.
2. Run `node probe.mjs <project-root> <new-probe-dir> <electron-executable>` for
   this adapter profile. It verifies nested decisions, nullish expressions,
   worker isolation, navigation and sustained large snapshot transport across
   Node, Chromium and Electron main/preload/renderer, explicit browser server
   connections and standalone Node browser scripts. This is synthetic only.
3. Supply `runtime_probe_path`, `required_runtimes`, `registry_path`,
   `inventory_path`, `preload_paths`, complete `source_paths/source_hashes` and
   explicit `dispositions` to `node provider.mjs prepare <spec> <new-prepared>`.
   A project with other runtimes needs its own registered validator/provider.
4. Set `coverage={policy:"required",provider:"istanbul-source-v1",prepared:...,
   inventory_path:...}` in the v4 project preparation spec; run
   `playbook/v4/prepare_project.py`. This verifies and activates the profile.
5. All bound scenes and differential repairs inherit that catalog. They use
   `run_evidence_v2.py --coverage-config <config>`; coverage-only executions use
   the same `run_coverage.py <request>` implementation. Do not run a second
   command merely to collect coverage. The request binds scene ID, command,
   checkout, fresh output, declared files and project profile.
6. The executor freezes original/instrumented bytes, source-tool units, actual
   command/exit code, per-process/thread/document raw snapshots and receipt.
   It restores source and test imports, verifies the dedicated report, and
   registers it in the persistent project index. Same-scene attempts retain
   all evidence but the live collection selects the latest compatible attempt.
7. `coverage-view.json` is an atomic snapshot produced by the registry. Later
   scenes append through the same entry without editing a batch list or manually
   rebuilding coverage. A failed publication can retry `coverage_registry.py
   register <frozen-report>` without executing the case again. Different prepared
   profiles form separate collections; old V8 reconstructions are historical.

The instrumenter creates every executable unit and runtime counter.
`istanbul-lib-coverage` performs every merge and summary. The adapter can select
units using tool-provided source anchors for changed-file/changed-line views,
then asks the library to summarize. Changed-line branches select all exits of
parent decisions anchored on changed lines. This definition must be displayed
with evidence; it is not semantic impact analysis.

The view shows line and branch coverage plus tool versions and concrete gaps.
A failed assertion, accepted risk, or insufficient business evidence does not
invalidate genuine counters and does not authorize a new acceptance conclusion.
Transport/teardown failures remain explicit collection limitations. Missing
runtime evidence is never represented as a successful zero-hit collection.
