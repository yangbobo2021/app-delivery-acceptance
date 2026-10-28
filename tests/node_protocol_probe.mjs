// Test-only stdin bridge: invokes the real Node modules against actual fixture
// files. Production entries additionally enforce AT, definitions and leases.
import fs from 'node:fs';
import {decisionGate,handoffGate} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/review-gates.mjs';
import {verifyIdentity,finalizeIdentities,rebuildIdentityPatch,preflightIdentity} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/identity.mjs';
import {caseContext,validateDiscovery,validateEvaluation} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/case-contract.mjs';
import {reuseInventory,originalBytes,reuseCheckpoint,validateReuse} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/case-reuse.mjs';
import {snapshotExisting,verifyExisting} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/existing-policy.mjs';
const value=JSON.parse(fs.readFileSync(0,'utf8'));
try{
  let result;
  switch(value.operation){
    case 'identity-finalize':result=finalizeIdentities(value.catalog,value.input,value.output);break;
    case 'identity-preflight':preflightIdentity(value.catalog,value.answer);result={status:'valid'};break;
    case 'identity-verify':result=verifyIdentity(value.answer,value.root,{sceneId:value.options?.scene_id,acceptanceId:value.options?.acceptance_id,receiptHashes:value.options?.receipt_hashes});break;
    case 'identity-rebuild':result={base64:rebuildIdentityPatch(value.patch).toString('base64')};break;
    case 'decision':result=decisionGate(value.answer,value.input,value.metrics??{});break;
    case 'handoff':result=handoffGate(value.input,value.catalog);break;
    case 'case-context':result=caseContext(value.input,value.answer);break;
    case 'case-discovery':result=validateDiscovery(value.answer,value.input,value.root,value.baseline,{discoveryOnly:value.discovery_only??false});break;
    case 'case-evaluation':result=validateEvaluation(value.value,value.input,value.answer,value.root,{requireTargetChecks:value.require_target_checks??false});break;
    case 'reuse-inventory':result=reuseInventory(value.catalog);break;
    case 'reuse-original':result={base64:originalBytes(value.baseline,value.name).toString('base64')};break;
    case 'reuse-checkpoint':result=reuseCheckpoint(value.answer,value.input,value.catalog,value.baseline,value.output);break;
    case 'reuse-validate':result=validateReuse(value.answer,value.input,value.catalog,value.captured,value.output);break;
    case 'existing-snapshot':result=snapshotExisting(value.catalog);break;
    case 'existing-verify':verifyExisting(value.catalog,value.baseline,value.answer);result={status:'valid'};break;
    default:throw Error('Unknown test protocol operation');
  }
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({status:'blocked',reason:error.message}));process.exitCode=2;}
