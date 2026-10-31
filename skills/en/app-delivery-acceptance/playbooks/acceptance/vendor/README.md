# Local official runtime builds

These are local builds from the recorded upstream commits plus `playbook.patch` and `cligent.patch`; they have not been published to npm. The package pins these complete tarballs to make installation independent of the Skill or a sibling source checkout.

Rebuild order: apply the patches to the recorded source commits; install/build Cligent, then `npm pack --ignore-scripts`; install that tarball into the Playbook checkout with `npm install --no-save --ignore-scripts PATH`; build/test Playbook, then `npm pack --ignore-scripts`. Keep the local prerelease versions from `provenance.json`. The standalone package installs both local archives explicitly, satisfying Playbook's matching Cligent dependency without registry lookup for unpublished versions.

Changes are generic official runtime capabilities: public per-role task context, authentic event observation, bounded permission narrowing and explicit new-task session reset; OpenCode adds a current-message-correlated native structured result. No acceptance-specific SDK runner or CLI launcher is included.

The 20261031.2 snapshots add only native Windows bounded Codex configuration: prefer a compatible MXC sandbox through the SDK and supply the documented command-shell guidance. Existing permission, approval and source-evidence checks remain. Cligent's version advances to 0.36.2-acceptance.20261031.2; Playbook's metadata advances to 18.1.1-acceptance.20261031.2 and pins that exact Cligent version. All other archive members are byte-identical to the recorded base. Adjacent compiled replacement patches, base/output archive hashes and per-file before/after hashes reproduce this unpublished change.
