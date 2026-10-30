import entry from './workflows/orchestrate/registry.mjs';
import {spexEntry} from './runtime/spex-entry.mjs';
export * from './workflows/orchestrate/registry.mjs';
export const spexRegistryContract=3;
export {RUNTIME_ABI as acceptanceRuntimeAbi} from '@sublang/playbook/xstate-runtime';
export default spexEntry(entry);
