#!/usr/bin/env node
// Skill convenience only: the package owns installation and every business operation.
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {ensureRuntime} from '../playbooks/acceptance/runtime/dependencies.mjs';
import {skillRuntimeRoot} from '../playbooks/acceptance/runtime/spex-skill-cache.mjs';
const root=skillRuntimeRoot(fileURLToPath(new URL('..',import.meta.url)));
const preparation=ensureRuntime({packageRoot:root});
const {installedPackage}=await import(pathToFileURL(join(root,'runtime/installed.mjs')));
const official=installedPackage('@sublang/playbook');
console.log(JSON.stringify({package_root:root,playbook:join(official.root,official.manifest.bin.playbook),preparation}));
