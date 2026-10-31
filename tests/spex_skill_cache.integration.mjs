import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {packageFiles,skillRuntimeRoot} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/spex-skill-cache.mjs';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'spex-skill-cache-'))),skill=path.join(root,'exported-skill'),pkg=path.join(skill,'playbooks/acceptance'),cache=path.join(root,'cache');fs.mkdirSync(pkg,{recursive:true});
fs.writeFileSync(path.join(pkg,'package.json'),'{"name":"cache-fixture","version":"1.0.0"}\n');fs.writeFileSync(path.join(pkg,'entry.mjs'),'export const value=1;\n');fs.mkdirSync(path.join(pkg,'vendor'));fs.writeFileSync(path.join(pkg,'vendor/dependency.txt'),'fixture dependency bytes\n');
assert.equal(skillRuntimeRoot(skill,{cacheBase:cache}),pkg);
for(const name of ['.npmrc','.env','.env.local','.netrc','.git-credentials']){fs.writeFileSync(path.join(pkg,name),'synthetic-secret');assert.throws(()=>packageFiles(pkg),/must not ship/);fs.rmSync(path.join(pkg,name));}
const marker={schema:'acceptance-spex-skill-v1',package_root:'playbooks/acceptance',package_version:'1.0.0',package_files:packageFiles(pkg)};fs.writeFileSync(path.join(skill,'SPEX-INSTALL.json'),JSON.stringify(marker));const original=packageFiles(skill);
const prepared=skillRuntimeRoot(skill,{cacheBase:cache});assert.ok(prepared.startsWith(cache+path.sep));assert.deepEqual(packageFiles(prepared),packageFiles(pkg));assert.deepEqual(packageFiles(skill),original);
fs.mkdirSync(path.join(prepared,'node_modules'));fs.writeFileSync(path.join(prepared,'node_modules/fixture.txt'),'runtime-only bytes');assert.equal(skillRuntimeRoot(skill,{cacheBase:cache}),prepared);
// A real whole-folder re-export leaves the external dependency environment intact.
const saved=path.join(root,'source');fs.cpSync(skill,saved,{recursive:true});fs.rmSync(skill,{recursive:true});fs.cpSync(saved,skill,{recursive:true});assert.equal(skillRuntimeRoot(skill,{cacheBase:cache}),prepared);assert.ok(fs.existsSync(path.join(prepared,'node_modules/fixture.txt')));
assert.throws(()=>skillRuntimeRoot(skill,{cacheBase:path.join(skill,'cache')}),/outside/);
fs.writeFileSync(path.join(prepared,'entry.mjs'),'export const value=2;\n');assert.throws(()=>skillRuntimeRoot(skill,{cacheBase:cache}),/source changed/);assert.deepEqual(packageFiles(skill),original);
fs.writeFileSync(path.join(pkg,'entry.mjs'),'export const value=3;\n');assert.throws(()=>skillRuntimeRoot(skill,{cacheBase:cache}),/installation manifest/);
console.log('passed real Skill cache: external copy, managed tree unchanged, whole-folder replacement reuse, source/cache tampering rejected; evidence: '+root);
