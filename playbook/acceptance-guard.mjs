// Shared preflight for all public model workflow entries. No project commands run here.
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const script=resolve(dirname(fileURLToPath(import.meta.url)),'../scripts/acceptance_store.py');
export function acceptanceGuard(config,outputs=[]){
  return JSON.parse(execFileSync('python3',[script,'guard','-',...outputs.flatMap(p=>['--output',resolve(p)])],
    {input:JSON.stringify(config),encoding:'utf8'}));
}
export function verifyDefinitionsStage(requestPath){
  execFileSync('python3',[resolve(dirname(script),'acceptance_definitions.py'),'verify-stage',resolve(requestPath)],
    {encoding:'utf8'});
}
export function knowledgeContext(binding){
  const receipt=JSON.parse(readFileSync(binding.knowledge_receipt,'utf8'));
  const base=join(binding.project_root,'.acceptance/knowledge');
  return Object.fromEntries(Object.keys(receipt.read_files).map(name=>[name,readFileSync(
    name.startsWith('project:')?join(binding.project_root,name.slice(8)):join(base,name),'utf8')]));
}

// Modifying case roles are only launched under the acceptance-level host lease.
export function requireWorkspaceLease(catalog){
  execFileSync('python3',[resolve(dirname(script),'acceptance_workspace.py')],
    {input:JSON.stringify(catalog),encoding:'utf8'});
}
