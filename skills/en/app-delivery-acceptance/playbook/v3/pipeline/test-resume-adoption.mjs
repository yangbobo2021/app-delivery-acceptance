import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=mkdtempSync(join(tmpdir(),'pipeline-resume-'));
try{
 const child=join(root,'child.mjs'),input=join(root,'input.json'),terminal=join(root,'terminal.json');
 writeFileSync(input,'{"version":1}\n');
 writeFileSync(child,`import {readFileSync,writeFileSync} from 'node:fs';
const count=Number(readFileSync('count.txt','utf8'))+1;
writeFileSync('count.txt',String(count));
writeFileSync('terminal.json',JSON.stringify({state:'caseImplementation',finished_at:new Date().toISOString()}));
`);
 writeFileSync(join(root,'count.txt'),'0');
 const spec={schema:1,jobs:[{id:'case',depends_on:[],inputs:['input.json'],
  command:[process.execPath,child],terminal:{file:'terminal.json',state_path:'final_state',
   finished_path:'finished_at',accept:['passed'],artifacts:['trace.json']}}]};
 const specFile=join(root,'spec.json'),ledger=join(root,'ledger');
 writeFileSync(specFile,JSON.stringify(spec));
 const runner=join(import.meta.dirname,'orchestrator.mjs');
 const run=()=>spawnSync(process.execPath,[runner,specFile,ledger],{cwd:root,encoding:'utf8'});
 let result=run();
 assert.equal(result.status,2,result.stderr+result.stdout);
 assert.equal(readFileSync(join(root,'count.txt'),'utf8'),'1');
 assert.equal(JSON.parse(readFileSync(join(ledger,'ledger.json'))).jobs.case.status,'failed');

 // The child is resumed through its own checkpoint protocol, outside the scheduler.
 writeFileSync(terminal,JSON.stringify({final_state:'passed',finished_at:new Date().toISOString()}));
 writeFileSync(join(root,'trace.json'),'{"judgment":"passed"}\n');
 result=run();
 assert.equal(result.status,0,result.stderr+result.stdout);
 assert.match(result.stdout,/adopted_after_resume/);
 assert.equal(readFileSync(join(root,'count.txt'),'utf8'),'1');
 assert.equal(JSON.parse(readFileSync(join(ledger,'ledger.json'))).jobs.case.attempt,1);
 result=run();
 assert.equal(result.status,0,result.stderr+result.stdout);
 assert.match(result.stdout,/"status":"reused"/);
 assert.equal(readFileSync(join(root,'count.txt'),'utf8'),'1');
 console.log('Resumed child terminal adopted without replay');
}finally{rmSync(root,{recursive:true,force:true});}
