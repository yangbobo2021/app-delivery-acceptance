# Local official runtime builds

These are local builds from the recorded upstream commits plus `playbook.patch` and `cligent.patch`; they have not been published to npm. The package pins these complete tarballs to make installation independent of the Skill or a sibling source checkout.

Rebuild order: apply the patches to the recorded source commits; install/build Cligent, then `npm pack --ignore-scripts`; install that tarball into the Playbook checkout with `npm install --no-save --ignore-scripts PATH`; build/test Playbook, then `npm pack --ignore-scripts`. Keep the local prerelease versions from `provenance.json`. The standalone package installs both local archives explicitly, satisfying Playbook's matching Cligent dependency without registry lookup for unpublished versions.

Changes are generic official runtime capabilities: public per-role task context, authentic event observation, bounded permission narrowing and explicit new-task session reset; OpenCode adds a current-message-correlated native structured result. No acceptance-specific SDK runner or CLI launcher is included.
