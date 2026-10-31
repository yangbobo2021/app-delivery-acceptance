#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
const skillPath='skills/en/app-delivery-acceptance';
const packagePath=skillPath+'/playbooks/acceptance';
function git(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();}
function repositoryUrl(root){
 let remote;try{remote=git(root,'remote','get-url','origin');}catch{throw Error('Source repository needs an origin URL for provenance');}
 if(remote.startsWith('git@github.com:'))return 'https://github.com/'+remote.slice('git@github.com:'.length).replace(/\.git$/,'');
 const url=new URL(remote);if(!['https:','http:'].includes(url.protocol))throw Error('Public source repository URL required');
 url.username='';url.password='';return url.href.replace(/\.git$/,'').replace(/\/$/,'');
}
export async function buildDistribution({output,repository=sourceRoot,org='yangbobo2021',name='app-delivery-acceptance'}={}){
 if(!output)throw Error('A new absolute output directory is required');
 const root=fs.realpathSync(repository),destination=path.resolve(output);
 if(fs.existsSync(destination))throw Error('Output already exists; preserve it for inspection');
 if(destination===root||destination.startsWith(root+path.sep))throw Error('Distribution output must be outside the source repository');
 if(git(root,'status','--porcelain','--untracked-files=normal'))throw Error('Source repository has uncommitted files; commit and review before building');
 const commit=git(root,'rev-parse','HEAD'),tree=git(root,'rev-parse','HEAD^{tree}'),sourceRepository=repositoryUrl(root);
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-distribution-source-')),archive=path.join(temporary,'source.tar'),checkout=path.join(temporary,'source');
 try{
  fs.mkdirSync(checkout);
  fs.writeFileSync(archive,execFileSync('git',['-c','core.autocrlf=false','archive','--format=tar',commit],{cwd:root,maxBuffer:32*1024*1024}));
  execFileSync('tar',['-xf',archive,'-C',checkout]);
  const prepared=fs.realpathSync(path.join(root,packagePath,'node_modules'));
  // Build tools use the prepared dependency tree, never ship it. The source
  // itself is extracted from the pinned commit instead of copied from disk.
  fs.symlinkSync(prepared,path.join(checkout,packagePath,'node_modules'),process.platform==='win32'?'junction':'dir');
  const {buildSpex}=await import(pathToFileURL(path.join(checkout,packagePath,'bin/build-spex.mjs')));
  const {packageFiles}=await import(pathToFileURL(path.join(checkout,packagePath,'runtime/spex-skill-cache.mjs')));
  const result=await buildSpex({output:destination,org,name});
  const provenance={repository:sourceRepository,commit,tree,skill_files:packageFiles(path.join(checkout,skillPath))};
  const manifestFile=path.join(destination,'meta.yaml'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  manifest.repository='https://github.com/yangbobo2021/app-delivery-acceptance-spex';manifest['x-source']=provenance;
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(path.join(destination,'README.md'),`# App Delivery Acceptance — SPEX installation\n\nGenerated from [the complete source repository](${sourceRepository}/tree/${commit}), commit \`${commit}\`. Version **${manifest.version}**. The source commit, tree and Skill file digests are recorded in \`meta.yaml\` under \`x-source\`. Development, specs and regression tests remain in the source repository.\n\nIn SPEX choose a project → 规程 → 从 Git 添加:\n\n| Field | Value |\n| --- | --- |\n| Package | ${org}/${name} |\n| Git URL | https://github.com/yangbobo2021/app-delivery-acceptance-spex.git |\n| Revision | main |\n| Folder | Leave empty |\n\nAfter installation enable acceptance-orchestrate and the child workflows needed for the task, bind distinct Players to roles, and configure your own Agent, model and login. The same installation exports the real app-delivery-acceptance Skill to that project for Codex. Start a new Codex turn in the project and use $app-delivery-acceptance. Its platform setup prepares verified runtime/dependencies in an independent cache; use the returned executable and package paths. No manual file copying or dependency installation inside SPEX-managed exports is required.\n\nInstallation does not prove business acceptance. Use the parent workflow for requirement-to-scenario and selected-scene execution, retaining independent review, permissions, leases, immutable inputs and evidence. See the source repository for actual validation scope and prerequisites.\n`);
  if(git(root,'rev-parse','HEAD')!==commit||git(root,'status','--porcelain','--untracked-files=normal'))throw Error('Source changed while building; do not publish this candidate');
  return {...result,source:provenance};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('usage: node scripts/build-distribution.mjs --output NEW_DIRECTORY');
 const result=await buildDistribution({output:args[1]});console.log(JSON.stringify({status:result.status,path:result.path,name:result.name,source_commit:result.source.commit}));
}
