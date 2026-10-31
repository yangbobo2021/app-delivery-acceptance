import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export const skill = process.env.ACCEPTANCE_PACKAGE_ROOT ?? fileURLToPath(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/', import.meta.url));
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function snapshot(root) {
  const result = {};
  function visit(folder) { for (const name of fs.readdirSync(folder).sort()) {
    const file = path.join(folder, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) visit(file);
    else result[path.relative(root, file)] = stat.isSymbolicLink() ? 'symlink:' + fs.readlinkSync(file) : sha(file);
  } }
  visit(root); return result;
}
export function harness(name, registryNames) {
  const args = process.argv.slice(2), index = args.indexOf('--output');
  const output = index >= 0 ? path.resolve(args[index + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), name+'-evidence-'));
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), name+'-test-'));
  const results = [], commands = [];
  const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2)+'\n');
  const run = (label, executable, argv, settings={}) => {
    const started_at = new Date().toISOString();
    const result = spawnSync(executable, argv, { encoding:'utf8', timeout:90000, maxBuffer:16*1024*1024, ...settings });
    const receipt = {label,executable,argv,cwd:settings.cwd??process.cwd(),stdin:settings.input??null,
      started_at,finished_at:new Date().toISOString(),exit_code:result.status,signal:result.signal,
      stdout:result.stdout,stderr:result.stderr,error:result.error?.message??null};
    commands.push(receipt); save('commands.json',commands); return receipt;
  };
  const project = label => { const root=path.join(temporary,label);fs.mkdirSync(root);return root; };
  const test = (id,purpose,operation) => {
    try { results.push({id,purpose,status:'passed',...(operation()??{})}); }
    catch(error) { results.push({id,purpose,status:'failed',error:error.stack}); process.exitCode=1; }
    save('results.json',results); console.log(results.at(-1).status+' '+id+' '+purpose);
  };
  const spex=path.join(temporary,'spex'), sessions=path.join(temporary,'sessions');
  fs.mkdirSync(path.join(spex,'config'),{recursive:true});
  const agent=process.env.ACCEPTANCE_AGENT??'codex',model=process.env.ACCEPTANCE_MODEL??(agent==='codex'?'gpt-6.1-sol':null),effort=process.env.ACCEPTANCE_EFFORT;
  if(!model)throw Error('A non-Codex live fixture requires an explicit ACCEPTANCE_MODEL');
  const generated=spawnSync(process.execPath,['--input-type=module','-e',"import {workflowOverlay} from "+JSON.stringify(path.join(skill,'bin/configure.mjs'))+";console.log(JSON.stringify(await workflowOverlay("+JSON.stringify({agent,model,...(effort?{effort}:{})})+")))"],{encoding:'utf8'});
  if(generated.status!==0)throw Error(generated.stderr);
  const complete=JSON.parse(generated.stdout),players={...complete.players},playbooks={};
  for(const [id,folder,bindings={}]of registryNames){const entry=complete.playbooks[id];if(!entry)throw Error('Unknown test entry '+id);playbooks[id]={...entry,roles:{...entry.roles,...bindings}};for(const playerId of Object.values(bindings))players[playerId]={adapter:agent==='claude-code'?'claude':agent,model,...(effort?{effort}:{}),permissions:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}};}
  const config={captain:complete.captain,players,playbooks,sessions};
  fs.writeFileSync(path.join(spex,'config/playbook.config.yaml'),JSON.stringify(config));
  save('cli-config.json',config);
  const cli=(command,request,label,cwd=temporary,settings={})=>{
    const before=new Set(fs.existsSync(sessions)?fs.readdirSync(sessions):[]);
    const receipt=run(label,process.execPath,[path.join(skill,'node_modules/@sublang/playbook/reference/sdlc/code.playbook/bin/playbook.js'),'run','--no-provision','--json'],
      {cwd,env:{...process.env,SPEX_HOME:spex},input:'/'+command+' '+JSON.stringify(request),timeout:180000,...settings});
    for(const file of fs.existsSync(sessions)?fs.readdirSync(sessions):[]){
      if(file.endsWith('.records.jsonl')&&!before.has(file))fs.copyFileSync(path.join(sessions,file),path.join(output,label+'-'+file));
    }
    assert.equal(receipt.exit_code,0,receipt.stderr);
    const envelope=JSON.parse(receipt.stdout);
    const replay=run(label+'-official-replay',process.execPath,[path.join(fileURLToPath(new URL('.',import.meta.url)), 'read_official_session.mjs'),sessions,envelope.sessionId]);
    assert.equal(replay.exit_code,0,replay.stderr);
    const records=JSON.parse(replay.stdout);
    save(label+'-session.json',records);
    const traces=records.filter(x=>x.type==='captain_telemetry').map(x=>x.payload);
    return {receipt,envelope,traces};
  };
  const settled=(result,id,state)=>assert.ok(result.traces.some(t=>t.playbookId===id&&t.type==='fsm.transition'&&t.payload.to===state),'missing '+id+' terminal '+state);
  const finish=(sources=[])=>{
    const summary={name,output,temporary,live_cli:args.includes('--live-cli'),
      passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,results,
      sources:Object.fromEntries(sources.map(relative=>[relative,sha(relative.startsWith('tests/')?path.join(fileURLToPath(new URL('.',import.meta.url)),relative.slice(6)):path.join(skill,relative))]))};
    save('summary.json',summary); console.log('Evidence: '+output); return summary;
  };
  return {output,temporary,results,commands,save,run,project,test,cli,settled,finish,live:args.includes('--live-cli')};
}
