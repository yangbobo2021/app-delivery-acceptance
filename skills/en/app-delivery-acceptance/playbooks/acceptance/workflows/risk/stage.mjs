import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,atomicJson,requireCurrent,ownedAbsolute} from '../shared/store.mjs';
import {digest,currentBinding} from '../shared/definitions.mjs';
import {validateStore} from '../shared/validation.mjs';
import {workspaceMetadataLock} from '../shared/workspace.mjs';
export function recordRisk(input){
 const fields=['project_root','acceptance_id','request_id','definitions_sha256','scene_id','finding_reference','finding_sha256','user_quote','source_reference','remaining_impact','confirmed_at'];if(!input||Object.keys(input).some(k=>!fields.includes(k)))throw Error('Risk decision has unknown fields');
 const {root,shared,local}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);validateStore(root,input.acceptance_id);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??''))throw Error('Stable risk decision identity required');for(const field of ['scene_id','user_quote','source_reference','remaining_impact','confirmed_at'])if(typeof input[field]!=='string'||!input[field].trim())throw Error('Risk decision requires actual '+field);if(!Number.isFinite(Date.parse(input.confirmed_at)))throw Error('Actual confirmation timestamp required');
 const definitions=currentBinding(root,input.acceptance_id);if(definitions.sha256!==input.definitions_sha256||!read(definitions.path).scenarios.some(s=>s.id===input.scene_id))throw Error('Risk decision scene/current definitions mismatch');const file=ownedAbsolute(inside(local,'workflows'),input.finding_reference);if(digest(file)!==input.finding_sha256)throw Error('Original technical finding changed');const finding=read(file);if(!['product_bug','inconclusive','repair_required'].includes(finding.status)||!finding.findings?.length)throw Error('Risk acceptance requires an actual unresolved technical finding, not a pass or invented risk');
 const target=inside(shared,'records/risks/'+input.request_id+'.json'),value={schema:'acceptance-risk-decision-v1',acceptance_id:input.acceptance_id,...input,finding_reference:file,technical_status:finding.status};
 return workspaceMetadataLock(root,input.acceptance_id,()=>{if(fs.existsSync(target)){if(!equal(read(target),value))throw Error('Risk decisions are append-only; use a new request for a changed decision');return {status:'recorded',record:target,reused:true};}fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n',{flag:'wx'});return {status:'recorded',record:target,sha256:digest(target),technical_status:finding.status};});
}
