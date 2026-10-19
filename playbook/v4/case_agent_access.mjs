import {cligent} from '../v3/runtime-path.mjs';

// Case implementation and differential repair run without SDK directory
// grants. The host still freezes source, requests, commands and evidence.
export const caseAgentPermissions = Object.freeze({mode: 'bypass'});
export const caseAdapter = () => new cligent.CodexAdapter();
