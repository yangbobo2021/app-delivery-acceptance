import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {buildSpex} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/bin/build-spex.mjs';
import {installedPackage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/installed.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-spex-package-')),release=path.join(root,'release');
const result=await buildSpex({output:release,org:'fixture',version:'0.3.0'}),manifest=JSON.parse(fs.readFileSync(path.join(release,'meta.yaml'))),main=path.join(release,'playbooks/en/acceptance-orchestrate');
const playbooks=Object.keys(manifest.artifacts).filter(id=>manifest.artifacts[id].kind==='playbook'),skill=path.join(release,'skills/en/app-delivery-acceptance');
assert.equal(manifest.format,2);assert.equal(Object.keys(manifest.artifacts).length,32);assert.equal(playbooks.length,31);assert.equal(fs.existsSync(path.join(main,'node_modules')),false);
assert.equal(manifest.artifacts['app-delivery-acceptance'].kind,'skill');assert.ok(manifest.artifacts['acceptance-orchestrate'].requires.includes('app-delivery-acceptance'));
for(const file of ['SKILL.md','scripts/setup.mjs','SPEX-INSTALL.json','playbooks/acceptance/vendor/provenance.json','playbooks/acceptance/npm-shrinkwrap.json'])assert.ok(fs.existsSync(path.join(skill,file)),file);
assert.equal(fs.existsSync(path.join(skill,'playbooks/acceptance/node_modules')),false);
assert.ok(fs.existsSync(path.join(main,'runtime/vendor/picomatch/index.js')));
// UI format checking is supplied from the actual SPEX host build; it is not a
// workflow dependency and must run before adding host engine links below.
const formatIndex=process.argv.indexOf('--spex-format');
if(formatIndex>=0){
 const {readRelease}=await import(pathToFileURL(path.resolve(process.argv[formatIndex+1])));
 const checked=await readRelease(release);assert.equal(Object.keys(checked.manifest.artifacts).length,32);
}
for(const id of playbooks){
 const folder=path.join(release,'playbooks/en',id);fs.mkdirSync(path.join(folder,'node_modules/@sublang'),{recursive:true});
 for(const name of ['xstate','@sublang/playbook'])fs.symlinkSync(installedPackage(name).root,path.join(folder,'node_modules',name),'dir');
}
for(const id of playbooks){
 const folder=path.join(release,'playbooks/en',id);
 const module=await import(pathToFileURL(path.join(folder,id+'.registry.mjs')));assert.equal(module.spexRegistryContract,3);assert.equal(module.default.id,id);
}
const {discover}=await import(pathToFileURL(path.join(main,'workflows/orchestrate/task.mjs')));const catalog=await discover();assert.equal(catalog.workflows.length,30);assert.equal(catalog.workflows.find(w=>w.id==='acceptance-freeze').input_preflight,true);
const {installedPackage:artifactDependency}=await import(pathToFileURL(path.join(main,'runtime/installed.mjs')));assert.throws(()=>artifactDependency('@sublang/cligent'),/missing/);assert.throws(()=>artifactDependency('@openai/codex-sdk'),/missing/);
await assert.rejects(()=>buildSpex({output:release}),/already exists/);
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({status:'passed',release,playbooks:result.artifacts.length,skills:result.skills,children:catalog.workflows.length,nativeCligentAndSdkRequired:false},null,2)+'\n');console.log('passed unified SPEX package: actual Skill plus every native entry and dynamic child; evidence: '+root);
