# Delivery acceptance Skill

[SKILL.md](SKILL.md) is the conversation integration entry.
`playbooks/acceptance/` is a complete, independently installable workflow package; it owns business code, roles, tools, contracts and locked dependencies.
`scripts/setup.mjs` only calls that package's prerequisite preparation.
Development/regression tests live at repository `tests/`, outside the shipped Skill and standalone package.

See the [standalone package guide](playbooks/acceptance/README.md) for standard Playbook CLI commands.
