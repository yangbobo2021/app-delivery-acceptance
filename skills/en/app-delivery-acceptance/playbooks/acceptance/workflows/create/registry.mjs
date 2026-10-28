import { assign, fromPromise, setup } from 'xstate';
import { createXStatePlaybookRuntime } from '@sublang/playbook/xstate-runtime';
import { createAcceptance } from './initialize.mjs';

const meta = (stateId, terminal) => ({ playbook: { stateId, ...(terminal ? { terminal } : {}) } });
const machine = setup({ actors: {
  initialize: fromPromise(async ({ input }) => {
    try { return createAcceptance(JSON.parse(input)); }
    catch (error) { return { status: 'blocked', reason: error.message, stopped_after: 'create' }; }
  }),
} }).createMachine({
  id: 'acceptance-create', initial: 'ready',
  context: { callerInput: '', result: null },
  output: ({ context }) => context.result,
  states: {
    ready: { id: 'ready', meta: meta('ready'), tags: ['playbook.parked'],
      on: { CREATE: { target: 'creating', actions: assign({ callerInput: ({ event }) => event.text }) } } },
    creating: { id: 'creating', meta: meta('creating'), tags: ['playbook.busy'], invoke: {
      src: 'initialize', input: ({ context }) => context.callerInput,
      onDone: [
        { guard: ({ event }) => event.output.status !== 'blocked', target: 'created', actions: assign({ result: ({ event }) => event.output }) },
        { target: 'blocked', actions: assign({ result: ({ event }) => event.output }) },
      ],
    } },
    created: { id: 'created', type: 'final', meta: meta('created', 'success'), description: 'Acceptance container created; no scope, definitions or tests were generated.' },
    blocked: { id: 'blocked', type: 'final', meta: meta('blocked', 'failure'), description: 'Creation blocked; inspect the reason and existing state before retrying.' },
  },
});

function validateOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw Error('acceptance-create takes no config options; pass its request as JSON Boss text');
  return {};
}
const createRuntime = createXStatePlaybookRuntime(machine, {
  label: 'acceptance-create', compat: { artifactSchema: 3, runtimeAbi: 1 },
  snapshotOptions: validateOptions, entryEvent: { type: 'CREATE', textField: 'text', contextField: 'callerInput' },
  outcomeAuthority: { governedPlayerStates: {} },
  roleStates: {}, controlContextFields: [],
  statusesForState: (state, context) => context.result && state.status === 'done'
    ? [{ message: JSON.stringify(context.result) }] : [],
});
export default {
  id: 'acceptance-create', command: 'acceptance-create',
  intent: 'Create an empty delivery acceptance container and stop before scope, requirements, scenarios or tests.',
  artifactSchema: 3, runtimeProfile: { kind: 'shared-factory', compat: createRuntime.compat },
  requiredRoleIds: [], concurrentRoleSets: [], validateOptions,
  createRuntime: (options, hostCapabilities) => createRuntime({ configuredOptions: options, hostCapabilities }),
};
