import { readonlyAgentRegistry } from '../shared/readonly-agent.mjs';
import { prepare, finalize, fail } from './stage.mjs';

export default readonlyAgentRegistry({id:'acceptance-scenarios',role:'designer',
  intent:'Design or revise scenarios for one frozen requirement with internal self-check; stop before case preparation or execution.',
  prepare,finalize,fail});
