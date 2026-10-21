import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {caseAdapter, caseAgentPermissions} from './case_agent_access.mjs';

test('case and repair use the caller Agent without writable-directory grants', t => {
  const home=mkdtempSync(join(tmpdir(),'case-runtime-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  assert.deepEqual(caseAgentPermissions,{mode:'bypass'});
  for(const agent of ['codex','claude-code']) {
    const runtime=caseAdapter({home,cwd:home,env:{ACCEPTANCE_AGENT:agent,ACCEPTANCE_MODEL:'caller-model'}});
    assert.equal(runtime.metadata.agent,agent);
    assert.equal(runtime.metadata.model,'caller-model');
    assert.equal(typeof runtime.run,'function');
  }
});
