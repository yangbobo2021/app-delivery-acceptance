import fs from 'node:fs';
import {nodeCommand} from '../../runtime/node-process.mjs';
import path from 'node:path';
// Delegate the existing workspace lease to one deterministic tool, never to a model launcher.
export function toolCommand(script,directory){
 const lease=process.env.ACCEPTANCE_WORKSPACE_LEASE,claim=process.env.ACCEPTANCE_WORKSPACE_CLAIM;
 if(!lease||!claim)return nodeCommand(script);
 const proofKey=process.env.ACCEPTANCE_WORKSPACE_PROOF_KEY;
 const file=path.join(directory,'.tool-authority.json'),value={lease,claim,...(proofKey?{proof_key:proofKey}:{})};
 if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(fs.readFileSync(file)))!==JSON.stringify(value))throw Error('Tool authority differs from this attempt');}
 else fs.writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
 return nodeCommand(script,'--lease-file',file);
}
