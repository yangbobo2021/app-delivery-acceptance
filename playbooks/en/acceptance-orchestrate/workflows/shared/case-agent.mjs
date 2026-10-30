export {createAgentRuntime as caseAdapter} from '../../runtime/players.mjs';

// Host freezes commands, files and evidence; case debugging needs no per-directory grants.
export const caseAgentPermissions = Object.freeze({mode: 'bypass'});
