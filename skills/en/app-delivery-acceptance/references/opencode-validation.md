# OpenCode validation — 2026-10-26

The existing `app-delivery-acceptance` Skill was tested with native OpenCode CLI/SDK 1.19.4 and `bigmodel/glm-5.3-flash` on macOS / Apple Silicon. Model roles and independent execution reviewers used actual OpenCode sessions. The host orchestrated the public Skill entrypoints and retained failed attempts; this was not a single unattended run.

## Verified scope

- Native `skill` loading, model preflight, tool execution, same-session continuation, separate reviewer sessions, permission denial and cancellation.
- Native structured JSON delivery bound to the submitted session and parent message. Missing submission fails the stage; explanatory prose is retained in the trace.
- One same-session correction for a missing fixed protocol marker, with non-submission tools disabled and a complete JSON-value comparison rejecting unrelated changes.
- Runtime preparation, coverage preparation, case submission, source/annotation preflight, frozen execution, same-run coverage, independent review and result publication for the two scenes below.

The official benchmark was [app-delivery-acceptance-benchmark-six](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six), tag `baseline/2026-10-20-v1`, commit `be952659c7d93018e26793daf2e58fa8321601f4`. Only Python CLI requirement INV-02 and its two frozen scenes were executed.

| Scene | Frozen test exit | Independent decision | Observed defect |
| --- | ---: | --- | --- |
| INV-02-S01 — multiple accounts | 1 | `product_bug`, valid decision gate | Expected 3000000000; observed -1294967296 |
| INV-02-S02 — total beyond signed 32-bit range | 1 | `product_bug`, valid decision gate | Expected 5000000000; observed 705032704 |

Both failures identify the same product defect: signed 32-bit wrapping violates INV-02's exact integer requirement. Product sources remained at the fixed baseline. These are successful workflow executions that found a defect, not passing product acceptance results.

Coverage.py 7.17.0 collected and merged the same-run native evidence: project line coverage 34/44 (77.27%) and branch coverage 7/14 (50%). Changed-file and changed-line scopes were `unavailable` because no diff basis was supplied. Separate non-business checks verified actual adapter exit codes 0 and 7 and stdout/stderr forwarding.

## Regression checks

Run from the Skill directory after preparing its locked dependencies:

```sh
node --test tests/test_opencode_runtime.mjs tests/test_agent_runtime.mjs playbook/v4/test_case_agent_access.mjs
python3 -m unittest tests/test_runtime_preparation.py playbook/v4/test_coverage_preparation.py playbook/v4/test_coverage_protocol.py playbook/v4/test_runtime_catalog.py
python3 -m unittest tests/test_definition_lifecycle.py
cd playbook/v4
python3 -m unittest test_case_reuse.py test_case_identity.py
```

These groups passed 23, 37, 20 and 30 checks respectively: 110 checks in total. SPEX lint and Skill format validation also passed in the local source workspace.

Opt-in native probes use the caller's existing CLI, provider configuration and authentication environment. Supply a fresh output directory:

```sh
ACCEPTANCE_AGENT=opencode ACCEPTANCE_MODEL=bigmodel/glm-5.3-flash \
  node tests/opencode_structured_probe.mjs /absolute/fresh-output
ACCEPTANCE_AGENT=opencode ACCEPTANCE_MODEL=bigmodel/glm-5.3-flash \
  node tests/opencode_policy_probe.mjs /absolute/another-fresh-output
```

The broader `tests/opencode_live_probe.mjs` accepts an output directory and a frozen blue image path. It asserts the actual image answer as well as tool execution, continuation and independent reading; an incorrect image answer remains a failed probe.

## Limits retained in the results

- The other five benchmark projects, UI acceptance and other operating systems were not established by this run. OpenCode 2 was not tested.
- Frozen image bytes were verified at the outgoing request boundary, but one color-identification answer was wrong. Transport verification does not guarantee visual judgment accuracy.
- INV-02-S02's optional descriptive case evaluator returned assessment text beyond its 160-character contract and was marked `unavailable`. This advisory output is not an execution verdict gate; its independent execution review completed successfully.
- Reviewer prose contained two localized inaccuracies: the first reviewer misread a parent-process no-data warning despite measured subprocess coverage; the second described a later row-count assertion as passed although the earlier totals assertion stopped execution. The frozen logs, tool report and failing totals assertions support the product-defect decisions. Later reviewer instructions require checking the bound coverage report before interpreting process warnings.

Candidate tests remained in the isolated benchmark workspace. The benchmark baseline and raw failed records were preserved. Credentials, machine-specific runtime directories and raw session dumps are not part of this source change.
