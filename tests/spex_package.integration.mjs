import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';
import {buildSpex} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/bin/build-spex.mjs';
import {installedPackage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/installed.mjs';
import {packageFiles,skillRuntimeRoot} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/spex-skill-cache.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-spex-package-')),release=path.join(root,'release');
const result=await buildSpex({output:release,org:'fixture',version:'0.3.0'}),manifest=JSON.parse(fs.readFileSync(path.join(release,'meta.yaml'))),main=path.join(release,'playbooks/en/acceptance-orchestrate');
const playbooks=Object.keys(manifest.artifacts).filter(id=>manifest.artifacts[id].kind==='playbook'),skill=path.join(release,'skills/en/app-delivery-acceptance');
assert.equal(manifest.format,2);assert.equal(Object.keys(manifest.artifacts).length,32);assert.equal(playbooks.length,31);assert.equal(fs.existsSync(path.join(main,'node_modules')),false);
assert.equal(manifest.artifacts['app-delivery-acceptance'].kind,'skill');
assert.deepEqual([...manifest.artifacts['acceptance-orchestrate'].requires].sort(),playbooks.filter(id=>id!=='acceptance-orchestrate').sort());
assert.deepEqual(manifest.artifacts['app-delivery-acceptance'].requires??[],[],'The independently usable Skill must not hide the native main entry as private support');
for(const file of ['SKILL.md','scripts/setup.mjs','SPEX-INSTALL.json','playbooks/acceptance/vendor/provenance.json','playbooks/acceptance/npm-shrinkwrap.json'])assert.ok(fs.existsSync(path.join(skill,file)),file);
assert.equal(fs.existsSync(path.join(skill,'playbooks/acceptance/node_modules')),false);
assert.equal(manifest.license,'Apache-2.0');
assert.equal(fs.readFileSync(path.join(release,'LICENSE'),'utf8'),fs.readFileSync(new URL('../LICENSE',import.meta.url),'utf8'));
const shippedPackage=path.join(skill,'playbooks/acceptance'),sourcePackage=fileURLToPath(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/',import.meta.url));
const sourceManifest=JSON.parse(fs.readFileSync(path.join(sourcePackage,'package.json'))),locked=new Set(Object.values(sourceManifest.dependencies).filter(v=>v.startsWith('file:vendor/')).map(v=>v.slice(5)));
assert.equal(locked.size,2);
for(const file of fs.readdirSync(path.join(sourcePackage,'vendor')).filter(f=>f.endsWith('.tgz'))){
 const relative='vendor/'+file,source=path.join(sourcePackage,relative),target=path.join(shippedPackage,relative);
 assert.ok(fs.existsSync(source),'Historical source archive must remain: '+file);
 if(locked.has(relative))assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));else assert.equal(fs.existsSync(target),false,'Unreferenced archive must not ship: '+file);
}
const marker=JSON.parse(fs.readFileSync(path.join(skill,'SPEX-INSTALL.json')));
assert.deepEqual(marker.package_files,packageFiles(shippedPackage),'Integrity list must describe the filtered release, not the source tree');
const prepared=skillRuntimeRoot(skill,{cacheBase:path.join(root,'skill-cache')});assert.deepEqual(packageFiles(prepared),packageFiles(shippedPackage));
assert.match(fs.readFileSync(path.join(release,'README.md'),'utf8'),/Registry/);
assert.ok(fs.existsSync(path.join(main,'runtime/vendor/picomatch/index.js')));
// UI format checking is supplied from the actual SPEX host build; it is not a
// workflow dependency and must run before adding host engine links below.
const formatIndex=process.argv.indexOf('--spex-format');
if(formatIndex>=0){
 const formatUrl=pathToFileURL(path.resolve(process.argv[formatIndex+1]));
 const {readRelease,providedArtifacts,readPublishableRelease}=await import(formatUrl);
 const checked=await readRelease(release);assert.equal(Object.keys(checked.manifest.artifacts).length,32);
 const provided=providedArtifacts(checked.manifest);
 assert.equal([...provided].filter(id=>checked.manifest.artifacts[id].kind==='playbook').length,31,'Real SPEX discovery must expose all native entries');
 assert.ok(provided.has('acceptance-orchestrate'),'The main workflow must be publicly enableable');
 assert.ok(provided.has('app-delivery-acceptance'),'The real Skill must be independently exportable');
 const publishable=await readPublishableRelease(release);
 const {packRelease,unpackRelease}=await import(new URL('archive.js',formatUrl));
 const archive=packRelease(release,publishable.manifest,publishable.files);
 assert.ok(archive.byteLength<=5*1024*1024,'The actual SPEX publish archive exceeds the Registry limit');
 assert.deepEqual(unpackRelease(archive,manifest.name).issues,[]);
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
