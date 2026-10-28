#!/usr/bin/env node
// Skill convenience only: the package owns installation and every business operation.
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {installedPackage} from '../playbooks/acceptance/runtime/installed.mjs';
import {ensureRuntime} from '../playbooks/acceptance/runtime/dependencies.mjs';
const root=fileURLToPath(new URL('../playbooks/acceptance/',import.meta.url));
const preparation=ensureRuntime({packageRoot:root}),official=installedPackage('@sublang/playbook');
console.log(JSON.stringify({package_root:root,playbook:join(official.root,official.manifest.bin.playbook),preparation}));
