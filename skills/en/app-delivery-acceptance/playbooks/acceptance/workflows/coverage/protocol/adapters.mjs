import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// The role names reused dependencies; the workflow owns complete write discovery
// and freezing. A missing model list item must not discard an authorized write.
export function freezeAdapterFiles({workspace,testRoots,sourceHashes,declaredPaths,modifiedPaths}){
  if(!Array.isArray(declaredPaths)||!declaredPaths.length)throw Error('Agent omitted project adapters');
  if(!Array.isArray(testRoots)||!testRoots.length)throw Error('Coverage test roots missing');
  const roots=testRoots.map(name=>path.resolve(workspace,name)),files={};
  const names=[...new Set([...declaredPaths,...modifiedPaths])];
  for(const name of names){
    if(typeof name!=='string'||path.isAbsolute(name)||name.split('/').includes('..'))throw Error('Adapter path escapes workspace');
    if(Object.hasOwn(sourceHashes,name))throw Error('Coverage adapter cannot be frozen product source');
    const file=path.resolve(workspace,name);
    if(!roots.some(root=>file.startsWith(root+path.sep)))throw Error('Adapter path is outside declared test roots');
    if(!fs.existsSync(file))throw Error('Coverage preparation removed a test file; restore or explicitly resolve its ownership: '+name);
    const actual=fs.realpathSync(file);
    if(!roots.some(root=>actual.startsWith(fs.realpathSync(root)+path.sep)))throw Error('Adapter resolves outside declared test roots');
    if(!fs.statSync(file).isFile())throw Error('Coverage adapter must be a regular file: '+name);
    files[name]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return {files,discovery:{schema:'coverage-adapter-discovery-v1',declared_paths:[...declaredPaths],
    automatically_added_paths:names.filter(name=>!declaredPaths.includes(name)),
    basis:'Authorized workspace changes after product/revision and test-root guards; every discovered file is hashed and frozen before probes.'}};
}
