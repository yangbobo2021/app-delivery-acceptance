import entry from '../acceptance-orchestrate/workflows/project/registry.mjs';
import {spexEntry} from '../acceptance-orchestrate/runtime/spex-entry.mjs';
export * from '../acceptance-orchestrate/workflows/project/registry.mjs';
export const spexRegistryContract=3;
export {RUNTIME_ABI as acceptanceRuntimeAbi} from '@sublang/playbook/xstate-runtime';
export default spexEntry(entry);
