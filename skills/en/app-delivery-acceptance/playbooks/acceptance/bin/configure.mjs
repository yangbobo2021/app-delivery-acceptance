// Generate an explicit temporary overlay from the actual shipped registries.
// This selects no business path and makes no model/provider call.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const adapter=agent=>{const value={'codex':'codex','claude-code':'claude','opencode':'opencode'}[agent];if(!value)throw Error('Explicit agent must be codex, claude-code or opencode');return value;};
const binding=value=>{if(!value||Object.keys(value).some(k=>!['agent','model','effort'].includes(k))||!String(value.model??'').trim())throw Error('Every selected role requires explicit agent/model');if(value.agent==='opencode'&&!value.model.includes('/'))throw Error('OpenCode requires provider/model');return {adapter:adapter(value.agent),model:value.model,...(value.effort?{effort:value.effort}:{})};};
export async function workflowOverlay({agent,model,effort,role_bindings={}}){
 const base=binding({agent,model,...(effort?{effort}:{})}),playbooks={},players={},roles=new Set();
 for(const folder of fs.readdirSync(path.join(root,'workflows')).sort()){const file=path.join(root,'workflows',folder,'registry.mjs');if(folder==='native-role'||!fs.existsSync(file))continue;const entry=(await import(file)).default,assignments={};for(const role of entry.requiredRoleIds){roles.add(role);const id='acceptance.'+folder+'.'+role;assignments[role]=id;players[id]={...binding(role_bindings[role]??{agent,model,...(effort?{effort}:{})}),permissions:entry.rolePolicies?.[role]??{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}};}playbooks[entry.id]={from:file,roles:assignments};}
 for(const role of Object.keys(role_bindings))if(!roles.has(role))throw Error('Unknown direct Playbook role override: '+role);
 return {captain:base,players,playbooks};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),allowed=new Set(['--agent','--model','--effort','--roles','--output']),options={};for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1])throw Error('usage: configure.mjs --agent AGENT --model MODEL --output NEW.json [--effort EFFORT] [--roles ROLE_BINDINGS.json]');options[args[i].slice(2)]=args[i+1];}
 if(!options.output)throw Error('An explicit new overlay output file is required');const role_bindings=options.roles?JSON.parse(fs.readFileSync(options.roles,'utf8')):{},value=await workflowOverlay({...options,role_bindings});const file=path.resolve(options.output);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({status:'written',path:file,workflows:Object.keys(value.playbooks).length,role_ids:Object.keys(value.players),model_calls:0})+'\n');
}
