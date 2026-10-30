// Shared preflight for all public model workflow entries. No project commands run here.
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {guard} from './validation.mjs';
import {verifyStage} from './definitions.mjs';
import {locations,inside,read,ownedAbsolute} from './store.mjs';
import {verifyLeaseProof,leaseDigest} from './lease-proof.mjs';
export function acceptanceGuard(config,outputs=[]){
  return guard(config,outputs);
}
export function verifyDefinitionsStage(requestPath){
  verifyStage(read(requestPath));
}
export function knowledgeContext(binding){
  const receipt=JSON.parse(readFileSync(binding.knowledge_receipt,'utf8'));
  const base=join(binding.project_root,'.acceptance/knowledge');
  return Object.fromEntries(Object.keys(receipt.read_files).map(name=>[name,readFileSync(
    name.startsWith('project:')?join(binding.project_root,name.slice(8)):join(base,name),'utf8')]));
}

// Modifying case roles are only launched under the acceptance-level host lease.
export function requireWorkspaceLease(catalog,{output}={}){
  if(process.env.ACCEPTANCE_WORKSPACE_CLAIM){
    const {local}=locations(catalog.acceptance.project_root,catalog.acceptance.id),workspace=inside(local,'workspace');
    if(catalog.workspace_policy!=='single-acceptance-v1'||resolve(catalog.project_root)!==workspace)throw Error('case runner requires a newly prepared single-workspace catalog');
    const lease=process.env.ACCEPTANCE_WORKSPACE_LEASE,owner=read(inside(local,'workspace-owner.json')),claim=read(inside(local,'workspace.lock.d/owner.json'));
    if(!lease||owner.schema!=='acceptance-workspace-owner-v1'||owner.acceptance_id!==catalog.acceptance.id||owner.output_dir!==lease||claim.schema!=='acceptance-workspace-claim-v2'||claim.runtime!=='node'||claim.acceptance_id!==catalog.acceptance.id||claim.output_dir!==lease||claim.token!==process.env.ACCEPTANCE_WORKSPACE_CLAIM||!Number.isSafeInteger(claim.pid)||claim.pid===process.pid)throw Error('Node workspace claim does not match this child');
    if(output!==undefined)ownedAbsolute(lease,resolve(output));
    if(claim.liveness&&claim.liveness.public_key!==process.env.ACCEPTANCE_WORKSPACE_PROOF_KEY)throw Error('Workspace liveness public key differs from this tool authority');
    try{process.kill(claim.pid,0);}catch(error){
      if(error.code!=='EPERM')throw Error('Node workspace owner is not verifiably alive: '+error.code);
      verifyLeaseProof(claim,inside(local,'workspace.lock.d/owner.json'),process.env.ACCEPTANCE_WORKSPACE_PROOF_KEY,owner);
    }
    if(leaseDigest(read(inside(local,'workspace-owner.json')))!==leaseDigest(owner)||leaseDigest(read(inside(local,'workspace.lock.d/owner.json')))!==leaseDigest(claim))throw Error('Workspace ownership changed during verification');
    return;
  }
  throw Error('New Node case tools require the token-bound owning Playbook workspace lease; historical kernel-only hosts are not a fallback');
}
