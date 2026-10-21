export {createAgentRuntime as caseAdapter} from '../v3/runtime-path.mjs';

// Host freezes commands, files and evidence; case debugging needs no per-directory grants.
export const caseAgentPermissions = Object.freeze({mode: 'bypass'});
