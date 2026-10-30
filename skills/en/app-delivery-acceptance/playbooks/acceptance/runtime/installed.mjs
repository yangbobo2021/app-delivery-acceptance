import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Respect npm's installed dependency tree, including legitimately hoisted SDKs.
export function installedPackage(name){
 for(const folder of require.resolve.paths(name)??[]){const file=path.join(folder,name,'package.json');if(fs.existsSync(file)){const root=fs.realpathSync(path.dirname(file)),manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json')));if(manifest.name!==name)throw Error('Dependency package identity mismatch: '+name);return {root,manifest};}}
 throw Error('Declared dependency is missing: '+name);
}
