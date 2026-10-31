import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {owned} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/artifacts.mjs';
import {identitySource} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/identity.mjs';
import {resolveExecutable} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/argv.mjs';
import {inside} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-native-paths-'));
const project=path.join(root,'project'),outside=path.join(root,'outside');
fs.mkdirSync(project);fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside,'sentinel'),'unchanged');
fs.symlinkSync(outside,path.join(project,'link'),process.platform==='win32'?'junction':'dir');
assert.throws(()=>inside(project,'link/sentinel'),/symlink/);
assert.throws(()=>owned(project,'link/sentinel'),/symlink/);
assert.throws(()=>inside(project,'a/../outside'),/relative/);
if(process.platform==='win32'){
 assert.throws(()=>inside(project,'link\\sentinel'),/symlink/);
 assert.throws(()=>owned(project,'link\\sentinel'),/symlink/);
 for(const name of ['.GIT\\config','.acceptance-local\\private.json','.git. \\config'])assert.throws(()=>identitySource(project,name),/outside test workspace/);
 const program=path.basename(process.execPath,path.extname(process.execPath));
 const env={Path:path.join(root,'missing'),PATH:path.dirname(process.execPath),PATHEXT:'.EXE;.CMD'};
 assert.equal(resolveExecutable(program,{cwd:project,env}).toLowerCase(),fs.realpathSync(process.execPath).toLowerCase());
 assert.equal(resolveExecutable(process.execPath.replaceAll('\\','/'),{cwd:project,env}),fs.realpathSync(process.execPath));
 assert.throws(()=>inside(project,'a\\..\\outside'),/relative/);
 assert.equal(inside(project,'safe\\file'),path.join(project,'safe','file'));
}else{
 // A POSIX filename may contain a literal backslash: do not reinterpret it.
 assert.equal(inside(project,'link\\sentinel'),path.join(project,'link\\sentinel'));
}
assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'unchanged');
console.log(JSON.stringify({status:'passed',platform:process.platform,symlinkTraversalRejected:true,nativeSeparatorsChecked:true,outsideUnchanged:true,evidence:root}));
