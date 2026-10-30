import { assign, fromPromise, setup } from 'xstate';
import { createXStatePlaybookRuntime } from '@sublang/playbook/xstate-runtime';
import {withPlayerTurn} from '../../runtime/session.mjs';
import {parseJson} from './json.mjs';

// The official CLI owns the session. These operations deliberately have no model role.
export function commandRegistry({ id, intent, successState, operation, roles=[], rolePolicies={}, parseInput=parseJson }) {
  const meta = (stateId, terminal) => ({ playbook: { stateId, ...(terminal ? { terminal } : {}) } });
  const machine = setup({ actors: {
    operation: fromPromise(async ({ input, signal }) => {
      try { return await operation(parseInput(input),{signal}); }
      catch (error) { return { status: 'blocked', reason: error.message, ...(error.issues?{input_issues:error.issues}:{}), stopped_after: id }; }
    }),
  } }).createMachine({
    id, initial: 'ready', context: { callerInput: '', result: null },
    output: ({ context }) => context.result,
    states: {
      ready: { id: 'ready', meta: meta('ready'), tags: ['playbook.parked'],
        on: { START: { target: 'running', actions: assign({ callerInput: ({ event }) => event.text }) } } },
      running: { id: 'running', meta: meta('running'), tags: ['playbook.busy'], invoke: {
        src: 'operation', input: ({ context }) => context.callerInput,
        onDone: [
          { guard: ({ event }) => event.output.status !== 'blocked', target: successState, actions: assign({ result: ({ event }) => event.output }) },
          { target: 'blocked', actions: assign({ result: ({ event }) => event.output }) },
        ],
      } },
      [successState]: { id: successState, type: 'final', meta: meta(successState, 'success'), description: intent },
      blocked: { id: 'blocked', type: 'final', meta: meta('blocked', 'failure'), description: 'Operation blocked; inspect its receipt before changing or retrying the request.' },
    },
  });
  function validateOptions(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw Error(id + ' takes no config options; pass its request as JSON Boss text');
    return {};
  }
  const createRuntime = createXStatePlaybookRuntime(machine, {
    label: id, compat: { artifactSchema: 3, runtimeAbi: 1 }, snapshotOptions: validateOptions,
    entryEvent: { type: 'START', textField: 'text', contextField: 'callerInput' },
    outcomeAuthority: { governedPlayerStates: {} }, roleStates: {}, controlContextFields: [],
    statusesForState: (state, context) => context.result && state.status === 'done'
      ? [{ message: JSON.stringify(context.result) }] : [],
  });
  return {
    id, command: id, intent, artifactSchema: 3, rolePolicies,
    runtimeProfile: { kind: 'shared-factory', compat: createRuntime.compat },
    requiredRoleIds: roles, concurrentRoleSets: [], validateOptions,
    createRuntime: (options, hostCapabilities) => {
      const runtime=createRuntime({configuredOptions:options,hostCapabilities});let session;
      const roleless=value=>{const {playerSessions,...rest}=value;return {...rest,roleBindings:{}};};
      const init=runtime.init.bind(runtime),restore=runtime.restore.bind(runtime),handle=runtime.handleBossInput.bind(runtime),snapshot=runtime.exportSnapshot.bind(runtime);
      runtime.exportSnapshot=()=>({...snapshot(),roleResumeTokens:session?.playerSessions?.snapshot()??{}});
      runtime.init=async value=>{session=value;return init(roleless(value));};
      runtime.restore=async(value,snapshot)=>{session=value;value.playerSessions?.restore(snapshot.roleResumeTokens??{});return restore(roleless(value),{...snapshot,roleResumeTokens:{}});};
      runtime.handleBossInput=input=>withPlayerTurn(session,input.signal,()=>handle(input),()=>runtime.exportSnapshot());
      return runtime;
    },
  };
}
