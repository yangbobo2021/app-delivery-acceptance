# App Delivery Acceptance — SPEX Git package

This branch packages the app-delivery-acceptance Skill for installation through SPEX. It is an installation-test prerelease, not a stable release or an npm package.

- Package: `yangbobo2021/app-delivery-acceptance`
- Version: `0.1.0-github.1`
- Skill artifact: `app-delivery-acceptance` (original language `en`)
- Git source: `https://github.com/yangbobo2021/app-delivery-acceptance.git`
- Revision: `spex/acceptance-github-install-20261021`
- Package subdirectory: repository root (leave empty)
- Skill source commit: `096c83e6b668300725aed871315837cefff3f836`

In SPEX's environment, choose **Add from Git**, provide the Git source and revision above, and request this package. SPEX resolves the revision to an exact commit in its lock and exports the Skill to the Agent directories. No registry publication is required.

The installed Skill requires macOS/Linux, Python 3, Git, Node.js >=22 with npm, and usable Codex authentication for model workflows. Its first runtime preparation installs locked dependencies into its own `playbook/node_modules`; later calls reuse a verified installation. Authentication is not included in this package. See the Skill's [instructions](skills/en/app-delivery-acceptance/SKILL.md) and [environment details](skills/en/app-delivery-acceptance/README.md#使用环境).

This package contains all tracked Skill resources and its npm lockfile. It excludes node_modules, credentials, interpreter caches, and project acceptance data. A manual SPEX re-export currently replaces generated runtime files; the next Skill call can reinstall them. This branch does not change SPEX's export policy.
