#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {installedPackage} from '../runtime/installed.mjs';
import {packageFiles,assertReleaseEntry} from '../runtime/spex-skill-cache.mjs';
const packageRoot=fileURLToPath(new URL('..',import.meta.url));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const portableName=value=>typeof value==='string'&&value.length<=64&&/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
export async function buildSpex({output,org='sublang',name='delivery-acceptance',version=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version}={}){
 if(!output||!portableName(org)||!portableName(name)||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw Error('A new output folder, portable org/name and semantic version are required');
 const destination=path.resolve(output);if(fs.existsSync(destination))throw Error('Output already exists: '+destination);
 if(destination===packageRoot||destination.startsWith(packageRoot+path.sep))throw Error('Build outside the source package');
 const entries=[];for(const folder of fs.readdirSync(path.join(packageRoot,'workflows')).sort()){
  const file=path.join(packageRoot,'workflows',folder,'registry.mjs');if(folder==='native-role'||!fs.existsSync(file))continue;
  const entry=(await import(pathToFileURL(file))).default;entries.push({folder,id:entry.id,roles:entry.requiredRoleIds,policies:entry.rolePolicies??{}});
 }
 const main='acceptance-orchestrate',skillId='app-delivery-acceptance',skillRoot=path.resolve(packageRoot,'../..'),root=path.join(destination,'playbooks/en',main),ids=entries.map(e=>e.id),artifacts={};
 if(!fs.existsSync(path.join(skillRoot,'SKILL.md')))throw Error('Unified release build requires its containing app-delivery-acceptance Skill');
 const inputs={};
 // Preflight all source resources before writing a release; no credentials or node_modules ship.
 function collect(dir,prefix=''){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const rel=path.join(prefix,item.name);if(['node_modules','.git','.runtime-install.lock.d','.DS_Store'].includes(item.name))continue;assertReleaseEntry(item.name);if(item.isSymbolicLink()||(!item.isDirectory()&&!item.isFile()))throw Error('Release source contains a non-regular entry: '+rel);if(item.isDirectory())collect(path.join(dir,item.name),rel);else inputs[rel.split(path.sep).join('/')]=sha(path.join(dir,item.name));}}
 packageFiles(skillRoot);
 collect(packageRoot);
 const picomatch=installedPackage('picomatch');
 try{
  fs.mkdirSync(path.dirname(root),{recursive:true});
  fs.cpSync(packageRoot,root,{recursive:true,filter:file=>!path.relative(packageRoot,file).split(path.sep).some(n=>['node_modules','.git','.runtime-install.lock.d','.DS_Store','vendor'].includes(n))});
  fs.cpSync(picomatch.root,path.join(root,'runtime/vendor/picomatch'),{recursive:true,filter:file=>!path.relative(picomatch.root,file).split(path.sep).includes('node_modules')});
  const evidence=path.join(root,'workflows/shared/evidence.mjs'),vendorImport='../../runtime/vendor/picomatch/index.js';fs.writeFileSync(evidence,fs.readFileSync(evidence,'utf8').replace("from 'picomatch'",'from '+JSON.stringify(vendorImport)));
  fs.writeFileSync(path.join(root,'SOURCE.json'),JSON.stringify({schema:'acceptance-spex-source-v1',source_version:JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version,files:inputs,vendored_dependencies:{picomatch:{version:picomatch.manifest.version,license:picomatch.manifest.license}}},null,2)+'\n');
  for(const entry of entries){
   const folder=path.join(destination,'playbooks/en',entry.id);fs.mkdirSync(folder,{recursive:true});
   const shared=entry.id===main?'./':'../'+main+'/';
   fs.writeFileSync(path.join(folder,entry.id+'.registry.mjs'),`import entry from '${shared}workflows/${entry.folder}/registry.mjs';\nimport {spexEntry} from '${shared}runtime/spex-entry.mjs';\nexport * from '${shared}workflows/${entry.folder}/registry.mjs';\nexport const spexRegistryContract=3;\nexport {RUNTIME_ABI as acceptanceRuntimeAbi} from '@sublang/playbook/xstate-runtime';\nexport default spexEntry(entry);\n`);
   fs.writeFileSync(path.join(folder,entry.id+'.md'),`# ${entry.id}\n\n${(await import(pathToFileURL(path.join(packageRoot,'workflows',entry.folder,'registry.mjs')))).default.intent}\n\nUse this public entry in a SPEX session. Task contracts and source live in the acceptance-orchestrate artifact.\n`);
   artifacts[entry.id]={kind:'playbook',language:'en',requires:entry.id===main?[...ids.filter(id=>id!==main),skillId]:[main]};
  }
  const skillFolder=path.join(destination,'skills/en',skillId);
  fs.cpSync(skillRoot,skillFolder,{recursive:true,filter:file=>!path.relative(skillRoot,file).split(path.sep).some(n=>['node_modules','.git','.runtime-install.lock.d','.DS_Store'].includes(n))});
  fs.writeFileSync(path.join(skillFolder,'SPEX-INSTALL.json'),JSON.stringify({schema:'acceptance-spex-skill-v1',package:org+'/'+name,package_version:version,package_root:'playbooks/acceptance',package_files:packageFiles(packageRoot)},null,2)+'\n');
  artifacts[skillId]={kind:'skill',language:'en',requires:[main]};
  const sourceManifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json')));
  const manifest={format:2,org,name,version,description:'Delivery acceptance workflows using native SPEX Player and nested Playbook ports',...(sourceManifest.license?{license:sourceManifest.license}:{}),artifacts};
  fs.writeFileSync(path.join(destination,'meta.yaml'),JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(path.join(destination,'README.md'),'# '+org+'/'+name+'\n\nOne SPEX install supplies the real app-delivery-acceptance Skill and 31 native Playbooks. SPEX exports the Skill to the project .agents/skills folder for external Codex. Start a new Codex turn in that project and use $app-delivery-acceptance. Its setup prepares locked CLI dependencies in a verified external cache; use the returned package_root. Do not install dependencies into SPEX-managed exports.\n\nIn SPEX, enable acceptance-orchestrate and the child workflows required for your task. Bind distinct Players per workflow role and choose your actual Agent/model/effort. Native Playbooks use the SPEX engine and need no npm install.\n\nDelegation and stopping boundaries: playbooks/en/acceptance-orchestrate/docs/orchestration-workflow.md. Task restrictions are Prompt contracts plus workflow file/evidence checks, not a sandbox guarantee. Host metadata not exposed is reported as unavailable.\n');
  for(const name of ['LICENSE','LICENSE.spex']){const license=path.resolve(packageRoot,'../../../../../',name);if(fs.existsSync(license))fs.copyFileSync(license,path.join(name==='LICENSE'?destination:root,name));}
  return{status:'built',path:destination,name:org+'/'+name,version,artifacts:entries,skills:[skillId],model_calls:0,native_npm_install_required:false,skill_runtime_prepared_on_first_use:true};
 }catch(error){error.message+='; inspect the partially written output before retrying';throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--output','--org','--name','--version'].includes(args[i])||!args[i+1])throw Error('usage: build-spex.mjs --output NEW_FOLDER [--org ORG] [--name NAME] [--version VERSION]');options[args[i].slice(2)]=args[i+1];}
 console.log(JSON.stringify(await buildSpex(options)));
}
