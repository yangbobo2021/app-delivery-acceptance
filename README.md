# App Delivery Acceptance

A SPEX Git package for freezing delivery requirements and scenarios, running real cases, independent review, coverage, and change revalidation.

- Package: `yangbobo2021/app-delivery-acceptance`
- Version: `0.1.0-github.3` (prerelease)
- Git source: `https://github.com/yangbobo2021/app-delivery-acceptance.git`
- Revision: `main`; SPEX locks the resolved commit. For a fixed installation, use an exact commit.
- Package subdirectory: repository root (leave empty)
- Skill: `skills/en/app-delivery-acceptance`

In SPEX, choose **Add from Git** and provide the source and revision above. SPEX resolves and exports the Skill for the selected Agent. No npm publication is required.

For direct Codex installation with the Skills CLI:

```sh
npx skills@1.7.4 add yangbobo2021/app-delivery-acceptance --skill app-delivery-acceptance -g -a codex
```

Requires macOS/Linux, Python 3, Git, Node.js >=22 with npm, and usable authentication/model access for the calling Agent (Codex or Claude Code). First use installs locked dependencies into the Skill's own `playbook/node_modules`; later calls reuse a verified installation. Credentials are supplied by the caller and are not distributed. See the [Skill instructions](skills/en/app-delivery-acceptance/SKILL.md) and [environment details](skills/en/app-delivery-acceptance/README.md#使用环境).

The package includes the frozen-definition lifecycle and incremental scene revisions, separate project runtime/coverage preparation, zero/nonzero coverage probes, UI screenshot review and evidence retention. All development histories are merged into main. Project acceptance records stay with their original projects and are not shipped with the Skill.

Only one canonical Skill source is maintained under `skills/en/app-delivery-acceptance`. Dependencies, credentials, caches and project acceptance data are excluded. A SPEX re-export can replace generated dependencies; the next invocation prepares them again.
