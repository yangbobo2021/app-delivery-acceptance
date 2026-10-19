import test from 'node:test';
import assert from 'node:assert/strict';
import {cligent} from '../v3/runtime-path.mjs';
import {caseAdapter, caseAgentPermissions} from './case_agent_access.mjs';

test('case and repair agents need no writable-directory grants or approval', () => {
  const mapped = cligent.mapPermissionsToCodexOptions(caseAgentPermissions);
  assert.equal(mapped.codexOptions.config.default_permissions, ':danger-full-access');
  assert.equal(mapped.approvalPolicy, 'never');
  assert.equal(mapped.writablePaths, undefined);
  assert.ok(caseAdapter() instanceof cligent.CodexAdapter);
});
