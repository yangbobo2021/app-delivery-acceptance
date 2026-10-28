import fs from 'node:fs';
import path from 'node:path';
// Delegate the existing workspace lease to one deterministic tool, never to a model launcher.
export function toolCommand(script,directory){
 const lease=process.env.ACCEPTANCE_WORKSPACE_LEASE,claim=process.env.ACCEPTANCE_WORKSPACE_CLAIM;
 if(!lease||!claim)return [process.execPath,script];
 const file=path.join(directory,'.tool-authority.json'),value={lease,claim};
 if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(fs.readFileSync(file)))!==JSON.stringify(value))throw Error('Tool authority differs from this attempt');}
 else fs.writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
 return [process.execPath,script,'--lease-file',file];
}
